/**
 * Batch orchestration for launch pipeline stages 7-9: for each approved
 * job, upload to Printify, publish to Shopify, verify the product is
 * actually live, then move the job to designs/uploaded/. Bounded
 * concurrency, continues past individual failures, produces a final
 * report — same shape as `run-batch.ts`.
 *
 *   node scripts/run-uploads.ts --all
 *   node scripts/run-uploads.ts job-1 job-2
 *
 * Only ever operates on designs/approved/ — a job only gets here after a
 * human has run `approve.ts`. Reads each job's existing product.json +
 * artwork.png; this script adds no new generation, only publishing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPrintifyProvider,
  type CreatePrintifyProviderOptions,
} from "../automation/printify/create-provider.ts";
import type { PrintifyProvider } from "../automation/printify/types.ts";
import {
  createShopifyProvider,
  type CreateShopifyProviderOptions,
} from "../automation/shopify/create-provider.ts";
import type { ShopifyProvider } from "../automation/shopify/types.ts";
import { loadEnv } from "../automation/shared/config.ts";
import { runWithConcurrency } from "../automation/shared/concurrency.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";

const DEFAULT_CONCURRENCY = 5;

export interface UploadJobResult {
  readonly jobId: string;
  readonly status: "success" | "failed";
  readonly stage?: "read-job" | "printify" | "shopify" | "verify" | "move";
  readonly error?: string;
  readonly printifyProductId?: string;
  readonly shopifyProductId?: string;
}

export interface UploadBatchReport {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly results: readonly UploadJobResult[];
}

export interface RunUploadsOptions {
  readonly concurrency?: number;
  readonly approvedRoot?: string;
  readonly uploadedRoot?: string;
  readonly logger?: Logger;
  readonly printifyProviderOptions?: CreatePrintifyProviderOptions;
  readonly shopifyProviderOptions?: CreateShopifyProviderOptions;
}

interface ProductJson {
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly productType: string;
  readonly suggestedRetailPrice: number;
}

/** Job IDs under `approvedRoot` that have a product.json and are ready to upload. */
export function listApprovedJobIds(approvedRoot: string): string[] {
  if (!existsSync(approvedRoot)) {
    return [];
  }
  return readdirSync(approvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((jobId) => existsSync(path.join(approvedRoot, jobId, "product.json")));
}

/**
 * Uploads, publishes, and verifies every job in `jobIds`, `concurrency`
 * at a time. Never throws: each job's outcome is captured in its own
 * `UploadJobResult` so one failure doesn't stop the rest of the batch. If
 * either provider is misconfigured, every job fails immediately with
 * that same configuration error rather than making any network call.
 */
export async function runUploads(
  jobIds: readonly string[],
  options: RunUploadsOptions = {},
): Promise<UploadBatchReport> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const approvedRoot = options.approvedRoot ?? path.join("designs", "approved");
  const uploadedRoot = options.uploadedRoot ?? path.join("designs", "uploaded");
  const logger =
    options.logger ??
    new Logger({ module: "scripts/run-uploads", transports: [new ConsoleTransport(), new FileTransport()] });

  const printifyResult = createPrintifyProvider({ ...options.printifyProviderOptions, logger });
  const shopifyResult = createShopifyProvider({ ...options.shopifyProviderOptions, logger });

  if (!printifyResult.ok || !shopifyResult.ok) {
    const error = !printifyResult.ok ? printifyResult.error.message : (!shopifyResult.ok ? shopifyResult.error.message : "");
    const results = jobIds.map(
      (jobId): UploadJobResult => ({
        jobId,
        status: "failed",
        stage: !printifyResult.ok ? "printify" : "shopify",
        error,
      }),
    );
    return { total: results.length, succeeded: 0, failed: results.length, results };
  }

  const printify = printifyResult.value;
  const shopify = shopifyResult.value;

  const results = await runWithConcurrency(jobIds, concurrency, (jobId) =>
    uploadOneJob(jobId, printify, shopify, approvedRoot, uploadedRoot),
  );

  const succeeded = results.filter((r) => r.status === "success").length;
  return { total: results.length, succeeded, failed: results.length - succeeded, results };
}

async function uploadOneJob(
  jobId: string,
  printify: PrintifyProvider,
  shopify: ShopifyProvider,
  approvedRoot: string,
  uploadedRoot: string,
): Promise<UploadJobResult> {
  const jobDir = path.join(approvedRoot, jobId);

  let product: ProductJson;
  let artworkPng: Buffer;
  try {
    const raw: unknown = JSON.parse(readFileSync(path.join(jobDir, "product.json"), "utf8"));
    if (!isProductJson(raw)) {
      return { jobId, status: "failed", stage: "read-job", error: "product.json is missing required fields" };
    }
    product = raw;
    artworkPng = readFileSync(path.join(jobDir, "artwork.png"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { jobId, status: "failed", stage: "read-job", error: message };
  }

  const printifyUpload = await printify.uploadProduct({
    jobId,
    title: product.title,
    description: product.description,
    artworkPng,
    priceUsd: product.suggestedRetailPrice,
  });
  if (!printifyUpload.ok) {
    return { jobId, status: "failed", stage: "printify", error: printifyUpload.error.message };
  }

  const shopifyPublish = await shopify.publishProduct({
    jobId,
    title: product.title,
    descriptionHtml: `<p>${escapeHtml(product.description)}</p>`,
    tags: product.tags,
    productType: product.productType,
    priceUsd: product.suggestedRetailPrice,
    imagePng: artworkPng,
  });
  if (!shopifyPublish.ok) {
    return {
      jobId,
      status: "failed",
      stage: "shopify",
      error: shopifyPublish.error.message,
      printifyProductId: printifyUpload.value.printifyProductId,
    };
  }

  const verification = await shopify.verifyProductLive(shopifyPublish.value.shopifyProductId);
  if (!verification.ok || !verification.value.isLive) {
    const error = verification.ok
      ? `product status is "${verification.value.status}", not active`
      : verification.error.message;
    return {
      jobId,
      status: "failed",
      stage: "verify",
      error,
      printifyProductId: printifyUpload.value.printifyProductId,
      shopifyProductId: shopifyPublish.value.shopifyProductId,
    };
  }

  try {
    const destDir = path.join(uploadedRoot, jobId);
    if (existsSync(destDir)) {
      throw new Error(`destination already exists, refusing to overwrite: ${destDir}`);
    }
    mkdirSync(uploadedRoot, { recursive: true });
    renameSync(jobDir, destDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jobId,
      status: "failed",
      stage: "move",
      error: message,
      printifyProductId: printifyUpload.value.printifyProductId,
      shopifyProductId: shopifyPublish.value.shopifyProductId,
    };
  }

  return {
    jobId,
    status: "success",
    printifyProductId: printifyUpload.value.printifyProductId,
    shopifyProductId: shopifyPublish.value.shopifyProductId,
  };
}

function isProductJson(value: unknown): value is ProductJson {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === "string" &&
    typeof v.description === "string" &&
    Array.isArray(v.tags) &&
    typeof v.productType === "string" &&
    typeof v.suggestedRetailPrice === "number"
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseConcurrencyArg(argv: readonly string[]): number | undefined {
  const flagIndex = argv.indexOf("--concurrency");
  if (flagIndex === -1) {
    return undefined;
  }
  const value = Number.parseInt(argv[flagIndex + 1] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2).filter((arg) => arg !== "--concurrency" && !/^\d+$/.test(arg));
  const concurrency = parseConcurrencyArg(process.argv.slice(2));

  let jobIds: string[];
  if (args.length === 1 && args[0] === "--all") {
    jobIds = listApprovedJobIds(path.join("designs", "approved"));
    if (jobIds.length === 0) {
      console.log("No approved jobs found in designs/approved/.");
      return;
    }
  } else if (args.length > 0) {
    jobIds = args;
  } else {
    console.error("Usage: node scripts/run-uploads.ts <jobId...>|--all [--concurrency N]");
    process.exitCode = 1;
    return;
  }

  console.log(`Uploading ${jobIds.length} job(s) (concurrency: ${concurrency ?? DEFAULT_CONCURRENCY})...\n`);

  const report = await runUploads(jobIds, { ...(concurrency !== undefined ? { concurrency } : {}) });

  for (const result of report.results) {
    if (result.status === "success") {
      console.log(`  OK    ${result.jobId}  printify=${result.printifyProductId}  shopify=${result.shopifyProductId}`);
    } else {
      console.log(`  FAIL  [${result.stage}] ${result.jobId}: ${result.error}`);
    }
  }

  console.log(`\n${report.succeeded}/${report.total} succeeded, ${report.failed} failed.`);

  const reportDir = path.join("designs", "uploaded");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `upload-report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report: ${reportPath}`);

  if (report.failed > 0) {
    process.exitCode = 1;
  }
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
