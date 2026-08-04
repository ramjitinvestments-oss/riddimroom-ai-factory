/**
 * CLI entry point for the full collection-aware pipeline (Collection
 * Director -> Design Director -> Asset Selection -> Composition ->
 * Typography), saving into `designs/generated/{jobId}/` in the same
 * shape as `scripts/generate-composed-artwork.ts` — so approval
 * (`scripts/approve.ts`) keeps working unmodified.
 *
 * Dormant as of the Engine Freeze: not part of the active production
 * pipeline (`scripts/import-artwork.ts` -> `scripts/upload-to-printify.ts`
 * -> `scripts/publish-to-shopify.ts`), which assumes finished artwork
 * already exists in `designs/approved/`. Kept as reusable infrastructure.
 *
 *   node scripts/generate-collection-product.ts "a vintage Jamaican sound system speaker stack"
 *   node scripts/generate-collection-product.ts "a jerk chicken plate on a market table" caribbean-food
 *   node scripts/generate-collection-product.ts "a speaker stack" vintage-jamaican-sound-systems "RIDDIMROOM"
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  composeCollectionProduct,
  type ComposeCollectionProductOptions,
} from "../automation/ai/compose-collection-product.ts";
import { loadEnv } from "../automation/shared/config.ts";
import { FileOperationError, type ConfigError, type ExternalServiceError, type ValidationError } from "../automation/shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { getDefaultShirtPrice } from "../automation/shared/pricing.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";

export interface GeneratedCollectionProductJob {
  readonly jobId: string;
  readonly brief: string;
  readonly artworkPath: string;
  readonly metadataPath: string;
}

export interface GenerateCollectionProductJobOptions extends ComposeCollectionProductOptions {
  /** Root directory jobs are saved under. Defaults to "designs/generated". */
  readonly outputRoot?: string;
  readonly collectionId?: string;
  readonly heroCategory?: string;
}

type GenerateCollectionProductJobError = ConfigError | ExternalServiceError | ValidationError | FileOperationError;

/** Runs the full collection-aware pipeline for one brief and saves the result exactly like the other generate-*.ts scripts do. */
export async function generateCollectionProductJob(
  brief: string,
  options: GenerateCollectionProductJobOptions = {},
): Promise<Result<GeneratedCollectionProductJob, GenerateCollectionProductJobError>> {
  const jobId = randomUUID();
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/generate-collection-product", transports: [new ConsoleTransport(), new FileTransport()] });

  const { outputRoot, collectionId, heroCategory, ...composeOptions } = options;

  const composed = await composeCollectionProduct(
    { jobId, brief, ...(collectionId !== undefined ? { collectionId } : {}), ...(heroCategory !== undefined ? { heroCategory } : {}) },
    { ...composeOptions, logger: baseLogger },
  );
  if (!composed.ok) {
    return err(composed.error);
  }

  const jobDir = path.join(outputRoot ?? path.join("designs", "generated"), jobId);
  const artworkPath = path.join(jobDir, "artwork.png");
  const metadataPath = path.join(jobDir, "metadata.json");

  try {
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(artworkPath, composed.value.imageBuffer);
    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          jobId,
          brief,
          engine: "collection",
          collectionId: composed.value.collectionDecision.collection.id,
          collectionName: composed.value.collectionDecision.collection.name,
          collectionUsedFallback: composed.value.collectionDecision.usedFallback,
          heroAssetId: composed.value.heroAsset.id,
          style: composed.value.decision.style.id,
          niche: composed.value.decision.niche,
          // This pipeline currently only produces shirts, so the actual charged
          // price is the fixed shirt price (automation/shared/pricing.ts), not
          // the collection's descriptive band below — that band is retained
          // purely as collection-positioning context, per the pricing policy.
          retailPrice: getDefaultShirtPrice(),
          collectionSuggestedPricingRange: composed.value.collectionDecision.collection.suggestedPricing,
          seoKeywords: composed.value.collectionDecision.collection.seoKeywords,
          generatedAt: new Date().toISOString(),
          printDimensions: { width: composed.value.width, height: composed.value.height },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    return err(new FileOperationError("write", jobDir, { cause: error }));
  }

  baseLogger.info("Collection product job saved", {
    metadata: { jobDir, collectionId: composed.value.collectionDecision.collection.id, heroAssetId: composed.value.heroAsset.id },
  });

  return ok({ jobId, brief, artworkPath, metadataPath });
}

async function main(): Promise<void> {
  loadEnv();
  const [brief, collectionId, titleText] = process.argv.slice(2);
  if (brief === undefined || brief.trim().length === 0) {
    console.error(
      'Usage: node scripts/generate-collection-product.ts "<brief>" [collectionId] ["<title text>"]',
    );
    process.exitCode = 1;
    return;
  }

  const options: GenerateCollectionProductJobOptions = {
    ...(collectionId !== undefined && collectionId.trim().length > 0 ? { collectionId } : {}),
    ...(titleText !== undefined && titleText.trim().length > 0 ? { title: { text: titleText } } : {}),
  };

  const result = await generateCollectionProductJob(brief, options);
  if (!result.ok) {
    console.error(`Collection product generation failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nJob ${result.value.jobId}`);
  console.log(`  Brief:    ${result.value.brief}`);
  console.log(`  Artwork:  ${result.value.artworkPath}`);
  console.log(`  Metadata: ${result.value.metadataPath}`);
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
