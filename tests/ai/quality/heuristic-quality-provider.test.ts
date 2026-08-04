import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { HeuristicQualityProvider } from "../../../automation/ai/quality/heuristic-quality-provider.ts";
import { computeAverageHash } from "../../../automation/ai/quality/pixel-metrics.ts";

function buildRaw(
  width: number,
  height: number,
  painter: (x: number, y: number) => readonly [number, number, number, number],
): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = painter(x, y);
      const o = (y * width + x) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = a;
    }
  }
  return buf;
}

async function toPng(
  width: number,
  height: number,
  painter: (x: number, y: number) => readonly [number, number, number, number],
): Promise<Buffer> {
  const raw = buildRaw(width, height, painter);
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** A well-composed synthetic asset: centered, generous margin, checkered two-tone fill. */
function wellComposedPainter(
  width: number,
  height: number,
  blockSize: number,
): (x: number, y: number) => readonly [number, number, number, number] {
  const marginX = width * 0.2;
  const marginY = height * 0.25;
  return (x, y) => {
    if (x < marginX || x > width - marginX || y < marginY || y > height - marginY) {
      return [0, 0, 0, 0];
    }
    const block = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2;
    return block === 0 ? [20, 40, 90, 255] : [210, 170, 60, 255];
  };
}

test("a well-composed 4500x5400 asset passes every check", async () => {
  const png = await toPng(4500, 5400, wellComposedPainter(4500, 5400, 150));
  const provider = new HeuristicQualityProvider();
  const result = await provider.check(png, []);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.passed, true);
    assert.deepEqual(result.value.failedChecks, []);
  }
});

test("a uniform, edge-to-edge opaque image fails multiple checks at once", async () => {
  const png = await toPng(4500, 5400, () => [128, 40, 40, 255]);
  const provider = new HeuristicQualityProvider();
  const result = await provider.check(png, []);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.passed, false);
  for (const expected of ["touches_canvas_edge", "transparent_area_too_small", "subject_oversized", "low_contrast", "blurry"]) {
    assert.ok(result.value.failedChecks.includes(expected as never), `expected "${expected}" among ${result.value.failedChecks.join(",")}`);
  }
});

test("a fully transparent image fails as empty/tiny/flat", async () => {
  const png = await toPng(4500, 5400, () => [0, 0, 0, 0]);
  const provider = new HeuristicQualityProvider();
  const result = await provider.check(png, []);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.passed, false);
  for (const expected of ["transparent_area_too_large", "subject_too_tiny", "low_contrast", "blurry"]) {
    assert.ok(result.value.failedChecks.includes(expected as never));
  }
});

test("an otherwise well-composed image below the minimum canvas size fails only on resolution", async () => {
  const png = await toPng(450, 540, wellComposedPainter(450, 540, 15));
  const provider = new HeuristicQualityProvider();
  const result = await provider.check(png, []);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.failedChecks, ["low_resolution"]);
});

test("a square canvas fails the aspect ratio check", async () => {
  const png = await toPng(4500, 4500, wellComposedPainter(4500, 4500, 150));
  const provider = new HeuristicQualityProvider();
  const result = await provider.check(png, []);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.failedChecks.includes("invalid_aspect_ratio"));
});

test("content touching the left edge fails touches_canvas_edge only", async () => {
  const width = 4500;
  const height = 5400;
  const painter = (x: number, y: number): readonly [number, number, number, number] => {
    if (x < width * 0.2 || y < height * 0.25 || y > height - height * 0.25) {
      return [0, 0, 0, 0];
    }
    const block = (Math.floor(x / 150) + Math.floor(y / 150)) % 2;
    return block === 0 ? [20, 40, 90, 255] : [210, 170, 60, 255];
  };
  const png = await toPng(width, height, painter);
  const provider = new HeuristicQualityProvider();
  const result = await provider.check(png, []);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.failedChecks, ["touches_canvas_edge"]);
});

test("a near-duplicate of an existing library asset fails duplicate_design", async () => {
  const png = await toPng(4500, 5400, wellComposedPainter(4500, 5400, 150));
  const hash = await computeAverageHash(png);
  const provider = new HeuristicQualityProvider();
  const result = await provider.check(png, [{ id: "existing-asset-1", hash }]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.failedChecks, ["duplicate_design"]);
  assert.equal(result.value.metrics.duplicateOfAssetId, "existing-asset-1");
});

test("evaluate() wraps check() into a QualityVerdict with vision left unset", async () => {
  const png = await toPng(4500, 5400, wellComposedPainter(4500, 5400, 150));
  const provider = new HeuristicQualityProvider();
  const result = await provider.evaluate(png);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.approved, true);
  assert.equal(result.value.shouldRegenerate, false);
  assert.equal(result.value.vision, null);
  assert.equal(result.value.visionSkipReason, "not_eligible");
});

test("evaluate() reports shouldRegenerate when the heuristic check fails", async () => {
  const png = await toPng(4500, 5400, () => [0, 0, 0, 0]);
  const provider = new HeuristicQualityProvider();
  const result = await provider.evaluate(png);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.approved, false);
  assert.equal(result.value.shouldRegenerate, true);
});

test("custom thresholds are honored", async () => {
  const png = await toPng(1000, 1200, wellComposedPainter(1000, 1200, 30));
  const strict = new HeuristicQualityProvider({ thresholds: { minWidth: 4500, minHeight: 5400 } });
  const lenient = new HeuristicQualityProvider({ thresholds: { minWidth: 100, minHeight: 100 } });

  const strictResult = await strict.check(png, []);
  const lenientResult = await lenient.check(png, []);
  assert.equal(strictResult.ok && strictResult.value.failedChecks.includes("low_resolution"), true);
  assert.equal(lenientResult.ok && lenientResult.value.failedChecks.includes("low_resolution"), false);
});

test("check() reports a ValidationError for undecodable image data", async () => {
  const provider = new HeuristicQualityProvider();
  const result = await provider.check(Buffer.from("not an image"), []);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "VALIDATION_ERROR");
});
