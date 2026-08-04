import { test } from "node:test";
import assert from "node:assert/strict";
import { validateArtworkAnalysis } from "../../automation/ai/artwork-analysis-validation.ts";

function validCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    collectionId: "vintage-jamaican-sound-systems",
    styleId: "vintage-jamaican-sound-system",
    theme: "vintage sound system culture",
    keywords: ["speaker stack", "sound system", "vintage"],
    title: "Vintage Sound System Tee",
    subtitle: "Caribbean Streetwear Collection",
    description:
      "A towering vintage speaker stack rendered in weathered poster style, bringing real sound system " +
      "heritage to everyday streetwear.",
    seoTitle: "Vintage Sound System T-Shirt | Caribbean Streetwear",
    seoDescription: "Shop the Vintage Sound System tee — original Caribbean streetwear design.",
    tags: [
      "caribbean",
      "streetwear",
      "sound system",
      "vintage",
      "reggae",
      "jamaican",
      "dub",
      "island life",
      "tropical",
      "graphic tee",
    ],
    ...overrides,
  };
}

test("validateArtworkAnalysis accepts a well-formed candidate", () => {
  const result = validateArtworkAnalysis(validCandidate());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.classification.collectionId, "vintage-jamaican-sound-systems");
  assert.equal(result.value.classification.styleId, "vintage-jamaican-sound-system");
  assert.equal(result.value.copy.tags.length, 10);
});

test("validateArtworkAnalysis rejects a non-object candidate", () => {
  const result = validateArtworkAnalysis("not an object");
  assert.equal(result.ok, false);
});

test("validateArtworkAnalysis rejects a candidate missing required fields", () => {
  const { title: _title, ...rest } = validCandidate();
  const result = validateArtworkAnalysis(rest);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /title/);
  }
});

test("validateArtworkAnalysis rejects an unknown collectionId", () => {
  const result = validateArtworkAnalysis(validCandidate({ collectionId: "not-a-real-collection" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /not a known Collection Library id/);
  }
});

test("validateArtworkAnalysis rejects an unknown styleId", () => {
  const result = validateArtworkAnalysis(validCandidate({ styleId: "not-a-real-style" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /not a known Style Library id/);
  }
});

test("validateArtworkAnalysis rejects keywords that are not a non-empty array", () => {
  const result = validateArtworkAnalysis(validCandidate({ keywords: [] }));
  assert.equal(result.ok, false);
});

test("validateArtworkAnalysis rejects fewer than 10 tags", () => {
  const result = validateArtworkAnalysis(validCandidate({ tags: ["caribbean", "streetwear", "vintage"] }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /between 10 and 15/);
  }
});

test("validateArtworkAnalysis rejects more than 15 tags", () => {
  const tags = Array.from({ length: 16 }, (_, i) => `tag${i}`);
  const result = validateArtworkAnalysis(validCandidate({ tags }));
  assert.equal(result.ok, false);
});

test("validateArtworkAnalysis accepts exactly 15 tags", () => {
  const tags = Array.from({ length: 15 }, (_, i) => `tag${i}`);
  const result = validateArtworkAnalysis(validCandidate({ tags }));
  assert.equal(result.ok, true);
});

test("validateArtworkAnalysis rejects duplicate tags", () => {
  const result = validateArtworkAnalysis(
    validCandidate({
      tags: [
        "caribbean",
        "Caribbean",
        "streetwear",
        "vintage",
        "reggae",
        "jamaican",
        "dub",
        "island life",
        "tropical",
        "graphic tee",
      ],
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /duplicates/);
  }
});

test("validateArtworkAnalysis rejects a description shorter than 40 characters", () => {
  const result = validateArtworkAnalysis(validCandidate({ description: "too short" }));
  assert.equal(result.ok, false);
});

test("validateArtworkAnalysis rejects an seoTitle over 70 characters", () => {
  const result = validateArtworkAnalysis(validCandidate({ seoTitle: "x".repeat(71) }));
  assert.equal(result.ok, false);
});

test("validateArtworkAnalysis reports every issue at once, not just the first", () => {
  const result = validateArtworkAnalysis(validCandidate({ title: "", collectionId: "bogus", tags: ["a"] }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /title/);
    assert.match(result.error.message, /collectionId/);
    assert.match(result.error.message, /tags/);
  }
});
