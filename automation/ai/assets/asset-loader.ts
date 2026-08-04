/**
 * Discovers every asset already saved under the library root by walking
 * the filesystem — `<root>/<category>/<variant>/v<N>/metadata.json` —
 * rather than reading from any hardcoded category list. A brand-new
 * category folder is picked up automatically the next time this runs.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { AssetMetadata, AssetRecord } from "./types.ts";

const VERSION_DIR_PATTERN = /^v\d+$/;

/** Loads every valid asset record found under `root`. Malformed entries (unreadable/invalid metadata.json) are skipped, not fatal. */
export function discoverAssets(root: string = "assets"): AssetRecord[] {
  if (!existsSync(root)) {
    return [];
  }

  const records: AssetRecord[] = [];

  for (const categoryEntry of listDirectories(root)) {
    const categoryDir = path.join(root, categoryEntry);
    for (const variantEntry of listDirectories(categoryDir)) {
      const variantDir = path.join(categoryDir, variantEntry);
      for (const versionEntry of listDirectories(variantDir)) {
        if (!VERSION_DIR_PATTERN.test(versionEntry)) {
          continue;
        }
        const record = loadRecord(categoryEntry, variantEntry, versionEntry, path.join(variantDir, versionEntry));
        if (record !== null) {
          records.push(record);
        }
      }
    }
  }

  return records;
}

function loadRecord(category: string, variant: string, versionDirName: string, versionDir: string): AssetRecord | null {
  const metadataPath = path.join(versionDir, "metadata.json");
  if (!existsSync(metadataPath)) {
    return null;
  }
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as AssetMetadata;
    return {
      id: `${category}/${variant}/${versionDirName}`,
      metadata,
      pngPath: path.join(versionDir, "artwork.png"),
      previewPath: path.join(versionDir, "preview.jpg"),
      promptPath: path.join(versionDir, "prompt.txt"),
      metadataPath,
    };
  } catch {
    return null;
  }
}

function listDirectories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** Distinct categories present in `records`, discovered — never a fixed list. */
export function listCategories(records: readonly AssetRecord[]): string[] {
  return [...new Set(records.map((r) => r.metadata.category))].sort();
}

/** Distinct variants within `category` present in `records`. */
export function listVariants(records: readonly AssetRecord[], category: string): string[] {
  return [...new Set(records.filter((r) => r.metadata.category === category).map((r) => r.metadata.variant))].sort();
}
