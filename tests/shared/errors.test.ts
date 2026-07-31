import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConfigError,
  ExternalServiceError,
  FileOperationError,
  JobError,
  ValidationError,
} from "../../automation/shared/errors.ts";

test("ConfigError lists every missing variable and carries the CONFIG_ERROR code", () => {
  const error = new ConfigError(["FOO", "BAR"]);
  assert.equal(error.code, "CONFIG_ERROR");
  assert.deepEqual(error.missing, ["FOO", "BAR"]);
  assert.match(error.message, /FOO/);
  assert.match(error.message, /BAR/);
  assert.equal(error.name, "ConfigError");
  assert.ok(error instanceof Error);
});

test("ValidationError lists every issue and carries the VALIDATION_ERROR code", () => {
  const error = new ValidationError(["field x is required"]);
  assert.equal(error.code, "VALIDATION_ERROR");
  assert.deepEqual(error.issues, ["field x is required"]);
  assert.match(error.message, /field x is required/);
});

test("FileOperationError records the operation and path", () => {
  const cause = new Error("EACCES");
  const error = new FileOperationError("move", "designs/incoming/a.png", { cause });
  assert.equal(error.code, "FILE_OPERATION_ERROR");
  assert.equal(error.operation, "move");
  assert.equal(error.path, "designs/incoming/a.png");
  assert.equal(error.cause, cause);
  assert.match(error.message, /move/);
  assert.match(error.message, /designs\/incoming\/a\.png/);
});

test("JobError records the job id and carries the JOB_ERROR code", () => {
  const error = new JobError("job-123", "cannot transition from FAILED to APPROVED");
  assert.equal(error.code, "JOB_ERROR");
  assert.equal(error.jobId, "job-123");
  assert.match(error.message, /job-123/);
  assert.match(error.message, /cannot transition/);
});

test("ExternalServiceError records the service name and optional status code", () => {
  const error = new ExternalServiceError("printify", "request timed out", { statusCode: 504 });
  assert.equal(error.code, "EXTERNAL_SERVICE_ERROR");
  assert.equal(error.service, "printify");
  assert.equal(error.statusCode, 504);
  assert.match(error.message, /printify/);
});

test("ExternalServiceError works without a status code", () => {
  const error = new ExternalServiceError("shopify", "network unreachable");
  assert.equal(error.statusCode, undefined);
});
