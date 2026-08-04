import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateProductCopy } from "../../scripts/generate-product-copy.ts";
import { createSolidPng } from "../../automation/ai/png.ts";
import { Logger } from "../../automation/shared/logger.ts";
import type { FileOperationError } from "../../automation/shared/errors.ts";
import { ok, type Result } from "../../automation/shared/result.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";

class FakeTransport implements LogTransport {
  readonly name = "fake";
  readonly entries: LogEntry[] = [];

  write(entry: LogEntry): Result<void, FileOperationError> {
    this.entries.push(entry);
    return ok(undefined);
  }
}

function setUpJob(
  t: { after: (fn: () => void) => void },
  jobId: string,
  metadata: Record<string, unknown> | undefined = { brief: "a parrot wearing sunglasses" },
): string {
  const jobsRoot = mkdtempSync(path.join(tmpdir(), "riddimroom-jobs-"));
  t.after(() => rmSync(jobsRoot, { recursive: true, force: true }));

  const jobDir = path.join(jobsRoot, jobId);
  mkdirSync(jobDir, { recursive: true });
  if (metadata !== undefined) {
    writeFileSync(path.join(jobDir, "metadata.json"), JSON.stringify(metadata));
    writeFileSync(path.join(jobDir, "artwork.png"), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));
  }

  return jobsRoot;
}

test("generateProductCopy saves product.json with the generated fields", async (t) => {
  const jobsRoot = setUpJob(t, "job-1");
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const result = await generateProductCopy("job-1", {
    jobsRoot,
    logger,
    providerOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.productPath, path.join(jobsRoot, "job-1", "product.json"));

  const product = JSON.parse(readFileSync(result.value.productPath, "utf8"));
  assert.equal(product.jobId, "job-1");
  assert.equal(product.brief, "a parrot wearing sunglasses");
  assert.equal(typeof product.title, "string");
  assert.ok(Array.isArray(product.tags) && product.tags.length >= 3);
  assert.equal(product.provider, "dry-run");
});

test("generateProductCopy overrides a shirt's price to the fixed DEFAULT_SHIRT_PRICE, preserving the AI suggestion for audit", async (t) => {
  const jobsRoot = setUpJob(t, "job-1");
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const result = await generateProductCopy("job-1", {
    jobsRoot,
    logger,
    providerOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const product = JSON.parse(readFileSync(result.value.productPath, "utf8"));
  assert.equal(product.productType, "T-Shirt");
  // DryRunProductCopyProvider's own suggestion is 28.99 -- confirms it was overridden, not coincidentally equal.
  assert.equal(product.aiSuggestedRetailPrice, 28.99);
  assert.equal(product.suggestedRetailPrice, 24.99);
});

test("generateProductCopy honors a configured DEFAULT_SHIRT_PRICE", async (t) => {
  const jobsRoot = setUpJob(t, "job-1");
  const originalEnv = process.env.DEFAULT_SHIRT_PRICE;
  process.env.DEFAULT_SHIRT_PRICE = "19.99";
  t.after(() => {
    if (originalEnv === undefined) delete process.env.DEFAULT_SHIRT_PRICE;
    else process.env.DEFAULT_SHIRT_PRICE = originalEnv;
  });

  const result = await generateProductCopy("job-1", {
    jobsRoot,
    providerOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const product = JSON.parse(readFileSync(result.value.productPath, "utf8"));
  assert.equal(product.suggestedRetailPrice, 19.99);
});

test("generateProductCopy rejects a blank jobId without touching disk", async (t) => {
  const jobsRoot = setUpJob(t, "job-1");
  const result = await generateProductCopy("   ", { jobsRoot });
  assert.equal(result.ok, false);
});

test("generateProductCopy reports a FileOperationError when the job directory doesn't exist", async (t) => {
  const jobsRoot = mkdtempSync(path.join(tmpdir(), "riddimroom-jobs-"));
  t.after(() => rmSync(jobsRoot, { recursive: true, force: true }));

  const result = await generateProductCopy("no-such-job", { jobsRoot });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "FILE_OPERATION_ERROR");
  }
});

test("generateProductCopy reports a ValidationError when metadata.json has no usable brief", async (t) => {
  const jobsRoot = setUpJob(t, "job-1", { notBrief: "oops" });
  const result = await generateProductCopy("job-1", { jobsRoot });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
});

test("generateProductCopy reports a ConfigError when the real provider is misconfigured", async (t) => {
  const jobsRoot = setUpJob(t, "job-1");
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const result = await generateProductCopy("job-1", {
    jobsRoot,
    logger,
    providerOptions: { env: { DRY_RUN: "false" } },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFIG_ERROR");
  }
});
