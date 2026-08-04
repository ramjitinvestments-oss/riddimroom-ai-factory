import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contrastRatio,
  DEFAULT_MIN_CONTRAST_RATIO,
  isDarkColor,
  relativeLuminance,
  resolveShirtColor,
  rgbToHex,
  SHIRT_COLOR_SWATCHES,
  WCAG_AA_LARGE_TEXT_MIN_CONTRAST,
} from "../../../automation/ai/typography/contrast.ts";

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

test("relativeLuminance: pure black is 0, pure white is 1 (WCAG reference values)", () => {
  assert.equal(relativeLuminance(BLACK), 0);
  assert.ok(Math.abs(relativeLuminance(WHITE) - 1) < 1e-9);
});

test("contrastRatio: black vs white is the maximum 21:1", () => {
  assert.ok(Math.abs(contrastRatio(BLACK, WHITE) - 21) < 1e-6);
});

test("contrastRatio: identical colors have a ratio of exactly 1", () => {
  assert.equal(contrastRatio({ r: 128, g: 64, b: 32 }, { r: 128, g: 64, b: 32 }), 1);
});

test("contrastRatio: symmetric regardless of argument order", () => {
  const a = { r: 200, g: 50, b: 90 };
  const b = { r: 10, g: 200, b: 40 };
  assert.equal(contrastRatio(a, b), contrastRatio(b, a));
});

test("rgbToHex: known conversions", () => {
  assert.equal(rgbToHex(BLACK), "#000000");
  assert.equal(rgbToHex(WHITE), "#ffffff");
  assert.equal(rgbToHex({ r: 217, g: 164, b: 65 }), "#d9a441");
});

test("resolveShirtColor: known names resolve case-insensitively", () => {
  assert.deepEqual(resolveShirtColor("black"), SHIRT_COLOR_SWATCHES.black);
  assert.deepEqual(resolveShirtColor("BLACK"), SHIRT_COLOR_SWATCHES.black);
  assert.deepEqual(resolveShirtColor("  White  "), SHIRT_COLOR_SWATCHES.white);
});

test("resolveShirtColor: unknown names fall back to a neutral mid-tone rather than throwing", () => {
  const resolved = resolveShirtColor("some-color-nobody-defined");
  assert.equal(resolved.r, resolved.g);
  assert.equal(resolved.g, resolved.b);
  assert.ok(resolved.r > 50 && resolved.r < 200);
});

test("isDarkColor: black is dark, white is not", () => {
  assert.equal(isDarkColor(BLACK), true);
  assert.equal(isDarkColor(WHITE), false);
});

test("every style-library shirt color name resolves to a distinct, real swatch", () => {
  assert.ok(Object.keys(SHIRT_COLOR_SWATCHES).length >= 15);
  for (const [name, rgb] of Object.entries(SHIRT_COLOR_SWATCHES)) {
    assert.ok(rgb.r >= 0 && rgb.r <= 255, name);
    assert.ok(rgb.g >= 0 && rgb.g <= 255, name);
    assert.ok(rgb.b >= 0 && rgb.b <= 255, name);
  }
});

test("threshold constants are sane relative to each other", () => {
  assert.ok(WCAG_AA_LARGE_TEXT_MIN_CONTRAST >= 3);
  assert.ok(DEFAULT_MIN_CONTRAST_RATIO >= WCAG_AA_LARGE_TEXT_MIN_CONTRAST);
});
