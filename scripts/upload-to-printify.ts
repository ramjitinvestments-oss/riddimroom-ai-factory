/**
 * Uploads every approved, already-analyzed piece of artwork to Printify:
 * upload the image, create the product, let Printify auto-generate
 * mockups — all of that is `PrintifyProvider.uploadProduct()`
 * (`automation/printify/printify-provider.ts`), reused here completely
 * unmodified. This script only does the scanning/orchestration around it;
 * no Printify API logic lives here.
 *
 * By default scans `designs/processed/` — the same root
 * `scripts/import-artwork.ts` reads from — with the exact same
 * file-discovery and naming conventions it established (`listPngFiles`,
 * `outputPaths`, `parseDescriptionMarkdown` — all imported from there, not
 * reimplemented): a PNG with no `<stem>.product.json` beside it hasn't
 * been analyzed yet and is skipped; a PNG with a `<stem>.printify.json`
 * beside it has already been uploaded and is skipped (idempotent — safe
 * to re-run without re-uploading or double-charging Printify).
 *
 * Every product uses the fixed shirt retail price
 * (`automation/shared/pricing.ts`), read fresh at upload time rather than
 * trusted from `product.json` — this project has already shipped once
 * with a stale price sitting in a job's `product.json` from before a
 * pricing-policy change, so price is deliberately re-derived here instead
 * of assumed correct from an earlier stage.
 *
 * Production-safe error handling: if Printify fails for any item, the
 * whole scan stops immediately — no later item is attempted, nothing is
 * silently skipped past a failure. Re-run after fixing the problem to
 * pick up where it left off (already-uploaded items are skipped, not
 * redone).
 *
 * Does not touch Shopify at all — publishing is a separate, later stage.
 *
 *   node scripts/upload-to-printify.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPrintifyProvider,
  type CreatePrintifyProviderOptions,
} from "../automation/printify/create-provider.ts";
import type { StoppedDueTo } from "../automation/shared/batch-report.ts";
import { loadEnv } from "../automation/shared/config.ts";
import type { ConfigError, ValidationError } from "../automation/shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { getDefaultShirtPrice } from "../automation/shared/pricing.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";
import { listPngFiles, outputPaths, parseDescriptionMarkdown } from "./import-artwork.ts";

export interface UploadedToPrintify {
  readonly sourcePath: string;
  readonly jobId: string;
  readonly printifyProductId: string;
  readonly mockupUrls: readonly string[];
  readonly status: "uploaded";
}

export interface PrintifyUploadReport {
  readonly scanned: number;
  readonly uploaded: readonly UploadedToPrintify[];
  /** No `<stem>.product.json` beside the PNG yet — run scripts/import-artwork.ts first. */
  readonly skippedNotImported: readonly string[];
  /** A `<stem>.printify.json` already exists — already uploaded, not re-attempted. */
  readonly skippedAlreadyUploaded: readonly string[];
  /** The item that stopped the scan, if any; `null` means every item succeeded or was an idempotent skip. */
  readonly stoppedDueTo: StoppedDueTo | null;
  /** PNGs that were never even attempted because the scan stopped before reaching them. */
  readonly remainingUnprocessed: readonly string[];
}

export interface UploadApprovedArtworkToPrintifyOptions {
  /** Root directory scanned for PNGs to upload. Defaults to "designs/processed" (the Artwork Preparation stage's output) — not "designs/approved". */
  readonly approvedRoot?: string;
  readonly logger?: Logger;
  readonly printifyProviderOptions?: CreatePrintifyProviderOptions;
  readonly now?: () => Date;
}

type UploadApprovedArtworkToPrintifyError = ConfigError | ValidationError;

interface ProductJson {
  readonly jobId: string;
  readonly title: string;
}

function isProductJson(value: unknown): value is ProductJson {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.jobId === "string" && v.jobId.trim().length > 0 && typeof v.title === "string" && v.title.trim().length > 0;
}

/**
 * Uploads every approved-and-analyzed PNG under `approvedRoot` to Printify
 * that hasn't already been uploaded. Production-safe: the moment Printify
 * fails for an item (or its files can't be read), the scan stops
 * immediately and every later PNG is reported as unprocessed rather than
 * attempted — see the module doc comment. The only other thing that
 * aborts before any item is tried is the Printify provider itself being
 * unusable (e.g. `DRY_RUN=false` with missing/invalid catalog config).
 */
export async function uploadApprovedArtworkToPrintify(
  options: UploadApprovedArtworkToPrintifyOptions = {},
): Promise<Result<PrintifyUploadReport, UploadApprovedArtworkToPrintifyError>> {
  const approvedRoot = options.approvedRoot ?? path.join("designs", "processed");
  const now = options.now ?? ((): Date => new Date());
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/upload-to-printify", transports: [new ConsoleTransport(), new FileTransport()] });

  if (!existsSync(approvedRoot)) {
    return ok({
      scanned: 0,
      uploaded: [],
      skippedNotImported: [],
      skippedAlreadyUploaded: [],
      stoppedDueTo: null,
      remainingUnprocessed: [],
    });
  }

  const providerResult = createPrintifyProvider({ ...options.printifyProviderOptions, logger: baseLogger });
  if (!providerResult.ok) {
    return err(providerResult.error);
  }
  const printify = providerResult.value;

  const pngPaths = listPngFiles(approvedRoot);
  const uploaded: UploadedToPrintify[] = [];
  const skippedNotImported: string[] = [];
  const skippedAlreadyUploaded: string[] = [];
  let stoppedDueTo: StoppedDueTo | null = null;

  for (const pngPath of pngPaths) {
    const outputs = outputPaths(pngPath);

    if (!existsSync(outputs.product)) {
      skippedNotImported.push(pngPath);
      continue;
    }
    if (existsSync(outputs.printify)) {
      skippedAlreadyUploaded.push(pngPath);
      continue;
    }

    let product: ProductJson;
    let description: string;
    let artworkPng: Buffer;
    try {
      const raw: unknown = JSON.parse(readFileSync(outputs.product, "utf8"));
      if (!isProductJson(raw)) {
        stoppedDueTo = { sourcePath: pngPath, reason: "product.json is missing required fields (jobId/title)", details: [] };
        break;
      }
      product = raw;
      description = parseDescriptionMarkdown(readFileSync(outputs.description, "utf8"));
      artworkPng = readFileSync(pngPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stoppedDueTo = { sourcePath: pngPath, reason: "failed to read artwork/metadata files", details: [message] };
      break;
    }

    const jobLogger = baseLogger.withJob(product.jobId, "upload-printify");
    const priceUsd = getDefaultShirtPrice();

    const upload = await printify.uploadProduct({
      jobId: product.jobId,
      title: product.title,
      description,
      artworkPng,
      priceUsd,
    });
    if (!upload.ok) {
      stoppedDueTo = { sourcePath: pngPath, jobId: product.jobId, reason: "Printify upload failed", details: [upload.error.message] };
      break;
    }

    try {
      writeFileSync(
        outputs.printify,
        JSON.stringify(
          {
            jobId: product.jobId,
            printifyProductId: upload.value.printifyProductId,
            printifyImageId: upload.value.printifyImageId,
            mockupUrls: upload.value.mockupUrls,
            priceUsd,
            status: "uploaded",
            uploadedAt: now().toISOString(),
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
        reason: "uploaded to Printify but failed to write the upload record",
        details: [message],
      };
      break;
    }

    uploaded.push({
      sourcePath: pngPath,
      jobId: product.jobId,
      printifyProductId: upload.value.printifyProductId,
      mockupUrls: upload.value.mockupUrls,
      status: "uploaded",
    });
    jobLogger.info("Artwork uploaded to Printify", {
      metadata: { sourcePath: pngPath, printifyProductId: upload.value.printifyProductId, priceUsd },
    });
  }

  const remainingUnprocessed =
    stoppedDueTo !== null
      ? pngPaths.slice(pngPaths.findIndex((p) => p === stoppedDueTo!.sourcePath) + 1)
      : [];

  if (stoppedDueTo !== null) {
    baseLogger.error("Printify upload stopped: production-safe error handling halted the batch", {
      metadata: { stoppedDueTo, remainingUnprocessed: remainingUnprocessed.length },
    });
  }
  baseLogger.info("Printify upload scan complete", {
    metadata: {
      scanned: pngPaths.length,
      uploaded: uploaded.length,
      skippedNotImported: skippedNotImported.length,
      skippedAlreadyUploaded: skippedAlreadyUploaded.length,
      stopped: stoppedDueTo !== null,
      remainingUnprocessed: remainingUnprocessed.length,
    },
  });

  return ok({ scanned: pngPaths.length, uploaded, skippedNotImported, skippedAlreadyUploaded, stoppedDueTo, remainingUnprocessed });
}

async function main(): Promise<void> {
  loadEnv();
  const result = await uploadApprovedArtworkToPrintify();
  if (!result.ok) {
    console.error(`Printify upload failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const report = result.value;
  console.log(`\nScanned ${report.scanned} PNG(s) in designs/processed/`);
  for (const item of report.uploaded) {
    console.log(`  UPLOADED  ${item.sourcePath}`);
    console.log(`              printifyProductId: ${item.printifyProductId}`);
    console.log(`              mockupUrls: ${item.mockupUrls.length > 0 ? item.mockupUrls.join(", ") : "(none returned)"}`);
    console.log(`              status: ${item.status}`);
  }
  for (const item of report.skippedNotImported) {
    console.log(`  SKIPPED   ${item} (not yet imported — run scripts/import-artwork.ts first)`);
  }
  for (const item of report.skippedAlreadyUploaded) {
    console.log(`  SKIPPED   ${item} (already uploaded)`);
  }
  if (report.stoppedDueTo !== null) {
    console.log(`\n  STOPPED   ${report.stoppedDueTo.sourcePath}`);
    console.log(`              reason: ${report.stoppedDueTo.reason}`);
    for (const detail of report.stoppedDueTo.details) console.log(`              - ${detail}`);
    console.log(`\n  ${report.remainingUnprocessed.length} PNG(s) never attempted:`);
    for (const item of report.remainingUnprocessed) console.log(`    ${item}`);
  }
  console.log(
    `\n${report.uploaded.length} uploaded, ${report.skippedNotImported.length} not yet imported, ` +
      `${report.skippedAlreadyUploaded.length} already uploaded, ${report.stoppedDueTo !== null ? "STOPPED — see above" : "no failures"}.`,
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
