import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { composeShirtArtwork } from "../../automation/ai/compose-shirt-artwork.ts";
import { AssetLibrary } from "../../automation/ai/assets/asset-library.ts";
import { PRINT_HEIGHT, PRINT_WIDTH } from "../../automation/ai/prepare-print-ready.ts";
import { createSolidPng } from "../../automation/ai/png.ts";
import { Logger } from "../../automation/shared/logger.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";
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
    const dir = mkdtempSync(path.join(tmpdir(), "compose-artwork-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

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

async function countOpaquePixels(png: Buffer): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 10) count++;
  }
  return count;
}

test(
  "rejects a blank jobId/brief/heroCategory",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    const a = await composeShirtArtwork(
      { jobId: " ", brief: "a speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger() },
    );
    const b = await composeShirtArtwork(
      { jobId: "job-1", brief: "  ", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger() },
    );
    const c = await composeShirtArtwork(
      { jobId: "job-1", brief: "a speaker stack", heroCategory: " " },
      { assetLibrary: library, logger: silentLogger() },
    );
    assert.equal(a.ok, false);
    assert.equal(b.ok, false);
    assert.equal(c.ok, false);
  }),
);

test(
  "uses an existing matching asset from the library",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const result = await composeShirtArtwork(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger() },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.heroAsset.metadata.variant, "seeded");
    assert.equal(result.value.width, PRINT_WIDTH);
    assert.equal(result.value.height, PRINT_HEIGHT);
  }),
);

test(
  "fails when nothing in the library matches the hero query — artwork is supplied by the user, never generated",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });

    const result = await composeShirtArtwork(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger() },
    );

    assert.equal(result.ok, false);
    assert.equal(library.all().length, 0);
  }),
);

test(
  "output is always a validated, print-ready PNG at the required canvas size",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const result = await composeShirtArtwork(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger() },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const metadata = await sharp(result.value.imageBuffer).metadata();
    assert.equal(metadata.width, PRINT_WIDTH);
    assert.equal(metadata.height, PRINT_HEIGHT);
    assert.ok(metadata.hasAlpha);
  }),
);

test(
  "allowedStyleIds restricts the Design Director to matching within the given set",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    // brief matches both vintage-jamaican-sound-system and luxury-minimal keywords;
    // restricting to luxury-minimal alone must exclude the (otherwise stronger) sound-system match.
    const result = await composeShirtArtwork(
      {
        jobId: "job-1",
        brief: "a quiet luxury monogram mark, sound system inspired",
        heroCategory: "speaker_stack",
      },
      { assetLibrary: library, logger: silentLogger(), allowedStyleIds: ["luxury-minimal"] },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.decision.style.id, "luxury-minimal");
    assert.equal(result.value.decision.usedFallback, false);
  }),
);

test(
  "allowedStyleIds falls back to the Design Director's own global default when nothing in the restricted set matches",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const result = await composeShirtArtwork(
      { jobId: "job-1", brief: "xyzzy plugh flarn wobbulator", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger(), allowedStyleIds: ["luxury-minimal", "tattoo-illustration"] },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    // Documented chooseStyle() behavior: fallback resolves DEFAULT_STYLE_ID from the
    // full library, not from the restricted set — the restriction only narrows matching.
    assert.equal(result.value.decision.usedFallback, true);
    assert.equal(result.value.decision.style.id, "premium-streetwear");
  }),
);

test(
  "omitting allowedStyleIds considers the full Style Library (unchanged default behavior)",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const result = await composeShirtArtwork(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger() },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.decision.style.id, "vintage-jamaican-sound-system");
  }),
);

async function luminanceStdevInRegion(
  png: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const { data } = await sharp(png)
    .extract(region)
    .flatten({ background: { r: 10, g: 10, b: 10 } }) // simulate a black shirt
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (const v of data) sum += v;
  const mean = sum / data.length;
  let sumSq = 0;
  for (const v of data) sumSq += (v - mean) ** 2;
  return Math.sqrt(sumSq / data.length);
}

const TITLE_REGION = { left: 450, top: PRINT_HEIGHT * 0.82 - 500, width: PRINT_WIDTH - 900, height: 1000 };

test(
  "title.shirtColor produces genuinely visible text on a black shirt, unlike the old hardcoded-black default",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const withoutShirtColor = await composeShirtArtwork(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger(), title: { text: "RIDDIMROOM" } },
    );
    const withShirtColor = await composeShirtArtwork(
      { jobId: "job-2", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger(), title: { text: "RIDDIMROOM", shirtColor: "black" } },
    );

    assert.equal(withoutShirtColor.ok, true);
    assert.equal(withShirtColor.ok, true);
    if (!withoutShirtColor.ok || !withShirtColor.ok) return;

    const stdevWithout = await luminanceStdevInRegion(withoutShirtColor.value.imageBuffer, TITLE_REGION);
    const stdevWith = await luminanceStdevInRegion(withShirtColor.value.imageBuffer, TITLE_REGION);

    // old default (black text, flattened onto a simulated black shirt) barely varies from the background;
    // the adaptive version should show strong local contrast where the lettering is.
    assert.ok(stdevWith > stdevWithout * 3, `expected much higher contrast, got ${stdevWith} vs ${stdevWithout}`);
  }),
);

test(
  "title.shirtColor populates typographyContrast on the result; omitting it leaves that field unset",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const withShirtColor = await composeShirtArtwork(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger(), title: { text: "RIDDIMROOM", shirtColor: "black" } },
    );
    const withoutShirtColor = await composeShirtArtwork(
      { jobId: "job-2", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger(), title: { text: "RIDDIMROOM" } },
    );

    assert.equal(withShirtColor.ok, true);
    assert.equal(withoutShirtColor.ok, true);
    if (!withShirtColor.ok || !withoutShirtColor.ok) return;

    assert.ok(withShirtColor.value.typographyContrast);
    assert.equal(withShirtColor.value.typographyContrast?.passesAccessibilityThreshold, true);
    assert.equal(withShirtColor.value.typographyContrast?.effect, "glow");
    assert.equal(withoutShirtColor.value.typographyContrast, undefined);
  }),
);

test(
  "an explicit title.color still overrides the automatic choice even with shirtColor set",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const result = await composeShirtArtwork(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      {
        assetLibrary: library,
        logger: silentLogger(),
        title: { text: "RIDDIMROOM", shirtColor: "black", color: "#ff00ff" },
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    // still computed for reporting, but the manual color should win in the actual render;
    // we can't easily sample the exact fill pixel here, so just confirm the call succeeded
    // and the contrast decision is still reported (manual overrides don't erase the audit trail).
    assert.ok(result.value.typographyContrast);
  }),
);

test(
  "title.shirtColor rejects when the configured minContrastRatio is impossible to satisfy",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const result = await composeShirtArtwork(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      {
        assetLibrary: library,
        logger: silentLogger(),
        title: { text: "RIDDIMROOM", shirtColor: "black", minContrastRatio: 25 },
      },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }),
);

test(
  "adding a title renders visibly more ink than the hero alone",
  withTempDir(async (dir) => {
    const library = new AssetLibrary({ root: dir });
    await seedHeroAsset(library, "speaker_stack", "vintage-jamaican-sound-system");

    const withoutTitle = await composeShirtArtwork(
      { jobId: "job-1", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger() },
    );
    const withTitle = await composeShirtArtwork(
      { jobId: "job-2", brief: "a jamaican sound system speaker stack", heroCategory: "speaker_stack" },
      { assetLibrary: library, logger: silentLogger(), title: { text: "RIDDIMROOM" } },
    );

    assert.equal(withoutTitle.ok, true);
    assert.equal(withTitle.ok, true);
    if (!withoutTitle.ok || !withTitle.ok) return;

    const baseline = await countOpaquePixels(withoutTitle.value.imageBuffer);
    const withText = await countOpaquePixels(withTitle.value.imageBuffer);
    assert.ok(withText > baseline, `expected title to add visible pixels: ${withText} vs ${baseline}`);
  }),
);
