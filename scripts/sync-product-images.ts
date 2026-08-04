/**
 * Pushes any regenerated Printify product's mockups onto its existing,
 * already-live Shopify product — replacing the current gallery in one
 * call. Generalized from the Gold-Turntable-only version of this script:
 * takes a design stem as an argument and reads the product title from
 * `<stem>.product.json` instead of a hardcoded constant, so this is the
 * one sync script every apparel product uses, not a per-product copy.
 *
 * Never creates a new Shopify product: reads `shopifyProductId` from
 * `designs/published/<stem>.shopify.json` and updates that exact
 * product's image gallery only. Title, handle, URL, variants, SEO
 * metafields, tags, and reviews are untouched — this only calls
 * `ShopifyProvider.replaceProductImages()`, nothing else.
 *
 * Refuses to run until `scripts/regenerate-printify-product.ts` has
 * actually produced a new mockup set for this design (detected via the
 * `colorRegeneratedAt` field that script stamps onto `<stem>.printify.json`)
 * — otherwise this would just re-sync the same old mockups under a nicer
 * file name and call it done, which is exactly the kind of fake progress
 * this project's rules forbid.
 *
 * Gallery order and Printify camera_label mapping live in exactly one
 * place — `automation/printify/gallery-standard.ts` — so every product
 * gets the same approved order automatically; nothing here re-derives it.
 *
 * Because a product's Shopify featured image (used on collection cards,
 * homepage cards, search results, cart previews, structured data, and
 * Open Graph) is always image position 1, putting the Hero shot first is
 * what fixes every one of those surfaces in a single call — no separate
 * step needed per surface.
 *
 *   node --experimental-strip-types scripts/sync-product-images.ts "GOLDEN turntable"
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapMockupsToGallery } from "../automation/printify/gallery-standard.ts";
import { createShopifyProvider, type CreateShopifyProviderOptions } from "../automation/shopify/create-provider.ts";
import { loadEnv } from "../automation/shared/config.ts";
import { ConfigError, ValidationError, type ExternalServiceError } from "../automation/shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";
import { outputPaths } from "./import-artwork.ts";

interface PrintifyJson {
  readonly mockupUrls: readonly string[];
  readonly colorRegeneratedAt?: string;
}

interface ShopifyJson {
  readonly shopifyProductId: string;
}

interface ProductJson {
  readonly title: string;
}

function isPrintifyJson(value: unknown): value is PrintifyJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.mockupUrls);
}

function isShopifyJson(value: unknown): value is ShopifyJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.shopifyProductId === "string" && v.shopifyProductId.trim().length > 0;
}

function isProductJson(value: unknown): value is ProductJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === "string" && v.title.trim().length > 0;
}

export interface SyncProductImagesOptions {
  readonly publishedRoot?: string;
  readonly logger?: Logger;
  readonly shopifyProviderOptions?: CreateShopifyProviderOptions;
}

export interface SyncProductImagesResult {
  readonly designStem: string;
  readonly shopifyProductId: string;
  readonly mappedSlots: ReadonlyArray<{ readonly slot: string; readonly src: string }>;
  readonly unmappedSlots: readonly string[];
  readonly addedImageIds: readonly string[];
  readonly removedImageIds: readonly string[];
}

type SyncError = ConfigError | ValidationError | ExternalServiceError;

/**
 * Syncs `designStem`'s (a filename stem under `designs/published/`)
 * regenerated Printify mockups onto its existing Shopify product gallery,
 * in the approved gallery order from `automation/printify/gallery-standard.ts`.
 */
export async function syncProductImages(
  designStem: string,
  options: SyncProductImagesOptions = {},
): Promise<Result<SyncProductImagesResult, SyncError>> {
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/sync-product-images", transports: [new ConsoleTransport(), new FileTransport()] });

  const publishedRoot = options.publishedRoot ?? path.join("designs", "published");
  const outputs = outputPaths(path.join(publishedRoot, `${designStem}.png`));

  if (!existsSync(outputs.printify) || !existsSync(outputs.shopify) || !existsSync(outputs.product)) {
    return err(
      new ValidationError([
        `expected all of ${outputs.printify}, ${outputs.shopify}, ${outputs.product} to exist for "${designStem}"`,
      ]),
    );
  }

  let printifyData: PrintifyJson;
  let shopifyData: ShopifyJson;
  let productData: ProductJson;
  try {
    const rawPrintify: unknown = JSON.parse(readFileSync(outputs.printify, "utf8"));
    if (!isPrintifyJson(rawPrintify)) {
      return err(new ValidationError([`${outputs.printify} is missing mockupUrls`]));
    }
    printifyData = rawPrintify;

    const rawShopify: unknown = JSON.parse(readFileSync(outputs.shopify, "utf8"));
    if (!isShopifyJson(rawShopify)) {
      return err(new ValidationError([`${outputs.shopify} is missing shopifyProductId`]));
    }
    shopifyData = rawShopify;

    const rawProduct: unknown = JSON.parse(readFileSync(outputs.product, "utf8"));
    if (!isProductJson(rawProduct)) {
      return err(new ValidationError([`${outputs.product} is missing title`]));
    }
    productData = rawProduct;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new ValidationError([`failed to read "${designStem}" job files: ${message}`]));
  }

  if (printifyData.colorRegeneratedAt === undefined) {
    return err(
      new ValidationError([
        `${outputs.printify} has no colorRegeneratedAt — run ` +
          `scripts/regenerate-printify-product.ts "${designStem}" first. Refusing to sync the old mockup ` +
          "set onto Shopify under the assumption it's the new one.",
      ]),
    );
  }

  const { images, mappedSlots, unmappedSlots } = mapMockupsToGallery(printifyData.mockupUrls, productData.title);

  if (images.length === 0) {
    return err(new ValidationError(["no gallery slots could be mapped to a regenerated mockup URL — nothing to sync"]));
  }

  const providerResult = createShopifyProvider(options.shopifyProviderOptions);
  if (!providerResult.ok) {
    return err(providerResult.error);
  }
  const shopify = providerResult.value;

  const replaceResult = await shopify.replaceProductImages({
    jobId: `${designStem}-color-regen`,
    shopifyProductId: shopifyData.shopifyProductId,
    images,
  });
  if (!replaceResult.ok) {
    return err(replaceResult.error);
  }

  baseLogger.info(`"${designStem}" Shopify image gallery replaced (existing product, no duplicate)`, {
    metadata: {
      shopifyProductId: shopifyData.shopifyProductId,
      added: replaceResult.value.addedImageIds.length,
      removed: replaceResult.value.removedImageIds.length,
      unmappedSlots,
    },
  });

  return ok({
    designStem,
    shopifyProductId: shopifyData.shopifyProductId,
    mappedSlots,
    unmappedSlots,
    addedImageIds: replaceResult.value.addedImageIds,
    removedImageIds: replaceResult.value.removedImageIds,
  });
}

async function main(): Promise<void> {
  loadEnv();
  const designStem = process.argv[2];
  if (designStem === undefined || designStem.trim().length === 0) {
    console.error(
      'Usage: node --experimental-strip-types scripts/sync-product-images.ts "<design stem>"\n' +
        '  e.g. node --experimental-strip-types scripts/sync-product-images.ts "GOLDEN turntable"',
    );
    process.exitCode = 1;
    return;
  }

  const result = await syncProductImages(designStem);
  if (!result.ok) {
    console.error(`Shopify image sync failed for "${designStem}": ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const r = result.value;
  console.log(`\nShopify product ${r.shopifyProductId} ("${r.designStem}") image gallery replaced.`);
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
