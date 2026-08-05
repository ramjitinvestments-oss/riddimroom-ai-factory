import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ShopifyApiProvider,
  type ShopifyProviderOptions,
} from "../../automation/shopify/shopify-provider.ts";
import type { AccessTokenProvider } from "../../automation/shopify/client-credentials-token-provider.ts";
import { Logger } from "../../automation/shared/logger.ts";
import { ExternalServiceError, type FileOperationError } from "../../automation/shared/errors.ts";
import { err, ok, type Result } from "../../automation/shared/result.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";

/** Stands in for the real auth layer (`ClientCredentialsTokenProvider`) in tests. */
function stubTokenProvider(token: string | ExternalServiceError): AccessTokenProvider {
  return {
    getToken: async () => (token instanceof ExternalServiceError ? err(token) : ok(token)),
  };
}

class FakeTransport implements LogTransport {
  readonly name = "fake";
  readonly entries: LogEntry[] = [];

  write(entry: LogEntry): Result<void, FileOperationError> {
    this.entries.push(entry);
    return ok(undefined);
  }
}

interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly accessToken: string | null;
  readonly body: Record<string, unknown> | null;
}

function stubFetch(factories: ReadonlyArray<() => Response>): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({
      method: String(init?.method ?? "GET"),
      url: String(input),
      accessToken: headers.get("x-shopify-access-token"),
      body: init?.body !== undefined ? JSON.parse(String(init.body)) : null,
    });
    const factory = factories[Math.min(index, factories.length - 1)];
    index += 1;
    if (factory === undefined) {
      throw new Error("no fetch stub configured");
    }
    return factory();
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function baseOptions(
  fetchImpl: typeof fetch,
  overrides: Partial<ShopifyProviderOptions> = {},
): ShopifyProviderOptions {
  return {
    storeDomain: "riddimroom.myshopify.com",
    tokenProvider: stubTokenProvider("shpat_test"),
    apiVersion: "2025-01",
    fetchImpl,
    ...overrides,
  };
}

const publishRequest = {
  jobId: "job-1",
  title: "Sunset Parrot Tee",
  descriptionHtml: "<p>A bold Caribbean design.</p>",
  tags: ["caribbean", "streetwear"],
  productType: "T-Shirt",
  priceUsd: 27.99,
  imagePng: Buffer.from("fake-png-bytes"),
};

test("ShopifyApiProvider publishes a product on success", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { product: { id: 987654321, handle: "sunset-parrot-tee" } }),
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.publishProduct(publishRequest);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.shopifyProductId, "987654321");
  assert.equal(result.value.handle, "sunset-parrot-tee");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "POST");
  assert.match(calls[0]?.url ?? "", /riddimroom\.myshopify\.com\/admin\/api\/2025-01\/products\.json$/);
  assert.equal(calls[0]?.accessToken, "shpat_test");
  const product = calls[0]?.body?.product as { status: string; tags: string };
  assert.equal(product.status, "active");
  assert.equal(product.tags, "caribbean, streetwear");
});

test("ShopifyApiProvider does not call fetch for invalid inputs", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, { product: { id: 1 } })]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const blankTitle = await provider.publishProduct({ ...publishRequest, title: " " });
  const emptyImage = await provider.publishProduct({ ...publishRequest, imagePng: Buffer.alloc(0) });

  assert.equal(blankTitle.ok, false);
  assert.equal(emptyImage.ok, false);
  assert.equal(calls.length, 0);
});

test("ShopifyApiProvider reports a non-retryable status (401) without retrying", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("unauthorized", { status: 401 })]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl, { maxAttempts: 3, baseDelayMs: 1 }));

  const result = await provider.publishProduct(publishRequest);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal((result.error as { statusCode?: number }).statusCode, 401);
  }
  assert.equal(calls.length, 1);
});

test("ShopifyApiProvider retries a 500 and succeeds once the retry goes through", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => new Response("server error", { status: 500 }),
    () => jsonResponse(200, { product: { id: 42, handle: "sunset-parrot-tee" } }),
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl, { maxAttempts: 3, baseDelayMs: 1 }));

  const result = await provider.publishProduct(publishRequest);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
});

test("ShopifyApiProvider exhausts retries on a persistent 429", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("rate limited", { status: 429 })]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl, { maxAttempts: 2, baseDelayMs: 1 }));

  const result = await provider.publishProduct(publishRequest);

  assert.equal(result.ok, false);
  assert.equal(calls.length, 2);
});

test("ShopifyApiProvider verifyProductLive reports active status as live", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, { product: { id: 42, status: "active" } })]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.verifyProductLive("42");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.isLive, true);
    assert.equal(result.value.status, "active");
  }
  assert.equal(calls[0]?.method, "GET");
  assert.match(calls[0]?.url ?? "", /\/products\/42\.json$/);
});

test("ShopifyApiProvider verifyProductLive reports a draft/archived product as not live", async () => {
  const { fetchImpl } = stubFetch([() => jsonResponse(200, { product: { id: 42, status: "draft" } })]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.verifyProductLive("42");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.isLive, false);
    assert.equal(result.value.status, "draft");
  }
});

test("ShopifyApiProvider verifyProductLive rejects a blank product id without calling fetch", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, { product: { id: 1, status: "active" } })]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.verifyProductLive("  ");

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("ShopifyApiProvider reports a response missing a product id as a ValidationError", async () => {
  const { fetchImpl } = stubFetch([() => jsonResponse(200, { product: {} })]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.publishProduct(publishRequest);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
});

test("ShopifyApiProvider propagates a token provider failure without calling fetch", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, { product: { id: 1 } })]);
  const tokenError = new ExternalServiceError("shopify", "token request failed: 401 unauthorized", {
    statusCode: 401,
  });
  const provider = new ShopifyApiProvider(
    baseOptions(fetchImpl, { tokenProvider: stubTokenProvider(tokenError) }),
  );

  const result = await provider.publishProduct(publishRequest);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, tokenError);
  }
  assert.equal(calls.length, 0);
});

test("ShopifyApiProvider sets each SEO metafield via its own dedicated call after the product is created", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { product: { id: 42, handle: "sunset-parrot-tee" } }), // create product
    () => jsonResponse(200, { metafield: { id: 1 } }), // set title_tag
    () => jsonResponse(200, { metafield: { id: 2 } }), // set description_tag
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.publishProduct({
    ...publishRequest,
    seoTitle: "Sunset Parrot T-Shirt | Caribbean Streetwear",
    seoDescription: "Shop the Sunset Parrot tee.",
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);

  // The create call itself must NOT carry a nested metafields array (the
  // unreliable path this fix moves away from — see createProduct()'s doc comment).
  const createBody = calls[0]?.body?.product as { metafields?: unknown };
  assert.equal(createBody.metafields, undefined);

  assert.equal(calls[1]?.method, "POST");
  assert.match(calls[1]?.url ?? "", /\/products\/42\/metafields\.json$/);
  const titleMetafield = calls[1]?.body?.metafield as Record<string, string>;
  assert.deepEqual(titleMetafield, {
    namespace: "global",
    key: "title_tag",
    value: "Sunset Parrot T-Shirt | Caribbean Streetwear",
    type: "single_line_text_field",
  });

  assert.equal(calls[2]?.method, "POST");
  assert.match(calls[2]?.url ?? "", /\/products\/42\/metafields\.json$/);
  const descriptionMetafield = calls[2]?.body?.metafield as Record<string, string>;
  assert.deepEqual(descriptionMetafield, {
    namespace: "global",
    key: "description_tag",
    value: "Shop the Sunset Parrot tee.",
    type: "multi_line_text_field",
  });
});

test("ShopifyApiProvider makes no metafield calls at all when no SEO fields are given", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { product: { id: 42, handle: "sunset-parrot-tee" } }),
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  await provider.publishProduct(publishRequest);

  assert.equal(calls.length, 1);
  const product = calls[0]?.body?.product as { metafields?: unknown };
  assert.equal(product.metafields, undefined);
});

test("ShopifyApiProvider fails the publish (does not swallow the error) when setting a SEO metafield fails", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { product: { id: 42, handle: "sunset-parrot-tee" } }), // create product
    () => new Response("unprocessable", { status: 422 }), // title_tag metafield write fails
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.publishProduct({
    ...publishRequest,
    seoTitle: "Sunset Parrot T-Shirt | Caribbean Streetwear",
    seoDescription: "Shop the Sunset Parrot tee.",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal((result.error as { statusCode?: number }).statusCode, 422);
  }
  // The description_tag call must never have been attempted — the failure on
  // title_tag stops the publish rather than silently moving on.
  assert.equal(calls.length, 2);
});

test("ShopifyApiProvider reuses an existing collection by title instead of creating a duplicate", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { product: { id: 42, handle: "sunset-parrot-tee" } }), // create product
    () => jsonResponse(200, { custom_collections: [{ id: 555, title: "Caribbean Vibes" }] }), // find collection
    () => jsonResponse(200, { collect: { id: 1 } }), // link
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.publishProduct({ ...publishRequest, collection: "Caribbean Vibes" });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  assert.match(calls[1]?.url ?? "", /\/custom_collections\.json\?title=Caribbean(%20|\+)Vibes$/);
  assert.equal(calls[2]?.method, "POST");
  assert.match(calls[2]?.url ?? "", /\/collects\.json$/);
  const collect = calls[2]?.body?.collect as { product_id: number; collection_id: number };
  assert.equal(collect.product_id, 42);
  assert.equal(collect.collection_id, 555);
});

test("ShopifyApiProvider creates a new collection when none exists with that title yet", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { product: { id: 42, handle: "sunset-parrot-tee" } }), // create product
    () => jsonResponse(200, { custom_collections: [] }), // no existing collection
    () => jsonResponse(200, { custom_collection: { id: 999, title: "Caribbean Vibes" } }), // create collection
    () => jsonResponse(200, { collect: { id: 1 } }), // link
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.publishProduct({ ...publishRequest, collection: "Caribbean Vibes" });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 4);
  assert.equal(calls[2]?.method, "POST");
  assert.match(calls[2]?.url ?? "", /\/custom_collections\.json$/);
  const collect = calls[3]?.body?.collect as { collection_id: number };
  assert.equal(collect.collection_id, 999);
});

test("ShopifyApiProvider does not touch collections at all when none is requested", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { product: { id: 42, handle: "sunset-parrot-tee" } }),
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  await provider.publishProduct(publishRequest);

  assert.equal(calls.length, 1);
});

test("ShopifyApiProvider's getProduct reads back title, description, images, variants, tags, SEO, and collections", async () => {
  const { fetchImpl, calls } = stubFetch([
    () =>
      jsonResponse(200, {
        product: {
          id: 42,
          title: "Sunset Parrot Tee",
          body_html: "<p>A bold Caribbean design.</p>",
          handle: "sunset-parrot-tee",
          status: "active",
          tags: "caribbean, streetwear",
          product_type: "T-Shirt",
          images: [{ src: "https://cdn.shopify.com/sunset-parrot.png" }],
          variants: [{ id: 900, price: "24.99" }],
        },
      }),
    () =>
      jsonResponse(200, {
        metafields: [
          { namespace: "global", key: "title_tag", value: "Sunset Parrot T-Shirt | Caribbean Streetwear" },
          { namespace: "global", key: "description_tag", value: "Shop the Sunset Parrot tee." },
        ],
      }),
    () => jsonResponse(200, { collects: [{ collection_id: 555 }] }),
    () => jsonResponse(200, { custom_collection: { id: 555, title: "Caribbean Vibes" } }),
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.getProduct("42");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.title, "Sunset Parrot Tee");
  assert.equal(result.value.descriptionHtml, "<p>A bold Caribbean design.</p>");
  assert.equal(result.value.handle, "sunset-parrot-tee");
  assert.equal(result.value.status, "active");
  assert.deepEqual(result.value.tags, ["caribbean", "streetwear"]);
  assert.deepEqual(result.value.imageUrls, ["https://cdn.shopify.com/sunset-parrot.png"]);
  assert.deepEqual(result.value.variants, [{ id: "900", price: 24.99 }]);
  assert.equal(result.value.seoTitle, "Sunset Parrot T-Shirt | Caribbean Streetwear");
  assert.equal(result.value.seoDescription, "Shop the Sunset Parrot tee.");
  assert.deepEqual(result.value.collections, ["Caribbean Vibes"]);
  assert.equal(calls.length, 4);
  assert.match(calls[1]?.url ?? "", /\/products\/42\/metafields\.json\?namespace=global$/);
  assert.match(calls[2]?.url ?? "", /\/collects\.json\?product_id=42$/);
});

test("ShopifyApiProvider's getProduct returns null SEO fields and no collections when the product has neither", async () => {
  const { fetchImpl } = stubFetch([
    () =>
      jsonResponse(200, {
        product: {
          id: 42,
          title: "Sunset Parrot Tee",
          handle: "sunset-parrot-tee",
          status: "active",
          variants: [],
        },
      }),
    () => jsonResponse(200, { metafields: [] }),
    () => jsonResponse(200, { collects: [] }),
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.getProduct("42");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.seoTitle, null);
  assert.equal(result.value.seoDescription, null);
  assert.deepEqual(result.value.collections, []);
  assert.deepEqual(result.value.tags, []);
});

test("ShopifyApiProvider's getProduct rejects a blank product id without calling fetch", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, {})]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.getProduct("  ");

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("ShopifyApiProvider's getProduct reports a response missing required fields as a ValidationError", async () => {
  const { fetchImpl } = stubFetch([() => jsonResponse(200, { product: { id: 42 } })]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.getProduct("42");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
});

test("ShopifyApiProvider logs a completed timing entry bound to the job id on success", async () => {
  const { fetchImpl } = stubFetch([() => jsonResponse(200, { product: { id: 42, handle: "sunset-parrot-tee" } })]);
  const transport = new FakeTransport();
  const logger = new Logger({ module: "automation/shopify", transports: [transport] });
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl, { logger }));

  await provider.publishProduct(publishRequest);

  const completed = transport.entries.find((e) => e.message === "Publish Shopify completed");
  assert.ok(completed);
  assert.equal(completed?.jobId, "job-1");
  assert.equal(completed?.stage, "publish-shopify");
});

test("finalizeExternalProduct sets tags via a PUT, then SEO metafields, then collection assignment", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { product: { id: 555 } }), // PUT tags
    () => jsonResponse(200, {}), // SEO title metafield
    () => jsonResponse(200, {}), // SEO description metafield
    () => jsonResponse(200, { custom_collections: [] }), // findOrCreateCollection: lookup (none found)
    () => jsonResponse(200, { custom_collection: { id: 77, title: "Caribbean Dictionary Series" } }), // create collection
    () => jsonResponse(200, {}), // link product to collection
  ]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.finalizeExternalProduct({
    jobId: "job-1",
    shopifyProductId: "555",
    tags: ["caribbean", "streetwear"],
    seoTitle: "Big Up Yourself Tee",
    seoDescription: "Bold Caribbean streetwear.",
    collection: "Caribbean Dictionary Series",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.shopifyProductId, "555");
  assert.equal(calls.length, 6);
  assert.equal(calls[0]?.method, "PUT");
  assert.match(calls[0]?.url ?? "", /\/products\/555\.json$/);
  const productBody = calls[0]?.body?.product as { id: number; tags: string };
  assert.equal(productBody.tags, "caribbean, streetwear");
  assert.match(calls[1]?.url ?? "", /\/products\/555\/metafields\.json$/);
  assert.match(calls[5]?.url ?? "", /\/collects\.json$/);
  const collectBody = calls[5]?.body?.collect as { product_id: number; collection_id: number };
  assert.equal(collectBody.product_id, 555);
  assert.equal(collectBody.collection_id, 77);
});

test("finalizeExternalProduct skips SEO/collection calls that weren't requested", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, { product: { id: 555 } })]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.finalizeExternalProduct({
    jobId: "job-1",
    shopifyProductId: "555",
    tags: ["caribbean"],
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1); // only the tags PUT — no SEO metafield or collection calls
});

test("finalizeExternalProduct does not call fetch for a blank shopifyProductId", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, {})]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.finalizeExternalProduct({ jobId: "job-1", shopifyProductId: " ", tags: [] });

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});
