/**
 * `ShopifyProvider` implementation backed by Shopify's Admin REST API,
 * called directly via `fetch` (no SDK dependency) — same shape as this
 * codebase's other real providers: retry transient failures, validate
 * every response.
 */
import { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import { ConsoleTransport } from "../shared/log-transport.ts";
import { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { withRetry } from "../shared/retry.ts";
import type { AccessTokenProvider } from "./client-credentials-token-provider.ts";
import type {
  ShopifyFinalizeExternalProductRequest,
  ShopifyFinalizeExternalProductResult,
  ShopifyProductDetails,
  ShopifyProductVariant,
  ShopifyProvider,
  ShopifyPublishRequest,
  ShopifyPublishResult,
  ShopifyReplaceImagesRequest,
  ShopifyReplaceImagesResult,
  ShopifyVerifyResult,
} from "./types.ts";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const SEO_TITLE_TAG_KEY = "title_tag";
const SEO_DESCRIPTION_TAG_KEY = "description_tag";
const SEO_NAMESPACE = "global";

export interface ShopifyProviderOptions {
  readonly storeDomain: string;
  /** Authentication layer: supplies a current Admin API access token on demand. */
  readonly tokenProvider: AccessTokenProvider;
  readonly apiVersion: string;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly logger?: Logger;
  /** Injectable fetch implementation, so tests never hit the real network. */
  readonly fetchImpl?: typeof fetch;
}

interface ShopifyProductResponseBody {
  readonly product?: {
    readonly id?: number | string;
    readonly status?: string;
    readonly handle?: string;
    readonly title?: string;
    readonly body_html?: string;
    readonly tags?: string;
    readonly product_type?: string;
    readonly images?: ReadonlyArray<{ readonly src?: string }>;
    readonly variants?: ReadonlyArray<{ readonly id?: number | string; readonly price?: string }>;
  };
}

interface MetafieldsResponseBody {
  readonly metafields?: ReadonlyArray<{
    readonly namespace?: string;
    readonly key?: string;
    readonly value?: string;
  }>;
}

interface CollectionResponseBody {
  readonly custom_collection?: { readonly id?: number | string; readonly title?: string };
}

interface CollectionsListResponseBody {
  readonly custom_collections?: ReadonlyArray<{ readonly id?: number | string; readonly title?: string }>;
}

interface CollectsListResponseBody {
  readonly collects?: ReadonlyArray<{ readonly collection_id?: number | string }>;
}

interface ImageResponseBody {
  readonly image?: { readonly id?: number | string };
}

interface ImagesListResponseBody {
  readonly images?: ReadonlyArray<{ readonly id?: number | string }>;
}

export class ShopifyApiProvider implements ShopifyProvider {
  readonly name = "shopify";
  private readonly storeDomain: string;
  private readonly tokenProvider: AccessTokenProvider;
  private readonly apiVersion: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ShopifyProviderOptions) {
    this.storeDomain = options.storeDomain;
    this.tokenProvider = options.tokenProvider;
    this.apiVersion = options.apiVersion;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.logger =
      options.logger ?? new Logger({ module: "automation/shopify", transports: [new ConsoleTransport()] });
    this.fetchImpl = options.fetchImpl ?? fetch;
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

    const jobLogger = this.logger.withJob(request.jobId, "publish-shopify");

    try {
      const { productId, handle } = await jobLogger.time(
        "Publish Shopify",
        () =>
          withRetry(() => this.createProduct(request), {
            maxAttempts: this.maxAttempts,
            baseDelayMs: this.baseDelayMs,
            isRetryable,
          }),
        {},
      );

      if (request.collection !== undefined && request.collection.trim().length > 0) {
        const collectionId = await withRetry(() => this.findOrCreateCollection(request.collection!), {
          maxAttempts: this.maxAttempts,
          baseDelayMs: this.baseDelayMs,
          isRetryable,
        });
        await withRetry(() => this.linkProductToCollection(productId, collectionId), {
          maxAttempts: this.maxAttempts,
          baseDelayMs: this.baseDelayMs,
          isRetryable,
        });
      }

      return ok({
        jobId: request.jobId,
        provider: this.name,
        shopifyProductId: productId,
        handle,
        createdAt: new Date().toISOString(),
        metadata: {},
      });
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("shopify", "product publish failed", { cause: error }));
    }
  }

  async verifyProductLive(
    shopifyProductId: string,
  ): Promise<Result<ShopifyVerifyResult, ExternalServiceError | ValidationError>> {
    if (shopifyProductId.trim().length === 0) {
      return err(new ValidationError(["shopifyProductId must not be blank"]));
    }

    try {
      const status = await withRetry(() => this.fetchProductStatus(shopifyProductId), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: this.baseDelayMs,
        isRetryable,
      });
      return ok({ shopifyProductId, isLive: status === "active", status });
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("shopify", "product verification failed", { cause: error }));
    }
  }

  /**
   * SEO metafields are set via a separate, dedicated call per field
   * *after* the product exists, not nested in the creation payload.
   * Observed in production: `POST /products.json` with two metafields
   * nested in the same request silently persisted only one of them (no
   * error, no partial-failure indication in the response) — a reliability
   * gap in bundling multiple metafield writes into one resource-creation
   * call. A dedicated `POST /products/{id}/metafields.json` per field goes
   * through this class's normal `request()` path, so a real failure on
   * either one surfaces as a thrown error like any other API call here,
   * instead of failing silently.
   */
  private async createProduct(request: ShopifyPublishRequest): Promise<{ productId: string; handle: string }> {
    const body = await this.request<ShopifyProductResponseBody>("POST", "/products.json", {
      product: {
        title: request.title,
        body_html: request.descriptionHtml,
        product_type: request.productType,
        tags: request.tags.join(", "),
        status: "active",
        images: [{ attachment: request.imagePng.toString("base64") }],
        variants: [{ price: request.priceUsd.toFixed(2) }],
      },
    });

    const id = body.product?.id;
    const handle = body.product?.handle;
    if (id === undefined || handle === undefined) {
      throw new ValidationError(["Shopify product creation response did not include a product id and handle"]);
    }
    const productId = String(id);

    if (request.seoTitle !== undefined) {
      await this.setMetafield(productId, SEO_TITLE_TAG_KEY, request.seoTitle, "single_line_text_field");
    }
    if (request.seoDescription !== undefined) {
      await this.setMetafield(productId, SEO_DESCRIPTION_TAG_KEY, request.seoDescription, "multi_line_text_field");
    }

    return { productId, handle };
  }

  private async setMetafield(productId: string, key: string, value: string, type: string): Promise<void> {
    await this.request<object>("POST", `/products/${productId}/metafields.json`, {
      metafield: { namespace: SEO_NAMESPACE, key, value, type },
    });
  }

  private async fetchProductStatus(productId: string): Promise<string> {
    const body = await this.request<ShopifyProductResponseBody>(
      "GET",
      `/products/${productId}.json`,
      undefined,
    );
    const status = body.product?.status;
    if (status === undefined) {
      throw new ValidationError(["Shopify product lookup response did not include a status"]);
    }
    return status;
  }

  /** Finds a custom collection by exact title, creating it if none exists yet. Returns its id. */
  private async findOrCreateCollection(title: string): Promise<string> {
    const existing = await this.request<CollectionsListResponseBody>(
      "GET",
      `/custom_collections.json?title=${encodeURIComponent(title)}`,
      undefined,
    );
    const found = (existing.custom_collections ?? []).find((c) => c.title === title);
    if (found?.id !== undefined) {
      return String(found.id);
    }

    const created = await this.request<CollectionResponseBody>("POST", "/custom_collections.json", {
      custom_collection: { title },
    });
    const id = created.custom_collection?.id;
    if (id === undefined) {
      throw new ValidationError(["Shopify collection creation response did not include a collection id"]);
    }
    return String(id);
  }

  private async linkProductToCollection(productId: string, collectionId: string): Promise<void> {
    await this.request<object>("POST", "/collects.json", {
      collect: { product_id: Number(productId), collection_id: Number(collectionId) },
    });
  }

  async getProduct(
    shopifyProductId: string,
  ): Promise<Result<ShopifyProductDetails, ExternalServiceError | ValidationError>> {
    if (shopifyProductId.trim().length === 0) {
      return err(new ValidationError(["shopifyProductId must not be blank"]));
    }

    try {
      const details = await withRetry(() => this.fetchProductDetails(shopifyProductId), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: this.baseDelayMs,
        isRetryable,
      });
      return ok(details);
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("shopify", "product lookup failed", { cause: error }));
    }
  }

  private async fetchProductDetails(productId: string): Promise<ShopifyProductDetails> {
    const productBody = await this.request<ShopifyProductResponseBody>(
      "GET",
      `/products/${productId}.json`,
      undefined,
    );
    const product = productBody.product;
    if (
      product?.id === undefined ||
      product.title === undefined ||
      product.handle === undefined ||
      product.status === undefined
    ) {
      throw new ValidationError(["Shopify product lookup response was missing required fields"]);
    }

    const metafieldsBody = await this.request<MetafieldsResponseBody>(
      "GET",
      `/products/${productId}/metafields.json?namespace=${SEO_NAMESPACE}`,
      undefined,
    );
    const metafields = metafieldsBody.metafields ?? [];
    const seoTitle = metafields.find((m) => m.key === SEO_TITLE_TAG_KEY)?.value ?? null;
    const seoDescription = metafields.find((m) => m.key === SEO_DESCRIPTION_TAG_KEY)?.value ?? null;

    const collectsBody = await this.request<CollectsListResponseBody>(
      "GET",
      `/collects.json?product_id=${productId}`,
      undefined,
    );
    const collectionIds = (collectsBody.collects ?? [])
      .map((c) => c.collection_id)
      .filter((id): id is number | string => id !== undefined);

    const collections: string[] = [];
    for (const collectionId of collectionIds) {
      const collectionBody = await this.request<CollectionResponseBody>(
        "GET",
        `/custom_collections/${collectionId}.json`,
        undefined,
      );
      if (collectionBody.custom_collection?.title !== undefined) {
        collections.push(collectionBody.custom_collection.title);
      }
    }

    const variants: ShopifyProductVariant[] = (product.variants ?? [])
      .filter((v): v is { id: number | string; price: string } => v.id !== undefined && v.price !== undefined)
      .map((v) => ({ id: String(v.id), price: Number.parseFloat(v.price) }));

    const imageUrls = (product.images ?? [])
      .map((image) => image.src)
      .filter((src): src is string => typeof src === "string" && src.length > 0);

    return {
      shopifyProductId: String(product.id),
      title: product.title,
      descriptionHtml: product.body_html ?? "",
      handle: product.handle,
      status: product.status,
      tags: product.tags !== undefined && product.tags.length > 0 ? product.tags.split(",").map((t) => t.trim()) : [],
      productType: product.product_type ?? "",
      imageUrls,
      variants,
      seoTitle,
      seoDescription,
      collections,
    };
  }

  /**
   * Replaces a product's entire image gallery in one call, in the given
   * final order. Adds first, then removes — a product is never left with
   * zero images mid-call even if a later add in the batch fails (it just
   * stops there, per this codebase's production-safe error handling; the
   * old images stay in place until every new one is confirmed added).
   * `position` on Shopify's REST Product Image resource is exactly the
   * 1-based gallery order — position 1 is the featured image used
   * everywhere a single image represents the product (collection cards,
   * homepage cards, search results, cart, Open Graph, structured data all
   * read the featured image, so getting position 1 right here is what
   * fixes every one of those surfaces at once).
   */
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

    const jobLogger = this.logger.withJob(request.jobId, "replace-shopify-images");

    try {
      const beforeIds = await withRetry(() => this.listProductImageIds(request.shopifyProductId), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: this.baseDelayMs,
        isRetryable,
      });

      const addedImageIds: string[] = [];
      for (const image of [...request.images].sort((a, b) => a.position - b.position)) {
        const newId = await withRetry(
          () => this.addProductImage(request.shopifyProductId, image.src, image.altText, image.position),
          { maxAttempts: this.maxAttempts, baseDelayMs: this.baseDelayMs, isRetryable },
        );
        addedImageIds.push(newId);
      }

      const removedImageIds: string[] = [];
      for (const oldId of beforeIds) {
        await withRetry(() => this.deleteProductImage(request.shopifyProductId, oldId), {
          maxAttempts: this.maxAttempts,
          baseDelayMs: this.baseDelayMs,
          isRetryable,
        });
        removedImageIds.push(oldId);
      }

      jobLogger.info("Replaced Shopify product image gallery", {
        metadata: { shopifyProductId: request.shopifyProductId, added: addedImageIds.length, removed: removedImageIds.length },
      });

      return ok({
        jobId: request.jobId,
        shopifyProductId: request.shopifyProductId,
        addedImageIds,
        removedImageIds,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("shopify", "image gallery replacement failed", { cause: error }));
    }
  }

  /**
   * Sets tags, SEO metafields, and collection assignment on a product this
   * provider did not create — used for the Printify-native publish path
   * (see `ShopifyFinalizeExternalProductRequest`'s doc comment). Reuses
   * exactly the same private helpers (`setMetafield`,
   * `findOrCreateCollection`, `linkProductToCollection`) `publishProduct`
   * already relies on for the same fields, just aimed at an id this class
   * didn't itself generate.
   */
  async finalizeExternalProduct(
    request: ShopifyFinalizeExternalProductRequest,
  ): Promise<Result<ShopifyFinalizeExternalProductResult, ExternalServiceError | ValidationError>> {
    if (request.shopifyProductId.trim().length === 0) {
      return err(new ValidationError(["shopifyProductId must not be blank"]));
    }
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }

    const jobLogger = this.logger.withJob(request.jobId, "finalize-external-shopify-product");

    try {
      await jobLogger.time(
        "Finalize externally-published Shopify product",
        () => this.callFinalizeExternalProduct(request),
        { shopifyProductId: request.shopifyProductId },
      );

      return ok({
        jobId: request.jobId,
        shopifyProductId: request.shopifyProductId,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("shopify", "finalizing externally-published product failed", { cause: error }));
    }
  }

  private async callFinalizeExternalProduct(request: ShopifyFinalizeExternalProductRequest): Promise<void> {
    await withRetry(() => this.setTags(request.shopifyProductId, request.tags), {
      maxAttempts: this.maxAttempts,
      baseDelayMs: this.baseDelayMs,
      isRetryable,
    });

    if (request.seoTitle !== undefined) {
      await withRetry(() => this.setMetafield(request.shopifyProductId, SEO_TITLE_TAG_KEY, request.seoTitle!, "single_line_text_field"), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: this.baseDelayMs,
        isRetryable,
      });
    }
    if (request.seoDescription !== undefined) {
      await withRetry(
        () => this.setMetafield(request.shopifyProductId, SEO_DESCRIPTION_TAG_KEY, request.seoDescription!, "multi_line_text_field"),
        { maxAttempts: this.maxAttempts, baseDelayMs: this.baseDelayMs, isRetryable },
      );
    }
    if (request.collection !== undefined && request.collection.trim().length > 0) {
      const collectionId = await withRetry(() => this.findOrCreateCollection(request.collection!), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: this.baseDelayMs,
        isRetryable,
      });
      await withRetry(() => this.linkProductToCollection(request.shopifyProductId, collectionId), {
        maxAttempts: this.maxAttempts,
        baseDelayMs: this.baseDelayMs,
        isRetryable,
      });
    }
  }

  private async setTags(productId: string, tags: readonly string[]): Promise<void> {
    await this.request<object>("PUT", `/products/${productId}.json`, {
      product: { id: Number(productId), tags: tags.join(", ") },
    });
  }

  private async listProductImageIds(productId: string): Promise<string[]> {
    const body = await this.request<ImagesListResponseBody>("GET", `/products/${productId}/images.json`, undefined);
    return (body.images ?? [])
      .map((image) => image.id)
      .filter((id): id is number | string => id !== undefined)
      .map((id) => String(id));
  }

  private async addProductImage(productId: string, src: string, altText: string, position: number): Promise<string> {
    const body = await this.request<ImageResponseBody>("POST", `/products/${productId}/images.json`, {
      image: { src, alt: altText, position },
    });
    const id = body.image?.id;
    if (id === undefined) {
      throw new ValidationError(["Shopify image creation response did not include an image id"]);
    }
    return String(id);
  }

  private async deleteProductImage(productId: string, imageId: string): Promise<void> {
    await this.request<object>("DELETE", `/products/${productId}/images/${imageId}.json`, undefined);
  }

  private async request<TBody extends object>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    payload: unknown,
  ): Promise<TBody> {
    const tokenResult = await this.tokenProvider.getToken();
    if (!tokenResult.ok) {
      throw tokenResult.error;
    }

    const url = `https://${this.storeDomain}/admin/api/${this.apiVersion}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          "X-Shopify-Access-Token": tokenResult.value,
          "Content-Type": "application/json",
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      });
    } catch (error) {
      throw new ExternalServiceError("shopify", "network request failed", { cause: error });
    }

    if (!response.ok) {
      const bodyText = await safeReadText(response);
      throw new ExternalServiceError("shopify", `request failed: ${response.status} ${bodyText}`, {
        statusCode: response.status,
      });
    }

    try {
      return (await response.json()) as TBody;
    } catch {
      throw new ValidationError(["response body was not valid JSON"]);
    }
  }
}

/** 429 (rate limited) and 5xx are worth retrying; a bare network failure (no status) is too. 4xx otherwise is not. */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ExternalServiceError)) {
    return false;
  }
  if (error.statusCode === undefined) {
    return true;
  }
  return error.statusCode === 429 || error.statusCode >= 500;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<no response body>";
  }
}
