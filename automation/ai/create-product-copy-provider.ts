/**
 * Single place that decides which `ProductCopyProvider` the pipeline
 * gets: dry-run (default, no network calls) or the real OpenAI provider,
 * keyed off `DRY_RUN` — pipeline code should always go through this
 * factory rather than constructing a provider directly.
 */
import { type EnvVarSpec, parseBoolean, validateConfig } from "../shared/config.ts";
import { ConfigError } from "../shared/errors.ts";
import { parseIntWithFallback } from "../shared/env-helpers.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { DryRunProductCopyProvider } from "./dry-run-product-copy-provider.ts";
import { OpenAiProductCopyProvider } from "./openai-product-copy-provider.ts";
import type { ProductCopyProvider } from "./product-copy-types.ts";

/** Env vars this module needs — only enforced when `DRY_RUN` is false. */
export const PRODUCT_COPY_ENV_SPECS: readonly EnvVarSpec[] = [
  {
    name: "OPENAI_API_KEY",
    description: "OpenAI API key used for product copy generation.",
    required: true,
    secret: true,
  },
];

export interface CreateProductCopyProviderOptions {
  /** Defaults to `process.env`; overridable for tests. */
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
  /** Injectable fetch implementation, forwarded to the real provider. */
  readonly fetchImpl?: typeof fetch;
}

export function createProductCopyProvider(
  options: CreateProductCopyProviderOptions = {},
): Result<ProductCopyProvider, ConfigError> {
  const env = options.env ?? process.env;
  const dryRun = parseBoolean(env.DRY_RUN, true);

  if (dryRun) {
    return ok(new DryRunProductCopyProvider());
  }

  const configResult = validateConfig(PRODUCT_COPY_ENV_SPECS, env);
  if (!configResult.ok) {
    return err(configResult.error);
  }

  const apiKey = configResult.value.OPENAI_API_KEY;
  if (apiKey === undefined) {
    // Unreachable in practice — PRODUCT_COPY_ENV_SPECS marks this
    // required, so a successful validateConfig always includes it.
    return err(new ConfigError(["OPENAI_API_KEY"]));
  }

  return ok(
    new OpenAiProductCopyProvider({
      apiKey,
      ...(env.OPENAI_PRODUCT_COPY_MODEL !== undefined ? { model: env.OPENAI_PRODUCT_COPY_MODEL } : {}),
      maxAttempts: parseIntWithFallback(env.AI_PRODUCT_COPY_MAX_RETRIES, 3),
      baseDelayMs: parseIntWithFallback(env.AI_PRODUCT_COPY_RETRY_BASE_DELAY_MS, 500),
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    }),
  );
}
