/**
 * The single production launch command. Orchestrates the existing,
 * already-built pipeline — `scripts/preflight-check.ts` and
 * `scripts/apparel-pipeline.ts` — end to end for every apparel product.
 * Contains no pipeline logic of its own: every real action (Printify
 * regenerate/upload, Shopify sync/publish, gallery mapping) happens
 * inside `runApparelPipeline()`, exactly as it does when that script is
 * run by hand for one design. This file only sequences it across every
 * design and turns the results into one launch report.
 *
 * Flow:
 *   1. Pre-flight check (scripts/preflight-check.ts). Any FAIL blocks the
 *      launch before a single production call is made.
 *   2. Regenerate Gold Turntable (update path — reused product ids).
 *   3. Upload Crown, RR Shirt 1, Treasure Chest in turn (create path,
 *      each automatically chained into the same regenerate+sync steps
 *      Gold Turntable uses, so every new product also comes out on the
 *      approved black garment with the approved gallery — see
 *      scripts/apparel-pipeline.ts's module doc comment).
 *   4. Stop immediately the moment any design's run fails — no later
 *      design is attempted. This mirrors the production-safe pattern
 *      every underlying stage script already uses; this file doesn't
 *      reimplement that pattern, it just applies the same "stop, don't
 *      skip" rule across designs instead of across PNGs within one
 *      stage.
 *   5. Write a launch report (JSON) to logs/, and print a summary.
 *
 *   node --experimental-strip-types scripts/launch-apparel.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runApparelPipeline, type ApparelPipelineResult } from "./apparel-pipeline.ts";
import { runPreflightCheck, type PreflightCheckReport } from "./preflight-check.ts";
import { loadEnv } from "../automation/shared/config.ts";
import type { ConfigError, ExternalServiceError, ValidationError } from "../automation/shared/errors.ts";
import { Logger } from "../automation/shared/logger.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import type { Result } from "../automation/shared/result.ts";

/** Order matters: Gold Turntable (the reference product) first, then the pending designs. */
const LAUNCH_DESIGN_STEMS = ["GOLDEN turntable", "crown", "RR shirt 1", "treasure chest"] as const;

export interface LaunchedDesign {
  readonly designStem: string;
  readonly outcome: "updated" | "created" | "failed";
  readonly route?: ApparelPipelineResult["route"];
  readonly printifyProductId?: string;
  readonly shopifyProductId?: string;
  readonly mappedGallerySlots?: readonly string[];
  readonly unmappedGallerySlots?: readonly string[];
  readonly error?: string;
}

export interface LaunchReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly preflight: PreflightCheckReport;
  readonly launched: boolean; // false if preflight blocked the launch entirely
  readonly designs: readonly LaunchedDesign[];
  readonly stoppedAt: string | null; // design stem that failed and stopped the run, if any
  readonly succeeded: boolean; // true only if preflight passed AND every design succeeded
}

export interface RunLaunchOptions {
  readonly designStems?: readonly string[];
  readonly logger?: Logger;
  readonly env?: NodeJS.ProcessEnv;
  readonly reportDir?: string;
  readonly now?: () => Date;
  /**
   * Test-only injection seams — default to the real `runPreflightCheck`/
   * `runApparelPipeline`. Never overridden by the CLI entry point below;
   * exist purely so tests can exercise this file's own orchestration
   * logic (stop-on-first-failure, report writing, the preflight-blocks-
   * launch branch) deterministically, without re-driving real Printify/
   * Shopify calls through every layer underneath.
   */
  readonly preflightFn?: typeof runPreflightCheck;
  readonly runDesignFn?: (
    designStem: string,
    opts: { readonly logger: Logger; readonly env?: NodeJS.ProcessEnv },
  ) => Promise<Result<ApparelPipelineResult, ConfigError | ValidationError | ExternalServiceError>>;
}

/**
 * Runs the full production launch: pre-flight, then every design in
 * order, stopping at the first failure. Never throws — every outcome
 * (including a blocked pre-flight or a mid-run failure) is captured in
 * the returned `LaunchReport`.
 */
export async function runLaunch(options: RunLaunchOptions = {}): Promise<LaunchReport> {
  const now = options.now ?? ((): Date => new Date());
  const startedAt = now().toISOString();
  const designStems = options.designStems ?? LAUNCH_DESIGN_STEMS;
  const baseLogger =
    options.logger ??
    new Logger({ module: "scripts/launch-apparel", transports: [new ConsoleTransport(), new FileTransport()] });

  const preflightFn = options.preflightFn ?? runPreflightCheck;
  const runDesignFn = options.runDesignFn ?? runApparelPipeline;

  const preflight = await preflightFn(options.env !== undefined ? { env: options.env } : {});

  if (!preflight.passed) {
    baseLogger.error("Launch blocked: pre-flight check failed", {
      metadata: { failedChecks: preflight.checks.filter((c) => c.status === "fail").map((c) => c.name) },
    });
    return {
      startedAt,
      finishedAt: now().toISOString(),
      preflight,
      launched: false,
      designs: [],
      stoppedAt: null,
      succeeded: false,
    };
  }

  baseLogger.info("Pre-flight passed — launching production run", { metadata: { designStems } });

  const designs: LaunchedDesign[] = [];
  let stoppedAt: string | null = null;

  for (const designStem of designStems) {
    const result = await runDesignFn(designStem, {
      logger: baseLogger,
      ...(options.env !== undefined ? { env: options.env } : {}),
    });

    if (!result.ok) {
      designs.push({ designStem, outcome: "failed", error: result.error.message });
      stoppedAt = designStem;
      baseLogger.error(`Launch stopped at "${designStem}"`, { metadata: { reason: result.error.message } });
      break;
    }

    const r = result.value;
    designs.push({
      designStem,
      outcome: r.route === "update-existing" ? "updated" : "created",
      route: r.route,
      printifyProductId: r.regenerate.printifyProductId,
      shopifyProductId: r.sync.shopifyProductId,
      mappedGallerySlots: r.sync.mappedSlots.map((s) => s.slot),
      unmappedGallerySlots: r.sync.unmappedSlots,
    });
    baseLogger.info(`"${designStem}" launched successfully`, {
      metadata: { outcome: r.route, printifyProductId: r.regenerate.printifyProductId, shopifyProductId: r.sync.shopifyProductId },
    });
  }

  const succeeded = stoppedAt === null;
  const report: LaunchReport = {
    startedAt,
    finishedAt: now().toISOString(),
    preflight,
    launched: true,
    designs,
    stoppedAt,
    succeeded,
  };

  try {
    const reportDir = options.reportDir ?? "logs";
    mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `launch-report-${startedAt.replace(/[:.]/g, "-")}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    baseLogger.info("Launch report written", { metadata: { reportPath } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    baseLogger.error("Launch completed but writing the report file failed", { metadata: { message } });
  }

  return report;
}

function printReport(report: LaunchReport): void {
  if (!report.launched) {
    console.log("\nLAUNCH BLOCKED — pre-flight check failed:");
    for (const check of report.preflight.checks.filter((c) => c.status === "fail")) {
      console.log(`  ✗ ${check.name}: ${check.detail}`);
    }
    console.log("\nFix the above and re-run. No production calls were made.");
    return;
  }

  console.log("\nLaunch results:");
  for (const design of report.designs) {
    if (design.outcome === "failed") {
      console.log(`  ✗ FAILED   "${design.designStem}" — ${design.error}`);
      continue;
    }
    const label = design.outcome === "updated" ? "UPDATED " : "CREATED ";
    console.log(`  ✓ ${label} "${design.designStem}"`);
    console.log(`      Printify: ${design.printifyProductId}`);
    console.log(`      Shopify:  ${design.shopifyProductId}`);
    console.log(`      Gallery:  ${design.mappedGallerySlots?.length ?? 0} mapped, ${design.unmappedGallerySlots?.length ?? 0} unmapped`);
    if (design.unmappedGallerySlots !== undefined && design.unmappedGallerySlots.length > 0) {
      console.log(`      Unmapped: ${design.unmappedGallerySlots.join("; ")}`);
    }
  }

  if (report.succeeded) {
    console.log(
      `\n${report.designs.length}/${report.designs.length} products launched. ` +
        `Every product reused its existing id where one already existed — no duplicates created.`,
    );
    console.log("\nNext: run the Phase 4/5 verification checklist in docs/gold-turntable-regeneration-runbook.md,");
    console.log("then publish the draft Shopify theme (one click, not automated by this command).");
  } else {
    console.log(`\nSTOPPED at "${report.stoppedAt}". Every design before it launched successfully; nothing after it was attempted.`);
    console.log("Fix the failure and re-run — already-launched designs are skipped, not redone.");
  }
}

async function main(): Promise<void> {
  loadEnv();
  const report = await runLaunch();
  printReport(report);
  if (!report.launched || !report.succeeded) {
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
