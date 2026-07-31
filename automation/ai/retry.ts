/**
 * Generic retry-with-exponential-backoff, scoped to `automation/ai` for
 * now. Printify and Shopify will likely want the same behavior later;
 * this stays local until a second module actually needs it, at which
 * point it's a promotion to `automation/shared`, not a guess made now.
 */

export interface RetryOptions {
  /** Total attempts, including the first call. Must be at least 1. */
  readonly maxAttempts: number;
  /** Delay before the first retry; doubles on each subsequent attempt. */
  readonly baseDelayMs: number;
  /** Whether a given failure should be retried at all. Defaults to always. */
  readonly isRetryable?: (error: unknown) => boolean;
  /** Injectable sleep implementation, so tests don't wait on real timers. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Calls `fn`, retrying on failure up to `maxAttempts` times with
 * exponentially increasing delay (`baseDelayMs * 2^attempt`). Stops
 * immediately (without retrying) once `isRetryable` returns false for a
 * given error, or once `maxAttempts` is reached. The last error is always
 * the one rethrown.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  if (options.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be at least 1");
  }

  const sleep = options.sleep ?? defaultSleep;
  const isRetryable = options.isRetryable ?? ((): boolean => true);

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === options.maxAttempts;
      if (isLastAttempt || !isRetryable(error)) {
        throw error;
      }
      await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }

  // Unreachable: the loop above always either returns or throws.
  throw new Error("withRetry: exhausted attempts without a result");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
