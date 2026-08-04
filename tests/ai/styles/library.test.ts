import { test } from "node:test";
import assert from "node:assert/strict";
import { getStyleById, STYLE_LIBRARY } from "../../../automation/ai/styles/library.ts";

test("the style library has between 12 and 20 styles", () => {
  assert.ok(STYLE_LIBRARY.length >= 12, `expected at least 12 styles, got ${STYLE_LIBRARY.length}`);
  assert.ok(STYLE_LIBRARY.length <= 20, `expected at most 20 styles, got ${STYLE_LIBRARY.length}`);
});

test("every style id is unique", () => {
  const ids = STYLE_LIBRARY.map((style) => style.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every style has a fully populated rule set (no blank or empty fields)", () => {
  for (const style of STYLE_LIBRARY) {
    const context = `style "${style.id}"`;
    assert.ok(style.id.trim().length > 0, `${context}: id must not be blank`);
    assert.ok(style.name.trim().length > 0, `${context}: name must not be blank`);
    assert.ok(style.designPhilosophy.trim().length > 20, `${context}: designPhilosophy must be substantive`);
    assert.ok(style.visualCharacteristics.length > 0, `${context}: visualCharacteristics must not be empty`);
    assert.ok(style.compositionRules.length > 0, `${context}: compositionRules must not be empty`);
    assert.ok(style.colorPalette.description.trim().length > 0, `${context}: colorPalette.description must not be blank`);
    assert.ok(style.colorPalette.swatches.length > 0, `${context}: colorPalette.swatches must not be empty`);
    assert.ok(style.typography.length > 0, `${context}: typography must not be empty`);
    assert.ok(style.textureGuidance.length > 0, `${context}: textureGuidance must not be empty`);
    assert.ok(style.illustrationDirection.length > 0, `${context}: illustrationDirection must not be empty`);
    assert.ok(style.printRecommendations.length > 0, `${context}: printRecommendations must not be empty`);
    assert.ok(style.negativePrompts.length > 0, `${context}: negativePrompts must not be empty`);
    assert.ok(style.bestNiches.length > 0, `${context}: bestNiches must not be empty`);
    assert.ok(style.shirtColorCompatibility.length > 0, `${context}: shirtColorCompatibility must not be empty`);
    assert.ok(
      ["moderate", "high", "very-high"].includes(style.complexityTarget),
      `${context}: complexityTarget must be a recognized value`,
    );
    assert.ok(style.commercialPositioning.trim().length > 0, `${context}: commercialPositioning must not be blank`);
  }
});

test("no two styles share every niche keyword (each style is meaningfully distinct)", () => {
  for (let i = 0; i < STYLE_LIBRARY.length; i++) {
    for (let j = i + 1; j < STYLE_LIBRARY.length; j++) {
      const a = new Set(STYLE_LIBRARY[i]?.bestNiches);
      const b = STYLE_LIBRARY[j]?.bestNiches ?? [];
      const identical = b.length === a.size && b.every((niche) => a.has(niche));
      assert.equal(identical, false, `styles "${STYLE_LIBRARY[i]?.id}" and "${STYLE_LIBRARY[j]?.id}" have identical bestNiches`);
    }
  }
});

test("getStyleById finds a known style and returns undefined for an unknown one", () => {
  const found = getStyleById("premium-streetwear");
  assert.ok(found);
  assert.equal(found?.id, "premium-streetwear");

  const missing = getStyleById("does-not-exist");
  assert.equal(missing, undefined);
});

test("the required RiddimRoom-priority styles are present", () => {
  const ids = new Set(STYLE_LIBRARY.map((style) => style.id));
  for (const expected of ["premium-streetwear", "vintage-jamaican-sound-system", "dancehall-flyer"]) {
    assert.ok(ids.has(expected), `expected style "${expected}" in the library`);
  }
});
