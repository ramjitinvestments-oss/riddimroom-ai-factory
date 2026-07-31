import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAiImageProvider } from "../../automation/ai/openai-provider.ts";
import { createSolidPng } from "../../automation/ai/png.ts";
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
  readonly body: { model: string; prompt: string; size: string; n: number; background: string };
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successBody(): unknown {
  const png = createSolidPng(4, 4, { r: 1, g: 2, b: 3, a: 255 });
  return {
    data: [{ b64_json: png.toString("base64"), revised_prompt: "a refined parrot" }],
  };
}

test("OpenAiImageProvider returns a decoded, validated PNG on success", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, successBody())]);
  const provider = new OpenAiImageProvider({ apiKey: "sk-test", fetchImpl });

  const result = await provider.generate({ jobId: "job-1", prompt: "a parrot" });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.provider, "openai");
  assert.equal(result.value.width, 4);
  assert.equal(result.value.height, 4);
  assert.equal(result.value.metadata.revisedPrompt, "a refined parrot");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.authorization, "Bearer sk-test");
  assert.equal(calls[0]?.body.model, "gpt-image-1");
  assert.equal(calls[0]?.body.background, "transparent");
  assert.match(calls[0]?.body.prompt ?? "", /flat vector illustration/);
});

test("OpenAiImageProvider does not call fetch for a blank prompt or jobId", async () => {
  const { fetchImpl, calls } = stubFetch([() => jsonResponse(200, successBody())]);
  const provider = new OpenAiImageProvider({ apiKey: "sk-test", fetchImpl });

  const blankPrompt = await provider.generate({ jobId: "job-1", prompt: "  " });
  const blankJobId = await provider.generate({ jobId: " ", prompt: "a parrot" });

  assert.equal(blankPrompt.ok, false);
  assert.equal(blankJobId.ok, false);
  assert.equal(calls.length, 0);
});

test("OpenAiImageProvider reports a non-retryable status (401) as an ExternalServiceError without retrying", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("unauthorized", { status: 401 })]);
  const provider = new OpenAiImageProvider({
    apiKey: "sk-bad",
    fetchImpl,
    maxAttempts: 3,
    baseDelayMs: 1,
  });

  const result = await provider.generate({ jobId: "job-1", prompt: "a parrot" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "EXTERNAL_SERVICE_ERROR");
    assert.equal((result.error as { statusCode?: number }).statusCode, 401);
  }
  assert.equal(calls.length, 1);
});

test("OpenAiImageProvider retries a 500 and succeeds once the retry returns a good response", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => new Response("server error", { status: 500 }),
    () => jsonResponse(200, successBody()),
  ]);
  const provider = new OpenAiImageProvider({
    apiKey: "sk-test",
    fetchImpl,
    maxAttempts: 3,
    baseDelayMs: 1,
  });

  const result = await provider.generate({ jobId: "job-1", prompt: "a parrot" });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
});

test("OpenAiImageProvider exhausts retries on a persistent 429 and reports the failure", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("rate limited", { status: 429 })]);
  const provider = new OpenAiImageProvider({
    apiKey: "sk-test",
    fetchImpl,
    maxAttempts: 2,
    baseDelayMs: 1,
  });

  const result = await provider.generate({ jobId: "job-1", prompt: "a parrot" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal((result.error as { statusCode?: number }).statusCode, 429);
  }
  assert.equal(calls.length, 2);
});

test("OpenAiImageProvider reports invalid JSON as a ValidationError without retrying", async () => {
  const { fetchImpl, calls } = stubFetch([() => new Response("not json{{{", { status: 200 })]);
  const provider = new OpenAiImageProvider({
    apiKey: "sk-test",
    fetchImpl,
    maxAttempts: 3,
    baseDelayMs: 1,
  });

  const result = await provider.generate({ jobId: "job-1", prompt: "a parrot" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
  assert.equal(calls.length, 1);
});

test("OpenAiImageProvider reports a response missing image data as a ValidationError", async () => {
  const { fetchImpl } = stubFetch([() => jsonResponse(200, { data: [{}] })]);
  const provider = new OpenAiImageProvider({ apiKey: "sk-test", fetchImpl });

  const result = await provider.generate({ jobId: "job-1", prompt: "a parrot" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
});

test("OpenAiImageProvider reports non-PNG image data as a ValidationError", async () => {
  const garbage = Buffer.from("this is not a png").toString("base64");
  const { fetchImpl } = stubFetch([() => jsonResponse(200, { data: [{ b64_json: garbage }] })]);
  const provider = new OpenAiImageProvider({ apiKey: "sk-test", fetchImpl });

  const result = await provider.generate({ jobId: "job-1", prompt: "a parrot" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "VALIDATION_ERROR");
  }
});

test("OpenAiImageProvider treats a raw network failure as retryable", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  const provider = new OpenAiImageProvider({
    apiKey: "sk-test",
    fetchImpl,
    maxAttempts: 3,
    baseDelayMs: 1,
  });

  const result = await provider.generate({ jobId: "job-1", prompt: "a parrot" });

  assert.equal(result.ok, false);
  assert.equal(calls, 3);
});

test("OpenAiImageProvider logs a completed timing entry bound to the job id on success", async () => {
  const { fetchImpl } = stubFetch([() => jsonResponse(200, successBody())]);
  const transport = new FakeTransport();
  const logger = new Logger({ module: "automation/ai", transports: [transport] });
  const provider = new OpenAiImageProvider({ apiKey: "sk-test", fetchImpl, logger });

  await provider.generate({ jobId: "job-42", prompt: "a parrot" });

  const completed = transport.entries.find((e) => e.message === "Generate Artwork completed");
  assert.ok(completed);
  assert.equal(completed?.jobId, "job-42");
  assert.equal(completed?.stage, "generate");
  assert.equal(typeof completed?.duration, "number");
});

test("OpenAiImageProvider logs a failed timing entry bound to the job id when generation ultimately fails", async () => {
  const { fetchImpl } = stubFetch([() => new Response("nope", { status: 401 })]);
  const transport = new FakeTransport();
  const logger = new Logger({ module: "automation/ai", transports: [transport] });
  const provider = new OpenAiImageProvider({ apiKey: "sk-test", fetchImpl, logger });

  await provider.generate({ jobId: "job-43", prompt: "a parrot" });

  const failed = transport.entries.find((e) => e.message === "Generate Artwork failed");
  assert.ok(failed);
  assert.equal(failed?.jobId, "job-43");
  assert.equal(failed?.level, "error");
});
