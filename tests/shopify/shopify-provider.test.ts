import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ShopifyApiProvider,
  type ShopifyProviderOptions,
} from "../../automation/shopify/shopify-provider.ts";
import { Logger } from "../../automation/shared/logger.ts";
import type { FileOperationError } from "../../automation/shared/errors.ts";
import { ok, type Result } from "../../automation/shared/result.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";

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
    accessToken: "shpat_test",
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
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, { product: { id: 987654321 } })]);
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.publishProduct(publishRequest);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.shopifyProductId, "987654321");
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
    () => jsonResponse(200, { product: { id: 42 } }),
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

test("ShopifyApiProvider logs a completed timing entry bound to the job id on success", async () => {
  const { fetchImpl } = stubFetch([() => jsonResponse(200, { product: { id: 42 } })]);
  const transport = new FakeTransport();
  const logger = new Logger({ module: "automation/shopify", transports: [transport] });
  const provider = new ShopifyApiProvider(baseOptions(fetchImpl, { logger }));

  await provider.publishProduct(publishRequest);

  const completed = transport.entries.find((e) => e.message === "Publish Shopify completed");
  assert.ok(completed);
  assert.equal(completed?.jobId, "job-1");
  assert.equal(completed?.stage, "publish-shopify");
});
