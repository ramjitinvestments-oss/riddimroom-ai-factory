import { test } from "node:test";
import assert from "node:assert/strict";
import type { EnvVarSpec } from "../../automation/shared/config.ts";
import {
  CORE_ENV_SPECS,
  loadEnv,
  parseBoolean,
  redact,
  safeConfigSummary,
  validateConfig,
} from "../../automation/shared/config.ts";
import { ConfigError } from "../../automation/shared/errors.ts";

const specs: readonly EnvVarSpec[] = [
  { name: "REQUIRED_VAR", description: "must be set", required: true, secret: false },
  { name: "SECRET_VAR", description: "must be set, hidden in logs", required: true, secret: true },
  {
    name: "OPTIONAL_VAR",
    description: "has a default",
    required: false,
    secret: false,
    default: "fallback",
  },
];

test("validateConfig resolves values present in the source", () => {
  const result = validateConfig(specs, {
    REQUIRED_VAR: "hello",
    SECRET_VAR: "s3cr3t",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value : null, {
    REQUIRED_VAR: "hello",
    SECRET_VAR: "s3cr3t",
    OPTIONAL_VAR: "fallback",
  });
});

test("validateConfig treats a blank string the same as unset", () => {
  const result = validateConfig(specs, {
    REQUIRED_VAR: "",
    SECRET_VAR: "s3cr3t",
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error instanceof ConfigError);
});

test("validateConfig reports every missing required variable, not just the first", () => {
  const result = validateConfig(specs, {});

  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail("expected an Err result");
  }
  assert.deepEqual([...result.error.missing].sort(), ["REQUIRED_VAR", "SECRET_VAR"]);
  assert.match(result.error.message, /REQUIRED_VAR/);
  assert.match(result.error.message, /SECRET_VAR/);
  assert.equal(result.error.code, "CONFIG_ERROR");
});

test("validateConfig never includes a raw secret value in its error message", () => {
  const result = validateConfig(specs, { SECRET_VAR: "should-not-appear-anywhere" });

  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail("expected an Err result");
  }
  assert.doesNotMatch(result.error.message, /should-not-appear-anywhere/);
});

test("safeConfigSummary redacts secret values and passes through non-secret values", () => {
  const result = validateConfig(specs, {
    REQUIRED_VAR: "hello",
    SECRET_VAR: "s3cr3t-token-value",
  });
  assert.ok(result.ok);
  if (!result.ok) {
    return;
  }

  const summary = safeConfigSummary(specs, result.value);

  assert.equal(summary.REQUIRED_VAR, "hello");
  assert.equal(summary.OPTIONAL_VAR, "fallback");
  assert.notEqual(summary.SECRET_VAR, "s3cr3t-token-value");
  assert.doesNotMatch(summary.SECRET_VAR ?? "", /s3cr3t-token-value/);
});

test("safeConfigSummary omits specs with no resolved value", () => {
  const summary = safeConfigSummary(specs, {});
  assert.equal("REQUIRED_VAR" in summary, false);
});

test("redact fully masks values of 4 characters or fewer", () => {
  assert.equal(redact("ab"), "**");
  assert.equal(redact("abcd"), "****");
});

test("redact keeps only the last 4 characters of longer values visible", () => {
  const masked = redact("sk-1234567890abcd");
  assert.ok(masked.endsWith("abcd"));
  assert.doesNotMatch(masked, /1234567890/);
});

test("loadEnv returns Ok when the target file does not exist", () => {
  const result = loadEnv("this-file-does-not-exist.env");
  assert.equal(result.ok, true);
});

test("CORE_ENV_SPECS defaults DRY_RUN to true", () => {
  const result = validateConfig(CORE_ENV_SPECS, {});
  assert.ok(result.ok);
  assert.equal(result.ok ? result.value.DRY_RUN : undefined, "true");
});

test("parseBoolean recognizes true/false case-insensitively", () => {
  assert.equal(parseBoolean("true", false), true);
  assert.equal(parseBoolean("TRUE", false), true);
  assert.equal(parseBoolean("false", true), false);
  assert.equal(parseBoolean("FALSE", true), false);
});

test("parseBoolean falls back for unset or unrecognized values", () => {
  assert.equal(parseBoolean(undefined, true), true);
  assert.equal(parseBoolean(undefined, false), false);
  assert.equal(parseBoolean("1", true), true);
  assert.equal(parseBoolean("yes", false), false);
});
