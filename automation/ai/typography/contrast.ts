/**
 * Real WCAG 2.1 contrast math — relative luminance and contrast ratio,
 * computed exactly per the spec (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance),
 * not an approximation. This is what lets the Typography Engine reject a
 * color choice objectively rather than guessing.
 */

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** WCAG 2.1 AA minimum for large-scale text (18pt+/14pt-bold+) — apparel print text always qualifies as large-scale. */
export const WCAG_AA_LARGE_TEXT_MIN_CONTRAST = 3;
/** A stricter, more conservative bar used as this engine's default — safety margin for fabric texture, distance, and lighting a screen-based spec doesn't account for. */
export const DEFAULT_MIN_CONTRAST_RATIO = 4.5;

function srgbChannelToLinear(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: RgbColor): number {
  const r = srgbChannelToLinear(color.r);
  const g = srgbChannelToLinear(color.g);
  const b = srgbChannelToLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors, from 1 (identical) to 21 (pure black vs pure white). */
export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function rgbToHex(color: RgbColor): string {
  const toHex = (c: number): string => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0");
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

/**
 * Named shirt/garment colors this engine already uses elsewhere (every
 * `shirtColorCompatibility` value across ../styles/library.ts) mapped to a
 * representative RGB swatch, so typography color decisions plug straight
 * into data the rest of the engine already produces.
 */
export const SHIRT_COLOR_SWATCHES: Readonly<Record<string, RgbColor>> = {
  black: { r: 17, g: 17, b: 17 },
  "washed black": { r: 40, g: 40, b: 40 },
  white: { r: 255, g: 255, b: 255 },
  "vintage charcoal": { r: 54, g: 52, b: 50 },
  charcoal: { r: 54, g: 52, b: 50 },
  "stone grey": { r: 150, g: 150, b: 150 },
  "heather grey": { r: 170, g: 170, b: 170 },
  cream: { r: 239, g: 230, b: 200 },
  "vintage cream": { r: 239, g: 230, b: 200 },
  "natural/off-white": { r: 245, g: 240, b: 230 },
  sand: { r: 210, g: 190, b: 160 },
  sage: { r: 176, g: 184, b: 160 },
  "sky blue": { r: 135, g: 190, b: 220 },
  navy: { r: 30, g: 40, b: 65 },
  "vintage navy": { r: 35, g: 45, b: 70 },
  "faded navy": { r: 45, g: 55, b: 80 },
  "faded red": { r: 150, g: 70, b: 65 },
  "deep purple": { r: 60, g: 35, b: 80 },
};

const FALLBACK_MID_TONE: RgbColor = { r: 128, g: 128, b: 128 };

/** Resolves a shirt color name to RGB, case-insensitively. Falls back to a neutral mid-tone for unknown names. */
export function resolveShirtColor(name: string): RgbColor {
  return SHIRT_COLOR_SWATCHES[name.trim().toLowerCase()] ?? FALLBACK_MID_TONE;
}

/** True if a color reads as visually "dark" (below the mid-point of relative luminance). */
export function isDarkColor(color: RgbColor): boolean {
  return relativeLuminance(color) < 0.5;
}
