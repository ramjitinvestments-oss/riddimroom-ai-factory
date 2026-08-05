/**
 * Publishes every Printify-uploaded piece of artwork to Shopify using
 * Printify's own publish-to-Shopify integration
 * (`PrintifyProvider.publishProductToShopify()`,
 * `automation/printify/printify-provider.ts`) instead of a bare, hand-built
 * Shopify Admin API product creation. This is the fix for a real production
 * incident: `scripts/publish-to-shopify.ts`'s `createProduct()` path only
 * ever created a Shopify product with a single generic "Default Title"
 * variant and 0 inventory — never fulfillment-linked to Printify, never
 * orderable. See `PrintifyPublishRequest`'s doc comment in
 * `automation/printify/types.ts` for the full mechanism.
 *
 * Order dependency: the Printify product's garment color/placement should
 * already be in its final state (e.g. switched to the approved black
 * variants via `scripts/regenerate-printify-product.ts`) *before* this
 * script runs — Printify's publish call pushes whatever variant matrix the
 * Printify product currently has. This script does not switch garment
 * color itself; `scripts/apparel-pipeline.ts` is responsible for calling
 * `regeneratePrintifyProduct()` first in its create-path ordering.
 *
 * By default scans `designs/processed/` — same discovery/idempotency
 * conventions as `scripts/publish-to-shopify.ts`: a PNG with no
 * `<stem>.printify.json` hasn't been uploaded to Printify yet and is
 * skipped; a PNG with a `<stem>.shopify.json` already exists and is skipped
 * (idempotent).
 *
 * After the native publish completes, applies the metadata Printify's
 * integration doesn't set — tags, SEO metafields, collection — via
 * `ShopifyProvider.finalizeExternalProduct()`, then reads the product back
 * via `getProduct()` and verifies it. Verification here is deliberately
 * different from `scripts/publish-to-shopify.ts`'s: title/description are
 * controlled by Printify's own publish payload (sourced from the same
 * title/description this codebase originally uploaded to Printify with),
 * not re-derived and string-compared here. What's actually load-bearing for
 * "orderable" is checked explicitly:
 *   1. More than one variant exists (the literal bug this script fixes —
 *      a lone "Default Title" variant means the old broken path ran, not
 *      this one).
 *   2. Every requested tag is present (post-`finalizeExternalProduct`).
 *   3. The requested collection (if any) is assigned.
 *   4. SEO title/description (if any) match what was requested.
 *
 * Production-safe error handling: if Printify's publish, the poll, or
 * `finalizeExternalProduct` fails for any item, the whole scan stops
 * immediately — no later item is attempted. Re-run after fixing the
 * problem to pick up where it left off (already-published items are
 * skipped, not redone).
 *
 *   node --experimental-strip-types scripts/publish-to-shopify-via-printify.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPrintifyProvider,
  type CreatePrintifyProviderOptions,
} from "../automation/printify/create-provider.ts";
import {
  createShopifyProvider,
  type CreateShopifyProviderOptions,
} from "../automation/shopify/create-provider.ts";
import type { StoppedDueTo } from "../automation/shared/batch-report.ts";
import { loadEnv, parseBoolean } from "../automation/shared/config.ts";
import type { ConfigError, ValidationError } from "../automation/shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";
import { listPngFiles, outputPaths } from "./import-artwork.ts";
import { getStoreDomain, moveArtworkToPublished } from "./publish-to-shopify.ts";

export interface PublishedToShopifyViaPrintify {
  readonly sourcePath: string;
  readonly jobId: string;
  readonly printifyProductId: string;
  readonly shopifyProductId: string;
  readonly handle: string;
  readonly liveUrl: string;
  readonly status: string;
}

export interface PrintifyNativePublishReport {
  readonly scanned: number;
  readonly published: readonly PublishedToShopifyViaPrintify[];
  readonly dryRunPublished: readonly PublishedToShopifyViaPrintify[];
  readonly skippedNotUploaded: readonly string[];
  readonly skippedAlreadyPublished: readonly string[];
  readonly stoppedDueTo: StoppedDueTo | null;
  readonly remainingUnprocessed: readonly string[];
}

export interface PublishApprovedArtworkToShopifyViaPrintifyOptions {
  /** Root directory scanned for PNGs to publish. Defaults to "designs/processed". */
  readonly approvedRoot?: string;
  /** Defaults to "designs/published". */
  readonly publishedRoot?: string;
  readonly logger?: Logger;
  readonly printifyProviderOptions?: CreatePrintifyProviderOptions;
  readonly shopifyProviderOptions?: CreateShopifyProviderOptions;
  readonly now?: () => Date;
  /** Max time to wait for Printify to report the Shopify product id. Defaults to the provider's own default (60000ms). */
  readonly maxWaitMs?: number;
  readonly pollIntervalMs?: number;
}

type PublishApprovedArtworkToShopifyViaPrintifyError = ConfigError | ValidationError;

interface ExistingPrintifyJson {
  readonly jobId: string;
  readonly printifyProductId: string;
}

interface ProductJson {
  readonly jobId: string;
  readonly title: string;
  readonly collectionName?: string;
}

interface SeoJson {
  readonly seoTitle: string;
  readonly seoDescription: string;
}

function isExistingPrintifyJson(value: unknown): value is ExistingPrintifyJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.jobId === "string" && typeof v.printifyProductId === "string" && v.printifyProductId.trim().length > 0;
}

function isProductJson(value: unknown): value is ProductJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.jobId === "string" &&
    v.jobId.trim().length > 0 &&
    typeof v.title === "string" &&
    v.title.trim().length > 0 &&
    (v.collectionName === undefined || typeof v.collectionName === "string")
  );
}

function isSeoJson(value: unknown): value is SeoJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.seoTitle === "string" && typeof v.seoDescription === "string";
}

function isTagsJson(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((t) => typeof t === "string");
}

/**
 * Checks what's load-bearing for "actually orderable" plus the metadata
 * `finalizeExternalProduct` was asked to set. See the module doc comment
 * for why this deliberately does not re-check title/description text.
 */
function verifyNativelyPublishedProduct(
  product: { readonly variants: readonly { readonly id: string; readonly price: number }[]; readonly tags: readonly string[]; readonly collections: readonly string[]; readonly seoTitle: string | null; readonly seoDescription: string | null },
  expected: { readonly tags: readonly string[]; readonly seo: SeoJson; readonly collection?: string },
): string[] {
  const failedChecks: string[] = [];

  if (product.variants.length <= 1) failedChecks.push("variants (expected more than one real garment variant, not a lone Default Title)");

  const expectedTags = new Set(expected.tags.map((t) => t.toLowerCase()));
  const actualTags = new Set(product.tags.map((t) => t.toLowerCase()));
  if ([...expectedTags].some((t) => !actualTags.has(t))) failedChecks.push("tags");

  if (expected.collection !== undefined && !product.collections.includes(expected.collection)) {
    failedChecks.push("collections");
  }
  if (product.seoTitle !== expected.seo.seoTitle || product.seoDescription !== expected.seo.seoDescription) {
    failedChecks.push("seo");
  }

  return failedChecks;
}

/**
 * Publishes every approved-and-Printify-uploaded PNG under `approvedRoot`
 * to Shopify via Printify's native publish integration, finalizes tags/
 * SEO/collection, verifies, and moves fully-verified artwork to
 * `publishedRoot`. Production-safe — see the module doc comment.
 */
export async function publishApprovedArtworkToShopifyViaPrintify(
  options: PublishApprovedArtworkToShopifyViaPrintifyOptions = {},
): Promise<Result<PrintifyNativePublishReport, PublishApprovedArtworkToShopifyViaPrintifyError>> {
  const approvedRoot = options.approvedRoot ?? path.join("designs", "processed");
  const publishedRoot = options.publishedRoot ?? path.join("designs", "published");
  const now = options.now ?? ((): Date => new Date());
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/publish-to-shopify-via-printify", transports: [new ConsoleTransport(), new FileTransport()] });

  if (!existsSync(approvedRoot)) {
    return ok({
      scanned: 0,
      published: [],
      dryRunPublished: [],
      skippedNotUploaded: [],
      skippedAlreadyPublished: [],
      stoppedDueTo: null,
      remainingUnprocessed: [],
    });
  }

  const printifyResult = createPrintifyProvider({ ...options.printifyProviderOptions, logger: baseLogger });
  if (!printifyResult.ok) return err(printifyResult.error);
  const printify = printifyResult.value;

  const shopifyResult = createShopifyProvider({ ...options.shopifyProviderOptions, logger: baseLogger });
  if (!shopifyResult.ok) return err(shopifyResult.error);
  const shopify = shopifyResult.value;

  const dryRun = parseBoolean((options.shopifyProviderOptions?.env ?? process.env).DRY_RUN, true);

  const pngPaths = listPngFiles(approvedRoot);
  const published: PublishedToShopifyViaPrintify[] = [];
  const dryRunPublished: PublishedToShopifyViaPrintify[] = [];
  const skippedNotUploaded: string[] = [];
  const skippedAlreadyPublished: string[] = [];
  let stoppedDueTo: StoppedDueTo | null = null;

  for (const pngPath of pngPaths) {
    const outputs = outputPaths(pngPath);

    if (!existsSync(outputs.printify)) {
      skippedNotUploaded.push(pngPath);
      continue;
    }
    if (existsSync(outputs.shopify)) {
      skippedAlreadyPublished.push(pngPath);
      continue;
    }

    let printifyJson: ExistingPrintifyJson;
    let product: ProductJson;
    let seo: SeoJson;
    let tags: string[];
    try {
      const printifyRaw: unknown = JSON.parse(readFileSync(outputs.printify, "utf8"));
      if (!isExistingPrintifyJson(printifyRaw)) {
        stoppedDueTo = { sourcePath: pngPath, reason: `${outputs.printify} is missing jobId/printifyProductId`, details: [] };
        break;
      }
      printifyJson = printifyRaw;

      const productRaw: unknown = JSON.parse(readFileSync(outputs.product, "utf8"));
      if (!isProductJson(productRaw)) {
        stoppedDueTo = { sourcePath: pngPath, jobId: printifyJson.jobId, reason: "product.json is missing required fields", details: [] };
        break;
      }
      product = productRaw;

      const seoRaw: unknown = JSON.parse(readFileSync(outputs.seo, "utf8"));
      if (!isSeoJson(seoRaw)) {
        stoppedDueTo = { sourcePath: pngPath, jobId: printifyJson.jobId, reason: "seo.json is missing required fields", details: [] };
        break;
      }
      seo = seoRaw;

      const tagsRaw: unknown = JSON.parse(readFileSync(outputs.tags, "utf8"));
      if (!isTagsJson(tagsRaw)) {
        stoppedDueTo = { sourcePath: pngPath, jobId: printifyJson.jobId, reason: "tags.json is not an array of strings", details: [] };
        break;
      }
      tags = tagsRaw;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stoppedDueTo = { sourcePath: pngPath, reason: "failed to read artwork/metadata files", details: [message] };
      break;
    }

    const jobLogger = baseLogger.withJob(printifyJson.jobId, "publish-shopify-via-printify");

    const publishResult = await printify.publishProductToShopify({
      jobId: printifyJson.jobId,
      printifyProductId: printifyJson.printifyProductId,
      ...(options.maxWaitMs !== undefined ? { maxWaitMs: options.maxWaitMs } : {}),
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
    });
    if (!publishResult.ok) {
      stoppedDueTo = {
        sourcePath: pngPath,
        jobId: printifyJson.jobId,
        reason: "Printify native publish-to-Shopify failed",
        details: [publishResult.error.message],
      };
      break;
    }

    const finalizeResult = await shopify.finalizeExternalProduct({
      jobId: printifyJson.jobId,
      shopifyProductId: publishResult.value.shopifyProductId,
      tags,
      seoTitle: seo.seoTitle,
      seoDescription: seo.seoDescription,
      ...(product.collectionName !== undefined ? { collection: product.collectionName } : {}),
    });
    if (!finalizeResult.ok) {
      stoppedDueTo = {
        sourcePath: pngPath,
        jobId: printifyJson.jobId,
        reason: `Printify created Shopify product ${publishResult.value.shopifyProductId} but finalizing tags/SEO/collection failed`,
        details: [finalizeResult.error.message],
      };
      break;
    }

    const verification = await shopify.getProduct(publishResult.value.shopifyProductId);
    if (!verification.ok) {
      stoppedDueTo = {
        sourcePath: pngPath,
        jobId: printifyJson.jobId,
        reason:
          `published (id ${publishResult.value.shopifyProductId}) but verification could not be completed — ` +
          `refusing to record this as published without confirming the product actually exists`,
        details: [verification.error.message],
      };
      break;
    }

    const failedChecks = verifyNativelyPublishedProduct(verification.value, {
      tags,
      seo,
      ...(product.collectionName !== undefined ? { collection: product.collectionName } : {}),
    });

    const handle = publishResult.value.shopifyHandle ?? verification.value.handle;
    const liveUrl = `https://${getStoreDomain(options.shopifyProviderOptions)}/products/${handle}`;

    if (failedChecks.length > 0) {
      writeFileSync(
        outputs.shopify,
        JSON.stringify(
          {
            jobId: printifyJson.jobId,
            printifyProductId: printifyJson.printifyProductId,
            shopifyProductId: publishResult.value.shopifyProductId,
            handle,
            liveUrl,
            status: "verification_failed",
            failedChecks,
            provider: "printify-native",
            publishedAt: now().toISOString(),
          },
          null,
          2,
        ),
      );
      stoppedDueTo = {
        sourcePath: pngPath,
        jobId: printifyJson.jobId,
        reason: `Shopify publish verification failed (product id ${publishResult.value.shopifyProductId})`,
        details: failedChecks.map((check) => `field mismatch: ${check}`),
      };
      break;
    }

    const isDryRunResult = dryRun || publishResult.value.shopifyProductId.startsWith("dry-run-shopify-product-");

    if (isDryRunResult) {
      const dryRunMarkerPath = outputs.shopify.replace(/\.shopify\.json$/, ".shopify.dryrun.json");
      try {
        writeFileSync(
          dryRunMarkerPath,
          JSON.stringify(
            {
              jobId: printifyJson.jobId,
              printifyProductId: printifyJson.printifyProductId,
              shopifyProductId: publishResult.value.shopifyProductId,
              handle,
              liveUrl,
              status: "active",
              provider: "printify-native",
              dryRun: true,
              note:
                "DRY_RUN publish — no real Shopify product was created. Intentionally named " +
                "*.shopify.dryrun.json (not *.shopify.json) so a later real (DRY_RUN=false) run is " +
                "not skipped as \"already published\".",
              publishedAt: now().toISOString(),
            },
            null,
            2,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stoppedDueTo = {
          sourcePath: pngPath,
          jobId: printifyJson.jobId,
          reason: `dry-run published and verified (id ${publishResult.value.shopifyProductId}) but failed to record`,
          details: [message],
        };
        break;
      }

      dryRunPublished.push({
        sourcePath: pngPath,
        jobId: printifyJson.jobId,
        printifyProductId: printifyJson.printifyProductId,
        shopifyProductId: publishResult.value.shopifyProductId,
        handle,
        liveUrl,
        status: "active",
      });
      jobLogger.info(
        "DRY_RUN native publish verified against the in-memory dry-run providers only — " +
          "NOT a real Shopify product, NOT moved to designs/published/",
        { metadata: { shopifyProductId: publishResult.value.shopifyProductId, handle } },
      );
      continue;
    }

    try {
      writeFileSync(
        outputs.shopify,
        JSON.stringify(
          {
            jobId: printifyJson.jobId,
            printifyProductId: printifyJson.printifyProductId,
            shopifyProductId: publishResult.value.shopifyProductId,
            handle,
            liveUrl,
            status: "active",
            provider: "printify-native",
            publishedAt: now().toISOString(),
          },
          null,
          2,
        ),
      );
      moveArtworkToPublished(pngPath, approvedRoot, publishedRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stoppedDueTo = {
        sourcePath: pngPath,
        jobId: printifyJson.jobId,
        reason: `published and verified (id ${publishResult.value.shopifyProductId}) but failed to record/move`,
        details: [message],
      };
      break;
    }

    published.push({
      sourcePath: path.join(publishedRoot, path.relative(approvedRoot, pngPath)),
      jobId: printifyJson.jobId,
      printifyProductId: printifyJson.printifyProductId,
      shopifyProductId: publishResult.value.shopifyProductId,
      handle,
      liveUrl,
      status: "active",
    });
    jobLogger.info("Artwork published to Shopify via Printify's native integration and moved to designs/published/", {
      metadata: { shopifyProductId: publishResult.value.shopifyProductId, handle },
    });
  }

  const remainingUnprocessed =
    stoppedDueTo !== null ? pngPaths.slice(pngPaths.findIndex((p) => p === stoppedDueTo!.sourcePath) + 1) : [];

  if (stoppedDueTo !== null) {
    baseLogger.error("Printify-native Shopify publish stopped: production-safe error handling halted the batch", {
      metadata: { stoppedDueTo, remainingUnprocessed: remainingUnprocessed.length },
    });
  }
  baseLogger.info("Printify-native Shopify publish scan complete", {
    metadata: {
      scanned: pngPaths.length,
      published: published.length,
      dryRunPublished: dryRunPublished.length,
      skippedNotUploaded: skippedNotUploaded.length,
      skippedAlreadyPublished: skippedAlreadyPublished.length,
      stopped: stoppedDueTo !== null,
      remainingUnprocessed: remainingUnprocessed.length,
    },
  });

  return ok({
    scanned: pngPaths.length,
    published,
    dryRunPublished,
    skippedNotUploaded,
    skippedAlreadyPublished,
    stoppedDueTo,
    remainingUnprocessed,
  });
}

async function main(): Promise<void> {
  loadEnv();
  const result = await publishApprovedArtworkToShopifyViaPrintify();
  if (!result.ok) {
    console.error(`Printify-native Shopify publish failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const report = result.value;
  console.log(`\nScanned ${report.scanned} PNG(s) in designs/processed/`);
  for (const item of report.published) {
    console.log(`  PUBLISHED  ${item.sourcePath}`);
    console.log(`               printifyProductId: ${item.printifyProductId}`);
    console.log(`               shopifyProductId: ${item.shopifyProductId}`);
    console.log(`               handle: ${item.handle}`);
    console.log(`               liveUrl: ${item.liveUrl}`);
  }
  for (const item of report.dryRunPublished) {
    console.log(`  DRY-RUN    ${item.sourcePath} (NOT a real Shopify product — DRY_RUN was true)`);
  }
  for (const item of report.skippedNotUploaded) {
    console.log(`  SKIPPED    ${item} (not yet uploaded to Printify — run scripts/upload-to-printify.ts first)`);
  }
  for (const item of report.skippedAlreadyPublished) {
    console.log(`  SKIPPED    ${item} (already published or previously attempted)`);
  }
  if (report.stoppedDueTo !== null) {
    console.log(`\n  STOPPED    ${report.stoppedDueTo.sourcePath}`);
    console.log(`               reason: ${report.stoppedDueTo.reason}`);
    for (const detail of report.stoppedDueTo.details) console.log(`               - ${detail}`);
    console.log(`\n  ${report.remainingUnprocessed.length} PNG(s) never attempted:`);
    for (const item of report.remainingUnprocessed) console.log(`    ${item}`);
  }
  console.log(
    `\n${report.published.length} published, ${report.dryRunPublished.length} dry-run (not real), ` +
      `${report.skippedNotUploaded.length} not yet uploaded, ${report.skippedAlreadyPublished.length} already published, ` +
      `${report.stoppedDueTo !== null ? "STOPPED — see above" : "no failures"}.`,
  );

  if (report.stoppedDueTo !== null) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
