import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARTWORK_ANALYSIS_JSON_SCHEMA,
  buildArtworkAnalysisSystemPrompt,
  buildArtworkAnalysisUserPrompt,
} from "../../automation/ai/artwork-analysis-prompt.ts";
import { COLLECTION_LIBRARY } from "../../automation/ai/collections/library.ts";
import { STYLE_LIBRARY } from "../../automation/ai/styles/library.ts";

test("buildArtworkAnalysisSystemPrompt includes the Caribbean streetwear brand voice", () => {
  const prompt = buildArtworkAnalysisSystemPrompt();
  assert.match(prompt, /Caribbean streetwear/);
});

test("buildArtworkAnalysisSystemPrompt requires commercial safety and Printify/Shopify-ready constraints", () => {
  const prompt = buildArtworkAnalysisSystemPrompt();
  assert.match(prompt, /no copyrighted phrases/);
  assert.match(prompt, /Printify- and Shopify-ready/);
});

test("buildArtworkAnalysisSystemPrompt asks for exactly 10 to 15 tags", () => {
  const prompt = buildArtworkAnalysisSystemPrompt();
  assert.match(prompt, /10 to 15/);
});

test("buildArtworkAnalysisSystemPrompt lists every real collection and style id as classification options", () => {
  const prompt = buildArtworkAnalysisSystemPrompt();
  for (const collection of COLLECTION_LIBRARY) {
    assert.ok(prompt.includes(collection.id), `missing collection id: ${collection.id}`);
  }
  for (const style of STYLE_LIBRARY) {
    assert.ok(prompt.includes(style.id), `missing style id: ${style.id}`);
  }
});

test("buildArtworkAnalysisSystemPrompt states the image is the only source of truth", () => {
  const prompt = buildArtworkAnalysisSystemPrompt();
  assert.match(prompt, /only source of truth/);
});

test("buildArtworkAnalysisUserPrompt does not reference any brief text (there is none)", () => {
  const prompt = buildArtworkAnalysisUserPrompt();
  assert.match(prompt, /Analyze the attached artwork/);
});

test("ARTWORK_ANALYSIS_JSON_SCHEMA requires every classification and copy field and forbids extras", () => {
  assert.deepEqual(
    [...ARTWORK_ANALYSIS_JSON_SCHEMA.required].sort(),
    [
      "collectionId",
      "description",
      "keywords",
      "seoDescription",
      "seoTitle",
      "styleId",
      "subtitle",
      "tags",
      "theme",
      "title",
    ],
  );
  assert.equal(ARTWORK_ANALYSIS_JSON_SCHEMA.additionalProperties, false);
});

test("ARTWORK_ANALYSIS_JSON_SCHEMA constrains collectionId/styleId to the real libraries via enum", () => {
  assert.deepEqual(
    [...ARTWORK_ANALYSIS_JSON_SCHEMA.properties.collectionId.enum].sort(),
    COLLECTION_LIBRARY.map((c) => c.id).sort(),
  );
  assert.deepEqual(
    [...ARTWORK_ANALYSIS_JSON_SCHEMA.properties.styleId.enum].sort(),
    STYLE_LIBRARY.map((s) => s.id).sort(),
  );
});
