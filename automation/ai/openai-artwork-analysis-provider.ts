/**
 * `ArtworkAnalysisProvider` implementation backed by OpenAI's Chat
 * Completions API, called directly via `fetch` (no SDK dependency) —
 * mirrors `./openai-product-copy-provider.ts`'s structure exactly. Sends
 * only the artwork image (no brief text — the artwork is the sole source
 * of truth) and uses structured outputs (`response_format: json_schema`)
 * so the response is guaranteed to match `ARTWORK_ANALYSIS_JSON_SCHEMA`.
 */
import { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import { ConsoleTransport } from "../shared/log-transport.ts";
import { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { withRetry } from "../shared/retry.ts";
import {
  ARTWORK_ANALYSIS_JSON_SCHEMA,
  buildArtworkAnalysisSystemPrompt,
  buildArtworkAnalysisUserPrompt,
} from "./artwork-analysis-prompt.ts";
import { validateArtworkAnalysis } from "./artwork-analysis-validation.ts";
import type {
  ArtworkAnalysis,
  ArtworkAnalysisProvider,
  ArtworkAnalysisRequest,
  ArtworkAnalysisResult,
} from "./artwork-analysis-types.ts";

const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export interface OpenAiArtworkAnalysisProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly logger?: Logger;
  /** Injectable fetch implementation, so tests never hit the real network. */
  readonly fetchImpl?: typeof fetch;
}

interface ChatCompletionResponseBody {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string };
  }>;
}

export class OpenAiArtworkAnalysisProvider implements ArtworkAnalysisProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiArtworkAnalysisProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.logger =
      options.logger ?? new Logger({ module: "automation/ai", transports: [new ConsoleTransport()] });
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async analyze(
    request: ArtworkAnalysisRequest,
  ): Promise<Result<ArtworkAnalysisResult, ExternalServiceError | ValidationError>> {
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }
    if (request.artworkPng.length === 0) {
      return err(new ValidationError(["artworkPng must not be empty"]));
    }

    const jobLogger = this.logger.withJob(request.jobId, "artwork-analysis");

    try {
      const analysis = await jobLogger.time(
        "Analyze Artwork",
        () =>
          withRetry(() => this.callOpenAi(request.artworkPng), {
            maxAttempts: this.maxAttempts,
            baseDelayMs: this.baseDelayMs,
            isRetryable,
          }),
        { model: this.model },
      );

      return ok({
        jobId: request.jobId,
        provider: this.name,
        model: this.model,
        generatedAt: new Date().toISOString(),
        analysis,
        metadata: {},
      });
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("openai", "artwork analysis failed", { cause: error }));
    }
  }

  private async callOpenAi(artworkPng: Buffer): Promise<ArtworkAnalysis> {
    const imageDataUrl = `data:image/png;base64,${artworkPng.toString("base64")}`;

    let response: Response;
    try {
      response = await this.fetchImpl(OPENAI_CHAT_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: buildArtworkAnalysisSystemPrompt() },
            {
              role: "user",
              content: [
                { type: "text", text: buildArtworkAnalysisUserPrompt() },
                { type: "image_url", image_url: { url: imageDataUrl } },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "artwork_analysis",
              schema: ARTWORK_ANALYSIS_JSON_SCHEMA,
              strict: true,
            },
          },
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

    let body: ChatCompletionResponseBody;
    try {
      body = (await response.json()) as ChatCompletionResponseBody;
    } catch {
      throw new ValidationError(["response body was not valid JSON"]);
    }

    const content = body.choices?.[0]?.message?.content;
    if (content === undefined || content.length === 0) {
      throw new ValidationError(["response did not include message content"]);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ValidationError(["message content was not valid JSON"]);
    }

    const validated = validateArtworkAnalysis(parsed);
    if (!validated.ok) {
      throw validated.error;
    }

    return validated.value;
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
