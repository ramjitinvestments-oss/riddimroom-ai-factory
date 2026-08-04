import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAiArtworkAnalysisProvider } from "../../automation/ai/openai-artwork-analysis-provider.ts";
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

const VALID_ANALYSIS = {
  collectionId: "vintage-jamaican-sound-systems",
  styleId: "vintage-jamaican-sound-system",
  theme: "vintage sound system culture",
  keywords: ["speaker stack", "sound system", "vintage"],
  title: "Vintage Sound System Tee",
  subtitle: "Caribbean Streetwear Collection",
  description:
    "A towering vintage speaker stack rendered in weathered poster style, bringing real sound system " +
    "heritage to everyday streetwear.",
  seoTitle: "Vintage Sound System T-Shirt | Caribbean Streetwear",
  seoDescription: "Shop the Vintage Sound System tee — original Caribbean streetwear design.",
  tags: [
    "caribbean",
    "streetwear",
    "sound system",
    "vintage",
    "reggae",
    "jamaican",
    "dub",
    "island life",
    "tropical",
    "graphic tee",
  ],
};

interface RecordedCall {
  readonly authorization: string | null;
  readonly body: {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    response_format: { type: string; json_schema: { strict: boolean } };
  };
}

function stubFetch(factories: ReadonlyArray<() => Response>): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({
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

function chatResponse(status: number, content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("OpenAiArtworkAnalysisProvider returns validated analysis on success, with no brief anywhere in the request", async () => {
  const { fetchImpl, calls } = stubFetch([() => chatResponse(200, JSON.stringify(VALID_ANALYSIS))]);
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl });

  const result = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake-png-bytes") });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.provider, "openai");
  assert.equal(result.value.analysis.classification.collectionId, "vintage-jamaican-sound-systems");
  assert.equal(result.value.analysis.copy.title, "Vintage Sound System Tee");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.authorization, "Bearer sk-test");
  assert.equal(calls[0]?.body.model, "gpt-4o-mini");
  assert.equal(calls[0]?.body.response_format.type, "json_schema");
  assert.equal(calls[0]?.body.response_format.json_schema.strict, true);

  const userMessage = calls[0]?.body.messages.find((m) => m.role === "user");
  const content = userMessage?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
  const imagePart = content.find((part) => part.type === "image_url");
  assert.match(imagePart?.image_url?.url ?? "", /^data:image\/png;base64,/);
  const textPart = content.find((part) => part.type === "text");
  assert.doesNotMatch(textPart?.text ?? "", /brief/i);
});

test("OpenAiArtworkAnalysisProvider does not call fetch for blank/empty inputs", async () => {
  const { fetchImpl, calls } = stubFetch([() => chatResponse(200, JSON.stringify(VALID_ANALYSIS))]);
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl });

  const blankJobId = await provider.analyze({ jobId: " ", artworkPng: Buffer.from("x") });
  const emptyArtwork = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.alloc(0) });

  assert.equal(blankJobId.ok, false);
  assert.equal(emptyArtwork.ok, false);
  assert.equal(calls.length, 0);
});

test("OpenAiArtworkAnalysisProvider reports a non-retryable status (401) without retrying", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("unauthorized", { status: 401 })]);
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-bad", fetchImpl, maxAttempts: 3, baseDelayMs: 1 });

  const result = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake") });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "EXTERNAL_SERVICE_ERROR");
    assert.equal((result.error as { statusCode?: number }).statusCode, 401);
  }
  assert.equal(calls.length, 1);
});

test("OpenAiArtworkAnalysisProvider retries a 500 and succeeds once the retry returns a good response", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => new Response("server error", { status: 500 }),
    () => chatResponse(200, JSON.stringify(VALID_ANALYSIS)),
  ]);
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl, maxAttempts: 3, baseDelayMs: 1 });

  const result = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake") });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
});

test("OpenAiArtworkAnalysisProvider exhausts retries on a persistent 429", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("rate limited", { status: 429 })]);
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl, maxAttempts: 2, baseDelayMs: 1 });

  const result = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake") });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal((result.error as { statusCode?: number }).statusCode, 429);
  }
  assert.equal(calls.length, 2);
});

test("OpenAiArtworkAnalysisProvider reports invalid JSON as a ValidationError without retrying", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("not json{{{", { status: 200 })]);
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl, maxAttempts: 3, baseDelayMs: 1 });

  const result = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake") });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
  assert.equal(calls.length, 1);
});

test("OpenAiArtworkAnalysisProvider reports a response missing message content as a ValidationError", async () => {
  const { fetchImpl } = stubFetch([() => new Response(JSON.stringify({ choices: [{}] }), { status: 200 })]);
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl });

  const result = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake") });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
});

test("OpenAiArtworkAnalysisProvider reports schema-invalid message content as a ValidationError", async () => {
  const { title: _title, ...missingTitle } = VALID_ANALYSIS;
  const { fetchImpl } = stubFetch([() => chatResponse(200, JSON.stringify(missingTitle))]);
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl });

  const result = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake") });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
    assert.match(result.error.message, /title/);
  }
});

test("OpenAiArtworkAnalysisProvider reports an unrecognized collectionId as a ValidationError", async () => {
  const { fetchImpl } = stubFetch([
    () => chatResponse(200, JSON.stringify({ ...VALID_ANALYSIS, collectionId: "not-a-real-collection" })),
  ]);
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl });

  const result = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake") });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /not a known Collection Library id/);
  }
});

test("OpenAiArtworkAnalysisProvider treats a raw network failure as retryable", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl, maxAttempts: 3, baseDelayMs: 1 });

  const result = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake") });

  assert.equal(result.ok, false);
  assert.equal(calls, 3);
});

test("OpenAiArtworkAnalysisProvider logs a completed timing entry bound to the job id on success", async () => {
  const { fetchImpl } = stubFetch([() => chatResponse(200, JSON.stringify(VALID_ANALYSIS))]);
  const transport = new FakeTransport();
  const logger = new Logger({ module: "automation/ai", transports: [transport] });
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl, logger });

  await provider.analyze({ jobId: "job-42", artworkPng: Buffer.from("fake") });

  const completed = transport.entries.find((e) => e.message === "Analyze Artwork completed");
  assert.ok(completed);
  assert.equal(completed?.jobId, "job-42");
  assert.equal(completed?.stage, "artwork-analysis");
  assert.equal(typeof completed?.duration, "number");
});

test("OpenAiArtworkAnalysisProvider logs a failed timing entry bound to the job id when analysis ultimately fails", async () => {
  const { fetchImpl } = stubFetch([() => new Response("nope", { status: 401 })]);
  const transport = new FakeTransport();
  const logger = new Logger({ module: "automation/ai", transports: [transport] });
  const provider = new OpenAiArtworkAnalysisProvider({ apiKey: "sk-test", fetchImpl, logger });

  await provider.analyze({ jobId: "job-43", artworkPng: Buffer.from("fake") });

  const failed = transport.entries.find((e) => e.message === "Analyze Artwork failed");
  assert.ok(failed);
  assert.equal(failed?.jobId, "job-43");
  assert.equal(failed?.level, "error");
});
