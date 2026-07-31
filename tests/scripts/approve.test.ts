import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decideJobs, listPendingJobIds } from "../../scripts/approve.ts";
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

function setUpPipelineRoot(t: { after: (fn: () => void) => void }): {
  root: string;
  generatedRoot: string;
  approvedRoot: string;
  archiveRoot: string;
  logger: Logger;
} {
  const root = mkdtempSync(path.join(tmpdir(), "riddimroom-pipeline-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    generatedRoot: path.join(root, "generated"),
    approvedRoot: path.join(root, "approved"),
    archiveRoot: path.join(root, "archive"),
    logger: new Logger({ module: "test", transports: [new FakeTransport()] }),
  };
}

function createCompletedJob(generatedRoot: string, jobId: string): void {
  const jobDir = path.join(generatedRoot, jobId);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(path.join(jobDir, "artwork.png"), "fake-png");
  writeFileSync(path.join(jobDir, "metadata.json"), "{}");
  writeFileSync(path.join(jobDir, "product.json"), "{}");
}

test("decideJobs('approve') moves a completed job from generated to approved", (t) => {
  const { generatedRoot, approvedRoot, archiveRoot, logger } = setUpPipelineRoot(t);
  createCompletedJob(generatedRoot, "job-1");

  const results = decideJobs("approve", ["job-1"], { generatedRoot, approvedRoot, archiveRoot, logger });

  assert.equal(results[0]?.status, "ok");
  assert.equal(results[0]?.destination, path.join(approvedRoot, "job-1"));
  assert.equal(existsSync(path.join(generatedRoot, "job-1")), false);
  assert.equal(existsSync(path.join(approvedRoot, "job-1", "product.json")), true);
});

test("decideJobs('reject') moves a completed job from generated to archive", (t) => {
  const { generatedRoot, approvedRoot, archiveRoot, logger } = setUpPipelineRoot(t);
  createCompletedJob(generatedRoot, "job-1");

  const results = decideJobs("reject", ["job-1"], { generatedRoot, approvedRoot, archiveRoot, logger });

  assert.equal(results[0]?.status, "ok");
  assert.equal(results[0]?.destination, path.join(archiveRoot, "job-1"));
  assert.equal(existsSync(path.join(archiveRoot, "job-1", "product.json")), true);
});

test("decideJobs fails a job with no directory, without throwing", (t) => {
  const { generatedRoot, approvedRoot, archiveRoot, logger } = setUpPipelineRoot(t);

  const results = decideJobs("approve", ["no-such-job"], { generatedRoot, approvedRoot, archiveRoot, logger });

  assert.equal(results[0]?.status, "failed");
  assert.match(results[0]?.error ?? "", /not found/);
});

test("decideJobs refuses a job that is not fully generated (no product.json)", (t) => {
  const { generatedRoot, approvedRoot, archiveRoot, logger } = setUpPipelineRoot(t);
  mkdirSync(path.join(generatedRoot, "job-1"), { recursive: true });
  writeFileSync(path.join(generatedRoot, "job-1", "artwork.png"), "fake-png");

  const results = decideJobs("approve", ["job-1"], { generatedRoot, approvedRoot, archiveRoot, logger });

  assert.equal(results[0]?.status, "failed");
  assert.match(results[0]?.error ?? "", /product\.json/);
  assert.equal(existsSync(path.join(generatedRoot, "job-1")), true, "source must be left untouched");
});

test("decideJobs never overwrites an existing destination", (t) => {
  const { generatedRoot, approvedRoot, archiveRoot, logger } = setUpPipelineRoot(t);
  createCompletedJob(generatedRoot, "job-1");
  mkdirSync(path.join(approvedRoot, "job-1"), { recursive: true });
  writeFileSync(path.join(approvedRoot, "job-1", "product.json"), '{"already":"here"}');

  const results = decideJobs("approve", ["job-1"], { generatedRoot, approvedRoot, archiveRoot, logger });

  assert.equal(results[0]?.status, "failed");
  assert.match(results[0]?.error ?? "", /already exists/);
  assert.equal(existsSync(path.join(generatedRoot, "job-1")), true, "source must be left untouched");
});

test("decideJobs processes a batch, continuing past one bad job id", (t) => {
  const { generatedRoot, approvedRoot, archiveRoot, logger } = setUpPipelineRoot(t);
  createCompletedJob(generatedRoot, "job-good");

  const results = decideJobs("approve", ["job-good", "job-missing"], {
    generatedRoot,
    approvedRoot,
    archiveRoot,
    logger,
  });

  assert.equal(results.length, 2);
  assert.equal(results.find((r) => r.jobId === "job-good")?.status, "ok");
  assert.equal(results.find((r) => r.jobId === "job-missing")?.status, "failed");
  assert.equal(existsSync(path.join(approvedRoot, "job-good")), true);
});

test("listPendingJobIds returns only job directories that have a product.json", (t) => {
  const { generatedRoot } = setUpPipelineRoot(t);
  createCompletedJob(generatedRoot, "job-complete");
  mkdirSync(path.join(generatedRoot, "job-incomplete"), { recursive: true });

  const pending = listPendingJobIds(generatedRoot);

  assert.deepEqual(pending, ["job-complete"]);
});

test("listPendingJobIds returns an empty array when the generated root doesn't exist", () => {
  assert.deepEqual(listPendingJobIds(path.join(tmpdir(), "definitely-does-not-exist-12345")), []);
});
