/**
 * Stage 2 of the two-stage quality system: a real OpenAI vision call that
 * scores an already-Stage-1-passed asset against the premium-commercial
 * rubric. Mirrors `../openai-product-copy-provider.ts`'s structure
 * (vision input + `response_format: json_schema` structured output).
 *
 * This class only does the scoring call itself and records its own actual
 * spend; the decision of *whether* to call it at all (Stage 1 passed, and
 * publish-candidate/premium-review/low-confidence, and budget available)
 * belongs to the caller — see `./composite-quality-provider.ts`.
 */
import { ExternalServiceError, ValidationError } from "../../shared/errors.ts";
import { ConsoleTransport } from "../../shared/log-transport.ts";
import { Logger } from "../../shared/logger.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import { withRetry } from "../../shared/retry.ts";
import { estimateCostUsd, type VisionSpendLedger, type VisionUsage } from "./vision-budget.ts";
import { buildVisionSystemPrompt, buildVisionUserPrompt, VISION_SCORE_JSON_SCHEMA, type VisionPromptContext } from "./vision-prompt.ts";
import { validateVisionScore } from "./vision-validation.ts";
import type { VisionScore, VisionScorer } from "./types.ts";

const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export interface VisionQualityProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly logger?: Logger;
  readonly fetchImpl?: typeof fetch;
  /** If provided, actual estimated spend is recorded here after every successful call. */
  readonly ledger?: VisionSpendLedger;
}

interface ChatCompletionResponseBody {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

export class VisionQualityProvider implements VisionScorer {
  readonly name = "vision";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly ledger: VisionSpendLedger | undefined;

  constructor(options: VisionQualityProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.logger =
      options.logger ?? new Logger({ module: "automation/ai/quality", transports: [new ConsoleTransport()] });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.ledger = options.ledger;
  }

  async score(
    imageBuffer: Buffer,
    context: VisionPromptContext = {},
  ): Promise<Result<VisionScore, ExternalServiceError | ValidationError>> {
    if (imageBuffer.length === 0) {
      return err(new ValidationError(["imageBuffer must not be empty"]));
    }

    try {
      const { score, usage } = await this.logger.time(
        "Vision Quality Score",
        () =>
          withRetry(() => this.callOpenAi(imageBuffer, context), {
            maxAttempts: this.maxAttempts,
            baseDelayMs: this.baseDelayMs,
            isRetryable,
          }),
        { model: this.model },
      );

      if (this.ledger !== undefined) {
        this.ledger.recordSpend(estimateCostUsd(usage));
      }

      return ok(score);
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) {
        return err(error);
      }
      return err(new ExternalServiceError("openai", "vision quality scoring failed", { cause: error }));
    }
  }

  private async callOpenAi(
    imageBuffer: Buffer,
    context: VisionPromptContext,
  ): Promise<{ score: VisionScore; usage: VisionUsage }> {
    const imageDataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`;

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
            { role: "system", content: buildVisionSystemPrompt() },
            {
              role: "user",
              content: [
                { type: "text", text: buildVisionUserPrompt(context) },
                { type: "image_url", image_url: { url: imageDataUrl } },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "vision_quality_score", schema: VISION_SCORE_JSON_SCHEMA, strict: true },
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

    const validated = validateVisionScore(parsed);
    if (!validated.ok) {
      throw validated.error;
    }

    return {
      score: validated.value,
      usage: {
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
      },
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
