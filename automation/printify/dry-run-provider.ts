/**
 * Dry-run implementation of `PrintifyProvider`. No network call —
 * produces a realistic, deterministic fake product id so downstream
 * pipeline stages (Shopify publish, verification, the batch report) can
 * be built and tested before any Printify credentials exist. Selected
 * automatically by `createPrintifyProvider` when `DRY_RUN` is true.
 */
import { ValidationError, type ExternalServiceError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type {
  PrintifyProvider,
  PrintifyUpdateRequest,
  PrintifyUpdateResult,
  PrintifyUploadRequest,
  PrintifyUploadResult,
} from "./types.ts";

export interface DryRunPrintifyProviderOptions {
  readonly now?: () => Date;
}

export class DryRunPrintifyProvider implements PrintifyProvider {
  readonly name = "dry-run";
  private readonly now: () => Date;

  constructor(options: DryRunPrintifyProviderOptions = {}) {
    this.now = options.now ?? ((): Date => new Date());
  }

  async uploadProduct(
    request: PrintifyUploadRequest,
  ): Promise<Result<PrintifyUploadResult, ExternalServiceError | ValidationError>> {
    if (request.title.trim().length === 0) {
      return err(new ValidationError(["title must not be blank"]));
    }
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }
    if (request.artworkPng.length === 0) {
      return err(new ValidationError(["artworkPng must not be empty"]));
    }

    return ok({
      jobId: request.jobId,
      provider: this.name,
      printifyProductId: `dry-run-product-${request.jobId}`,
      printifyImageId: `dry-run-image-${request.jobId}`,
      createdAt: this.now().toISOString(),
      mockupUrls: [],
      metadata: { dryRun: true },
    });
  }

  async updateProductColorAndPlacement(
    request: PrintifyUpdateRequest,
  ): Promise<Result<PrintifyUpdateResult, ExternalServiceError | ValidationError>> {
    if (request.printifyProductId.trim().length === 0) {
      return err(new ValidationError(["printifyProductId must not be blank"]));
    }
    if (request.printifyImageId.trim().length === 0) {
      return err(new ValidationError(["printifyImageId must not be blank"]));
    }
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }
    if (request.variantIds.length === 0) {
      return err(new ValidationError(["no variant ids supplied for the update"]));
    }

    return ok({
      jobId: request.jobId,
      provider: this.name,
      printifyProductId: request.printifyProductId,
      updatedAt: this.now().toISOString(),
      mockupUrls: [],
    });
  }
}
