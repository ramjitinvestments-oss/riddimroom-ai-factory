import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runBatch } from "../../scripts/run-batch.ts";
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

function tempOutputRoot(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), "riddimroom-batch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("runBatch generates artwork + product copy for every brief and reports full success", async (t) => {
  const outputRoot = tempOutputRoot(t);
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });
  const briefs = ["a mango wearing sunglasses", "a parrot playing steel pan", "a rasta lion crest"];

  const report = await runBatch(briefs, {
    outputRoot,
    logger,
    concurrency: 2,
    imageProviderOptions: { env: { DRY_RUN: "true" } },
    productCopyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(report.total, 3);
  assert.equal(report.succeeded, 3);
  assert.equal(report.failed, 0);

  for (const result of report.results) {
    assert.equal(result.status, "success");
    assert.ok(result.jobId);
    assert.ok(existsSync(path.join(outputRoot, result.jobId as string, "artwork.png")));
    assert.ok(existsSync(path.join(outputRoot, result.jobId as string, "metadata.json")));
    assert.ok(existsSync(path.join(outputRoot, result.jobId as string, "product.json")));
  }
});

test("runBatch continues past a single failure and reports it without stopping the rest of the batch", async (t) => {
  const outputRoot = tempOutputRoot(t);
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });
  const briefs = ["a mango wearing sunglasses", "   ", "a rasta lion crest"];

  const report = await runBatch(briefs, {
    outputRoot,
    logger,
    concurrency: 2,
    imageProviderOptions: { env: { DRY_RUN: "true" } },
    productCopyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(report.total, 3);
  assert.equal(report.succeeded, 2);
  assert.equal(report.failed, 1);

  const failure = report.results.find((r) => r.status === "failed");
  assert.ok(failure);
  assert.equal(failure?.brief, "   ");
  assert.equal(failure?.stage, "artwork");

  const successes = report.results.filter((r) => r.status === "success");
  assert.equal(successes.length, 2);
});

test("runBatch reports a product-copy-stage failure distinctly from an artwork-stage failure", async (t) => {
  const outputRoot = tempOutputRoot(t);
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const report = await runBatch(["a mango wearing sunglasses"], {
    outputRoot,
    logger,
    imageProviderOptions: { env: { DRY_RUN: "true" } },
    // Forces the real (misconfigured) product-copy provider, which fails with a ConfigError.
    productCopyProviderOptions: { env: { DRY_RUN: "false" } },
  });

  assert.equal(report.failed, 1);
  assert.equal(report.results[0]?.stage, "product-copy");
  assert.ok(report.results[0]?.jobId, "artwork should have succeeded and produced a jobId");
});

test("runBatch handles a concurrency value larger than the batch size", async (t) => {
  const outputRoot = tempOutputRoot(t);
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const report = await runBatch(["a mango"], {
    outputRoot,
    logger,
    concurrency: 50,
    imageProviderOptions: { env: { DRY_RUN: "true" } },
    productCopyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(report.total, 1);
  assert.equal(report.succeeded, 1);
});
