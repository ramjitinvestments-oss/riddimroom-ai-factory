/**
 * Artwork Preparation Stage: the first production step, run before
 * Product Approval (Metadata Generation). Scans `designs/approved/` for
 * PNGs, inspects each one (dimensions, DPI, transparency, color profile),
 * and — only if it isn't already Printify-suitable — automatically
 * produces a print-ready version: resized/padded onto the exact print
 * canvas, background removed only if it's a simple uniform color,
 * converted to PNG. See `automation/ai/artwork-preparation.ts` for exactly
 * which fixes are allowed and why (never a stretch, never a crop, never a
 * change to the design itself).
 *
 * The original in `designs/approved/` is never modified. On success, the
 * print-ready result is written to `designs/processed/`, mirroring the
 * relative path under `designs/approved/`, plus a `<stem>.prepared.json`
 * report. Downstream stages (`scripts/import-artwork.ts` and everything
 * after it) read exclusively from `designs/processed/` by default, so
 * Product Approval always analyzes the processed artwork, never the raw
 * original.
 *
 * Per-item vs. system failures are handled differently, on purpose:
 *   - An item that can't be safely prepared (e.g. a background that isn't
 *     a simple uniform color) is a *content* problem with that one piece
 *     of artwork, not a problem with the pipeline. It's moved to
 *     `designs/rejected/` with a `<stem>.rejected.json` report (filename,
 *     reason, suggested fix), and the batch continues to the next item.
 *   - A system failure — a filesystem error, an unexpected exception that
 *     escaped `prepareArtwork()`'s normal Result handling (a crash, not a
 *     clean validation failure), or anything else that isn't a
 *     recoverable per-item content problem — stops the whole batch
 *     immediately, the same production-safe behavior every other stage in
 *     this pipeline uses. Nothing calls Printify or Shopify from this
 *     stage at all, so a system failure here can't leave a half-published
 *     product behind.
 *
 * Idempotent: a PNG whose `designs/processed/` or `designs/rejected/`
 * counterpart already exists is skipped, not reprocessed.
 *
 *   node scripts/prepare-artwork.ts
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareArtwork } from "../automation/ai/artwork-preparation.ts";
import type { StoppedDueTo } from "../automation/shared/batch-report.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";
import { listPngFiles, outputPaths } from "./import-artwork.ts";

export interface PreparedItem {
  readonly sourcePath: string;
  readonly processedPath: string;
  readonly originalDimensions: string;
  readonly processedDimensions: string;
  readonly transparencyBefore: boolean;
  readonly transparencyAfter: boolean;
  readonly fixesApplied: readonly string[];
  readonly suitableForPrintify: boolean;
}

export interface RejectedItem {
  readonly sourcePath: string;
  readonly rejectedPath: string;
  readonly filename: string;
  readonly reason: string;
  readonly suggestedFix: string;
}

export interface ArtworkPreparationReport {
  readonly scanned: number;
  readonly prepared: readonly PreparedItem[];
  readonly rejected: readonly RejectedItem[];
  /** A `designs/processed/` counterpart already exists — already prepared, not reprocessed. */
  readonly skippedAlreadyProcessed: readonly string[];
  /** A `designs/rejected/` counterpart already exists — already rejected, not reattempted. */
  readonly skippedAlreadyRejected: readonly string[];
  /** A system failure that halted the whole batch, if any; `null` means the scan ran to completion. */
  readonly stoppedDueTo: StoppedDueTo | null;
  /** PNGs that were never even attempted because a system failure stopped the scan before reaching them. */
  readonly remainingUnprocessed: readonly string[];
}

export interface PrepareApprovedArtworkOptions {
  /** Defaults to "designs/approved". */
  readonly approvedRoot?: string;
  /** Defaults to "designs/processed". */
  readonly processedRoot?: string;
  /** Defaults to "designs/rejected". */
  readonly rejectedRoot?: string;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

/** Maps a `prepareArtwork()` validation failure to actionable next-step guidance for a human. */
function suggestFixFor(issues: readonly string[]): string {
  const combined = issues.join(" ");
  if (combined.includes("not a simple, uniform color")) {
    return "Manually remove the background (or re-export the artwork with an already-transparent background) and re-submit to designs/approved/.";
  }
  if (combined.includes("no recognizable subject")) {
    return "The detected background covers nearly the entire canvas — verify the artwork is correct, then manually add transparency and re-submit.";
  }
  if (combined.includes("could not be read") || combined.includes("no readable dimensions")) {
    return "Re-export the file as a valid, undamaged PNG and re-submit.";
  }
  return "Review the artwork manually — automatic preparation could not produce a print-ready file — then re-submit.";
}

/**
 * Prepares every PNG under `approvedRoot` that hasn't already been
 * prepared or rejected. An item that can't be safely prepared is rejected
 * (moved to `rejectedRoot` with a report) and the batch continues; only a
 * system failure stops the whole scan — see the module doc comment. Never
 * calls Printify or Shopify.
 */
export async function prepareApprovedArtwork(
  options: PrepareApprovedArtworkOptions = {},
): Promise<ArtworkPreparationReport> {
  const approvedRoot = options.approvedRoot ?? path.join("designs", "approved");
  const processedRoot = options.processedRoot ?? path.join("designs", "processed");
  const rejectedRoot = options.rejectedRoot ?? path.join("designs", "rejected");
  const now = options.now ?? ((): Date => new Date());
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/prepare-artwork", transports: [new ConsoleTransport(), new FileTransport()] });

  if (!existsSync(approvedRoot)) {
    return {
      scanned: 0,
      prepared: [],
      rejected: [],
      skippedAlreadyProcessed: [],
      skippedAlreadyRejected: [],
      stoppedDueTo: null,
      remainingUnprocessed: [],
    };
  }

  const pngPaths = listPngFiles(approvedRoot);
  const prepared: PreparedItem[] = [];
  const rejected: RejectedItem[] = [];
  const skippedAlreadyProcessed: string[] = [];
  const skippedAlreadyRejected: string[] = [];
  let stoppedDueTo: StoppedDueTo | null = null;

  for (const pngPath of pngPaths) {
    const relative = path.relative(approvedRoot, pngPath);
    const processedPngPath = path.join(processedRoot, relative);
    const rejectedPngPath = path.join(rejectedRoot, relative);

    if (existsSync(processedPngPath)) {
      skippedAlreadyProcessed.push(pngPath);
      continue;
    }
    if (existsSync(rejectedPngPath)) {
      skippedAlreadyRejected.push(pngPath);
      continue;
    }

    let sourceBuffer: Buffer;
    try {
      sourceBuffer = readFileSync(pngPath);
    } catch (error) {
      // Filesystem error: a system failure, not a per-item content problem — stop the whole batch.
      const message = error instanceof Error ? error.message : String(error);
      stoppedDueTo = { sourcePath: pngPath, reason: "filesystem error while reading artwork", details: [message] };
      break;
    }

    let result: Awaited<ReturnType<typeof prepareArtwork>>;
    try {
      result = await prepareArtwork(sourceBuffer);
    } catch (error) {
      // An exception escaping prepareArtwork() is not a clean, expected
      // validation failure — it's a crash (a bug, an out-of-memory
      // condition, a missing native dependency). Treat it as a system
      // failure and stop the whole batch, same as every other stage.
      const message = error instanceof Error ? error.message : String(error);
      stoppedDueTo = {
        sourcePath: pngPath,
        reason: "unexpected failure while preparing artwork (not a recoverable content issue)",
        details: [message],
      };
      break;
    }

    if (!result.ok) {
      const reason = result.error.issues.join("; ");
      const suggestedFix = suggestFixFor(result.error.issues);
      try {
        mkdirSync(path.dirname(rejectedPngPath), { recursive: true });
        renameSync(pngPath, rejectedPngPath);
        const outputs = outputPaths(rejectedPngPath);
        writeFileSync(
          outputs.rejected,
          JSON.stringify(
            {
              filename: path.basename(pngPath),
              sourcePath: pngPath,
              rejectedPath: rejectedPngPath,
              reason,
              suggestedFix,
              rejectedAt: now().toISOString(),
            },
            null,
            2,
          ),
        );
      } catch (error) {
        // Couldn't even move/record the rejection — a filesystem problem, a system failure.
        const message = error instanceof Error ? error.message : String(error);
        stoppedDueTo = {
          sourcePath: pngPath,
          reason: "artwork could not be safely prepared, and then failed to move/record the rejection",
          details: [message],
        };
        break;
      }

      rejected.push({ sourcePath: pngPath, rejectedPath: rejectedPngPath, filename: path.basename(pngPath), reason, suggestedFix });
      baseLogger.warn("Artwork rejected: could not be safely prepared", {
        metadata: { sourcePath: pngPath, rejectedPngPath, reason, suggestedFix },
      });
      continue;
    }

    const { buffer, original, processed, fixesApplied, suitableForPrintify } = result.value;

    try {
      mkdirSync(path.dirname(processedPngPath), { recursive: true });
      writeFileSync(processedPngPath, buffer);
      const outputs = outputPaths(processedPngPath);
      writeFileSync(
        outputs.prepared,
        JSON.stringify(
          {
            sourcePath: pngPath,
            processedPath: processedPngPath,
            original,
            processed,
            fixesApplied,
            suitableForPrintify,
            preparedAt: now().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stoppedDueTo = {
        sourcePath: pngPath,
        reason: "prepared successfully but failed to write the processed file/report (filesystem error)",
        details: [message],
      };
      break;
    }

    prepared.push({
      sourcePath: pngPath,
      processedPath: processedPngPath,
      originalDimensions: `${original.width}x${original.height}`,
      processedDimensions: `${processed.width}x${processed.height}`,
      transparencyBefore: original.hasTransparentBackground,
      transparencyAfter: processed.hasTransparentBackground,
      fixesApplied: fixesApplied.map((f) => f.detail),
      suitableForPrintify,
    });
    baseLogger.info("Artwork prepared", {
      metadata: { sourcePath: pngPath, processedPngPath, fixesApplied: fixesApplied.length, suitableForPrintify },
    });
  }

  const remainingUnprocessed =
    stoppedDueTo !== null
      ? pngPaths.slice(pngPaths.findIndex((p) => p === stoppedDueTo!.sourcePath) + 1)
      : [];

  if (stoppedDueTo !== null) {
    baseLogger.error("Artwork preparation stopped: a system failure halted the batch", {
      metadata: { stoppedDueTo, remainingUnprocessed: remainingUnprocessed.length },
    });
  }
  baseLogger.info("Artwork preparation scan complete", {
    metadata: {
      scanned: pngPaths.length,
      prepared: prepared.length,
      rejected: rejected.length,
      skippedAlreadyProcessed: skippedAlreadyProcessed.length,
      skippedAlreadyRejected: skippedAlreadyRejected.length,
      stopped: stoppedDueTo !== null,
      remainingUnprocessed: remainingUnprocessed.length,
    },
  });

  return {
    scanned: pngPaths.length,
    prepared,
    rejected,
    skippedAlreadyProcessed,
    skippedAlreadyRejected,
    stoppedDueTo,
    remainingUnprocessed,
  };
}

async function main(): Promise<void> {
  const report = await prepareApprovedArtwork();

  console.log(`\nScanned ${report.scanned} PNG(s) in designs/approved/`);
  for (const item of report.prepared) {
    console.log(`  PREPARED  ${item.sourcePath}`);
    console.log(`              -> ${item.processedPath}`);
    console.log(`              ${item.originalDimensions} (transparent: ${item.transparencyBefore}) -> ${item.processedDimensions} (transparent: ${item.transparencyAfter})`);
    if (item.fixesApplied.length === 0) {
      console.log("              already print-ready, no fixes applied");
    } else {
      for (const fix of item.fixesApplied) console.log(`              fix: ${fix}`);
    }
    console.log(`              suitable for Printify: ${item.suitableForPrintify}`);
  }
  for (const item of report.rejected) {
    console.log(`  REJECTED  ${item.filename}`);
    console.log(`              -> ${item.rejectedPath}`);
    console.log(`              reason: ${item.reason}`);
    console.log(`              suggested fix: ${item.suggestedFix}`);
  }
  for (const item of report.skippedAlreadyProcessed) {
    console.log(`  SKIPPED   ${item} (already processed)`);
  }
  for (const item of report.skippedAlreadyRejected) {
    console.log(`  SKIPPED   ${item} (already rejected)`);
  }
  if (report.stoppedDueTo !== null) {
    console.log(`\n  STOPPED (system failure)   ${report.stoppedDueTo.sourcePath}`);
    console.log(`              reason: ${report.stoppedDueTo.reason}`);
    for (const detail of report.stoppedDueTo.details) console.log(`              - ${detail}`);
    console.log(`\n  ${report.remainingUnprocessed.length} PNG(s) never attempted:`);
    for (const item of report.remainingUnprocessed) console.log(`    ${item}`);
  }

  console.log("\nBatch summary:");
  console.log(`  Processed: ${report.prepared.length}`);
  console.log(`  Rejected: ${report.rejected.length}`);
  console.log(`  Skipped: ${report.skippedAlreadyProcessed.length + report.skippedAlreadyRejected.length}`);

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
