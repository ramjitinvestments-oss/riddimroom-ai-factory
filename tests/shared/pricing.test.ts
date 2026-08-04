import { test } from "node:test";
import assert from "node:assert/strict";
import { getDefaultShirtPrice, isShirtProductType, resolveRetailPrice } from "../../automation/shared/pricing.ts";

test("isShirtProductType recognizes common shirt product-type spellings, case-insensitively", () => {
  assert.equal(isShirtProductType("T-Shirt"), true);
  assert.equal(isShirtProductType("t-shirt"), true);
  assert.equal(isShirtProductType("TSHIRT"), true);
  assert.equal(isShirtProductType("Shirt"), true);
  assert.equal(isShirtProductType("Tee"), true);
  assert.equal(isShirtProductType("  tee  "), true);
});

test("isShirtProductType rejects non-shirt product types", () => {
  assert.equal(isShirtProductType("Hoodie"), false);
  assert.equal(isShirtProductType("Mug"), false);
  assert.equal(isShirtProductType("Hat"), false);
  assert.equal(isShirtProductType(""), false);
});

test("getDefaultShirtPrice falls back to 24.99 when unset", () => {
  assert.equal(getDefaultShirtPrice({}), 24.99);
});

test("getDefaultShirtPrice reads a configured value", () => {
  assert.equal(getDefaultShirtPrice({ DEFAULT_SHIRT_PRICE: "29.99" }), 29.99);
});

test("getDefaultShirtPrice falls back to 24.99 for blank/invalid/non-positive configured values", () => {
  assert.equal(getDefaultShirtPrice({ DEFAULT_SHIRT_PRICE: "" }), 24.99);
  assert.equal(getDefaultShirtPrice({ DEFAULT_SHIRT_PRICE: "not a number" }), 24.99);
  assert.equal(getDefaultShirtPrice({ DEFAULT_SHIRT_PRICE: "-5" }), 24.99);
  assert.equal(getDefaultShirtPrice({ DEFAULT_SHIRT_PRICE: "0" }), 24.99);
});

test("resolveRetailPrice overrides shirt product types to the fixed price, ignoring the suggestion entirely", () => {
  assert.equal(resolveRetailPrice("T-Shirt", 42.5, {}), 24.99);
  assert.equal(resolveRetailPrice("t-shirt", 9.99, {}), 24.99);
  assert.equal(resolveRetailPrice("Tee", 99, {}), 24.99);
});

test("resolveRetailPrice honors a configured DEFAULT_SHIRT_PRICE for shirt product types", () => {
  assert.equal(resolveRetailPrice("T-Shirt", 42.5, { DEFAULT_SHIRT_PRICE: "19.99" }), 19.99);
});

test("resolveRetailPrice leaves non-shirt product types' suggested price untouched", () => {
  assert.equal(resolveRetailPrice("Hoodie", 45.0, {}), 45.0);
  assert.equal(resolveRetailPrice("Mug", 12.5, { DEFAULT_SHIRT_PRICE: "19.99" }), 12.5);
});
