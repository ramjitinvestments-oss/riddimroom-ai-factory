/**
 * Provider interface for artwork-driven analysis + product listing copy.
 * Mirrors `./product-copy-types.ts`'s shape (request/result/provider), but
 * for a different input: no design brief, ever — the artwork image is the
 * only input, per "the artwork is now the source of truth." A future
 * analysis backend plugs in the same way a future copy backend would — a
 * new class implementing `ArtworkAnalysisProvider`, selected by
 * `createArtworkAnalysisProvider` (./create-artwork-analysis-provider.ts).
 */
import type { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import type { Result } from "../shared/result.ts";

export interface ArtworkAnalysisRequest {
  /** Job this analysis belongs to; carried through for traceability. */
  readonly jobId: string;
  /** The supplied artwork — the sole source of truth for every field below. */
  readonly artworkPng: Buffer;
}

/** What analyzing the artwork determines, before any listing copy is written. */
export interface ArtworkClassification {
  /** A real id from the Collection Library (../collections/library.ts) — never a freely-invented name. */
  readonly collectionId: string;
  /** A real id from the Style Library (../styles/library.ts) — never a freely-invented name. */
  readonly styleId: string;
  readonly theme: string;
  readonly keywords: readonly string[];
}

/** The listing fields a storefront (Printify/Shopify) needs for one product. */
export interface ArtworkCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
  /** Always 10-15 entries — see ./artwork-analysis-validation.ts. */
  readonly tags: readonly string[];
}

export interface ArtworkAnalysis {
  readonly classification: ArtworkClassification;
  readonly copy: ArtworkCopy;
}

export interface ArtworkAnalysisResult {
  readonly jobId: string;
  readonly provider: string;
  readonly model: string;
  readonly generatedAt: string; // ISO 8601
  readonly analysis: ArtworkAnalysis;
  readonly metadata: Record<string, unknown>;
}

export interface ArtworkAnalysisProvider {
  readonly name: string;
  analyze(
    request: ArtworkAnalysisRequest,
  ): Promise<Result<ArtworkAnalysisResult, ExternalServiceError | ValidationError>>;
}
