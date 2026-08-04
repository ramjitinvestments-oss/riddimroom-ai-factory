/**
 * The single entry point the rest of the engine uses to read from and
 * write to the reusable asset library — wraps `./asset-loader.ts`
 * (discovery), `./asset-search.ts` (querying), and `./asset-store.ts`
 * (saving) behind one object so callers (the Composition Engine, the
 * Asset Generation Engine) never touch the filesystem layout directly.
 */
import { discoverAssets, listCategories, listVariants } from "./asset-loader.ts";
import { findBestAsset, searchAssets, type AssetSearchQuery } from "./asset-search.ts";
import { saveAsset, type SaveAssetInput } from "./asset-store.ts";
import type { AssetRecord } from "./types.ts";
import type { FileOperationError } from "../../shared/errors.ts";
import type { Result } from "../../shared/result.ts";

export interface AssetLibraryOptions {
  /** Defaults to "assets" at the repo root. */
  readonly root?: string;
  readonly now?: () => Date;
}

export class AssetLibrary {
  private readonly root: string;
  private readonly now: (() => Date) | undefined;
  private records: readonly AssetRecord[];

  constructor(options: AssetLibraryOptions = {}) {
    this.root = options.root ?? "assets";
    this.now = options.now;
    this.records = discoverAssets(this.root);
  }

  /** Re-scans the filesystem — call after `save()` from elsewhere, or if assets changed on disk. */
  reload(): void {
    this.records = discoverAssets(this.root);
  }

  all(): readonly AssetRecord[] {
    return this.records;
  }

  categories(): readonly string[] {
    return listCategories(this.records);
  }

  variants(category: string): readonly string[] {
    return listVariants(this.records, category);
  }

  search(query: AssetSearchQuery): readonly AssetRecord[] {
    return searchAssets(this.records, query);
  }

  findBest(query: AssetSearchQuery): AssetRecord | null {
    return findBestAsset(this.records, query);
  }

  /** Perceptual hashes of every currently-loaded asset, for Stage 1 duplicate-detection. */
  hashes(): ReadonlyArray<{ readonly id: string; readonly hash: string }> {
    return this.records.map((record) => ({ id: record.id, hash: record.metadata.perceptualHash }));
  }

  /** Saves a new asset version and reloads so it's immediately visible to subsequent queries. */
  async save(input: SaveAssetInput): Promise<Result<AssetRecord, FileOperationError>> {
    const result = await saveAsset(input, { root: this.root, ...(this.now !== undefined ? { now: this.now } : {}) });
    if (result.ok) {
      this.reload();
    }
    return result;
  }
}
