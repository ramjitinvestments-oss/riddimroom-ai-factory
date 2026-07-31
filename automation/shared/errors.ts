/**
 * Shared error taxonomy for the whole platform.
 *
 * Each subclass represents an *expected, operational* failure (bad input,
 * missing file, unreachable service) — the kind of thing callers check
 * for via `Result` (see `./result.ts`), not a bug. `code` is a stable,
 * machine-readable discriminator safe to branch or log on, independent of
 * `message`, which is free to change for readability.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** One or more required environment variables are missing or blank. */
export class ConfigError extends AppError {
  readonly code = "CONFIG_ERROR";
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    const list = missing.map((name) => `  - ${name}`).join("\n");
    super(`Missing required environment variable(s):\n${list}`);
    this.missing = missing;
  }
}

/** Input failed validation against an expected shape or constraint. */
export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    const list = issues.map((issue) => `  - ${issue}`).join("\n");
    super(`Validation failed:\n${list}`);
    this.issues = issues;
  }
}

/** A filesystem operation on the `designs/` pipeline (or elsewhere) failed. */
export type FileOperation = "read" | "write" | "move" | "mkdir" | "delete";

export class FileOperationError extends AppError {
  readonly code = "FILE_OPERATION_ERROR";
  readonly operation: FileOperation;
  readonly path: string;

  constructor(operation: FileOperation, path: string, options?: ErrorOptions) {
    super(`Failed to ${operation} "${path}"`, options);
    this.operation = operation;
    this.path = path;
  }
}

/** A job could not be created, transitioned, or persisted as requested. */
export class JobError extends AppError {
  readonly code = "JOB_ERROR";
  readonly jobId: string;

  constructor(jobId: string, message: string, options?: ErrorOptions) {
    super(`Job "${jobId}": ${message}`, options);
    this.jobId = jobId;
  }
}

/** A call to an external platform (Printify, Shopify, an AI provider, a social API) failed. */
export class ExternalServiceError extends AppError {
  readonly code = "EXTERNAL_SERVICE_ERROR";
  readonly service: string;
  readonly statusCode?: number;

  constructor(
    service: string,
    message: string,
    options?: ErrorOptions & { statusCode?: number },
  ) {
    super(`${service}: ${message}`, options);
    this.service = service;
    if (options?.statusCode !== undefined) {
      this.statusCode = options.statusCode;
    }
  }
}
