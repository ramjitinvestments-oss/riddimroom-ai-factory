/**
 * Dry-run implementation of `ProductCopyProvider`. Produces realistic,
 * fully-valid product copy (it's run through the same validator the real
 * provider's response is checked against) without any network call —
 * selected automatically by `createProductCopyProvider` when `DRY_RUN` is
 * true (the default).
 */
import { ExternalServiceError, ValidationError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { validateProductCopy } from "./product-copy-validation.ts";
import type { ProductCopyProvider, ProductCopyRequest, ProductCopyResult } from "./product-copy-types.ts";

export interface DryRunProductCopyProviderOptions {
  readonly now?: () => Date;
}

export class DryRunProductCopyProvider implements ProductCopyProvider {
  readonly name = "dry-run";
  private readonly now: () => Date;

  constructor(options: DryRunProductCopyProviderOptions = {}) {
    this.now = options.now ?? ((): Date => new Date());
  }

  async generate(
    request: ProductCopyRequest,
  ): Promise<Result<ProductCopyResult, ExternalServiceError | ValidationError>> {
    if (request.brief.trim().length === 0) {
      return err(new ValidationError(["brief must not be blank"]));
    }
    if (request.jobId.trim().length === 0) {
      return err(new ValidationError(["jobId must not be blank"]));
    }

    const subject = titleCase(request.brief);

    const candidate = {
      title: `${subject} Tee`,
      subtitle: "Caribbean Streetwear Collection",
      description:
        `Rep the islands wherever you go. This ${subject.toLowerCase()} design brings bold Caribbean ` +
        "energy to everyday streetwear, printed on a premium tee built for comfort and standout style. " +
        "A one-of-a-kind piece for anyone who carries island pride with them.",
      // Fixed suffixes below are sized so these stay within validateProductCopy's
      // limits (70 / 160 chars) for a typical subject; truncateAtWord is the
      // hard guarantee for whatever subject actually comes through.
      seoTitle: truncateAtWord(`${subject} Tee | Caribbean Streetwear`, 70),
      seoDescription: truncateAtWord(`Shop the ${subject} tee — original Caribbean streetwear design.`, 160),
      tags: ["caribbean", "streetwear", "island life", "tropical", "reggae"],
      productType: "T-Shirt",
      collection: "Caribbean Streetwear",
      suggestedRetailPrice: 28.99,
    };

    const validated = validateProductCopy(candidate);
    if (!validated.ok) {
      // Would indicate a bug in this placeholder, not a real operational
      // failure — still surfaced as an Err rather than thrown, per convention.
      return err(validated.error);
    }

    return ok({
      jobId: request.jobId,
      provider: this.name,
      model: "dry-run-placeholder",
      generatedAt: this.now().toISOString(),
      copy: validated.value,
      metadata: { dryRun: true },
    });
  }
}

function titleCase(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Truncates to at most `maxLength` characters, cutting at the last whole word rather than mid-word. */
function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim();
}
