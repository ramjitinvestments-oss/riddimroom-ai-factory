import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFloatWithFallback, parseIntWithFallback } from "../../automation/shared/env-helpers.ts";

test("parseFloatWithFallback parses a valid float", () => {
  assert.equal(parseFloatWithFallback("0.35", 0.5), 0.35);
});

test("parseFloatWithFallback accepts 0 as a valid parsed value (not treated as falsy/invalid)", () => {
  assert.equal(parseFloatWithFallback("0", 0.5), 0);
});

test("parseFloatWithFallback falls back on undefined", () => {
  assert.equal(parseFloatWithFallback(undefined, 0.5), 0.5);
});

test("parseFloatWithFallback falls back on a blank string", () => {
  assert.equal(parseFloatWithFallback("  ", 0.5), 0.5);
});

test("parseFloatWithFallback falls back on a non-numeric string", () => {
  assert.equal(parseFloatWithFallback("not-a-number", 0.5), 0.5);
});

test("parseIntWithFallback still falls back on 0 (unlike parseFloatWithFallback) — documents the existing, deliberately different int behavior", () => {
  assert.equal(parseIntWithFallback("0", 5), 5);
});
