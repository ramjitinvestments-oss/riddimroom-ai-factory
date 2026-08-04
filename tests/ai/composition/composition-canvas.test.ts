import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { CompositionCanvas, type AssetResolver } from "../../../automation/ai/composition/composition-canvas.ts";
import { createSolidPng } from "../../../automation/ai/png.ts";
import type { AssetRecord } from "../../../automation/ai/assets/types.ts";
import type { AssetSearchQuery } from "../../../automation/ai/assets/asset-search.ts";

function withTempDir(fn: (dir: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "composition-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function writeTestAsset(dir: string, name: string, width: number, height: number, color: { r: number; g: number; b: number }): AssetRecord {
  const pngPath = path.join(dir, `${name}.png`);
  writeFileSync(pngPath, createSolidPng(width, height, { ...color, a: 255 }));
  return {
    id: name,
    pngPath,
    previewPath: pngPath,
    promptPath: pngPath,
    metadataPath: pngPath,
    metadata: {
      category: name,
      variant: "default",
      style: "premium-streetwear",
      colors: [],
      compatibleShirtColors: ["black"],
      tags: [],
      sourcePrompt: "test",
      provider: "test",
      model: "test",
      quality: { heuristicPassed: true, vision: null },
      perceptualHash: "0".repeat(64),
      createdAt: new Date().toISOString(),
      version: 1,
      width,
      height,
    },
  };
}

function fakeResolver(records: Record<string, AssetRecord>): AssetResolver {
  return {
    findBest(query: AssetSearchQuery): AssetRecord | null {
      return query.category !== undefined ? (records[query.category] ?? null) : null;
    },
  };
}

async function pixelAt(png: Buffer, x: number, y: number): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * 4;
  return { r: data[offset] ?? 0, g: data[offset + 1] ?? 0, b: data[offset + 2] ?? 0, a: data[offset + 3] ?? 0 };
}

test("addLayer returns this for chaining and layerCount tracks additions", () => {
  const canvas = new CompositionCanvas(100, 100);
  const result = canvas.addLayer({ kind: "asset", role: "hero", query: { category: "x" }, xPx: 0, yPx: 0 });
  assert.equal(result, canvas);
  assert.equal(canvas.layerCount(), 1);
});

test(
  "places a resolved asset at the requested position on an otherwise transparent canvas",
  withTempDir(async (dir) => {
    const speaker = writeTestAsset(dir, "speaker_stack", 50, 50, { r: 200, g: 20, b: 20 });
    const resolver = fakeResolver({ speaker_stack: speaker });

    const canvas = new CompositionCanvas(200, 200);
    canvas.addLayer({ kind: "asset", role: "hero", query: { category: "speaker_stack" }, xPx: 20, yPx: 30 });

    const result = await canvas.render(resolver);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const inside = await pixelAt(result.value, 30, 40); // within the 50x50 placed square
    assert.equal(inside.r, 200);
    assert.equal(inside.g, 20);
    assert.equal(inside.b, 20);
    assert.equal(inside.a, 255);

    const outside = await pixelAt(result.value, 5, 5); // untouched, should stay transparent
    assert.equal(outside.a, 0);
  }),
);

test(
  "later-added layers composite on top of earlier ones at overlapping positions",
  withTempDir(async (dir) => {
    const bottom = writeTestAsset(dir, "bottom", 60, 60, { r: 255, g: 0, b: 0 });
    const top = writeTestAsset(dir, "top", 60, 60, { r: 0, g: 0, b: 255 });
    const resolver = fakeResolver({ bottom, top });

    const canvas = new CompositionCanvas(200, 200);
    canvas.addLayer({ kind: "asset", role: "background", query: { category: "bottom" }, xPx: 10, yPx: 10 });
    canvas.addLayer({ kind: "asset", role: "hero", query: { category: "top" }, xPx: 10, yPx: 10 });

    const result = await canvas.render(resolver);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const pixel = await pixelAt(result.value, 30, 30);
    assert.equal(pixel.b, 255);
    assert.equal(pixel.r, 0);
  }),
);

test(
  "widthPx/heightPx resizes the asset before placement",
  withTempDir(async (dir) => {
    const speaker = writeTestAsset(dir, "speaker_stack", 100, 100, { r: 10, g: 10, b: 10 });
    const resolver = fakeResolver({ speaker_stack: speaker });

    const canvas = new CompositionCanvas(200, 200);
    canvas.addLayer({
      kind: "asset",
      role: "hero",
      query: { category: "speaker_stack" },
      xPx: 0,
      yPx: 0,
      widthPx: 20,
      heightPx: 20,
    });

    const result = await canvas.render(resolver);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // still opaque well inside the shrunk 20x20 area
    const inside = await pixelAt(result.value, 10, 10);
    assert.equal(inside.a, 255);
    // outside the shrunk area (would have been opaque at 100x100, not at 20x20)
    const outside = await pixelAt(result.value, 50, 50);
    assert.equal(outside.a, 0);
  }),
);

test(
  "opacity scales down the composited alpha channel",
  withTempDir(async (dir) => {
    const speaker = writeTestAsset(dir, "speaker_stack", 40, 40, { r: 100, g: 100, b: 100 });
    const resolver = fakeResolver({ speaker_stack: speaker });

    const canvas = new CompositionCanvas(100, 100);
    canvas.addLayer({ kind: "asset", role: "texture-overlay", query: { category: "speaker_stack" }, xPx: 10, yPx: 10, opacity: 0.5 });

    const result = await canvas.render(resolver);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const pixel = await pixelAt(result.value, 20, 20);
    assert.ok(pixel.a > 100 && pixel.a < 150, `expected roughly half alpha, got ${pixel.a}`);
  }),
);

test("render() fails when a queried asset role has no match in the library", async () => {
  const resolver = fakeResolver({});
  const canvas = new CompositionCanvas(100, 100);
  canvas.addLayer({ kind: "asset", role: "hero", query: { category: "does_not_exist" }, xPx: 0, yPx: 0 });

  const result = await canvas.render(resolver);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
    assert.match(result.error.message, /does_not_exist/);
  }
});

test("render() composites a text layer with visible glyph pixels", async () => {
  const resolver = fakeResolver({});
  const canvas = new CompositionCanvas(1000, 400);
  canvas.addLayer({
    kind: "text",
    role: "text",
    text: { text: "RIDDIMROOM", xPx: 500, yPx: 220, fontSizePx: 120 },
  });

  const result = await canvas.render(resolver);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const { data } = await sharp(result.value).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 10) opaque++;
  }
  assert.ok(opaque > 0, "expected visible text pixels in the rendered composition");
});

test("render() propagates a text-layer validation failure (e.g. blank text)", async () => {
  const resolver = fakeResolver({});
  const canvas = new CompositionCanvas(500, 500);
  canvas.addLayer({ kind: "text", role: "text", text: { text: "   ", xPx: 250, yPx: 250 } });

  const result = await canvas.render(resolver);
  assert.equal(result.ok, false);
});

test("render() on an empty composition produces a fully transparent canvas of the requested size", async () => {
  const resolver = fakeResolver({});
  const canvas = new CompositionCanvas(120, 80);
  const result = await canvas.render(resolver);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const metadata = await sharp(result.value).metadata();
  assert.equal(metadata.width, 120);
  assert.equal(metadata.height, 80);
  const pixel = await pixelAt(result.value, 60, 40);
  assert.equal(pixel.a, 0);
});
