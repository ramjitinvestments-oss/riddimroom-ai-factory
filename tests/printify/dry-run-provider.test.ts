import { test } from "node:test";
import assert from "node:assert/strict";
import { DryRunPrintifyProvider } from "../../automation/printify/dry-run-provider.ts";

test("DryRunPrintifyProvider produces a deterministic fake product without any network call", async () => {
  const provider = new DryRunPrintifyProvider({ now: () => new Date("2026-07-31T00:00:00.000Z") });

  const result = await provider.uploadProduct({
    jobId: "job-1",
    title: "Sunset Parrot Tee",
    description: "A bold Caribbean design.",
    artworkPng: Buffer.from("fake-png-bytes"),
    priceUsd: 27.99,
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.jobId, "job-1");
  assert.equal(result.value.provider, "dry-run");
  assert.match(result.value.printifyProductId, /job-1/);
  assert.match(result.value.printifyImageId, /job-1/);
  assert.equal(result.value.createdAt, "2026-07-31T00:00:00.000Z");
  assert.equal(result.value.metadata.dryRun, true);
});

test("DryRunPrintifyProvider rejects a blank title", async () => {
  const provider = new DryRunPrintifyProvider();
  const result = await provider.uploadProduct({
    jobId: "job-1",
    title: "  ",
    description: "desc",
    artworkPng: Buffer.from("fake"),
    priceUsd: 20,
  });
  assert.equal(result.ok, false);
});

test("DryRunPrintifyProvider rejects a blank jobId", async () => {
  const provider = new DryRunPrintifyProvider();
  const result = await provider.uploadProduct({
    jobId: " ",
    title: "Tee",
    description: "desc",
    artworkPng: Buffer.from("fake"),
    priceUsd: 20,
  });
  assert.equal(result.ok, false);
});

test("DryRunPrintifyProvider rejects empty artwork", async () => {
  const provider = new DryRunPrintifyProvider();
  const result = await provider.uploadProduct({
    jobId: "job-1",
    title: "Tee",
    description: "desc",
    artworkPng: Buffer.alloc(0),
    priceUsd: 20,
  });
  assert.equal(result.ok, false);
});
