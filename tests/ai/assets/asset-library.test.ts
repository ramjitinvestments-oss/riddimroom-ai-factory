import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AssetLibrary } from "../../../automation/ai/assets/asset-library.ts";
import { createSolidPng } from "../../../automation/ai/png.ts";

const SAMPLE_PNG = createSolidPng(50, 50, { r: 10, g: 10, b: 10, a: 255 });

function withTempDir(fn: (dir: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "asset-library-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function input(category: string, variant: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    category,
    variant,
    style: "vintage-jamaican-sound-system",
    colors: ["black", "gold"],
    compatibleShirtColors: ["black", "white"],
    tags: ["dancehall", "jamaica"],
    sourcePrompt: "test prompt",
    provider: "openai",
    model: "gpt-image-1",
    quality: { heuristicPassed: true, vision: null },
    perceptualHash: "0".repeat(64),
    pngBuffer: SAMPLE_PNG,
    width: 50,
    height: 50,
    ...overrides,
  };
}

test(
  "an empty library reports no categories and finds nothing",
  withTempDir((dir) => {
    const library = new AssetLibrary({ root: dir });
    assert.deepEqual(library.categories(), []);
    assert.equal(library.findBest({ category: "speaker_stack" }), null);
  }),
);

test(
  "save() makes an asset immediately visible without a manual reload",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    const result = await library.save(input("speaker_stack", "vintage"));
    assert.equal(result.ok, true);

    assert.deepEqual(library.categories(), ["speaker_stack"]);
    assert.equal(library.findBest({ category: "speaker_stack" })?.metadata.variant, "vintage");
  }),
);

test(
  "hashes() exposes perceptual hashes for Stage 1 duplicate detection",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await library.save(input("speaker_stack", "vintage", { perceptualHash: "1".repeat(64) }));
    await library.save(input("microphone", "gold", { perceptualHash: "f".repeat(64) }));

    const hashes = library.hashes();
    assert.equal(hashes.length, 2);
    assert.ok(hashes.some((h) => h.hash === "1".repeat(64)));
    assert.ok(hashes.some((h) => h.hash === "f".repeat(64)));
  }),
);

test(
  "a library constructed after assets already exist on disk discovers them",
  withTempDir(async (dir) => {
    const first = new AssetLibrary({ root: dir });
    await first.save(input("speaker_stack", "vintage"));

    const second = new AssetLibrary({ root: dir });
    assert.equal(second.all().length, 1);
  }),
);

test(
  "reload() picks up assets written by another process/instance",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    assert.equal(library.all().length, 0);

    const other = new AssetLibrary({ root: dir });
    await other.save(input("speaker_stack", "vintage"));

    assert.equal(library.all().length, 0); // stale until reload
    library.reload();
    assert.equal(library.all().length, 1);
  }),
);
