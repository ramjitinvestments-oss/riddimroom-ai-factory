import { test } from "node:test";
import assert from "node:assert/strict";
import { FileOperationError } from "../../automation/shared/errors.ts";
import { isLogLevel, Logger, parseLogLevel } from "../../automation/shared/logger.ts";
import { err, ok, type Result } from "../../automation/shared/result.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";

class FakeTransport implements LogTransport {
  readonly name = "fake";
  readonly entries: LogEntry[] = [];
  private readonly shouldFail: boolean;

  constructor(options: { shouldFail?: boolean } = {}) {
    this.shouldFail = options.shouldFail ?? false;
  }

  write(entry: LogEntry): Result<void, FileOperationError> {
    this.entries.push(entry);
    if (this.shouldFail) {
      return err(new FileOperationError("write", "fake-destination"));
    }
    return ok(undefined);
  }
}

const FIXED_NOW = () => new Date("2026-07-31T12:00:00.000Z");

test("each level method stamps the correct level and default module/jobId/stage", () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "automation/ai", transports: [transport], minLevel: "trace", now: FIXED_NOW });

  logger.trace("t");
  logger.debug("d");
  logger.info("i");
  logger.warn("w");
  logger.error("e");
  logger.fatal("f");

  assert.deepEqual(
    transport.entries.map((e) => e.level),
    ["trace", "debug", "info", "warn", "error", "fatal"],
  );
  for (const entry of transport.entries) {
    assert.equal(entry.module, "automation/ai");
    assert.equal(entry.jobId, null);
    assert.equal(entry.stage, null);
    assert.equal(entry.timestamp, "2026-07-31T12:00:00.000Z");
  }
});

test("minLevel suppresses entries below the configured severity", () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "m", transports: [transport], minLevel: "warn", now: FIXED_NOW });

  logger.trace("t");
  logger.debug("d");
  logger.info("i");
  logger.warn("w");
  logger.error("e");

  assert.deepEqual(
    transport.entries.map((e) => e.level),
    ["warn", "error"],
  );
});

test("withJob stamps every subsequent entry with the same job id (correlation)", () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "m", transports: [transport], now: FIXED_NOW });
  const jobLogger = logger.withJob("job-123");

  jobLogger.info("started");
  jobLogger.info("finished");

  assert.deepEqual(
    transport.entries.map((e) => e.jobId),
    ["job-123", "job-123"],
  );
});

test("withJob without a stage inherits the parent's bound stage", () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "m", transports: [transport], stage: "generate", now: FIXED_NOW });
  const jobLogger = logger.withJob("job-123");

  jobLogger.info("hi");

  assert.equal(transport.entries[0]?.stage, "generate");
});

test("withJob with an explicit stage overrides the parent's stage", () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "m", transports: [transport], stage: "generate", now: FIXED_NOW });
  const jobLogger = logger.withJob("job-123", "upload-printify");

  jobLogger.info("hi");

  assert.equal(transport.entries[0]?.stage, "upload-printify");
});

test("withJob with an explicit null clears the stage", () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "m", transports: [transport], stage: "generate", now: FIXED_NOW });
  const jobLogger = logger.withJob("job-123", null);

  jobLogger.info("hi");

  assert.equal(transport.entries[0]?.stage, null);
});

test("withStage keeps the bound job id and sets the stage", () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "m", transports: [transport], now: FIXED_NOW }).withJob("job-9");
  const staged = logger.withStage("publish-shopify");

  staged.info("hi");

  assert.equal(transport.entries[0]?.jobId, "job-9");
  assert.equal(transport.entries[0]?.stage, "publish-shopify");
});

test("metadata under a sensitive key is redacted before reaching the transport", () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "m", transports: [transport], now: FIXED_NOW });

  logger.info("calling printify", { metadata: { apiKey: "sk-1234567890abcd", shopId: 42 } });

  const entry = transport.entries[0];
  assert.notEqual(entry?.metadata.apiKey, "sk-1234567890abcd");
  assert.equal(entry?.metadata.shopId, 42);
});

test("an error passed in context is serialized into metadata.error", () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "m", transports: [transport], now: FIXED_NOW });

  logger.error("upload failed", { error: new Error("network unreachable") });

  const serialized = transport.entries[0]?.metadata.error as { name: string; message: string };
  assert.equal(serialized.name, "Error");
  assert.equal(serialized.message, "network unreachable");
});

test("time() logs an info entry with duration and returns the value on success", async () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "m", transports: [transport], now: FIXED_NOW });

  const value = await logger.time("Generate Artwork", async () => 42);

  assert.equal(value, 42);
  assert.equal(transport.entries.length, 1);
  assert.equal(transport.entries[0]?.message, "Generate Artwork completed");
  assert.equal(transport.entries[0]?.level, "info");
  assert.equal(typeof transport.entries[0]?.duration, "number");
  assert.ok((transport.entries[0]?.duration ?? -1) >= 0);
});

test("time() logs an error entry with duration and rethrows on failure", async () => {
  const transport = new FakeTransport();
  const logger = new Logger({ module: "m", transports: [transport], now: FIXED_NOW });
  const failure = new Error("printify rejected the upload");

  await assert.rejects(
    () =>
      logger.time("Upload Printify", () => {
        throw failure;
      }),
    (thrown: unknown) => thrown === failure,
  );

  assert.equal(transport.entries.length, 1);
  assert.equal(transport.entries[0]?.message, "Upload Printify failed");
  assert.equal(transport.entries[0]?.level, "error");
  assert.equal(typeof transport.entries[0]?.duration, "number");
});

test("a failing transport does not throw and reports failure to stderr", (t) => {
  const stderrWrite = t.mock.method(process.stderr, "write", () => true);
  const failing = new FakeTransport({ shouldFail: true });
  const logger = new Logger({ module: "m", transports: [failing], now: FIXED_NOW });

  assert.doesNotThrow(() => logger.info("hello"));
  assert.equal(stderrWrite.mock.calls.length, 1);
  const written = stderrWrite.mock.calls[0]?.arguments[0] as string;
  assert.match(written, /transport "fake" failed/);
});

test("isLogLevel recognizes valid levels and rejects unknown strings", () => {
  for (const level of ["trace", "debug", "info", "warn", "error", "fatal"]) {
    assert.equal(isLogLevel(level), true);
  }
  assert.equal(isLogLevel("verbose"), false);
});

test("parseLogLevel is case-insensitive and falls back for unrecognized values", () => {
  assert.equal(parseLogLevel("WARN"), "warn");
  assert.equal(parseLogLevel("bogus"), "info");
  assert.equal(parseLogLevel("bogus", "debug"), "debug");
});
