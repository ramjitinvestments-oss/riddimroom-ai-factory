/**
 * Structured logger. Every entry is a machine-readable `LogEntry`
 * (`./types.ts`), sent to every configured `LogTransport` (`./log-transport.ts`).
 *
 * Correlation: bind a job with `withJob(jobId)` to get a child logger that
 * stamps every subsequent entry with that same job id — the mechanism
 * that satisfies "every log for a job includes that job's id" across
 * every module the job passes through.
 *
 * Secrets: metadata is passed through `redactSecrets` before it reaches
 * any transport, so values under a sensitive-looking key (token, apiKey,
 * password, cookie, session, ...) are masked automatically. This is a
 * key-based redaction — never interpolate a secret directly into the
 * free-text `message`, since that text is not scanned.
 */
import { performance } from "node:perf_hooks";
import { redactSecrets } from "./redact.ts";
import type { LogTransport } from "./log-transport.ts";
import type { LogEntry, LogLevel } from "./types.ts";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** True if `value` is one of the six recognized log levels. */
export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(LEVEL_WEIGHT, value);
}

/** Parses a level from config, falling back to `fallback` (default "info") for anything unrecognized. */
export function parseLogLevel(value: string, fallback: LogLevel = "info"): LogLevel {
  const normalized = value.toLowerCase();
  return isLogLevel(normalized) ? normalized : fallback;
}

/** Per-call context merged onto whatever job/stage a logger is already bound to. */
export interface LogContext {
  readonly jobId?: string | null;
  readonly stage?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly error?: unknown;
  readonly duration?: number;
}

export interface LoggerOptions {
  /** Name of the emitting module, e.g. "automation/ai". */
  readonly module: string;
  readonly transports: readonly LogTransport[];
  /** Minimum level that reaches a transport. Defaults to "info". */
  readonly minLevel?: LogLevel;
  readonly jobId?: string | null;
  readonly stage?: string | null;
  /** Injectable clock, for tests. */
  readonly now?: () => Date;
}

export class Logger {
  private readonly moduleName: string;
  private readonly transports: readonly LogTransport[];
  private readonly minLevel: LogLevel;
  private readonly boundJobId: string | null;
  private readonly boundStage: string | null;
  private readonly now: () => Date;

  constructor(options: LoggerOptions) {
    this.moduleName = options.module;
    this.transports = options.transports;
    this.minLevel = options.minLevel ?? "info";
    this.boundJobId = options.jobId ?? null;
    this.boundStage = options.stage ?? null;
    this.now = options.now ?? ((): Date => new Date());
  }

  /**
   * Returns a child logger that stamps every entry with `jobId`. If
   * `stage` is omitted, the child inherits whatever stage this logger is
   * already bound to; pass `null` explicitly to clear it.
   */
  withJob(jobId: string, stage?: string | null): Logger {
    return new Logger({
      module: this.moduleName,
      transports: this.transports,
      minLevel: this.minLevel,
      jobId,
      stage: stage !== undefined ? stage : this.boundStage,
      now: this.now,
    });
  }

  /** Returns a child logger scoped to `stage`, keeping the same job binding. */
  withStage(stage: string): Logger {
    return new Logger({
      module: this.moduleName,
      transports: this.transports,
      minLevel: this.minLevel,
      jobId: this.boundJobId,
      stage,
      now: this.now,
    });
  }

  trace(message: string, context?: LogContext): void {
    this.log("trace", message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log("error", message, context);
  }

  fatal(message: string, context?: LogContext): void {
    this.log("fatal", message, context);
  }

  /**
   * Times an operation (e.g. "Generate Artwork", "Upload Printify",
   * "Publish Shopify"), automatically logging elapsed time: an `info`
   * entry with `duration` on success, an `error` entry with `duration`
   * (and the caught error, serialized into metadata) on failure. The
   * original error/rejection is always rethrown — timing only observes,
   * it never changes error semantics.
   */
  async time<T>(
    label: string,
    fn: () => T | Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const start = performance.now();
    try {
      const value = await fn();
      this.info(`${label} completed`, {
        ...(metadata !== undefined ? { metadata } : {}),
        duration: performance.now() - start,
      });
      return value;
    } catch (error) {
      this.error(`${label} failed`, {
        ...(metadata !== undefined ? { metadata } : {}),
        error,
        duration: performance.now() - start,
      });
      throw error;
    }
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) {
      return;
    }

    const rawMetadata: Record<string, unknown> = {
      ...(context?.metadata ?? {}),
      ...(context?.error !== undefined ? { error: serializeError(context.error) } : {}),
    };

    const entry: LogEntry = {
      timestamp: this.now().toISOString(),
      level,
      module: this.moduleName,
      jobId: context?.jobId ?? this.boundJobId,
      stage: context?.stage ?? this.boundStage,
      message,
      metadata: redactSecrets(rawMetadata) as Record<string, unknown>,
      ...(context?.duration !== undefined ? { duration: context.duration } : {}),
    };

    for (const transport of this.transports) {
      const result = transport.write(entry);
      if (!result.ok) {
        process.stderr.write(
          `[logger] transport "${transport.name}" failed: ${result.error.message}\n`,
        );
      }
    }
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}
