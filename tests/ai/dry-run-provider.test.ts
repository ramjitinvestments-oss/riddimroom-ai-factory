import { test } from "node:test";
import assert from "node:assert/strict";
import { DryRunImageProvider } from "../../automation/ai/dry-run-provider.ts";
import { readPngDimensions } from "../../automation/ai/png.ts";

test("DryRunImageProvider produces a valid PNG at the default size without any network call", async () => {
  const provider = new DryRunImageProvider({ now: () => new Date("2026-07-31T00:00:00.000Z") });

  const result = await provider.generate({ jobId: "job-1", prompt: "a parrot" });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.jobId, "job-1");
  assert.equal(result.value.provider, "dry-run");
  assert.equal(result.value.width, 1024);
  assert.equal(result.value.height, 1024);
  assert.equal(result.value.generatedAt, "2026-07-31T00:00:00.000Z");

  const dimensions = readPngDimensions(result.value.imageBuffer);
  assert.equal(dimensions.ok, true);
});

test("DryRunImageProvider honors a requested non-square size", async () => {
  const provider = new DryRunImageProvider();
  const result = await provider.generate({ jobId: "job-2", prompt: "a mango", size: "1024x1536" });

  assert.ok(result.ok);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.width, 1024);
  assert.equal(result.value.height, 1536);
});

test("DryRunImageProvider augments the prompt with the shared style/safety directives", async () => {
  const provider = new DryRunImageProvider();
  const result = await provider.generate({ jobId: "job-3", prompt: "a mango" });

  assert.ok(result.ok);
  if (result.ok) {
    assert.match(result.value.prompt, /flat vector illustration/);
  }
});

test("DryRunImageProvider rejects a blank prompt", async () => {
  const provider = new DryRunImageProvider();
  const result = await provider.generate({ jobId: "job-4", prompt: "   " });
  assert.equal(result.ok, false);
});

test("DryRunImageProvider rejects a blank jobId", async () => {
  const provider = new DryRunImageProvider();
  const result = await provider.generate({ jobId: "  ", prompt: "a mango" });
  assert.equal(result.ok, false);
});

test("DryRunImageProvider marks its metadata as dry-run", async () => {
  const provider = new DryRunImageProvider();
  const result = await provider.generate({ jobId: "job-5", prompt: "a mango" });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.metadata.dryRun, true);
  }
});
