import { test } from "node:test";
import assert from "node:assert/strict";
import { runWithConcurrency } from "../../automation/shared/concurrency.ts";

test("runWithConcurrency processes every item and preserves result order by index", async () => {
  const items = [1, 2, 3, 4, 5];
  const results = await runWithConcurrency(items, 2, async (item) => item * 10);
  assert.deepEqual(results, [10, 20, 30, 40, 50]);
});

test("runWithConcurrency never runs more than `limit` workers at once", async () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  let active = 0;
  let maxActive = 0;

  await runWithConcurrency(items, 3, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return item;
  });

  assert.ok(maxActive <= 3, `expected at most 3 concurrent workers, saw ${maxActive}`);
});

test("runWithConcurrency caps effective concurrency to the item count", async () => {
  const items = [1, 2];
  let active = 0;
  let maxActive = 0;

  await runWithConcurrency(items, 10, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return item;
  });

  assert.equal(maxActive, 2);
});

test("runWithConcurrency returns an empty array for an empty input", async () => {
  const results = await runWithConcurrency([], 5, async (item: number) => item);
  assert.deepEqual(results, []);
});

test("runWithConcurrency propagates a worker's thrown error (callers must catch their own)", async () => {
  await assert.rejects(
    () =>
      runWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) {
          throw new Error("boom");
        }
        return item;
      }),
    /boom/,
  );
});

test("runWithConcurrency rejects a limit less than 1", async () => {
  await assert.rejects(() => runWithConcurrency([1], 0, async (item) => item), RangeError);
});
