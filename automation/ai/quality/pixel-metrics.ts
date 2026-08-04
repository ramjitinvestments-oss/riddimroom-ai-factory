/**
 * Pure pixel analysis used by `./heuristic-quality-provider.ts`. Everything
 * here operates on raw decoded RGBA data (via `sharp`, already a project
 * dependency) rather than a CV library — these are standard, real
 * techniques (bounding-box/alpha scanning, Laplacian-variance sharpness,
 * average-hash perceptual duplicates), not approximated stand-ins.
 */
import sharp from "sharp";

export interface RawRgba {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

/** Decodes `imageBuffer` to raw RGBA (forcing an alpha channel if the source has none). */
export async function decodeRgba(imageBuffer: Buffer): Promise<RawRgba> {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export interface AlphaMetrics {
  readonly transparentRatio: number;
  readonly subjectCoverageRatio: number;
  readonly edgeTouchesCanvas: boolean;
}

/**
 * Scans the alpha channel once: what fraction of pixels are transparent,
 * how much of the canvas the non-transparent bounding box covers, and
 * whether any non-transparent pixel falls within `edgeBandPx` of a border
 * (a cropped/clipped subject, or a subject touching the print's safety
 * margin).
 */
export function computeAlphaMetrics(image: RawRgba, alphaThreshold: number, edgeBandPx: number): AlphaMetrics {
  const { data, width, height } = image;
  let transparentCount = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let edgeTouchesCanvas = false;

  for (let y = 0; y < height; y++) {
    const nearTopOrBottomEdge = y < edgeBandPx || y >= height - edgeBandPx;
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3] ?? 0;
      if (alpha < alphaThreshold) {
        transparentCount++;
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (nearTopOrBottomEdge || x < edgeBandPx || x >= width - edgeBandPx) {
        edgeTouchesCanvas = true;
      }
    }
  }

  const totalPixels = width * height;
  const transparentRatio = transparentCount / totalPixels;
  const subjectCoverageRatio =
    maxX >= minX && maxY >= minY ? ((maxX - minX + 1) * (maxY - minY + 1)) / totalPixels : 0;

  return { transparentRatio, subjectCoverageRatio, edgeTouchesCanvas };
}

export interface LuminanceStats {
  readonly contrastRange: number;
}

/** Luminance min/max spread across non-transparent pixels only (background transparency shouldn't count as "contrast"). */
export function computeContrastRange(image: RawRgba, alphaThreshold: number): LuminanceStats {
  const { data, width, height } = image;
  let min = 255;
  let max = 0;
  let sawAnyOpaquePixel = false;

  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    const alpha = data[offset + 3] ?? 0;
    if (alpha < alphaThreshold) {
      continue;
    }
    sawAnyOpaquePixel = true;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luminance < min) min = luminance;
    if (luminance > max) max = luminance;
  }

  return { contrastRange: sawAnyOpaquePixel ? max - min : 0 };
}

const LAPLACIAN_ANALYSIS_MAX_DIMENSION = 512;

/**
 * Downsamples to a manageable size (this is a statistical texture proxy,
 * not a pixel-exact operation, so full resolution isn't needed) and
 * convolves with a Laplacian kernel; the standard deviation of the result
 * is a standard sharpness/detail proxy — near-zero for a blurry or flat
 * image, very high for noisy/artifact-heavy output.
 */
export async function computeLaplacianStdev(imageBuffer: Buffer): Promise<number> {
  const small = sharp(imageBuffer)
    .resize(LAPLACIAN_ANALYSIS_MAX_DIMENSION, LAPLACIAN_ANALYSIS_MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale();

  const convolved = await small
    .clone()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data } = convolved;
  const n = data.length;
  if (n === 0) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += data[i] ?? 0;
  }
  const mean = sum / n;

  let sumSquaredDiff = 0;
  for (let i = 0; i < n; i++) {
    const diff = (data[i] ?? 0) - mean;
    sumSquaredDiff += diff * diff;
  }
  return Math.sqrt(sumSquaredDiff / n);
}

const HASH_SIZE = 8;

/**
 * Average-hash perceptual fingerprint: downsample to 8x8 greyscale, then
 * one bit per pixel for "brighter than the image's mean". Two visually
 * similar images produce hashes with a small Hamming distance.
 */
export async function computeAverageHash(imageBuffer: Buffer): Promise<string> {
  const { data } = await sharp(imageBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(HASH_SIZE, HASH_SIZE, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (const value of data) {
    sum += value;
  }
  const mean = sum / data.length;

  let hash = "";
  for (const value of data) {
    hash += value >= mean ? "1" : "0";
  }
  return hash;
}

/** Number of differing bits between two equal-length binary hash strings. */
export function hammingDistance(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) {
      distance++;
    }
  }
  return distance;
}
