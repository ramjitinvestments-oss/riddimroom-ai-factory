/**
 * Dry-run implementation of `ArtworkAnalysisProvider`. Produces realistic,
 * fully-valid analysis + copy (run through the same validator the real
 * provider's response is checked against) without any network call or any
 * actual inspection of the image — selected automatically by
 * `createArtworkAnalysisProvider` when `DRY_RUN` is true (the default).
 * Mirrors `./dry-run-product-copy-provider.ts`.
 */
import { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { validateArtworkAnalysis } from "./artwork-analysis-validation.ts";
import type { ArtworkAnalysisProvider, ArtworkAnalysisRequest, ArtworkAnalysisResult } from "./artwork-analysis-types.ts";
import { COLLECTION_LIBRARY } from "./collections/library.ts";
import { STYLE_LIBRARY } from "./styles/library.ts";

export interface DryRunArtworkAnalysisProviderOptions {
  readonly now?: () => Date;
}

const FIRST_COLLECTION = COLLECTION_LIBRARY[0]!;
const FIRST_STYLE = STYLE_LIBRARY[0]!;
const DRY_RUN_TAGS = [
  "caribbean",
  "streetwear",
  "island life",
  "tropical",
  "reggae",
  "vintage",
  "dancehall",
  "sound system",
  "carnival",
  "graphic tee",
];

export class DryRunArtworkAnalysisProvider implements ArtworkAnalysisProvider {
  readonly name = "dry-run";
  private readonly now: () => Date;

  constructor(options: DryRunArtworkAnalysisProviderOptions = {}) {
    this.now = options.now ?? ((): Date => new Date());
  }

  async analyze(
    request: ArtworkAnalysisRequest,
  ): Promise<Result<ArtworkAnalysisResult, ExternalServiceError | ValidationError>> {
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }
    if (request.artworkPng.length === 0) {
      return err(new ValidationError(["artworkPng must not be empty"]));
    }

    const candidate = {
      collectionId: FIRST_COLLECTION.id,
      styleId: FIRST_STYLE.id,
      theme: FIRST_COLLECTION.name,
      keywords: [...FIRST_COLLECTION.keywords],
      title: `${FIRST_COLLECTION.name} Tee`,
      subtitle: "Caribbean Streetwear Collection",
      description:
        `Rep the islands wherever you go. This ${FIRST_COLLECTION.name.toLowerCase()} design brings bold ` +
        "Caribbean energy to everyday streetwear, printed on a premium tee built for comfort and standout " +
        "style. A one-of-a-kind piece for anyone who carries island pride with them.",
      seoTitle: truncateAtWord(`${FIRST_COLLECTION.name} Tee | Caribbean Streetwear`, 70),
      seoDescription: truncateAtWord(`Shop the ${FIRST_COLLECTION.name} tee — original Caribbean streetwear design.`, 160),
      tags: DRY_RUN_TAGS,
    };

    const validated = validateArtworkAnalysis(candidate);
    if (!validated.ok) {
      // Would indicate a bug in this placeholder, not a real operational
      // failure — still surfaced as an Err rather than thrown, per convention.
      return err(validated.error);
    }

    return ok({
      jobId: request.jobId,
      provider: this.name,
      model: "dry-run-placeholder",
      generatedAt: this.now().toISOString(),
      analysis: validated.value,
      metadata: { dryRun: true },
    });
  }
}

/** Truncates to at most `maxLength` characters, cutting at the last whole word rather than mid-word. */
function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim();
}
