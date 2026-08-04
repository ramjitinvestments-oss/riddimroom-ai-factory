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
  PrintifyUpdateRequest,
  PrintifyUpdateResult,
  PrintifyUploadRequest,
  PrintifyUploadResult,
} from "./types.ts";

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
}

interface UploadImageResponseBody {
  readonly id?: string;
}

interface CreateProductResponseBody {
  readonly id?: string;
  /** Printify auto-generates these on product creation; each has a rendered mockup image URL. */
  readonly images?: ReadonlyArray<{ readonly src?: string }>;
}

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

  private async request<TBody extends object>(
    path: string,
    payload: unknown,
    method: "POST" | "PUT" = "POST",
  ): Promise<TBody> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${PRINTIFY_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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
