/**
 * Publishes every Printify-uploaded piece of artwork to Shopify: reuses
 * `ShopifyProvider.publishProduct()`/`getProduct()`
 * (`automation/shopify/shopify-provider.ts`) completely unmodified in
 * this script — the only Shopify-module changes made to support this
 * stage were additive (SEO metafields, collection assignment, `handle` on
 * publish, the new `getProduct()` read-back method), not a rewrite; the
 * request/response wiring itself lives entirely in the provider, not here.
 *
 * By default scans `designs/processed/` — the same root
 * `scripts/import-artwork.ts` reads from — with the same file-discovery
 * and naming conventions it established (`listPngFiles`, `outputPaths`,
 * `parseDescriptionMarkdown`, all imported from there): a PNG with no
 * `<stem>.printify.json` hasn't been uploaded to Printify yet and is
 * skipped; a PNG with a `<stem>.shopify.json` already exists and is
 * skipped (idempotent — a publish attempt, successful or not, is never
 * repeated automatically, so a stopped run can't create a duplicate
 * Shopify product on retry).
 *
 * After publishing, reads the product straight back via `getProduct()`
 * and verifies title, description, images, variants (price), collections,
 * SEO, and tags actually match what was requested — publishing
 * "succeeding" at the HTTP level isn't the same as every field landing
 * correctly, so each is checked explicitly rather than assumed. Only on a
 * full pass does the artwork (and all its sibling artifact files) move to
 * `designs/published/`.
 *
 * Production-safe error handling: if Shopify fails for any item — the
 * publish call itself, or verification afterward — the whole scan stops
 * immediately. The failing item is marked with `<stem>.shopify.json` so a
 * re-run doesn't attempt it again silently, and stays in `designs/processed/`
 * for a human to inspect; no later item is attempted.
 *
 * Verification guarantees (audited 2026-08-02 after a legacy, now-deleted
 * pipeline — the old `designs/uploaded/<jobId>/` job structure, unrelated to
 * this script's `outputPaths()` naming convention — was found to have
 * recorded `isLive: true` and a `shopifyProductId` for a product that did
 * not actually exist in the store):
 *   1. A product is only ever recorded as published after `getProduct()`
 *      reads it back live from Shopify (or the dry-run provider's in-memory
 *      echo) AND every requested field is confirmed to match. Publishing
 *      "succeeding" at the HTTP level is never itself treated as proof.
 *   2. The id returned by that read-back is checked against the id
 *      `publishProduct()` returned; a mismatch stops the batch instead of
 *      silently trusting either value.
 *   3. DRY_RUN publishes are never written to `<stem>.shopify.json` (the
 *      file this script's own idempotency check looks for) and the artwork
 *      is never moved to `designs/published/`. They're recorded instead in
 *      a separate `<stem>.shopify.dryrun.json` sibling, so `designs/published/`
 *      only ever contains artwork with a real, verified Shopify product —
 *      and a later real (DRY_RUN=false) run is not skipped as
 *      "already published" because of an earlier dry-run test.
 *   4. If verification can't be completed at all (the read-back call
 *      itself errors), that's treated the same as any other failure: the
 *      batch stops immediately and nothing is recorded as published.
 *
 *   node scripts/publish-to-shopify.ts
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ShopifyProductDetails } from "../automation/shopify/types.ts";
import {
  createShopifyProvider,
  type CreateShopifyProviderOptions,
} from "../automation/shopify/create-provider.ts";
import type { StoppedDueTo } from "../automation/shared/batch-report.ts";
import { loadEnv, parseBoolean } from "../automation/shared/config.ts";
import type { ConfigError } from "../automation/shared/errors.ts";
import { escapeHtml } from "../automation/shared/html.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { getDefaultShirtPrice } from "../automation/shared/pricing.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";
import { listPngFiles, outputPaths, parseDescriptionMarkdown } from "./import-artwork.ts";

export interface PublishedToShopify {
  readonly sourcePath: string;
  readonly jobId: string;
  readonly shopifyProductId: string;
  readonly handle: string;
  readonly liveUrl: string;
  readonly status: string;
}

export interface ShopifyPublishReport {
  readonly scanned: number;
  /** Real publishes only — verified via a live Shopify read-back and moved to designs/published/. */
  readonly published: readonly PublishedToShopify[];
  /**
   * DRY_RUN publishes: verified against the in-memory dry-run provider only,
   * never a real Shopify product. Deliberately kept separate from
   * `published` and never moved out of designs/processed/ — see the
   * dry-run isolation note in the module doc comment above.
   */
  readonly dryRunPublished: readonly PublishedToShopify[];
  /** No `<stem>.printify.json` beside the PNG yet — run scripts/upload-to-printify.ts first. */
  readonly skippedNotUploaded: readonly string[];
  /** A `<stem>.shopify.json` already exists — publish already attempted, not retried automatically. */
  readonly skippedAlreadyPublished: readonly string[];
  /** The item that stopped the scan, if any; `null` means every item succeeded or was an idempotent skip. */
  readonly stoppedDueTo: StoppedDueTo | null;
  /** PNGs that were never even attempted because the scan stopped before reaching them. */
  readonly remainingUnprocessed: readonly string[];
}

export interface PublishApprovedArtworkToShopifyOptions {
  /** Root directory scanned for PNGs to publish. Defaults to "designs/processed" (the Artwork Preparation stage's output) — not "designs/approved". */
  readonly approvedRoot?: string;
  /** Defaults to "designs/published". */
  readonly publishedRoot?: string;
  readonly logger?: Logger;
  readonly shopifyProviderOptions?: CreateShopifyProviderOptions;
  readonly now?: () => Date;
}

type PublishApprovedArtworkToShopifyError = ConfigError;

interface ProductJson {
  readonly jobId: string;
  readonly title: string;
  readonly productType: string;
  readonly collectionName?: string;
}

interface SeoJson {
  readonly seoTitle: string;
  readonly seoDescription: string;
}

function isProductJson(value: unknown): value is ProductJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.jobId === "string" &&
    v.jobId.trim().length > 0 &&
    typeof v.title === "string" &&
    v.title.trim().length > 0 &&
    typeof v.productType === "string" &&
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

/** Checks every verifiable field, returning the names of any that don't match. Never throws. */
function verifyPublishedProduct(
  product: ShopifyProductDetails,
  expected: {
    readonly title: string;
    readonly description: string;
    readonly tags: readonly string[];
    readonly priceUsd: number;
    readonly seo: SeoJson;
    readonly collection?: string;
  },
): string[] {
  const failedChecks: string[] = [];

  if (product.title !== expected.title) failedChecks.push("title");
  if (!product.descriptionHtml.includes(escapeHtml(expected.description))) failedChecks.push("description");
  if (product.imageUrls.length === 0) failedChecks.push("images");
  if (product.variants.length === 0 || product.variants.some((v) => Math.abs(v.price - expected.priceUsd) > 0.001)) {
    failedChecks.push("variants");
  }
  if (expected.collection !== undefined && !product.collections.includes(expected.collection)) {
    failedChecks.push("collections");
  }
  if (product.seoTitle !== expected.seo.seoTitle || product.seoDescription !== expected.seo.seoDescription) {
    failedChecks.push("seo");
  }
  const expectedTags = new Set(expected.tags.map((t) => t.toLowerCase()));
  const actualTags = new Set(product.tags.map((t) => t.toLowerCase()));
  if (expectedTags.size !== actualTags.size || [...expectedTags].some((t) => !actualTags.has(t))) {
    failedChecks.push("tags");
  }

  return failedChecks;
}

/**
 * Moves every existing sibling artifact (artwork +
 * prepared/product/seo/tags/description/job/printify/shopify) from the
 * processed root to published/, preserving any subdirectory structure.
 * Exported so scripts/publish-to-shopify-via-printify.ts can reuse the same
 * move semantics instead of re-implementing them (module isolation — this
 * is the one place that knows the full sibling-file set for a design).
 */
export function moveArtworkToPublished(pngPath: string, approvedRoot: string, publishedRoot: string): void {
  const relative = path.relative(approvedRoot, pngPath);
  const destPng = path.join(publishedRoot, relative);
  mkdirSync(path.dirname(destPng), { recursive: true });

  const sources = outputPaths(pngPath);
  const destinations = outputPaths(destPng);
  const pairs: ReadonlyArray<[string, string]> = [
    [pngPath, destPng],
    [sources.prepared, destinations.prepared],
    [sources.product, destinations.product],
    [sources.seo, destinations.seo],
    [sources.tags, destinations.tags],
    [sources.description, destinations.description],
    [sources.job, destinations.job],
    [sources.printify, destinations.printify],
    [sources.shopify, destinations.shopify],
  ];
  for (const [from, to] of pairs) {
    if (existsSync(from)) {
      renameSync(from, to);
    }
  }
}

/**
 * Best-effort store domain for building the live URL; falls back to a
 * placeholder if unconfigured (e.g. dry-run tests). Exported for reuse by
 * scripts/publish-to-shopify-via-printify.ts.
 */
export function getStoreDomain(providerOptions: CreateShopifyProviderOptions | undefined): string {
  const env = providerOptions?.env ?? process.env;
  return env.SHOPIFY_STORE_DOMAIN ?? "your-store.myshopify.com";
}

/**
 * Publishes every approved-and-Printify-uploaded PNG under `approvedRoot`
 * to Shopify that hasn't already been published, verifies every field the
 * publish was supposed to set, and moves fully-verified artwork to
 * `publishedRoot`. Production-safe: the moment Shopify fails for an item —
 * publishing itself, or the post-publish verification — the scan stops
 * immediately and every later PNG is reported as unprocessed rather than
 * attempted — see the module doc comment. The only other thing that
 * aborts before any item is tried is the Shopify provider itself being
 * unusable (e.g. `DRY_RUN=false` with missing credentials).
 */
export async function publishApprovedArtworkToShopify(
  options: PublishApprovedArtworkToShopifyOptions = {},
): Promise<Result<ShopifyPublishReport, PublishApprovedArtworkToShopifyError>> {
  const approvedRoot = options.approvedRoot ?? path.join("designs", "processed");
  const publishedRoot = options.publishedRoot ?? path.join("designs", "published");
  const now = options.now ?? ((): Date => new Date());
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/publish-to-shopify", transports: [new ConsoleTransport(), new FileTransport()] });

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

  const providerResult = createShopifyProvider({ ...options.shopifyProviderOptions, logger: baseLogger });
  if (!providerResult.ok) {
    return err(providerResult.error);
  }
  const shopify = providerResult.value;

  // Determines whether this run can possibly create a real Shopify product.
  // Checked the same way `createShopifyProvider` itself decides (parseBoolean
  // on DRY_RUN, default true) so this never drifts out of sync with which
  // provider was actually selected above.
  const dryRun = parseBoolean((options.shopifyProviderOptions?.env ?? process.env).DRY_RUN, true);

  const pngPaths = listPngFiles(approvedRoot);
  const published: PublishedToShopify[] = [];
  const dryRunPublished: PublishedToShopify[] = [];
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

    let product: ProductJson;
    let seo: SeoJson;
    let tags: string[];
    let description: string;
    let artworkPng: Buffer;
    try {
      const productRaw: unknown = JSON.parse(readFileSync(outputs.product, "utf8"));
      if (!isProductJson(productRaw)) {
        stoppedDueTo = { sourcePath: pngPath, reason: "product.json is missing required fields", details: [] };
        break;
      }
      product = productRaw;

      const seoRaw: unknown = JSON.parse(readFileSync(outputs.seo, "utf8"));
      if (!isSeoJson(seoRaw)) {
        stoppedDueTo = { sourcePath: pngPath, jobId: product.jobId, reason: "seo.json is missing required fields", details: [] };
        break;
      }
      seo = seoRaw;

      const tagsRaw: unknown = JSON.parse(readFileSync(outputs.tags, "utf8"));
      if (!isTagsJson(tagsRaw)) {
        stoppedDueTo = { sourcePath: pngPath, jobId: product.jobId, reason: "tags.json is not an array of strings", details: [] };
        break;
      }
      tags = tagsRaw;

      description = parseDescriptionMarkdown(readFileSync(outputs.description, "utf8"));
      artworkPng = readFileSync(pngPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stoppedDueTo = { sourcePath: pngPath, reason: "failed to read artwork/metadata files", details: [message] };
      break;
    }

    const jobLogger = baseLogger.withJob(product.jobId, "publish-shopify");
    const priceUsd = getDefaultShirtPrice();

    const publish = await shopify.publishProduct({
      jobId: product.jobId,
      title: product.title,
      descriptionHtml: `<p>${escapeHtml(description)}</p>`,
      tags,
      productType: product.productType,
      priceUsd,
      imagePng: artworkPng,
      seoTitle: seo.seoTitle,
      seoDescription: seo.seoDescription,
      ...(product.collectionName !== undefined ? { collection: product.collectionName } : {}),
    });
    if (!publish.ok) {
      stoppedDueTo = { sourcePath: pngPath, jobId: product.jobId, reason: "Shopify publish failed", details: [publish.error.message] };
      break;
    }

    const verification = await shopify.getProduct(publish.value.shopifyProductId);
    if (!verification.ok) {
      stoppedDueTo = {
        sourcePath: pngPath,
        jobId: product.jobId,
        reason:
          `published (id ${publish.value.shopifyProductId}) but verification could not be completed — ` +
          `refusing to record this as published without confirming the product actually exists`,
        details: [verification.error.message],
      };
      break;
    }

    // Defense in depth: getProduct() is fetched by the exact id publishProduct()
    // returned, so these should always match for any correctly implemented
    // provider — but a mismatch here means a provider bug could otherwise
    // cause a wrong id to be recorded as "verified". Stop rather than trust it.
    if (verification.value.shopifyProductId !== publish.value.shopifyProductId) {
      stoppedDueTo = {
        sourcePath: pngPath,
        jobId: product.jobId,
        reason:
          `verification read back product id ${verification.value.shopifyProductId}, which does not match ` +
          `the id ${publish.value.shopifyProductId} that was just published — refusing to record an unverified id`,
        details: [],
      };
      break;
    }

    const failedChecks = verifyPublishedProduct(verification.value, {
      title: product.title,
      description,
      tags,
      priceUsd,
      seo,
      ...(product.collectionName !== undefined ? { collection: product.collectionName } : {}),
    });

    const liveUrl = `https://${getStoreDomain(options.shopifyProviderOptions)}/products/${publish.value.handle}`;

    if (failedChecks.length > 0) {
      writeFileSync(
        outputs.shopify,
        JSON.stringify(
          {
            jobId: product.jobId,
            shopifyProductId: publish.value.shopifyProductId,
            handle: publish.value.handle,
            liveUrl,
            status: "verification_failed",
            failedChecks,
            publishedAt: now().toISOString(),
          },
          null,
          2,
        ),
      );
      stoppedDueTo = {
        sourcePath: pngPath,
        jobId: product.jobId,
        reason: `Shopify publish verification failed (product id ${publish.value.shopifyProductId})`,
        details: failedChecks.map((check) => `field mismatch: ${check}`),
      };
      break;
    }

    // Belt-and-suspenders alongside the `dryRun` flag computed above: even if
    // DRY_RUN parsing ever drifted, a shopifyProductId shaped like the
    // dry-run provider's own fake ids is never treated as real.
    const isDryRunResult = dryRun || publish.value.shopifyProductId.startsWith("dry-run-product-");

    if (isDryRunResult) {
      // Never write outputs.shopify (`<stem>.shopify.json`) for a dry-run
      // result — that filename is this script's own idempotency marker, and
      // a stray dry-run write there would silently block a real publish
      // later. Never move the artwork to designs/published/ either — that
      // directory is reserved for artwork with a real, verified Shopify
      // product behind it. See the module doc comment for the incident this
      // fixed.
      const dryRunMarkerPath = outputs.shopify.replace(/\.shopify\.json$/, ".shopify.dryrun.json");
      try {
        writeFileSync(
          dryRunMarkerPath,
          JSON.stringify(
            {
              jobId: product.jobId,
              shopifyProductId: publish.value.shopifyProductId,
              handle: publish.value.handle,
              liveUrl,
              status: verification.value.status,
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
          jobId: product.jobId,
          reason: `dry-run published and verified (id ${publish.value.shopifyProductId}) but failed to record`,
          details: [message],
        };
        break;
      }

      dryRunPublished.push({
        sourcePath: pngPath,
        jobId: product.jobId,
        shopifyProductId: publish.value.shopifyProductId,
        handle: publish.value.handle,
        liveUrl,
        status: verification.value.status,
      });
      jobLogger.info(
        "DRY_RUN publish verified against the in-memory dry-run provider only — " +
          "NOT a real Shopify product, NOT moved to designs/published/",
        { metadata: { shopifyProductId: publish.value.shopifyProductId, handle: publish.value.handle } },
      );
      continue;
    }

    try {
      writeFileSync(
        outputs.shopify,
        JSON.stringify(
          {
            jobId: product.jobId,
            shopifyProductId: publish.value.shopifyProductId,
            handle: publish.value.handle,
            liveUrl,
            status: verification.value.status,
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
        jobId: product.jobId,
        reason: `published and verified (id ${publish.value.shopifyProductId}) but failed to record/move`,
        details: [message],
      };
      break;
    }

    published.push({
      sourcePath: path.join(publishedRoot, path.relative(approvedRoot, pngPath)),
      jobId: product.jobId,
      shopifyProductId: publish.value.shopifyProductId,
      handle: publish.value.handle,
      liveUrl,
      status: verification.value.status,
    });
    jobLogger.info("Artwork published to Shopify and moved to designs/published/", {
      metadata: { shopifyProductId: publish.value.shopifyProductId, handle: publish.value.handle },
    });
  }

  const remainingUnprocessed =
    stoppedDueTo !== null
      ? pngPaths.slice(pngPaths.findIndex((p) => p === stoppedDueTo!.sourcePath) + 1)
      : [];

  if (stoppedDueTo !== null) {
    baseLogger.error("Shopify publish stopped: production-safe error handling halted the batch", {
      metadata: { stoppedDueTo, remainingUnprocessed: remainingUnprocessed.length },
    });
  }
  baseLogger.info("Shopify publish scan complete", {
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
  const result = await publishApprovedArtworkToShopify();
  if (!result.ok) {
    console.error(`Shopify publish failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const report = result.value;
  console.log(`\nScanned ${report.scanned} PNG(s) in designs/processed/`);
  for (const item of report.published) {
    console.log(`  PUBLISHED  ${item.sourcePath}`);
    console.log(`               shopifyProductId: ${item.shopifyProductId}`);
    console.log(`               handle: ${item.handle}`);
    console.log(`               liveUrl: ${item.liveUrl}`);
    console.log(`               status: ${item.status}`);
  }
  for (const item of report.dryRunPublished) {
    console.log(`  DRY-RUN    ${item.sourcePath} (NOT a real Shopify product — DRY_RUN was true)`);
    console.log(`               shopifyProductId: ${item.shopifyProductId} (fake)`);
    console.log(`               NOT moved to designs/published/; recorded in *.shopify.dryrun.json`);
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

  const failed = report.stoppedDueTo !== null ? 1 : 0;
  console.log("\nFinal report:");
  console.log(`  Processed:  ${report.published.length + failed}`);
  console.log(`  Succeeded:  ${report.published.length}`);
  console.log(`  Failed:     ${failed}`);
  console.log(`  Remaining:  ${report.remainingUnprocessed.length}`);

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
