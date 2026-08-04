import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { composeCollectionProduct } from "../../automation/ai/compose-collection-product.ts";
import { AssetLibrary } from "../../automation/ai/assets/asset-library.ts";
import { createSolidPng } from "../../automation/ai/png.ts";
import { Logger } from "../../automation/shared/logger.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { FileOperationError } from "../../automation/shared/errors.ts";
import { ok, type Result } from "../../automation/shared/result.ts";

class NoopTransport implements LogTransport {
  readonly name = "noop";
  write(): Result<void, FileOperationError> {
    return ok(undefined);
  }
}

function silentLogger(): Logger {
  return new Logger({ module: "test", transports: [new NoopTransport()] });
}

function withTempDir(fn: (dir: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "compose-collection-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** Stands in for artwork the user has already supplied and registered in the Asset Library. */
async function seedHeroAsset(library: AssetLibrary, category: string, style: string): Promise<void> {
  const png = createSolidPng(200, 200, { r: 20, g: 40, b: 90, a: 255 });
  const result = await library.save({
    category,
    variant: "seeded",
    style,
    colors: ["black"],
    compatibleShirtColors: ["black"],
    tags: [],
    sourcePrompt: "seeded test asset",
    provider: "test",
    model: "test",
    quality: { heuristicPassed: true, vision: null },
    perceptualHash: "0".repeat(64),
    pngBuffer: png,
    width: 200,
    height: 200,
  });
  assert.equal(result.ok, true);
}

test(
  "rejects a blank jobId or brief",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    const a = await composeCollectionProduct({ jobId: " ", brief: "a speaker stack" }, { assetLibrary: library, logger: silentLogger() });
    const b = await composeCollectionProduct({ jobId: "job-1", brief: "  " }, { assetLibrary: library, logger: silentLogger() });
    assert.equal(a.ok, false);
    assert.equal(b.ok, false);
  }),
);

test(
  "automatically picks a collection and derives the hero category from its asset preferences",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const result = await composeCollectionProduct(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack" },
      { assetLibrary: library, logger: silentLogger() },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.collectionDecision.collection.id, "vintage-jamaican-sound-systems");
    // vintage-jamaican-sound-systems' first assetPreference is "speaker_stack"
    assert.equal(result.value.heroAsset.metadata.category, "speaker_stack");
  }),
);

test(
  "restricts style selection to the chosen collection's preferred styles",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const result = await composeCollectionProduct(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack" },
      { assetLibrary: library, logger: silentLogger() },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const collection = result.value.collectionDecision.collection;
    assert.ok(collection.preferredStyleIds.includes(result.value.decision.style.id));
  }),
);

test(
  "an explicit collectionId bypasses the Collection Director",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    // tropical-lifestyle's first assetPreference is "palm_tree"
    await seedHeroAsset(library, "palm_tree", "luxury-minimal");

    const result = await composeCollectionProduct(
      { jobId: "job-1", brief: "a generic brief with no niche keywords at all", collectionId: "tropical-lifestyle" },
      { assetLibrary: library, logger: silentLogger() },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.collectionDecision.collection.id, "tropical-lifestyle");
    assert.equal(result.value.collectionDecision.usedFallback, false);
  }),
);

test(
  "an unknown explicit collectionId is rejected",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });

    const result = await composeCollectionProduct(
      { jobId: "job-1", brief: "a speaker stack", collectionId: "does-not-exist" },
      { assetLibrary: library, logger: silentLogger() },
    );

    assert.equal(result.ok, false);
  }),
);

test(
  "an explicit heroCategory overrides the collection's default asset preference",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "microphone", "vintage-jamaican-sound-system");

    const result = await composeCollectionProduct(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack", heroCategory: "microphone" },
      { assetLibrary: library, logger: silentLogger() },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.heroAsset.metadata.category, "microphone");
  }),
);
