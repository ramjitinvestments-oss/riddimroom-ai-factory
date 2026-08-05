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
  const productJson = (await productResp.json()) as {
    id?: string;
    blueprint_id?: number;
    print_provider_id?: number;
    variants?: ReadonlyArray<{ id?: number; is_enabled?: boolean }>;
    print_areas?: unknown;
  };
  console.log(`\n=== GET /shops/${shopId}/products/${productId}.json (status ${productResp.status}) ===`);
  console.log(`product.blueprint_id = ${productJson.blueprint_id}`);
  console.log(`product.print_provider_id = ${productJson.print_provider_id}`);
  const enabledIds = (productJson.variants ?? []).filter((v) => v.is_enabled === true).map((v) => v.id);
  console.log(`product.variants: ${productJson.variants?.length ?? 0} total, ${enabledIds.length} enabled: [${enabledIds.join(",")}]`);
  console.log(`product.print_areas (full, this is what's currently saved server-side):`);
  console.log(JSON.stringify(productJson.print_areas, null, 2));

  const providerResp = await fetch(
    `${PRINTIFY_API_BASE}/catalog/blueprints/${blueprintId}/print_providers.json`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const providerJson = (await providerResp.json()) as ReadonlyArray<{ id?: number; title?: string }>;
  console.log(`\n=== GET /catalog/blueprints/${blueprintId}/print_providers.json (status ${providerResp.status}) ===`);
  console.log(JSON.stringify(providerJson));

  // Also fetch the specific print-provider's variant list (same call
  // scripts/lookup-black-variant-ids.ts makes) but this time keep EVERY
  // variant, not just black ones, and print a sample so we can see
  // print_area_type / placeholders / any per-variant metadata that could
  // explain why some ids reject 8251 and others don't.
  const variantsResp = await fetch(
    `${PRINTIFY_API_BASE}/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const variantsJson = (await variantsResp.json()) as { variants?: ReadonlyArray<Record<string, unknown>> };
  console.log(
    `\n=== GET /catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json ` +
      `(status ${variantsResp.status}, ${variantsJson.variants?.length ?? 0} variants total) ===`,
  );
  console.log("First variant (full shape):");
  console.log(JSON.stringify(variantsJson.variants?.[0], null, 2));
  console.log("\nplaceholders/print_area_type across ALL variants (deduped):");
  const shapes = new Set<string>();
  for (const v of variantsJson.variants ?? []) {
    shapes.add(JSON.stringify({ placeholders: v.placeholders, print_area_type: v.print_area_type }));
  }
  for (const s of shapes) console.log(s);
}

main().catch((error: unknown) => {
  console.error("Unexpected error:", error);
  process.exitCode = 1;
});
