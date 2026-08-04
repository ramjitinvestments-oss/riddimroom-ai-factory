/**
 * CLI entry point for the composed-artwork pipeline (Design Director ->
 * Asset Library (user-supplied artwork only) -> Composition Engine ->
 * Typography Engine), saving into `designs/generated/{jobId}/` so the
 * existing approval (`scripts/approve.ts`) stage keeps working.
 *
 * Dormant as of the Engine Freeze: not part of the active production
 * pipeline (`scripts/import-artwork.ts` -> `scripts/upload-to-printify.ts`
 * -> `scripts/publish-to-shopify.ts`), which assumes finished artwork
 * already exists in `designs/approved/`. Kept as reusable infrastructure.
 *
 *   node scripts/generate-composed-artwork.ts speaker_stack "a vintage Jamaican sound system speaker stack"
 *   node scripts/generate-composed-artwork.ts speaker_stack "a vintage Jamaican sound system speaker stack" "RIDDIMROOM"
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeShirtArtwork, type ComposeShirtArtworkOptions } from "../automation/ai/compose-shirt-artwork.ts";
import { loadEnv } from "../automation/shared/config.ts";
import { FileOperationError, type ConfigError, type ExternalServiceError, type ValidationError } from "../automation/shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";

export interface GeneratedComposedArtworkJob {
  readonly jobId: string;
  readonly brief: string;
  readonly artworkPath: string;
  readonly metadataPath: string;
}

export interface GenerateComposedArtworkJobOptions extends ComposeShirtArtworkOptions {
  /** Root directory jobs are saved under. Defaults to "designs/generated". */
  readonly outputRoot?: string;
}

type GenerateComposedArtworkJobError = ConfigError | ExternalServiceError | ValidationError | FileOperationError;

/** Runs the composed pipeline for one brief and saves the result to disk. */
export async function generateComposedArtworkJob(
  heroCategory: string,
  brief: string,
  options: GenerateComposedArtworkJobOptions = {},
): Promise<Result<GeneratedComposedArtworkJob, GenerateComposedArtworkJobError>> {
  const jobId = randomUUID();
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/generate-composed-artwork", transports: [new ConsoleTransport(), new FileTransport()] });

  const composed = await composeShirtArtwork({ jobId, brief, heroCategory }, { ...options, logger: baseLogger });
  if (!composed.ok) {
    return err(composed.error);
  }

  const outputRoot = options.outputRoot ?? path.join("designs", "generated");
  const jobDir = path.join(outputRoot, jobId);
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
          engine: "composed",
          heroCategory,
          heroAssetId: composed.value.heroAsset.id,
          style: composed.value.decision.style.id,
          niche: composed.value.decision.niche,
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

  baseLogger.info("Composed artwork job saved", { metadata: { jobDir, heroAssetId: composed.value.heroAsset.id } });

  return ok({ jobId, brief, artworkPath, metadataPath });
}

async function main(): Promise<void> {
  loadEnv();
  const [heroCategory, brief, titleText] = process.argv.slice(2);
  if (heroCategory === undefined || brief === undefined || brief.trim().length === 0) {
    console.error('Usage: node scripts/generate-composed-artwork.ts <heroCategory> "<brief>" ["<title text>"]');
    process.exitCode = 1;
    return;
  }

  const options: GenerateComposedArtworkJobOptions =
    titleText !== undefined && titleText.trim().length > 0 ? { title: { text: titleText } } : {};

  const result = await generateComposedArtworkJob(heroCategory, brief, options);
  if (!result.ok) {
    console.error(`Composed generation failed: ${result.error.message}`);
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
