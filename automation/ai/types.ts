/**
 * Provider interface for AI image generation. `OpenAiImageProvider` and
 * `DryRunImageProvider` (in this same directory) both implement this
 * interface; the pipeline is written against `ImageGenerationProvider`
 * only, so a future provider (Google Imagen, Flux, ...) plugs in without
 * changing any pipeline code — just a new class implementing this
 * interface, selected by `createImageProvider` (./create-image-provider.ts).
 */
import type { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import type { Result } from "../shared/result.ts";

/** Supported output dimensions, matching what current providers can produce. */
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export interface ImageGenerationRequest {
  /** Job this generation belongs to; carried through into the result for traceability. */
  readonly jobId: string;
  /** The design brief, before any style/safety augmentation. */
  readonly prompt: string;
  /** Defaults to "1024x1024" (square) if omitted. */
  readonly size?: ImageSize;
}

export interface ImageGenerationResult {
  readonly jobId: string;
  /** Name of the provider that produced this result, e.g. "openai", "dry-run". */
  readonly provider: string;
  readonly model: string;
  /** The exact prompt sent to the provider, after style/safety augmentation. */
  readonly prompt: string;
  readonly imageBuffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly generatedAt: string; // ISO 8601
  /** Provider-specific extras (e.g. a revised prompt the provider reports back). */
  readonly metadata: Record<string, unknown>;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generate(
    request: ImageGenerationRequest,
  ): Promise<Result<ImageGenerationResult, ExternalServiceError | ValidationError>>;
}
