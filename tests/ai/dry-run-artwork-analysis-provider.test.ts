import { test } from "node:test";
import assert from "node:assert/strict";
import { DryRunArtworkAnalysisProvider } from "../../automation/ai/dry-run-artwork-analysis-provider.ts";
import { getCollectionById } from "../../automation/ai/collections/library.ts";
import { getStyleById } from "../../automation/ai/styles/library.ts";

test("DryRunArtworkAnalysisProvider produces fully valid analysis + copy without any network call", async () => {
  const provider = new DryRunArtworkAnalysisProvider({ now: () => new Date("2026-07-31T00:00:00.000Z") });

  const result = await provider.analyze({ jobId: "job-1", artworkPng: Buffer.from("fake-png-bytes") });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.jobId, "job-1");
  assert.equal(result.value.provider, "dry-run");
  assert.equal(result.value.generatedAt, "2026-07-31T00:00:00.000Z");
  assert.equal(result.value.metadata.dryRun, true);

  const { classification, copy } = result.value.analysis;
  assert.ok(getCollectionById(classification.collectionId), "collectionId must be a real Collection Library id");
  assert.ok(getStyleById(classification.styleId), "styleId must be a real Style Library id");
  assert.ok(classification.theme.length > 0);
  assert.ok(classification.keywords.length > 0);
  assert.ok(copy.tags.length >= 10 && copy.tags.length <= 15);
});

test("DryRunArtworkAnalysisProvider rejects a blank jobId", async () => {
  const provider = new DryRunArtworkAnalysisProvider();
  const result = await provider.analyze({ jobId: " ", artworkPng: Buffer.from("fake") });
  assert.equal(result.ok, false);
});

test("DryRunArtworkAnalysisProvider rejects empty artwork", async () => {
  const provider = new DryRunArtworkAnalysisProvider();
  const result = await provider.analyze({ jobId: "job-2", artworkPng: Buffer.alloc(0) });
  assert.equal(result.ok, false);
});
