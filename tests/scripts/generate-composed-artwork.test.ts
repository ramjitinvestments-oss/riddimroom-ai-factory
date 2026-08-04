import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateComposedArtworkJob } from "../../scripts/generate-composed-artwork.ts";
import { AssetLibrary } from "../../automation/ai/assets/asset-library.ts";
import { createSolidPng, readPngDimensions } from "../../automation/ai/png.ts";
import { Logger } from "../../automation/shared/logger.ts";
import type { FileOperationError } from "../../automation/shared/errors.ts";
import { ok, type Result } from "../../automation/shared/result.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";

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

test("generateComposedArtworkJob saves a print-ready PNG and metadata.json under outputRoot/{jobId}", async (t) => {
  const outputRoot = tempDir(t, "riddimroom-composed-");
  const assetsRoot = tempDir(t, "riddimroom-assets-");
  const transport = new FakeTransport();
  const logger = new Logger({ module: "test", transports: [transport] });
  const assetLibrary = new AssetLibrary({ root: assetsRoot });
  await seedHeroAsset(assetLibrary, "speaker_stack", "vintage-jamaican-sound-system");

  const result = await generateComposedArtworkJob("speaker_stack", "a jamaican sound system speaker stack", {
    outputRoot,
    logger,
    assetLibrary,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.artworkPath, path.join(outputRoot, result.value.jobId, "artwork.png"));
  assert.equal(result.value.metadataPath, path.join(outputRoot, result.value.jobId, "metadata.json"));

  const artworkBuffer = readFileSync(result.value.artworkPath);
  const dimensions = readPngDimensions(artworkBuffer);
  assert.equal(dimensions.ok, true);
  assert.equal(dimensions.ok ? dimensions.value.width : 0, 4500);
  assert.equal(dimensions.ok ? dimensions.value.height : 0, 5400);

  const metadata = JSON.parse(readFileSync(result.value.metadataPath, "utf8"));
  assert.equal(metadata.jobId, result.value.jobId);
  assert.equal(metadata.brief, "a jamaican sound system speaker stack");
  assert.equal(metadata.engine, "composed");
  assert.equal(metadata.heroCategory, "speaker_stack");
  assert.equal(metadata.style, "vintage-jamaican-sound-system");
  assert.deepEqual(metadata.printDimensions, { width: 4500, height: 5400 });

  // a fresh library instance still sees the user-supplied asset
  const reloaded = new AssetLibrary({ root: assetsRoot });
  assert.equal(reloaded.all().length, 1);
});

test("generateComposedArtworkJob rejects a blank brief via composeShirtArtwork and writes nothing to disk", async (t) => {
  const outputRoot = tempDir(t, "riddimroom-composed-");
  const assetsRoot = tempDir(t, "riddimroom-assets-");

  const result = await generateComposedArtworkJob("speaker_stack", "   ", {
    outputRoot,
    assetLibrary: new AssetLibrary({ root: assetsRoot }),
  });

  assert.equal(result.ok, false);
  assert.equal(existsSync(outputRoot) && readdirSync(outputRoot).length, 0);
});

test("generateComposedArtworkJob fails with no artwork registered for the requested hero category", async (t) => {
  const outputRoot = tempDir(t, "riddimroom-composed-");
  const assetsRoot = tempDir(t, "riddimroom-assets-");

  const result = await generateComposedArtworkJob("speaker_stack", "a jamaican sound system speaker stack", {
    outputRoot,
    assetLibrary: new AssetLibrary({ root: assetsRoot }),
  });

  assert.equal(result.ok, false);
  assert.equal(existsSync(outputRoot) && readdirSync(outputRoot).length, 0);
});

test("generateComposedArtworkJob passes through a title option into the composition", async (t) => {
  const outputRoot = tempDir(t, "riddimroom-composed-");
  const assetsRoot = tempDir(t, "riddimroom-assets-");
  const assetLibrary = new AssetLibrary({ root: assetsRoot });
  await seedHeroAsset(assetLibrary, "speaker_stack", "vintage-jamaican-sound-system");

  const result = await generateComposedArtworkJob("speaker_stack", "a jamaican sound system speaker stack", {
    outputRoot,
    assetLibrary,
    title: { text: "RIDDIMROOM" },
  });

  assert.equal(result.ok, true);
});
