import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitiveKey, redact, redactSecrets } from "../../automation/shared/redact.ts";

test("isSensitiveKey recognizes common secret-shaped key names", () => {
  for (const key of [
    "apiKey",
    "API_KEY",
    "token",
    "accessToken",
    "password",
    "pwd",
    "cookie",
    "sessionId",
    "Authorization",
    "credential",
  ]) {
    assert.equal(isSensitiveKey(key), true, `expected "${key}" to be treated as sensitive`);
  }
});

test("isSensitiveKey leaves ordinary key names alone", () => {
  for (const key of ["message", "jobId", "stage", "filePath", "count"]) {
    assert.equal(isSensitiveKey(key), false, `expected "${key}" not to be treated as sensitive`);
  }
});

test("redact fully masks short values and keeps only the last 4 characters of longer ones", () => {
  assert.equal(redact("ab"), "**");
  const masked = redact("sk-1234567890abcd");
  assert.ok(masked.endsWith("abcd"));
  assert.doesNotMatch(masked, /1234567890/);
});

test("redactSecrets masks a string value under a sensitive key", () => {
  const result = redactSecrets({ apiKey: "sk-1234567890abcd", message: "hello" }) as Record<
    string,
    unknown
  >;
  assert.notEqual(result.apiKey, "sk-1234567890abcd");
  assert.doesNotMatch(String(result.apiKey), /1234567890/);
  assert.equal(result.message, "hello");
});

test("redactSecrets replaces a non-string sensitive value with a fixed placeholder", () => {
  const result = redactSecrets({ token: { raw: "should-not-appear" } }) as Record<string, unknown>;
  assert.equal(result.token, "[REDACTED]");
});

test("redactSecrets recurses into nested objects", () => {
  const result = redactSecrets({
    request: { headers: { authorization: "Bearer abcdefghijk" } },
  }) as { request: { headers: { authorization: string } } };

  assert.notEqual(result.request.headers.authorization, "Bearer abcdefghijk");
});

test("redactSecrets recurses into arrays", () => {
  const result = redactSecrets([{ password: "hunter2222" }, { message: "fine" }]) as Array<
    Record<string, unknown>
  >;

  assert.notEqual(result[0]?.password, "hunter2222");
  assert.equal(result[1]?.message, "fine");
});

test("redactSecrets leaves non-sensitive primitive values untouched", () => {
  assert.equal(redactSecrets("plain string"), "plain string");
  assert.equal(redactSecrets(42), 42);
  assert.equal(redactSecrets(null), null);
});
