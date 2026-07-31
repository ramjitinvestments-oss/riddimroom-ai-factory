/**
 * `ImageGenerationProvider` implementation backed by OpenAI's Images API,
 * called directly via `fetch` (no `openai` SDK dependency). Retries
 * transient failures (429, 5xx, network errors) with exponential backoff;
 * validates the response is a real, well-formed PNG before returning it.
 */
import { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import { ConsoleTransport } from "../shared/log-transport.ts";
import { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { buildTShirtPrompt } from "./prompt.ts";
import { readPngDimensions } from "./png.ts";
import { withRetry } from "../shared/retry.ts";
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageSize,
} from "./types.ts";

const OPENAI_IMAGES_ENDPOINT = "https://api.openai.com/v1/images/generations";
const DEFAULT_MODEL = "gpt-image-1";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export interface OpenAiImageProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly logger?: Logger;
  /** Injectable fetch implementation, so tests never hit the real network. */
  readonly fetchImpl?: typeof fetch;
}

interface OpenAiImagesResponseBody {
  readonly data?: ReadonlyArray<{
    readonly b64_json?: string;
    readonly revised_prompt?: string;
  }>;
}

interface OpenAiCallResult {
  readonly imageBuffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly revisedPrompt?: string;
}

export class OpenAiImageProvider implements ImageGenerationProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiImageProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.logger =
      options.logger ?? new Logger({ module: "automation/ai", transports: [new ConsoleTransport()] });
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(
    request: ImageGenerationRequest,
  ): Promise<Result<ImageGenerationResult, ExternalServiceError | ValidationError>> {
    if (request.prompt.trim().length === 0) {
      return err(new ValidationError(["prompt must not be blank"]));
    }
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }

    const prompt = buildTShirtPrompt(request.prompt);
    const size = request.size ?? "1024x1024";
    const jobLogger = this.logger.withJob(request.jobId, "generate");

    try {
      const call = await jobLogger.time(
        "Generate Artwork",
        () =>
          withRetry(() => this.callOpenAi(prompt, size), {
            maxAttempts: this.maxAttempts,
            baseDelayMs: this.baseDelayMs,
            isRetryable,
          }),
        { model: this.model, size },
      );

      return ok({
        jobId: request.jobId,
        provider: this.name,
        model: this.model,
        prompt,
        imageBuffer: call.imageBuffer,
        width: call.width,
        height: call.height,
        generatedAt: new Date().toISOString(),
        metadata: { revisedPrompt: call.revisedPrompt ?? null, requestedSize: size },
      });
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("openai", "image generation failed", { cause: error }));
    }
  }

  private async callOpenAi(prompt: string, size: ImageSize): Promise<OpenAiCallResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(OPENAI_IMAGES_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          size,
          n: 1,
          background: "transparent",
        }),
      });
    } catch (error) {
      throw new ExternalServiceError("openai", "network request failed", { cause: error });
    }

    if (!response.ok) {
      const bodyText = await safeReadText(response);
      throw new ExternalServiceError("openai", `request failed: ${response.status} ${bodyText}`, {
        statusCode: response.status,
      });
    }

    let body: OpenAiImagesResponseBody;
    try {
      body = (await response.json()) as OpenAiImagesResponseBody;
    } catch {
      throw new ValidationError(["response body was not valid JSON"]);
    }

    const first = body.data?.[0];
    const base64 = first?.b64_json;
    if (base64 === undefined || base64.length === 0) {
      throw new ValidationError(["response did not include image data (b64_json)"]);
    }

    const imageBuffer = Buffer.from(base64, "base64");
    const dimensions = readPngDimensions(imageBuffer);
    if (!dimensions.ok) {
      throw dimensions.error;
    }

    return {
      imageBuffer,
      width: dimensions.value.width,
      height: dimensions.value.height,
      ...(first?.revised_prompt !== undefined ? { revisedPrompt: first.revised_prompt } : {}),
    };
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
