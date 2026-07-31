import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProductCopySystemPrompt,
  buildProductCopyUserPrompt,
  PRODUCT_COPY_JSON_SCHEMA,
} from "../../automation/ai/product-copy-prompt.ts";

test("buildProductCopySystemPrompt includes the Caribbean streetwear brand voice", () => {
  const prompt = buildProductCopySystemPrompt();
  assert.match(prompt, /Caribbean streetwear/);
});

test("buildProductCopySystemPrompt requires SEO-friendliness without keyword stuffing", () => {
  const prompt = buildProductCopySystemPrompt();
  assert.match(prompt, /SEO-friendly/);
  assert.match(prompt, /no keyword stuffing/);
});

test("buildProductCopySystemPrompt requires commercial safety", () => {
  const prompt = buildProductCopySystemPrompt();
  assert.match(prompt, /no copyrighted phrases/);
  assert.match(prompt, /no references to existing franchises or celebrities/);
});

test("buildProductCopySystemPrompt requires Printify/Shopify-ready constraints", () => {
  const prompt = buildProductCopySystemPrompt();
  assert.match(prompt, /Printify- and Shopify-ready/);
});

test("buildProductCopyUserPrompt includes the trimmed design brief", () => {
  const prompt = buildProductCopyUserPrompt("  a parrot wearing sunglasses  ");
  assert.match(prompt, /a parrot wearing sunglasses/);
  assert.doesNotMatch(prompt, /"  a parrot/);
});

test("PRODUCT_COPY_JSON_SCHEMA requires every ProductCopy field and forbids extras", () => {
  assert.deepEqual(
    [...PRODUCT_COPY_JSON_SCHEMA.required].sort(),
    [
      "collection",
      "description",
      "productType",
      "seoDescription",
      "seoTitle",
      "subtitle",
      "suggestedRetailPrice",
      "tags",
      "title",
    ],
  );
  assert.equal(PRODUCT_COPY_JSON_SCHEMA.additionalProperties, false);
});
