/**
 * Single place that decides which `ImageGenerationProvider` the pipeline
 * gets: dry-run (default, no network calls) or the real OpenAI provider.
 * Pipeline code should always go through this factory rather than
 * constructing a provider directly — switching to production is then
 * purely a config change (`DRY_RUN=false` + `OPENAI_API_KEY` set), never
 * a code change.
 */
import { type EnvVarSpec, parseBoolean, validateConfig } from "../shared/config.ts";
import { ConfigError } from "../shared/errors.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { DryRunImageProvider } from "./dry-run-provider.ts";
import { parseIntWithFallback } from "../shared/env-helpers.ts";
import { OpenAiImageProvider } from "./openai-provider.ts";
import type { ImageGenerationProvider } from "./types.ts";

/** Env vars this module needs — only enforced when `DRY_RUN` is false. */
export const AI_ENV_SPECS: readonly EnvVarSpec[] = [
  {
    name: "OPENAI_API_KEY",
    description: "OpenAI API key used for image generation.",
    required: true,
    secret: true,
  },
];

export interface CreateImageProviderOptions {
  /** Defaults to `process.env`; overridable for tests. */
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
  /** Injectable fetch implementation, forwarded to the real provider. */
  readonly fetchImpl?: typeof fetch;
}

export function createImageProvider(
  options: CreateImageProviderOptions = {},
): Result<ImageGenerationProvider, ConfigError> {
  const env = options.env ?? process.env;
  const dryRun = parseBoolean(env.DRY_RUN, true);

  if (dryRun) {
    return ok(new DryRunImageProvider());
  }

  const configResult = validateConfig(AI_ENV_SPECS, env);
  if (!configResult.ok) {
    return err(configResult.error);
  }

  const apiKey = configResult.value.OPENAI_API_KEY;
  if (apiKey === undefined) {
    // Unreachable in practice — AI_ENV_SPECS marks this required, so a
    // successful validateConfig always includes it. Guards the type.
    return err(new ConfigError(["OPENAI_API_KEY"]));
  }

  return ok(
    new OpenAiImageProvider({
      apiKey,
      ...(env.OPENAI_IMAGE_MODEL !== undefined ? { model: env.OPENAI_IMAGE_MODEL } : {}),
      maxAttempts: parseIntWithFallback(env.AI_IMAGE_MAX_RETRIES, 3),
      baseDelayMs: parseIntWithFallback(env.AI_IMAGE_RETRY_BASE_DELAY_MS, 500),
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    }),
  );
}
