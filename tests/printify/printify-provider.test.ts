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
