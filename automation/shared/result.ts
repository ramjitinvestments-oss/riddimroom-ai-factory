/**
 * Typed result of an operation that can fail in an expected way.
 *
 * Convention for this codebase: public functions return `Result<T, E>` for
 * *expected* failure modes (bad input, missing file, unreachable service,
 * invalid config) instead of throwing. Throwing stays reserved for
 * programmer errors — invariant violations, "this should never happen"
 * conditions — which indicate a bug and should propagate rather than be
 * silently handled as if they were a normal outcome.
 */
export type Result<T, E extends Error = Error> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E extends Error = Error> {
  readonly ok: false;
  readonly error: E;
}

/** Wraps a success value. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wraps an expected failure. */
export function err<E extends Error>(error: E): Err<E> {
  return { ok: false, error };
}

/** Narrows a `Result` to `Ok`. */
export function isOk<T, E extends Error>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Narrows a `Result` to `Err`. */
export function isErr<T, E extends Error>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Transforms the success value of a `Result`, leaving an `Err` untouched. */
export function map<T, U, E extends Error>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Transforms the error of a `Result`, leaving an `Ok` untouched. */
export function mapErr<T, E extends Error, F extends Error>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Returns the success value, or `fallback` if the result is an `Err`. */
export function unwrapOr<T, E extends Error>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
