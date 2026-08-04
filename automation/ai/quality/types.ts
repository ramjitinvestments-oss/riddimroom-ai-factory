/**
 * Shared types for the two-stage quality system: Stage 1 (deterministic,
 * always run) and Stage 2 (AI vision, conditional). See
 * `./heuristic-quality-provider.ts` and `./vision-quality-provider.ts`.
 */
import type { ExternalServiceError, ValidationError } from "../../shared/errors.ts";
import type { Result } from "../../shared/result.ts";

/** Raw measurements Stage 1 computed, kept around for logging/debugging/threshold-tuning. */
export interface HeuristicMetrics {
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
  /** Fraction (0-1) of pixels below the alpha-transparency threshold. */
  readonly transparentRatio: number;
  /** Bounding-box area of non-transparent pixels, as a fraction (0-1) of the canvas area. */
  readonly subjectCoverageRatio: number;
  /** True if non-transparent pixels are present within the edge band on any side. */
  readonly edgeTouchesCanvas: boolean;
  /** Luminance spread (0-255) across non-transparent pixels. */
  readonly contrastRange: number;
  /** Standard deviation of a Laplacian-convolved luminance map — a detail/edge-energy proxy. */
  readonly laplacianStdev: number;
  /** id of the existing library asset this duplicates, if any. */
  readonly duplicateOfAssetId: string | null;
}

/** Named Stage-1 failure reasons. See heuristic-quality-provider.ts's doc comment for the full checklist mapping. */
export type HeuristicFailureCode =
  | "touches_canvas_edge"
  | "transparent_area_too_small"
  | "transparent_area_too_large"
  | "subject_too_tiny"
  | "subject_oversized"
  | "low_resolution"
  | "invalid_aspect_ratio"
  | "low_contrast"
  | "blurry"
  | "excessive_noise_or_artifacts"
  | "duplicate_design";

export interface HeuristicCheckResult {
  readonly passed: boolean;
  readonly failedChecks: readonly HeuristicFailureCode[];
  readonly metrics: HeuristicMetrics;
}

export interface HeuristicThresholds {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly aspectRatioMin: number;
  readonly aspectRatioMax: number;
  readonly minTransparentRatio: number;
  readonly maxTransparentRatio: number;
  readonly minSubjectCoverageRatio: number;
  readonly maxSubjectCoverageRatio: number;
  readonly edgeBandPx: number;
  readonly alphaThreshold: number;
  readonly minContrastRange: number;
  readonly minLaplacianStdev: number;
  readonly maxLaplacianStdev: number;
  readonly duplicateHashDistance: number;
}

/** Structured output of the Stage 2 AI vision judge — exactly the fields the model is asked to return. */
export interface VisionScore {
  readonly overall: number;
  readonly commercial: number;
  readonly composition: number;
  readonly thumbnail: number;
  readonly printability: number;
  readonly branding: number;
  readonly recommendation: "approve" | "reject" | "review";
}

export type VisionSkipReason = "not_eligible" | "budget_exceeded";

/** What the vision judge is told it's grading — category/style, for a more specific prompt. */
export interface VisionPromptContext {
  readonly category?: string;
  readonly styleId?: string;
}

export interface QualityContext {
  /** Marks this asset as a real publish candidate — one of the three conditions that unlocks Stage 2. */
  readonly isPublishCandidate?: boolean;
  /** An explicit human request for a Premium Review — another condition that unlocks Stage 2. */
  readonly premiumReviewRequested?: boolean;
  /** Hashes of assets already in the library, for duplicate detection. */
  readonly existingAssetHashes?: readonly { readonly id: string; readonly hash: string }[];
  /** Forwarded to the vision judge's prompt when Stage 2 runs. */
  readonly visionContext?: VisionPromptContext;
}

export interface QualityVerdict {
  readonly approved: boolean;
  readonly shouldRegenerate: boolean;
  readonly heuristic: HeuristicCheckResult;
  readonly vision: VisionScore | null;
  readonly visionSkipReason: VisionSkipReason | null;
}

export interface QualityProvider {
  readonly name: string;
  evaluate(
    imageBuffer: Buffer,
    context?: QualityContext,
  ): Promise<Result<QualityVerdict, ValidationError | ExternalServiceError>>;
}

/** What `CompositeQualityProvider` needs from a Stage 1 gate — `HeuristicQualityProvider` implements this. */
export interface HeuristicChecker {
  check(
    imageBuffer: Buffer,
    existingAssetHashes?: readonly { readonly id: string; readonly hash: string }[],
  ): Promise<Result<HeuristicCheckResult, ValidationError>>;
}

/** What `CompositeQualityProvider` needs from a Stage 2 judge — `VisionQualityProvider` implements this. */
export interface VisionScorer {
  readonly name: string;
  score(
    imageBuffer: Buffer,
    context?: VisionPromptContext,
  ): Promise<Result<VisionScore, ValidationError | ExternalServiceError>>;
}
