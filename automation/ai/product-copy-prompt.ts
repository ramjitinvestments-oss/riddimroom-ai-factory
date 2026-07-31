/**
 * Prompt engineering for product listing copy, kept provider-agnostic the
 * same way `./prompt.ts` is for artwork: every provider gets the same
 * brand voice, SEO, safety, and platform constraints regardless of which
 * one actually writes the copy.
 */

const BRAND_VOICE_DIRECTIVE =
  "Caribbean streetwear brand voice: vibrant, confident, island-culture pride, tropical/reggae/carnival " +
  "energy, casual and inclusive tone that speaks to the Caribbean diaspora and streetwear fans";

const SEO_DIRECTIVE =
  "SEO-friendly: natural language a real shopper would actually search for, specific and descriptive, " +
  "no keyword stuffing, do not repeat the same word or phrase excessively across fields";

const SAFETY_DIRECTIVE =
  "commercial-safe: no copyrighted phrases, no song lyrics, no trademarked slogans or brand names, " +
  "no quotes attributed to real people, no references to existing franchises or celebrities";

const PLATFORM_DIRECTIVE =
  "Printify- and Shopify-ready: title under 255 characters, SEO title under 70 characters, SEO " +
  "description under 160 characters, description between 40 and 2000 characters, 3 to 20 unique " +
  "(non-duplicate) tags, and a realistic direct-to-garment t-shirt retail price in USD between $10 and $100";

/** JSON schema OpenAI's structured-output mode enforces on the response. */
export const PRODUCT_COPY_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    description: { type: "string" },
    seoTitle: { type: "string" },
    seoDescription: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    productType: { type: "string" },
    collection: { type: "string" },
    suggestedRetailPrice: { type: "number" },
  },
  required: [
    "title",
    "subtitle",
    "description",
    "seoTitle",
    "seoDescription",
    "tags",
    "productType",
    "collection",
    "suggestedRetailPrice",
  ],
  additionalProperties: false,
} as const;

/** System-level instructions: brand voice, SEO, safety, and platform constraints. */
export function buildProductCopySystemPrompt(): string {
  return [
    "You are a product copywriter for RiddimRoom, a Caribbean streetwear apparel brand.",
    `Style: ${BRAND_VOICE_DIRECTIVE}.`,
    `Requirements: ${SEO_DIRECTIVE}. ${SAFETY_DIRECTIVE}. ${PLATFORM_DIRECTIVE}.`,
    "Respond with strict JSON matching the provided schema only — no extra commentary.",
  ].join(" ");
}

/** Per-request instructions: the design brief, referencing the attached artwork image. */
export function buildProductCopyUserPrompt(brief: string): string {
  return (
    `Generate product listing copy for a t-shirt with this design brief: "${brief.trim()}". ` +
    "The attached image is the actual generated artwork — base the copy on what it depicts."
  );
}
