/**
 * Prompt + schema for the Stage 2 AI vision judge. Mirrors
 * `../product-copy-prompt.ts`'s pattern: a JSON-schema-constrained
 * structured output so the response is guaranteed to match `VisionScore`
 * rather than hoping the model free-forms valid JSON.
 */
import type { VisionPromptContext } from "./types.ts";

export type { VisionPromptContext } from "./types.ts";

/** JSON schema OpenAI's structured-output mode enforces on the response — exactly the 6 fields the brief specifies. */
export const VISION_SCORE_JSON_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "number" },
    commercial: { type: "number" },
    composition: { type: "number" },
    thumbnail: { type: "number" },
    printability: { type: "number" },
    branding: { type: "number" },
    recommendation: { type: "string", enum: ["approve", "reject", "review"] },
  },
  required: ["overall", "commercial", "composition", "thumbnail", "printability", "branding", "recommendation"],
  additionalProperties: false,
} as const;

/**
 * System-level instructions. The rubric names twelve dimensions (per the
 * brief) but the response schema only has six aggregate fields, so the
 * prompt tells the model exactly how the twelve fold into the six —
 * otherwise "commercial appeal" vs "shelf appeal" vs "originality" would
 * be left for the model to guess how to combine.
 */
export function buildVisionSystemPrompt(): string {
  return [
    "You are a premium apparel art director grading a single isolated design asset for RiddimRoom, " +
      "a Caribbean streetwear brand whose bar is top-tier Etsy sellers and established premium apparel brands.",
    "Score 0-100 on twelve dimensions: commercial appeal, premium appearance, print quality, composition, " +
      "balance, focal point, storytelling, brand consistency, shelf appeal, thumbnail appeal, apparel " +
      "suitability, and originality.",
    "Fold those twelve into exactly six aggregate scores in your response: " +
      "commercial (blends commercial appeal, shelf appeal, originality, apparel suitability), " +
      "composition (blends balance, focal point, storytelling), " +
      "thumbnail (how well it reads at small size, on a product listing thumbnail), " +
      "printability (print quality and apparel suitability), " +
      "branding (premium appearance and brand consistency), " +
      "and overall (your holistic judgment, not a plain average of the other five).",
    "Set recommendation to \"approve\" only if this is genuinely ready for a premium commercial listing, " +
      "\"reject\" if it clearly is not, and \"review\" if a human should look at it.",
    "Respond with strict JSON matching the provided schema only — no prose, no explanation, no markdown.",
  ].join(" ");
}

/** Per-request instructions: what's being graded and its declared category/style. */
export function buildVisionUserPrompt(context: VisionPromptContext): string {
  const categoryPart = context.category !== undefined ? ` (asset category: ${context.category})` : "";
  const stylePart = context.styleId !== undefined ? `, art-directed in the "${context.styleId}" style` : "";
  return `Grade the attached isolated design asset${categoryPart}${stylePart} for use on a premium commercial t-shirt.`;
}
