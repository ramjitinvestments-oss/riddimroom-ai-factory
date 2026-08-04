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
  /** SEO title (theme <title>/global title tag). Omit to leave unset. */
  readonly seoTitle?: string;
  /** SEO meta description (global description tag). Omit to leave unset. */
  readonly seoDescription?: string;
  /** Collection name to assign the product to — found by title, or created if none exists yet. Omit to skip collection assignment. */
  readonly collection?: string;
}

export interface ShopifyPublishResult {
  readonly jobId: string;
  readonly provider: string;
  readonly shopifyProductId: string;
  /** URL-safe slug Shopify assigned — `handle` in `https://{storeDomain}/products/{handle}`. */
  readonly handle: string;
  readonly createdAt: string; // ISO 8601
  readonly metadata: Record<string, unknown>;
}

export interface ShopifyVerifyResult {
  readonly shopifyProductId: string;
  readonly isLive: boolean;
  readonly status: string;
}

export interface ShopifyProductVariant {
  readonly id: string;
  readonly price: number;
}

/** Full product state as Shopify actually has it recorded — for verifying a publish, not just confirming it's live. */
export interface ShopifyProductDetails {
  readonly shopifyProductId: string;
  readonly title: string;
  readonly descriptionHtml: string;
  readonly handle: string;
  readonly status: string;
  readonly tags: readonly string[];
  readonly productType: string;
  readonly imageUrls: readonly string[];
  readonly variants: readonly ShopifyProductVariant[];
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  /** Titles of every collection (custom or smart) this product currently belongs to. */
  readonly collections: readonly string[];
}

/**
 * One replacement image, already in its final gallery position.
 * `src` is fetched by Shopify itself (external URL, e.g. a Printify
 * mockup URL) — no download/base64 step needed on our side.
 */
export interface ShopifyReplacementImage {
  readonly src: string;
  readonly altText: string;
  /** 1-based position in the gallery — position 1 becomes the featured/hero image. */
  readonly position: number;
}

export interface ShopifyReplaceImagesRequest {
  readonly jobId: string;
  /** The existing Shopify product id whose gallery is being replaced — never create a new product. */
  readonly shopifyProductId: string;
  /** Full desired gallery, in final order. Every image in this list is added; every image not in this list that currently exists on the product is removed. */
  readonly images: readonly ShopifyReplacementImage[];
}

export interface ShopifyReplaceImagesResult {
  readonly jobId: string;
  readonly shopifyProductId: string;
  readonly addedImageIds: readonly string[];
  readonly removedImageIds: readonly string[];
  readonly updatedAt: string; // ISO 8601
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
  /** Reads back everything about a published product — title, description, images, variants, collections, SEO, tags — for field-level verification. */
  getProduct(
    shopifyProductId: string,
  ): Promise<Result<ShopifyProductDetails, ExternalServiceError | ValidationError>>;
  /**
   * Replaces an existing product's entire image gallery in one call: adds
   * the new images in the given order (position 1 = featured image), then
   * removes every image that was on the product before and isn't in the
   * new list. Never creates a new product — title, handle, URL, variants,
   * SEO metafields, tags, and reviews are all untouched by this call.
   */
  replaceProductImages(
    request: ShopifyReplaceImagesRequest,
  ): Promise<Result<ShopifyReplaceImagesResult, ExternalServiceError | ValidationError>>;
}
