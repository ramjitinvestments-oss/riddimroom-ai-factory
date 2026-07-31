/**
 * Batch orchestration for launch pipeline stages 1-5: for each design
 * brief, generate artwork, convert to print-ready, generate product
 * copy, and save the complete job — across the whole batch with bounded
 * concurrency, continuing past individual failures rather than aborting
 * the batch.
 *
 * `runBatch` holds the logic (dependency-injected concurrency/output
 * root/logger/provider config, fully unit-testable); `main` is a thin
 * CLI wrapper defaulting to the 25 launch concepts:
 *
 *   node scripts/run-batch.ts
 *   node scripts/run-batch.ts --concurrency 3
 *
 * Reuses generateArtwork/generateProductCopy as-is — this script adds
 * batching and a final report, nothing else.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCH_BATCH_CONCEPTS } from "../automation/ai/batch-concepts.ts";
import type { CreateImageProviderOptions } from "../automation/ai/create-image-provider.ts";
import type { CreateProductCopyProviderOptions } from "../automation/ai/create-product-copy-provider.ts";
import { loadEnv } from "../automation/shared/config.ts";
import { runWithConcurrency } from "../automation/shared/concurrency.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { generateArtwork } from "./generate-artwork.ts";
import { generateProductCopy } from "./generate-product-copy.ts";

const DEFAULT_CONCURRENCY = 5;

export interface BatchJobResult {
  readonly brief: string;
  readonly jobId?: string;
  readonly status: "success" | "failed";
  /** Which stage failed, when status is "failed". */
  readonly stage?: "artwork" | "product-copy";
  readonly error?: string;
}

export interface BatchReport {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly results: readonly BatchJobResult[];
}

export interface RunBatchOptions {
  readonly concurrency?: number;
  readonly outputRoot?: string;
  readonly logger?: Logger;
  readonly imageProviderOptions?: CreateImageProviderOptions;
  readonly productCopyProviderOptions?: CreateProductCopyProviderOptions;
}

/**
 * Runs the full generate-artwork -> generate-product-copy pipeline for
 * every brief in `briefs`, `concurrency` jobs at a time. Never throws:
 * every failure (at either stage, for any single brief) is captured in
 * that brief's `BatchJobResult` and the rest of the batch keeps going.
 */
export async function runBatch(
  briefs: readonly string[],
  options: RunBatchOptions = {},
): Promise<BatchReport> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/run-batch", transports: [new ConsoleTransport(), new FileTransport()] });

  const results = await runWithConcurrency(briefs, concurrency, async (brief): Promise<BatchJobResult> => {
    const artwork = await generateArtwork(brief, {
      ...(options.outputRoot !== undefined ? { outputRoot: options.outputRoot } : {}),
      logger: baseLogger,
      ...(options.imageProviderOptions !== undefined ? { providerOptions: options.imageProviderOptions } : {}),
    });
    if (!artwork.ok) {
      return { brief, status: "failed", stage: "artwork", error: artwork.error.message };
    }

    const copy = await generateProductCopy(artwork.value.jobId, {
      ...(options.outputRoot !== undefined ? { jobsRoot: options.outputRoot } : {}),
      logger: baseLogger,
      ...(options.productCopyProviderOptions !== undefined
        ? { providerOptions: options.productCopyProviderOptions }
        : {}),
    });
    if (!copy.ok) {
      return { brief, jobId: artwork.value.jobId, status: "failed", stage: "product-copy", error: copy.error.message };
    }

    return { brief, jobId: artwork.value.jobId, status: "success" };
  });

  const succeeded = results.filter((r) => r.status === "success").length;
  return { total: results.length, succeeded, failed: results.length - succeeded, results };
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
  const concurrency = parseConcurrencyArg(process.argv.slice(2));

  console.log(`Running batch of ${LAUNCH_BATCH_CONCEPTS.length} concepts (concurrency: ${concurrency ?? DEFAULT_CONCURRENCY})...\n`);

  const report = await runBatch(LAUNCH_BATCH_CONCEPTS, {
    ...(concurrency !== undefined ? { concurrency } : {}),
  });

  for (const result of report.results) {
    if (result.status === "success") {
      console.log(`  OK    ${result.jobId}  ${result.brief}`);
    } else {
      console.log(`  FAIL  [${result.stage}] ${result.jobId ?? "(no jobId)"}  ${result.brief}`);
      console.log(`          ${result.error}`);
    }
  }

  console.log(`\n${report.succeeded}/${report.total} succeeded, ${report.failed} failed.`);

  const reportDir = path.join("designs", "generated");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `batch-report-${Date.now()}.json`);
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
