/**
 * Structural validation for a candidate product-copy response, applied
 * regardless of which provider produced it (including the dry-run
 * provider, so the mock is held to the same bar as production).
 *
 * This validates what's mechanically checkable — required fields,
 * lengths Shopify/Printify actually enforce or expect, a sane price
 * range, and no literal duplicate tags. Qualitative requirements (brand
 * voice, "no keyword stuffing" beyond literal duplicates, "no copyrighted
 * phrases") are enforced by the prompt (`./product-copy-prompt.ts`), the
 * same way commercial-safety is a prompt concern for artwork generation —
 * there's no reliable mechanical test for "is this phrase copyrighted."
 */
import { ValidationError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { ProductCopy } from "./product-copy-types.ts";

const MIN_PRICE_USD = 10;
const MAX_PRICE_USD = 100;
const MIN_TAGS = 3;
const MAX_TAGS = 20;

interface StringConstraints {
  readonly max: number;
  readonly min?: number;
}

export function validateProductCopy(candidate: unknown): Result<ProductCopy, ValidationError> {
  const issues: string[] = [];
  const obj = isRecord(candidate) ? candidate : {};
  if (!isRecord(candidate)) {
    issues.push("response was not a JSON object");
  }

  const title = readString(obj, "title", issues, { max: 255 });
  const subtitle = readString(obj, "subtitle", issues, { max: 150 });
  const description = readString(obj, "description", issues, { max: 2000, min: 40 });
  const seoTitle = readString(obj, "seoTitle", issues, { max: 70 });
  const seoDescription = readString(obj, "seoDescription", issues, { max: 160 });
  const productType = readString(obj, "productType", issues, { max: 100 });
  const collection = readString(obj, "collection", issues, { max: 100 });
  const tags = readTags(obj, issues);
  const suggestedRetailPrice = readPrice(obj, issues);

  if (issues.length > 0) {
    return err(new ValidationError(issues));
  }

  // Every field above passed validation (issues is empty), so none of
  // them are undefined here — the non-null assertions just satisfy the
  // type checker for that already-established invariant.
  return ok({
    title: title!,
    subtitle: subtitle!,
    description: description!,
    seoTitle: seoTitle!,
    seoDescription: seoDescription!,
    productType: productType!,
    collection: collection!,
    tags: tags!,
    suggestedRetailPrice: suggestedRetailPrice!,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  obj: Record<string, unknown>,
  field: string,
  issues: string[],
  constraints: StringConstraints,
): string | undefined {
  const value = obj[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${field} must be a non-blank string`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > constraints.max) {
    issues.push(`${field} must be at most ${constraints.max} characters (got ${trimmed.length})`);
    return undefined;
  }
  if (constraints.min !== undefined && trimmed.length < constraints.min) {
    issues.push(`${field} must be at least ${constraints.min} characters (got ${trimmed.length})`);
    return undefined;
  }
  return trimmed;
}

function readTags(obj: Record<string, unknown>, issues: string[]): string[] | undefined {
  const value = obj.tags;
  if (!Array.isArray(value) || value.length === 0) {
    issues.push("tags must be a non-empty array of strings");
    return undefined;
  }

  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      issues.push("tags must contain only non-blank strings");
      return undefined;
    }
    tags.push(item.trim());
  }

  if (tags.length < MIN_TAGS || tags.length > MAX_TAGS) {
    issues.push(`tags must contain between ${MIN_TAGS} and ${MAX_TAGS} entries (got ${tags.length})`);
    return undefined;
  }

  const unique = new Set(tags.map((tag) => tag.toLowerCase()));
  if (unique.size !== tags.length) {
    issues.push("tags must not contain duplicates");
    return undefined;
  }

  return tags;
}

function readPrice(obj: Record<string, unknown>, issues: string[]): number | undefined {
  const value = obj.suggestedRetailPrice;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push("suggestedRetailPrice must be a finite number");
    return undefined;
  }
  if (value < MIN_PRICE_USD || value > MAX_PRICE_USD) {
    issues.push(
      `suggestedRetailPrice must be between ${MIN_PRICE_USD} and ${MAX_PRICE_USD} (got ${value})`,
    );
    return undefined;
  }
  return Math.round(value * 100) / 100;
}
