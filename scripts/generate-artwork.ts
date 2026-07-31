/**
 * End-to-end orchestration for pipeline stages 1-2 (generate → save
 * print-ready artwork): calls the configured image provider, converts the
 * result to a print-ready PNG, and saves both the artwork and its
 * metadata under `designs/generated/{jobId}/`.
 *
 * `generateArtwork` holds all the logic and is fully unit-testable
 * (dependency-injected provider/output directory/logger); `main` is a
 * thin CLI wrapper so this file can also be run directly:
 *
 *   node scripts/generate-artwork.ts "a parrot wearing sunglasses"
 *
 * No mockup, product copy, or approval gate yet — those are later,
 * separately-tested steps. This intentionally stops once artwork is
 * safely on disk.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createImageProvider,
  type CreateImageProviderOptions,
} from "../automation/ai/create-image-provider.ts";
import { toPrintReadyPng } from "../automation/ai/prepare-print-ready.ts";
import { loadEnv } from "../automation/shared/config.ts";
import { FileOperationError, ValidationError } from "../automation/shared/errors.ts";
import type { ConfigError, ExternalServiceError } from "../automation/shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";

export interface GeneratedArtworkJob {
  readonly jobId: string;
  readonly brief: string;
  readonly artworkPath: string;
  readonly metadataPath: string;
}

export interface GenerateArtworkOptions {
  /** Root directory jobs are saved under. Defaults to "designs/generated". */
  readonly outputRoot?: string;
  readonly logger?: Logger;
  readonly providerOptions?: CreateImageProviderOptions;
}

type GenerateArtworkError = ConfigError | ExternalServiceError | ValidationError | FileOperationError;

/**
 * Generates one job's artwork end to end: create the provider, generate,
 * convert to print-ready, save artwork + metadata. Returns a `Result`
 * rather than throwing, per this codebase's convention — every failure
 * here (bad config, a provider error, a bad response, a disk error) is an
 * expected operational outcome the caller (the CLI wrapper below, or a
 * test) decides how to report.
 */
export async function generateArtwork(
  brief: string,
  options: GenerateArtworkOptions = {},
): Promise<Result<GeneratedArtworkJob, GenerateArtworkError>> {
  if (brief.trim().length === 0) {
    return err(new ValidationError(["design brief must not be blank"]));
  }

  const jobId = randomUUID();
  const baseLogger =
    options.logger ??
    new Logger({
      module: "scripts/generate-artwork",
      transports: [new ConsoleTransport(), new FileTransport()],
    });
  const logger = baseLogger.withJob(jobId, "generate");

  const providerResult = createImageProvider({ ...options.providerOptions, logger });
  if (!providerResult.ok) {
    return err(providerResult.error);
  }

  const generation = await providerResult.value.generate({ jobId, prompt: brief });
  if (!generation.ok) {
    return err(generation.error);
  }

  const printReady = await toPrintReadyPng(generation.value.imageBuffer);
  if (!printReady.ok) {
    return err(printReady.error);
  }

  const outputRoot = options.outputRoot ?? path.join("designs", "generated");
  const jobDir = path.join(outputRoot, jobId);
  const artworkPath = path.join(jobDir, "artwork.png");
  const metadataPath = path.join(jobDir, "metadata.json");

  try {
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(artworkPath, printReady.value.buffer);
    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          jobId,
          brief,
          prompt: generation.value.prompt,
          provider: generation.value.provider,
          model: generation.value.model,
          generatedAt: generation.value.generatedAt,
          sourceDimensions: { width: generation.value.width, height: generation.value.height },
          printDimensions: { width: printReady.value.width, height: printReady.value.height },
          providerMetadata: generation.value.metadata,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    return err(new FileOperationError("write", jobDir, { cause: error }));
  }

  logger.info("Artwork generated and saved", { metadata: { jobDir } });

  return ok({ jobId, brief, artworkPath, metadataPath });
}

async function main(): Promise<void> {
  loadEnv();
  const brief = process.argv.slice(2).join(" ").trim();
  if (brief.length === 0) {
    console.error('Usage: node scripts/generate-artwork.ts "<design brief>"');
    process.exitCode = 1;
    return;
  }

  const result = await generateArtwork(brief);
  if (!result.ok) {
    console.error(`Generation failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nJob ${result.value.jobId}`);
  console.log(`  Brief:    ${result.value.brief}`);
  console.log(`  Artwork:  ${result.value.artworkPath}`);
  console.log(`  Metadata: ${result.value.metadataPath}`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
