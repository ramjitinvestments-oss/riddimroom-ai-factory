import { test } from "node:test";
import assert from "node:assert/strict";
import { err, isErr, isOk, map, mapErr, ok, unwrapOr } from "../../automation/shared/result.ts";

test("ok() produces an Ok result carrying the value", () => {
  const result = ok(42);
  assert.equal(result.ok, true);
  assert.equal(result.value, 42);
});

test("err() produces an Err result carrying the error", () => {
  const error = new Error("boom");
  const result = err(error);
  assert.equal(result.ok, false);
  assert.equal(result.error, error);
});

test("isOk / isErr narrow correctly", () => {
  const okResult = ok("value");
  const errResult = err(new Error("boom"));

  assert.equal(isOk(okResult), true);
  assert.equal(isErr(okResult), false);
  assert.equal(isOk(errResult), false);
  assert.equal(isErr(errResult), true);
});

test("map transforms an Ok value and leaves Err untouched", () => {
  const doubled = map(ok(2), (n) => n * 2);
  assert.equal(doubled.ok, true);
  assert.equal(doubled.ok ? doubled.value : null, 4);

  const original = err(new Error("boom"));
  const mapped = map(original, (n: number) => n * 2);
  assert.equal(mapped, original);
});

test("mapErr transforms an Err and leaves Ok untouched", () => {
  const original = err(new Error("boom"));
  const mapped = mapErr(original, (e) => new Error(`wrapped: ${e.message}`));
  assert.equal(mapped.ok, false);
  assert.equal(mapped.ok ? null : mapped.error.message, "wrapped: boom");

  const okResult = ok(5);
  const untouched = mapErr(okResult, (e: Error) => new Error(`wrapped: ${e.message}`));
  assert.equal(untouched, okResult);
});

test("unwrapOr returns the value for Ok and the fallback for Err", () => {
  assert.equal(unwrapOr(ok(10), 0), 10);
  assert.equal(unwrapOr(err(new Error("boom")), 0), 0);
});
