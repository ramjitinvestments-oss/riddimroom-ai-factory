import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ClientCredentialsTokenProvider,
  type ClientCredentialsTokenProviderOptions,
} from "../../automation/shopify/client-credentials-token-provider.ts";

interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly body: Record<string, unknown> | null;
}

function stubFetch(factories: ReadonlyArray<() => Response>): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      method: String(init?.method ?? "GET"),
      url: String(input),
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
  overrides: Partial<ClientCredentialsTokenProviderOptions> = {},
): ClientCredentialsTokenProviderOptions {
  return {
    storeDomain: "riddimroom.myshopify.com",
    clientId: "client-id",
    clientSecret: "client-secret",
    fetchImpl,
    ...overrides,
  };
}

// --- token acquisition ---

test("requests a token via the client credentials grant and returns it", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { access_token: "shpat_fresh", expires_in: 86399 }),
  ]);
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl));

  const result = await provider.getToken();

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value : null, "shpat_fresh");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "POST");
  assert.match(calls[0]?.url ?? "", /riddimroom\.myshopify\.com\/admin\/oauth\/access_token$/);
  assert.deepEqual(calls[0]?.body, {
    client_id: "client-id",
    client_secret: "client-secret",
    grant_type: "client_credentials",
  });
});

test("defaults the token lifetime to 86399s when expires_in is omitted", async () => {
  let now = 0;
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, { access_token: "shpat_a" })]);
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl, { now: () => now }));

  await provider.getToken();
  now = 86399 * 1000 - 61_000; // just outside the default 60s refresh buffer
  const stillCached = await provider.getToken();

  assert.equal(stillCached.ok ? stillCached.value : null, "shpat_a");
  assert.equal(calls.length, 1);
});

// --- cache reuse ---

test("reuses the cached token across calls instead of refetching", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { access_token: "shpat_cached", expires_in: 3600 }),
  ]);
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl, { now: () => 0 }));

  const first = await provider.getToken();
  const second = await provider.getToken();
  const third = await provider.getToken();

  assert.equal(first.ok ? first.value : null, "shpat_cached");
  assert.equal(second.ok ? second.value : null, "shpat_cached");
  assert.equal(third.ok ? third.value : null, "shpat_cached");
  assert.equal(calls.length, 1);
});

test("coalesces concurrent calls during a refresh into a single request", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { access_token: "shpat_concurrent", expires_in: 3600 }),
  ]);
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl, { now: () => 0 }));

  const [a, b] = await Promise.all([provider.getToken(), provider.getToken()]);

  assert.equal(a.ok ? a.value : null, "shpat_concurrent");
  assert.equal(b.ok ? b.value : null, "shpat_concurrent");
  assert.equal(calls.length, 1);
});

// --- automatic refresh ---

test("automatically refreshes once the cached token is within the refresh buffer of expiring", async () => {
  let now = 0;
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { access_token: "shpat_first", expires_in: 3600 }),
    () => jsonResponse(200, { access_token: "shpat_second", expires_in: 3600 }),
  ]);
  const provider = new ClientCredentialsTokenProvider(
    baseOptions(fetchImpl, { now: () => now, refreshBufferMs: 60_000 }),
  );

  const first = await provider.getToken();
  assert.equal(first.ok ? first.value : null, "shpat_first");

  // Advance to just inside the refresh buffer before the 3600s expiry.
  now = 3600 * 1000 - 60_000 + 1;
  const second = await provider.getToken();

  assert.equal(second.ok ? second.value : null, "shpat_second");
  assert.equal(calls.length, 2);
});

test("does not refresh before the cached token enters the refresh buffer", async () => {
  let now = 0;
  const { fetchImpl, calls } = stubFetch([
    () => jsonResponse(200, { access_token: "shpat_first", expires_in: 3600 }),
  ]);
  const provider = new ClientCredentialsTokenProvider(
    baseOptions(fetchImpl, { now: () => now, refreshBufferMs: 60_000 }),
  );

  await provider.getToken();
  now = 3600 * 1000 - 60_001; // one ms before entering the buffer
  const result = await provider.getToken();

  assert.equal(result.ok ? result.value : null, "shpat_first");
  assert.equal(calls.length, 1);
});

// --- authentication failures ---

test("reports an ExternalServiceError with statusCode on a 401 and does not retry", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("unauthorized", { status: 401 })]);
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl, { maxAttempts: 3, baseDelayMs: 1 }));

  const result = await provider.getToken();

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "EXTERNAL_SERVICE_ERROR");
    assert.equal(result.error.statusCode, 401);
  }
  assert.equal(calls.length, 1);
});

test("retries a 500 and succeeds once the retry goes through", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => new Response("server error", { status: 500 }),
    () => jsonResponse(200, { access_token: "shpat_retried", expires_in: 3600 }),
  ]);
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl, { maxAttempts: 3, baseDelayMs: 1 }));

  const result = await provider.getToken();

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value : null, "shpat_retried");
  assert.equal(calls.length, 2);
});

test("exhausts retries on a persistent 429", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("rate limited", { status: 429 })]);
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl, { maxAttempts: 2, baseDelayMs: 1 }));

  const result = await provider.getToken();

  assert.equal(result.ok, false);
  assert.equal(calls.length, 2);
});

test("reports an ExternalServiceError when the response body has no access_token", async () => {
  const { fetchImpl } = stubFetch([() => jsonResponse(200, { expires_in: 3600 })]);
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl, { maxAttempts: 1 }));

  const result = await provider.getToken();

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "EXTERNAL_SERVICE_ERROR");
    assert.match(result.error.message, /access_token/);
  }
});

test("reports an ExternalServiceError when the response body is not valid JSON", async () => {
  const fetchImpl = (async () => new Response("not json", { status: 200 })) as typeof fetch;
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl, { maxAttempts: 1 }));

  const result = await provider.getToken();

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "EXTERNAL_SERVICE_ERROR");
  }
});

test("reports an ExternalServiceError when the network request itself fails", async () => {
  const fetchImpl = (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch;
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl, { maxAttempts: 1 }));

  const result = await provider.getToken();

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "EXTERNAL_SERVICE_ERROR");
  }
});

test("retries again (not sharing a failed in-flight request) after a failed fetch", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => new Response("unauthorized", { status: 401 }),
    () => jsonResponse(200, { access_token: "shpat_after_failure", expires_in: 3600 }),
  ]);
  const provider = new ClientCredentialsTokenProvider(baseOptions(fetchImpl, { maxAttempts: 1 }));

  const first = await provider.getToken();
  const second = await provider.getToken();

  assert.equal(first.ok, false);
  assert.equal(second.ok, true);
  assert.equal(second.ok ? second.value : null, "shpat_after_failure");
  assert.equal(calls.length, 2);
});
