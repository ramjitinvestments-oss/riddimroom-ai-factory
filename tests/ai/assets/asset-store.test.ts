import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { nextVersion, saveAsset } from "../../../automation/ai/assets/asset-store.ts";
import { createSolidPng } from "../../../automation/ai/png.ts";

function withTempDir(fn: (dir: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "asset-store-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const SAMPLE_PNG = createSolidPng(100, 100, { r: 20, g: 40, b: 90, a: 255 });

function sampleInput(overrides: Partial<Parameters<typeof saveAsset>[0]> = {}) {
  return {
    category: "speaker_stack",
    variant: "vintage_sound_system",
    style: "vintage-jamaican-sound-system",
    colors: ["black", "gold"],
    compatibleShirtColors: ["black", "white", "sand"],
    tags: ["dancehall", "jamaica", "reggae", "dub", "sound system"],
    sourcePrompt: "a vintage sound system speaker stack",
    provider: "openai",
    model: "gpt-image-1",
    quality: { heuristicPassed: true, vision: null },
    perceptualHash: "1".repeat(64),
    pngBuffer: SAMPLE_PNG,
    width: 100,
    height: 100,
    ...overrides,
  };
}

test(
  "nextVersion returns 1 for a variant that has never been saved",
  withTempDir((dir) => {
    assert.equal(nextVersion(path.join(dir, "speaker_stack", "vintage")), 1);
  }),
);

test(
  "nextVersion returns max+1 given existing version directories",
  withTempDir((dir) => {
    const variantDir = path.join(dir, "speaker_stack", "vintage");
    mkdirSync(path.join(variantDir, "v1"), { recursive: true });
    mkdirSync(path.join(variantDir, "v2"), { recursive: true });
    assert.equal(nextVersion(variantDir), 3);
  }),
);

test(
  "saveAsset writes all four files at the expected versioned path",
  withTempDir(async (dir) => {
    const result = await saveAsset(sampleInput(), { root: dir });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.id, "speaker_stack/vintage_sound_system/v1");
    assert.ok(existsSync(result.value.pngPath));
    assert.ok(existsSync(result.value.previewPath));
    assert.ok(existsSync(result.value.promptPath));
    assert.ok(existsSync(result.value.metadataPath));

    const metadata = JSON.parse(readFileSync(result.value.metadataPath, "utf8"));
    assert.equal(metadata.category, "speaker_stack");
    assert.equal(metadata.variant, "vintage_sound_system");
    assert.equal(metadata.version, 1);
    assert.equal(metadata.style, "vintage-jamaican-sound-system");
    assert.deepEqual(metadata.tags, ["dancehall", "jamaica", "reggae", "dub", "sound system"]);
    assert.equal(typeof metadata.createdAt, "string");

    const prompt = readFileSync(result.value.promptPath, "utf8");
    assert.equal(prompt, "a vintage sound system speaker stack");

    // preview.jpg should start with the JPEG magic bytes
    const preview = readFileSync(result.value.previewPath);
    assert.equal(preview[0], 0xff);
    assert.equal(preview[1], 0xd8);
  }),
);

test(
  "saveAsset increments the version on a second save of the same category/variant",
  withTempDir(async (dir) => {
    const first = await saveAsset(sampleInput(), { root: dir });
    const second = await saveAsset(sampleInput(), { root: dir });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.value.metadata.version, 1);
    assert.equal(second.value.metadata.version, 2);
    assert.equal(second.value.id, "speaker_stack/vintage_sound_system/v2");
  }),
);

test(
  "different variants under the same category version independently",
  withTempDir(async (dir) => {
    const a = await saveAsset(sampleInput({ variant: "vintage_sound_system" }), { root: dir });
    const b = await saveAsset(sampleInput({ variant: "modern_festival_stack" }), { root: dir });
    assert.equal(a.ok && a.value.metadata.version, 1);
    assert.equal(b.ok && b.value.metadata.version, 1);
  }),
);
