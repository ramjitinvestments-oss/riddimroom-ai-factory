/**
 * Structural validation for a candidate artwork-analysis response. Mirrors
 * `./product-copy-validation.ts`'s pattern (mechanically checkable
 * constraints only), plus two checks that module has no equivalent for:
 * `collectionId`/`styleId` must be real ids from the Collection/Style
 * Library — defense in depth on top of the JSON schema's own `enum`
 * constraint, the same "don't just trust the schema" posture
 * `../quality/vision-validation.ts` takes for its enum field.
 */
import { ValidationError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { getCollectionById } from "./collections/library.ts";
import { getStyleById } from "./styles/library.ts";
import type { ArtworkAnalysis } from "./artwork-analysis-types.ts";

const MIN_TAGS = 10;
const MAX_TAGS = 15;
const MIN_KEYWORDS = 1;

interface StringConstraints {
  readonly max: number;
  readonly min?: number;
}

export function validateArtworkAnalysis(candidate: unknown): Result<ArtworkAnalysis, ValidationError> {
  const issues: string[] = [];
  const obj = isRecord(candidate) ? candidate : {};
  if (!isRecord(candidate)) {
    issues.push("response was not a JSON object");
  }

  const collectionId = readString(obj, "collectionId", issues, { max: 100 });
  if (collectionId !== undefined && getCollectionById(collectionId) === undefined) {
    issues.push(`collectionId "${collectionId}" is not a known Collection Library id`);
  }

  const styleId = readString(obj, "styleId", issues, { max: 100 });
  if (styleId !== undefined && getStyleById(styleId) === undefined) {
    issues.push(`styleId "${styleId}" is not a known Style Library id`);
  }

  const theme = readString(obj, "theme", issues, { max: 200 });
  const keywords = readStringArray(obj, "keywords", issues, { min: MIN_KEYWORDS, max: 30 });
  const title = readString(obj, "title", issues, { max: 255 });
  const subtitle = readString(obj, "subtitle", issues, { max: 150 });
  const description = readString(obj, "description", issues, { max: 2000, min: 40 });
  const seoTitle = readString(obj, "seoTitle", issues, { max: 70 });
  const seoDescription = readString(obj, "seoDescription", issues, { max: 160 });
  const tags = readStringArray(obj, "tags", issues, { min: MIN_TAGS, max: MAX_TAGS }, { uniqueCaseInsensitive: true });

  if (issues.length > 0) {
    return err(new ValidationError(issues));
  }

  // Every field above passed validation (issues is empty), so none of them
  // are undefined here — the non-null assertions just satisfy the type
  // checker for that already-established invariant.
  return ok({
    classification: {
      collectionId: collectionId!,
      styleId: styleId!,
      theme: theme!,
      keywords: keywords!,
    },
    copy: {
      title: title!,
      subtitle: subtitle!,
      description: description!,
      seoTitle: seoTitle!,
      seoDescription: seoDescription!,
      tags: tags!,
    },
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

function readStringArray(
  obj: Record<string, unknown>,
  field: string,
  issues: string[],
  bounds: { readonly min: number; readonly max: number },
  options: { readonly uniqueCaseInsensitive?: boolean } = {},
): string[] | undefined {
  const value = obj[field];
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${field} must be a non-empty array of strings`);
    return undefined;
  }

  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      issues.push(`${field} must contain only non-blank strings`);
      return undefined;
    }
    items.push(entry.trim());
  }

  if (items.length < bounds.min || items.length > bounds.max) {
    issues.push(`${field} must contain between ${bounds.min} and ${bounds.max} entries (got ${items.length})`);
    return undefined;
  }

  if (options.uniqueCaseInsensitive === true) {
    const unique = new Set(items.map((item) => item.toLowerCase()));
    if (unique.size !== items.length) {
      issues.push(`${field} must not contain duplicates`);
      return undefined;
    }
  }

  return items;
}
