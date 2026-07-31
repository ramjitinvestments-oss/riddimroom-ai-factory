/**
 * Provider interface for publishing to Shopify and verifying a product
 * went live. Same shape as `automation/ai` and `automation/printify`'s
 * providers: pipeline code depends only on `ShopifyProvider`, selected
 * by `createShopifyProvider` (./create-provider.ts).
 */
import type { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import type { Result } from "../shared/result.ts";

export interface ShopifyPublishRequest {
  readonly jobId: string;
  readonly title: string;
  readonly descriptionHtml: string;
  readonly tags: readonly string[];
  readonly productType: string;
  /** Retail price in USD, from the job's product.json. */
  readonly priceUsd: number;
  readonly imagePng: Buffer;
}

export interface ShopifyPublishResult {
  readonly jobId: string;
  readonly provider: string;
  readonly shopifyProductId: string;
  readonly createdAt: string; // ISO 8601
  readonly metadata: Record<string, unknown>;
}

export interface ShopifyVerifyResult {
  readonly shopifyProductId: string;
  readonly isLive: boolean;
  readonly status: string;
}

export interface ShopifyProvider {
  readonly name: string;
  publishProduct(
    request: ShopifyPublishRequest,
  ): Promise<Result<ShopifyPublishResult, ExternalServiceError | ValidationError>>;
  /** Confirms a previously published product actually exists and is active (launch pipeline stage 9). */
  verifyProductLive(
    shopifyProductId: string,
  ): Promise<Result<ShopifyVerifyResult, ExternalServiceError | ValidationError>>;
}
