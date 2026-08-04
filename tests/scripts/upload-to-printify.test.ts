import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { uploadApprovedArtworkToPrintify } from "../../scripts/upload-to-printify.ts";
import { createSolidPng } from "../../automation/ai/png.ts";
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

function tempDir(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Simulates one artwork that scripts/import-artwork.ts has already analyzed and approved. */
function createApprovedArtwork(
  approvedRoot: string,
  stem: string,
  overrides: { readonly jobId?: string; readonly title?: string } = {},
): void {
  mkdirSync(approvedRoot, { recursive: true });
  const jobId = overrides.jobId ?? `job-${stem}`;
  const title = overrides.title ?? "Vintage Sound System Tee";
  writeFileSync(path.join(approvedRoot, `${stem}.png`), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));
  writeFileSync(
    path.join(approvedRoot, `${stem}.product.json`),
    JSON.stringify({ jobId, sourceArtworkPath: `${stem}.png`, title, productType: "T-Shirt", suggestedRetailPrice: 24.99 }),
  );
  writeFileSync(
    path.join(approvedRoot, `${stem}.description.md`),
    `# ${title}\n\nA towering vintage speaker stack bringing real sound system heritage to streetwear.\n`,
  );
}

test("uploadApprovedArtworkToPrintify uploads, creates the product, and returns product id + mockup URLs + status", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  createApprovedArtwork(approvedRoot, "sunset-parrot", { jobId: "job-1" });
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const result = await uploadApprovedArtworkToPrintify({
    approvedRoot,
    logger,
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.scanned, 1);
  assert.equal(result.value.uploaded.length, 1);
  assert.equal(result.value.stoppedDueTo, null);

  const item = result.value.uploaded[0]!;
  assert.equal(item.sourcePath, path.join(approvedRoot, "sunset-parrot.png"));
  assert.equal(item.jobId, "job-1");
  assert.match(item.printifyProductId, /job-1/); // DryRunPrintifyProvider's deterministic id format
  assert.deepEqual(item.mockupUrls, []); // dry-run makes no real network call, so no real mockups
  assert.equal(item.status, "uploaded");

  const record = JSON.parse(readFileSync(path.join(approvedRoot, "sunset-parrot.printify.json"), "utf8"));
  assert.equal(record.jobId, "job-1");
  assert.equal(record.printifyProductId, item.printifyProductId);
  assert.equal(record.status, "uploaded");
  assert.equal(record.priceUsd, 24.99);
});

test("uploadApprovedArtworkToPrintify uses the fixed shirt retail price, not whatever product.json says", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  mkdirSync(approvedRoot, { recursive: true });
  writeFileSync(path.join(approvedRoot, "stale.png"), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));
  // product.json deliberately carries a stale/wrong price, like the real incident this behavior guards against.
  writeFileSync(
    path.join(approvedRoot, "stale.product.json"),
    JSON.stringify({ jobId: "job-stale", title: "Stale Price Tee", suggestedRetailPrice: 30 }),
  );
  writeFileSync(path.join(approvedRoot, "stale.description.md"), "# Stale Price Tee\n\nSome description text here.\n");

  const originalEnv = process.env.DEFAULT_SHIRT_PRICE;
  process.env.DEFAULT_SHIRT_PRICE = "24.99";
  t.after(() => {
    if (originalEnv === undefined) delete process.env.DEFAULT_SHIRT_PRICE;
    else process.env.DEFAULT_SHIRT_PRICE = originalEnv;
  });

  const result = await uploadApprovedArtworkToPrintify({
    approvedRoot,
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const record = JSON.parse(readFileSync(path.join(approvedRoot, "stale.printify.json"), "utf8"));
  assert.equal(record.priceUsd, 24.99);
});

test("uploadApprovedArtworkToPrintify strips the markdown title heading before sending the description", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  createApprovedArtwork(approvedRoot, "sunset-parrot");

  let capturedDescription = "";
  // A minimal fetchImpl so we can inspect exactly what was sent, without going through dry-run.
  process.env.DEFAULT_SHIRT_PRICE = process.env.DEFAULT_SHIRT_PRICE ?? "24.99";

  const result = await uploadApprovedArtworkToPrintify({
    approvedRoot,
    printifyProviderOptions: {
      env: {
        DRY_RUN: "false",
        PRINTIFY_API_KEY: "pk-test",
        PRINTIFY_SHOP_ID: "shop-1",
        PRINTIFY_BLUEPRINT_ID: "5",
        PRINTIFY_PRINT_PROVIDER_ID: "9",
        PRINTIFY_VARIANT_IDS: "111",
      },
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (String(input).includes("/uploads/images.json")) {
          return new Response(JSON.stringify({ id: "img-1" }), { status: 200 });
        }
        capturedDescription = body.description;
        return new Response(JSON.stringify({ id: "prod-1", images: [{ src: "https://images.printify.com/mock.jpg" }] }), {
          status: 200,
        });
      }) as typeof fetch,
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.uploaded.length, 1);
  assert.doesNotMatch(capturedDescription, /^#/);
  assert.match(capturedDescription, /towering vintage speaker stack/);
  assert.deepEqual(result.value.uploaded[0]!.mockupUrls, ["https://images.printify.com/mock.jpg"]);
});

test("uploadApprovedArtworkToPrintify skips a PNG that hasn't been imported yet (no product.json)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  mkdirSync(approvedRoot, { recursive: true });
  writeFileSync(path.join(approvedRoot, "not-yet-imported.png"), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));

  const result = await uploadApprovedArtworkToPrintify({
    approvedRoot,
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.uploaded.length, 0);
  assert.deepEqual(result.value.skippedNotImported, [path.join(approvedRoot, "not-yet-imported.png")]);
});

test("uploadApprovedArtworkToPrintify skips artwork that already has a printify.json (idempotent, no re-upload)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  createApprovedArtwork(approvedRoot, "already-uploaded", { jobId: "job-1" });
  writeFileSync(
    path.join(approvedRoot, "already-uploaded.printify.json"),
    JSON.stringify({ jobId: "job-1", printifyProductId: "dry-run-product-job-1", status: "uploaded" }),
  );

  const result = await uploadApprovedArtworkToPrintify({
    approvedRoot,
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.uploaded.length, 0);
  assert.deepEqual(result.value.skippedAlreadyUploaded, [path.join(approvedRoot, "already-uploaded.png")]);
});

test("production-safe error handling: one failed upload halts the entire batch — later artwork is never even attempted", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  // "bad" has a product.json but no description.md — read failure. Sorts before "good".
  mkdirSync(approvedRoot, { recursive: true });
  writeFileSync(path.join(approvedRoot, "bad.png"), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));
  writeFileSync(
    path.join(approvedRoot, "bad.product.json"),
    JSON.stringify({ jobId: "job-bad", title: "Bad Tee", suggestedRetailPrice: 24.99 }),
  );
  createApprovedArtwork(approvedRoot, "good", { jobId: "job-good" });

  const result = await uploadApprovedArtworkToPrintify({
    approvedRoot,
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Nothing uploaded — the batch stopped at "bad" before "good" was ever reached.
  assert.equal(result.value.uploaded.length, 0);
  assert.ok(result.value.stoppedDueTo);
  assert.equal(result.value.stoppedDueTo?.sourcePath, path.join(approvedRoot, "bad.png"));
  assert.deepEqual(result.value.remainingUnprocessed, [path.join(approvedRoot, "good.png")]);
  assert.equal(existsSync(path.join(approvedRoot, "bad.printify.json")), false);
  // "good" was never even attempted, proving the stop happened before it, not after.
  assert.equal(existsSync(path.join(approvedRoot, "good.printify.json")), false);
});

test("uploadApprovedArtworkToPrintify returns an empty report when designs/approved/ doesn't exist, without erroring", async (t) => {
  const approvedRoot = path.join(tempDir(t, "riddimroom-approved-"), "does-not-exist");

  const result = await uploadApprovedArtworkToPrintify({
    approvedRoot,
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    scanned: 0,
    uploaded: [],
    skippedNotImported: [],
    skippedAlreadyUploaded: [],
    stoppedDueTo: null,
    remainingUnprocessed: [],
  });
});

test("uploadApprovedArtworkToPrintify reports a ConfigError and uploads nothing when Printify is misconfigured", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  createApprovedArtwork(approvedRoot, "sunset-parrot");

  const result = await uploadApprovedArtworkToPrintify({
    approvedRoot,
    printifyProviderOptions: { env: { DRY_RUN: "false" } }, // missing all Printify config
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFIG_ERROR");
  }
  assert.equal(existsSync(path.join(approvedRoot, "sunset-parrot.printify.json")), false);
});
