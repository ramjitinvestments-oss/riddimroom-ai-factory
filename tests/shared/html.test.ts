import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../../automation/shared/html.ts";

test("escapeHtml escapes the three text-node-significant characters (not quotes)", () => {
  // Straight double quotes are valid, unambiguous text-node content and are deliberately left
  // as-is — see the doc comment on escapeHtml() for why escaping them broke round-trip
  // verification against Shopify's own HTML normalization.
  assert.equal(escapeHtml(`<script>alert("x & y")</script>`), '&lt;script&gt;alert("x &amp; y")&lt;/script&gt;');
});

test('escapeHtml leaves straight double quotes untouched', () => {
  assert.equal(escapeHtml(`Get ready to rock our "Watch Nah" t-shirt.`), `Get ready to rock our "Watch Nah" t-shirt.`);
});

test("escapeHtml leaves ordinary text untouched", () => {
  assert.equal(escapeHtml("A bold Caribbean design."), "A bold Caribbean design.");
});
