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
import type { PrintifyProvider, PrintifyUploadRequest, PrintifyUploadResult } from "./types.ts";

const PRINTIFY_API_BASE = "https://api.printify.com/v1";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

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
}

interface UploadImageResponseBody {
  readonly id?: string;
}

interface CreateProductResponseBody {
  readonly id?: string;
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
  ): Promise<{ productId: string; imageId: string }> {
    const imageId = await this.uploadImage(request);
    const productId = await this.createProduct(request, imageId);
    return { productId, imageId };
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

  private async createProduct(request: PrintifyUploadRequest, imageId: string): Promise<string> {
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
              images: [{ id: imageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }],
            },
          ],
        },
      ],
    });

    if (body.id === undefined || body.id.length === 0) {
      throw new ValidationError(["Printify product creation response did not include an id"]);
    }
    return body.id;
  }

  private async request<TBody extends object>(path: string, payload: unknown): Promise<TBody> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${PRINTIFY_API_BASE}${path}`, {
        method: "POST",
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
