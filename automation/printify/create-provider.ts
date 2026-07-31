/**
 * Single place that decides which `PrintifyProvider` the pipeline gets:
 * dry-run (default) or the real Printify API provider. Same `DRY_RUN`
 * switch and shape as `automation/ai`'s factories.
 */
import { type EnvVarSpec, parseBoolean, validateConfig } from "../shared/config.ts";
import { ConfigError, ValidationError } from "../shared/errors.ts";
import { parseIntWithFallback } from "../shared/env-helpers.ts";
import type { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { DryRunPrintifyProvider } from "./dry-run-provider.ts";
import { PrintifyApiProvider } from "./printify-provider.ts";
import type { PrintifyProvider } from "./types.ts";

/** Env vars this module needs — only enforced when `DRY_RUN` is false. */
export const PRINTIFY_ENV_SPECS: readonly EnvVarSpec[] = [
  { name: "PRINTIFY_API_KEY", description: "Printify API key.", required: true, secret: true },
  {
    name: "PRINTIFY_SHOP_ID",
    description: "Printify shop id to create products under.",
    required: true,
    secret: false,
  },
  {
    name: "PRINTIFY_BLUEPRINT_ID",
    description: "Printify catalog blueprint id (product type) to use.",
    required: true,
    secret: false,
  },
  {
    name: "PRINTIFY_PRINT_PROVIDER_ID",
    description: "Printify print provider id for the chosen blueprint.",
    required: true,
    secret: false,
  },
  {
    name: "PRINTIFY_VARIANT_IDS",
    description: "Comma-separated Printify variant ids (sizes/colors) to enable.",
    required: true,
    secret: false,
  },
];

export interface CreatePrintifyProviderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
  readonly fetchImpl?: typeof fetch;
}

export function createPrintifyProvider(
  options: CreatePrintifyProviderOptions = {},
): Result<PrintifyProvider, ConfigError | ValidationError> {
  const env = options.env ?? process.env;
  const dryRun = parseBoolean(env.DRY_RUN, true);

  if (dryRun) {
    return ok(new DryRunPrintifyProvider());
  }

  const configResult = validateConfig(PRINTIFY_ENV_SPECS, env);
  if (!configResult.ok) {
    return err(configResult.error);
  }

  const apiKey = configResult.value.PRINTIFY_API_KEY;
  const shopId = configResult.value.PRINTIFY_SHOP_ID;
  const blueprintIdRaw = configResult.value.PRINTIFY_BLUEPRINT_ID;
  const printProviderIdRaw = configResult.value.PRINTIFY_PRINT_PROVIDER_ID;
  const variantIdsRaw = configResult.value.PRINTIFY_VARIANT_IDS;

  if (
    apiKey === undefined ||
    shopId === undefined ||
    blueprintIdRaw === undefined ||
    printProviderIdRaw === undefined ||
    variantIdsRaw === undefined
  ) {
    // Unreachable in practice — every field above is marked required in
    // PRINTIFY_ENV_SPECS, so a successful validateConfig always includes
    // them. Guards the type.
    return err(new ConfigError(["PRINTIFY_API_KEY"]));
  }

  const blueprintId = Number.parseInt(blueprintIdRaw, 10);
  const printProviderId = Number.parseInt(printProviderIdRaw, 10);
  const variantIds = variantIdsRaw
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((n) => Number.isFinite(n));

  const numericIssues: string[] = [];
  if (!Number.isFinite(blueprintId)) {
    numericIssues.push("PRINTIFY_BLUEPRINT_ID must be a number");
  }
  if (!Number.isFinite(printProviderId)) {
    numericIssues.push("PRINTIFY_PRINT_PROVIDER_ID must be a number");
  }
  if (variantIds.length === 0) {
    numericIssues.push("PRINTIFY_VARIANT_IDS must contain at least one number");
  }
  if (numericIssues.length > 0) {
    return err(new ValidationError(numericIssues));
  }

  return ok(
    new PrintifyApiProvider({
      apiKey,
      shopId,
      blueprintId,
      printProviderId,
      variantIds,
      maxAttempts: parseIntWithFallback(env.PRINTIFY_MAX_RETRIES, 3),
      baseDelayMs: parseIntWithFallback(env.PRINTIFY_RETRY_BASE_DELAY_MS, 500),
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    }),
  );
}
