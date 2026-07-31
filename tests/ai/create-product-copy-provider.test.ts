import { test } from "node:test";
import assert from "node:assert/strict";
import { createProductCopyProvider } from "../../automation/ai/create-product-copy-provider.ts";

test("defaults to the dry-run provider when DRY_RUN is unset", () => {
  const result = createProductCopyProvider({ env: {} });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "dry-run");
});

test("reports a ConfigError when DRY_RUN is false and OPENAI_API_KEY is missing", () => {
  const result = createProductCopyProvider({ env: { DRY_RUN: "false" } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.error.missing, ["OPENAI_API_KEY"]);
  }
});

test("builds the OpenAI provider when DRY_RUN is false and OPENAI_API_KEY is set", () => {
  const result = createProductCopyProvider({
    env: { DRY_RUN: "false", OPENAI_API_KEY: "sk-test" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "openai");
});

test("wires OPENAI_PRODUCT_COPY_MODEL and injected fetchImpl through to the real provider", async () => {
  let capturedBody: { model?: string } = {};
  const validCopy = {
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
  };
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validCopy) } }] }), {
      status: 200,
    });
  }) as typeof fetch;

  const result = createProductCopyProvider({
    env: { DRY_RUN: "false", OPENAI_API_KEY: "sk-test", OPENAI_PRODUCT_COPY_MODEL: "custom-model" },
    fetchImpl,
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  await result.value.generate({ jobId: "job-1", brief: "a mango", artworkPng: Buffer.from("fake") });
  assert.equal(capturedBody.model, "custom-model");
});
