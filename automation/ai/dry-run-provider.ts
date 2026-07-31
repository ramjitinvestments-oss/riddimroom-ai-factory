/**
 * Dry-run implementation of `ImageGenerationProvider`. Produces a real,
 * valid, decodable PNG and realistic metadata without making any network
 * call — so the rest of the pipeline can be built and tested end to end
 * before real credentials exist. Selected automatically by
 * `createImageProvider` when `DRY_RUN` is true (the default).
 */
import { buildTShirtPrompt } from "./prompt.ts";
import { createSolidPng } from "./png.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { ValidationError, type ExternalServiceError } from "../shared/errors.ts";
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageSize,
} from "./types.ts";

const SIZE_DIMENSIONS: Record<ImageSize, { width: number; height: number }> = {
  "1024x1024": { width: 1024, height: 1024 },
  "1024x1536": { width: 1024, height: 1536 },
  "1536x1024": { width: 1536, height: 1024 },
};

/** A muted teal, distinct enough from pure black/white to be visibly a placeholder. */
const PLACEHOLDER_COLOR = { r: 20, g: 120, b: 130, a: 255 };

export interface DryRunImageProviderOptions {
  readonly now?: () => Date;
}

export class DryRunImageProvider implements ImageGenerationProvider {
  readonly name = "dry-run";
  private readonly now: () => Date;

  constructor(options: DryRunImageProviderOptions = {}) {
    this.now = options.now ?? ((): Date => new Date());
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

    const dimensions = SIZE_DIMENSIONS[request.size ?? "1024x1024"];
    const prompt = buildTShirtPrompt(request.prompt);
    const imageBuffer = createSolidPng(dimensions.width, dimensions.height, PLACEHOLDER_COLOR);

    return ok({
      jobId: request.jobId,
      provider: this.name,
      model: "dry-run-placeholder",
      prompt,
      imageBuffer,
      width: dimensions.width,
      height: dimensions.height,
      generatedAt: this.now().toISOString(),
      metadata: { dryRun: true, requestedSize: request.size ?? "1024x1024" },
    });
  }
}
