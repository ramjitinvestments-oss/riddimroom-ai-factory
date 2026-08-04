import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../../automation/shared/html.ts";

test("escapeHtml escapes all five HTML-significant characters", () => {
  assert.equal(escapeHtml(`<script>alert("x & y")</script>`), "&lt;script&gt;alert(&quot;x &amp; y&quot;)&lt;/script&gt;");
});

test("escapeHtml leaves ordinary text untouched", () => {
  assert.equal(escapeHtml("A bold Caribbean design."), "A bold Caribbean design.");
});
