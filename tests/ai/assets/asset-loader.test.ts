import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverAssets, listCategories, listVariants } from "../../../automation/ai/assets/asset-loader.ts";
import { saveAsset } from "../../../automation/ai/assets/asset-store.ts";
import { createSolidPng } from "../../../automation/ai/png.ts";

const SAMPLE_PNG = createSolidPng(50, 50, { r: 10, g: 10, b: 10, a: 255 });

function baseInput(category: string, variant: string, tags: readonly string[] = []) {
  return {
    category,
    variant,
    style: "premium-streetwear",
    colors: ["black"],
    compatibleShirtColors: ["black"],
    tags,
    sourcePrompt: "test prompt",
    provider: "openai",
    model: "gpt-image-1",
    quality: { heuristicPassed: true, vision: null },
    perceptualHash: "0".repeat(64),
    pngBuffer: SAMPLE_PNG,
    width: 50,
    height: 50,
  };
}

function withTempDir(fn: (dir: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "asset-loader-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test(
  "discoverAssets returns an empty array when the root doesn't exist",
  withTempDir((dir) => {
    assert.deepEqual(discoverAssets(path.join(dir, "does-not-exist")), []);
  }),
);

test(
  "discoverAssets finds assets across categories, variants, and versions without any hardcoded list",
  withTempDir(async (dir) => {
    await saveAsset(baseInput("speaker_stack", "vintage"), { root: dir });
    await saveAsset(baseInput("speaker_stack", "vintage"), { root: dir }); // v2
    await saveAsset(baseInput("microphone", "gold"), { root: dir });
    await saveAsset(baseInput("brand_new_category_nobody_hardcoded", "some_variant"), { root: dir });

    const records = discoverAssets(dir);
    assert.equal(records.length, 4);
    const ids = records.map((r) => r.id).sort();
    assert.deepEqual(ids, [
      "brand_new_category_nobody_hardcoded/some_variant/v1",
      "microphone/gold/v1",
      "speaker_stack/vintage/v1",
      "speaker_stack/vintage/v2",
    ]);
  }),
);

test(
  "listCategories and listVariants derive from loaded records",
  withTempDir(async (dir) => {
    await saveAsset(baseInput("speaker_stack", "vintage"), { root: dir });
    await saveAsset(baseInput("speaker_stack", "modern"), { root: dir });
    await saveAsset(baseInput("microphone", "gold"), { root: dir });

    const records = discoverAssets(dir);
    assert.deepEqual(listCategories(records), ["microphone", "speaker_stack"]);
    assert.deepEqual(listVariants(records, "speaker_stack"), ["modern", "vintage"]);
  }),
);

test(
  "a version directory with malformed metadata.json is skipped rather than crashing discovery",
  withTempDir(async (dir) => {
    await saveAsset(baseInput("speaker_stack", "vintage"), { root: dir });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(dir, "speaker_stack", "vintage", "v1", "metadata.json"), "{not valid json");

    assert.deepEqual(discoverAssets(dir), []);
  }),
);
