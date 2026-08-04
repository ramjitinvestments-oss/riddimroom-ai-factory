/**
 * The Collection Director: the new front of the pipeline (Collection
 * Director -> Design Director -> ...). Picks the single best-fitting
 * collection for a product brief by matching against each collection's
 * `keywords` — the exact same deterministic, free, fully-testable
 * approach `../design-director.ts` uses for style selection, applied one
 * level up. Its output then narrows which styles the Design Director is
 * allowed to choose from (via `chooseStyle`'s existing `styles` override),
 * so products in a collection stay visually coordinated instead of each
 * independently rolling the dice on style.
 */
import { COLLECTION_LIBRARY, getCollectionById } from "./library.ts";
import type { CollectionDefinition } from "./types.ts";

/** RiddimRoom's flagship collection — used when a brief doesn't clearly match any collection's keywords. */
export const DEFAULT_COLLECTION_ID = "vintage-jamaican-sound-systems";

export interface CollectionDirectorDecision {
  readonly collection: CollectionDefinition;
  /** Every keyword from the winning collection that matched the brief. */
  readonly matchedKeywords: readonly string[];
  /** True when no collection matched and the default collection was used instead. */
  readonly usedFallback: boolean;
}

export interface ChooseCollectionOptions {
  /** Overridable for tests; defaults to the real collection library. */
  readonly collections?: readonly CollectionDefinition[];
}

/**
 * Picks the collection whose `keywords` has the most matches against
 * `brief` (case-insensitive substring matching). Ties keep whichever
 * collection appears first in `collections`, so results are stable and
 * repeatable. Falls back to `DEFAULT_COLLECTION_ID` when nothing matches.
 */
export function chooseCollection(brief: string, options: ChooseCollectionOptions = {}): CollectionDirectorDecision {
  const collections = options.collections ?? COLLECTION_LIBRARY;
  const normalizedBrief = brief.trim().toLowerCase();

  let bestCollection: CollectionDefinition | undefined;
  let bestMatches: readonly string[] = [];

  for (const collection of collections) {
    const matches = collection.keywords.filter((keyword) => normalizedBrief.includes(keyword.toLowerCase()));
    if (matches.length > bestMatches.length) {
      bestCollection = collection;
      bestMatches = matches;
    }
  }

  const usedFallback = bestCollection === undefined;
  const collection = bestCollection ?? getCollectionById(DEFAULT_COLLECTION_ID) ?? collections[0];
  if (collection === undefined) {
    // Programmer error, not an operational failure — the collection library is never empty in practice.
    throw new Error("chooseCollection: no collections available to choose from");
  }

  return {
    collection,
    matchedKeywords: usedFallback ? [] : bestMatches,
    usedFallback,
  };
}
