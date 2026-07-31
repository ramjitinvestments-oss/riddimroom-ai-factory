/**
 * Small env-parsing helpers shared by provider factories. Originally
 * scoped to `automation/ai`; promoted here once `automation/printify`
 * needed the identical helper — platform modules aren't allowed to
 * import from each other.
 */

/** Parses a positive integer from an env var string, falling back for anything unset/invalid. */
export function parseIntWithFallback(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
