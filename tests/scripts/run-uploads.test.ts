import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listApprovedJobIds, runUploads } from "../../scripts/run-uploads.ts";
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

const VALID_PRODUCT = {
  title: "Sunset Parrot Tee",
  description: "A bold Caribbean design.",
  tags: ["caribbean", "streetwear", "tropical"],
  productType: "T-Shirt",
  suggestedRetailPrice: 27.99,
};

function setUpApprovedRoot(t: { after: (fn: () => void) => void }): {
  approvedRoot: string;
  uploadedRoot: string;
  logger: Logger;
} {
  const root = mkdtempSync(path.join(tmpdir(), "riddimroom-approved-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    approvedRoot: path.join(root, "approved"),
    uploadedRoot: path.join(root, "uploaded"),
    logger: new Logger({ module: "test", transports: [new FakeTransport()] }),
  };
}

function createApprovedJob(
  approvedRoot: string,
  jobId: string,
  product: Record<string, unknown> | undefined = VALID_PRODUCT,
): void {
  const jobDir = path.join(approvedRoot, jobId);
  mkdirSync(jobDir, { recursive: true });
  if (product !== undefined) {
    writeFileSync(path.join(jobDir, "product.json"), JSON.stringify(product));
    writeFileSync(path.join(jobDir, "artwork.png"), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));
  }
}

test("runUploads uploads, publishes, verifies, and moves a job to uploaded/ on success", async (t) => {
  const { approvedRoot, uploadedRoot, logger } = setUpApprovedRoot(t);
  createApprovedJob(approvedRoot, "job-1");

  const report = await runUploads(["job-1"], {
    approvedRoot,
    uploadedRoot,
    logger,
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(report.total, 1);
  assert.equal(report.succeeded, 1);
  assert.equal(report.failed, 0);
  const result = report.results[0];
  assert.equal(result?.status, "success");
  assert.match(result?.printifyProductId ?? "", /job-1/);
  assert.match(result?.shopifyProductId ?? "", /job-1/);
  assert.equal(existsSync(path.join(approvedRoot, "job-1")), false);
  assert.equal(existsSync(path.join(uploadedRoot, "job-1", "product.json")), true);
});

test("runUploads continues past a job missing artwork and still processes the rest", async (t) => {
  const { approvedRoot, uploadedRoot, logger } = setUpApprovedRoot(t);
  createApprovedJob(approvedRoot, "job-good");
  mkdirSync(path.join(approvedRoot, "job-bad"), { recursive: true });
  writeFileSync(path.join(approvedRoot, "job-bad", "product.json"), JSON.stringify(VALID_PRODUCT));
  // no artwork.png written for job-bad

  const report = await runUploads(["job-good", "job-bad"], {
    approvedRoot,
    uploadedRoot,
    logger,
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(report.total, 2);
  assert.equal(report.succeeded, 1);
  assert.equal(report.failed, 1);
  const bad = report.results.find((r) => r.jobId === "job-bad");
  assert.equal(bad?.status, "failed");
  assert.equal(bad?.stage, "read-job");
  const good = report.results.find((r) => r.jobId === "job-good");
  assert.equal(good?.status, "success");
});

test("runUploads reports a malformed product.json as a read-job failure", async (t) => {
  const { approvedRoot, uploadedRoot, logger } = setUpApprovedRoot(t);
  createApprovedJob(approvedRoot, "job-1", { title: "Missing other fields" });

  const report = await runUploads(["job-1"], {
    approvedRoot,
    uploadedRoot,
    logger,
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(report.results[0]?.status, "failed");
  assert.equal(report.results[0]?.stage, "read-job");
});

test("runUploads fails every job immediately (no processing) when a provider is misconfigured", async (t) => {
  const { approvedRoot, uploadedRoot, logger } = setUpApprovedRoot(t);
  createApprovedJob(approvedRoot, "job-1");
  createApprovedJob(approvedRoot, "job-2");

  const report = await runUploads(["job-1", "job-2"], {
    approvedRoot,
    uploadedRoot,
    logger,
    printifyProviderOptions: { env: { DRY_RUN: "false" } }, // missing all Printify config
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(report.total, 2);
  assert.equal(report.succeeded, 0);
  assert.equal(report.failed, 2);
  assert.ok(report.results.every((r) => r.stage === "printify"));
  // Jobs must be untouched — the provider never got the chance to run.
  assert.equal(existsSync(path.join(approvedRoot, "job-1")), true);
  assert.equal(existsSync(path.join(approvedRoot, "job-2")), true);
});

test("listApprovedJobIds returns only job directories that have a product.json", async (t) => {
  const { approvedRoot } = setUpApprovedRoot(t);
  createApprovedJob(approvedRoot, "job-complete");
  mkdirSync(path.join(approvedRoot, "job-incomplete"), { recursive: true });

  assert.deepEqual(listApprovedJobIds(approvedRoot), ["job-complete"]);
});

test("listApprovedJobIds returns an empty array when the approved root doesn't exist", () => {
  assert.deepEqual(listApprovedJobIds(path.join(tmpdir(), "definitely-does-not-exist-98765")), []);
});
