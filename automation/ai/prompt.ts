/**
 * Prompt engineering for t-shirt artwork generation, kept provider-agnostic
 * so every provider (OpenAI today, others later) gets the same house
 * style and commercial-safety constraints regardless of which one actually
 * renders the image.
 */

const STYLE_DIRECTIVE =
  "flat vector illustration, bold clean linework, bright saturated colors, " +
  "apparel graphic design for a t-shirt print, centered composition, no photorealism, " +
  "no embedded text or lettering, no watermark, isolated on a transparent background " +
  "with no background scenery, ground, or shadow";

const SAFETY_DIRECTIVE =
  "completely original artwork, no copyrighted characters, no trademarked logos or brand " +
  "marks, no real identifiable people, no existing franchise, film, or celebrity likeness";

/**
 * Wraps a design brief with the style and safety directives every
 * generated image must satisfy. Applied once, centrally, so no provider
 * implementation has to remember to add these constraints itself.
 */
export function buildTShirtPrompt(brief: string): string {
  return `${brief.trim()}. Style: ${STYLE_DIRECTIVE}. Requirements: ${SAFETY_DIRECTIVE}.`;
}
