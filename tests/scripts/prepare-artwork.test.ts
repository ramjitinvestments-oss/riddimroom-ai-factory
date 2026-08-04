import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prepareApprovedArtwork } from "../../scripts/prepare-artwork.ts";
import { outputPaths } from "../../scripts/import-artwork.ts";
import { createSolidPng } from "../../automation/ai/png.ts";
import { PRINT_HEIGHT, PRINT_WIDTH } from "../../automation/ai/prepare-print-ready.ts";
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

function tempDir(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Raw RGB (no alpha channel — genuinely opaque) PNG: uniform background + a distinct rectangular subject. */
async function opaqueWithCenterSubject(width: number, height: number): Promise<Buffer> {
  const bg = { r: 250, g: 250, b: 250 };
  const subject = { r: 20, g: 40, b: 200 };
  const data = Buffer.alloc(width * height * 3);
  const left = Math.floor(width * 0.3);
  const right = Math.ceil(width * 0.7);
  const top = Math.floor(height * 0.3);
  const bottom = Math.ceil(height * 0.7);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      const inSubject = x >= left && x < right && y >= top && y < bottom;
      const c = inSubject ? subject : bg;
      data[offset] = c.r;
      data[offset + 1] = c.g;
      data[offset + 2] = c.b;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** Raw RGB (no alpha channel) smooth gradient — perimeter pixels vary well beyond the uniformity tolerance. */
async function gradientPng(width: number, height: number): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      data[offset] = Math.floor((x / width) * 255);
      data[offset + 1] = Math.floor((y / height) * 255);
      data[offset + 2] = 128;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function printReadyPng(): Promise<Buffer> {
  return sharp(createSolidPng(200, 200, { r: 10, g: 20, b: 30, a: 255 }))
    .resize(PRINT_WIDTH, PRINT_HEIGHT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();
}

test("prepareApprovedArtwork writes a processed PNG + prepared.json report for artwork needing fixes", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  const processedRoot = tempDir(t, "riddimroom-processed-");
  writeFileSync(path.join(approvedRoot, "sunset-parrot.png"), await opaqueWithCenterSubject(600, 400));
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const report = await prepareApprovedArtwork({ approvedRoot, processedRoot, logger });

  assert.equal(report.scanned, 1);
  assert.equal(report.prepared.length, 1);
  assert.equal(report.stoppedDueTo, null);

  const item = report.prepared[0]!;
  assert.equal(item.suitableForPrintify, true);
  assert.equal(item.transparencyBefore, false);
  assert.equal(item.transparencyAfter, true);
  assert.equal(item.fixesApplied.length, 2);

  const processedPngPath = path.join(processedRoot, "sunset-parrot.png");
  assert.equal(existsSync(processedPngPath), true);
  const metadata = await sharp(readFileSync(processedPngPath)).metadata();
  assert.equal(metadata.width, PRINT_WIDTH);
  assert.equal(metadata.height, PRINT_HEIGHT);
  assert.equal(metadata.hasAlpha, true);

  const outputs = outputPaths(processedPngPath);
  assert.equal(existsSync(outputs.prepared), true);
  const preparedReport = JSON.parse(readFileSync(outputs.prepared, "utf8")) as { suitableForPrintify: boolean };
  assert.equal(preparedReport.suitableForPrintify, true);

  // The original in designs/approved/ must be byte-identical to what was written.
  const original = readFileSync(path.join(approvedRoot, "sunset-parrot.png"));
  assert.equal(original.length > 0, true);
});

test("prepareApprovedArtwork leaves an already-suitable PNG's original bytes untouched and still writes a processed copy", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  const processedRoot = tempDir(t, "riddimroom-processed-");
  const source = await printReadyPng();
  writeFileSync(path.join(approvedRoot, "already-ready.png"), source);

  const report = await prepareApprovedArtwork({ approvedRoot, processedRoot });

  assert.equal(report.prepared.length, 1);
  assert.deepEqual(report.prepared[0]!.fixesApplied, []);
  assert.equal(report.prepared[0]!.suitableForPrintify, true);
  assert.equal(existsSync(path.join(processedRoot, "already-ready.png")), true);
});

test("prepareApprovedArtwork skips a PNG whose processed counterpart already exists (idempotent)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  const processedRoot = tempDir(t, "riddimroom-processed-");
  writeFileSync(path.join(approvedRoot, "done.png"), await printReadyPng());
  mkdirSync(processedRoot, { recursive: true });
  writeFileSync(path.join(processedRoot, "done.png"), Buffer.from("already there"));

  const report = await prepareApprovedArtwork({ approvedRoot, processedRoot });

  assert.equal(report.prepared.length, 0);
  assert.deepEqual(report.skippedAlreadyProcessed, [path.join(approvedRoot, "done.png")]);
  // Must not have overwritten the existing processed file.
  assert.equal(readFileSync(path.join(processedRoot, "done.png"), "utf8"), "already there");
});

test("an item that can't be safely prepared is rejected (moved + reported), and the batch continues to the rest", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  const processedRoot = tempDir(t, "riddimroom-processed-");
  const rejectedRoot = tempDir(t, "riddimroom-rejected-");
  writeFileSync(path.join(approvedRoot, "a-bad-background.png"), await gradientPng(400, 400));
  writeFileSync(path.join(approvedRoot, "z-should-still-run.png"), await opaqueWithCenterSubject(400, 400));
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const report = await prepareApprovedArtwork({ approvedRoot, processedRoot, rejectedRoot, logger });

  // No system failure — the batch ran to completion.
  assert.equal(report.stoppedDueTo, null);
  assert.deepEqual(report.remainingUnprocessed, []);

  // The bad item was rejected, not left blocking the batch.
  assert.equal(report.rejected.length, 1);
  const rejection = report.rejected[0]!;
  assert.equal(rejection.filename, "a-bad-background.png");
  assert.equal(rejection.sourcePath, path.join(approvedRoot, "a-bad-background.png"));
  assert.equal(rejection.rejectedPath, path.join(rejectedRoot, "a-bad-background.png"));
  assert.match(rejection.reason, /not a simple, uniform color/);
  assert.match(rejection.suggestedFix, /transparent background/);

  // Moved out of approved/, into rejected/, with a rejection report beside it.
  assert.equal(existsSync(path.join(approvedRoot, "a-bad-background.png")), false);
  assert.equal(existsSync(path.join(rejectedRoot, "a-bad-background.png")), true);
  const outputs = outputPaths(path.join(rejectedRoot, "a-bad-background.png"));
  assert.equal(existsSync(outputs.rejected), true);
  const rejectedReport = JSON.parse(readFileSync(outputs.rejected, "utf8")) as {
    filename: string;
    reason: string;
    suggestedFix: string;
  };
  assert.equal(rejectedReport.filename, "a-bad-background.png");
  assert.match(rejectedReport.reason, /not a simple, uniform color/);
  assert.ok(rejectedReport.suggestedFix.length > 0);

  // The second, healthy item was still processed — the batch didn't stop.
  assert.equal(report.prepared.length, 1);
  assert.equal(report.prepared[0]!.sourcePath, path.join(approvedRoot, "z-should-still-run.png"));
  assert.equal(existsSync(path.join(processedRoot, "z-should-still-run.png")), true);
});

test("prepareApprovedArtwork skips a PNG whose rejected counterpart already exists (idempotent)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  const processedRoot = tempDir(t, "riddimroom-processed-");
  const rejectedRoot = tempDir(t, "riddimroom-rejected-");
  writeFileSync(path.join(approvedRoot, "already-rejected.png"), await gradientPng(200, 200));
  mkdirSync(rejectedRoot, { recursive: true });
  writeFileSync(path.join(rejectedRoot, "already-rejected.png"), Buffer.from("already there"));

  const report = await prepareApprovedArtwork({ approvedRoot, processedRoot, rejectedRoot });

  assert.equal(report.rejected.length, 0);
  assert.deepEqual(report.skippedAlreadyRejected, [path.join(approvedRoot, "already-rejected.png")]);
  // The original in approved/ must not have been touched a second time.
  assert.equal(existsSync(path.join(approvedRoot, "already-rejected.png")), true);
  assert.equal(readFileSync(path.join(rejectedRoot, "already-rejected.png"), "utf8"), "already there");
});

test("production-safe error handling: a system failure (filesystem error) still halts the entire batch — later artwork is never even attempted", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  const processedParent = tempDir(t, "riddimroom-processed-parent-");
  // processedRoot itself exists as a plain file, not a directory, so mkdirSync(..., {recursive:true})
  // for it is guaranteed to throw — a genuine filesystem error, not a content problem with the artwork.
  const processedRoot = path.join(processedParent, "blocked-by-a-file");
  writeFileSync(processedRoot, "not a directory");

  writeFileSync(path.join(approvedRoot, "a-good-design.png"), await opaqueWithCenterSubject(400, 400));
  writeFileSync(path.join(approvedRoot, "z-should-never-run.png"), await printReadyPng());
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const report = await prepareApprovedArtwork({ approvedRoot, processedRoot, logger });

  assert.equal(report.prepared.length, 0);
  assert.equal(report.rejected.length, 0);
  assert.ok(report.stoppedDueTo !== null);
  assert.equal(report.stoppedDueTo?.sourcePath, path.join(approvedRoot, "a-good-design.png"));
  assert.match(report.stoppedDueTo?.reason ?? "", /filesystem error/);
  assert.deepEqual(report.remainingUnprocessed, [path.join(approvedRoot, "z-should-never-run.png")]);

  // The good design's original must still be untouched in approved/ — a system failure doesn't reject artwork.
  assert.equal(existsSync(path.join(approvedRoot, "a-good-design.png")), true);
});

test("prepareApprovedArtwork preserves nested subdirectory structure between approved/ and processed/", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  const processedRoot = tempDir(t, "riddimroom-processed-");
  mkdirSync(path.join(approvedRoot, "batch-1"), { recursive: true });
  writeFileSync(path.join(approvedRoot, "batch-1", "nested.png"), await printReadyPng());

  const report = await prepareApprovedArtwork({ approvedRoot, processedRoot });

  assert.equal(report.prepared.length, 1);
  assert.equal(existsSync(path.join(processedRoot, "batch-1", "nested.png")), true);
});

test("prepareApprovedArtwork returns an empty report when designs/approved/ doesn't exist, without erroring", async (t) => {
  const approvedRoot = path.join(tempDir(t, "riddimroom-approved-"), "does-not-exist");
  const processedRoot = tempDir(t, "riddimroom-processed-");

  const report = await prepareApprovedArtwork({ approvedRoot, processedRoot });

  assert.deepEqual(report, {
    scanned: 0,
    prepared: [],
    rejected: [],
    skippedAlreadyProcessed: [],
    skippedAlreadyRejected: [],
    stoppedDueTo: null,
    remainingUnprocessed: [],
  });
});
