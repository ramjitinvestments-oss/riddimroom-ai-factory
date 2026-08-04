/**
 * The Composition Engine's layer model. Every layer is declarative data —
 * a role, a library query (or text spec), position, scale, opacity, blend
 * mode — never a literal file path. That's what makes layers "movable and
 * reusable": the same composition definition re-resolves to whatever the
 * library's best match is as it grows, and reordering `addLayer()` calls
 * is the entire "move a layer" operation.
 */
import type { AssetSearchQuery } from "../assets/asset-search.ts";
import type { TextLayerRequest } from "../typography/types.ts";

export type LayerRole =
  | "background"
  | "hero"
  | "secondary"
  | "badge"
  | "ribbon"
  | "texture-overlay"
  | "distress-overlay"
  | "lighting-overlay"
  | "frame"
  | "text";

/** Matches the subset of libvips blend modes sharp's `composite()` accepts. */
export type BlendMode =
  | "over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion";

export interface AssetLayerSpec {
  readonly kind: "asset";
  readonly role: Exclude<LayerRole, "text">;
  /** Resolved against the Asset Library at render time — never a literal filename. */
  readonly query: AssetSearchQuery;
  readonly xPx: number;
  readonly yPx: number;
  /** Omit to use the asset's natural size. */
  readonly widthPx?: number;
  readonly heightPx?: number;
  /** 0-1. Defaults to 1 (opaque) — most useful for texture/lighting overlays. */
  readonly opacity?: number;
  readonly blendMode?: BlendMode;
  readonly rotationDeg?: number;
}

export interface TextLayerSpec {
  readonly kind: "text";
  readonly role: "text";
  readonly text: Omit<TextLayerRequest, "canvasWidthPx" | "canvasHeightPx">;
}

export type CompositionLayer = AssetLayerSpec | TextLayerSpec;
