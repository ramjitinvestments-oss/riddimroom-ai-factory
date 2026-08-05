/**
 * Escapes the HTML-significant characters in `text` for safe inclusion as
 * HTML body/text-node content (e.g. `<p>${escapeHtml(text)}</p>`) — NOT for
 * inclusion inside a quoted HTML attribute value, which would additionally
 * need `"`/`'` escaped.
 *
 * Deliberately does NOT escape `"` (straight double quotes are valid,
 * unambiguous characters in text-node content — they only need escaping
 * inside an attribute value). This isn't just a simplification: escaping
 * quotes here previously broke `scripts/publish-to-shopify.ts`'s own
 * publish-verification check. That script sends `<p>${escapeHtml(description)}</p>`
 * as `descriptionHtml`, then later re-escapes the same source description to
 * build the string it expects to find in the live product. Confirmed via a
 * real production launch (the "Watch Nah" design, whose AI-generated
 * description quotes the phrase `"Watch Nah"`): Shopify's Admin API
 * normalizes stored HTML and returns the live `descriptionHtml` with a
 * literal `"` character, not `&quot;` — so the verification's re-escaped
 * expected string (containing `&quot;`) never matched, and the launch
 * stopped on a false-positive "field mismatch: description".
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
