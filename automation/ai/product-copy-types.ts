/**
 * Provider interface for product listing copy generation. Pipeline code
 * (`scripts/generate-product-copy.ts`) depends only on `ProductCopyProvider`,
 * so a future text-generation backend plugs in without pipeline changes —
 * a new class implementing this interface, selected by
 * `createProductCopyProvider` (./create-product-copy-provider.ts).
 */
import type { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import type { Result } from "../shared/result.ts";

export interface ProductCopyRequest {
  /** Job this copy belongs to; carried through for traceability. */
  readonly jobId: string;
  /** The original design brief (from the job's metadata.json). */
  readonly brief: string;
  /** The generated print-ready artwork, so a vision-capable provider can describe what was actually produced. */
  readonly artworkPng: Buffer;
}

/** The listing fields a storefront (Printify/Shopify) needs for one product. */
export interface ProductCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly tags: readonly string[];
  readonly productType: string;
  readonly collection: string;
  /** USD. */
  readonly suggestedRetailPrice: number;
}

export interface ProductCopyResult {
  readonly jobId: string;
  readonly provider: string;
  readonly model: string;
  readonly generatedAt: string; // ISO 8601
  readonly copy: ProductCopy;
  readonly metadata: Record<string, unknown>;
}

export interface ProductCopyProvider {
  readonly name: string;
  generate(
    request: ProductCopyRequest,
  ): Promise<Result<ProductCopyResult, ExternalServiceError | ValidationError>>;
}
