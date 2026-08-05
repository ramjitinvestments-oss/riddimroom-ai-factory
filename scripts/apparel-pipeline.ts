/**
 * Single entry point for taking one apparel design from wherever it
 * currently sits in the pipeline to "every future upload requires no
 * manual corrections": detects whether the design already has a live,
 * published Printify/Shopify product and automatically routes to the
 * correct path — never re-implements either path, only orchestrates the
 * existing, already-tested stage scripts in the right order.
 *
 * Routing (detect existing vs. new — "reuse existing products whenever
 * possible", "never duplicate products"):
 *
 *   designs/published/<stem>.printify.json exists
 *     → UPDATE PATH: this product already exists on Printify/Shopify.
 *       Runs scripts/regenerate-printify-product.ts (existing product id
 *       reused, garment switched to the approved black variants, approved
 *       placement re-applied, never a new product) then
 *       scripts/sync-product-images.ts (existing Shopify product id
 *       reused, gallery replaced in the approved 9-slot order).
 *
 *   designs/published/<stem>.printify.json does not exist
 *     → CREATE PATH: this design has never been published. Runs:
 *       scripts/import-artwork.ts → scripts/upload-to-printify.ts →
 *       scripts/regenerate-printify-product.ts (switches the still-in-
 *       designs/processed/ Printify product to the approved black variants
 *       *before* Shopify ever sees it — see the ordering note below) →
 *       scripts/publish-to-shopify-via-printify.ts (creates the Shopify
 *       product via Printify's own fulfillment-linked publish integration,
 *       then applies tags/SEO/collection) → scripts/sync-product-images.ts
 *       (approved 9-slot gallery order).
 *
 *       CHANGED 2026-08-05: this used to call scripts/publish-to-shopify.ts
 *       (a bare, hand-built Shopify Admin API product creation) here, then
 *       regenerate the Printify garment color *afterward*. That order was a
 *       real production bug: the Shopify product created by that path only
 *       ever had a single generic "Default Title" variant and 0 inventory —
 *       never fulfillment-linked to Printify, never actually orderable, no
 *       matter what ran after it. scripts/publish-to-shopify-via-printify.ts
 *       fixes this by using Printify's own publish-to-Shopify integration,
 *       which creates a real, fulfillment-linked product with the full
 *       size/color variant matrix — but only if the Printify product's
 *       variants are already correct *before* that call, hence regenerating
 *       first now instead of after.
 *
 *       Each stage is independently idempotent and production-safe; they
 *       process every ready item in designs/processed/, not just this one
 *       stem, which is the established behavior of those scripts and is not
 *       changed here. If the create path leaves this exact stem newly
 *       published, it immediately chains into the UPDATE PATH's sync step
 *       too — so a first-time upload automatically inherits the approved
 *       gallery order in the same command. This is what makes "no future
 *       upload should require manual corrections" true in practice.
 *
 * Every stage this script calls is independently idempotent and
 * production-safe (stops immediately on first real failure, never fakes
 * success). This orchestrator adds no new side effects of its own beyond
 * calling them in the right order and reporting what happened.
 *
 * This does not weaken the human-approval gate in CLAUDE.md — nothing
 * here runs unattended; a human still invokes this exact command for this
 * exact design. It only removes the need to remember *which* of several
 * scripts to run and in what order.
 *
 *   node --experimental-strip-types scripts/apparel-pipeline.ts "<design stem>"
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../automation/shared/config.ts";
import { ValidationError, type ConfigError, type ExternalServiceError } from "../automation/shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";
import { outputPaths } from "./import-artwork.ts";
import { importApprovedArtwork } from "./import-artwork.ts";
import { uploadApprovedArtworkToPrintify } from "./upload-to-printify.ts";
import { publishApprovedArtworkToShopifyViaPrintify } from "./publish-to-shopify-via-printify.ts";
import { regeneratePrintifyProduct, type RegeneratePrintifyProductResult } from "./regenerate-printify-product.ts";
import { syncProductImages, type SyncProductImagesResult } from "./sync-product-images.ts";

export type ApparelPipelineRoute = "update-existing" | "create-then-update";

export interface ApparelPipelineResult {
  readonly designStem: string;
  readonly route: ApparelPipelineRoute;
  readonly regenerate: RegeneratePrintifyProductResult;
  readonly sync: SyncProductImagesResult;
}

type ApparelPipelineError = ConfigError | ValidationError | ExternalServiceError;

export interface RunApparelPipelineOptions {
  readonly logger?: Logger;
  readonly env?: NodeJS.ProcessEnv;
  /** Defaults to "designs/processed" — override only for isolated tests, never for real pipeline runs. */
  readonly approvedRoot?: string;
  /** Defaults to "designs/published" — override only for isolated tests, never for real pipeline runs. */
  readonly publishedRoot?: string;
}

/**
 * Routes `designStem` to the create or update path and runs it end to
 * end. See the module doc comment for exactly what each path does.
 */
export async function runApparelPipeline(
  designStem: string,
  options: RunApparelPipelineOptions = {},
): Promise<Result<ApparelPipelineResult, ApparelPipelineError>> {
  const env = options.env ?? process.env;
  const approvedRoot = options.approvedRoot ?? path.join("designs", "processed");
  const publishedRoot = options.publishedRoot ?? path.join("designs", "published");
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/apparel-pipeline", transports: [new ConsoleTransport(), new FileTransport()] });

  const publishedOutputs = outputPaths(path.join(publishedRoot, `${designStem}.png`));
  const alreadyPublished = existsSync(publishedOutputs.printify);

  let route: ApparelPipelineRoute;
  let regenerateResult: Result<RegeneratePrintifyProductResult, ApparelPipelineError>;

  if (alreadyPublished) {
    route = "update-existing";
    baseLogger.info(`"${designStem}" already published — routing to update path (reuse existing product)`, {
      metadata: { printifyJsonPath: publishedOutputs.printify },
    });

    regenerateResult = await regeneratePrintifyProduct(designStem, { logger: baseLogger, env, publishedRoot });
    if (!regenerateResult.ok) return err(regenerateResult.error);
  } else {
    route = "create-then-update";
    baseLogger.info(`"${designStem}" not yet published — routing to create path`, {
      metadata: { expectedPrintifyJsonPath: publishedOutputs.printify },
    });

    const importResult = await importApprovedArtwork({ logger: baseLogger, approvedRoot });
    if (!importResult.ok) return err(importResult.error);
    if (importResult.value.stoppedDueTo !== null) {
      return err(
        new ValidationError([
          `import stage stopped at ${importResult.value.stoppedDueTo.sourcePath}: ${importResult.value.stoppedDueTo.reason}`,
          ...importResult.value.stoppedDueTo.details,
        ]),
      );
    }

    const uploadResult = await uploadApprovedArtworkToPrintify({ logger: baseLogger, approvedRoot });
    if (!uploadResult.ok) return err(uploadResult.error);
    if (uploadResult.value.stoppedDueTo !== null) {
      return err(
        new ValidationError([
          `Printify upload stage stopped at ${uploadResult.value.stoppedDueTo.sourcePath}: ${uploadResult.value.stoppedDueTo.reason}`,
          ...uploadResult.value.stoppedDueTo.details,
        ]),
      );
    }

    // Nothing to do for a stem that doesn't exist anywhere — checked here,
    // before regenerate/publish are ever attempted, so a nonexistent design
    // gets this one clear message instead of regeneratePrintifyProduct's
    // more confusing "expected ... to exist" error (it would otherwise be
    // the first thing to notice nothing was ever uploaded for this stem).
    const approvedOutputs = outputPaths(path.join(approvedRoot, `${designStem}.png`));
    if (!existsSync(approvedOutputs.printify)) {
      return err(
        new ValidationError([
          `"${designStem}" was not found under designs/processed/ (or a subdirectory) ready for upload, and is not ` +
            `yet published — nothing to do. Check the stem matches a real file, or that scripts/import-artwork.ts / ` +
            `scripts/prepare-artwork.ts have run for it first.`,
        ]),
      );
    }

    // Switch the Printify product to its final garment color/placement
    // *before* Shopify ever sees it — publishApprovedArtworkToShopifyViaPrintify
    // (below) pushes whatever variant matrix the Printify product currently
    // has, via Printify's own publish integration. Points at approvedRoot,
    // not publishedRoot: the artwork hasn't moved to designs/published/ yet
    // at this point in the create path. See the module doc comment's
    // 2026-08-05 ordering note for the production bug this fixes.
    regenerateResult = await regeneratePrintifyProduct(designStem, {
      logger: baseLogger,
      env,
      publishedRoot: approvedRoot,
    });
    if (!regenerateResult.ok) return err(regenerateResult.error);

    const publishResult = await publishApprovedArtworkToShopifyViaPrintify({
      logger: baseLogger,
      approvedRoot,
      publishedRoot,
      printifyProviderOptions: { env },
      shopifyProviderOptions: { env },
    });
    if (!publishResult.ok) return err(publishResult.error);
    if (publishResult.value.stoppedDueTo !== null) {
      return err(
        new ValidationError([
          `Shopify publish stage stopped at ${publishResult.value.stoppedDueTo.sourcePath}: ${publishResult.value.stoppedDueTo.reason}`,
          ...publishResult.value.stoppedDueTo.details,
        ]),
      );
    }

    if (!existsSync(publishedOutputs.printify)) {
      return err(
        new ValidationError([
          `"${designStem}" was not found under designs/processed/ (or a subdirectory) ready for upload, and is not ` +
            `yet published — nothing to do. Check the stem matches a real file, or that scripts/import-artwork.ts / ` +
            `scripts/prepare-artwork.ts have run for it first.`,
        ]),
      );
    }

    baseLogger.info(
      `"${designStem}" newly published via Printify's native integration — chaining into the update path's sync ` +
        `step so it inherits the approved gallery order automatically`,
    );
  }

  const syncResult = await syncProductImages(designStem, { logger: baseLogger, publishedRoot });
  if (!syncResult.ok) return err(syncResult.error);

  return ok({
    designStem,
    route,
    regenerate: regenerateResult.value,
    sync: syncResult.value,
  });
}

async function main(): Promise<void> {
  loadEnv();
  const designStem = process.argv[2];
  if (designStem === undefined || designStem.trim().length === 0) {
    console.error(
      'Usage: node --experimental-strip-types scripts/apparel-pipeline.ts "<design stem>"\n' +
        '  e.g. node --experimental-strip-types scripts/apparel-pipeline.ts "GOLDEN turntable"\n' +
        '  e.g. node --experimental-strip-types scripts/apparel-pipeline.ts "crown"',
    );
    process.exitCode = 1;
    return;
  }

  const result = await runApparelPipeline(designStem);
  if (!result.ok) {
    console.error(`Apparel pipeline failed for "${designStem}": ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const r = result.value;
  console.log(`\n"${r.designStem}" — route: ${r.route}`);
  console.log(`Printify product (reused, not duplicated): ${r.regenerate.printifyProductId}`);
  console.log(`Applied variant ids: ${r.regenerate.variantIdsApplied.join(", ")}`);
  console.log(`Shopify product (reused, not duplicated): ${r.sync.shopifyProductId}`);
  console.log(`Gallery — mapped:`);
  for (const m of r.sync.mappedSlots) console.log(`  ${m.slot.padEnd(20)} ${m.src}`);
  if (r.sync.unmappedSlots.length > 0) {
    console.log(`Gallery — not mapped (see automation/printify/gallery-standard.ts):`);
    for (const s of r.sync.unmappedSlots) console.log(`  ${s}`);
  }
  console.log(
    `\n"${r.designStem}" is fully production-ready: approved black garment, approved placement, approved ` +
      `gallery order. Verify live before considering it done.`,
  );
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
