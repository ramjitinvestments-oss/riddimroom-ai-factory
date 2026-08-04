/**
 * Builds the SVG markup for one text layer. Real font shaping/kerning
 * comes from the SVG/font-rendering engine itself (librsvg, via `sharp`)
 * once handed `<text>` elements — this module's job is producing correct
 * markup: escaping, the outline/shadow filter primitives, and curved-text
 * positioning.
 *
 * Curved text is built from individually-rotated per-character `<text>`
 * elements rather than `<textPath>`: the librsvg build bundled with this
 * project's `sharp` version (2.62.3) silently renders zero glyphs for
 * `<textPath>` regardless of `href`/`xlink:href` — confirmed empirically,
 * not assumed — while plain `<text>` and arc `<path>` geometry both
 * render correctly. Per-character placement is a standard, portable
 * fallback technique for exactly this situation.
 */
import type { TextLayerRequest, TextShadow } from "./types.ts";

export const DEFAULT_FONT_FAMILY = "sans-serif";
const SHADOW_FILTER_ID = "text-shadow";

export interface ResolvedTextLayerRequest extends TextLayerRequest {
  readonly fontSizePx: number;
}

export function buildTextSvg(request: ResolvedTextLayerRequest): string {
  const fontFamily = request.fontFamily ?? DEFAULT_FONT_FAMILY;
  const color = request.color ?? "#000000";
  const fontWeight = request.fontWeight ?? "bold";
  const textAnchor = request.textAnchor ?? "middle";

  const attrs: string[] = [
    `font-family="${escapeXml(fontFamily)}"`,
    `font-size="${request.fontSizePx}"`,
    `font-weight="${fontWeight}"`,
    `fill="${escapeXml(color)}"`,
  ];
  if (request.letterSpacingPx !== undefined) {
    attrs.push(`letter-spacing="${request.letterSpacingPx}"`);
  }
  if (request.outline !== undefined) {
    attrs.push(`stroke="${escapeXml(request.outline.color)}"`, `stroke-width="${request.outline.widthPx}"`);
  }
  if (request.shadow !== undefined) {
    attrs.push(`filter="url(#${SHADOW_FILTER_ID})"`);
  }

  const defs: string[] = [];
  let textElement: string;

  if (request.curve !== undefined) {
    textElement = buildCurvedTextElements(request.text, request.xPx, request.yPx, request.curve.radiusPx, request.curve.sweepDeg, attrs);
  } else {
    textElement =
      `<text x="${request.xPx}" y="${request.yPx}" text-anchor="${textAnchor}" ${attrs.join(" ")}>` +
      `${escapeXml(request.text)}</text>`;
  }

  if (request.shadow !== undefined) {
    defs.push(buildShadowFilter(request.shadow, SHADOW_FILTER_ID));
  }

  const defsBlock = defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${request.canvasWidthPx}" height="${request.canvasHeightPx}">${defsBlock}${textElement}</svg>`;
}

/**
 * Places each character of `text` along a circular arc centered on
 * `(centerX, centerY)`, spanning `sweepDeg` total degrees centered on the
 * top of the circle. Characters are spaced at equal angular increments
 * (a standard simplification absent full per-glyph metrics — consistent
 * with this engine's average-character-width auto-fit heuristic
 * elsewhere) and each is individually rotated to sit tangent to the arc.
 */
export function buildCurvedTextElements(
  text: string,
  centerX: number,
  centerY: number,
  radiusPx: number,
  sweepDeg: number,
  attrs: readonly string[],
): string {
  const characters = [...text];
  if (characters.length === 0) {
    return "";
  }

  const topAngleDeg = -90;
  const startAngleDeg = topAngleDeg - sweepDeg / 2;
  const stepDeg = characters.length > 1 ? sweepDeg / (characters.length - 1) : 0;

  const elements = characters.map((character, index) => {
    const angleDeg = characters.length > 1 ? startAngleDeg + stepDeg * index : topAngleDeg;
    const { x, y } = pointOnCircle(centerX, centerY, radiusPx, angleDeg);
    const rotationDeg = angleDeg + 90;
    return (
      `<text x="${x}" y="${y}" text-anchor="middle" transform="rotate(${rotationDeg} ${x} ${y})" ${attrs.join(" ")}>` +
      `${escapeXml(character)}</text>`
    );
  });

  return `<g>${elements.join("")}</g>`;
}

function buildShadowFilter(shadow: TextShadow, id: string): string {
  return (
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="${shadow.blurPx}" result="blur"/>` +
    `<feOffset in="blur" dx="${shadow.offsetXPx}" dy="${shadow.offsetYPx}" result="offsetBlur"/>` +
    `<feFlood flood-color="${escapeXml(shadow.color)}" result="floodColor"/>` +
    `<feComposite in="floodColor" in2="offsetBlur" operator="in" result="shadowColor"/>` +
    `<feMerge><feMergeNode in="shadowColor"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `</filter>`
  );
}

export interface ArcPath {
  readonly id: string;
  readonly d: string;
}

/**
 * A circular-arc path centered on `(centerX, centerY)` with the given
 * radius, spanning `sweepDeg` total degrees centered on the top of the
 * circle (12 o'clock). Exported as a general-purpose utility (e.g. for a
 * decorative stroked arc) — not used for curved-text positioning itself,
 * see `buildCurvedTextElements`'s doc comment for why.
 */
export function buildArcPath(centerX: number, centerY: number, radiusPx: number, sweepDeg: number, id: string): ArcPath {
  const topAngleDeg = -90;
  const startAngleDeg = topAngleDeg - sweepDeg / 2;
  const endAngleDeg = topAngleDeg + sweepDeg / 2;
  const start = pointOnCircle(centerX, centerY, radiusPx, startAngleDeg);
  const end = pointOnCircle(centerX, centerY, radiusPx, endAngleDeg);
  const largeArcFlag = sweepDeg > 180 ? 1 : 0;
  return { id, d: `M ${start.x} ${start.y} A ${radiusPx} ${radiusPx} 0 ${largeArcFlag} 1 ${end.x} ${end.y}` };
}

export function pointOnCircle(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const angleRad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
