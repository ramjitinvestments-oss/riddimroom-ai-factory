import { test } from "node:test";
import assert from "node:assert/strict";
import { createShopifyProvider } from "../../automation/shopify/create-provider.ts";

test("defaults to the dry-run provider when DRY_RUN is unset", () => {
  const result = createShopifyProvider({ env: {} });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "dry-run");
});

test("reports a ConfigError when DRY_RUN is false and credentials are missing", () => {
  const result = createShopifyProvider({ env: { DRY_RUN: "false" } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFIG_ERROR");
    assert.deepEqual(
      [...result.error.missing].sort(),
      ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_STORE_DOMAIN"],
    );
  }
});

test("does not require SHOPIFY_ADMIN_API_ACCESS_TOKEN", () => {
  const result = createShopifyProvider({
    env: {
      DRY_RUN: "false",
      SHOPIFY_STORE_DOMAIN: "riddimroom.myshopify.com",
      SHOPIFY_CLIENT_ID: "client-id",
      SHOPIFY_CLIENT_SECRET: "client-secret",
    },
  });
  assert.equal(result.ok, true);
});

test("builds the real provider when DRY_RUN is false and credentials are set", () => {
  const result = createShopifyProvider({
    env: {
      DRY_RUN: "false",
      SHOPIFY_STORE_DOMAIN: "riddimroom.myshopify.com",
      SHOPIFY_CLIENT_ID: "client-id",
      SHOPIFY_CLIENT_SECRET: "client-secret",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.name : null, "shopify");
});
