/**
 * Generic secret-redaction primitives, shared by config loading
 * (`./config.ts`, which knows exactly which env vars are secret via
 * `EnvVarSpec.secret`) and structured logging (`./logger.ts`, which has to
 * redact arbitrary caller-supplied metadata by key name instead).
 */

/** Key name fragments treated as sensitive; matching keys are redacted automatically. */
const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|pwd|api[-_]?key|apikey|cookie|session|authorization|credential/i;

/** True if a property name looks like it holds a credential/secret. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Masks a secret value for safe display, keeping just enough of the tail
 * to distinguish one configured secret from another in logs (e.g. to tell
 * "is this the old key or the new one" apart) without exposing it.
 */
export function redact(value: string): string {
  if (value.length <= 4) {
    return "*".repeat(value.length);
  }
  const visible = value.slice(-4);
  return `${"*".repeat(Math.min(value.length - 4, 8))}${visible}`;
}

/**
 * Recursively walks a value and returns a deep copy with every property
 * whose key looks sensitive (token, password, cookie, ...) replaced by a
 * redacted placeholder. Used so log metadata is safe to print/persist
 * without every call site having to remember to redact manually.
 *
 * This redacts by *key name*, not by scanning free text: a secret
 * embedded directly in a log `message` string rather than passed under a
 * recognizable metadata key will not be caught. Callers should always put
 * credentials in metadata under a descriptive key (e.g. `apiKey`), never
 * interpolated into the message.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(source)) {
      if (isSensitiveKey(key)) {
        result[key] = typeof val === "string" ? redact(val) : "[REDACTED]";
      } else {
        result[key] = redactSecrets(val);
      }
    }
    return result;
  }

  return value;
}
