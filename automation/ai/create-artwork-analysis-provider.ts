/**
 * Single place that decides which `ArtworkAnalysisProvider` the pipeline
 * gets: dry-run (default, no network calls) or the real OpenAI provider,
 * keyed off `DRY_RUN` — mirrors `./create-product-copy-provider.ts` exactly.
 */
import { type EnvVarSpec, parseBoolean, validateConfig } from "../shared/config.ts";
import { ConfigError } from "../shared/errors.ts";
import { parseIntWithFallback } from "../shared/env-helpers.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { DryRunArtworkAnalysisProvider } from "./dry-run-artwork-analysis-provider.ts";
import { OpenAiArtworkAnalysisProvider } from "./openai-artwork-analysis-provider.ts";
import type { ArtworkAnalysisProvider } from "./artwork-analysis-types.ts";

/** Env vars this module needs — only enforced when `DRY_RUN` is false. */
export const ARTWORK_ANALYSIS_ENV_SPECS: readonly EnvVarSpec[] = [
  {
    name: "OPENAI_API_KEY",
    description: "OpenAI API key used for artwork analysis.",
    required: true,
    secret: true,
  },
];

export interface CreateArtworkAnalysisProviderOptions {
  /** Defaults to `process.env`; overridable for tests. */
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
  /** Injectable fetch implementation, forwarded to the real provider. */
  readonly fetchImpl?: typeof fetch;
}

export function createArtworkAnalysisProvider(
  options: CreateArtworkAnalysisProviderOptions = {},
): Result<ArtworkAnalysisProvider, ConfigError> {
  const env = options.env ?? process.env;
  const dryRun = parseBoolean(env.DRY_RUN, true);

  if (dryRun) {
    return ok(new DryRunArtworkAnalysisProvider());
  }

  const configResult = validateConfig(ARTWORK_ANALYSIS_ENV_SPECS, env);
  if (!configResult.ok) {
    return err(configResult.error);
  }

  const apiKey = configResult.value.OPENAI_API_KEY;
  if (apiKey === undefined) {
    // Unreachable in practice — ARTWORK_ANALYSIS_ENV_SPECS marks this
    // required, so a successful validateConfig always includes it.
    return err(new ConfigError(["OPENAI_API_KEY"]));
  }

  return ok(
    new OpenAiArtworkAnalysisProvider({
      apiKey,
      ...(env.OPENAI_ARTWORK_ANALYSIS_MODEL !== undefined ? { model: env.OPENAI_ARTWORK_ANALYSIS_MODEL } : {}),
      maxAttempts: parseIntWithFallback(env.AI_ARTWORK_ANALYSIS_MAX_RETRIES, 3),
      baseDelayMs: parseIntWithFallback(env.AI_ARTWORK_ANALYSIS_RETRY_BASE_DELAY_MS, 500),
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    }),
  );
}
