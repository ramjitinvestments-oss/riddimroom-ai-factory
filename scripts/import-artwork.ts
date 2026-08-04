/**
 * The Artwork Import Engine (Product Approval / Metadata Generation): by
 * default scans `designs/processed/` — the output of
 * `scripts/prepare-artwork.ts`, the Artwork Preparation stage that runs
 * first — for print-ready PNGs, validates each one
 * (`automation/ai/artwork-validation.ts`), and for every valid piece of
 * artwork analyzes it and generates product listing copy — reusing
 * `automation/ai/create-artwork-analysis-provider.ts`, not a duplicate of
 * it — and writes the result as five files saved beside the artwork:
 * `<stem>.product.json`, `<stem>.seo.json`, `<stem>.tags.json`,
 * `<stem>.description.md`, `<stem>.job.json`.
 *
 * Product Approval analyzes ONLY processed artwork, never the raw original
 * in `designs/approved/` — that file is never read by this script under
 * its defaults. Pass `approvedRoot` to point somewhere else (tests do).
 *
 * The artwork is the sole source of truth: no brief, filename, or other
 * text input is used or required — everything (collection, theme, style,
 * keywords, title, description, SEO, tags) is determined by analyzing the
 * image itself. This script never generates artwork; it only reads and
 * analyzes what's already been supplied.
 *
 * Output filenames are prefixed with the artwork's own filename stem
 * rather than fixed names ("product.json", ...) because the scanned root
 * may hold multiple PNGs directly alongside each other (not necessarily
 * one per subdirectory) — a fixed name would collide between them. The
 * same prefixed scheme works whether artwork is flat or already organized
 * into per-item subfolders.
 *
 * Idempotent: a PNG with an existing `<stem>.job.json` beside it is
 * treated as already imported and skipped, so re-running this script
 * doesn't re-spend AI calls or clobber previously generated (and possibly
 * hand-edited) copy. This does not upload anything — Printify/Shopify
 * publishing is a separate, later stage.
 *
 * Production-safe error handling: if metadata generation fails or the
 * artwork itself is invalid, the whole scan stops immediately — no later
 * item is attempted. Nothing is silently skipped past a failure; every
 * item before the stop is either fully imported or an already-done
 * idempotent skip. Re-run after fixing the problem item to pick up where
 * it left off (already-imported items are skipped, not redone).
 *
 *   node scripts/import-artwork.ts
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtworkAnalysis } from "../automation/ai/artwork-analysis-types.ts";
import {
  createArtworkAnalysisProvider,
  type CreateArtworkAnalysisProviderOptions,
} from "../automation/ai/create-artwork-analysis-provider.ts";
import { validateArtwork, type ArtworkValidation } from "../automation/ai/artwork-validation.ts";
import { getCollectionById } from "../automation/ai/collections/library.ts";
import { getStyleById } from "../automation/ai/styles/library.ts";
import type { StoppedDueTo } from "../automation/shared/batch-report.ts";
import { loadEnv } from "../automation/shared/config.ts";
import type { ConfigError } from "../automation/shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { getDefaultShirtPrice } from "../automation/shared/pricing.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";

export interface ImportedArtwork {
  readonly sourcePath: string;
  readonly jobId: string;
  readonly productPath: string;
  readonly seoPath: string;
  readonly tagsPath: string;
  readonly descriptionPath: string;
  readonly jobPath: string;
}

export interface ArtworkImportReport {
  readonly scanned: number;
  readonly imported: readonly ImportedArtwork[];
  readonly skippedAlreadyImported: readonly string[];
  /** The item that stopped the scan, if any; `null` means every item succeeded or was an idempotent skip. */
  readonly stoppedDueTo: StoppedDueTo | null;
  /** PNGs that were never even attempted because the scan stopped before reaching them. */
  readonly remainingUnprocessed: readonly string[];
}

export interface ImportApprovedArtworkOptions {
  /** Root directory scanned for PNGs to analyze. Defaults to "designs/processed" (the Artwork Preparation stage's output) — not "designs/approved". */
  readonly approvedRoot?: string;
  readonly logger?: Logger;
  readonly providerOptions?: CreateArtworkAnalysisProviderOptions;
  readonly now?: () => Date;
}

type ImportApprovedArtworkError = ConfigError;

/**
 * Recursively lists every `.png` file (case-insensitive) under `root`, in
 * no particular order. Exported so every pipeline stage
 * (`scripts/prepare-artwork.ts`, this module, `scripts/upload-to-printify.ts`,
 * `scripts/publish-to-shopify.ts`) scans its root the same way, instead of
 * reimplementing the walk.
 *
 * Sorted before returning: production-safe error handling stops the whole
 * batch at the first failure (see `importApprovedArtwork`), and which item
 * is "first" has to be deterministic and reproducible, not whatever order
 * the filesystem happens to hand back directory entries in.
 */
export function listPngFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listPngFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * The full set of sibling artifact paths for one piece of artwork, keyed
 * by the PNG's own filename stem. Exported so later pipeline stages derive
 * the same paths this one writes, rather than re-deriving the naming
 * convention themselves. `prepared`/`rejected`/`printify`/`shopify` aren't
 * written by this module (see `scripts/prepare-artwork.ts` /
 * `scripts/upload-to-printify.ts` / `scripts/publish-to-shopify.ts`) but
 * live here too since it's the same "artifact beside the artwork" naming
 * scheme.
 */
export function outputPaths(pngPath: string): {
  readonly stem: string;
  readonly prepared: string;
  readonly rejected: string;
  readonly product: string;
  readonly seo: string;
  readonly tags: string;
  readonly description: string;
  readonly job: string;
  readonly printify: string;
  readonly shopify: string;
} {
  const dir = path.dirname(pngPath);
  const stem = path.basename(pngPath, path.extname(pngPath));
  return {
    stem,
    prepared: path.join(dir, `${stem}.prepared.json`),
    rejected: path.join(dir, `${stem}.rejected.json`),
    product: path.join(dir, `${stem}.product.json`),
    seo: path.join(dir, `${stem}.seo.json`),
    tags: path.join(dir, `${stem}.tags.json`),
    description: path.join(dir, `${stem}.description.md`),
    job: path.join(dir, `${stem}.job.json`),
    printify: path.join(dir, `${stem}.printify.json`),
    shopify: path.join(dir, `${stem}.shopify.json`),
  };
}

/**
 * Recovers the plain description text from a `description.md` file this
 * module wrote (`# {title}\n\n{description}\n`) — splitting on the first
 * blank line rather than regex-stripping the header, since that's the one
 * thing guaranteed stable about a format this same module controls both
 * ends of. Exported so downstream stages (Printify has no markdown
 * rendering) get the plain description back without re-deriving it.
 */
export function parseDescriptionMarkdown(raw: string): string {
  const separatorIndex = raw.indexOf("\n\n");
  return separatorIndex === -1 ? raw.trim() : raw.slice(separatorIndex + 2).trim();
}

/**
 * Scans `approvedRoot` for PNGs and imports every valid one that hasn't
 * already been imported. Production-safe: the moment any item is invalid
 * or metadata generation fails for it, the scan stops immediately and
 * every later PNG is reported as unprocessed rather than attempted — see
 * the module doc comment. The only other thing that aborts before any
 * item is tried is the analysis provider itself being unusable (e.g.
 * `DRY_RUN=false` with no `OPENAI_API_KEY`).
 */
export async function importApprovedArtwork(
  options: ImportApprovedArtworkOptions = {},
): Promise<Result<ArtworkImportReport, ImportApprovedArtworkError>> {
  const approvedRoot = options.approvedRoot ?? path.join("designs", "processed");
  const now = options.now ?? ((): Date => new Date());
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/import-artwork", transports: [new ConsoleTransport(), new FileTransport()] });

  if (!existsSync(approvedRoot)) {
    return ok({ scanned: 0, imported: [], skippedAlreadyImported: [], stoppedDueTo: null, remainingUnprocessed: [] });
  }

  const providerResult = createArtworkAnalysisProvider({ ...options.providerOptions, logger: baseLogger });
  if (!providerResult.ok) {
    return err(providerResult.error);
  }
  const provider = providerResult.value;

  const pngPaths = listPngFiles(approvedRoot);
  const imported: ImportedArtwork[] = [];
  const skippedAlreadyImported: string[] = [];
  let stoppedDueTo: StoppedDueTo | null = null;

  for (let i = 0; i < pngPaths.length; i++) {
    const pngPath = pngPaths[i]!;
    const outputs = outputPaths(pngPath);
    if (existsSync(outputs.job)) {
      skippedAlreadyImported.push(pngPath);
      continue;
    }

    let artworkPng: Buffer;
    try {
      artworkPng = readFileSync(pngPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stoppedDueTo = { sourcePath: pngPath, reason: "failed to read artwork file", details: [message] };
      break;
    }

    const validation = await validateArtwork(artworkPng);
    if (!validation.ok) {
      stoppedDueTo = { sourcePath: pngPath, reason: "artwork could not be validated", details: validation.error.issues };
      break;
    }
    if (!validation.value.valid) {
      stoppedDueTo = { sourcePath: pngPath, reason: "artwork failed validation", details: validation.value.issues };
      break;
    }

    const jobId = randomUUID();
    const jobLogger = baseLogger.withJob(jobId, "import-artwork");

    const generation = await provider.analyze({ jobId, artworkPng });
    if (!generation.ok) {
      stoppedDueTo = {
        sourcePath: pngPath,
        jobId,
        reason: "metadata generation failed",
        details: [generation.error.message],
      };
      break;
    }

    // Every shirt uses the fixed retail price — see automation/shared/pricing.ts.
    // The analysis provider is never asked for a price at all.
    const retailPrice = getDefaultShirtPrice();

    try {
      writeProductFiles(outputs, {
        jobId,
        sourcePath: pngPath,
        importedAt: now().toISOString(),
        validation: validation.value,
        analysis: generation.value.analysis,
        retailPrice,
        provider: generation.value.provider,
        model: generation.value.model,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stoppedDueTo = {
        sourcePath: pngPath,
        jobId,
        reason: "failed to write metadata files",
        details: [message],
      };
      break;
    }

    imported.push({
      sourcePath: pngPath,
      jobId,
      productPath: outputs.product,
      seoPath: outputs.seo,
      tagsPath: outputs.tags,
      descriptionPath: outputs.description,
      jobPath: outputs.job,
    });
    jobLogger.info("Artwork imported", {
      metadata: { sourcePath: pngPath, retailPrice, collectionId: generation.value.analysis.classification.collectionId },
    });
  }

  const remainingUnprocessed =
    stoppedDueTo !== null
      ? pngPaths.slice(pngPaths.findIndex((p) => p === stoppedDueTo!.sourcePath) + 1)
      : [];

  if (stoppedDueTo !== null) {
    baseLogger.error("Artwork import stopped: production-safe error handling halted the batch", {
      metadata: { stoppedDueTo, remainingUnprocessed: remainingUnprocessed.length },
    });
  }
  baseLogger.info("Artwork import scan complete", {
    metadata: {
      scanned: pngPaths.length,
      imported: imported.length,
      skipped: skippedAlreadyImported.length,
      stopped: stoppedDueTo !== null,
      remainingUnprocessed: remainingUnprocessed.length,
    },
  });

  return ok({ scanned: pngPaths.length, imported, skippedAlreadyImported, stoppedDueTo, remainingUnprocessed });
}

function writeProductFiles(
  outputs: ReturnType<typeof outputPaths>,
  fields: {
    readonly jobId: string;
    readonly sourcePath: string;
    readonly importedAt: string;
    readonly validation: ArtworkValidation;
    readonly analysis: ArtworkAnalysis;
    readonly retailPrice: number;
    readonly provider: string;
    readonly model: string;
  },
): void {
  const { classification, copy } = fields.analysis;
  const collection = getCollectionById(classification.collectionId);
  const style = getStyleById(classification.styleId);

  writeFileSync(
    outputs.product,
    JSON.stringify(
      {
        jobId: fields.jobId,
        sourceArtworkPath: fields.sourcePath,
        title: copy.title,
        subtitle: copy.subtitle,
        productType: "T-Shirt",
        collectionId: classification.collectionId,
        collectionName: collection?.name ?? classification.collectionId,
        suggestedRetailPrice: fields.retailPrice,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    outputs.seo,
    JSON.stringify({ jobId: fields.jobId, seoTitle: copy.seoTitle, seoDescription: copy.seoDescription }, null, 2),
  );

  writeFileSync(outputs.tags, JSON.stringify(copy.tags, null, 2));

  writeFileSync(outputs.description, `# ${copy.title}\n\n${copy.description}\n`);

  writeFileSync(
    outputs.job,
    JSON.stringify(
      {
        jobId: fields.jobId,
        engine: "artwork-import",
        sourceArtworkPath: fields.sourcePath,
        importedAt: fields.importedAt,
        validation: fields.validation,
        analysis: {
          collectionId: classification.collectionId,
          collectionName: collection?.name ?? classification.collectionId,
          styleId: classification.styleId,
          styleName: style?.name ?? classification.styleId,
          theme: classification.theme,
          keywords: classification.keywords,
          targetAudience: collection?.targetAudience ?? null,
        },
        analysisProvider: fields.provider,
        analysisModel: fields.model,
        status: "imported",
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  loadEnv();
  const result = await importApprovedArtwork();
  if (!result.ok) {
    console.error(`Artwork import failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const report = result.value;
  console.log(`\nScanned ${report.scanned} PNG(s) in designs/processed/`);
  for (const item of report.imported) {
    console.log(`  IMPORTED  ${item.sourcePath} (job ${item.jobId})`);
  }
  for (const item of report.skippedAlreadyImported) {
    console.log(`  SKIPPED   ${item} (already imported)`);
  }
  if (report.stoppedDueTo !== null) {
    console.log(`\n  STOPPED   ${report.stoppedDueTo.sourcePath}`);
    console.log(`              reason: ${report.stoppedDueTo.reason}`);
    for (const detail of report.stoppedDueTo.details) console.log(`              - ${detail}`);
    console.log(`\n  ${report.remainingUnprocessed.length} PNG(s) never attempted:`);
    for (const item of report.remainingUnprocessed) console.log(`    ${item}`);
  }
  console.log(
    `\n${report.imported.length} imported, ${report.skippedAlreadyImported.length} skipped, ` +
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
