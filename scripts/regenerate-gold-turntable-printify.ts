/**
 * Thin, backward-compatible wrapper around the generalized
 * `scripts/regenerate-printify-product.ts` ("Never build one-off
 * solutions" — the Gold-Turntable-specific implementation this file used
 * to contain has been generalized so every apparel product, not just this
 * one, can be regenerated the same way). Kept as its own file/command so
 * the exact invocation already documented in
 * `docs/gold-turntable-regeneration-runbook.md` keeps working unchanged.
 *
 * For any product other than Gold Turntable, call
 * `scripts/regenerate-printify-product.ts "<design stem>"` directly.
 *
 *   node --experimental-strip-types scripts/regenerate-gold-turntable-printify.ts
 */
import { fileURLToPath } from "node:url";
import { loadEnv } from "../automation/shared/config.ts";
import {
  regeneratePrintifyProduct,
  type RegeneratePrintifyProductOptions,
  type RegeneratePrintifyProductResult,
} from "./regenerate-printify-product.ts";
import type { ConfigError, ValidationError, ExternalServiceError } from "../automation/shared/errors.ts";
import type { Result } from "../automation/shared/result.ts";

const DESIGN_STEM = "GOLDEN turntable";

export async function regenerateGoldTurntablePrintifyProduct(
  options: RegeneratePrintifyProductOptions = {},
): Promise<Result<RegeneratePrintifyProductResult, ConfigError | ValidationError | ExternalServiceError>> {
  return regeneratePrintifyProduct(DESIGN_STEM, options);
}

async function main(): Promise<void> {
  loadEnv();
  const result = await regenerateGoldTurntablePrintifyProduct();
  if (!result.ok) {
    console.error(`Gold Turntable Printify regeneration failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const r = result.value;
  console.log(`\nGold Turntable Printify product updated (reused, not duplicated): ${r.printifyProductId}`);
  console.log(`Reused artwork image id: ${r.reusedImageId}`);
  console.log(`Applied variant ids (black): ${r.variantIdsApplied.join(", ")}`);
  console.log(`New mockup URLs (${r.newMockupUrls.length}):`);
  for (const url of r.newMockupUrls) console.log(`  ${url}`);
  console.log(
    `\nNext step: node --experimental-strip-types scripts/sync-gold-turntable-images.ts` +
      ` — pushes these new mockups onto the live Shopify product and removes the old white-shirt images.`,
  );
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
