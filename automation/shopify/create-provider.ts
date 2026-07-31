/**
 * Single place that decides which `ShopifyProvider` the pipeline gets:
 * dry-run (default) or the real Shopify API provider. Same `DRY_RUN`
 * switch and shape as `automation/ai` and `automation/printify`'s factories.
 */
import { type EnvVarSpec, parseBoolean, validateConfig } from "../shared/config.ts";
import { ConfigError } from "../shared/errors.ts";
import { parseIntWithFallback } from "../shared/env-helpers.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { DryRunShopifyProvider } from "./dry-run-provider.ts";
import { ShopifyApiProvider } from "./shopify-provider.ts";
import type { ShopifyProvider } from "./types.ts";

/** Env vars this module needs — only enforced when `DRY_RUN` is false. */
export const SHOPIFY_ENV_SPECS: readonly EnvVarSpec[] = [
  {
    name: "SHOPIFY_STORE_DOMAIN",
    description: "Full myshopify domain, e.g. your-store.myshopify.com.",
    required: true,
    secret: false,
  },
  {
    name: "SHOPIFY_ADMIN_API_ACCESS_TOKEN",
    description: "Shopify Admin API access token.",
    required: true,
    secret: true,
  },
  {
    name: "SHOPIFY_API_VERSION",
    description: "Shopify Admin API version, e.g. 2025-01.",
    required: false,
    secret: false,
    default: "2025-01",
  },
];

export interface CreateShopifyProviderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
  readonly fetchImpl?: typeof fetch;
}

export function createShopifyProvider(
  options: CreateShopifyProviderOptions = {},
): Result<ShopifyProvider, ConfigError> {
  const env = options.env ?? process.env;
  const dryRun = parseBoolean(env.DRY_RUN, true);

  if (dryRun) {
    return ok(new DryRunShopifyProvider());
  }

  const configResult = validateConfig(SHOPIFY_ENV_SPECS, env);
  if (!configResult.ok) {
    return err(configResult.error);
  }

  const storeDomain = configResult.value.SHOPIFY_STORE_DOMAIN;
  const accessToken = configResult.value.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
  const apiVersion = configResult.value.SHOPIFY_API_VERSION;

  if (storeDomain === undefined || accessToken === undefined || apiVersion === undefined) {
    // Unreachable in practice — SHOPIFY_ENV_SPECS marks these
    // required/defaulted, so a successful validateConfig always includes
    // them. Guards the type.
    return err(new ConfigError(["SHOPIFY_STORE_DOMAIN"]));
  }

  return ok(
    new ShopifyApiProvider({
      storeDomain,
      accessToken,
      apiVersion,
      maxAttempts: parseIntWithFallback(env.SHOPIFY_MAX_RETRIES, 3),
      baseDelayMs: parseIntWithFallback(env.SHOPIFY_RETRY_BASE_DELAY_MS, 500),
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    }),
  );
}
