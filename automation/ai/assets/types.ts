/**
 * The reusable Asset Library's data model. Nothing here hardcodes a
 * category list — `category`/`variant` are free-form strings the
 * filesystem layout and metadata agree on, discovered at runtime by
 * `./asset-loader.ts` rather than declared as an enum. This is what lets
 * a brand-new category show up automatically without touching this file
 * or the Composition Engine.
 */
import type { VisionScore } from "../quality/types.ts";

export interface AssetQualitySummary {
  readonly heuristicPassed: boolean;
  readonly vision: VisionScore | null;
}

export interface AssetMetadata {
  readonly category: string;
  readonly variant: string;
  /** Style id from the Style Library (../styles/library.ts) this asset was art-directed under. */
  readonly style: string;
  readonly colors: readonly string[];
  readonly compatibleShirtColors: readonly string[];
  readonly tags: readonly string[];
  readonly sourcePrompt: string;
  readonly provider: string;
  readonly model: string;
  readonly quality: AssetQualitySummary;
  /** Average-hash perceptual fingerprint, stored so duplicate detection doesn't need to re-decode every asset's PNG on every check. */
  readonly perceptualHash: string;
  readonly createdAt: string; // ISO 8601
  readonly version: number;
  readonly width: number;
  readonly height: number;
}

export interface AssetRecord {
  /** `${category}/${variant}/v${version}` — stable, human-readable, filesystem-derived. */
  readonly id: string;
  readonly metadata: AssetMetadata;
  readonly pngPath: string;
  readonly previewPath: string;
  readonly promptPath: string;
  readonly metadataPath: string;
}
