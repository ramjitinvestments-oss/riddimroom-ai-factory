import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateCollectionProductJob } from "../../scripts/generate-collection-product.ts";
import { AssetLibrary } from "../../automation/ai/assets/asset-library.ts";
import { createSolidPng, readPngDimensions } from "../../automation/ai/png.ts";
import { Logger } from "../../automation/shared/logger.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";
import type { FileOperationError } from "../../automation/shared/errors.ts";
import { ok, type Result } from "../../automation/shared/result.ts";

class FakeTransport implements LogTransport {
  readonly name = "fake";
  readonly entries: LogEntry[] = [];
  write(entry: LogEntry): Result<void, FileOperationError> {
    this.entries.push(entry);
    return ok(undefined);
  }
}

function tempDir(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
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

test("generateCollectionProductJob saves artwork + metadata with collection info under outputRoot/{jobId}", async (t) => {
  const outputRoot = tempDir(t, "riddimroom-collection-");
  const assetsRoot = tempDir(t, "riddimroom-assets-");
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });
  const assetLibrary = new AssetLibrary({ root: assetsRoot });
  await seedHeroAsset(assetLibrary, "speaker_stack", "vintage-jamaican-sound-system");

  const result = await generateCollectionProductJob("a jamaican sound system speaker stack", {
    outputRoot,
    logger,
    assetLibrary,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const artworkBuffer = readFileSync(result.value.artworkPath);
  const dimensions = readPngDimensions(artworkBuffer);
  assert.equal(dimensions.ok, true);
  assert.equal(dimensions.ok ? dimensions.value.width : 0, 4500);
  assert.equal(dimensions.ok ? dimensions.value.height : 0, 5400);

  const metadata = JSON.parse(readFileSync(result.value.metadataPath, "utf8"));
  assert.equal(metadata.engine, "collection");
  assert.equal(metadata.collectionId, "vintage-jamaican-sound-systems");
  assert.equal(metadata.collectionName, "Vintage Jamaican Sound Systems");
  assert.ok(Array.isArray(metadata.seoKeywords) && metadata.seoKeywords.length > 0);
  assert.match(metadata.collectionSuggestedPricingRange, /^\$\d+-\d+$/);
  assert.equal(metadata.retailPrice, 24.99);
});

test("generateCollectionProductJob honors an explicit collectionId", async (t) => {
  const outputRoot = tempDir(t, "riddimroom-collection-");
  const assetsRoot = tempDir(t, "riddimroom-assets-");
  const assetLibrary = new AssetLibrary({ root: assetsRoot });
  // tropical-lifestyle's first assetPreference is "palm_tree"
  await seedHeroAsset(assetLibrary, "palm_tree", "luxury-minimal");

  const result = await generateCollectionProductJob("a shirt", {
    outputRoot,
    collectionId: "tropical-lifestyle",
    assetLibrary,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const metadata = JSON.parse(readFileSync(result.value.metadataPath, "utf8"));
  assert.equal(metadata.collectionId, "tropical-lifestyle");
});

test("generateCollectionProductJob rejects a blank brief and writes nothing to disk", async (t) => {
  const outputRoot = tempDir(t, "riddimroom-collection-");
  const assetsRoot = tempDir(t, "riddimroom-assets-");

  const result = await generateCollectionProductJob("   ", {
    outputRoot,
    assetLibrary: new AssetLibrary({ root: assetsRoot }),
  });

  assert.equal(result.ok, false);
  assert.equal(existsSync(outputRoot) && readdirSync(outputRoot).length, 0);
});
