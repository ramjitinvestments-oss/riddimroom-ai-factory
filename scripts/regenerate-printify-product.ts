/**
 * Regenerates any already-published apparel product's *existing* Printify
 * product — new garment color, corrected placement — without ever creating
 * a second product. Generalized from the Gold-Turntable-only version of
 * this script: takes a design stem (the published job's filename stem
 * under `designs/published/`, e.g. `"GOLDEN turntable"`) as an argument
 * instead of hardcoding one product. Every future "reprint this shirt in a
 * different color" or "fix this shirt's placement" job is this same script
 * with a different stem — no per-product copy required.
 *
 * What this script does NOT do:
 *   - Does not re-upload or resize the artwork. `printifyImageId` is read
 *     from `designs/published/<stem>.printify.json` (the id Printify
 *     already has on file) and reused unchanged.
 *   - Does not recalculate placement. `PrintifyApiProvider`'s placementX/Y/
 *     Scale (0.5 / 0.35 / 0.85 — the approved upper-chest standard) are
 *     used exactly as-is; nothing here overrides them.
 *   - Does not create a new Printify product. It calls
 *     `updateProductColorAndPlacement()`, a PUT to
 *     /shops/{shop}/products/{existing productId}.json — the same product
 *     id already live, read from the same published job file, never a
 *     fresh `POST .../products.json`.
 *   - Does not touch Shopify. Syncing the regenerated mockups onto the
 *     live Shopify product is `scripts/sync-product-images.ts`, run as a
 *     separate, later step (module isolation) once this script's output —
 *     new mockup URLs — exists.
 *
 * Requires PRINTIFY_BLACK_VARIANT_IDS in .env for a black-garment
 * regeneration (or, for a colorway this codebase hasn't seen yet, pass
 * `variantIds` directly via `options` — this script never guesses a color
 * mapping from anything in this repository). Printify's variant id
 * numbering is catalog-version- and account-specific; the only source of
 * truth is Printify's own Catalog API. Run this once to populate it
 * automatically (calls the Catalog API for real and writes the result into
 * .env — see scripts/lookup-black-variant-ids.ts):
 *
 *   node --experimental-strip-types scripts/lookup-black-variant-ids.ts
 *
 * Or, equivalently, by hand:
 *
 *   curl -s "https://api.printify.com/v1/catalog/blueprints/$PRINTIFY_BLUEPRINT_ID/print_providers/$PRINTIFY_PRINT_PROVIDER_ID/variants.json" \
 *     -H "Authorization: Bearer $PRINTIFY_API_KEY" \
 *     | jq '.variants[] | select(.options.color | test("Black"; "i")) | {id, title}'
 *
 *   node --experimental-strip-types scripts/regenerate-printify-product.ts "GOLDEN turntable"
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrintifyProvider, type CreatePrintifyProviderOptions } from "../automation/printify/create-provider.ts";
import { loadEnv } from "../automation/shared/config.ts";
import { ConfigError, ValidationError, type ExternalServiceError } from "../automation/shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { getDefaultShirtPrice } from "../automation/shared/pricing.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";
import { outputPaths } from "./import-artwork.ts";

interface ExistingPrintifyJson {
  readonly jobId: string;
  readonly printifyProductId: string;
  readonly printifyImageId: string;
  readonly mockupUrls: readonly string[];
  readonly priceUsd: number;
  readonly status: string;
  readonly uploadedAt: string;
}

interface ProductJson {
  readonly jobId: string;
  readonly title: string;
  readonly productType: string;
}

export interface RegeneratePrintifyProductOptions {
  /** Root the design stem is resolved against. Defaults to "designs/published" — regeneration only ever applies to already-published products. */
  readonly publishedRoot?: string;
  /** Explicit variant ids to switch to. Defaults to PRINTIFY_BLACK_VARIANT_IDS from env — never guessed. */
  readonly variantIds?: readonly number[];
  readonly logger?: Logger;
  readonly printifyProviderOptions?: CreatePrintifyProviderOptions;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
}

export interface RegeneratePrintifyProductResult {
  readonly designStem: string;
  readonly printifyProductId: string;
  readonly reusedImageId: string;
  readonly variantIdsApplied: readonly number[];
  readonly newMockupUrls: readonly string[];
}

type RegenerateError = ConfigError | ValidationError | ExternalServiceError;

function isExistingPrintifyJson(value: unknown): value is ExistingPrintifyJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.printifyProductId === "string" &&
    v.printifyProductId.trim().length > 0 &&
    typeof v.printifyImageId === "string" &&
    v.printifyImageId.trim().length > 0 &&
    Array.isArray(v.mockupUrls)
  );
}

function isProductJson(value: unknown): value is ProductJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.jobId === "string" && typeof v.title === "string" && typeof v.productType === "string";
}

/**
 * Regenerates the existing Printify product for `designStem` (a filename
 * stem under `designs/published/`, e.g. `"GOLDEN turntable"`) — reused
 * product id, reused artwork image id, approved placement, new garment
 * color. Never creates a second Printify product.
 */
export async function regeneratePrintifyProduct(
  designStem: string,
  options: RegeneratePrintifyProductOptions = {},
): Promise<Result<RegeneratePrintifyProductResult, RegenerateError>> {
  const env = options.env ?? process.env;
  const now = options.now ?? ((): Date => new Date());
  const baseLogger =
    options.logger ??
    new Logger({
      module: "scripts/regenerate-printify-product",
      transports: [new ConsoleTransport(), new FileTransport()],
    });

  const publishedRoot = options.publishedRoot ?? path.join("designs", "published");
  const outputs = outputPaths(path.join(publishedRoot, `${designStem}.png`));

  if (!existsSync(outputs.printify) || !existsSync(outputs.product) || !existsSync(outputs.description)) {
    return err(
      new ValidationError([
        `expected all of ${outputs.printify}, ${outputs.product}, ${outputs.description} to exist — ` +
          `"${designStem}" has not been published yet (nothing to regenerate)`,
      ]),
    );
  }

  let existing: ExistingPrintifyJson;
  let product: ProductJson;
  let description: string;
  try {
    const rawPrintify: unknown = JSON.parse(readFileSync(outputs.printify, "utf8"));
    if (!isExistingPrintifyJson(rawPrintify)) {
      return err(new ValidationError([`${outputs.printify} is missing printifyProductId/printifyImageId/mockupUrls`]));
    }
    existing = rawPrintify;

    const rawProduct: unknown = JSON.parse(readFileSync(outputs.product, "utf8"));
    if (!isProductJson(rawProduct)) {
      return err(new ValidationError([`${outputs.product} is missing jobId/title/productType`]));
    }
    product = rawProduct;

    description = readFileSync(outputs.description, "utf8").replace(/^#.*\n+/, "").trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new ValidationError([`failed to read existing "${designStem}" job files: ${message}`]));
  }

  let variantIds: readonly number[];
  if (options.variantIds !== undefined) {
    variantIds = options.variantIds;
  } else {
    const blackVariantIdsRaw = env.PRINTIFY_BLACK_VARIANT_IDS;
    if (blackVariantIdsRaw === undefined || blackVariantIdsRaw.trim().length === 0) {
      return err(
        new ConfigError([
          "PRINTIFY_BLACK_VARIANT_IDS — see the header comment in scripts/regenerate-printify-product.ts " +
            "for the exact Printify Catalog API lookup command to determine these ids. Cannot be guessed or defaulted.",
        ]),
      );
    }
    const parsed = blackVariantIdsRaw
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
    if (parsed.length === 0) {
      return err(new ValidationError(["PRINTIFY_BLACK_VARIANT_IDS did not contain any valid numeric ids"]));
    }
    variantIds = parsed;
  }

  const providerResult = createPrintifyProvider({ ...options.printifyProviderOptions, logger: baseLogger });
  if (!providerResult.ok) {
    return err(providerResult.error);
  }
  const printify = providerResult.value;

  const priceUsd = getDefaultShirtPrice(env);

  const updateResult = await printify.updateProductColorAndPlacement({
    jobId: existing.jobId,
    printifyProductId: existing.printifyProductId,
    printifyImageId: existing.printifyImageId,
    title: product.title,
    description,
    priceUsd,
    variantIds,
  });

  if (!updateResult.ok) {
    return err(updateResult.error);
  }

  try {
    writeFileSync(
      outputs.printify,
      JSON.stringify(
        {
          jobId: existing.jobId,
          printifyProductId: existing.printifyProductId, // unchanged — reused, not recreated
          printifyImageId: existing.printifyImageId, // unchanged — artwork reused, not re-uploaded
          mockupUrls: updateResult.value.mockupUrls,
          priceUsd,
          status: "uploaded",
          uploadedAt: existing.uploadedAt, // preserve original upload timestamp
          colorRegeneratedAt: now().toISOString(),
          garmentColorVariantIds: variantIds,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new ValidationError([`Printify product was updated but writing ${outputs.printify} failed: ${message}`]));
  }

  baseLogger.info(`"${designStem}" Printify product regenerated (existing product reused, no duplicate created)`, {
    metadata: {
      printifyProductId: existing.printifyProductId,
      variantIds,
      newMockupCount: updateResult.value.mockupUrls.length,
    },
  });

  return ok({
    designStem,
    printifyProductId: existing.printifyProductId,
    reusedImageId: existing.printifyImageId,
    variantIdsApplied: variantIds,
    newMockupUrls: updateResult.value.mockupUrls,
  });
}

async function main(): Promise<void> {
  loadEnv();
  const designStem = process.argv[2];
  if (designStem === undefined || designStem.trim().length === 0) {
    console.error(
      'Usage: node --experimental-strip-types scripts/regenerate-printify-product.ts "<design stem>"\n' +
        '  e.g. node --experimental-strip-types scripts/regenerate-printify-product.ts "GOLDEN turntable"\n' +
        "  (the design stem is the filename, without extension, under designs/published/)",
    );
    process.exitCode = 1;
    return;
  }

  const result = await regeneratePrintifyProduct(designStem);
  if (!result.ok) {
    console.error(`Printify regeneration failed for "${designStem}": ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const r = result.value;
  console.log(`\n"${r.designStem}" Printify product updated (reused, not duplicated): ${r.printifyProductId}`);
  console.log(`Reused artwork image id: ${r.reusedImageId}`);
  console.log(`Applied variant ids: ${r.variantIdsApplied.join(", ")}`);
  console.log(`New mockup URLs (${r.newMockupUrls.length}):`);
  for (const url of r.newMockupUrls) console.log(`  ${url}`);
  console.log(
    `\nNext step: node --experimental-strip-types scripts/sync-product-images.ts "${r.designStem}"` +
      ` — pushes these new mockups onto the live Shopify product and removes the old images.`,
  );
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
