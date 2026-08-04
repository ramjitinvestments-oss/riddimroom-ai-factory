/**
 * Thin, backward-compatible wrapper around the generalized
 * `scripts/sync-product-images.ts` ("Never build one-off solutions" — the
 * Gold-Turntable-specific implementation and gallery-order table this file
 * used to contain have been generalized into
 * `automation/printify/gallery-standard.ts` and `scripts/sync-product-images.ts`
 * so every apparel product, not just this one, syncs the same way). Kept
 * as its own file/command so the exact invocation already documented in
 * `docs/gold-turntable-regeneration-runbook.md` keeps working unchanged.
 *
 * For any product other than Gold Turntable, call
 * `scripts/sync-product-images.ts "<design stem>"` directly.
 *
 *   node --experimental-strip-types scripts/sync-gold-turntable-images.ts
 */
import { fileURLToPath } from "node:url";
import { loadEnv } from "../automation/shared/config.ts";
import {
  syncProductImages,
  type SyncProductImagesOptions,
  type SyncProductImagesResult,
} from "./sync-product-images.ts";
import type { ConfigError, ValidationError, ExternalServiceError } from "../automation/shared/errors.ts";
import type { Result } from "../automation/shared/result.ts";

const DESIGN_STEM = "GOLDEN turntable";

export async function syncGoldTurntableImages(
  options: SyncProductImagesOptions = {},
): Promise<Result<SyncProductImagesResult, ConfigError | ValidationError | ExternalServiceError>> {
  return syncProductImages(DESIGN_STEM, options);
}

async function main(): Promise<void> {
  loadEnv();
  const result = await syncGoldTurntableImages();
  if (!result.ok) {
    console.error(`Gold Turntable Shopify image sync failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const r = result.value;
  console.log(`\nShopify product ${r.shopifyProductId} image gallery replaced.`);
  console.log(`Mapped (in final order):`);
  for (const m of r.mappedSlots) console.log(`  ${m.slot.padEnd(20)} ${m.src}`);
  if (r.unmappedSlots.length > 0) {
    console.log(`\nNot mapped (no matching mockup — see automation/printify/gallery-standard.ts):`);
    for (const s of r.unmappedSlots) console.log(`  ${s}`);
  }
  console.log(`\nAdded ${r.addedImageIds.length} image(s), removed ${r.removedImageIds.length} old image(s).`);
  console.log(
    `\nVerify live at every surface (product page, collection page, homepage, featured collection, ` +
      `search, recommended/related products, cart preview, structured data, Open Graph) before considering this done.`,
  );
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
