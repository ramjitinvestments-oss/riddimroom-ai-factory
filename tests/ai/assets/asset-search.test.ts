import { test } from "node:test";
import assert from "node:assert/strict";
import { findBestAsset, searchAssets } from "../../../automation/ai/assets/asset-search.ts";
import type { AssetRecord } from "../../../automation/ai/assets/types.ts";

function record(overrides: Partial<AssetRecord["metadata"]> & { id: string }): AssetRecord {
  const { id, ...metadataOverrides } = overrides;
  return {
    id,
    pngPath: `${id}/artwork.png`,
    previewPath: `${id}/preview.jpg`,
    promptPath: `${id}/prompt.txt`,
    metadataPath: `${id}/metadata.json`,
    metadata: {
      category: "speaker_stack",
      variant: "vintage",
      style: "vintage-jamaican-sound-system",
      colors: ["black", "gold"],
      compatibleShirtColors: ["black", "white"],
      tags: ["dancehall", "jamaica", "reggae"],
      sourcePrompt: "test",
      provider: "openai",
      model: "gpt-image-1",
      quality: { heuristicPassed: true, vision: null },
      perceptualHash: "0".repeat(64),
      createdAt: "2026-08-01T00:00:00.000Z",
      version: 1,
      width: 4500,
      height: 5400,
      ...metadataOverrides,
    },
  };
}

test("filters by category as a hard constraint", () => {
  const records = [record({ id: "a", category: "speaker_stack" }), record({ id: "b", category: "microphone" })];
  const results = searchAssets(records, { category: "microphone" });
  assert.deepEqual(results.map((r) => r.id), ["b"]);
});

test("filters by compatibleShirtColor as a hard constraint", () => {
  const records = [
    record({ id: "a", compatibleShirtColors: ["black"] }),
    record({ id: "b", compatibleShirtColors: ["white", "sand"] }),
  ];
  const results = searchAssets(records, { compatibleShirtColor: "sand" });
  assert.deepEqual(results.map((r) => r.id), ["b"]);
});

test("ranks by tag overlap when tags are given (soft scoring, not a hard filter)", () => {
  const records = [
    record({ id: "low-match", tags: ["dancehall"] }),
    record({ id: "high-match", tags: ["dancehall", "jamaica", "reggae", "dub"] }),
    record({ id: "no-match", tags: ["luxury", "minimal"] }),
  ];
  const results = searchAssets(records, { tags: ["dancehall", "jamaica", "reggae"] });
  // all three still appear (tags is soft, not a hard filter) but ordered best-match-first
  assert.equal(results[0]?.id, "high-match");
  assert.equal(results[1]?.id, "low-match");
  assert.equal(results[2]?.id, "no-match");
});

test("style match contributes to ranking", () => {
  const records = [
    record({ id: "wrong-style", style: "luxury-minimal" }),
    record({ id: "right-style", style: "vintage-jamaican-sound-system" }),
  ];
  const results = searchAssets(records, { style: "vintage-jamaican-sound-system" });
  assert.equal(results[0]?.id, "right-style");
});

test("ties are broken by newest version first", () => {
  const records = [record({ id: "old", version: 1 }), record({ id: "new", version: 3 }), record({ id: "mid", version: 2 })];
  const results = searchAssets(records, {});
  assert.deepEqual(results.map((r) => r.id), ["new", "mid", "old"]);
});

test("findBestAsset returns the top match or null", () => {
  const records = [record({ id: "only-one", category: "microphone" })];
  assert.equal(findBestAsset(records, { category: "microphone" })?.id, "only-one");
  assert.equal(findBestAsset(records, { category: "does-not-exist" }), null);
});

test("an empty query with no records returns an empty array, not an error", () => {
  assert.deepEqual(searchAssets([], {}), []);
});
