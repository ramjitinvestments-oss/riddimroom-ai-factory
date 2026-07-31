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
import type {
  ShopifyProvider,
  ShopifyPublishRequest,
  ShopifyPublishResult,
  ShopifyVerifyResult,
} from "./types.ts";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export interface ShopifyProviderOptions {
  readonly storeDomain: string;
  readonly accessToken: string;
  readonly apiVersion: string;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly logger?: Logger;
  /** Injectable fetch implementation, so tests never hit the real network. */
  readonly fetchImpl?: typeof fetch;
}

interface ShopifyProductResponseBody {
  readonly product?: { readonly id?: number | string; readonly status?: string };
}

export class ShopifyApiProvider implements ShopifyProvider {
  readonly name = "shopify";
  private readonly storeDomain: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ShopifyProviderOptions) {
    this.storeDomain = options.storeDomain;
    this.accessToken = options.accessToken;
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
      const productId = await jobLogger.time(
        "Publish Shopify",
        () =>
          withRetry(() => this.createProduct(request), {
            maxAttempts: this.maxAttempts,
            baseDelayMs: this.baseDelayMs,
            isRetryable,
          }),
        {},
      );

      return ok({
        jobId: request.jobId,
        provider: this.name,
        shopifyProductId: productId,
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

  private async createProduct(request: ShopifyPublishRequest): Promise<string> {
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
    if (id === undefined) {
      throw new ValidationError(["Shopify product creation response did not include a product id"]);
    }
    return String(id);
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

  private async request<TBody extends object>(
    method: "GET" | "POST",
    path: string,
    payload: unknown,
  ): Promise<TBody> {
    const url = `https://${this.storeDomain}/admin/api/${this.apiVersion}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          "X-Shopify-Access-Token": this.accessToken,
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
