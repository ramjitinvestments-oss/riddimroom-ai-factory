import { test } from "node:test";
import assert from "node:assert/strict";
import { validateVisionScore } from "../../../automation/ai/quality/vision-validation.ts";

const VALID = {
  overall: 96,
  commercial: 98,
  composition: 95,
  thumbnail: 99,
  printability: 97,
  branding: 94,
  recommendation: "approve",
};

test("accepts a fully valid score", () => {
  const result = validateVisionScore(VALID);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.overall, 96);
    assert.equal(result.value.recommendation, "approve");
  }
});

test("rejects a non-object", () => {
  const result = validateVisionScore("not an object");
  assert.equal(result.ok, false);
});

test("rejects a missing numeric field", () => {
  const { overall: _overall, ...rest } = VALID;
  const result = validateVisionScore(rest);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /overall/);
  }
});

test("rejects an out-of-range score", () => {
  const result = validateVisionScore({ ...VALID, commercial: 150 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /commercial/);
  }
});

test("rejects a negative score", () => {
  const result = validateVisionScore({ ...VALID, branding: -1 });
  assert.equal(result.ok, false);
});

test("rejects an invalid recommendation value", () => {
  const result = validateVisionScore({ ...VALID, recommendation: "maybe" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /recommendation/);
  }
});

test("accepts recommendation values reject and review", () => {
  assert.equal(validateVisionScore({ ...VALID, recommendation: "reject" }).ok, true);
  assert.equal(validateVisionScore({ ...VALID, recommendation: "review" }).ok, true);
});
