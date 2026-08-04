/**
 * The Artwork Preparation Stage: turns a user-supplied artwork file into a
 * print-ready PNG without ever touching the design content itself. Runs
 * before Product Approval (Metadata Generation) — see
 * `../../scripts/prepare-artwork.ts`, which orchestrates this over every
 * file in `designs/approved/` and writes results to `designs/processed/`,
 * leaving the original untouched.
 *
 * The only fixes this module will ever apply:
 *   - Background removal, and only when the background is a simple,
 *     uniform color — detected from the canvas perimeter, then removed via
 *     a flood fill starting at the border (`removeSimpleSolidBackground`).
 *     A flood fill only clears background pixels *reachable from the
 *     edge*, so same-colored regions fully enclosed by the subject (e.g. a
 *     white letter's counter) are never touched. A background that isn't
 *     uniform, or where removal would erase most of the canvas, is left
 *     alone and reported as unsafe — never guessed at.
 *   - Resize/pad onto the exact print canvas via `../prepare-print-ready.ts`'s
 *     `toPrintReadyPng()`, which already guarantees aspect-preserving
 *     scaling (`fit: "contain"`, never stretched or cropped), upscales
 *     only when the source is smaller than the canvas, centers the result,
 *     pads with transparency, and always outputs PNG.
 *
 * Nothing here recolors, redraws, retouches, or otherwise modifies the
 * design itself — only the canvas it sits on and its background.
 */
import sharp, { type Metadata } from "sharp";
import { ValidationError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { MIN_DPI, PRINT_PHYSICAL_HEIGHT_IN, PRINT_PHYSICAL_WIDTH_IN } from "./artwork-validation.ts";
import { decodeRgba } from "./quality/pixel-metrics.ts";
import { PRINT_HEIGHT, PRINT_WIDTH, toPrintReadyPng } from "./prepare-print-ready.ts";

/** Max per-channel deviation among sampled perimeter pixels to call a background "uniform." */
const BACKGROUND_UNIFORMITY_TOLERANCE = 12;
/** Max per-channel distance from the detected background color a pixel can be and still be flood-filled away. */
const BACKGROUND_MATCH_TOLERANCE = 30;
/** If flood-fill removal would leave less than this fraction of the canvas opaque, refuse — it likely erased the subject. */
const MIN_REMAINING_OPAQUE_RATIO = 0.01;
/** sharp reports this as `density` when a source PNG has no real pHYs chunk — indistinguishable from a genuine 72 DPI file, so treated as "no embedded value" (same reasoning as ../artwork-validation.ts). */
const SHARP_BARE_DEFAULT_DENSITY = 72;

export interface ArtworkInspection {
  readonly format: string | undefined;
  readonly width: number;
  readonly height: number;
  /** From embedded metadata (a PNG pHYs chunk), if a real one is present; `undefined` otherwise. Informational only — suitability is decided from `effectiveDpi`, not this. */
  readonly embeddedDpi: number | undefined;
  /** Computed from pixel dimensions against the physical print area — see ../artwork-validation.ts. */
  readonly effectiveDpi: number;
  readonly meetsMinimumDpi: boolean;
  readonly matchesPrintCanvas: boolean;
  readonly hasTransparentBackground: boolean;
  readonly colorSpace: string | undefined;
  readonly hasIccProfile: boolean;
}

/** Read-only inspection — decodes and reports, never modifies. */
export async function inspectArtwork(buffer: Buffer): Promise<Result<ArtworkInspection, ValidationError>> {
  let metadata: Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new ValidationError([`artwork could not be read: ${message}`]));
  }

  const { width, height } = metadata;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return err(new ValidationError(["artwork has no readable dimensions"]));
  }

  const effectiveDpi = Math.min(width / PRINT_PHYSICAL_WIDTH_IN, height / PRINT_PHYSICAL_HEIGHT_IN);

  return ok({
    format: metadata.format,
    width,
    height,
    embeddedDpi:
      metadata.density !== undefined && metadata.density !== SHARP_BARE_DEFAULT_DENSITY
        ? metadata.density
        : undefined,
    effectiveDpi,
    meetsMinimumDpi: effectiveDpi >= MIN_DPI,
    matchesPrintCanvas: width === PRINT_WIDTH && height === PRINT_HEIGHT,
    hasTransparentBackground: metadata.hasAlpha ?? false,
    colorSpace: metadata.space,
    hasIccProfile: metadata.icc !== undefined,
  });
}

/** A print-ready PNG must be exactly the print canvas, at/above the minimum DPI, transparent, and actually PNG. */
export function isPrintifySuitable(inspection: ArtworkInspection): boolean {
  return (
    inspection.format === "png" &&
    inspection.matchesPrintCanvas &&
    inspection.meetsMinimumDpi &&
    inspection.hasTransparentBackground
  );
}

export interface BackgroundRemoval {
  readonly buffer: Buffer;
  readonly backgroundColor: { readonly r: number; readonly g: number; readonly b: number };
  readonly removedRatio: number;
}

/**
 * Removes a background only when it's safe to: the canvas perimeter must
 * be a single uniform color (not a gradient, photo, or texture), and the
 * flood fill it drives must leave a real subject behind. Either condition
 * failing returns `err` with the specific reason — never a best-effort
 * guess.
 */
export async function removeSimpleSolidBackground(buffer: Buffer): Promise<Result<BackgroundRemoval, ValidationError>> {
  const image = await decodeRgba(buffer);
  const { data, width, height } = image;

  const perimeterSamples: Array<readonly [number, number, number]> = [];
  for (let x = 0; x < width; x++) {
    perimeterSamples.push(pixelRgb(data, width, x, 0));
    perimeterSamples.push(pixelRgb(data, width, x, height - 1));
  }
  for (let y = 0; y < height; y++) {
    perimeterSamples.push(pixelRgb(data, width, 0, y));
    perimeterSamples.push(pixelRgb(data, width, width - 1, y));
  }

  const backgroundColor = meanColor(perimeterSamples);
  const maxDeviation = perimeterSamples.reduce(
    (max, c) => Math.max(max, channelDeviation(c, backgroundColor)),
    0,
  );

  if (maxDeviation > BACKGROUND_UNIFORMITY_TOLERANCE) {
    return err(
      new ValidationError([
        `background is not a simple, uniform color — perimeter pixels vary by up to ${maxDeviation.toFixed(0)} ` +
          `per color channel, exceeding the ${BACKGROUND_UNIFORMITY_TOLERANCE} tolerance for automatic removal`,
      ]),
    );
  }

  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let queueLength = 0;

  const enqueueIfBackground = (x: number, y: number): void => {
    const idx = y * width + x;
    if (visited[idx] === 1) {
      return;
    }
    if (channelDeviation(pixelRgb(data, width, x, y), backgroundColor) <= BACKGROUND_MATCH_TOLERANCE) {
      visited[idx] = 1;
      queue[queueLength] = idx;
      queueLength++;
    }
  };

  for (let x = 0; x < width; x++) {
    enqueueIfBackground(x, 0);
    enqueueIfBackground(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    enqueueIfBackground(0, y);
    enqueueIfBackground(width - 1, y);
  }

  const out = Buffer.from(data);
  let removedCount = 0;
  let head = 0;
  while (head < queueLength) {
    const idx = queue[head]!;
    head++;
    out[idx * 4 + 3] = 0;
    removedCount++;

    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x > 0) enqueueIfBackground(x - 1, y);
    if (x < width - 1) enqueueIfBackground(x + 1, y);
    if (y > 0) enqueueIfBackground(x, y - 1);
    if (y < height - 1) enqueueIfBackground(x, y + 1);
  }

  const remainingOpaqueRatio = (totalPixels - removedCount) / totalPixels;
  if (remainingOpaqueRatio < MIN_REMAINING_OPAQUE_RATIO) {
    return err(
      new ValidationError([
        `automatic background removal would clear ${(100 - remainingOpaqueRatio * 100).toFixed(1)}% of the canvas, ` +
          "leaving no recognizable subject — refusing to apply it automatically",
      ]),
    );
  }

  const pngBuffer = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return ok({
    buffer: pngBuffer,
    backgroundColor: { r: Math.round(backgroundColor.r), g: Math.round(backgroundColor.g), b: Math.round(backgroundColor.b) },
    removedRatio: removedCount / totalPixels,
  });
}

export interface ArtworkPreparationFix {
  readonly type: "backgroundRemoved" | "resizedAndPadded";
  readonly detail: string;
}

export interface PreparedArtwork {
  readonly buffer: Buffer;
  readonly original: ArtworkInspection;
  readonly processed: ArtworkInspection;
  readonly fixesApplied: readonly ArtworkPreparationFix[];
  readonly suitableForPrintify: boolean;
}

/**
 * Inspects `source` and, only if it isn't already Printify-suitable,
 * applies the allowed fixes (background removal, then resize/pad onto the
 * print canvas) to produce a print-ready PNG. Returns `err` the moment a
 * fix can't be applied safely (e.g. a non-uniform background) — the
 * caller should stop, not fall back to a partial or guessed result.
 */
export async function prepareArtwork(source: Buffer): Promise<Result<PreparedArtwork, ValidationError>> {
  const originalResult = await inspectArtwork(source);
  if (!originalResult.ok) {
    return err(originalResult.error);
  }
  const original = originalResult.value;

  if (isPrintifySuitable(original)) {
    return ok({ buffer: source, original, processed: original, fixesApplied: [], suitableForPrintify: true });
  }

  let working = source;
  const fixesApplied: ArtworkPreparationFix[] = [];

  if (!original.hasTransparentBackground) {
    const removal = await removeSimpleSolidBackground(working);
    if (!removal.ok) {
      return err(removal.error);
    }
    working = removal.value.buffer;
    fixesApplied.push({
      type: "backgroundRemoved",
      detail:
        `removed a uniform rgb(${removal.value.backgroundColor.r}, ${removal.value.backgroundColor.g}, ` +
        `${removal.value.backgroundColor.b}) background via edge-connected flood fill ` +
        `(${(removal.value.removedRatio * 100).toFixed(1)}% of the canvas)`,
    });
  }

  const resized = await toPrintReadyPng(working);
  if (!resized.ok) {
    return err(resized.error);
  }
  working = resized.value.buffer;
  const wasUpscaled = original.width < PRINT_WIDTH && original.height < PRINT_HEIGHT;
  fixesApplied.push({
    type: "resizedAndPadded",
    detail:
      `resized ${original.width}x${original.height} to ${PRINT_WIDTH}x${PRINT_HEIGHT} preserving aspect ratio ` +
      `(${wasUpscaled ? "upscaled" : "downscaled/padded"}, centered, transparent padding added)`,
  });

  const processedResult = await inspectArtwork(working);
  if (!processedResult.ok) {
    return err(processedResult.error);
  }
  const processed = processedResult.value;

  return ok({ buffer: working, original, processed, fixesApplied, suitableForPrintify: isPrintifySuitable(processed) });
}

function pixelRgb(data: Buffer, width: number, x: number, y: number): readonly [number, number, number] {
  const offset = (y * width + x) * 4;
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0];
}

function meanColor(samples: ReadonlyArray<readonly [number, number, number]>): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [cr, cg, cb] of samples) {
    r += cr;
    g += cg;
    b += cb;
  }
  const n = samples.length;
  return { r: r / n, g: g / n, b: b / n };
}

function channelDeviation(c: readonly [number, number, number], mean: { r: number; g: number; b: number }): number {
  return Math.max(Math.abs(c[0] - mean.r), Math.abs(c[1] - mean.g), Math.abs(c[2] - mean.b));
}
