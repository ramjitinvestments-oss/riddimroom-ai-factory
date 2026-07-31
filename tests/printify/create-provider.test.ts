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
