/** Real Typography Engine: every title/label/caption goes through here — never through the AI image model. */

export interface TextOutline {
  readonly color: string;
  readonly widthPx: number;
}

export interface TextShadow {
  readonly color: string;
  readonly offsetXPx: number;
  readonly offsetYPx: number;
  readonly blurPx: number;
}

export interface TextCurve {
  readonly radiusPx: number;
  /** Total degrees of arc the text sweeps, centered on the top of the circle. */
  readonly sweepDeg: number;
}

export interface TextLayerRequest {
  readonly text: string;
  readonly canvasWidthPx: number;
  readonly canvasHeightPx: number;
  /** Anchor position: for straight text, the text-anchor point; for curved text, the arc's center point. */
  readonly xPx: number;
  readonly yPx: number;
  readonly fontFamily?: string;
  /** Explicit size in px; if omitted, auto-fit to `maxWidthPx`. */
  readonly fontSizePx?: number;
  /** Used for auto-sizing when `fontSizePx` is omitted. Defaults to 80% of canvas width. */
  readonly maxWidthPx?: number;
  readonly fontWeight?: "normal" | "bold";
  readonly color?: string;
  readonly letterSpacingPx?: number;
  readonly textAnchor?: "start" | "middle" | "end";
  readonly outline?: TextOutline;
  readonly shadow?: TextShadow;
  readonly curve?: TextCurve;
}
