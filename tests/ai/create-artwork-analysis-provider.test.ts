import { test } from "node:test";
import assert from "node:assert/strict";
import { createArtworkAnalysisProvider } from "../../automation/ai/create-artwork-analysis-provider.ts";

test("defaults to the dry-run provider when DRY_RUN is unset", () => {
  const result = createArtworkAnalysisProvider({ env: {} });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "dry-run");
});

test("reports a ConfigError when DRY_RUN is false and OPENAI_API_KEY is missing", () => {
  const result = createArtworkAnalysisProvider({ env: { DRY_RUN: "false" } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.error.missing, ["OPENAI_API_KEY"]);
  }
});

test("builds the OpenAI provider when DRY_RUN is false and OPENAI_API_KEY is set", () => {
  const result = createArtworkAnalysisProvider({
    env: { DRY_RUN: "false", OPENAI_API_KEY: "sk-test" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "openai");
});

test("wires OPENAI_ARTWORK_ANALYSIS_MODEL and injected fetchImpl through to the real provider", async () => {
  let capturedBody: { model?: string } = {};
  const validAnalysis = {
    collectionId: "vintage-jamaican-sound-systems",
    styleId: "vintage-jamaican-sound-system",
    theme: "vintage sound system culture",
    keywords: ["speaker stack", "sound system"],
    title: "Vintage Sound System Tee",
    subtitle: "Caribbean Streetwear Collection",
    description:
      "A towering vintage speaker stack rendered in weathered poster style for real sound system heritage.",
    seoTitle: "Vintage Sound System T-Shirt",
    seoDescription: "Shop the Vintage Sound System tee.",
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
  };
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validAnalysis) } }] }), {
      status: 200,
    });
  }) as typeof fetch;

  const result = createArtworkAnalysisProvider({
    env: { DRY_RUN: "false", OPENAI_API_KEY: "sk-test", OPENAI_ARTWORK_ANALYSIS_MODEL: "custom-model" },
    fetchImpl,
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  await result.value.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake") });
  assert.equal(capturedBody.model, "custom-model");
});
