/**
 * Prompt engineering for artwork-driven analysis + listing copy. Reuses
 * `./product-copy-prompt.ts`'s brand voice, SEO, and safety directives
 * (exported from there) rather than re-authoring them — only the
 * platform/tag-count constraint and the classification instructions
 * (unique to this artwork-first flow) are new.
 *
 * `collectionId`/`styleId` are constrained via JSON-schema `enum` to the
 * real Collection Library (../collections/library.ts) / Style Library
 * (../styles/library.ts) ids — the model classifies into the existing
 * taxonomy, it never invents a new collection or style name.
 */
import { COLLECTION_LIBRARY } from "./collections/library.ts";
import { BRAND_VOICE_DIRECTIVE, SAFETY_DIRECTIVE, SEO_DIRECTIVE } from "./product-copy-prompt.ts";
import { STYLE_LIBRARY } from "./styles/library.ts";

const PLATFORM_DIRECTIVE =
  "Printify- and Shopify-ready: title under 255 characters, SEO title under 70 characters, SEO " +
  "description under 160 characters, description between 40 and 2000 characters, and exactly 10 to 15 " +
  "unique (non-duplicate) tags";

const COLLECTION_IDS = COLLECTION_LIBRARY.map((collection) => collection.id);
const STYLE_IDS = STYLE_LIBRARY.map((style) => style.id);

/** JSON schema OpenAI's structured-output mode enforces on the response. */
export const ARTWORK_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    collectionId: { type: "string", enum: COLLECTION_IDS },
    styleId: { type: "string", enum: STYLE_IDS },
    theme: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    title: { type: "string" },
    subtitle: { type: "string" },
    description: { type: "string" },
    seoTitle: { type: "string" },
    seoDescription: { type: "string" },
    // minItems/maxItems mirror artwork-analysis-validation.ts's MIN_TAGS/MAX_TAGS (10-15) exactly,
    // so OpenAI's structured-output mode enforces the count at generation time instead of relying
    // solely on the prompt's "exactly 10 to 15" wording — confirmed necessary: a real run generated
    // 16 tags for the "Liming" design under the prompt-only version of this schema, failing
    // validateArtworkAnalysis() after the request had already succeeded.
    tags: { type: "array", items: { type: "string" }, minItems: 10, maxItems: 15 },
  },
  required: [
    "collectionId",
    "styleId",
    "theme",
    "keywords",
    "title",
    "subtitle",
    "description",
    "seoTitle",
    "seoDescription",
    "tags",
  ],
  additionalProperties: false,
} as const;

/** System-level instructions: analysis task, brand voice, SEO, safety, and platform constraints. */
export function buildArtworkAnalysisSystemPrompt(): string {
  const collectionList = COLLECTION_LIBRARY.map((c) => `"${c.id}" (${c.name}: ${c.description})`).join("; ");
  const styleList = STYLE_LIBRARY.map((s) => `"${s.id}" (${s.name})`).join("; ");

  return [
    "You are a product copywriter and merchandiser for RiddimRoom, a Caribbean streetwear apparel brand. " +
      "The attached image is the only source of truth — never invent a product concept the artwork doesn't " +
      "actually show, and never assume any text or brief beyond what's visible in the image.",
    `First classify the artwork: pick the single best-fitting collectionId from exactly these options: ${collectionList}. ` +
      `Pick the single best-fitting styleId from exactly these options: ${styleList}. ` +
      "Then state the artwork's theme in a short phrase, and list keywords that describe what the artwork actually depicts.",
    "Then write product listing copy for a t-shirt printed with this artwork.",
    `Style: ${BRAND_VOICE_DIRECTIVE}.`,
    `Requirements: ${SEO_DIRECTIVE}. ${SAFETY_DIRECTIVE}. ${PLATFORM_DIRECTIVE}.`,
    "Respond with strict JSON matching the provided schema only — no extra commentary.",
  ].join(" ");
}

/** Per-request instructions — there is no brief; the attached image is the entire request. */
export function buildArtworkAnalysisUserPrompt(): string {
  return "Analyze the attached artwork and generate the classification and listing copy the schema asks for.";
}
