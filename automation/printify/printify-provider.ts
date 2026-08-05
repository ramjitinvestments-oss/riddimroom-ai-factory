/**
 * `PrintifyProvider` implementation backed by the real Printify API,
 * called directly via `fetch` (no SDK dependency) — same shape as
 * `automation/ai`'s OpenAI providers: upload the image, create the
 * product, retry transient failures, validate every response.
 *
 * Printify's product-creation endpoint requires a blueprint id, print
 * provider id, and variant ids that are specific to the caller's
 * Printify catalog choices — there is no universal default. Rather than
 * hardcode a guess, these are required configuration
 * (PRINTIFY_BLUEPRINT_ID / PRINTIFY_PRINT_PROVIDER_ID /
 * PRINTIFY_VARIANT_IDS), supplied once the user has picked a real
 * product/provider in their Printify account.
 */
import { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import { ConsoleTransport } from "../shared/log-transport.ts";
import { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { withRetry } from "../shared/retry.ts";
import type {
  PrintifyProvider,
  PrintifyPublishRequest,
  PrintifyPublishResult,
  PrintifyUpdateRequest,
  PrintifyUpdateResult,
  PrintifyUploadRequest,
  PrintifyUploadResult,
} from "./types.ts";

const DEFAULT_PUBLISH_MAX_WAIT_MS = 60_000;
const DEFAULT_PUBLISH_POLL_INTERVAL_MS = 3_000;

const PRINTIFY_API_BASE = "https://api.printify.com/v1";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

/**
 * Front-print placement, as fractions of Printify's print area
 * (`x`/`y` = center of the image, `scale` = image width relative to the
 * print area's width; Printify's own convention — 0.5/0.5/1 is dead
 * center at full print-area width).
 *
 * Standard set 2026-08-02 from a reference mockup comparison
 * (RiddimRoom_Mockup_Positioning_Fix.png): the previous default (0.5/0.5/1)
 * placed designs centered on the torso (~3.5in below the collar, bottom of
 * design near mid-torso) — too low for a premium apparel look. The
 * corrected standard targets the upper chest (top of design ~1.5-2in below
 * the collar, bottom above mid-torso, print width ~11-12in on L/XL).
 *
 * These are *estimates* derived from that reference image's proportions,
 * not measured against this account's actual Printify blueprint print-area
 * dimensions — no live Printify Catalog API access was available to look
 * those up. Treat them as a starting point: verify against a real
 * generated mockup (e.g. the next live upload test) and adjust
 * PRINTIFY_PRINT_Y / PRINTIFY_PRINT_SCALE in .env if the rendered mockup
 * doesn't match the standard.
 */
const DEFAULT_PLACEMENT_X = 0.5;
const DEFAULT_PLACEMENT_Y = 0.35;
const DEFAULT_PLACEMENT_SCALE = 0.85;

export interface PrintifyProviderOptions {
  readonly apiKey: string;
  readonly shopId: string;
  readonly blueprintId: number;
  readonly printProviderId: number;
  readonly variantIds: readonly number[];
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly logger?: Logger;
  /** Injectable fetch implementation, so tests never hit the real network. */
  readonly fetchImpl?: typeof fetch;
  /** Horizontal center of the print, as a fraction of print-area width. Defaults to 0.5 (centered). */
  readonly placementX?: number;
  /** Vertical center of the print, as a fraction of print-area height. Defaults to the upper-chest standard above. */
  readonly placementY?: number;
  /** Print width, as a fraction of print-area width. Defaults to the upper-chest standard above. */
  readonly placementScale?: number;
  /** Injectable sleep implementation for publishProductToShopify's polling loop, so tests don't wait on real timers. */
  readonly sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable clock for publishProductToShopify's deadline check, so tests don't depend on real wall-clock time. Defaults to Date.now. */
  readonly nowImpl?: () => number;
}

interface UploadImageResponseBody {
  readonly id?: string;
}

interface CreateProductResponseBody {
  readonly id?: string;
  /** Printify auto-generates these on product creation; each has a rendered mockup image URL. */
  readonly images?: ReadonlyArray<{ readonly src?: string }>;
}

/** Response shape of GET /shops/{shopId}/products/{productId}.json — only the fields publishProductToShopify needs. */
interface GetProductResponseBody {
  readonly id?: string;
  readonly is_locked?: boolean;
  /** Populated by Printify once its integration finishes creating the product in the connected Shopify store. Null/absent until then. */
  readonly external?: { readonly id?: string; readonly handle?: string } | null;
}

/** Response shape of GET /shops/{shopId}/products.json — only the fields findProductIdByTitle needs. */
interface ListProductsResponseBody {
  readonly data?: ReadonlyArray<{ readonly id?: string; readonly title?: string }>;
  readonly last_page?: number;
}

const PRODUCT_LIST_PAGE_SIZE = 50;

export class PrintifyApiProvider implements PrintifyProvider {
  readonly name = "printify";
  private readonly apiKey: string;
  private readonly shopId: string;
  private readonly blueprintId: number;
  private readonly printProviderId: number;
  private readonly variantIds: readonly number[];
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly placementX: number;
  private readonly placementY: number;
  private readonly placementScale: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly nowImpl: () => number;

  constructor(options: PrintifyProviderOptions) {
    this.apiKey = options.apiKey;
    this.shopId = options.shopId;
    this.blueprintId = options.blueprintId;
    this.printProviderId = options.printProviderId;
    this.variantIds = options.variantIds;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.logger =
      options.logger ?? new Logger({ module: "automation/printify", transports: [new ConsoleTransport()] });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.placementX = options.placementX ?? DEFAULT_PLACEMENT_X;
    this.placementY = options.placementY ?? DEFAULT_PLACEMENT_Y;
    this.placementScale = options.placementScale ?? DEFAULT_PLACEMENT_SCALE;
    this.sleepImpl = options.sleepImpl ?? ((ms): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nowImpl = options.nowImpl ?? ((): number => Date.now());
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
    if (this.variantIds.length === 0) {
      return err(new ValidationError(["no Printify variant ids configured"]));
    }

    const jobLogger = this.logger.withJob(request.jobId, "upload-printify");

    try {
      const result = await jobLogger.time(
        "Upload Printify",
        () =>
          withRetry(() => this.callPrintify(request), {
            maxAttempts: this.maxAttempts,
            baseDelayMs: this.baseDelayMs,
            isRetryable,
          }),
        { blueprintId: this.blueprintId },
      );

      return ok({
        jobId: request.jobId,
        provider: this.name,
        printifyProductId: result.productId,
        printifyImageId: result.imageId,
        createdAt: new Date().toISOString(),
        mockupUrls: result.mockupUrls,
        metadata: {},
      });
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("printify", "product upload failed", { cause: error }));
    }
  }

  private async callPrintify(
    request: PrintifyUploadRequest,
  ): Promise<{ productId: string; imageId: string; mockupUrls: string[] }> {
    const imageId = await this.uploadImage(request);
    const { productId, mockupUrls } = await this.createProduct(request, imageId);
    return { productId, imageId, mockupUrls };
  }

  /**
   * Updates variants/print-area on an *existing* Printify product —
   * PUT /shops/{shopId}/products/{productId}.json, never
   * POST .../products.json (which would create a duplicate). Reuses the
   * already-uploaded artwork image id unchanged: no re-upload, no resize,
   * matching "maintain the approved artwork scale" / "never overwrite
   * approved artwork". Placement (x/y/scale) comes from this instance's
   * placementX/Y/Scale exactly as `uploadProduct` uses them — the
   * approved upper-chest standard, not recalculated here. Printify
   * regenerates every mockup image for the new variant set as part of
   * this call; the response's `images` carry the new mockup URLs the same
   * way product creation does.
   */
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

    const jobLogger = this.logger.withJob(request.jobId, "update-printify-product");

    try {
      const mockupUrls = await jobLogger.time(
        "Update Printify product",
        () =>
          withRetry(() => this.callUpdateProduct(request), {
            maxAttempts: this.maxAttempts,
            baseDelayMs: this.baseDelayMs,
            isRetryable,
          }),
        { printifyProductId: request.printifyProductId, variantIds: request.variantIds },
      );

      return ok({
        jobId: request.jobId,
        provider: this.name,
        printifyProductId: request.printifyProductId,
        updatedAt: new Date().toISOString(),
        mockupUrls,
      });
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("printify", "product update failed", { cause: error }));
    }
  }

  private async callUpdateProduct(request: PrintifyUpdateRequest): Promise<string[]> {
    const priceCents = Math.round(request.priceUsd * 100);
    const body = await this.request<CreateProductResponseBody>(
      `/shops/${this.shopId}/products/${request.printifyProductId}.json`,
      {
        title: request.title,
        description: request.description,
        blueprint_id: this.blueprintId,
        print_provider_id: this.printProviderId,
        variants: request.variantIds.map((id) => ({ id, price: priceCents, is_enabled: true })),
        print_areas: [
          {
            variant_ids: request.variantIds,
            placeholders: [
              {
                position: "front",
                images: [
                  {
                    id: request.printifyImageId,
                    x: this.placementX,
                    y: this.placementY,
                    scale: this.placementScale,
                    angle: 0,
                  },
                ],
              },
            ],
          },
        ],
      },
      "PUT",
    );

    return (body.images ?? [])
      .map((image) => image.src)
      .filter((src): src is string => typeof src === "string" && src.length > 0);
  }

  private async uploadImage(request: PrintifyUploadRequest): Promise<string> {
    const body = await this.request<UploadImageResponseBody>("/uploads/images.json", {
      file_name: `${request.jobId}.png`,
      contents: request.artworkPng.toString("base64"),
    });

    if (body.id === undefined || body.id.length === 0) {
      throw new ValidationError(["Printify image upload response did not include an id"]);
    }
    return body.id;
  }

  private async createProduct(
    request: PrintifyUploadRequest,
    imageId: string,
  ): Promise<{ productId: string; mockupUrls: string[] }> {
    const priceCents = Math.round(request.priceUsd * 100);
    const body = await this.request<CreateProductResponseBody>(`/shops/${this.shopId}/products.json`, {
      title: request.title,
      description: request.description,
      blueprint_id: this.blueprintId,
      print_provider_id: this.printProviderId,
      variants: this.variantIds.map((id) => ({ id, price: priceCents, is_enabled: true })),
      print_areas: [
        {
          variant_ids: this.variantIds,
          placeholders: [
            {
              position: "front",
              images: [{ id: imageId, x: this.placementX, y: this.placementY, scale: this.placementScale, angle: 0 }],
            },
          ],
        },
      ],
    });

    if (body.id === undefined || body.id.length === 0) {
      throw new ValidationError(["Printify product creation response did not include an id"]);
    }

    const mockupUrls = (body.images ?? [])
      .map((image) => image.src)
      .filter((src): src is string => typeof src === "string" && src.length > 0);

    return { productId: body.id, mockupUrls };
  }

  /**
   * Publishes an existing Printify product to this shop's connected
   * Shopify store via Printify's own integration (POST .../publish.json),
   * then polls GET .../{productId}.json until Printify reports the
   * resulting Shopify product id in the `external` field — that call only
   * *starts* Printify's side of the process, it doesn't return the new
   * Shopify product id synchronously. See the doc comment on
   * `PrintifyPublishRequest` (./types.ts) for why this exists.
   */
  async publishProductToShopify(
    request: PrintifyPublishRequest,
  ): Promise<Result<PrintifyPublishResult, ExternalServiceError | ValidationError>> {
    if (request.printifyProductId.trim().length === 0) {
      return err(new ValidationError(["printifyProductId must not be blank"]));
    }
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }

    const jobLogger = this.logger.withJob(request.jobId, "publish-printify-to-shopify");
    const maxWaitMs = request.maxWaitMs ?? DEFAULT_PUBLISH_MAX_WAIT_MS;
    const pollIntervalMs = request.pollIntervalMs ?? DEFAULT_PUBLISH_POLL_INTERVAL_MS;

    try {
      const result = await jobLogger.time(
        "Publish Printify product to Shopify",
        () => this.callPublishAndPoll(request.printifyProductId, maxWaitMs, pollIntervalMs),
        { printifyProductId: request.printifyProductId },
      );

      return ok({
        jobId: request.jobId,
        provider: this.name,
        printifyProductId: request.printifyProductId,
        shopifyProductId: result.shopifyProductId,
        shopifyHandle: result.shopifyHandle,
        publishedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("printify", "publish to Shopify failed", { cause: error }));
    }
  }

  private async callPublishAndPoll(
    printifyProductId: string,
    maxWaitMs: number,
    pollIntervalMs: number,
  ): Promise<{ shopifyProductId: string; shopifyHandle: string | null }> {
    // tags: false — the Printify product's own `tags` field is never set by uploadProduct()
    // (Printify's create-product API has no place for it in this codebase's request body), so
    // publishing tags:true would push an empty tag list to Shopify, wiping out the real
    // AI-generated tags. title/description ARE safe to publish: uploadProduct() sends the real
    // generated title/description as part of Printify product creation, so Printify already has
    // the correct values for those. Tags are set separately, directly on Shopify, by whatever
    // calls this method (see scripts/publish-printify-to-shopify.ts).
    await withRetry(
      () =>
        this.request<Record<string, never>>(
          `/shops/${this.shopId}/products/${printifyProductId}/publish.json`,
          { title: true, description: true, images: true, variants: true, tags: false },
        ),
      { maxAttempts: this.maxAttempts, baseDelayMs: this.baseDelayMs, isRetryable },
    );

    const deadline = this.nowImpl() + maxWaitMs;
    for (;;) {
      const product = await this.request<GetProductResponseBody>(
        `/shops/${this.shopId}/products/${printifyProductId}.json`,
        undefined,
        "GET",
      );

      const externalId = product.external?.id;
      if (externalId !== undefined && externalId.trim().length > 0) {
        return { shopifyProductId: externalId, shopifyHandle: product.external?.handle ?? null };
      }

      if (this.nowImpl() >= deadline) {
        throw new ExternalServiceError(
          "printify",
          `publish accepted but Printify had not reported a Shopify product id for "${printifyProductId}" ` +
            `after ${maxWaitMs}ms — it may still be processing; check the Printify dashboard before retrying, ` +
            `retrying now would risk publishing a second time`,
        );
      }

      await this.sleepImpl(pollIntervalMs);
    }
  }

  /** See the interface doc comment (./types.ts) for why this exists. */
  async findProductIdByTitle(
    title: string,
  ): Promise<Result<string | null, ExternalServiceError | ValidationError>> {
    if (title.trim().length === 0) {
      return err(new ValidationError(["title must not be blank"]));
    }

    try {
      const normalized = title.trim().toLowerCase();
      let page = 1;
      for (;;) {
        const body = await this.request<ListProductsResponseBody>(
          `/shops/${this.shopId}/products.json?page=${page}&limit=${PRODUCT_LIST_PAGE_SIZE}`,
          undefined,
          "GET",
        );
        const products = body.data ?? [];
        const match = products.find((p) => p.title?.trim().toLowerCase() === normalized);
        if (match?.id !== undefined && match.id.length > 0) {
          return ok(match.id);
        }
        const lastPage = body.last_page ?? page;
        if (products.length === 0 || page >= lastPage) {
          return ok(null);
        }
        page += 1;
      }
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("printify", "product list lookup failed", { cause: error }));
    }
  }

  private async request<TBody extends object>(
    path: string,
    payload: unknown,
    method: "POST" | "PUT" | "GET" = "POST",
  ): Promise<TBody> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${PRINTIFY_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(payload) }),
      });
    } catch (error) {
      throw new ExternalServiceError("printify", "network request failed", { cause: error });
    }

    if (!response.ok) {
      const bodyText = await safeReadText(response);
      throw new ExternalServiceError("printify", `request failed: ${response.status} ${bodyText}`, {
        statusCode: response.status,
      });
    }

    const bodyText = await safeReadText(response);
    if (bodyText.trim().length === 0) {
      // Some endpoints (e.g. POST .../publish.json, which only starts an async process
      // Printify's side) return a 200 with no body at all — not an error, just nothing to parse.
      return {} as TBody;
    }
    try {
      return JSON.parse(bodyText) as TBody;
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
