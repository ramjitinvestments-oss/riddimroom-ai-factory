/**
 * Resolves a declarative query (category/tags/style/colors — the same
 * shape the Composition Engine's `addAsset()` accepts) against loaded
 * asset records, picking the best match instead of requiring a literal
 * filename. `category`, `variant`, and `compatibleShirtColor` are hard
 * filters (must match exactly, when given); `style`, `tags`, and `colors`
 * are soft-scored so the closest match wins rather than requiring an
 * exact hit on every optional facet.
 */
import type { AssetRecord } from "./types.ts";

export interface AssetSearchQuery {
  readonly category?: string;
  readonly variant?: string;
  readonly style?: string;
  readonly tags?: readonly string[];
  readonly colors?: readonly string[];
  readonly compatibleShirtColor?: string;
}

/** Matching records sorted best-match-first (ties broken by newest version first). */
export function searchAssets(records: readonly AssetRecord[], query: AssetSearchQuery): AssetRecord[] {
  return records
    .filter((record) => query.category === undefined || record.metadata.category === query.category)
    .filter((record) => query.variant === undefined || record.metadata.variant === query.variant)
    .filter(
      (record) =>
        query.compatibleShirtColor === undefined ||
        record.metadata.compatibleShirtColors.includes(query.compatibleShirtColor),
    )
    .map((record) => ({ record, score: scoreMatch(record, query) }))
    .sort((a, b) => b.score - a.score || b.record.metadata.version - a.record.metadata.version)
    .map(({ record }) => record);
}

/** The single best match for `query`, or `null` if nothing in the library matches its hard filters. */
export function findBestAsset(records: readonly AssetRecord[], query: AssetSearchQuery): AssetRecord | null {
  return searchAssets(records, query)[0] ?? null;
}

function scoreMatch(record: AssetRecord, query: AssetSearchQuery): number {
  let score = 0;
  if (query.style !== undefined && record.metadata.style === query.style) {
    score += 3;
  }
  if (query.tags !== undefined) {
    score += query.tags.filter((tag) => record.metadata.tags.includes(tag)).length;
  }
  if (query.colors !== undefined) {
    score += query.colors.filter((color) => record.metadata.colors.includes(color)).length;
  }
  return score;
}
