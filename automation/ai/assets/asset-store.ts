/**
 * Writes a generated asset into the permanent library:
 * `assets/<category>/<variant>/v<N>/{artwork.png,metadata.json,prompt.txt,preview.jpg}`.
 * Every save is a new version — nothing is ever overwritten in place, so
 * "generate once, reuse forever" holds even across regenerations of the
 * same variant (e.g. after a style-rule refinement).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { FileOperationError } from "../../shared/errors.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import type { AssetMetadata, AssetQualitySummary, AssetRecord } from "./types.ts";

const PREVIEW_MAX_DIMENSION = 800;
const VERSION_DIR_PATTERN = /^v(\d+)$/;

export interface SaveAssetInput {
  readonly category: string;
  readonly variant: string;
  readonly style: string;
  readonly colors: readonly string[];
  readonly compatibleShirtColors: readonly string[];
  readonly tags: readonly string[];
  readonly sourcePrompt: string;
  readonly provider: string;
  readonly model: string;
  readonly quality: AssetQualitySummary;
  readonly perceptualHash: string;
  readonly pngBuffer: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface AssetStoreOptions {
  /** Defaults to "assets" at the repo root. */
  readonly root?: string;
  readonly now?: () => Date;
}

/** Next version number for `<root>/<category>/<variant>` — 1 if the variant has never been saved before. */
export function nextVersion(categoryVariantDir: string): number {
  if (!existsSync(categoryVariantDir)) {
    return 1;
  }
  const versions = readdirSync(categoryVariantDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => VERSION_DIR_PATTERN.exec(entry.name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map((n) => Number.parseInt(n, 10));
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

/** Saves a new versioned asset into the library, generating its preview.jpg alongside the source PNG. */
export async function saveAsset(
  input: SaveAssetInput,
  options: AssetStoreOptions = {},
): Promise<Result<AssetRecord, FileOperationError>> {
  const root = options.root ?? "assets";
  const now = options.now ?? ((): Date => new Date());
  const categoryVariantDir = path.join(root, input.category, input.variant);
  const version = nextVersion(categoryVariantDir);
  const versionDir = path.join(categoryVariantDir, `v${version}`);

  const pngPath = path.join(versionDir, "artwork.png");
  const previewPath = path.join(versionDir, "preview.jpg");
  const promptPath = path.join(versionDir, "prompt.txt");
  const metadataPath = path.join(versionDir, "metadata.json");

  const metadata: AssetMetadata = {
    category: input.category,
    variant: input.variant,
    style: input.style,
    colors: input.colors,
    compatibleShirtColors: input.compatibleShirtColors,
    tags: input.tags,
    sourcePrompt: input.sourcePrompt,
    provider: input.provider,
    model: input.model,
    quality: input.quality,
    perceptualHash: input.perceptualHash,
    createdAt: now().toISOString(),
    version,
    width: input.width,
    height: input.height,
  };

  try {
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(pngPath, input.pngBuffer);
    writeFileSync(promptPath, input.sourcePrompt);
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    const preview = await sharp(input.pngBuffer)
      .resize(PREVIEW_MAX_DIMENSION, PREVIEW_MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 245, g: 245, b: 245 } })
      .jpeg({ quality: 82 })
      .toBuffer();
    writeFileSync(previewPath, preview);
  } catch (error) {
    return err(new FileOperationError("write", versionDir, { cause: error }));
  }

  return ok({
    id: `${input.category}/${input.variant}/v${version}`,
    metadata,
    pngPath,
    previewPath,
    promptPath,
    metadataPath,
  });
}
