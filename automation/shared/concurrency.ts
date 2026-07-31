/**
 * A minimal bounded-concurrency worker pool — no new dependency, just
 * enough to process a batch (25 shirt concepts, later 25 uploads) with a
 * concurrency cap instead of either serializing everything or firing all
 * 25 requests at once. Needed by at least two batch scripts (generation
 * and upload/publish), which is why this lives in shared rather than
 * being duplicated in each script.
 *
 * `worker` is expected to handle its own errors (return a `Result`, or
 * any error-carrying value) rather than throw — a thrown error here
 * would reject the whole batch's `Promise.all`, defeating the "one
 * failure doesn't stop the other 24" requirement. This function only
 * bounds concurrency; per-item failure isolation is the caller's job.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) {
    throw new RangeError("limit must be at least 1");
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      const item = items[index] as T;
      results[index] = await worker(item, index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));

  return results;
}
