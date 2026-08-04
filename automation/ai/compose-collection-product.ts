/**
 * The full pipeline: Collection Director -> Design Director -> Asset
 * Selection (user-supplied artwork only) -> Composition -> Typography ->
 * a validated print-ready PNG. A thin wrapper around
 * `./compose-shirt-artwork.ts` (left completely unmodified in its own
 * behavior) plus the Collection Director (./collections/): picks a
 * collection, derives a hero category from its asset preferences, and
 * restricts the Design Director to that collection's preferred styles via
 * `composeShirtArtwork`'s existing `allowedStyleIds` hook — so every
 * product generated under one collection stays visually coordinated
 * instead of independently rolling the dice on style.
 */
import { chooseCollection, type CollectionDirectorDecision } from "./collections/collection-director.ts";
import { getCollectionById } from "./collections/library.ts";
import {
  composeShirtArtwork,
  type ComposedArtwork,
  type ComposeShirtArtworkOptions,
} from "./compose-shirt-artwork.ts";
import { ConfigError, ExternalServiceError, FileOperationError, ValidationError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";

export interface ComposeCollectionProductRequest {
  readonly jobId: string;
  /** Feeds the Collection Director (unless `collectionId` is given) and the Design Director. */
  readonly brief: string;
  /** Skips the Collection Director and uses this collection id directly. */
  readonly collectionId?: string;
  /** Overrides the collection's default hero category (its first `assetPreferences` entry). */
  readonly heroCategory?: string;
}

export type ComposeCollectionProductOptions = Omit<ComposeShirtArtworkOptions, "allowedStyleIds">;

export interface ComposedCollectionProduct extends ComposedArtwork {
  readonly collectionDecision: CollectionDirectorDecision;
}

type ComposeCollectionProductError = ConfigError | ExternalServiceError | ValidationError | FileOperationError;

export async function composeCollectionProduct(
  request: ComposeCollectionProductRequest,
  options: ComposeCollectionProductOptions = {},
): Promise<Result<ComposedCollectionProduct, ComposeCollectionProductError>> {
  if (request.jobId.trim().length === 0) {
    return err(new ValidationError(["jobId must not be blank"]));
  }
  if (request.brief.trim().length === 0) {
    return err(new ValidationError(["brief must not be blank"]));
  }

  let collectionDecision: CollectionDirectorDecision;
  if (request.collectionId !== undefined) {
    const collection = getCollectionById(request.collectionId);
    if (collection === undefined) {
      return err(new ValidationError([`unknown collectionId "${request.collectionId}"`]));
    }
    collectionDecision = { collection, matchedKeywords: [], usedFallback: false };
  } else {
    collectionDecision = chooseCollection(request.brief);
  }

  const heroCategory = request.heroCategory ?? collectionDecision.collection.assetPreferences[0];
  if (heroCategory === undefined) {
    return err(
      new ValidationError([
        `collection "${collectionDecision.collection.id}" has no assetPreferences and no heroCategory was given`,
      ]),
    );
  }

  const composed = await composeShirtArtwork(
    { jobId: request.jobId, brief: request.brief, heroCategory },
    { ...options, allowedStyleIds: collectionDecision.collection.preferredStyleIds },
  );
  if (!composed.ok) {
    return err(composed.error);
  }

  return ok({ ...composed.value, collectionDecision });
}
