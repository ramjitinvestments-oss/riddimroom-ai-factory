import { test } from "node:test";
import assert from "node:assert/strict";
import { isConfidenceUncertain } from "../../../automation/ai/quality/confidence.ts";
import { DEFAULT_HEURISTIC_THRESHOLDS } from "../../../automation/ai/quality/heuristic-quality-provider.ts";
import type { HeuristicMetrics } from "../../../automation/ai/quality/types.ts";

function metrics(overrides: Partial<HeuristicMetrics> = {}): HeuristicMetrics {
  return {
    width: 4500,
    height: 5400,
    aspectRatio: 4500 / 5400,
    transparentRatio: 0.5,
    subjectCoverageRatio: 0.5,
    edgeTouchesCanvas: false,
    contrastRange: 120,
    laplacianStdev: 40,
    duplicateOfAssetId: null,
    ...overrides,
  };
}

test("comfortably mid-range metrics are not uncertain", () => {
  assert.equal(isConfidenceUncertain(metrics(), DEFAULT_HEURISTIC_THRESHOLDS), false);
});

test("transparentRatio just above its floor is uncertain", () => {
  assert.equal(isConfidenceUncertain(metrics({ transparentRatio: 0.11 }), DEFAULT_HEURISTIC_THRESHOLDS), true);
});

test("transparentRatio just below its ceiling is uncertain", () => {
  assert.equal(isConfidenceUncertain(metrics({ transparentRatio: 0.95 }), DEFAULT_HEURISTIC_THRESHOLDS), true);
});

test("subjectCoverageRatio near its ceiling is uncertain", () => {
  assert.equal(isConfidenceUncertain(metrics({ subjectCoverageRatio: 0.96 }), DEFAULT_HEURISTIC_THRESHOLDS), true);
});

test("laplacianStdev near its floor is uncertain", () => {
  assert.equal(isConfidenceUncertain(metrics({ laplacianStdev: 3 }), DEFAULT_HEURISTIC_THRESHOLDS), true);
});

test("laplacianStdev near its ceiling is uncertain", () => {
  assert.equal(isConfidenceUncertain(metrics({ laplacianStdev: 75 }), DEFAULT_HEURISTIC_THRESHOLDS), true);
});

test("contrastRange just above its floor is uncertain", () => {
  assert.equal(isConfidenceUncertain(metrics({ contrastRange: 26 }), DEFAULT_HEURISTIC_THRESHOLDS), true);
});

test("contrastRange comfortably above its floor is not uncertain", () => {
  assert.equal(isConfidenceUncertain(metrics({ contrastRange: 200 }), DEFAULT_HEURISTIC_THRESHOLDS), false);
});

test("a smaller margin ratio narrows the uncertain band", () => {
  const nearFloor = metrics({ transparentRatio: 0.2 });
  assert.equal(isConfidenceUncertain(nearFloor, DEFAULT_HEURISTIC_THRESHOLDS, 0.15), true);
  assert.equal(isConfidenceUncertain(nearFloor, DEFAULT_HEURISTIC_THRESHOLDS, 0.01), false);
});
