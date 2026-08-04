import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  inspectArtwork,
  isPrintifySuitable,
  prepareArtwork,
  removeSimpleSolidBackground,
} from "../../automation/ai/artwork-preparation.ts";
import { MIN_DPI, PRINT_PHYSICAL_HEIGHT_IN, PRINT_PHYSICAL_WIDTH_IN } from "../../automation/ai/artwork-validation.ts";
import { createSolidPng } from "../../automation/ai/png.ts";
import { PRINT_HEIGHT, PRINT_WIDTH } from "../../automation/ai/prepare-print-ready.ts";

/** Exactly the print canvas, transparent, comfortably above the DPI floor: already suitable. */
async function printReadyPng(): Promise<Buffer> {
  return sharp(createSolidPng(200, 200, { r: 10, g: 20, b: 30, a: 255 }))
    .resize(PRINT_WIDTH, PRINT_HEIGHT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();
}

/**
 * A raw RGB (no alpha channel — genuinely opaque, not just alpha=255) PNG
 * with a uniform background color and a distinctly-colored rectangular
 * subject in the middle.
 */
async function opaqueWithCenterSubject(
  width: number,
  height: number,
  bg: { r: number; g: number; b: number },
  subject: { r: number; g: number; b: number },
  marginRatio = 0.3,
): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  const left = Math.floor(width * marginRatio);
  const right = Math.ceil(width * (1 - marginRatio));
  const top = Math.floor(height * marginRatio);
  const bottom = Math.ceil(height * (1 - marginRatio));
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

/**
 * A smooth diagonal gradient across the whole canvas, no alpha channel —
 * perimeter pixels vary well beyond the uniformity tolerance.
 */
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

test("inspectArtwork reports dimensions, format, transparency, DPI, and color profile", async () => {
  const width = Math.ceil(PRINT_PHYSICAL_WIDTH_IN * (MIN_DPI + 10));
  const height = Math.ceil(PRINT_PHYSICAL_HEIGHT_IN * (MIN_DPI + 10));
  const buffer = await sharp(createSolidPng(50, 50, { r: 1, g: 2, b: 3, a: 0 }))
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();

  const result = await inspectArtwork(buffer);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.format, "png");
  assert.equal(result.value.width, width);
  assert.equal(result.value.height, height);
  assert.equal(result.value.hasTransparentBackground, true);
  assert.equal(result.value.meetsMinimumDpi, true);
  assert.equal(result.value.colorSpace, "srgb");
  assert.equal(result.value.hasIccProfile, false);
});

test("inspectArtwork reports matchesPrintCanvas only at the exact print dimensions", async () => {
  const exact = await printReadyPng();
  const exactResult = await inspectArtwork(exact);
  assert.equal(exactResult.ok, true);
  if (exactResult.ok) assert.equal(exactResult.value.matchesPrintCanvas, true);

  const off = await sharp(createSolidPng(10, 10, { r: 1, g: 2, b: 3, a: 255 }))
    .resize(1000, 1000, { fit: "fill" })
    .png()
    .toBuffer();
  const offResult = await inspectArtwork(off);
  assert.equal(offResult.ok, true);
  if (offResult.ok) assert.equal(offResult.value.matchesPrintCanvas, false);
});

test("inspectArtwork reports a ValidationError for unreadable data", async () => {
  const result = await inspectArtwork(Buffer.from("not an image"));
  assert.equal(result.ok, false);
});

test("isPrintifySuitable is true only for exact-canvas, high-DPI, transparent PNG", async () => {
  const ready = await inspectArtwork(await printReadyPng());
  assert.ok(ready.ok && isPrintifySuitable(ready.value));

  const wrongSize = await inspectArtwork(
    await sharp(createSolidPng(10, 10, { r: 1, g: 2, b: 3, a: 255 })).resize(1000, 1000, { fit: "fill" }).ensureAlpha().png().toBuffer(),
  );
  assert.ok(wrongSize.ok && !isPrintifySuitable(wrongSize.value));

  const opaque = await inspectArtwork(
    await sharp(createSolidPng(10, 10, { r: 1, g: 2, b: 3, a: 255 }))
      .resize(PRINT_WIDTH, PRINT_HEIGHT, { fit: "fill" })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer(),
  );
  assert.ok(opaque.ok && !isPrintifySuitable(opaque.value));
});

test("removeSimpleSolidBackground clears a uniform background and preserves a distinct subject", async () => {
  const bg = { r: 250, g: 250, b: 250 };
  const subject = { r: 10, g: 20, b: 200 };
  const buffer = await opaqueWithCenterSubject(400, 400, bg, subject);

  const result = await removeSimpleSolidBackground(buffer);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.value.backgroundColor, bg);
  assert.ok(result.value.removedRatio > 0.3 && result.value.removedRatio < 0.9);

  const { data, info } = await sharp(result.value.buffer).raw().toBuffer({ resolveWithObject: true });
  const cornerOffset = 0;
  assert.equal(data[cornerOffset + 3], 0, "background corner should now be transparent");

  const centerX = Math.floor(info.width / 2);
  const centerY = Math.floor(info.height / 2);
  const centerOffset = (centerY * info.width + centerX) * 4;
  assert.deepEqual(
    [data[centerOffset], data[centerOffset + 1], data[centerOffset + 2], data[centerOffset + 3]],
    [subject.r, subject.g, subject.b, 255],
    "subject center should remain untouched and fully opaque",
  );
});

test("removeSimpleSolidBackground refuses a non-uniform (gradient) background", async () => {
  const buffer = await gradientPng(300, 300);
  const result = await removeSimpleSolidBackground(buffer);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.issues.join(" "), /not a simple, uniform color/);
});

test("removeSimpleSolidBackground refuses to erase a canvas with no distinct subject", async () => {
  const buffer = createSolidPng(200, 200, { r: 100, g: 100, b: 100, a: 255 });
  const result = await removeSimpleSolidBackground(buffer);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.issues.join(" "), /no recognizable subject/);
});

test("prepareArtwork leaves an already-suitable image untouched with no fixes applied", async () => {
  const buffer = await printReadyPng();
  const result = await prepareArtwork(buffer);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.fixesApplied.length, 0);
  assert.equal(result.value.suitableForPrintify, true);
  assert.equal(result.value.buffer, buffer);
});

test("prepareArtwork resizes/pads a transparent but wrongly-sized image without touching its background", async () => {
  const buffer = await sharp(createSolidPng(200, 200, { r: 5, g: 5, b: 5, a: 255 }))
    .resize(600, 400, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();

  const result = await prepareArtwork(buffer);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(
    result.value.fixesApplied.map((f) => f.type),
    ["resizedAndPadded"],
  );
  assert.equal(result.value.suitableForPrintify, true);
  assert.equal(result.value.processed.width, PRINT_WIDTH);
  assert.equal(result.value.processed.height, PRINT_HEIGHT);
});

test("prepareArtwork removes a simple background and resizes an opaque, undersized image", async () => {
  const buffer = await opaqueWithCenterSubject(600, 400, { r: 245, g: 245, b: 245 }, { r: 30, g: 120, b: 30 });

  const result = await prepareArtwork(buffer);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(
    result.value.fixesApplied.map((f) => f.type),
    ["backgroundRemoved", "resizedAndPadded"],
  );
  assert.equal(result.value.suitableForPrintify, true);
  assert.equal(result.value.processed.hasTransparentBackground, true);
  assert.equal(result.value.processed.width, PRINT_WIDTH);
  assert.equal(result.value.processed.height, PRINT_HEIGHT);
});

test("prepareArtwork stops and reports when the background isn't safe to remove automatically", async () => {
  const buffer = await gradientPng(500, 500);
  const result = await prepareArtwork(buffer);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.issues.join(" "), /not a simple, uniform color/);
});

test("prepareArtwork reports a ValidationError for unreadable data", async () => {
  const result = await prepareArtwork(Buffer.from("not an image"));
  assert.equal(result.ok, false);
});
