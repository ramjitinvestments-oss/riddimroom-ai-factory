/**
 * Dry-run implementation of `ShopifyProvider`. No network call —
 * produces a realistic, deterministic fake product id, and
 * `verifyProductLive` always reports success, so the batch
 * publish/verify orchestration can be built and tested before any
 * Shopify credentials exist. Selected automatically by
 * `createShopifyProvider` when `DRY_RUN` is true.
 */
import { ValidationError, type ExternalServiceError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type {
  ShopifyProvider,
  ShopifyPublishRequest,
  ShopifyPublishResult,
  ShopifyVerifyResult,
} from "./types.ts";

export interface DryRunShopifyProviderOptions {
  readonly now?: () => Date;
}

export class DryRunShopifyProvider implements ShopifyProvider {
  readonly name = "dry-run";
  private readonly now: () => Date;

  constructor(options: DryRunShopifyProviderOptions = {}) {
    this.now = options.now ?? ((): Date => new Date());
  }

  async publishProduct(
    request: ShopifyPublishRequest,
  ): Promise<Result<ShopifyPublishResult, ExternalServiceError | ValidationError>> {
    if (request.title.trim().length === 0) {
      return err(new ValidationError(["title must not be blank"]));
    }
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }
    if (request.imagePng.length === 0) {
      return err(new ValidationError(["imagePng must not be empty"]));
    }

    return ok({
      jobId: request.jobId,
      provider: this.name,
      shopifyProductId: `dry-run-product-${request.jobId}`,
      createdAt: this.now().toISOString(),
      metadata: { dryRun: true },
    });
  }

  async verifyProductLive(
    shopifyProductId: string,
  ): Promise<Result<ShopifyVerifyResult, ExternalServiceError | ValidationError>> {
    if (shopifyProductId.trim().length === 0) {
      return err(new ValidationError(["shopifyProductId must not be blank"]));
    }
    return ok({ shopifyProductId, isLive: true, status: "active" });
  }
}
