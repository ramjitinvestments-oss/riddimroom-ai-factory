import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PrintifyApiProvider,
  type PrintifyProviderOptions,
} from "../../automation/printify/printify-provider.ts";
import { Logger } from "../../automation/shared/logger.ts";
import type { FileOperationError } from "../../automation/shared/errors.ts";
import { err, ok, type Result } from "../../automation/shared/result.ts";
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
  readonly url: string;
  readonly authorization: string | null;
  readonly body: Record<string, unknown>;
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
      url: String(input),
      authorization: headers.get("authorization"),
      body: JSON.parse(String(init?.body ?? "{}")),
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
  overrides: Partial<PrintifyProviderOptions> = {},
): PrintifyProviderOptions {
  return {
    apiKey: "pk-test",
    shopId: "shop-1",
    blueprintId: 5,
    printProviderId: 9,
    variantIds: [111, 222],
    fetchImpl,
    ...overrides,
  };
}

const request = {
  jobId: "job-1",
  title: "Sunset Parrot Tee",
  description: "A bold Caribbean design.",
  artworkPng: Buffer.from("fake-png-bytes"),
  priceUsd: 27.99,
};

test("PrintifyApiProvider uploads the image then creates the product on success", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { id: "img-1" }),
    () => jsonResponse(200, { id: "prod-1" }),
  ]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.uploadProduct(request);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.printifyImageId, "img-1");
  assert.equal(result.value.printifyProductId, "prod-1");
  assert.equal(calls.length, 2);
  assert.match(calls[0]?.url ?? "", /\/uploads\/images\.json$/);
  assert.match(calls[1]?.url ?? "", /\/shops\/shop-1\/products\.json$/);
  assert.equal(calls[0]?.authorization, "Bearer pk-test");
  assert.equal(calls[1]?.body.blueprint_id, 5);
  assert.equal(calls[1]?.body.print_provider_id, 9);
  const variants = calls[1]?.body.variants as Array<{ id: number; price: number }>;
  assert.deepEqual(
    variants.map((v) => v.id),
    [111, 222],
  );
  assert.equal(variants[0]?.price, 2799);
  assert.deepEqual(result.value.mockupUrls, []); // stub response had no "images" field
});

test("PrintifyApiProvider surfaces mockup image URLs Printify returns on product creation", async () => {
  const { fetchImpl } = stubFetch([
    () => jsonResponse(200, { id: "img-1" }),
    () =>
      jsonResponse(200, {
        id: "prod-1",
        images: [{ src: "https://images.printify.com/mockup-front.jpg" }, { src: "https://images.printify.com/mockup-back.jpg" }, {}],
      }),
  ]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.uploadProduct(request);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.mockupUrls, [
    "https://images.printify.com/mockup-front.jpg",
    "https://images.printify.com/mockup-back.jpg",
  ]);
});

test("PrintifyApiProvider sends the upper-chest placement standard by default (x=0.5, y=0.35, scale=0.85)", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { id: "img-1" }),
    () => jsonResponse(200, { id: "prod-1" }),
  ]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  await provider.uploadProduct(request);

  const printAreas = calls[1]?.body.print_areas as Array<{ placeholders: Array<{ images: Array<{ x: number; y: number; scale: number; angle: number }> }> }>;
  const image = printAreas[0]?.placeholders[0]?.images[0];
  assert.deepEqual(image, { id: "img-1", x: 0.5, y: 0.35, scale: 0.85, angle: 0 });
});

test("PrintifyApiProvider uses a custom print placement when provided", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { id: "img-1" }),
    () => jsonResponse(200, { id: "prod-1" }),
  ]);
  const provider = new PrintifyApiProvider(
    baseOptions(fetchImpl, { placementX: 0.5, placementY: 0.4, placementScale: 0.9 }),
  );

  await provider.uploadProduct(request);

  const printAreas = calls[1]?.body.print_areas as Array<{ placeholders: Array<{ images: Array<{ x: number; y: number; scale: number; angle: number }> }> }>;
  const image = printAreas[0]?.placeholders[0]?.images[0];
  assert.deepEqual(image, { id: "img-1", x: 0.5, y: 0.4, scale: 0.9, angle: 0 });
});

test("PrintifyApiProvider does not call fetch for invalid inputs", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, { id: "img-1" })]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const blankTitle = await provider.uploadProduct({ ...request, title: "  " });
  const emptyArtwork = await provider.uploadProduct({ ...request, artworkPng: Buffer.alloc(0) });
  const noVariants = await new PrintifyApiProvider(
    baseOptions(fetchImpl, { variantIds: [] }),
  ).uploadProduct(request);

  assert.equal(blankTitle.ok, false);
  assert.equal(emptyArtwork.ok, false);
  assert.equal(noVariants.ok, false);
  assert.equal(calls.length, 0);
});

test("PrintifyApiProvider reports a non-retryable status (401) without retrying", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("unauthorized", { status: 401 })]);
  const provider = new PrintifyApiProvider(
    baseOptions(fetchImpl, { maxAttempts: 3, baseDelayMs: 1 }),
  );

  const result = await provider.uploadProduct(request);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal((result.error as { statusCode?: number }).statusCode, 401);
  }
  assert.equal(calls.length, 1);
});

test("PrintifyApiProvider retries a 500 on image upload and succeeds once the retry goes through", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => new Response("server error", { status: 500 }),
    () => jsonResponse(200, { id: "img-1" }),
    () => jsonResponse(200, { id: "prod-1" }),
  ]);
  const provider = new PrintifyApiProvider(
    baseOptions(fetchImpl, { maxAttempts: 3, baseDelayMs: 1 }),
  );

  const result = await provider.uploadProduct(request);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
});

test("PrintifyApiProvider exhausts retries on a persistent 429", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("rate limited", { status: 429 })]);
  const provider = new PrintifyApiProvider(
    baseOptions(fetchImpl, { maxAttempts: 2, baseDelayMs: 1 }),
  );

  const result = await provider.uploadProduct(request);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal((result.error as { statusCode?: number }).statusCode, 429);
  }
  assert.equal(calls.length, 2);
});

test("PrintifyApiProvider reports a response missing an id as a ValidationError", async () => {
  const { fetchImpl } = stubFetch([() => jsonResponse(200, { notId: "oops" })]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.uploadProduct(request);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
});

test("PrintifyApiProvider treats a raw network failure as retryable", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const provider = new PrintifyApiProvider(
    baseOptions(fetchImpl, { maxAttempts: 3, baseDelayMs: 1 }),
  );

  const result = await provider.uploadProduct(request);

  assert.equal(result.ok, false);
  assert.equal(calls, 3);
});

test("PrintifyApiProvider logs a completed timing entry bound to the job id on success", async () => {
  const { fetchImpl } = stubFetch([
    () => jsonResponse(200, { id: "img-1" }),
    () => jsonResponse(200, { id: "prod-1" }),
  ]);
  const transport = new FakeTransport();
  const logger = new Logger({ module: "automation/printify", transports: [transport] });
  const provider = new PrintifyApiProvider(
    baseOptions(fetchImpl, { logger }),
  );

  await provider.uploadProduct(request);

  const completed = transport.entries.find((e) => e.message === "Upload Printify completed");
  assert.ok(completed);
  assert.equal(completed?.jobId, "job-1");
  assert.equal(completed?.stage, "upload-printify");
});

test("PrintifyApiProvider logs a failed timing entry bound to the job id when upload ultimately fails", async () => {
  const { fetchImpl } = stubFetch([() => new Response("nope", { status: 401 })]);
  const transport = new FakeTransport();
  const logger = new Logger({ module: "automation/printify", transports: [transport] });
  const provider = new PrintifyApiProvider(
    baseOptions(fetchImpl, { logger }),
  );

  await provider.uploadProduct(request);

  const failed = transport.entries.find((e) => e.message === "Upload Printify failed");
  assert.ok(failed);
  assert.equal(failed?.level, "error");
});

test("publishProductToShopify calls publish.json then returns the Shopify id once the first poll already has it", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, {}), // POST .../publish.json — Printify's real response is an empty ack
    () => jsonResponse(200, { id: "prod-1", external: { id: "shop-prod-99", handle: "big-up-tee" } }),
  ]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl, { sleepImpl: async () => {} }));

  const result = await provider.publishProductToShopify({ jobId: "job-1", printifyProductId: "prod-1" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.shopifyProductId, "shop-prod-99");
  assert.equal(result.value.shopifyHandle, "big-up-tee");
  assert.equal(calls.length, 2);
  assert.match(calls[0]?.url ?? "", /\/shops\/shop-1\/products\/prod-1\/publish\.json$/);
  assert.deepEqual(calls[0]?.body, { title: true, description: true, images: true, variants: true, tags: false });
});

test("publishProductToShopify polls until Printify reports the external Shopify id", async () => {
  let sleeps = 0;
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, {}), // publish
    () => jsonResponse(200, { id: "prod-1", external: null }), // still processing
    () => jsonResponse(200, { id: "prod-1", external: {} }), // still no id yet
    () => jsonResponse(200, { id: "prod-1", external: { id: "shop-prod-99" } }), // done
  ]);
  const provider = new PrintifyApiProvider(
    baseOptions(fetchImpl, {
      sleepImpl: async () => {
        sleeps += 1;
      },
    }),
  );

  const result = await provider.publishProductToShopify({ jobId: "job-1", printifyProductId: "prod-1" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.shopifyProductId, "shop-prod-99");
  assert.equal(result.value.shopifyHandle, null);
  assert.equal(calls.length, 4);
  assert.equal(sleeps, 2);
});

test("publishProductToShopify gives up once maxWaitMs elapses without an external id, without ever re-publishing", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, {}), // publish
    () => jsonResponse(200, { id: "prod-1", external: null }), // poll 1 — deadline not yet reached
    () => jsonResponse(200, { id: "prod-1", external: null }), // poll 2 — deadline reached, gives up
  ]);
  // Deterministic fake clock: 0 at start, advances by 10ms per call. With maxWaitMs=15 the
  // deadline (10) is still in the future after poll 1 (nowImpl()=10) but reached at poll 2
  // (nowImpl()=20) — no dependence on real wall-clock time, so this can never be flaky.
  let clock = 0;
  const provider = new PrintifyApiProvider(
    baseOptions(fetchImpl, {
      sleepImpl: async () => {},
      nowImpl: () => {
        const value = clock;
        clock += 10;
        return value;
      },
    }),
  );

  const result = await provider.publishProductToShopify({
    jobId: "job-1",
    printifyProductId: "prod-1",
    maxWaitMs: 15,
    pollIntervalMs: 1,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /had not reported a Shopify product id/);
  }
  // Exactly one publish call — never called publish.json twice even after giving up.
  const publishCalls = calls.filter((c) => c.url.endsWith("/publish.json"));
  assert.equal(publishCalls.length, 1);
  assert.equal(calls.length, 3);
});

test("publishProductToShopify does not call fetch for a blank printifyProductId", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, {})]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.publishProductToShopify({ jobId: "job-1", printifyProductId: "  " });

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("updateProductColorAndPlacement explicitly disables previously-enabled variants that aren't in the new target set", async () => {
  const { fetchImpl, calls } = stubFetch([
    // GET current product state: two variants enabled from the initial creation color.
    () => jsonResponse(200, { id: "prod-1", variants: [{ id: 111, is_enabled: true }, { id: 222, is_enabled: true }] }),
    // PUT the update.
    () => jsonResponse(200, { id: "prod-1" }),
  ]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.updateProductColorAndPlacement({
    jobId: "job-1",
    printifyProductId: "prod-1",
    printifyImageId: "img-1",
    title: "Big Up Yourself T-Shirt",
    description: "A bold Caribbean design.",
    priceUsd: 24.99,
    variantIds: [333, 444],
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, "https://api.printify.com/v1/shops/shop-1/products/prod-1.json");
  const putCall = calls[1];
  assert.equal(putCall?.url, "https://api.printify.com/v1/shops/shop-1/products/prod-1.json");
  const variants = putCall?.body.variants as Array<{ id: number; is_enabled: boolean }>;
  assert.deepEqual(
    variants.map((v) => ({ id: v.id, is_enabled: v.is_enabled })),
    [
      { id: 333, is_enabled: true },
      { id: 444, is_enabled: true },
      { id: 111, is_enabled: false },
      { id: 222, is_enabled: false },
    ],
  );
  // print_areas must cover every variant id in this request's `variants` array, including the
  // ones being explicitly disabled -- not just the new enabled set (see the doc comment on
  // callUpdateProduct for why: Printify's 8251 validation checks the whole `variants` payload).
  const printAreas = putCall?.body.print_areas as Array<{ variant_ids: number[] }>;
  assert.deepEqual(printAreas[0]?.variant_ids, [333, 444, 111, 222]);
});

test("updateProductColorAndPlacement does not disable variants that are already in the target set", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { id: "prod-1", variants: [{ id: 333, is_enabled: true }, { id: 999, is_enabled: false }] }),
    () => jsonResponse(200, { id: "prod-1" }),
  ]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  await provider.updateProductColorAndPlacement({
    jobId: "job-1",
    printifyProductId: "prod-1",
    printifyImageId: "img-1",
    title: "Big Up Yourself T-Shirt",
    description: "A bold Caribbean design.",
    priceUsd: 24.99,
    variantIds: [333, 444],
  });

  const variants = calls[1]?.body.variants as Array<{ id: number; is_enabled: boolean }>;
  // 999 was already disabled, so no need to send a redundant disable for it.
  assert.deepEqual(
    variants.map((v) => ({ id: v.id, is_enabled: v.is_enabled })),
    [
      { id: 333, is_enabled: true },
      { id: 444, is_enabled: true },
    ],
  );
});

test("updateProductColorAndPlacement preserves the product's existing broad print_areas coverage instead of narrowing it", async () => {
  // Reproduces the real 2026-08-05 incident: Printify auto-populates print_areas.variant_ids with
  // every variant sharing this blueprint+provider's placement -- a much larger set than what was
  // ever explicitly enabled. A PUT that only lists the new target (+ disabled) ids drops that
  // existing coverage and Printify rejects it with error 8251, even though every *enabled* variant
  // is technically covered by the narrower list.
  const { fetchImpl, calls } = stubFetch([
    () =>
      jsonResponse(200, {
        id: "prod-1",
        variants: [{ id: 18100, is_enabled: true }, { id: 18540, is_enabled: true }],
        print_areas: [{ variant_ids: [18051, 18052, 18053, 18540] }],
      }),
    () => jsonResponse(200, { id: "prod-1" }),
  ]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.updateProductColorAndPlacement({
    jobId: "job-1",
    printifyProductId: "prod-1",
    printifyImageId: "img-1",
    title: "Big Up Yourself T-Shirt",
    description: "A bold Caribbean design.",
    priceUsd: 24.99,
    variantIds: [18100, 18101],
  });

  assert.equal(result.ok, true);
  const printAreas = calls[1]?.body.print_areas as Array<{ variant_ids: number[] }>;
  // Union of: what was already covered server-side (18051,18052,18053,18540), the new enabled
  // target (18100,18101), and the newly-disabled id (18540 is already present, so no duplicate).
  assert.deepEqual(printAreas[0]?.variant_ids, [18051, 18052, 18053, 18540, 18100, 18101]);
});

test("findProductIdByTitle finds a case-insensitive exact match on the first page", async () => {
  const { fetchImpl, calls } = stubFetch([
    () =>
      jsonResponse(200, {
        data: [{ id: "prod-1", title: "Riddim Typography Tee" }, { id: "prod-2", title: "Watch Nah T-Shirt" }],
        last_page: 1,
      }),
  ]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.findProductIdByTitle("riddim typography tee");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value, "prod-1");
  assert.equal(calls.length, 1);
});

test("findProductIdByTitle pages through results until it finds a match", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { data: [{ id: "prod-1", title: "Big Up Yourself T-Shirt" }], last_page: 3 }),
    () => jsonResponse(200, { data: [{ id: "prod-2", title: "Chipping: Slow Dance T-Shirt" }], last_page: 3 }),
    () => jsonResponse(200, { data: [{ id: "prod-3", title: "Watch Nah T-Shirt" }], last_page: 3 }),
  ]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.findProductIdByTitle("Watch Nah T-Shirt");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value, "prod-3");
  assert.equal(calls.length, 3);
});

test("findProductIdByTitle returns null (not an error) when nothing matches after the last page", async () => {
  const { fetchImpl } = stubFetch([() => jsonResponse(200, { data: [{ id: "prod-1", title: "Something Else" }], last_page: 1 })]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.findProductIdByTitle("Nonexistent Product");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value, null);
});

test("findProductIdByTitle does not call fetch for a blank title", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, {})]);
  const provider = new PrintifyApiProvider(baseOptions(fetchImpl));

  const result = await provider.findProductIdByTitle("   ");

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});
