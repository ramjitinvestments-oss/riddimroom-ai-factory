/**
 * Human approval gate (launch pipeline stage 6). Batch by design, not
 * retrofitted: approve/reject accept multiple job IDs or `--all` from
 * this first implementation.
 *
 * Moves a job's directory from designs/generated/{jobId} to
 * designs/approved/{jobId} (approve) or designs/archive/{jobId}
 * (reject) — never overwriting an existing destination, and refusing to
 * move a job that isn't fully generated (no product.json yet). This is
 * the whole approval mechanism: a human runs this command; nothing
 * auto-approves.
 *
 *   node scripts/approve.ts approve job-1 job-2
 *   node scripts/approve.ts approve --all
 *   node scripts/approve.ts reject job-3
 */
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../automation/shared/config.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";

export type ApprovalDecision = "approve" | "reject";

export interface JobDecisionResult {
  readonly jobId: string;
  readonly status: "ok" | "failed";
  readonly destination?: string;
  readonly error?: string;
}

export interface DecideJobsOptions {
  readonly generatedRoot?: string;
  readonly approvedRoot?: string;
  readonly archiveRoot?: string;
  readonly logger?: Logger;
}

/** Job IDs under `generatedRoot` that have finished generation (have a product.json) and are awaiting a decision. */
export function listPendingJobIds(generatedRoot: string): string[] {
  if (!existsSync(generatedRoot)) {
    return [];
  }
  return readdirSync(generatedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((jobId) => existsSync(path.join(generatedRoot, jobId, "product.json")));
}

/**
 * Applies `decision` to every job in `jobIds`, moving each one's
 * directory to the appropriate pipeline folder. Never throws — each
 * job's outcome (moved, or why it couldn't be) is captured in its own
 * `JobDecisionResult` so one bad job ID doesn't stop the rest of the batch.
 */
export function decideJobs(
  decision: ApprovalDecision,
  jobIds: readonly string[],
  options: DecideJobsOptions = {},
): JobDecisionResult[] {
  const generatedRoot = options.generatedRoot ?? path.join("designs", "generated");
  const targetRoot =
    decision === "approve"
      ? (options.approvedRoot ?? path.join("designs", "approved"))
      : (options.archiveRoot ?? path.join("designs", "archive"));
  const logger =
    options.logger ??
    new Logger({ module: "scripts/approve", transports: [new ConsoleTransport(), new FileTransport()] });
  const verb = decision === "approve" ? "approved" : "rejected";

  return jobIds.map((jobId): JobDecisionResult => {
    const sourceDir = path.join(generatedRoot, jobId);
    const destDir = path.join(targetRoot, jobId);
    const jobLogger = logger.withJob(jobId, decision);

    if (!existsSync(sourceDir)) {
      const message = `job directory not found: ${sourceDir}`;
      jobLogger.warn(message);
      return { jobId, status: "failed", error: message };
    }
    if (!existsSync(path.join(sourceDir, "product.json"))) {
      const message = `job is not fully generated yet (missing product.json): ${sourceDir}`;
      jobLogger.warn(message);
      return { jobId, status: "failed", error: message };
    }
    if (existsSync(destDir)) {
      const message = `destination already exists, refusing to overwrite: ${destDir}`;
      jobLogger.warn(message);
      return { jobId, status: "failed", error: message };
    }

    try {
      mkdirSync(targetRoot, { recursive: true });
      renameSync(sourceDir, destDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      jobLogger.error(`failed to move job to ${decision === "approve" ? "approved" : "archive"}`, {
        error,
      });
      return { jobId, status: "failed", error: message };
    }

    jobLogger.info(`Job ${verb}`, { metadata: { destination: destDir } });
    return { jobId, status: "ok", destination: destDir };
  });
}

async function main(): Promise<void> {
  loadEnv();
  const [decisionArg, ...rest] = process.argv.slice(2);

  if (decisionArg !== "approve" && decisionArg !== "reject") {
    console.error("Usage: node scripts/approve.ts <approve|reject> <jobId...>|--all");
    process.exitCode = 1;
    return;
  }

  let jobIds: string[];
  if (rest.length === 1 && rest[0] === "--all") {
    jobIds = listPendingJobIds(path.join("designs", "generated"));
    if (jobIds.length === 0) {
      console.log("No pending jobs found in designs/generated/.");
      return;
    }
  } else if (rest.length > 0) {
    jobIds = rest;
  } else {
    console.error("Usage: node scripts/approve.ts <approve|reject> <jobId...>|--all");
    process.exitCode = 1;
    return;
  }

  const results = decideJobs(decisionArg, jobIds);
  for (const result of results) {
    if (result.status === "ok") {
      console.log(`  OK    ${result.jobId} -> ${result.destination}`);
    } else {
      console.log(`  FAIL  ${result.jobId}: ${result.error}`);
    }
  }

  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`\n${results.length - failed}/${results.length} ${decisionArg} succeeded.`);
  if (failed > 0) {
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
