import { test } from "node:test";
import assert from "node:assert/strict";
import { COLLECTION_LIBRARY, getCollectionById } from "../../../automation/ai/collections/library.ts";
import { STYLE_LIBRARY } from "../../../automation/ai/styles/library.ts";

test("has 15 collections as specified", () => {
  assert.equal(COLLECTION_LIBRARY.length, 15);
});

test("every collection id is unique", () => {
  const ids = COLLECTION_LIBRARY.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every collection has a fully populated field set", () => {
  for (const collection of COLLECTION_LIBRARY) {
    const context = `collection "${collection.id}"`;
    assert.ok(collection.name.trim().length > 0, `${context}: name`);
    assert.ok(collection.description.trim().length > 20, `${context}: description`);
    assert.ok(collection.visualIdentity.trim().length > 0, `${context}: visualIdentity`);
    assert.ok(collection.colorPalette.description.trim().length > 0, `${context}: colorPalette.description`);
    assert.ok(collection.colorPalette.swatches.length > 0, `${context}: colorPalette.swatches`);
    assert.ok(collection.typographyStyle.trim().length > 0, `${context}: typographyStyle`);
    assert.ok(collection.assetPreferences.length > 0, `${context}: assetPreferences`);
    assert.ok(collection.designRules.length > 0, `${context}: designRules`);
    assert.ok(collection.seoKeywords.length >= 3, `${context}: seoKeywords`);
    assert.ok(collection.targetAudience.trim().length > 0, `${context}: targetAudience`);
    assert.match(collection.suggestedPricing, /^\$\d+-\d+$/, `${context}: suggestedPricing`);
    assert.ok(collection.crossSellRecommendations.length > 0, `${context}: crossSellRecommendations`);
    assert.ok(collection.preferredStyleIds.length > 0, `${context}: preferredStyleIds`);
    assert.ok(collection.keywords.length > 0, `${context}: keywords`);
    assert.ok(collection.minProducts >= 10, `${context}: minProducts`);
    assert.ok(collection.maxProducts <= 25, `${context}: maxProducts`);
    assert.ok(collection.minProducts <= collection.maxProducts, `${context}: min<=max`);
  }
});

test("every preferredStyleIds entry resolves to a real style in the Style Library", () => {
  const styleIds = new Set(STYLE_LIBRARY.map((s) => s.id));
  for (const collection of COLLECTION_LIBRARY) {
    for (const styleId of collection.preferredStyleIds) {
      assert.ok(styleIds.has(styleId), `collection "${collection.id}" references unknown style "${styleId}"`);
    }
  }
});

test("every crossSellRecommendations entry resolves to a real collection id", () => {
  const ids = new Set(COLLECTION_LIBRARY.map((c) => c.id));
  for (const collection of COLLECTION_LIBRARY) {
    for (const crossSellId of collection.crossSellRecommendations) {
      assert.ok(ids.has(crossSellId), `collection "${collection.id}" references unknown collection "${crossSellId}"`);
    }
    assert.ok(!collection.crossSellRecommendations.includes(collection.id), `collection "${collection.id}" cross-sells itself`);
  }
});

test("commercial-safety: Reggae Legends Inspired forbids real-person likeness in its design rules", () => {
  const collection = getCollectionById("reggae-legends-inspired");
  assert.ok(collection);
  assert.ok(collection?.designRules.some((rule) => /real, identifiable person/i.test(rule)));
});

test("commercial-safety: Caribbean Flags forbids reproducing an actual government flag", () => {
  const collection = getCollectionById("caribbean-flags");
  assert.ok(collection);
  assert.ok(collection?.designRules.some((rule) => /government flag/i.test(rule)));
});

test("getCollectionById finds a known collection and returns undefined for an unknown one", () => {
  assert.equal(getCollectionById("dancehall-kings")?.name, "Dancehall Kings");
  assert.equal(getCollectionById("does-not-exist"), undefined);
});
