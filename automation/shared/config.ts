/**
 * Configuration loading and validation.
 *
 * This module is deliberately generic: it does not know about Shopify,
 * Printify, or any other integration. Each `automation/<platform>/` module
 * owns its own `EnvVarSpec[]` describing exactly which environment
 * variables it needs, and calls `validateConfig()` with that list when it
 * initializes. `automation/shared/config.ts` only provides the shared
 * mechanics: loading `.env`, validating a spec list against `process.env`,
 * and making sure secret values never end up in logs or error messages.
 *
 * No platform module exists yet (Phase 1A is foundations-only), so the
 * only spec defined here is `CORE_ENV_SPECS` — the handful of variables
 * that cross-cut every module (e.g. `LOG_LEVEL`).
 *
 * Missing/blank configuration is an expected operational failure, not a
 * programmer error, so both `loadEnv` and `validateConfig` report it via
 * `Result` instead of throwing.
 */
import { ConfigError, FileOperationError } from "./errors.ts";
import { redact } from "./redact.ts";
import { err, ok, type Result } from "./result.ts";

export { redact } from "./redact.ts";

/** Describes one environment variable a module depends on. */
export interface EnvVarSpec {
  /** Exact environment variable name, e.g. "SHOPIFY_API_VERSION". */
  readonly name: string;
  /** Human-readable purpose, used in error messages and documentation. */
  readonly description: string;
  /** If true, `validateConfig` reports an `Err` when this variable is unset/blank. */
  readonly required: boolean;
  /**
   * If true, the resolved value is masked wherever config is surfaced for
   * logging or diagnostics (`safeConfigSummary`). Never set this to false
   * for credentials, tokens, or API keys.
   */
  readonly secret: boolean;
  /** Value used when the variable is unset and not required. */
  readonly default?: string;
}

/** Cross-cutting variables every module may rely on, independent of any one integration. */
export const CORE_ENV_SPECS: readonly EnvVarSpec[] = [
  {
    name: "NODE_ENV",
    description: "Runtime environment (development, production, test).",
    required: false,
    secret: false,
    default: "development",
  },
  {
    name: "LOG_LEVEL",
    description: "Minimum log level to emit (debug, info, warn, error).",
    required: false,
    secret: false,
    default: "info",
  },
  {
    name: "DRY_RUN",
    description:
      "When true (the default), every external-service provider runs in dry-run mode: " +
      "no real network calls, realistic mock responses instead. Set to false only once " +
      "real credentials are configured.",
    required: false,
    secret: false,
    default: "true",
  },
];

/**
 * Parses a `"true"`/`"false"`-shaped config string into a boolean, falling
 * back to `fallback` for anything else (unset, blank, or unrecognized).
 * Comparison is case-insensitive; only the literal words `"true"` and
 * `"false"` are recognized; e.g. `"1"`/`"0"` are not.
 */
export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return fallback;
}

/**
 * Loads a `.env` file into `process.env` if one exists at `path`.
 *
 * This is a thin, dependency-free wrapper around Node's built-in
 * `process.loadEnvFile`. A missing file is not itself an error: in
 * production, real environment variables are typically injected by the
 * host (CI, container runtime, etc.) rather than read from a `.env` file.
 * Missing *variables* are caught later by `validateConfig`. Other failures
 * (e.g. permission denied) are reported as an `Err`.
 *
 * Safe to call more than once; later variables in the file do not override
 * values already present in `process.env`.
 */
export function loadEnv(path = ".env"): Result<void, FileOperationError> {
  try {
    process.loadEnvFile(path);
    return ok(undefined);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return ok(undefined);
    }
    return err(new FileOperationError("read", path, { cause: error }));
  }
}

/**
 * Validates that every `required` spec in `specs` has a non-blank value in
 * `source`, applying defaults for unset optional specs.
 *
 * Reports a single {@link ConfigError} listing *all* missing required
 * variables (not just the first) so a developer can fix everything in one
 * pass instead of discovering missing variables one at a time.
 *
 * @param specs Environment variable specs to resolve.
 * @param source Where to read values from. Defaults to `process.env`;
 *   overridable for tests.
 */
export function validateConfig(
  specs: readonly EnvVarSpec[],
  source: NodeJS.ProcessEnv = process.env,
): Result<Record<string, string>, ConfigError> {
  const missing: string[] = [];
  const resolved: Record<string, string> = {};

  for (const spec of specs) {
    const raw = source[spec.name];
    const value = raw === undefined || raw === "" ? undefined : raw;

    if (value !== undefined) {
      resolved[spec.name] = value;
    } else if (spec.default !== undefined) {
      resolved[spec.name] = spec.default;
    } else if (spec.required) {
      missing.push(spec.name);
    }
  }

  if (missing.length > 0) {
    return err(new ConfigError(missing));
  }

  return ok(resolved);
}

/**
 * Produces a version of a resolved config object safe to log or print:
 * values for any spec marked `secret: true` are replaced with a redacted
 * placeholder. Non-secret values pass through unchanged.
 */
export function safeConfigSummary(
  specs: readonly EnvVarSpec[],
  resolved: Readonly<Record<string, string>>,
): Record<string, string> {
  const summary: Record<string, string> = {};

  for (const spec of specs) {
    const value = resolved[spec.name];
    if (value === undefined) {
      continue;
    }
    summary[spec.name] = spec.secret ? redact(value) : value;
  }

  return summary;
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
