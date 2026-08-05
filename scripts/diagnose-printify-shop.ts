/**
 * DIAGNOSTIC ONLY — never writes anything, to Printify, Shopify, or local
 * files. Calls Printify's `GET /v1/shops.json` (lists every shop on this
 * Printify account, each with its connected sales-channel title, if any)
 * and prints it alongside the shop id currently configured in
 * `PRINTIFY_SHOP_ID`, so a human can see exactly which shop the pipeline
 * is pointed at and whether it's the one connected to Shopify.
 *
 * Built for the 2026-08-05 incident: scripts/repair-legacy-shopify-products.ts
 * failed with Printify error code 8254 ("Shop #*** ... is not connected to
 * sales channel") when publishing the Caribbean Dictionary Series designs.
 * This script exists to answer, with certainty (not a UI screenshot guess),
 * which of the account's Printify shops PRINTIFY_SHOP_ID actually refers
 * to, and what its real connection status is.
 *
 *   node --experimental-strip-types scripts/diagnose-printify-shop.ts
 */
import { fileURLToPath } from "node:url";
import { loadEnv } from "../automation/shared/config.ts";
import { ExternalServiceError, ValidationError } from "../automation/shared/errors.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";

const PRINTIFY_API_BASE = "https://api.printify.com/v1";

interface ShopEntry {
  readonly id?: number;
  readonly title?: string;
  readonly sales_channel?: string;
}

export interface DiagnosePrintifyShopOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

export interface DiagnosePrintifyShopResult {
  readonly configuredShopId: string | undefined;
  readonly shops: readonly ShopEntry[];
  readonly configuredShopMatch: ShopEntry | undefined;
}

type DiagnoseError = ValidationError | ExternalServiceError;

export async function diagnosePrintifyShop(
  options: DiagnosePrintifyShopOptions = {},
): Promise<Result<DiagnosePrintifyShopResult, DiagnoseError>> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = env.PRINTIFY_API_KEY;
  const configuredShopId = env.PRINTIFY_SHOP_ID;

  if (apiKey === undefined || apiKey.trim().length === 0) {
    return err(new ValidationError(["PRINTIFY_API_KEY is not set"]));
  }

  let response: Response;
  try {
    response = await fetchImpl(`${PRINTIFY_API_BASE}/shops.json`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    return err(new ExternalServiceError("printify", "network request failed", { cause: error }));
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    return err(new ExternalServiceError("printify", `request failed: ${response.status} ${text}`, { statusCode: response.status }));
  }

  const shops = (await response.json()) as readonly ShopEntry[];
  const configuredShopMatch = shops.find((s) => String(s.id) === configuredShopId);

  return ok({ configuredShopId, shops, configuredShopMatch });
}

async function main(): Promise<void> {
  loadEnv();
  const result = await diagnosePrintifyShop();
  if (!result.ok) {
    console.error(`Diagnosis failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const r = result.value;
  console.log(`\nPRINTIFY_SHOP_ID (configured): ${r.configuredShopId ?? "(unset)"}`);
  console.log(`\nAll shops on this Printify account:`);
  for (const shop of r.shops) {
    const isConfigured = String(shop.id) === r.configuredShopId ? "  <-- PRINTIFY_SHOP_ID points here" : "";
    console.log(`  id=${shop.id}  title="${shop.title}"  sales_channel=${shop.sales_channel ?? "(none — not connected)"}${isConfigured}`);
  }

  if (r.configuredShopMatch === undefined) {
    console.log(`\nWARNING: PRINTIFY_SHOP_ID (${r.configuredShopId}) does not match any shop id returned above.`);
  } else if (r.configuredShopMatch.sales_channel === undefined || r.configuredShopMatch.sales_channel === null) {
    console.log(`\nCONFIRMED: the configured shop ("${r.configuredShopMatch.title}") has no sales_channel — this is why publish.json fails.`);
  } else {
    console.log(`\nThe configured shop IS connected to a sales channel: ${r.configuredShopMatch.sales_channel}. The 8254 error may be transient or something else — investigate further.`);
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
