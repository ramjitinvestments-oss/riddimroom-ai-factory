/**
 * Orchestration for pipeline stage 3 (product generation): given an
 * existing job's `artwork.png` and `metadata.json` (produced by
 * `generate-artwork.ts`), generates Printify-/Shopify-ready product
 * listing copy and saves it as `product.json` in the same job directory.
 *
 * `generateProductCopy` holds all the logic and is fully unit-testable
 * (dependency-injected jobs root/logger/provider config); `main` is a
 * thin CLI wrapper so this file can also be run directly:
 *
 *   node scripts/generate-product-copy.ts <jobId>
 *
 * No approval gate yet — that's a later, separately-tested step.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProductCopyProvider,
  type CreateProductCopyProviderOptions,
} from "../automation/ai/create-product-copy-provider.ts";
import { loadEnv } from "../automation/shared/config.ts";
import { FileOperationError, ValidationError } from "../automation/shared/errors.ts";
import type { ConfigError, ExternalServiceError } from "../automation/shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";

export interface GeneratedProductCopy {
  readonly jobId: string;
  readonly productPath: string;
}

export interface GenerateProductCopyOptions {
  /** Root directory jobs live under. Defaults to "designs/generated". */
  readonly jobsRoot?: string;
  readonly logger?: Logger;
  readonly providerOptions?: CreateProductCopyProviderOptions;
}

type GenerateProductCopyError = ConfigError | ExternalServiceError | ValidationError | FileOperationError;

/**
 * Generates one job's product listing copy end to end: read its
 * metadata.json + artwork.png, create the provider, generate, save
 * product.json. Returns a `Result` rather than throwing, per this
 * codebase's convention.
 */
export async function generateProductCopy(
  jobId: string,
  options: GenerateProductCopyOptions = {},
): Promise<Result<GeneratedProductCopy, GenerateProductCopyError>> {
  if (jobId.trim().length === 0) {
    return err(new ValidationError(["jobId must not be blank"]));
  }

  const jobsRoot = options.jobsRoot ?? path.join("designs", "generated");
  const jobDir = path.join(jobsRoot, jobId);
  const metadataPath = path.join(jobDir, "metadata.json");
  const artworkPath = path.join(jobDir, "artwork.png");
  const productPath = path.join(jobDir, "product.json");

  let brief: string;
  let artworkPng: Buffer;
  try {
    const metadataRaw = readFileSync(metadataPath, "utf8");
    const metadata: unknown = JSON.parse(metadataRaw);
    const candidateBrief =
      typeof metadata === "object" && metadata !== null
        ? (metadata as Record<string, unknown>).brief
        : undefined;
    if (typeof candidateBrief !== "string" || candidateBrief.trim().length === 0) {
      return err(new ValidationError([`${metadataPath} is missing a valid "brief" field`]));
    }
    brief = candidateBrief;
    artworkPng = readFileSync(artworkPath);
  } catch (error) {
    return err(new FileOperationError("read", jobDir, { cause: error }));
  }

  const baseLogger =
    options.logger ??
    new Logger({
      module: "scripts/generate-product-copy",
      transports: [new ConsoleTransport(), new FileTransport()],
    });
  const logger = baseLogger.withJob(jobId, "product-copy");

  const providerResult = createProductCopyProvider({ ...options.providerOptions, logger });
  if (!providerResult.ok) {
    return err(providerResult.error);
  }

  const generation = await providerResult.value.generate({ jobId, brief, artworkPng });
  if (!generation.ok) {
    return err(generation.error);
  }

  try {
    writeFileSync(
      productPath,
      JSON.stringify(
        {
          jobId,
          brief,
          title: generation.value.copy.title,
          subtitle: generation.value.copy.subtitle,
          description: generation.value.copy.description,
          seoTitle: generation.value.copy.seoTitle,
          seoDescription: generation.value.copy.seoDescription,
          tags: generation.value.copy.tags,
          productType: generation.value.copy.productType,
          collection: generation.value.copy.collection,
          suggestedRetailPrice: generation.value.copy.suggestedRetailPrice,
          provider: generation.value.provider,
          model: generation.value.model,
          generatedAt: generation.value.generatedAt,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    return err(new FileOperationError("write", productPath, { cause: error }));
  }

  logger.info("Product copy generated and saved", { metadata: { productPath } });

  return ok({ jobId, productPath });
}

async function main(): Promise<void> {
  loadEnv();
  const jobId = process.argv[2]?.trim() ?? "";
  if (jobId.length === 0) {
    console.error("Usage: node scripts/generate-product-copy.ts <jobId>");
    process.exitCode = 1;
    return;
  }

  const result = await generateProductCopy(jobId);
  if (!result.ok) {
    console.error(`Product copy generation failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nJob ${result.value.jobId}`);
  console.log(`  Product: ${result.value.productPath}`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
