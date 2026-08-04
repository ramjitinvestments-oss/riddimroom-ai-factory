/**
 * Structural validation for a candidate Stage 2 vision-judge response.
 * Mirrors `../product-copy-validation.ts`'s pattern: mechanically checkable
 * constraints only (numeric range, recommendation enum) — judgment quality
 * itself is a prompt concern (`./vision-prompt.ts`), not something a
 * validator can mechanically verify.
 */
import { ValidationError } from "../../shared/errors.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import type { VisionScore } from "./types.ts";

const SCORE_FIELDS = ["overall", "commercial", "composition", "thumbnail", "printability", "branding"] as const;
const RECOMMENDATIONS = new Set(["approve", "reject", "review"]);

export function validateVisionScore(candidate: unknown): Result<VisionScore, ValidationError> {
  const issues: string[] = [];
  const obj = isRecord(candidate) ? candidate : {};
  if (!isRecord(candidate)) {
    issues.push("response was not a JSON object");
  }

  const scores: Partial<Record<(typeof SCORE_FIELDS)[number], number>> = {};
  for (const field of SCORE_FIELDS) {
    const value = obj[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(`${field} must be a finite number`);
      continue;
    }
    if (value < 0 || value > 100) {
      issues.push(`${field} must be between 0 and 100 (got ${value})`);
      continue;
    }
    scores[field] = value;
  }

  const recommendation = obj.recommendation;
  if (typeof recommendation !== "string" || !RECOMMENDATIONS.has(recommendation)) {
    issues.push('recommendation must be one of "approve", "reject", "review"');
  }

  if (issues.length > 0) {
    return err(new ValidationError(issues));
  }

  return ok({
    overall: scores.overall!,
    commercial: scores.commercial!,
    composition: scores.composition!,
    thumbnail: scores.thumbnail!,
    printability: scores.printability!,
    branding: scores.branding!,
    recommendation: recommendation as VisionScore["recommendation"],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
