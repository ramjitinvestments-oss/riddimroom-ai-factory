/**
 * Stage 1 only ever reports pass/fail, not a confidence score — but the
 * brief wants Stage 2 to also trigger when "confidence score falls into
 * an uncertain range." This derives that signal from how close a passing
 * result sits to its own thresholds: a metric that barely cleared its
 * bound is a weaker signal than one comfortably inside it, even though
 * both currently "pass."
 */
import type { HeuristicMetrics, HeuristicThresholds } from "./types.ts";

const DEFAULT_MARGIN_RATIO = 0.15;

/**
 * True if any bounded metric sits within `marginRatio` of its threshold
 * (as a fraction of the safe band's width), or any lower-bound-only
 * metric sits within `marginRatio` of its floor. Only meaningful to call
 * on a result that already passed Stage 1 — a failing result is never
 * "uncertain," it's simply rejected.
 */
export function isConfidenceUncertain(
  metrics: HeuristicMetrics,
  thresholds: HeuristicThresholds,
  marginRatio: number = DEFAULT_MARGIN_RATIO,
): boolean {
  const boundedChecks: ReadonlyArray<readonly [number, number, number]> = [
    [metrics.transparentRatio, thresholds.minTransparentRatio, thresholds.maxTransparentRatio],
    [metrics.subjectCoverageRatio, thresholds.minSubjectCoverageRatio, thresholds.maxSubjectCoverageRatio],
    [metrics.laplacianStdev, thresholds.minLaplacianStdev, thresholds.maxLaplacianStdev],
  ];

  for (const [value, low, high] of boundedChecks) {
    const span = high - low;
    if (span <= 0) {
      continue;
    }
    const bandWidth = span * marginRatio;
    if (value >= low && value <= low + bandWidth) return true;
    if (value <= high && value >= high - bandWidth) return true;
  }

  // contrastRange only has a floor (no meaningful upper bound), so its
  // "near the boundary" band is measured relative to the floor itself.
  const contrastFloor = thresholds.minContrastRange;
  if (
    metrics.contrastRange >= contrastFloor &&
    metrics.contrastRange <= contrastFloor + contrastFloor * marginRatio
  ) {
    return true;
  }

  return false;
}
