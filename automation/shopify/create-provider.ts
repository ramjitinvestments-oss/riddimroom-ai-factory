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
import { ClientCredentialsTokenProvider } from "./client-credentials-token-provider.ts";
import { DryRunShopifyProvider } from "./dry-run-provider.ts";
import { ShopifyApiProvider } from "./shopify-provider.ts";
import type { ShopifyProvider } from "./types.ts";

/**
 * Env vars this module needs — only enforced when `DRY_RUN` is false.
 * Auth is Shopify's OAuth client credentials grant (the admin-created
 * custom app static token this used to require, `SHOPIFY_ADMIN_API_ACCESS_TOKEN`,
 * is retired: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin).
 */
export const SHOPIFY_ENV_SPECS: readonly EnvVarSpec[] = [
  {
    name: "SHOPIFY_STORE_DOMAIN",
    description: "Full myshopify domain, e.g. your-store.myshopify.com.",
    required: true,
    secret: false,
  },
  {
    name: "SHOPIFY_CLIENT_ID",
    description: "Client ID for Shopify's OAuth client credentials grant (from the Dev Dashboard app).",
    required: true,
    secret: false,
  },
  {
    name: "SHOPIFY_CLIENT_SECRET",
    description: "Client secret for Shopify's OAuth client credentials grant (from the Dev Dashboard app).",
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
  const clientId = configResult.value.SHOPIFY_CLIENT_ID;
  const clientSecret = configResult.value.SHOPIFY_CLIENT_SECRET;
  const apiVersion = configResult.value.SHOPIFY_API_VERSION;

  if (
    storeDomain === undefined ||
    clientId === undefined ||
    clientSecret === undefined ||
    apiVersion === undefined
  ) {
    // Unreachable in practice — SHOPIFY_ENV_SPECS marks these
    // required/defaulted, so a successful validateConfig always includes
    // them. Guards the type.
    return err(new ConfigError(["SHOPIFY_STORE_DOMAIN"]));
  }

  const tokenProvider = new ClientCredentialsTokenProvider({
    storeDomain,
    clientId,
    clientSecret,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  return ok(
    new ShopifyApiProvider({
      storeDomain,
      tokenProvider,
      apiVersion,
      maxAttempts: parseIntWithFallback(env.SHOPIFY_MAX_RETRIES, 3),
      baseDelayMs: parseIntWithFallback(env.SHOPIFY_RETRY_BASE_DELAY_MS, 500),
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    }),
  );
}
