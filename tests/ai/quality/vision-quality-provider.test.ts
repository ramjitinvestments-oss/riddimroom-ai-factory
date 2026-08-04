import { test } from "node:test";
import assert from "node:assert/strict";
import { VisionQualityProvider } from "../../../automation/ai/quality/vision-quality-provider.ts";
import { InMemoryVisionSpendLedger } from "../../../automation/ai/quality/vision-budget.ts";

const VALID_SCORE = {
  overall: 96,
  commercial: 98,
  composition: 95,
  thumbnail: 99,
  printability: 97,
  branding: 94,
  recommendation: "approve",
};

interface RecordedCall {
  readonly authorization: string | null;
  readonly body: {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    response_format: { type: string; json_schema: { strict: boolean } };
  };
}

function stubFetch(factories: ReadonlyArray<() => Response>): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({ authorization: headers.get("authorization"), body: JSON.parse(String(init?.body ?? "{}")) });
    const factory = factories[Math.min(index, factories.length - 1)];
    index += 1;
    if (factory === undefined) {
      throw new Error("no fetch stub configured");
    }
    return factory();
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function chatResponse(status: number, content: string, usage?: { prompt_tokens: number; completion_tokens: number }): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage }),
    { status, headers: { "content-type": "application/json" } },
  );
}

test("returns a validated VisionScore on success and sends the image as vision input", async () => {
  const { fetchImpl, calls } = stubFetch([() => chatResponse(200, JSON.stringify(VALID_SCORE))]);
  const provider = new VisionQualityProvider({ apiKey: "sk-test", fetchImpl });

  const result = await provider.score(Buffer.from("fake-png-bytes"), { category: "speaker_stack" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.overall, 96);
  assert.equal(result.value.recommendation, "approve");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.authorization, "Bearer sk-test");
  assert.equal(calls[0]?.body.response_format.json_schema.strict, true);

  const userMessage = calls[0]?.body.messages.find((m) => m.role === "user");
  const content = userMessage?.content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
  const imagePart = content.find((part) => part.type === "image_url");
  assert.match(imagePart?.image_url?.url ?? "", /^data:image\/png;base64,/);
  const textPart = content.find((part) => part.type === "text");
  assert.match(textPart?.text ?? "", /speaker_stack/);
});

test("rejects an empty image buffer without calling fetch", async () => {
  const { fetchImpl, calls } = stubFetch([() => chatResponse(200, JSON.stringify(VALID_SCORE))]);
  const provider = new VisionQualityProvider({ apiKey: "sk-test", fetchImpl });

  const result = await provider.score(Buffer.alloc(0));

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("reports a schema-invalid score as a ValidationError", async () => {
  const { overall: _overall, ...missingOverall } = VALID_SCORE;
  const { fetchImpl } = stubFetch([() => chatResponse(200, JSON.stringify(missingOverall))]);
  const provider = new VisionQualityProvider({ apiKey: "sk-test", fetchImpl });

  const result = await provider.score(Buffer.from("fake"));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
});

test("records estimated spend to the ledger based on actual token usage", async () => {
  const { fetchImpl } = stubFetch([
    () => chatResponse(200, JSON.stringify(VALID_SCORE), { prompt_tokens: 1000, completion_tokens: 100 }),
  ]);
  const ledger = new InMemoryVisionSpendLedger();
  const provider = new VisionQualityProvider({ apiKey: "sk-test", fetchImpl, ledger });

  await provider.score(Buffer.from("fake"));

  const spend = ledger.todaySpend();
  assert.ok(spend > 0, "expected some spend to be recorded");
  // 1000 prompt tokens * $0.15/1M + 100 completion tokens * $0.60/1M
  const expected = (1000 / 1_000_000) * 0.15 + (100 / 1_000_000) * 0.6;
  assert.ok(Math.abs(spend - expected) < 1e-9, `expected ~${expected}, got ${spend}`);
});

test("does not record spend when no ledger is configured", async () => {
  const { fetchImpl } = stubFetch([() => chatResponse(200, JSON.stringify(VALID_SCORE))]);
  const provider = new VisionQualityProvider({ apiKey: "sk-test", fetchImpl });
  const result = await provider.score(Buffer.from("fake"));
  assert.equal(result.ok, true);
});

test("reports a non-retryable status (401) without retrying", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("unauthorized", { status: 401 })]);
  const provider = new VisionQualityProvider({ apiKey: "sk-bad", fetchImpl, maxAttempts: 3, baseDelayMs: 1 });

  const result = await provider.score(Buffer.from("fake"));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "EXTERNAL_SERVICE_ERROR");
    assert.equal((result.error as { statusCode?: number }).statusCode, 401);
  }
  assert.equal(calls.length, 1);
});

test("retries a 500 and succeeds once the retry returns a good response", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => new Response("server error", { status: 500 }),
    () => chatResponse(200, JSON.stringify(VALID_SCORE)),
  ]);
  const provider = new VisionQualityProvider({ apiKey: "sk-test", fetchImpl, maxAttempts: 3, baseDelayMs: 1 });

  const result = await provider.score(Buffer.from("fake"));

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
});
