/**
 * Automatic contrast-aware typography: picks a fill color, an outline
 * (opposite tone from the fill, so shape stays legible via whichever of
 * the two contrasts best with a given background), and a shadow/glow
 * effect, all driven by the target shirt color — instead of a caller
 * hardcoding a color that only works on one garment.
 *
 * This is the fix for "black wordmark invisible on a black shirt": the
 * old path let a title render with the Typography Engine's flat default
 * fill (#000000) regardless of context. This module is the only thing
 * that changed about typography rendering — buildTextSvg, renderTextLayer,
 * and the curved-text/outline/shadow SVG primitives are untouched.
 */
import { ValidationError } from "../../shared/errors.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import {
  contrastRatio,
  DEFAULT_MIN_CONTRAST_RATIO,
  isDarkColor,
  resolveShirtColor,
  rgbToHex,
  type RgbColor,
} from "./contrast.ts";
import { estimateFontSizeForWidth } from "./typography-engine.ts";
import type { TextLayerRequest, TextOutline, TextShadow } from "./types.ts";

interface CandidateColor {
  readonly name: string;
  readonly rgb: RgbColor;
}

/** Light-family candidates: what "Black shirt -> White, Gold or Light Gray text" means concretely. */
const LIGHT_FAMILY: readonly CandidateColor[] = [
  { name: "white", rgb: { r: 255, g: 255, b: 255 } },
  { name: "gold", rgb: { r: 217, g: 164, b: 65 } },
  { name: "light gray", rgb: { r: 229, g: 229, b: 229 } },
];

/** Dark-family candidates: what "White shirt -> Black or Dark Charcoal text" means concretely. */
const DARK_FAMILY: readonly CandidateColor[] = [
  { name: "black", rgb: { r: 17, g: 17, b: 17 } },
  { name: "dark charcoal", rgb: { r: 38, g: 38, b: 38 } },
];

const OUTLINE_WIDTH_RATIO = 0.045; // ~4.5% of font size, a standard bold-display-outline proportion
const GLOW_BLUR_RATIO = 0.09;
const DROP_SHADOW_BLUR_RATIO = 0.025;
const DROP_SHADOW_OFFSET_RATIO = 0.015;

export interface AdaptiveTypographyChoice {
  readonly shirtColorName: string;
  readonly fillColorHex: string;
  readonly fillColorName: string;
  readonly outlineColorHex: string;
  readonly effect: "glow" | "drop-shadow";
  /** Contrast ratio of the fill color against the resolved shirt background — the accessibility-relevant measurement. */
  readonly fillContrastRatio: number;
  readonly outlineContrastRatio: number;
  readonly passesAccessibilityThreshold: boolean;
  readonly minContrastRatioRequired: number;
}

export interface ChooseAdaptiveTypographyOptions {
  readonly minContrastRatio?: number;
}

/**
 * Picks fill/outline/effect for `shirtColorName`. Always tries the family
 * appropriate to the shirt's darkness first (light text on dark shirts,
 * dark text on light shirts); if literally nothing in that family clears
 * the threshold against an unusual background, it also considers the
 * opposite family before giving up — see `passesAccessibilityThreshold`.
 */
export function chooseAdaptiveTypography(
  shirtColorName: string,
  options: ChooseAdaptiveTypographyOptions = {},
): AdaptiveTypographyChoice {
  const minContrastRatio = options.minContrastRatio ?? DEFAULT_MIN_CONTRAST_RATIO;
  const shirtRgb = resolveShirtColor(shirtColorName);
  const shirtIsDark = isDarkColor(shirtRgb);

  const preferredFamily = shirtIsDark ? LIGHT_FAMILY : DARK_FAMILY;
  const fallbackFamily = shirtIsDark ? DARK_FAMILY : LIGHT_FAMILY;

  const bestOf = (family: readonly CandidateColor[]): CandidateColor =>
    [...family].sort((a, b) => contrastRatio(b.rgb, shirtRgb) - contrastRatio(a.rgb, shirtRgb))[0]!;

  let fill = bestOf(preferredFamily);
  let fillContrast = contrastRatio(fill.rgb, shirtRgb);

  if (fillContrast < minContrastRatio) {
    const fallbackBest = bestOf(fallbackFamily);
    const fallbackContrast = contrastRatio(fallbackBest.rgb, shirtRgb);
    if (fallbackContrast > fillContrast) {
      fill = fallbackBest;
      fillContrast = fallbackContrast;
    }
  }

  // Outline is drawn from the opposite family of the fill: shape stays
  // legible via whichever of {fill, outline} contrasts best with the
  // actual background, which is the real guarantee behind requirement 4.
  const outlineFamily = LIGHT_FAMILY.includes(fill) ? DARK_FAMILY : LIGHT_FAMILY;
  const outline = bestOf(outlineFamily);
  const outlineContrast = contrastRatio(outline.rgb, shirtRgb);

  return {
    shirtColorName,
    fillColorHex: rgbToHex(fill.rgb),
    fillColorName: fill.name,
    outlineColorHex: rgbToHex(outline.rgb),
    effect: shirtIsDark ? "glow" : "drop-shadow",
    fillContrastRatio: Math.round(fillContrast * 100) / 100,
    outlineContrastRatio: Math.round(outlineContrast * 100) / 100,
    passesAccessibilityThreshold: fillContrast >= minContrastRatio,
    minContrastRatioRequired: minContrastRatio,
  };
}

export interface AdaptiveTextLayerInput {
  readonly text: string;
  readonly canvasWidthPx: number;
  readonly canvasHeightPx: number;
  readonly xPx: number;
  readonly yPx: number;
  readonly fontSizePx?: number;
  readonly maxWidthPx?: number;
  readonly fontFamily?: string;
  readonly fontWeight?: "normal" | "bold";
  readonly letterSpacingPx?: number;
  readonly textAnchor?: "start" | "middle" | "end";
  readonly curve?: TextLayerRequest["curve"];
}

/**
 * Builds a complete, ready-to-render `TextLayerRequest` with fill,
 * outline, and shadow/glow all resolved automatically for
 * `shirtColorName`. Rejects (rather than silently shipping illegible
 * text) if even the best available color choice can't clear the
 * configured accessibility threshold — requirement 5's "reject" gate.
 */
export function buildAdaptiveTextLayerRequest(
  input: AdaptiveTextLayerInput,
  shirtColorName: string,
  options: ChooseAdaptiveTypographyOptions = {},
): Result<TextLayerRequest & { readonly adaptiveTypography: AdaptiveTypographyChoice }, ValidationError> {
  const choice = chooseAdaptiveTypography(shirtColorName, options);

  if (!choice.passesAccessibilityThreshold) {
    return err(
      new ValidationError([
        `no available typography color clears the minimum contrast ratio of ${choice.minContrastRatioRequired}:1 ` +
          `against shirt color "${shirtColorName}" (best available: "${choice.fillColorName}" at ${choice.fillContrastRatio}:1)`,
      ]),
    );
  }

  const fontSizePx =
    input.fontSizePx ?? estimateFontSizeForWidth(input.text, input.maxWidthPx ?? input.canvasWidthPx * 0.8);

  const outline: TextOutline = {
    color: choice.outlineColorHex,
    widthPx: Math.round(fontSizePx * OUTLINE_WIDTH_RATIO),
  };

  const shadow: TextShadow =
    choice.effect === "glow"
      ? {
          // Soft glow: no offset, colored like the fill itself, wide blur.
          color: choice.fillColorHex,
          offsetXPx: 0,
          offsetYPx: 0,
          blurPx: Math.round(fontSizePx * GLOW_BLUR_RATIO),
        }
      : {
          // Standard drop shadow: dark, offset, moderate blur.
          color: "rgba(0,0,0,0.35)",
          offsetXPx: Math.round(fontSizePx * DROP_SHADOW_OFFSET_RATIO),
          offsetYPx: Math.round(fontSizePx * DROP_SHADOW_OFFSET_RATIO),
          blurPx: Math.round(fontSizePx * DROP_SHADOW_BLUR_RATIO),
        };

  return ok({
    text: input.text,
    canvasWidthPx: input.canvasWidthPx,
    canvasHeightPx: input.canvasHeightPx,
    xPx: input.xPx,
    yPx: input.yPx,
    fontSizePx,
    color: choice.fillColorHex,
    outline,
    shadow,
    ...(input.fontFamily !== undefined ? { fontFamily: input.fontFamily } : {}),
    ...(input.fontWeight !== undefined ? { fontWeight: input.fontWeight } : {}),
    ...(input.letterSpacingPx !== undefined ? { letterSpacingPx: input.letterSpacingPx } : {}),
    ...(input.textAnchor !== undefined ? { textAnchor: input.textAnchor } : {}),
    ...(input.curve !== undefined ? { curve: input.curve } : {}),
    adaptiveTypography: choice,
  });
}
