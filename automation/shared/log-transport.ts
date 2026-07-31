/**
 * Log destinations ("transports"). `Logger` (./logger.ts) only knows about
 * the `LogTransport` interface — adding a new destination (a future
 * external logging provider, e.g.) means implementing this interface and
 * passing an instance in, never modifying `Logger` itself.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { FileOperationError } from "./errors.ts";
import { err, ok, type Result } from "./result.ts";
import type { LogEntry } from "./types.ts";

/** A destination a `Logger` can send entries to. */
export interface LogTransport {
  readonly name: string;
  write(entry: LogEntry): Result<void, FileOperationError>;
}

/**
 * Writes each entry as one JSON line to stdout. `warn`/`error`/`fatal`
 * entries go to stderr instead, so severity-based filtering (e.g.
 * `2>/dev/null`) works the way it would for any other CLI tool.
 */
export class ConsoleTransport implements LogTransport {
  readonly name = "console";

  write(entry: LogEntry): Result<void, FileOperationError> {
    const line = `${JSON.stringify(entry)}\n`;
    if (entry.level === "warn" || entry.level === "error" || entry.level === "fatal") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
    return ok(undefined);
  }
}

export interface FileTransportOptions {
  /** Directory log files are written into. Defaults to "logs". */
  readonly directory?: string;
  /** Injectable clock, so tests can control which day's file is targeted. */
  readonly now?: () => Date;
}

/**
 * Writes each entry as one JSON line to a daily log file
 * (`<directory>/YYYY-MM-DD.log`). One file per calendar day is the
 * rotation strategy: there is no background rotation process, the file to
 * append to is simply recomputed from the current date on every write, so
 * no single file grows without bound across days.
 */
export class FileTransport implements LogTransport {
  readonly name = "file";
  private readonly directory: string;
  private readonly now: () => Date;

  constructor(options: FileTransportOptions = {}) {
    this.directory = options.directory ?? "logs";
    this.now = options.now ?? ((): Date => new Date());
  }

  write(entry: LogEntry): Result<void, FileOperationError> {
    const filePath = this.currentFilePath();
    const line = `${JSON.stringify(entry)}\n`;
    try {
      mkdirSync(this.directory, { recursive: true });
      appendFileSync(filePath, line, "utf8");
      return ok(undefined);
    } catch (error) {
      return err(new FileOperationError("write", filePath, { cause: error }));
    }
  }

  private currentFilePath(): string {
    const date = this.now().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(this.directory, `${date}.log`);
  }
}
