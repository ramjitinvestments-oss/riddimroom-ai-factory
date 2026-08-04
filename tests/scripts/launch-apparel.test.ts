import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runLaunch } from "../../scripts/launch-apparel.ts";
import type { PreflightCheckReport } from "../../scripts/preflight-check.ts";
import type { ApparelPipelineResult } from "../../scripts/apparel-pipeline.ts";
import { ExternalServiceError } from "../../automation/shared/errors.ts";
import { err, ok } from "../../automation/shared/result.ts";
import { Logger } from "../../automation/shared/logger.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";
import type { FileOperationError } from "../../automation/shared/errors.ts";
import type { Result } from "../../automation/shared/result.ts";

class FakeTransport implements LogTransport {
  readonly name = "fake";
  write(_entry: LogEntry): Result<void, FileOperationError> {
    return ok(undefined);
  }
}

function silentLogger(): Logger {
  return new Logger({ module: "test", transports: [new FakeTransport()] });
}

function tempDir(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function passingPreflight(): PreflightCheckReport {
  return { passed: true, checks: [{ name: "stub check", status: "pass", detail: "ok" }] };
}

function failingPreflight(): PreflightCheckReport {
  return {
    passed: false,
    checks: [{ name: "PRINTIFY_BLACK_VARIANT_IDS set", status: "fail", detail: "not set" }],
  };
}

function fakeSuccessResult(designStem: string): ApparelPipelineResult {
  return {
    designStem,
    route: "update-existing",
    regenerate: {
      designStem,
      printifyProductId: `printify-${designStem}`,
      reusedImageId: `img-${designStem}`,
      variantIdsApplied: [1, 2],
      newMockupUrls: [],
    },
    sync: {
      designStem,
      shopifyProductId: `shopify-${designStem}`,
      mappedSlots: [{ slot: "Hero", src: "https://example.com/hero.png" }],
      unmappedSlots: ["Flat Lay"],
      addedImageIds: ["img-1"],
      removedImageIds: [],
    },
  };
}

test("runLaunch does not attempt any design and writes no report when preflight fails", async (t) => {
  const reportDir = tempDir(t, "riddimroom-logs-");
  let designFnCalled = false;

  const report = await runLaunch({
    logger: silentLogger(),
    reportDir,
    preflightFn: async () => failingPreflight(),
    runDesignFn: async () => {
      designFnCalled = true;
      return ok(fakeSuccessResult("should-not-run"));
    },
  });

  assert.equal(report.launched, false);
  assert.equal(report.succeeded, false);
  assert.equal(report.designs.length, 0);
  assert.equal(designFnCalled, false, "no design pipeline should ever run when preflight fails");
  assert.equal(existsSync(reportDir) ? readdirSync(reportDir).length : 0, 0, "no report file should be written for a blocked launch");
});

test("runLaunch stops at the first failing design and never attempts subsequent designs", async (t) => {
  const reportDir = tempDir(t, "riddimroom-logs-");
  const attempted: string[] = [];

  const report = await runLaunch({
    designStems: ["design-a", "design-b", "design-c"],
    logger: silentLogger(),
    reportDir,
    preflightFn: async () => passingPreflight(),
    runDesignFn: async (designStem) => {
      attempted.push(designStem);
      if (designStem === "design-b") {
        return err(new ExternalServiceError("printify", "simulated production failure for design-b"));
      }
      return ok(fakeSuccessResult(designStem));
    },
  });

  assert.deepEqual(attempted, ["design-a", "design-b"], "design-c must never be attempted after design-b fails");
  assert.equal(report.succeeded, false);
  assert.equal(report.stoppedAt, "design-b");
  assert.equal(report.designs.length, 2);
  assert.equal(report.designs[0]!.outcome, "updated");
  assert.equal(report.designs[1]!.outcome, "failed");
  assert.match(report.designs[1]!.error ?? "", /simulated production failure/);
});

test("runLaunch reports every design launched and writes a report file when everything succeeds", async (t) => {
  const reportDir = tempDir(t, "riddimroom-logs-");

  const report = await runLaunch({
    designStems: ["GOLDEN turntable", "crown"],
    logger: silentLogger(),
    reportDir,
    preflightFn: async () => passingPreflight(),
    runDesignFn: async (designStem) => ok(fakeSuccessResult(designStem)),
  });

  assert.equal(report.launched, true);
  assert.equal(report.succeeded, true);
  assert.equal(report.stoppedAt, null);
  assert.equal(report.designs.length, 2);
  assert.deepEqual(
    report.designs.map((d) => d.printifyProductId),
    ["printify-GOLDEN turntable", "printify-crown"],
  );

  const files = readdirSync(reportDir);
  assert.equal(files.length, 1);
  const written = JSON.parse(readFileSync(path.join(reportDir, files[0]!), "utf8"));
  assert.equal(written.succeeded, true);
  assert.equal(written.designs.length, 2);
});

test("runLaunch passes the exact design stems requested, in order, to each pipeline run", async (t) => {
  const reportDir = tempDir(t, "riddimroom-logs-");
  const seen: string[] = [];

  await runLaunch({
    designStems: ["first", "second"],
    logger: silentLogger(),
    reportDir,
    preflightFn: async () => passingPreflight(),
    runDesignFn: async (designStem) => {
      seen.push(designStem);
      return ok(fakeSuccessResult(designStem));
    },
  });

  assert.deepEqual(seen, ["first", "second"]);
});
