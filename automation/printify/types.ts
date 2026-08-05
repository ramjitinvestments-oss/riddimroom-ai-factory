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
  /** Mockup image URLs Printify generates automatically as part of product creation. */
  readonly mockupUrls: readonly string[];
  readonly metadata: Record<string, unknown>;
}

/**
 * Regenerates an *existing* Printify product's variants and print
 * placement — never creates a new product. Used for the "reprint this
 * design on a different garment color / fix the placement" case, as
 * opposed to `uploadProduct`'s "this design has never been on Printify
 * before" case. Printify's own artwork upload is reused unchanged
 * (`printifyImageId`) — this never re-uploads or resizes the artwork
 * file, only changes which variants (colors/sizes) it's printed on and
 * where on the print area it's placed.
 */
export interface PrintifyUpdateRequest {
  readonly jobId: string;
  /** The existing Printify product id to update — never create a new one. */
  readonly printifyProductId: string;
  /** The already-uploaded artwork image id to reuse — never re-uploaded, never resized. */
  readonly printifyImageId: string;
  readonly title: string;
  readonly description: string;
  /** Retail price in USD, from the job's product.json. */
  readonly priceUsd: number;
  /** The variant ids (sizes x color) this product should offer after the update — e.g. the black-only variant set. */
  readonly variantIds: readonly number[];
}

export interface PrintifyUpdateResult {
  readonly jobId: string;
  readonly provider: string;
  readonly printifyProductId: string;
  readonly updatedAt: string; // ISO 8601
  /** Freshly regenerated mockup image URLs, one set per variant, each URL's query string carrying `camera_label` (e.g. `?camera_label=front-2`). */
  readonly mockupUrls: readonly string[];
}

/**
 * Publishes an *existing* Printify product to the Printify shop's
 * connected sales channel (a real, OAuth-linked Shopify store — see
 * `PRINTIFY_SHOP_ID`'s doc comment in `.env.example`). This is Printify's
 * own native integration: Printify creates the Shopify product itself,
 * with the full size/color variant matrix and Printify fulfillment
 * already wired to each Shopify variant. This is deliberately different
 * from (and replaces, for the create path) building a Shopify product
 * directly via the Shopify Admin API — a hand-built product has no
 * Printify fulfillment link and, in practice, ends up as a single
 * generic variant instead of the real size/color matrix (confirmed in
 * production 2026-08-05: every design published through the old
 * `scripts/publish-to-shopify.ts` path came out as one "Default Title"
 * variant with 0 inventory, not sellable).
 */
export interface PrintifyPublishRequest {
  readonly jobId: string;
  readonly printifyProductId: string;
  /**
   * How long to keep polling for Printify to finish creating the Shopify
   * product before giving up (Printify's publish call itself only
   * *starts* the process — see `pollIntervalMs`). Defaults to 60000 (60s).
   */
  readonly maxWaitMs?: number;
  /** How often to poll while waiting. Defaults to 3000 (3s). */
  readonly pollIntervalMs?: number;
}

export interface PrintifyPublishResult {
  readonly jobId: string;
  readonly provider: string;
  readonly printifyProductId: string;
  /** The Shopify product id Printify's own integration created — this shop's real, fulfillment-linked product. */
  readonly shopifyProductId: string;
  /** Shopify handle Printify's integration assigned, if it reported one. */
  readonly shopifyHandle: string | null;
  readonly publishedAt: string; // ISO 8601
}

export interface PrintifyProvider {
  readonly name: string;
  uploadProduct(
    request: PrintifyUploadRequest,
  ): Promise<Result<PrintifyUploadResult, ExternalServiceError | ValidationError>>;
  /**
   * Finds an existing Printify product by exact (case-insensitive) title
   * match, paging through GET /shops/{shopId}/products.json until found or
   * exhausted. Returns `null` (not an error) when nothing matches. Exists
   * for one-off remediation/lookup scripts — e.g. recovering a
   * `printifyProductId` that was never persisted locally (see the
   * 2026-08-05 production incident where GitHub Actions runs never
   * committed `designs/processed/*.printify.json`) — not used by the
   * regular pipeline, which always already has the id on file.
   */
  findProductIdByTitle(title: string): Promise<Result<string | null, ExternalServiceError | ValidationError>>;
  /** Updates variants/placement on an existing product and returns the newly regenerated mockups. Never creates a duplicate product. */
  updateProductColorAndPlacement(
    request: PrintifyUpdateRequest,
  ): Promise<Result<PrintifyUpdateResult, ExternalServiceError | ValidationError>>;
  /**
   * Publishes an existing Printify product to the shop's connected Shopify
   * store via Printify's own integration, and waits (polling) until
   * Printify reports the resulting Shopify product id. See
   * `PrintifyPublishRequest`'s doc comment for why this exists instead of
   * building the Shopify product directly.
   */
  publishProductToShopify(
    request: PrintifyPublishRequest,
  ): Promise<Result<PrintifyPublishResult, ExternalServiceError | ValidationError>>;
}
