import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConsoleTransport, FileTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: "2026-07-31T12:00:00.000Z",
    level: "info",
    module: "test",
    jobId: null,
    stage: null,
    message: "hello",
    metadata: {},
    ...overrides,
  };
}

test("ConsoleTransport writes info-level entries as JSON to stdout", (t) => {
  const write = t.mock.method(process.stdout, "write", () => true);
  const transport = new ConsoleTransport();

  const result = transport.write(makeEntry({ level: "info" }));

  assert.equal(result.ok, true);
  assert.equal(write.mock.calls.length, 1);
  const written = write.mock.calls[0]?.arguments[0] as string;
  assert.deepEqual(JSON.parse(written), makeEntry({ level: "info" }));
});

test("ConsoleTransport routes warn/error/fatal entries to stderr", (t) => {
  const stdoutWrite = t.mock.method(process.stdout, "write", () => true);
  const stderrWrite = t.mock.method(process.stderr, "write", () => true);
  const transport = new ConsoleTransport();

  transport.write(makeEntry({ level: "error", message: "boom" }));

  assert.equal(stdoutWrite.mock.calls.length, 0);
  assert.equal(stderrWrite.mock.calls.length, 1);
});

test("FileTransport appends one JSON line per entry to a dated file", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "riddimroom-logs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const fixedDate = new Date("2026-07-31T00:00:00.000Z");
  const transport = new FileTransport({ directory: dir, now: () => fixedDate });

  const first = transport.write(makeEntry({ message: "first" }));
  const second = transport.write(makeEntry({ message: "second" }));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const filePath = path.join(dir, "2026-07-31.log");
  const lines = readFileSync(filePath, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0] ?? "").message, "first");
  assert.equal(JSON.parse(lines[1] ?? "").message, "second");
});

test("FileTransport creates the target directory if it does not exist", (t) => {
  const parent = mkdtempSync(path.join(tmpdir(), "riddimroom-logs-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dir = path.join(parent, "nested", "logs");

  const transport = new FileTransport({ directory: dir, now: () => new Date("2026-07-31") });
  const result = transport.write(makeEntry());

  assert.equal(result.ok, true);
});

test("FileTransport writes to a different file when the injected date changes", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "riddimroom-logs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let current = new Date("2026-07-31T00:00:00.000Z");
  const transport = new FileTransport({ directory: dir, now: () => current });

  transport.write(makeEntry({ message: "day one" }));
  current = new Date("2026-08-01T00:00:00.000Z");
  transport.write(makeEntry({ message: "day two" }));

  const dayOne = readFileSync(path.join(dir, "2026-07-31.log"), "utf8").trim();
  const dayTwo = readFileSync(path.join(dir, "2026-08-01.log"), "utf8").trim();
  assert.equal(JSON.parse(dayOne).message, "day one");
  assert.equal(JSON.parse(dayTwo).message, "day two");
});
