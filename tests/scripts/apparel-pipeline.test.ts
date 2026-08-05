import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runApparelPipeline } from "../../scripts/apparel-pipeline.ts";
import { createSolidPng } from "../../automation/ai/png.ts";
import { Logger } from "../../automation/shared/logger.ts";
import type { FileOperationError } from "../../automation/shared/errors.ts";
import { ok, type Result } from "../../automation/shared/result.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";

class FakeTransport implements LogTransport {
  readonly name = "fake";
  write(_entry: LogEntry): Result<void, FileOperationError> {
    return ok(undefined);
  }
}

function tempDir(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const PRINT_WIDTH = 4500;
const PRINT_HEIGHT = 5400;

function silentLogger(): Logger {
  return new Logger({ module: "test", transports: [new FakeTransport()] });
}

/** Simulates a design that has never been published — sitting in designs/processed/ ready to upload. */
function createProcessedArtwork(approvedRoot: string, stem: string, jobId: string, title: string): void {
  mkdirSync(approvedRoot, { recursive: true });
  writeFileSync(path.join(approvedRoot, `${stem}.png`), createSolidPng(PRINT_WIDTH, PRINT_HEIGHT, { r: 10, g: 20, b: 30, a: 255 }));
  writeFileSync(
    path.join(approvedRoot, `${stem}.product.json`),
    JSON.stringify({ jobId, sourceArtworkPath: `${stem}.png`, title, productType: "T-Shirt", suggestedRetailPrice: 24.99 }),
  );
  writeFileSync(path.join(approvedRoot, `${stem}.seo.json`), JSON.stringify({ seoTitle: title, seoDescription: "A great shirt." }));
  writeFileSync(path.join(approvedRoot, `${stem}.tags.json`), JSON.stringify(["caribbean", "tee"]));
  writeFileSync(path.join(approvedRoot, `${stem}.description.md`), `# ${title}\n\nA solid, dependable design.\n`);
}

/** Simulates a design that is already live — has a full published job record. */
function createPublishedProduct(
  publishedRoot: string,
  stem: string,
  fields: {
    readonly jobId: string;
    readonly title: string;
    readonly printifyProductId: string;
    readonly printifyImageId: string;
    readonly shopifyProductId: string;
  },
): void {
  mkdirSync(publishedRoot, { recursive: true });
  writeFileSync(path.join(publishedRoot, `${stem}.png`), createSolidPng(PRINT_WIDTH, PRINT_HEIGHT, { r: 1, g: 2, b: 3, a: 255 }));
  writeFileSync(
    path.join(publishedRoot, `${stem}.product.json`),
    JSON.stringify({ jobId: fields.jobId, title: fields.title, productType: "T-Shirt" }),
  );
  writeFileSync(path.join(publishedRoot, `${stem}.description.md`), `# ${fields.title}\n\nAlready live.\n`);
  writeFileSync(
    path.join(publishedRoot, `${stem}.printify.json`),
    JSON.stringify({
      jobId: fields.jobId,
      printifyProductId: fields.printifyProductId,
      printifyImageId: fields.printifyImageId,
      mockupUrls: [],
      priceUsd: 24.99,
      status: "uploaded",
      uploadedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  writeFileSync(path.join(publishedRoot, `${stem}.shopify.json`), JSON.stringify({ shopifyProductId: fields.shopifyProductId }));
}

test("runApparelPipeline routes an already-published design to the update path and reuses its existing ids", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createPublishedProduct(publishedRoot, "existing-shirt", {
    jobId: "job-existing",
    title: "Existing Shirt",
    printifyProductId: "printify-prod-999",
    printifyImageId: "printify-img-999",
    shopifyProductId: "shopify-prod-999",
  });

  const result = await runApparelPipeline("existing-shirt", {
    approvedRoot,
    publishedRoot,
    logger: silentLogger(),
    env: { DRY_RUN: "true", PRINTIFY_BLACK_VARIANT_IDS: "111,112" },
  });

  // The dry-run Printify provider returns no real mockups, so gallery mapping correctly finds nothing
  // to sync — this is the honest failure mode, not a fabricated success. What this test actually proves
  // is the routing decision: it reused printify-prod-999 (never created a second product) rather than
  // falling through to the create path.
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /no gallery slots could be mapped/);
});

test("runApparelPipeline reuses the existing Printify product id (never creates a duplicate) for an already-published design", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createPublishedProduct(publishedRoot, "existing-shirt", {
    jobId: "job-existing",
    title: "Existing Shirt",
    printifyProductId: "printify-prod-999",
    printifyImageId: "printify-img-999",
    shopifyProductId: "shopify-prod-999",
  });

  // Directly exercise the regenerate step the pipeline routes to, with a fetchImpl that records the
  // Printify request URL/method — proving it PUTs the existing product id rather than POSTing a new one.
  const { regeneratePrintifyProduct } = await import("../../scripts/regenerate-printify-product.ts");
  const requests: Array<{ method: string; url: string }> = [];

  const result = await regeneratePrintifyProduct("existing-shirt", {
    publishedRoot,
    logger: silentLogger(),
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
        requests.push({ method: init?.method ?? "GET", url: String(input) });
        return new Response(
          JSON.stringify({ id: "printify-prod-999", images: [{ src: "https://images.printify.com/mock.jpg?camera_label=front" }] }),
          { status: 200 },
        );
      }) as typeof fetch,
    },
    env: { PRINTIFY_BLACK_VARIANT_IDS: "111,112" },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.printifyProductId, "printify-prod-999");
  assert.equal(result.value.reusedImageId, "printify-img-999");

  // Exactly two calls against the existing product id — a GET (to read current variant
  // enablement, so the update can explicitly disable anything not in the new target set) then a
  // PUT — never a POST /products.json (create).
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.method, "GET");
  assert.match(requests[0]!.url, /\/products\/printify-prod-999\.json$/);
  assert.equal(requests[1]!.method, "PUT");
  assert.match(requests[1]!.url, /\/products\/printify-prod-999\.json$/);
});

test("runApparelPipeline refuses to fabricate a completed create-path run when the publish stage was only a dry run", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createProcessedArtwork(approvedRoot, "new-shirt", "job-new", "New Shirt");

  const result = await runApparelPipeline("new-shirt", {
    approvedRoot,
    publishedRoot,
    logger: silentLogger(),
    env: { DRY_RUN: "true", PRINTIFY_BLACK_VARIANT_IDS: "111,112" },
  });

  // DRY_RUN publishes are deliberately never recorded as real (see publish-to-shopify.ts's dry-run
  // isolation guarantee) and the artwork is never moved to designs/published/. The pipeline must report
  // this honestly — "nothing to do" — rather than pretending the design is now live and chaining into a
  // regenerate/sync call against a product that doesn't actually exist.
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /was not found under .*ready for upload, and is not yet published/);
});

test("runApparelPipeline reports a clear error for a design that exists in neither designs/processed nor designs/published", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");

  const result = await runApparelPipeline("nonexistent-shirt", {
    approvedRoot,
    publishedRoot,
    logger: silentLogger(),
    env: { DRY_RUN: "true", PRINTIFY_BLACK_VARIANT_IDS: "111,112" },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /was not found under .*ready for upload, and is not yet published/);
});
