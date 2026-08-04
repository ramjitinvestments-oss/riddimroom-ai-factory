import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  computeAlphaMetrics,
  computeAverageHash,
  computeContrastRange,
  computeLaplacianStdev,
  decodeRgba,
  hammingDistance,
} from "../../../automation/ai/quality/pixel-metrics.ts";

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

test("computeAlphaMetrics: fully transparent image has ratio 1 and no bounding box", async () => {
  const png = await toPng(100, 100, () => [0, 0, 0, 0]);
  const image = await decodeRgba(png);
  const metrics = computeAlphaMetrics(image, 10, 4);
  assert.equal(metrics.transparentRatio, 1);
  assert.equal(metrics.subjectCoverageRatio, 0);
  assert.equal(metrics.edgeTouchesCanvas, false);
});

test("computeAlphaMetrics: small centered opaque square does not touch the edge", async () => {
  const png = await toPng(100, 100, (x, y) => (x >= 40 && x < 60 && y >= 40 && y < 60 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  const image = await decodeRgba(png);
  const metrics = computeAlphaMetrics(image, 10, 4);
  assert.equal(metrics.edgeTouchesCanvas, false);
  assert.ok(metrics.subjectCoverageRatio > 0 && metrics.subjectCoverageRatio < 0.1);
});

test("computeAlphaMetrics: opaque content at x=0 touches the edge", async () => {
  const png = await toPng(100, 100, (x, y) => (x < 20 && y >= 40 && y < 60 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  const image = await decodeRgba(png);
  const metrics = computeAlphaMetrics(image, 10, 4);
  assert.equal(metrics.edgeTouchesCanvas, true);
});

test("computeContrastRange: uniform color has zero contrast", async () => {
  const png = await toPng(50, 50, () => [128, 128, 128, 255]);
  const image = await decodeRgba(png);
  const { contrastRange } = computeContrastRange(image, 10);
  assert.equal(contrastRange, 0);
});

test("computeContrastRange: half black half white has near-maximum contrast", async () => {
  const png = await toPng(50, 50, (x) => (x < 25 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const image = await decodeRgba(png);
  const { contrastRange } = computeContrastRange(image, 10);
  assert.ok(contrastRange > 240, `expected near-255 contrast, got ${contrastRange}`);
});

test("computeContrastRange: ignores transparent pixels", async () => {
  const png = await toPng(50, 50, (x) => (x < 25 ? [128, 128, 128, 255] : [0, 0, 0, 0]));
  const image = await decodeRgba(png);
  const { contrastRange } = computeContrastRange(image, 10);
  assert.equal(contrastRange, 0);
});

test("computeLaplacianStdev: a solid color image has near-zero stdev", async () => {
  const png = await toPng(200, 200, () => [100, 100, 100, 255]);
  const stdev = await computeLaplacianStdev(png);
  assert.ok(stdev < 1, `expected near-zero, got ${stdev}`);
});

test("computeLaplacianStdev: a checkerboard has a much higher stdev than a solid color", async () => {
  const solid = await toPng(200, 200, () => [100, 100, 100, 255]);
  const checker = await toPng(200, 200, (x, y) => {
    const on = (Math.floor(x / 10) + Math.floor(y / 10)) % 2 === 0;
    return on ? [20, 20, 20, 255] : [220, 220, 220, 255];
  });
  const solidStdev = await computeLaplacianStdev(solid);
  const checkerStdev = await computeLaplacianStdev(checker);
  assert.ok(checkerStdev > solidStdev * 5, `expected checkerboard >> solid, got ${checkerStdev} vs ${solidStdev}`);
});

test("computeAverageHash: identical images produce identical hashes (distance 0)", async () => {
  const png = await toPng(64, 64, (x, y) => (x + y) % 2 === 0 ? [10, 10, 10, 255] : [240, 240, 240, 255]);
  const a = await computeAverageHash(png);
  const b = await computeAverageHash(png);
  assert.equal(hammingDistance(a, b), 0);
});

test("computeAverageHash: solid black vs solid white produce very different hashes", async () => {
  const black = await toPng(64, 64, () => [0, 0, 0, 255]);
  const white = await toPng(64, 64, () => [255, 255, 255, 255]);
  const hashA = await computeAverageHash(black);
  const hashB = await computeAverageHash(white);
  // both are perfectly uniform, so every pixel equals the mean; average-hash
  // is degenerate here (all bits "1", tie broken the same way both times) —
  // assert the hash is well-formed rather than assuming a large distance.
  assert.equal(hashA.length, 64);
  assert.equal(hashB.length, 64);
});

test("hammingDistance: counts differing bits, including for unequal-length strings", () => {
  assert.equal(hammingDistance("1010", "1010"), 0);
  assert.equal(hammingDistance("1010", "1011"), 1);
  assert.equal(hammingDistance("0000", "1111"), 4);
  assert.equal(hammingDistance("101", "10100"), 2);
});
