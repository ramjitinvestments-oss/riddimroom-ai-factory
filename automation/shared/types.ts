/**
 * Shared type contracts used across the platform.
 *
 * Interfaces only — no implementation. Concrete logic lands in later
 * steps (structured logging, the job system, the file manager); defining
 * the shapes now lets each of those, and any platform module built on top
 * of them later, target a stable contract from the start.
 */

/** Severity of a log line, from least to most severe. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * One structured, machine-readable log record. `jobId` and `stage` are
 * always present (nullable rather than optional) so every consumer of a
 * log stream can rely on the field existing, whether or not the entry is
 * tied to a job. `duration` is only set for entries produced by a timed
 * operation (see `Logger.time` in `./logger.ts`).
 */
export interface LogEntry {
  readonly timestamp: string; // ISO 8601
  readonly level: LogLevel;
  readonly module: string;
  readonly jobId: string | null;
  readonly stage: string | null;
  readonly message: string;
  readonly metadata: Record<string, unknown>;
  readonly duration?: number; // milliseconds
}

/** Resolved, cross-cutting application configuration. */
export interface AppConfig {
  readonly nodeEnv: string;
  readonly logLevel: LogLevel;
}

/**
 * Lifecycle status of a single production job (one design moving through
 * the pipeline). Status is the primary resumability mechanism: a job
 * reloaded from persisted state resumes at whatever stage its `status`
 * indicates instead of restarting from `NEW`.
 */
export type JobStatus =
  | "NEW"
  | "GENERATING"
  | "GENERATED"
  | "APPROVED"
  | "UPLOADING"
  | "UPLOADED"
  | "PUBLISHED"
  | "FAILED";

/** One recorded transition in a job's lifecycle, forming an audit trail. */
export interface JobStatusChange {
  readonly status: JobStatus;
  readonly at: string; // ISO 8601
  readonly note?: string;
}

/**
 * A single unit of work moving through the pipeline (one design, from
 * generation through publish).
 *
 * `history` and `attempts` exist so a job can be resumed after a crash or
 * restart: reloading a persisted `Job` gives enough state to pick up at
 * `status` rather than redo already-completed stages. `data` carries
 * whatever stage-specific state later stages need (a generated file path,
 * a Printify product ID, ...) without this shared interface knowing about
 * any specific platform.
 */
export interface Job<TData = Record<string, unknown>> {
  readonly id: string;
  readonly status: JobStatus;
  readonly createdAt: string; // ISO 8601
  readonly updatedAt: string; // ISO 8601
  readonly attempts: number;
  readonly history: readonly JobStatusChange[];
  readonly lastError?: string;
  readonly data: TData;
}
