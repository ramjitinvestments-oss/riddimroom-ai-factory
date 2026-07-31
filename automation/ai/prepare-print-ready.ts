/**
 * Converts a generated image into the print-ready asset CLAUDE.md
 * requires: exactly 4500x5400 PNG, transparent background. Uses `sharp`
 * (libvips) for real interpolation — this is the one narrow case where a
 * hand-rolled approach (as in `./png.ts`) isn't good enough, since quality
 * upscaling needs real resampling, not just pixel copying.
 *
 * AI providers return roughly-square images; the print canvas is a
 * different (portrait) aspect ratio. Stretching would distort the
 * artwork, so this pads to the exact target size instead
 * (`fit: "contain"`) with a transparent background — which also
 * reinforces the transparency requirement rather than fighting it.
 */
import sharp from "sharp";
import { ValidationError } from "../shared/errors.ts";
import { hasAlphaChannel, readPngDimensions } from "./png.ts";
import { err, ok, type Result } from "../shared/result.ts";

export const PRINT_WIDTH = 4500;
export const PRINT_HEIGHT = 5400;

export interface PrintReadyImage {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
}

/**
 * Converts `source` (any PNG) into a validated print-ready PNG: exactly
 * `PRINT_WIDTH`x`PRINT_HEIGHT`, with an alpha channel. Fails as a
 * `ValidationError` (an expected, operational failure — a malformed or
 * unsupported source image) rather than throwing, per this codebase's
 * Result convention.
 */
export async function toPrintReadyPng(source: Buffer): Promise<Result<PrintReadyImage, ValidationError>> {
  let buffer: Buffer;
  try {
    buffer = await sharp(source)
      .resize(PRINT_WIDTH, PRINT_HEIGHT, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .png()
      .toBuffer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new ValidationError([`failed to convert source image to a print-ready PNG: ${message}`]));
  }

  const info = readPngDimensions(buffer);
  if (!info.ok) {
    return err(info.error);
  }

  const issues: string[] = [];
  if (info.value.width !== PRINT_WIDTH || info.value.height !== PRINT_HEIGHT) {
    issues.push(
      `expected ${PRINT_WIDTH}x${PRINT_HEIGHT}, got ${info.value.width}x${info.value.height}`,
    );
  }
  if (!hasAlphaChannel(info.value.colorType)) {
    issues.push("print-ready PNG must have an alpha channel (transparent background)");
  }
  if (issues.length > 0) {
    return err(new ValidationError(issues));
  }

  return ok({ buffer, width: info.value.width, height: info.value.height });
}
