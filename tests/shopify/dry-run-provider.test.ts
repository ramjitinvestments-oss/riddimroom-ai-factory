import { test } from "node:test";
import assert from "node:assert/strict";
import { DryRunShopifyProvider } from "../../automation/shopify/dry-run-provider.ts";

const request = {
  jobId: "job-1",
  title: "Sunset Parrot Tee",
  descriptionHtml: "<p>A bold Caribbean design.</p>",
  tags: ["caribbean", "streetwear"],
  productType: "T-Shirt",
  priceUsd: 27.99,
  imagePng: Buffer.from("fake-png-bytes"),
};

test("DryRunShopifyProvider publishes a deterministic fake product without any network call", async () => {
  const provider = new DryRunShopifyProvider({ now: () => new Date("2026-07-31T00:00:00.000Z") });

  const result = await provider.publishProduct(request);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.jobId, "job-1");
  assert.equal(result.value.provider, "dry-run");
  assert.match(result.value.shopifyProductId, /job-1/);
  assert.equal(result.value.createdAt, "2026-07-31T00:00:00.000Z");
});

test("DryRunShopifyProvider rejects a blank title", async () => {
  const provider = new DryRunShopifyProvider();
  const result = await provider.publishProduct({ ...request, title: " " });
  assert.equal(result.ok, false);
});

test("DryRunShopifyProvider rejects empty image data", async () => {
  const provider = new DryRunShopifyProvider();
  const result = await provider.publishProduct({ ...request, imagePng: Buffer.alloc(0) });
  assert.equal(result.ok, false);
});

test("DryRunShopifyProvider always reports a published product as live", async () => {
  const provider = new DryRunShopifyProvider();
  const result = await provider.verifyProductLive("dry-run-product-job-1");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.isLive, true);
    assert.equal(result.value.status, "active");
  }
});

test("DryRunShopifyProvider rejects a blank product id for verification", async () => {
  const provider = new DryRunShopifyProvider();
  const result = await provider.verifyProductLive("  ");
  assert.equal(result.ok, false);
});

test("DryRunShopifyProvider's getProduct echoes back exactly what publishProduct recorded", async () => {
  const provider = new DryRunShopifyProvider();
  const published = await provider.publishProduct({
    ...request,
    seoTitle: "Sunset Parrot T-Shirt | Caribbean Streetwear",
    seoDescription: "Shop the Sunset Parrot tee.",
    collection: "Caribbean Vibes",
  });
  assert.equal(published.ok, true);
  if (!published.ok) return;

  const result = await provider.getProduct(published.value.shopifyProductId);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.title, "Sunset Parrot Tee");
  assert.equal(result.value.descriptionHtml, "<p>A bold Caribbean design.</p>");
  assert.equal(result.value.handle, published.value.handle);
  assert.equal(result.value.status, "active");
  assert.deepEqual(result.value.tags, ["caribbean", "streetwear"]);
  assert.equal(result.value.variants.length, 1);
  assert.equal(result.value.variants[0]?.price, 27.99);
  assert.ok(result.value.imageUrls.length >= 1);
  assert.equal(result.value.seoTitle, "Sunset Parrot T-Shirt | Caribbean Streetwear");
  assert.equal(result.value.seoDescription, "Shop the Sunset Parrot tee.");
  assert.deepEqual(result.value.collections, ["Caribbean Vibes"]);
});

test("DryRunShopifyProvider's getProduct fails for an id nothing was ever published under", async () => {
  const provider = new DryRunShopifyProvider();
  const result = await provider.getProduct("dry-run-product-never-published");
  assert.equal(result.ok, false);
});

test("DryRunShopifyProvider's getProduct rejects a blank product id", async () => {
  const provider = new DryRunShopifyProvider();
  const result = await provider.getProduct("  ");
  assert.equal(result.ok, false);
});
