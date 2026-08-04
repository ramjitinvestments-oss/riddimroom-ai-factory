/**
 * Pure validation for one piece of user-supplied artwork: is it a real,
 * decodable PNG; does it hit the preferred print canvas size; does it meet
 * a minimum print resolution; does it have a transparent background. No
 * file I/O — reuses `./png.ts` (structural PNG parsing) and
 * `./quality/pixel-metrics.ts` (`decodeRgba`, the same sharp-based decode
 * `./quality/heuristic-quality-provider.ts` uses) rather than
 * reimplementing PNG handling.
 *
 * "Effective DPI" has no embedded-metadata source to trust: a PNG with no
 * pHYs chunk reports `sharp`'s `density` as a bare default of 72 —
 * indistinguishable from a file that genuinely specifies 72 DPI — so
 * per-file density metadata can't reliably answer "is this high enough
 * resolution to print." Instead, DPI is computed from actual pixel
 * dimensions against the print area this codebase already targets
 * elsewhere (`../ai/typography/typography-engine.ts`: "4500x5400, ~375
 * DPI for a ~12x14.4in print") — the same physical size, not a new guess.
 */
import { ValidationError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { hasAlphaChannel, readPngDimensions } from "./png.ts";
import { decodeRgba } from "./quality/pixel-metrics.ts";
import { PRINT_HEIGHT, PRINT_WIDTH } from "./prepare-print-ready.ts";

/** The physical print area `PRINT_WIDTH`x`PRINT_HEIGHT` targets — see module doc comment. */
export const PRINT_PHYSICAL_WIDTH_IN = 12;
export const PRINT_PHYSICAL_HEIGHT_IN = 14.4;
export const MIN_DPI = 300;

export interface ArtworkValidation {
  readonly width: number;
  readonly height: number;
  /** True only if exactly `PRINT_WIDTH`x`PRINT_HEIGHT` — preferred, not required. */
  readonly matchesPreferredDimensions: boolean;
  /** min(width / PRINT_PHYSICAL_WIDTH_IN, height / PRINT_PHYSICAL_HEIGHT_IN). */
  readonly effectiveDpi: number;
  readonly meetsMinimumDpi: boolean;
  readonly hasTransparentBackground: boolean;
  /** True only when every hard requirement (readable PNG, minimum DPI) is met. */
  readonly valid: boolean;
  /** Human-readable reasons `valid` is false; empty when `valid` is true. */
  readonly issues: readonly string[];
}

/**
 * Validates `buffer` as a piece of importable artwork. Returns `err` only
 * when the file isn't usable at all (not a PNG, or corrupted/undecodable)
 * — those aren't "invalid artwork" verdicts, they're "there was nothing to
 * evaluate." A structurally sound PNG that simply falls short of the
 * minimum DPI is still a successful `ok` result with `valid: false`,
 * exactly like `HeuristicQualityProvider.check()`'s pass/fail verdicts.
 */
export async function validateArtwork(buffer: Buffer): Promise<Result<ArtworkValidation, ValidationError>> {
  const dimensions = readPngDimensions(buffer);
  if (!dimensions.ok) {
    return err(dimensions.error);
  }

  try {
    await decodeRgba(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new ValidationError([`artwork is corrupted or unreadable: ${message}`]));
  }

  const { width, height, colorType } = dimensions.value;
  const matchesPreferredDimensions = width === PRINT_WIDTH && height === PRINT_HEIGHT;
  const effectiveDpi = Math.min(width / PRINT_PHYSICAL_WIDTH_IN, height / PRINT_PHYSICAL_HEIGHT_IN);
  const meetsMinimumDpi = effectiveDpi >= MIN_DPI;
  const hasTransparentBackground = hasAlphaChannel(colorType);

  const issues: string[] = [];
  if (!meetsMinimumDpi) {
    issues.push(
      `effective DPI ${effectiveDpi.toFixed(1)} is below the required minimum of ${MIN_DPI} ` +
        `(at a ${PRINT_PHYSICAL_WIDTH_IN}x${PRINT_PHYSICAL_HEIGHT_IN}in print size)`,
    );
  }

  return ok({
    width,
    height,
    matchesPreferredDimensions,
    effectiveDpi,
    meetsMinimumDpi,
    hasTransparentBackground,
    valid: meetsMinimumDpi,
    issues,
  });
}
