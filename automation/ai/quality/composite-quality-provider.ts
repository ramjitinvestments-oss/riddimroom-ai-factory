/**
 * The real `QualityProvider` the rest of the pipeline uses: Stage 1
 * (`./heuristic-quality-provider.ts`) always runs; Stage 2
 * (`./vision-quality-provider.ts`) only runs when Stage 1 passed AND
 * (the asset is a publish candidate OR a human requested Premium Review
 * OR the Stage 1 result is low-confidence — see `./confidence.ts`), AND
 * today's vision budget (`./vision-budget.ts`) hasn't been exceeded.
 */
import { ConsoleTransport } from "../../shared/log-transport.ts";
import { Logger } from "../../shared/logger.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import type { ExternalServiceError, ValidationError } from "../../shared/errors.ts";
import { isConfidenceUncertain } from "./confidence.ts";
import {
  DEFAULT_HEURISTIC_THRESHOLDS,
  HeuristicQualityProvider,
  type HeuristicQualityProviderOptions,
} from "./heuristic-quality-provider.ts";
import { DEFAULT_DAILY_VISION_BUDGET_USD, isBudgetExceeded, type VisionSpendLedger } from "./vision-budget.ts";
import type {
  HeuristicChecker,
  HeuristicThresholds,
  QualityContext,
  QualityProvider,
  QualityVerdict,
  VisionScorer,
} from "./types.ts";

type NumericVisionField = "overall" | "commercial" | "composition" | "thumbnail" | "printability" | "branding";

/**
 * A passing asset regenerates anyway if the vision judge scores any of
 * these below its floor.
 *
 * Calibrated against real gpt-4o-mini output (production validation,
 * 2026-08-01): a heuristically-clean, genuinely well-composed asset that
 * the judge itself recommended "approve" scored overall=85, commercial=80,
 * thumbnail=82, printability=88. The original 92/95/95/95 floors assumed
 * approved work clusters near-perfect (matching the illustrative example
 * in this system's spec), but that's not how this model actually scores
 * real output — at those floors, nothing could ever pass, regardless of
 * quality. These floors instead sit with real margin below that validated
 * sample, so content at least as good as it still passes while content
 * clearly worse still regenerates.
 */
const REGENERATE_IF_BELOW: Partial<Record<NumericVisionField, number>> = {
  overall: 70,
  commercial: 65,
  thumbnail: 65,
  printability: 70,
};

export interface CompositeQualityProviderOptions {
  readonly heuristicProvider?: HeuristicChecker;
  readonly heuristicOptions?: HeuristicQualityProviderOptions;
  /** Omit to run Stage 1 only (e.g. no OpenAI credentials configured) — Stage 2 is then always skipped. */
  readonly visionProvider?: VisionScorer;
  readonly ledger?: VisionSpendLedger;
  readonly dailyVisionBudgetUsd?: number;
  readonly confidenceMarginRatio?: number;
  readonly logger?: Logger;
}

export class CompositeQualityProvider implements QualityProvider {
  readonly name = "composite";
  private readonly heuristicProvider: HeuristicChecker;
  private readonly heuristicThresholds: HeuristicThresholds;
  private readonly visionProvider: VisionScorer | undefined;
  private readonly ledger: VisionSpendLedger | undefined;
  private readonly dailyVisionBudgetUsd: number;
  private readonly confidenceMarginRatio: number | undefined;
  private readonly logger: Logger;

  constructor(options: CompositeQualityProviderOptions = {}) {
    this.heuristicProvider = options.heuristicProvider ?? new HeuristicQualityProvider(options.heuristicOptions);
    this.heuristicThresholds = { ...DEFAULT_HEURISTIC_THRESHOLDS, ...options.heuristicOptions?.thresholds };
    this.visionProvider = options.visionProvider;
    this.ledger = options.ledger;
    this.dailyVisionBudgetUsd = options.dailyVisionBudgetUsd ?? DEFAULT_DAILY_VISION_BUDGET_USD;
    this.confidenceMarginRatio = options.confidenceMarginRatio;
    this.logger =
      options.logger ?? new Logger({ module: "automation/ai/quality", transports: [new ConsoleTransport()] });
  }

  async evaluate(
    imageBuffer: Buffer,
    context: QualityContext = {},
  ): Promise<Result<QualityVerdict, ValidationError | ExternalServiceError>> {
    const heuristicResult = await this.heuristicProvider.check(imageBuffer, context.existingAssetHashes ?? []);
    if (!heuristicResult.ok) {
      return heuristicResult;
    }
    const heuristic = heuristicResult.value;

    if (!heuristic.passed) {
      this.logger.info("Stage 1 heuristic check failed", { metadata: { failedChecks: heuristic.failedChecks } });
      return ok({ approved: false, shouldRegenerate: true, heuristic, vision: null, visionSkipReason: null });
    }

    const eligibleForVision =
      context.isPublishCandidate === true ||
      context.premiumReviewRequested === true ||
      isConfidenceUncertain(heuristic.metrics, this.heuristicThresholds, this.confidenceMarginRatio);

    if (!eligibleForVision || this.visionProvider === undefined) {
      return ok({ approved: true, shouldRegenerate: false, heuristic, vision: null, visionSkipReason: "not_eligible" });
    }

    const todaySpend = this.ledger?.todaySpend() ?? 0;
    if (isBudgetExceeded(todaySpend, this.dailyVisionBudgetUsd)) {
      this.logger.warn("AI Vision skipped due to budget.", {
        metadata: { todaySpend, dailyVisionBudgetUsd: this.dailyVisionBudgetUsd },
      });
      return ok({ approved: true, shouldRegenerate: false, heuristic, vision: null, visionSkipReason: "budget_exceeded" });
    }

    const visionResult = await this.visionProvider.score(imageBuffer, context.visionContext ?? {});
    if (!visionResult.ok) {
      return err(visionResult.error);
    }
    const vision = visionResult.value;

    const shouldRegenerate = (Object.entries(REGENERATE_IF_BELOW) as [NumericVisionField, number][]).some(
      ([field, floor]) => vision[field] < floor,
    );
    const approved = !shouldRegenerate && vision.recommendation !== "reject";

    return ok({ approved, shouldRegenerate, heuristic, vision, visionSkipReason: null });
  }
}
