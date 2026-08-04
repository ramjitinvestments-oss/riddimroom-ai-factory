import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseCollection, DEFAULT_COLLECTION_ID } from "../../../automation/ai/collections/collection-director.ts";
import type { CollectionDefinition } from "../../../automation/ai/collections/types.ts";

test("matches a Jamaican sound system brief to the vintage-jamaican-sound-systems collection", () => {
  const decision = chooseCollection("a jamaican sound system speaker stack with glowing cones");
  assert.equal(decision.collection.id, "vintage-jamaican-sound-systems");
  assert.equal(decision.usedFallback, false);
  assert.ok(decision.matchedKeywords.length > 0);
});

test("matches a dancehall queen brief to the dancehall-kings collection", () => {
  const decision = chooseCollection("a dancehall queen dancing under sunburst lights");
  assert.equal(decision.collection.id, "dancehall-kings");
});

test("matches a premium tropical brief to the tropical-lifestyle collection", () => {
  const decision = chooseCollection("a resort wear premium island minimalist wave mark");
  assert.equal(decision.collection.id, "tropical-lifestyle");
});

test("matches a vinyl/turntable brief to the vinyl-culture collection", () => {
  const decision = chooseCollection("a crate digger's needle drop on a turntable");
  assert.equal(decision.collection.id, "vinyl-culture");
});

test("falls back to the default (flagship) collection when nothing matches", () => {
  const decision = chooseCollection("xyzzy plugh flarn wobbulator");
  assert.equal(decision.usedFallback, true);
  assert.equal(decision.collection.id, DEFAULT_COLLECTION_ID);
  assert.deepEqual(decision.matchedKeywords, []);
});

test("is deterministic: the same brief always produces the same decision", () => {
  const brief = "a sound clash between two rival sound systems";
  const first = chooseCollection(brief);
  const second = chooseCollection(brief);
  assert.equal(first.collection.id, second.collection.id);
  assert.deepEqual(first.matchedKeywords, second.matchedKeywords);
});

test("matching is case-insensitive", () => {
  const lower = chooseCollection("a dancehall queen brief");
  const upper = chooseCollection("A DANCEHALL QUEEN BRIEF");
  assert.equal(lower.collection.id, upper.collection.id);
});

test("ties keep the earlier collection in library order (deterministic tie-break)", () => {
  const collectionA = makeTestCollection("collection-a", ["shared-keyword"]);
  const collectionB = makeTestCollection("collection-b", ["shared-keyword"]);

  const decision = chooseCollection("a brief containing shared-keyword", { collections: [collectionA, collectionB] });
  assert.equal(decision.collection.id, "collection-a");
});

test("picks the collection with strictly more keyword matches over one with fewer", () => {
  const oneMatch = makeTestCollection("one-match", ["alpha"]);
  const twoMatches = makeTestCollection("two-matches", ["alpha", "beta"]);

  const decision = chooseCollection("alpha and beta both appear here", { collections: [oneMatch, twoMatches] });
  assert.equal(decision.collection.id, "two-matches");
});

function makeTestCollection(id: string, keywords: readonly string[]): CollectionDefinition {
  return {
    id,
    name: id,
    description: "test collection for collection-director unit tests",
    visualIdentity: "test",
    colorPalette: { description: "test", swatches: ["test"] },
    typographyStyle: "test",
    assetPreferences: ["test"],
    designRules: ["test"],
    seoKeywords: ["test", "test2", "test3"],
    targetAudience: "test",
    suggestedPricing: "$10-20",
    crossSellRecommendations: [],
    preferredStyleIds: ["premium-streetwear"],
    keywords,
    minProducts: 10,
    maxProducts: 25,
  };
}
