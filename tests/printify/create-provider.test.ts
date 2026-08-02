import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrintifyProvider } from "../../automation/printify/create-provider.ts";

test("defaults to the dry-run provider when DRY_RUN is unset", () => {
  const result = createPrintifyProvider({ env: {} });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "dry-run");
});

test("reports a ConfigError listing every missing required var when DRY_RUN is false", () => {
  const result = createPrintifyProvider({ env: { DRY_RUN: "false" } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFIG_ERROR");
  }
});

test("reports a ValidationError when the numeric catalog fields are not valid numbers", () => {
  const result = createPrintifyProvider({
    env: {
      DRY_RUN: "false",
      PRINTIFY_API_KEY: "pk-test",
      PRINTIFY_SHOP_ID: "shop-1",
      PRINTIFY_BLUEPRINT_ID: "not-a-number",
      PRINTIFY_PRINT_PROVIDER_ID: "9",
      PRINTIFY_VARIANT_IDS: "111,222",
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
});

test("builds the real provider when DRY_RUN is false and all catalog fields are valid", () => {
  const result = createPrintifyProvider({
    env: {
      DRY_RUN: "false",
      PRINTIFY_API_KEY: "pk-test",
      PRINTIFY_SHOP_ID: "shop-1",
      PRINTIFY_BLUEPRINT_ID: "5",
      PRINTIFY_PRINT_PROVIDER_ID: "9",
      PRINTIFY_VARIANT_IDS: "111, 222, 333",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "printify");
});

test("PRINTIFY_PRINT_X/Y/SCALE env overrides flow through to the actual product-creation request", async () => {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ body });
    if (String(input).endsWith("/uploads/images.json")) {
      return new Response(JSON.stringify({ id: "img-1" }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "prod-1" }), { status: 200 });
  }) as typeof fetch;

  const result = createPrintifyProvider({
    env: {
      DRY_RUN: "false",
      PRINTIFY_API_KEY: "pk-test",
      PRINTIFY_SHOP_ID: "shop-1",
      PRINTIFY_BLUEPRINT_ID: "5",
      PRINTIFY_PRINT_PROVIDER_ID: "9",
      PRINTIFY_VARIANT_IDS: "111,222",
      PRINTIFY_PRINT_X: "0.5",
      PRINTIFY_PRINT_Y: "0.3",
      PRINTIFY_PRINT_SCALE: "0.8",
    },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  await result.value.uploadProduct({
    jobId: "job-1",
    title: "Test Tee",
    description: "desc",
    artworkPng: Buffer.from("fake-png-bytes"),
    priceUsd: 24.99,
  });

  const printAreas = calls[1]?.body.print_areas as Array<{ placeholders: Array<{ images: Array<{ x: number; y: number; scale: number }> }> }>;
  const image = printAreas[0]?.placeholders[0]?.images[0];
  assert.deepEqual(image, { id: "img-1", x: 0.5, y: 0.3, scale: 0.8, angle: 0 });
});

test("leaves the upper-chest placement default in place when PRINTIFY_PRINT_X/Y/SCALE are unset", async () => {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ body });
    if (String(input).endsWith("/uploads/images.json")) {
      return new Response(JSON.stringify({ id: "img-1" }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "prod-1" }), { status: 200 });
  }) as typeof fetch;

  const result = createPrintifyProvider({
    env: {
      DRY_RUN: "false",
      PRINTIFY_API_KEY: "pk-test",
      PRINTIFY_SHOP_ID: "shop-1",
      PRINTIFY_BLUEPRINT_ID: "5",
      PRINTIFY_PRINT_PROVIDER_ID: "9",
      PRINTIFY_VARIANT_IDS: "111,222",
    },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  await result.value.uploadProduct({
    jobId: "job-1",
    title: "Test Tee",
    description: "desc",
    artworkPng: Buffer.from("fake-png-bytes"),
    priceUsd: 24.99,
  });

  const printAreas = calls[1]?.body.print_areas as Array<{ placeholders: Array<{ images: Array<{ x: number; y: number; scale: number }> }> }>;
  const image = printAreas[0]?.placeholders[0]?.images[0];
  assert.deepEqual(image, { id: "img-1", x: 0.5, y: 0.35, scale: 0.85, angle: 0 });
});
