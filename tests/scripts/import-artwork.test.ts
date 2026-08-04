import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { importApprovedArtwork } from "../../scripts/import-artwork.ts";
import { MIN_DPI, PRINT_PHYSICAL_HEIGHT_IN, PRINT_PHYSICAL_WIDTH_IN } from "../../automation/ai/artwork-validation.ts";
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

function tempDir(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A PNG comfortably above the DPI floor without matching PRINT_WIDTH/PRINT_HEIGHT (fast to generate). */
async function validArtworkPng(): Promise<Buffer> {
  const width = Math.ceil(PRINT_PHYSICAL_WIDTH_IN * (MIN_DPI + 10));
  const height = Math.ceil(PRINT_PHYSICAL_HEIGHT_IN * (MIN_DPI + 10));
  const source = createSolidPng(100, 100, { r: 10, g: 20, b: 30, a: 255 });
  return sharp(source)
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();
}

/** Well below the DPI floor at any reasonable print size. */
async function lowDpiArtworkPng(): Promise<Buffer> {
  const source = createSolidPng(100, 100, { r: 10, g: 20, b: 30, a: 255 });
  return sharp(source)
    .resize(400, 480, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();
}

test("importApprovedArtwork imports a valid PNG, writing all five files beside it", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  writeFileSync(path.join(approvedRoot, "sunset-parrot.png"), await validArtworkPng());
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const result = await importApprovedArtwork({
    approvedRoot,
    logger,
    providerOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.scanned, 1);
  assert.equal(result.value.imported.length, 1);
  assert.equal(result.value.stoppedDueTo, null);
  assert.deepEqual(result.value.remainingUnprocessed, []);

  const item = result.value.imported[0]!;
  assert.equal(item.sourcePath, path.join(approvedRoot, "sunset-parrot.png"));
  assert.equal(item.productPath, path.join(approvedRoot, "sunset-parrot.product.json"));
  assert.equal(item.seoPath, path.join(approvedRoot, "sunset-parrot.seo.json"));
  assert.equal(item.tagsPath, path.join(approvedRoot, "sunset-parrot.tags.json"));
  assert.equal(item.descriptionPath, path.join(approvedRoot, "sunset-parrot.description.md"));
  assert.equal(item.jobPath, path.join(approvedRoot, "sunset-parrot.job.json"));

  const product = JSON.parse(readFileSync(item.productPath, "utf8"));
  assert.equal(product.jobId, item.jobId);
  assert.equal(typeof product.title, "string");
  assert.equal(product.productType, "T-Shirt");
  assert.equal(product.suggestedRetailPrice, 24.99); // fixed shirt price — the analysis provider is never asked for a price
  assert.equal(typeof product.collectionId, "string");
  assert.equal(typeof product.collectionName, "string");

  const seo = JSON.parse(readFileSync(item.seoPath, "utf8"));
  assert.equal(typeof seo.seoTitle, "string");
  assert.equal(typeof seo.seoDescription, "string");

  const tags = JSON.parse(readFileSync(item.tagsPath, "utf8"));
  assert.ok(Array.isArray(tags) && tags.length >= 10 && tags.length <= 15);

  const description = readFileSync(item.descriptionPath, "utf8");
  assert.match(description, /^# .+\n\n.+/s);

  const job = JSON.parse(readFileSync(item.jobPath, "utf8"));
  assert.equal(job.jobId, item.jobId);
  assert.equal(job.engine, "artwork-import");
  assert.equal(job.status, "imported");
  assert.equal(job.validation.valid, true);
  assert.equal(job.validation.meetsMinimumDpi, true);
  assert.equal(typeof job.analysis.collectionId, "string");
  assert.equal(typeof job.analysis.styleId, "string");
  assert.equal(typeof job.analysis.theme, "string");
  assert.ok(Array.isArray(job.analysis.keywords) && job.analysis.keywords.length > 0);
  assert.equal(typeof job.analysis.targetAudience, "string");
  assert.equal(job.analysisProvider, "dry-run");
});

test("importApprovedArtwork never uses the PNG's filename — analysis comes entirely from the artwork", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  writeFileSync(path.join(approvedRoot, "this-filename-is-not-analyzed-in-any-way.png"), await validArtworkPng());

  const result = await importApprovedArtwork({ approvedRoot, providerOptions: { env: { DRY_RUN: "true" } } });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const product = JSON.parse(readFileSync(result.value.imported[0]!.productPath, "utf8"));
  // The dry-run provider's fixed output — proves the filename played no role in the result.
  assert.equal(product.title, "Vintage Jamaican Sound Systems Tee");
});

test("importApprovedArtwork skips a PNG that already has a job.json beside it", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  const pngPath = path.join(approvedRoot, "already-done.png");
  writeFileSync(pngPath, await validArtworkPng());
  writeFileSync(path.join(approvedRoot, "already-done.job.json"), JSON.stringify({ status: "imported" }));

  const result = await importApprovedArtwork({ approvedRoot, providerOptions: { env: { DRY_RUN: "true" } } });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.imported.length, 0);
  assert.deepEqual(result.value.skippedAlreadyImported, [pngPath]);
  assert.equal(result.value.stoppedDueTo, null);
  // No product.json was created — proves the provider was never called for this file.
  assert.equal(existsSync(path.join(approvedRoot, "already-done.product.json")), false);
});

test("importApprovedArtwork stops the whole batch on artwork below the minimum DPI and writes no files for it", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  const pngPath = path.join(approvedRoot, "low-res.png");
  writeFileSync(pngPath, await lowDpiArtworkPng());

  const result = await importApprovedArtwork({ approvedRoot, providerOptions: { env: { DRY_RUN: "true" } } });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.imported.length, 0);
  assert.ok(result.value.stoppedDueTo);
  assert.equal(result.value.stoppedDueTo?.sourcePath, pngPath);
  assert.ok(result.value.stoppedDueTo?.details.some((issue) => issue.includes("effective DPI")));
  assert.equal(existsSync(path.join(approvedRoot, "low-res.job.json")), false);
});

test("production-safe error handling: one invalid artwork halts the entire batch — later artwork is never even attempted", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  // "a-corrupt" sorts before "z-good" so the scan reaches the corrupt file first.
  writeFileSync(path.join(approvedRoot, "a-corrupt.png"), Buffer.from("not really a png"));
  writeFileSync(path.join(approvedRoot, "z-good.png"), await validArtworkPng());

  const result = await importApprovedArtwork({ approvedRoot, providerOptions: { env: { DRY_RUN: "true" } } });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.scanned, 2);
  // Nothing was imported — the batch stopped before the good file was ever reached.
  assert.equal(result.value.imported.length, 0);
  assert.ok(result.value.stoppedDueTo);
  assert.equal(result.value.stoppedDueTo?.sourcePath, path.join(approvedRoot, "a-corrupt.png"));
  assert.deepEqual(result.value.remainingUnprocessed, [path.join(approvedRoot, "z-good.png")]);
  // The good file's metadata was never generated, proving it was never attempted.
  assert.equal(existsSync(path.join(approvedRoot, "z-good.job.json")), false);
});

test("importApprovedArtwork finds PNGs nested in subdirectories", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  const subDir = path.join(approvedRoot, "batch-1");
  mkdirSync(subDir, { recursive: true });
  writeFileSync(path.join(subDir, "nested.png"), await validArtworkPng());

  const result = await importApprovedArtwork({ approvedRoot, providerOptions: { env: { DRY_RUN: "true" } } });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.scanned, 1);
  assert.equal(result.value.imported.length, 1);
  assert.equal(result.value.imported[0]!.sourcePath, path.join(subDir, "nested.png"));
});

test("importApprovedArtwork returns an empty report when designs/approved/ doesn't exist, without erroring", async (t) => {
  const approvedRoot = path.join(tempDir(t, "riddimroom-approved-"), "does-not-exist");

  const result = await importApprovedArtwork({ approvedRoot, providerOptions: { env: { DRY_RUN: "true" } } });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    scanned: 0,
    imported: [],
    skippedAlreadyImported: [],
    stoppedDueTo: null,
    remainingUnprocessed: [],
  });
});

test("importApprovedArtwork reports a ConfigError and processes nothing when the real provider is misconfigured", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  writeFileSync(path.join(approvedRoot, "sunset-parrot.png"), await validArtworkPng());

  const result = await importApprovedArtwork({ approvedRoot, providerOptions: { env: { DRY_RUN: "false" } } });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFIG_ERROR");
  }
  assert.equal(existsSync(path.join(approvedRoot, "sunset-parrot.job.json")), false);
});
