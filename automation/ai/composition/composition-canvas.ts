/**
 * Assembles a stack of declarative layers (see ./types.ts) into one
 * flattened, print-ready PNG via `sharp` compositing. Asset layers are
 * resolved against the Asset Library by query at render time (never a
 * literal file path); text layers go through the Real Typography Engine.
 * Layers stack in `addLayer()` call order — first added is the bottom.
 */
import { readFileSync } from "node:fs";
import sharp, { type OverlayOptions } from "sharp";
import { ValidationError } from "../../shared/errors.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import type { AssetRecord } from "../assets/types.ts";
import type { AssetSearchQuery } from "../assets/asset-search.ts";
import { renderTextLayer } from "../typography/typography-engine.ts";
import type { AssetLayerSpec, CompositionLayer } from "./types.ts";

/** What `CompositionCanvas` needs from the Asset Library — `AssetLibrary` satisfies this. */
export interface AssetResolver {
  findBest(query: AssetSearchQuery): AssetRecord | null;
}

export class CompositionCanvas {
  private readonly widthPx: number;
  private readonly heightPx: number;
  private readonly layers: CompositionLayer[] = [];

  constructor(widthPx: number, heightPx: number) {
    this.widthPx = widthPx;
    this.heightPx = heightPx;
  }

  /** Appends a layer on top of everything added so far. Returns `this` for chaining. */
  addLayer(layer: CompositionLayer): this {
    this.layers.push(layer);
    return this;
  }

  layerCount(): number {
    return this.layers.length;
  }

  async render(library: AssetResolver): Promise<Result<Buffer, ValidationError>> {
    const overlays: OverlayOptions[] = [];

    for (const layer of this.layers) {
      if (layer.kind === "text") {
        const rendered = await renderTextLayer({
          ...layer.text,
          canvasWidthPx: this.widthPx,
          canvasHeightPx: this.heightPx,
        });
        if (!rendered.ok) {
          return rendered;
        }
        overlays.push({ input: rendered.value, left: 0, top: 0 });
        continue;
      }

      const resolved = await this.resolveAssetLayer(layer, library);
      if (!resolved.ok) {
        return resolved;
      }
      overlays.push(resolved.value);
    }

    const base = sharp({
      create: { width: this.widthPx, height: this.heightPx, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    });

    try {
      const result = await base.composite(overlays).png().toBuffer();
      return ok(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new ValidationError([`composition render failed: ${message}`]));
    }
  }

  private async resolveAssetLayer(
    layer: AssetLayerSpec,
    library: AssetResolver,
  ): Promise<Result<OverlayOptions, ValidationError>> {
    const asset = library.findBest(layer.query);
    if (asset === null) {
      return err(
        new ValidationError([
          `no asset in the library matches role "${layer.role}" (query: ${JSON.stringify(layer.query)})`,
        ]),
      );
    }

    let buffer: Buffer;
    try {
      buffer = readFileSync(asset.pngPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new ValidationError([`failed to read asset "${asset.id}": ${message}`]));
    }

    let pipeline = sharp(buffer);
    if (layer.widthPx !== undefined || layer.heightPx !== undefined) {
      pipeline = pipeline.resize(layer.widthPx, layer.heightPx, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }
    if (layer.rotationDeg !== undefined && layer.rotationDeg !== 0) {
      pipeline = pipeline.rotate(layer.rotationDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }

    let assetBuffer: Buffer;
    try {
      assetBuffer = await pipeline.png().toBuffer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new ValidationError([`failed to prepare asset "${asset.id}" for compositing: ${message}`]));
    }

    if (layer.opacity !== undefined && layer.opacity < 1) {
      assetBuffer = await applyOpacity(assetBuffer, layer.opacity);
    }

    return ok({
      input: assetBuffer,
      left: Math.round(layer.xPx),
      top: Math.round(layer.yPx),
      ...(layer.blendMode !== undefined ? { blend: layer.blendMode } : {}),
    });
  }
}

/** Scales the alpha channel by `opacity` (0-1) — sharp's `composite()` has no per-layer opacity option of its own. */
async function applyOpacity(pngBuffer: Buffer, opacity: number): Promise<Buffer> {
  const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round((data[i] ?? 0) * opacity);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
