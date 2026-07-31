import { test } from "node:test";
import assert from "node:assert/strict";
import { DryRunProductCopyProvider } from "../../automation/ai/dry-run-product-copy-provider.ts";

test("DryRunProductCopyProvider produces fully valid product copy without any network call", async () => {
  const provider = new DryRunProductCopyProvider({ now: () => new Date("2026-07-31T00:00:00.000Z") });

  const result = await provider.generate({
    jobId: "job-1",
    brief: "a parrot wearing sunglasses",
    artworkPng: Buffer.from("fake-png-bytes"),
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.jobId, "job-1");
  assert.equal(result.value.provider, "dry-run");
  assert.equal(result.value.generatedAt, "2026-07-31T00:00:00.000Z");
  assert.match(result.value.copy.title, /Parrot/);
  assert.ok(result.value.copy.tags.length >= 3);
  assert.ok(result.value.copy.suggestedRetailPrice >= 10 && result.value.copy.suggestedRetailPrice <= 100);
  assert.equal(result.value.metadata.dryRun, true);
});

test("DryRunProductCopyProvider rejects a blank brief", async () => {
  const provider = new DryRunProductCopyProvider();
  const result = await provider.generate({
    jobId: "job-2",
    brief: "   ",
    artworkPng: Buffer.from("fake"),
  });
  assert.equal(result.ok, false);
});

test("DryRunProductCopyProvider rejects a blank jobId", async () => {
  const provider = new DryRunProductCopyProvider();
  const result = await provider.generate({
    jobId: " ",
    brief: "a mango",
    artworkPng: Buffer.from("fake"),
  });
  assert.equal(result.ok, false);
});

test("DryRunProductCopyProvider derives its title from the design brief", async () => {
  const provider = new DryRunProductCopyProvider();
  const result = await provider.generate({
    jobId: "job-3",
    brief: "a mango riding a jet ski",
    artworkPng: Buffer.from("fake"),
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.match(result.value.copy.title, /Mango/);
  }
});

test("DryRunProductCopyProvider keeps seoTitle/seoDescription within limits even for a long brief", async () => {
  const provider = new DryRunProductCopyProvider();
  const longBrief =
    "an original abstract pattern of Caribbean island colors and wave motifs, streetwear print, " +
    "no government flags or logos";

  const result = await provider.generate({
    jobId: "job-4",
    brief: longBrief,
    artworkPng: Buffer.from("fake"),
  });

  assert.ok(result.ok);
  if (result.ok) {
    assert.ok(result.value.copy.seoTitle.length <= 70, `seoTitle was ${result.value.copy.seoTitle.length} chars`);
    assert.ok(
      result.value.copy.seoDescription.length <= 160,
      `seoDescription was ${result.value.copy.seoDescription.length} chars`,
    );
  }
});
