/**
 * Dry-run implementation of `ShopifyProvider`. No network call —
 * produces a realistic, deterministic fake product id, and
 * `verifyProductLive` always reports success, so the batch
 * publish/verify orchestration can be built and tested before any
 * Shopify credentials exist. Selected automatically by
 * `createShopifyProvider` when `DRY_RUN` is true.
 *
 * Keeps an in-memory record of what `publishProduct()` was asked to
 * create, so `getProduct()` can echo it back faithfully — real
 * verification logic (title/description/images/variants/collections/
 * SEO/tags/price all matching what was published) can be exercised in
 * tests without any real Shopify store, not just always-pass placeholder
 * data. The record only lives for this process's lifetime, same as every
 * other dry-run provider's "no real backing store" contract.
 */
import { ValidationError, type ExternalServiceError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type {
  ShopifyFinalizeExternalProductRequest,
  ShopifyFinalizeExternalProductResult,
  ShopifyProductDetails,
  ShopifyProvider,
  ShopifyPublishRequest,
  ShopifyPublishResult,
  ShopifyReplaceImagesRequest,
  ShopifyReplaceImagesResult,
  ShopifyVerifyResult,
} from "./types.ts";

export interface DryRunShopifyProviderOptions {
  readonly now?: () => Date;
}

export class DryRunShopifyProvider implements ShopifyProvider {
  readonly name = "dry-run";
  private readonly now: () => Date;
  private readonly published = new Map<string, ShopifyPublishRequest & { handle: string; nativelyPublished?: boolean }>();

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

    const shopifyProductId = `dry-run-product-${request.jobId}`;
    const handle = slugify(request.title);
    this.published.set(shopifyProductId, { ...request, handle });

    return ok({
      jobId: request.jobId,
      provider: this.name,
      shopifyProductId,
      handle,
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

  async getProduct(
    shopifyProductId: string,
  ): Promise<Result<ShopifyProductDetails, ExternalServiceError | ValidationError>> {
    if (shopifyProductId.trim().length === 0) {
      return err(new ValidationError(["shopifyProductId must not be blank"]));
    }

    const record = this.published.get(shopifyProductId);
    if (record === undefined) {
      return err(new ValidationError([`no dry-run product recorded for id "${shopifyProductId}"`]));
    }

    return ok({
      shopifyProductId,
      title: record.title,
      descriptionHtml: record.descriptionHtml,
      handle: record.handle,
      status: "active",
      tags: record.tags,
      productType: record.productType,
      imageUrls: [`https://dry-run.example/${record.handle}.png`],
      // A record finalizeExternalProduct upserted from scratch (no prior
      // publishProduct() call) stands in for Printify's native publish
      // integration, which always creates a full size matrix — echo that
      // back as more than one variant so verification checks relying on
      // "more than one real variant" (the actual bug this integration
      // fixes) can be exercised truthfully in dry-run too.
      variants: record.nativelyPublished
        ? [
            { id: `dry-run-variant-${record.jobId}-s`, price: record.priceUsd },
            { id: `dry-run-variant-${record.jobId}-m`, price: record.priceUsd },
            { id: `dry-run-variant-${record.jobId}-l`, price: record.priceUsd },
          ]
        : [{ id: `dry-run-variant-${record.jobId}`, price: record.priceUsd }],
      seoTitle: record.seoTitle ?? null,
      seoDescription: record.seoDescription ?? null,
      collections: record.collection !== undefined ? [record.collection] : [],
    });
  }

  async replaceProductImages(
    request: ShopifyReplaceImagesRequest,
  ): Promise<Result<ShopifyReplaceImagesResult, ExternalServiceError | ValidationError>> {
    if (request.shopifyProductId.trim().length === 0) {
      return err(new ValidationError(["shopifyProductId must not be blank"]));
    }
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }
    if (request.images.length === 0) {
      return err(new ValidationError(["at least one replacement image is required"]));
    }

    return ok({
      jobId: request.jobId,
      shopifyProductId: request.shopifyProductId,
      addedImageIds: request.images.map((_, i) => `dry-run-image-${request.jobId}-${i}`),
      removedImageIds: [],
      updatedAt: this.now().toISOString(),
    });
  }

  async finalizeExternalProduct(
    request: ShopifyFinalizeExternalProductRequest,
  ): Promise<Result<ShopifyFinalizeExternalProductResult, ExternalServiceError | ValidationError>> {
    if (request.shopifyProductId.trim().length === 0) {
      return err(new ValidationError(["shopifyProductId must not be blank"]));
    }
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }

    // Unlike publishProduct's records, a product being finalized here may
    // have been created by a *different* dry-run provider (Printify's
    // publishProductToShopify — see automation/printify/dry-run-provider.ts)
    // rather than by this provider's own publishProduct(). If nothing is on
    // file yet, upsert a synthetic record instead of silently no-op'ing, so
    // a later getProduct() can still echo back what finalizeExternalProduct
    // was asked to set — same "no real network call, but internally
    // consistent" contract every other dry-run provider gives.
    // `nativelyPublished: true` marks records created this way so
    // getProduct() can report a real multi-variant matrix instead of the
    // single-variant echo publishProduct() records use — dry-run stands in
    // for Printify's native integration, whose entire point is creating the
    // full size/color variant matrix, not a lone "Default Title" variant.
    const existing = this.published.get(request.shopifyProductId);
    const base =
      existing ??
      {
        jobId: request.jobId,
        title: `Dry-run externally published product (${request.shopifyProductId})`,
        descriptionHtml: "",
        tags: [] as readonly string[],
        productType: "T-Shirt",
        priceUsd: 0,
        imagePng: Buffer.alloc(0),
        handle: slugify(request.shopifyProductId),
        nativelyPublished: true,
      };
    this.published.set(request.shopifyProductId, {
      ...base,
      tags: request.tags,
      ...(request.seoTitle !== undefined ? { seoTitle: request.seoTitle } : {}),
      ...(request.seoDescription !== undefined ? { seoDescription: request.seoDescription } : {}),
      ...(request.collection !== undefined ? { collection: request.collection } : {}),
    });

    return ok({
      jobId: request.jobId,
      shopifyProductId: request.shopifyProductId,
      updatedAt: this.now().toISOString(),
    });
  }
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "product";
}
