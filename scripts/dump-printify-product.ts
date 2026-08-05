/**
 * Read-only diagnostic: prints the full raw JSON Printify returns for one
 * product, plus the full raw JSON for the catalog's variant list for the
 * currently configured blueprint/print provider. Used to debug error 8251
 * ("Variants do not match selected blueprint and print provider") by
 * comparing the two directly instead of guessing further.
 *
 * Usage:
 *   node --experimental-strip-types scripts/dump-printify-product.ts <printifyProductId>
 */
import { loadEnv } from "../automation/shared/config.ts";

const PRINTIFY_API_BASE = "https://api.printify.com/v1";

async function main(): Promise<void> {
  loadEnv();
  const productId = process.argv[2];
  const shopId = process.env.PRINTIFY_SHOP_ID;
  const apiKey = process.env.PRINTIFY_API_KEY;
  const blueprintId = process.env.PRINTIFY_BLUEPRINT_ID;
  const printProviderId = process.env.PRINTIFY_PRINT_PROVIDER_ID;

  if (!productId || !shopId || !apiKey || !blueprintId || !printProviderId) {
    console.error("Usage: node --experimental-strip-types scripts/dump-printify-product.ts <printifyProductId>");
    console.error("Requires PRINTIFY_SHOP_ID, PRINTIFY_API_KEY, PRINTIFY_BLUEPRINT_ID, PRINTIFY_PRINT_PROVIDER_ID in env.");
    process.exitCode = 1;
    return;
  }

  console.log(`Configured secrets: PRINTIFY_BLUEPRINT_ID=${blueprintId} PRINTIFY_PRINT_PROVIDER_ID=${printProviderId}`);

  const productResp = await fetch(`${PRINTIFY_API_BASE}/shops/${shopId}/products/${productId}.json`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const productText = await productResp.text();
  console.log(`\n=== GET /shops/${shopId}/products/${productId}.json (status ${productResp.status}) ===`);
  console.log(productText);

  const providerResp = await fetch(
    `${PRINTIFY_API_BASE}/catalog/blueprints/${blueprintId}/print_providers.json`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const providerText = await providerResp.text();
  console.log(`\n=== GET /catalog/blueprints/${blueprintId}/print_providers.json (status ${providerResp.status}) ===`);
  console.log(providerText);
}

main().catch((error: unknown) => {
  console.error("Unexpected error:", error);
  process.exitCode = 1;
});
