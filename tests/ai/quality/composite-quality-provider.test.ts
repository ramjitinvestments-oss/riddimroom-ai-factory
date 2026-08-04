import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { CompositeQualityProvider } from "../../../automation/ai/quality/composite-quality-provider.ts";
import { InMemoryVisionSpendLedger } from "../../../automation/ai/quality/vision-budget.ts";
import { ok, err, type Result } from "../../../automation/shared/result.ts";
import type { ExternalServiceError, ValidationError } from "../../../automation/shared/errors.ts";
import { DEFAULT_HEURISTIC_THRESHOLDS } from "../../../automation/ai/quality/heuristic-quality-provider.ts";
import type {
  HeuristicChecker,
  HeuristicCheckResult,
  VisionScore,
  VisionScorer,
} from "../../../automation/ai/quality/types.ts";

function buildRaw(
  width: number,
  height: number,
  painter: (x: number, y: number) => readonly [number, number, number, number],
): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = painter(x, y);
      const o = (y * width + x) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = a;
    }
  }
  return buf;
}

async function goodPng(): Promise<Buffer> {
  const width = 4500;
  const height = 5400;
  const marginX = width * 0.2;
  const marginY = height * 0.25;
  const raw = buildRaw(width, height, (x, y) => {
    if (x < marginX || x > width - marginX || y < marginY || y > height - marginY) return [0, 0, 0, 0];
    const block = (Math.floor(x / 150) + Math.floor(y / 150)) % 2;
    return block === 0 ? [20, 40, 90, 255] : [210, 170, 60, 255];
  });
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function emptyPng(): Promise<Buffer> {
  const width = 4500;
  const height = 5400;
  const raw = buildRaw(width, height, () => [0, 0, 0, 0]);
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

const HIGH_SCORE: VisionScore = {
  overall: 96,
  commercial: 98,
  composition: 95,
  thumbnail: 99,
  printability: 97,
  branding: 94,
  recommendation: "approve",
};

class FakeVisionScorer implements VisionScorer {
  readonly name = "fake-vision";
  calls = 0;
  private readonly result: Result<VisionScore, ExternalServiceError | ValidationError>;

  constructor(result: Result<VisionScore, ExternalServiceError | ValidationError> = ok(HIGH_SCORE)) {
    this.result = result;
  }

  async score(): Promise<Result<VisionScore, ExternalServiceError | ValidationError>> {
    this.calls += 1;
    return this.result;
  }
}

test("a Stage 1 failure short-circuits: vision is never called", async () => {
  const vision = new FakeVisionScorer();
  const provider = new CompositeQualityProvider({ visionProvider: vision });

  const result = await provider.evaluate(await emptyPng(), { isPublishCandidate: true });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.approved, false);
  assert.equal(result.value.shouldRegenerate, true);
  assert.equal(result.value.vision, null);
  assert.equal(vision.calls, 0);
});

test("a Stage 1 pass with no eligibility flags skips vision as not_eligible", async () => {
  const vision = new FakeVisionScorer();
  const provider = new CompositeQualityProvider({ visionProvider: vision });

  const result = await provider.evaluate(await goodPng(), {});

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.approved, true);
  assert.equal(result.value.shouldRegenerate, false);
  assert.equal(result.value.visionSkipReason, "not_eligible");
  assert.equal(vision.calls, 0);
});

test("isPublishCandidate unlocks Stage 2 and a high score is approved", async () => {
  const vision = new FakeVisionScorer();
  const provider = new CompositeQualityProvider({ visionProvider: vision });

  const result = await provider.evaluate(await goodPng(), { isPublishCandidate: true });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.approved, true);
  assert.equal(result.value.shouldRegenerate, false);
  assert.equal(result.value.vision?.overall, 96);
  assert.equal(vision.calls, 1);
});

test("premiumReviewRequested also unlocks Stage 2", async () => {
  const vision = new FakeVisionScorer();
  const provider = new CompositeQualityProvider({ visionProvider: vision });

  await provider.evaluate(await goodPng(), { premiumReviewRequested: true });

  assert.equal(vision.calls, 1);
});

test("a low vision score triggers shouldRegenerate even though Stage 1 passed", async () => {
  const lowScore: VisionScore = { ...HIGH_SCORE, commercial: 50 };
  const vision = new FakeVisionScorer(ok(lowScore));
  const provider = new CompositeQualityProvider({ visionProvider: vision });

  const result = await provider.evaluate(await goodPng(), { isPublishCandidate: true });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.approved, false);
  assert.equal(result.value.shouldRegenerate, true);
});

test("a 'reject' recommendation is not approved even with high scores", async () => {
  const rejected: VisionScore = { ...HIGH_SCORE, recommendation: "reject" };
  const vision = new FakeVisionScorer(ok(rejected));
  const provider = new CompositeQualityProvider({ visionProvider: vision });

  const result = await provider.evaluate(await goodPng(), { isPublishCandidate: true });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.approved, false);
});

test("vision is skipped once the daily budget is exceeded, falling back to the heuristic pass", async () => {
  const vision = new FakeVisionScorer();
  const ledger = new InMemoryVisionSpendLedger();
  ledger.recordSpend(10);
  const provider = new CompositeQualityProvider({ visionProvider: vision, ledger, dailyVisionBudgetUsd: 5 });

  const result = await provider.evaluate(await goodPng(), { isPublishCandidate: true });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.approved, true);
  assert.equal(result.value.visionSkipReason, "budget_exceeded");
  assert.equal(vision.calls, 0);
});

test("without a configured vision provider, Stage 2 never runs even if eligible", async () => {
  const provider = new CompositeQualityProvider();
  const result = await provider.evaluate(await goodPng(), { isPublishCandidate: true });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.approved, true);
  assert.equal(result.value.vision, null);
});

test("a vision provider error propagates as the evaluate() error", async () => {
  const { ValidationError } = await import("../../../automation/shared/errors.ts");
  const vision = new FakeVisionScorer(err(new ValidationError(["vision blew up"])));
  const provider = new CompositeQualityProvider({ visionProvider: vision });

  const result = await provider.evaluate(await goodPng(), { isPublishCandidate: true });

  assert.equal(result.ok, false);
});

function fakeHeuristicChecker(result: HeuristicCheckResult): HeuristicChecker {
  return { check: async () => ok(result) };
}

const BORDERLINE_PASS: HeuristicCheckResult = {
  passed: true,
  failedChecks: [],
  metrics: {
    width: 4500,
    height: 5400,
    aspectRatio: 4500 / 5400,
    // just inside the uncertain band above the 0.10 floor (see confidence.test.ts's own calibration)
    transparentRatio: DEFAULT_HEURISTIC_THRESHOLDS.minTransparentRatio + 0.01,
    subjectCoverageRatio: 0.5,
    edgeTouchesCanvas: false,
    contrastRange: 120,
    laplacianStdev: 40,
    duplicateOfAssetId: null,
  },
};

test("a low-confidence (borderline) Stage 1 pass unlocks Stage 2 even with no explicit flags", async () => {
  const vision = new FakeVisionScorer();
  const provider = new CompositeQualityProvider({
    heuristicProvider: fakeHeuristicChecker(BORDERLINE_PASS),
    visionProvider: vision,
  });

  const result = await provider.evaluate(await goodPng(), {});

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(vision.calls, 1);
  assert.equal(result.value.visionSkipReason, null);
});

test("a comfortably-passing Stage 1 result (no explicit flags) does not unlock Stage 2", async () => {
  const comfortablePass: HeuristicCheckResult = {
    ...BORDERLINE_PASS,
    metrics: { ...BORDERLINE_PASS.metrics, transparentRatio: 0.5 },
  };
  const vision = new FakeVisionScorer();
  const provider = new CompositeQualityProvider({
    heuristicProvider: fakeHeuristicChecker(comfortablePass),
    visionProvider: vision,
  });

  await provider.evaluate(await goodPng(), {});

  assert.equal(vision.calls, 0);
});
