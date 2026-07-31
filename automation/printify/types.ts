/**
 * Provider interface for Printify product creation. Same shape as
 * `automation/ai`'s providers: pipeline code depends only on
 * `PrintifyProvider`, selected by `createPrintifyProvider`
 * (./create-provider.ts), so the concrete implementation (or a future
 * print-on-demand alternative) can change without touching pipeline code.
 */
import type { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import type { Result } from "../shared/result.ts";

export interface PrintifyUploadRequest {
  readonly jobId: string;
  readonly title: string;
  readonly description: string;
  readonly artworkPng: Buffer;
  /** Retail price in USD, from the job's product.json. */
  readonly priceUsd: number;
}

export interface PrintifyUploadResult {
  readonly jobId: string;
  readonly provider: string;
  readonly printifyProductId: string;
  readonly printifyImageId: string;
  readonly createdAt: string; // ISO 8601
  readonly metadata: Record<string, unknown>;
}

export interface PrintifyProvider {
  readonly name: string;
  uploadProduct(
    request: PrintifyUploadRequest,
  ): Promise<Result<PrintifyUploadResult, ExternalServiceError | ValidationError>>;
}
