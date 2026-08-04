/**
 * Replaces the manual "run this curl command, read the JSON, copy the ids
 * into .env by hand" step documented in the runbook and in
 * scripts/regenerate-printify-product.ts's header comment, with a real
 * script: calls Printify's own Catalog API
 * (`GET /catalog/blueprints/{id}/print_providers/{id}/variants.json`) for
 * this account's configured blueprint/print-provider, filters for variants
 * whose `options.color` matches "black" (case-insensitive — the same
 * filter the documented `jq` one-liner used), and writes the resulting ids
 * into `.env` as `PRINTIFY_BLACK_VARIANT_IDS`.
 *
 * This does not weaken scripts/preflight-check.ts's
 * PRINTIFY_BLACK_VARIANT_IDS gate in any way — that check still fails
 * until a real value exists. This script is one way to produce that real
 * value (by asking Printify directly) instead of a human transcribing a
 * curl response by hand. It never guesses: if Printify returns zero
 * variants whose color matches "black", this script fails clearly and
 * writes nothing, rather than picking a plausible-looking id.
 *
 * Requires PRINTIFY_API_KEY, PRINTIFY_BLUEPRINT_ID, PRINTIFY_PRINT_PROVIDER_ID
 * already set (the same three values scripts/preflight-check.ts's
 * "Printify credentials configured" check requires) — this script does not
 * invent those either.
 *
 *   node --experimental-strip-types scripts/lookup-black-variant-ids.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../automation/shared/config.ts";
import { ConfigError, ExternalServiceError, ValidationError } from "../automation/shared/errors.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";

const PRINTIFY_API_BASE = "https://api.printify.com/v1";

interface CatalogVariant {
  readonly id?: number;
  readonly title?: string;
  readonly options?: { readonly color?: string };
}

interface CatalogVariantsResponse {
  readonly variants?: readonly CatalogVariant[];
}

export interface LookupBlackVariantIdsOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  /** Path to the .env file to update. Defaults to ".env". */
  readonly envFilePath?: string;
}

export interface LookupBlackVariantIdsResult {
  readonly blueprintId: string;
  readonly printProviderId: string;
  readonly matched: ReadonlyArray<{ readonly id: number; readonly title: string }>;
  readonly envFileUpdated: boolean;
}

type LookupError = ConfigError | ValidationError | ExternalServiceError;

/**
 * Idempotently sets `key=value` in the .env file at `envFilePath`:
 * replaces an existing `key=...` line (any value, including blank) if one
 * exists, otherwise appends a new line. Every other line is left
 * byte-for-byte unchanged.
 */
function upsertEnvVar(envFilePath: string, key: string, value: string): void {
  const line = `${key}=${value}`;
  if (!existsSync(envFilePath)) {
    writeFileSync(envFilePath, `${line}\n`);
    return;
  }

  const content = readFileSync(envFilePath, "utf8");
  const lines = content.split("\n");
  const pattern = new RegExp(`^${key}=`);
  const index = lines.findIndex((l) => pattern.test(l));

  if (index === -1) {
    const needsNewline = content.length > 0 && !content.endsWith("\n");
    writeFileSync(envFilePath, `${content}${needsNewline ? "\n" : ""}${line}\n`);
    return;
  }

  lines[index] = line;
  writeFileSync(envFilePath, lines.join("\n"));
}

/**
 * Looks up this account's black-garment variant ids for
 * PRINTIFY_BLUEPRINT_ID / PRINTIFY_PRINT_PROVIDER_ID via Printify's real
 * Catalog API, and writes them into the .env file as
 * PRINTIFY_BLACK_VARIANT_IDS. Never guesses: fails with a clear error and
 * writes nothing if credentials are missing, the API call fails, or no
 * variant's color matches "black".
 */
export async function lookupBlackVariantIds(
  options: LookupBlackVariantIdsOptions = {},
): Promise<Result<LookupBlackVariantIdsResult, LookupError>> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const envFilePath = options.envFilePath ?? ".env";

  const apiKeyRaw = env.PRINTIFY_API_KEY;
  const blueprintIdRaw = env.PRINTIFY_BLUEPRINT_ID;
  const printProviderIdRaw = env.PRINTIFY_PRINT_PROVIDER_ID;

  const missing: string[] = [];
  if (apiKeyRaw === undefined || apiKeyRaw.trim().length === 0) missing.push("PRINTIFY_API_KEY");
  if (blueprintIdRaw === undefined || blueprintIdRaw.trim().length === 0) missing.push("PRINTIFY_BLUEPRINT_ID");
  if (printProviderIdRaw === undefined || printProviderIdRaw.trim().length === 0) missing.push("PRINTIFY_PRINT_PROVIDER_ID");
  if (missing.length > 0 || apiKeyRaw === undefined || blueprintIdRaw === undefined || printProviderIdRaw === undefined) {
    return err(new ConfigError(missing));
  }
  const apiKey: string = apiKeyRaw;
  const blueprintId: string = blueprintIdRaw;
  const printProviderId: string = printProviderIdRaw;

  const url = `${PRINTIFY_API_BASE}/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`;

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new ExternalServiceError("printify", `Catalog API request failed: ${message}`, { cause: error }));
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "<no response body>");
    return err(
      new ExternalServiceError(
        "printify",
        `Catalog API returned HTTP ${response.status} for blueprint ${blueprintId} / print provider ${printProviderId}: ${bodyText}`,
        { statusCode: response.status },
      ),
    );
  }

  let body: CatalogVariantsResponse;
  try {
    body = (await response.json()) as CatalogVariantsResponse;
  } catch {
    return err(new ValidationError(["Catalog API response body was not valid JSON"]));
  }

  const variants = body.variants ?? [];
  const matched = variants
    .filter((v): v is { id: number; title: string; options?: { color?: string } } => v.id !== undefined && v.title !== undefined)
    .filter((v) => v.options?.color !== undefined && /black/i.test(v.options.color))
    .map((v) => ({ id: v.id, title: v.title }));

  if (matched.length === 0) {
    return err(
      new ValidationError([
        `Printify's Catalog API returned ${variants.length} variant(s) for blueprint ${blueprintId} / ` +
          `print provider ${printProviderId}, but none had a color matching "black". Nothing was written to ` +
          `${envFilePath} — refusing to guess. Check PRINTIFY_BLUEPRINT_ID/PRINTIFY_PRINT_PROVIDER_ID are the ` +
          `correct combination for the product you intend to print in black.`,
      ]),
    );
  }

  const idsCsv = matched.map((v) => v.id).join(",");
  let envFileUpdated = false;
  try {
    upsertEnvVar(envFilePath, "PRINTIFY_BLACK_VARIANT_IDS", idsCsv);
    envFileUpdated = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new ValidationError([`Found ${matched.length} black variant(s) but failed to write ${envFilePath}: ${message}`]));
  }

  return ok({ blueprintId, printProviderId, matched, envFileUpdated });
}

async function main(): Promise<void> {
  loadEnv();
  const result = await lookupBlackVariantIds();
  if (!result.ok) {
    console.error(`Black variant id lookup failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const r = result.value;
  console.log(
    `\nFound ${r.matched.length} black variant(s) for blueprint ${r.blueprintId} / print provider ${r.printProviderId}:`,
  );
  for (const v of r.matched) console.log(`  ${v.id}  ${v.title}`);
  console.log(`\nPRINTIFY_BLACK_VARIANT_IDS=${r.matched.map((v) => v.id).join(",")} written to .env.`);
  console.log(`\nNext: node --experimental-strip-types scripts/preflight-check.ts`);
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
