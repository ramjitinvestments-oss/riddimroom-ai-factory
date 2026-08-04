import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAdaptiveTextLayerRequest,
  chooseAdaptiveTypography,
} from "../../../automation/ai/typography/adaptive-typography.ts";
import { estimateFontSizeForWidth } from "../../../automation/ai/typography/typography-engine.ts";

test("black shirt gets a light fill (white/gold/light gray family) that clears the accessibility threshold", () => {
  const choice = chooseAdaptiveTypography("black");
  assert.ok(["white", "gold", "light gray"].includes(choice.fillColorName));
  assert.equal(choice.passesAccessibilityThreshold, true);
  assert.ok(choice.fillContrastRatio >= choice.minContrastRatioRequired);
});

test("white shirt gets a dark fill (black/dark charcoal family) that clears the accessibility threshold", () => {
  const choice = chooseAdaptiveTypography("white");
  assert.ok(["black", "dark charcoal"].includes(choice.fillColorName));
  assert.equal(choice.passesAccessibilityThreshold, true);
});

test("the outline is always drawn from the opposite tonal family of the fill", () => {
  const onBlack = chooseAdaptiveTypography("black");
  const onWhite = chooseAdaptiveTypography("white");
  // fill is light on black shirts -> outline must be dark, and vice versa
  assert.notEqual(onBlack.fillColorHex, onBlack.outlineColorHex);
  assert.notEqual(onWhite.fillColorHex, onWhite.outlineColorHex);
});

test("dark shirts get a glow effect, light shirts get a drop-shadow effect", () => {
  assert.equal(chooseAdaptiveTypography("black").effect, "glow");
  assert.equal(chooseAdaptiveTypography("vintage charcoal").effect, "glow");
  assert.equal(chooseAdaptiveTypography("white").effect, "drop-shadow");
  assert.equal(chooseAdaptiveTypography("cream").effect, "drop-shadow");
});

test("every real shirt color used across the Style Library passes the default accessibility threshold", async () => {
  const { STYLE_LIBRARY } = await import("../../../automation/ai/styles/library.ts");
  const allShirtColors = new Set(STYLE_LIBRARY.flatMap((style) => style.shirtColorCompatibility));
  assert.ok(allShirtColors.size > 0);
  for (const shirtColor of allShirtColors) {
    const choice = chooseAdaptiveTypography(shirtColor);
    assert.equal(choice.passesAccessibilityThreshold, true, `shirt color "${shirtColor}" failed contrast`);
  }
});

test("an artificially strict threshold can still be reported as failing (the reject gate is real, not decorative)", () => {
  const choice = chooseAdaptiveTypography("black", { minContrastRatio: 25 }); // above the theoretical max of 21
  assert.equal(choice.passesAccessibilityThreshold, false);
});

test("buildAdaptiveTextLayerRequest returns a fully-populated TextLayerRequest for a passing shirt color", () => {
  const result = buildAdaptiveTextLayerRequest(
    { text: "RIDDIMROOM", canvasWidthPx: 4500, canvasHeightPx: 5400, xPx: 2250, yPx: 4428, maxWidthPx: 3600 },
    "black",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.text, "RIDDIMROOM");
  assert.equal(result.value.color, result.value.adaptiveTypography.fillColorHex);
  assert.ok(result.value.outline);
  assert.ok(result.value.outline!.widthPx > 0);
  assert.ok(result.value.shadow);
  assert.equal(result.value.adaptiveTypography.effect, "glow");
});

test("buildAdaptiveTextLayerRequest auto-estimates font size the same way the Typography Engine already does", () => {
  const result = buildAdaptiveTextLayerRequest(
    { text: "RIDDIMROOM", canvasWidthPx: 4500, canvasHeightPx: 5400, xPx: 2250, yPx: 4428, maxWidthPx: 3600 },
    "black",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.fontSizePx, estimateFontSizeForWidth("RIDDIMROOM", 3600));
});

test("buildAdaptiveTextLayerRequest respects an explicit fontSizePx and scales the outline to it", () => {
  const small = buildAdaptiveTextLayerRequest(
    { text: "X", canvasWidthPx: 1000, canvasHeightPx: 1000, xPx: 500, yPx: 500, fontSizePx: 100 },
    "black",
  );
  const large = buildAdaptiveTextLayerRequest(
    { text: "X", canvasWidthPx: 1000, canvasHeightPx: 1000, xPx: 500, yPx: 500, fontSizePx: 400 },
    "black",
  );
  assert.equal(small.ok, true);
  assert.equal(large.ok, true);
  if (!small.ok || !large.ok) return;
  assert.equal(small.value.fontSizePx, 100);
  assert.equal(large.value.fontSizePx, 400);
  assert.ok(large.value.outline!.widthPx > small.value.outline!.widthPx);
});

test("buildAdaptiveTextLayerRequest rejects when no color choice can clear an impossible threshold", () => {
  const result = buildAdaptiveTextLayerRequest(
    { text: "RIDDIMROOM", canvasWidthPx: 4500, canvasHeightPx: 5400, xPx: 2250, yPx: 4428, maxWidthPx: 3600 },
    "black",
    { minContrastRatio: 25 },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "VALIDATION_ERROR");
  assert.match(result.error.message, /contrast ratio/);
});

test("buildAdaptiveTextLayerRequest forwards optional fields (curve, letterSpacing, fontFamily) unchanged", () => {
  const result = buildAdaptiveTextLayerRequest(
    {
      text: "ARC",
      canvasWidthPx: 1000,
      canvasHeightPx: 1000,
      xPx: 500,
      yPx: 500,
      fontSizePx: 80,
      fontFamily: "serif",
      letterSpacingPx: 4,
      curve: { radiusPx: 300, sweepDeg: 90 },
    },
    "white",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.fontFamily, "serif");
  assert.equal(result.value.letterSpacingPx, 4);
  assert.deepEqual(result.value.curve, { radiusPx: 300, sweepDeg: 90 });
});
