/**
 * Stage 1 of the two-stage quality system: deterministic, instant,
 * inexpensive, fully testable pixel analysis — no network call, no AI.
 * Always runs; Stage 2 (./vision-quality-provider.ts) only runs
 * conditionally on top of a Stage 1 pass (see ./composite-quality-provider.ts).
 *
 * Requirement mapping (the 17 named checks from the brief, several of
 * which are the same underlying signal or are covered elsewhere by
 * design rather than by pixel analysis here):
 *   - "artwork touches canvas edge", "cropped subject", "clipped shadows",
 *     "clipped glow effects" -> `touches_canvas_edge` (one alpha-edge scan;
 *     a clipped shadow/glow is, by definition, non-transparent content
 *     touching the canvas edge, so a dedicated shadow/glow-color detector
 *     isn't needed on top of this).
 *   - "transparent area too small" -> `transparent_area_too_small`.
 *   - "transparent area too large", "excessive empty space" -> `transparent_area_too_large`.
 *   - "tiny subject" -> `subject_too_tiny` (bounding-box coverage, a
 *     different signal than raw transparent-pixel ratio: a thin diagonal
 *     shape can have a large bbox but a high transparent ratio).
 *   - "oversized subject" -> `subject_oversized`.
 *   - "low resolution" -> `low_resolution`.
 *   - "invalid aspect ratio" -> `invalid_aspect_ratio`.
 *   - "low contrast" -> `low_contrast` (luminance spread across the subject).
 *   - "blurry" -> `blurry` (low Laplacian-variance, a standard sharpness proxy).
 *   - "excessive noise", "excessive artifacts" -> `excessive_noise_or_artifacts`
 *     (high Laplacian-variance — the opposite tail of the same metric).
 *   - "duplicate design" -> `duplicate_design` (average-hash perceptual
 *     fingerprint compared against the asset library).
 *   - "unreadable generated text" is intentionally NOT a pixel check here.
 *     Asset Generation Engine prompts forbid embedded typography, and all
 *     production text is rendered by the Typography Engine
 *     (../typography/), which enforces a minimum legible size at render
 *     time — a stronger guarantee than OCR-scanning AI output after the
 *     fact, since we control the text rendering directly.
 */
import { ValidationError } from "../../shared/errors.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import { PRINT_HEIGHT, PRINT_WIDTH } from "../prepare-print-ready.ts";
import {
  computeAlphaMetrics,
  computeAverageHash,
  computeContrastRange,
  computeLaplacianStdev,
  decodeRgba,
  hammingDistance,
  type RawRgba,
} from "./pixel-metrics.ts";
import type {
  HeuristicCheckResult,
  HeuristicFailureCode,
  HeuristicThresholds,
  QualityContext,
  QualityProvider,
  QualityVerdict,
} from "./types.ts";

export const DEFAULT_HEURISTIC_THRESHOLDS: HeuristicThresholds = {
  minWidth: PRINT_WIDTH,
  minHeight: PRINT_HEIGHT,
  aspectRatioMin: PRINT_WIDTH / PRINT_HEIGHT - 0.02,
  aspectRatioMax: PRINT_WIDTH / PRINT_HEIGHT + 0.02,
  minTransparentRatio: 0.1,
  maxTransparentRatio: 0.96,
  minSubjectCoverageRatio: 0.02,
  maxSubjectCoverageRatio: 0.97,
  edgeBandPx: 8,
  alphaThreshold: 10,
  minContrastRange: 25,
  minLaplacianStdev: 2,
  maxLaplacianStdev: 80,
  duplicateHashDistance: 4,
};

export interface HeuristicQualityProviderOptions {
  readonly thresholds?: Partial<HeuristicThresholds>;
}

export class HeuristicQualityProvider implements QualityProvider {
  readonly name = "heuristic";
  private readonly thresholds: HeuristicThresholds;

  constructor(options: HeuristicQualityProviderOptions = {}) {
    this.thresholds = { ...DEFAULT_HEURISTIC_THRESHOLDS, ...options.thresholds };
  }

  async evaluate(
    imageBuffer: Buffer,
    context: QualityContext = {},
  ): Promise<Result<QualityVerdict, ValidationError>> {
    const result = await this.check(imageBuffer, context.existingAssetHashes ?? []);
    if (!result.ok) {
      return result;
    }
    const heuristic = result.value;
    return ok({
      approved: heuristic.passed,
      shouldRegenerate: !heuristic.passed,
      heuristic,
      vision: null,
      visionSkipReason: "not_eligible",
    });
  }

  /** Runs Stage 1 alone, without wrapping the result as a full `QualityVerdict`. */
  async check(
    imageBuffer: Buffer,
    existingAssetHashes: readonly { readonly id: string; readonly hash: string }[] = [],
  ): Promise<Result<HeuristicCheckResult, ValidationError>> {
    let image: RawRgba;
    try {
      image = await decodeRgba(imageBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new ValidationError([`failed to decode image for quality analysis: ${message}`]));
    }

    const t = this.thresholds;
    const alpha = computeAlphaMetrics(image, t.alphaThreshold, t.edgeBandPx);
    const { contrastRange } = computeContrastRange(image, t.alphaThreshold);
    const laplacianStdev = await computeLaplacianStdev(imageBuffer);
    const hash = await computeAverageHash(imageBuffer);
    const duplicate =
      existingAssetHashes.find((asset) => hammingDistance(asset.hash, hash) <= t.duplicateHashDistance) ?? null;

    const aspectRatio = image.width / image.height;
    const failedChecks: HeuristicFailureCode[] = [];

    if (alpha.edgeTouchesCanvas) failedChecks.push("touches_canvas_edge");
    if (alpha.transparentRatio < t.minTransparentRatio) failedChecks.push("transparent_area_too_small");
    if (alpha.transparentRatio > t.maxTransparentRatio) failedChecks.push("transparent_area_too_large");
    if (alpha.subjectCoverageRatio < t.minSubjectCoverageRatio) failedChecks.push("subject_too_tiny");
    if (alpha.subjectCoverageRatio > t.maxSubjectCoverageRatio) failedChecks.push("subject_oversized");
    if (image.width < t.minWidth || image.height < t.minHeight) failedChecks.push("low_resolution");
    if (aspectRatio < t.aspectRatioMin || aspectRatio > t.aspectRatioMax) failedChecks.push("invalid_aspect_ratio");
    if (contrastRange < t.minContrastRange) failedChecks.push("low_contrast");
    if (laplacianStdev < t.minLaplacianStdev) failedChecks.push("blurry");
    if (laplacianStdev > t.maxLaplacianStdev) failedChecks.push("excessive_noise_or_artifacts");
    if (duplicate !== null) failedChecks.push("duplicate_design");

    return ok({
      passed: failedChecks.length === 0,
      failedChecks,
      metrics: {
        width: image.width,
        height: image.height,
        aspectRatio,
        transparentRatio: alpha.transparentRatio,
        subjectCoverageRatio: alpha.subjectCoverageRatio,
        edgeTouchesCanvas: alpha.edgeTouchesCanvas,
        contrastRange,
        laplacianStdev,
        duplicateOfAssetId: duplicate?.id ?? null,
      },
    });
  }
}
