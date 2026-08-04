import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  estimateFontSizeForWidth,
  MIN_LEGIBLE_FONT_SIZE_PX,
  renderTextLayer,
  validateLegibility,
} from "../../../automation/ai/typography/typography-engine.ts";

async function opaqueRatio(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 10) opaque++;
  }
  return opaque / (info.width * info.height);
}

test("estimateFontSizeForWidth: longer text yields a smaller font size for the same width", () => {
  const short = estimateFontSizeForWidth("HI", 1000);
  const long = estimateFontSizeForWidth("A MUCH LONGER HEADLINE HERE", 1000);
  assert.ok(long < short);
});

test("estimateFontSizeForWidth: never exceeds the sane maximum cap", () => {
  const size = estimateFontSizeForWidth("A", 100000);
  assert.ok(size <= 800);
});

test("validateLegibility: rejects below the floor and accepts at/above it", () => {
  assert.equal(validateLegibility(MIN_LEGIBLE_FONT_SIZE_PX - 1).ok, false);
  assert.equal(validateLegibility(MIN_LEGIBLE_FONT_SIZE_PX).ok, true);
  assert.equal(validateLegibility(MIN_LEGIBLE_FONT_SIZE_PX + 100).ok, true);
});

test("renderTextLayer: rejects blank text", async () => {
  const result = await renderTextLayer({ text: "   ", canvasWidthPx: 500, canvasHeightPx: 500, xPx: 250, yPx: 250 });
  assert.equal(result.ok, false);
});

test("renderTextLayer: rejects an explicit font size below the legibility floor", async () => {
  const result = await renderTextLayer({
    text: "tiny",
    canvasWidthPx: 500,
    canvasHeightPx: 500,
    xPx: 250,
    yPx: 250,
    fontSizePx: 10,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
    assert.match(result.error.message, /legible/);
  }
});

test("renderTextLayer: produces a real PNG with visible glyph pixels for straight text", async () => {
  const result = await renderTextLayer({
    text: "RIDDIMROOM",
    canvasWidthPx: 1000,
    canvasHeightPx: 400,
    xPx: 500,
    yPx: 220,
    fontSizePx: 120,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const ratio = await opaqueRatio(result.value);
  assert.ok(ratio > 0.01, `expected visible glyph coverage, got ${ratio}`);
});

test("renderTextLayer: produces visible glyph pixels for curved text", async () => {
  const result = await renderTextLayer({
    text: "PREMIUM CARIBBEAN",
    canvasWidthPx: 1200,
    canvasHeightPx: 1200,
    xPx: 600,
    yPx: 700,
    fontSizePx: 80,
    curve: { radiusPx: 400, sweepDeg: 140 },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const ratio = await opaqueRatio(result.value);
  assert.ok(ratio > 0.005, `expected visible glyph coverage, got ${ratio}`);
});

test("renderTextLayer: auto-fits a font size when none is given, and still renders visibly", async () => {
  const result = await renderTextLayer({
    text: "AUTO SIZED HEADLINE",
    canvasWidthPx: 1500,
    canvasHeightPx: 500,
    xPx: 750,
    yPx: 280,
    maxWidthPx: 1200,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const ratio = await opaqueRatio(result.value);
  assert.ok(ratio > 0.01);
});

test("renderTextLayer: an auto-fit size that would be illegible is rejected, not silently rendered tiny", async () => {
  const result = await renderTextLayer({
    text: "a genuinely extremely long headline that will not fit into a very small box at all",
    canvasWidthPx: 500,
    canvasHeightPx: 200,
    xPx: 250,
    yPx: 100,
    maxWidthPx: 50,
  });
  assert.equal(result.ok, false);
});

test("renderTextLayer: output dimensions match the requested canvas size", async () => {
  const result = await renderTextLayer({
    text: "SIZE CHECK",
    canvasWidthPx: 800,
    canvasHeightPx: 300,
    xPx: 400,
    yPx: 180,
    fontSizePx: 100,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const metadata = await sharp(result.value).metadata();
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 300);
});
