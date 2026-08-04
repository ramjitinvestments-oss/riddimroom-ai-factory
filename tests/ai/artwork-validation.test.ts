import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  MIN_DPI,
  PRINT_PHYSICAL_HEIGHT_IN,
  PRINT_PHYSICAL_WIDTH_IN,
  validateArtwork,
} from "../../automation/ai/artwork-validation.ts";
import { createSolidPng } from "../../automation/ai/png.ts";
import { toPrintReadyPng } from "../../automation/ai/prepare-print-ready.ts";

async function resizedPng(width: number, height: number, withAlpha = true): Promise<Buffer> {
  const source = createSolidPng(100, 100, { r: 30, g: 60, b: 90, a: 255 });
  let pipeline = sharp(source).resize(width, height, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (!withAlpha) {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } }).removeAlpha();
  } else {
    pipeline = pipeline.ensureAlpha();
  }
  return pipeline.png().toBuffer();
}

function buildCorruptPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(6, 9);
  const ihdrChunk = Buffer.concat([
    lengthPrefix(ihdrData.length),
    Buffer.from("IHDR"),
    ihdrData,
    Buffer.alloc(4), // invalid CRC
  ]);

  const garbageIdatData = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // not a valid zlib stream
  const idatChunk = Buffer.concat([
    lengthPrefix(garbageIdatData.length),
    Buffer.from("IDAT"),
    garbageIdatData,
    Buffer.alloc(4),
  ]);

  const iendChunk = Buffer.concat([lengthPrefix(0), Buffer.from("IEND"), Buffer.alloc(4)]);

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function lengthPrefix(length: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(length, 0);
  return buffer;
}

test("validateArtwork rejects a buffer that is not a PNG at all", async () => {
  const result = await validateArtwork(Buffer.from("not a png"));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
});

test("validateArtwork rejects a structurally-signatured but corrupted/undecodable PNG", async () => {
  const result = await validateArtwork(buildCorruptPng(100, 100));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /corrupted or unreadable/);
  }
});

test("validateArtwork marks exactly 4500x5400 as matching the preferred dimensions and comfortably meeting the DPI floor", async () => {
  const png = await toPrintReadyPng(createSolidPng(300, 300, { r: 10, g: 20, b: 30, a: 255 }));
  assert.equal(png.ok, true);
  if (!png.ok) return;

  const result = await validateArtwork(png.value.buffer);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.matchesPreferredDimensions, true);
  assert.equal(result.value.meetsMinimumDpi, true);
  assert.equal(result.value.valid, true);
  assert.equal(result.value.hasTransparentBackground, true);
  assert.deepEqual(result.value.issues, []);
});

test("validateArtwork accepts non-4500x5400 artwork that still meets the minimum DPI at the target print size", async () => {
  // width/12in = 310 dpi, height/14.4in = 310 dpi — just above MIN_DPI, well below PRINT_WIDTH/PRINT_HEIGHT.
  const width = Math.ceil(PRINT_PHYSICAL_WIDTH_IN * (MIN_DPI + 10));
  const height = Math.ceil(PRINT_PHYSICAL_HEIGHT_IN * (MIN_DPI + 10));
  const png = await resizedPng(width, height);

  const result = await validateArtwork(png);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.matchesPreferredDimensions, false);
  assert.equal(result.value.meetsMinimumDpi, true);
  assert.equal(result.value.valid, true);
});

test("validateArtwork rejects artwork below the minimum DPI, with a reason in issues", async () => {
  const png = await resizedPng(1000, 1200);

  const result = await validateArtwork(png);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.meetsMinimumDpi, false);
  assert.equal(result.value.valid, false);
  assert.ok(result.value.issues.some((issue) => issue.includes("effective DPI")));
});

test("validateArtwork reports hasTransparentBackground false for a flattened (no-alpha) PNG", async () => {
  const width = Math.ceil(PRINT_PHYSICAL_WIDTH_IN * (MIN_DPI + 10));
  const height = Math.ceil(PRINT_PHYSICAL_HEIGHT_IN * (MIN_DPI + 10));
  const png = await resizedPng(width, height, false);

  const result = await validateArtwork(png);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.hasTransparentBackground, false);
  // Transparency is "if available", not a hard requirement — still valid.
  assert.equal(result.value.valid, true);
});
