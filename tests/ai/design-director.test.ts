import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseStyle, DEFAULT_STYLE_ID } from "../../automation/ai/design-director.ts";
import type { StyleDefinition } from "../../automation/ai/styles/types.ts";

test("matches a Jamaican sound system brief to the vintage-jamaican-sound-system style", () => {
  const decision = chooseStyle(
    "a towering vintage Jamaican sound system stack with glowing speaker cones, dancehall street party energy",
  );
  assert.equal(decision.style.id, "vintage-jamaican-sound-system");
  assert.equal(decision.usedFallback, false);
  assert.ok(decision.matchedKeywords.length > 0);
});

test("matches a tattoo-flash brief to the tattoo-illustration style", () => {
  const decision = chooseStyle("a traditional tattoo flash rose with a dagger through it");
  assert.equal(decision.style.id, "tattoo-illustration");
});

test("matches a luxury/minimal brief to the luxury-minimal style", () => {
  const decision = chooseStyle("a quiet luxury monogram mark for a high fashion capsule");
  assert.equal(decision.style.id, "luxury-minimal");
});

test("falls back to the default style when nothing in the brief matches any niche", () => {
  const decision = chooseStyle("xyzzy plugh flarn wobbulator");
  assert.equal(decision.usedFallback, true);
  assert.equal(decision.style.id, DEFAULT_STYLE_ID);
  assert.equal(decision.niche, "general premium apparel");
  assert.deepEqual(decision.matchedKeywords, []);
});

test("is deterministic: the same brief always produces the same decision", () => {
  const brief = "a dancehall sound clash flyer with sunburst rays";
  const first = chooseStyle(brief);
  const second = chooseStyle(brief);
  assert.equal(first.style.id, second.style.id);
  assert.deepEqual(first.matchedKeywords, second.matchedKeywords);
});

test("matching is case-insensitive", () => {
  const lower = chooseStyle("a traditional tattoo flash design");
  const upper = chooseStyle("A TRADITIONAL TATTOO FLASH DESIGN");
  assert.equal(lower.style.id, upper.style.id);
});

test("ties keep the earlier style in library order (deterministic tie-break)", () => {
  const styleA: StyleDefinition = makeTestStyle("style-a", ["shared-keyword"]);
  const styleB: StyleDefinition = makeTestStyle("style-b", ["shared-keyword"]);

  const decision = chooseStyle("a design brief containing shared-keyword", { styles: [styleA, styleB] });
  assert.equal(decision.style.id, "style-a");
});

test("picks the style with strictly more keyword matches over one with fewer", () => {
  const oneMatch: StyleDefinition = makeTestStyle("one-match", ["alpha"]);
  const twoMatches: StyleDefinition = makeTestStyle("two-matches", ["alpha", "beta"]);

  const decision = chooseStyle("alpha and beta both appear here", { styles: [oneMatch, twoMatches] });
  assert.equal(decision.style.id, "two-matches");
});

test("visualComplexity and targetCustomer are derived from the chosen style", () => {
  const decision = chooseStyle("a quiet luxury monogram");
  assert.equal(decision.visualComplexity, decision.style.complexityTarget);
  assert.match(decision.targetCustomer, new RegExp(decision.niche.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

function makeTestStyle(id: string, bestNiches: readonly string[]): StyleDefinition {
  return {
    id,
    name: id,
    designPhilosophy: "test style for design-director unit tests",
    visualCharacteristics: ["test"],
    compositionRules: ["test"],
    colorPalette: { description: "test", swatches: ["test"] },
    typography: ["test"],
    textureGuidance: ["test"],
    illustrationDirection: ["test"],
    printRecommendations: ["test"],
    negativePrompts: ["test"],
    bestNiches,
    shirtColorCompatibility: ["black"],
    complexityTarget: "moderate",
    commercialPositioning: "test positioning.",
  };
}
