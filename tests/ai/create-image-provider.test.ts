import { test } from "node:test";
import assert from "node:assert/strict";
import { createImageProvider } from "../../automation/ai/create-image-provider.ts";
import { createSolidPng } from "../../automation/ai/png.ts";

test("defaults to the dry-run provider when DRY_RUN is unset", () => {
  const result = createImageProvider({ env: {} });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "dry-run");
});

test("uses the dry-run provider when DRY_RUN is explicitly true", () => {
  const result = createImageProvider({ env: { DRY_RUN: "true" } });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "dry-run");
});

test("reports a ConfigError when DRY_RUN is false and OPENAI_API_KEY is missing", () => {
  const result = createImageProvider({ env: { DRY_RUN: "false" } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFIG_ERROR");
    assert.deepEqual(result.error.missing, ["OPENAI_API_KEY"]);
  }
});

test("builds the OpenAI provider when DRY_RUN is false and OPENAI_API_KEY is set", () => {
  const result = createImageProvider({
    env: { DRY_RUN: "false", OPENAI_API_KEY: "sk-test" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "openai");
});

test("wires OPENAI_IMAGE_MODEL and injected fetchImpl through to the real provider", async () => {
  const png = createSolidPng(2, 2, { r: 1, g: 1, b: 1, a: 255 });
  let capturedBody: { model?: string } = {};
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), {
      status: 200,
    });
  }) as typeof fetch;

  const result = createImageProvider({
    env: { DRY_RUN: "false", OPENAI_API_KEY: "sk-test", OPENAI_IMAGE_MODEL: "custom-model" },
    fetchImpl,
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  await result.value.generate({ jobId: "job-1", prompt: "a parrot" });
  assert.equal(capturedBody.model, "custom-model");
});
