import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProductCopy } from "../../automation/ai/product-copy-validation.ts";

function validCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Sunset Parrot Tee",
    subtitle: "Caribbean Streetwear Collection",
    description:
      "A bold Caribbean-inspired parrot design bringing island energy to your everyday streetwear rotation.",
    seoTitle: "Sunset Parrot T-Shirt | Caribbean Streetwear",
    seoDescription: "Shop the Sunset Parrot tee — original Caribbean streetwear design, premium fit.",
    tags: ["caribbean", "streetwear", "parrot", "tropical", "island life"],
    productType: "T-Shirt",
    collection: "Caribbean Streetwear",
    suggestedRetailPrice: 27.99,
    ...overrides,
  };
}

test("validateProductCopy accepts a well-formed candidate", () => {
  const result = validateProductCopy(validCandidate());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.title, "Sunset Parrot Tee");
    assert.equal(result.value.tags.length, 5);
    assert.equal(result.value.suggestedRetailPrice, 27.99);
  }
});

test("validateProductCopy rejects a non-object candidate", () => {
  const result = validateProductCopy("not an object");
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects a candidate missing required fields", () => {
  const { title: _title, ...rest } = validCandidate();
  const result = validateProductCopy(rest);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /title/);
  }
});

test("validateProductCopy rejects a title over 255 characters", () => {
  const result = validateProductCopy(validCandidate({ title: "x".repeat(256) }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects a description shorter than 40 characters", () => {
  const result = validateProductCopy(validCandidate({ description: "too short" }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects a description longer than 2000 characters", () => {
  const result = validateProductCopy(validCandidate({ description: "x".repeat(2001) }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects an seoTitle over 70 characters", () => {
  const result = validateProductCopy(validCandidate({ seoTitle: "x".repeat(71) }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects an seoDescription over 160 characters", () => {
  const result = validateProductCopy(validCandidate({ seoDescription: "x".repeat(161) }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects a blank string field", () => {
  const result = validateProductCopy(validCandidate({ collection: "   " }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects tags that are not an array", () => {
  const result = validateProductCopy(validCandidate({ tags: "caribbean, streetwear" }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects fewer than 3 tags", () => {
  const result = validateProductCopy(validCandidate({ tags: ["caribbean", "streetwear"] }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects more than 20 tags", () => {
  const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
  const result = validateProductCopy(validCandidate({ tags }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects duplicate tags (keyword stuffing)", () => {
  const result = validateProductCopy(
    validCandidate({ tags: ["caribbean", "Caribbean", "streetwear", "tropical"] }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /duplicates/);
  }
});

test("validateProductCopy rejects a non-numeric price", () => {
  const result = validateProductCopy(validCandidate({ suggestedRetailPrice: "29.99" }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects a price below $10", () => {
  const result = validateProductCopy(validCandidate({ suggestedRetailPrice: 5 }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rejects a price above $100", () => {
  const result = validateProductCopy(validCandidate({ suggestedRetailPrice: 150 }));
  assert.equal(result.ok, false);
});

test("validateProductCopy rounds the price to the nearest cent", () => {
  const result = validateProductCopy(validCandidate({ suggestedRetailPrice: 29.999 }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.suggestedRetailPrice, 30);
  }
});

test("validateProductCopy reports every issue at once, not just the first", () => {
  const result = validateProductCopy(
    validCandidate({ title: "", suggestedRetailPrice: 999, tags: ["a"] }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /title/);
    assert.match(result.error.message, /suggestedRetailPrice/);
    assert.match(result.error.message, /tags/);
  }
});
