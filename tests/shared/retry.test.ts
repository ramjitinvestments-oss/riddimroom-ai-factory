import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../../automation/shared/retry.ts";

function fakeSleep(recorded: number[]): (ms: number) => Promise<void> {
  return async (ms: number) => {
    recorded.push(ms);
  };
}

test("withRetry returns the value on first success without sleeping", async () => {
  const delays: number[] = [];
  const result = await withRetry(async () => 42, {
    maxAttempts: 3,
    baseDelayMs: 100,
    sleep: fakeSleep(delays),
  });

  assert.equal(result, 42);
  assert.deepEqual(delays, []);
});

test("withRetry retries on failure and returns the value once it succeeds", async () => {
  const delays: number[] = [];
  let attempts = 0;

  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error(`attempt ${attempts} failed`);
      }
      return "ok";
    },
    { maxAttempts: 5, baseDelayMs: 10, sleep: fakeSleep(delays) },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]); // exponential: baseDelayMs * 2^(attempt-1)
});

test("withRetry throws the last error once maxAttempts is exhausted", async () => {
  const delays: number[] = [];
  let attempts = 0;

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw new Error(`attempt ${attempts}`);
        },
        { maxAttempts: 3, baseDelayMs: 5, sleep: fakeSleep(delays) },
      ),
    /attempt 3/,
  );

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5, 10]);
});

test("withRetry stops immediately when isRetryable returns false, without sleeping again", async () => {
  const delays: number[] = [];
  let attempts = 0;

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("permanent failure");
        },
        {
          maxAttempts: 5,
          baseDelayMs: 10,
          sleep: fakeSleep(delays),
          isRetryable: () => false,
        },
      ),
    /permanent failure/,
  );

  assert.equal(attempts, 1);
  assert.deepEqual(delays, []);
});

test("withRetry rejects a maxAttempts less than 1", async () => {
  await assert.rejects(
    () => withRetry(async () => "unreachable", { maxAttempts: 0, baseDelayMs: 10 }),
    RangeError,
  );
});
