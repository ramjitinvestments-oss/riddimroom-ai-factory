import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishApprovedArtworkToShopify } from "../../scripts/publish-to-shopify.ts";
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

const DESCRIPTION_TEXT = "A towering vintage speaker stack bringing real sound system heritage to streetwear.";

/** Simulates one artwork that has already been imported and uploaded to Printify. */
function createUploadedArtwork(
  approvedRoot: string,
  stem: string,
  overrides: { readonly jobId?: string; readonly title?: string; readonly collectionName?: string } = {},
): void {
  mkdirSync(approvedRoot, { recursive: true });
  const jobId = overrides.jobId ?? `job-${stem}`;
  const title = overrides.title ?? "Vintage Sound System Tee";
  const collectionName = overrides.collectionName ?? "Vintage Jamaican Sound Systems";

  writeFileSync(path.join(approvedRoot, `${stem}.png`), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));
  writeFileSync(
    path.join(approvedRoot, `${stem}.product.json`),
    JSON.stringify({ jobId, title, productType: "T-Shirt", collectionId: "vintage-jamaican-sound-systems", collectionName, suggestedRetailPrice: 24.99 }),
  );
  writeFileSync(
    path.join(approvedRoot, `${stem}.seo.json`),
    JSON.stringify({ jobId, seoTitle: "Vintage Sound System T-Shirt", seoDescription: "Shop the Vintage Sound System tee." }),
  );
  writeFileSync(
    path.join(approvedRoot, `${stem}.tags.json`),
    JSON.stringify(["caribbean", "streetwear", "vintage", "reggae", "sound system"]),
  );
  writeFileSync(path.join(approvedRoot, `${stem}.description.md`), `# ${title}\n\n${DESCRIPTION_TEXT}\n`);
  writeFileSync(
    path.join(approvedRoot, `${stem}.job.json`),
    JSON.stringify({ jobId, engine: "artwork-import", status: "imported" }),
  );
  writeFileSync(
    path.join(approvedRoot, `${stem}.printify.json`),
    JSON.stringify({ jobId, printifyProductId: `dry-run-product-${jobId}`, status: "uploaded" }),
  );
}

/**
 * Builds a fetchImpl simulating a real, successful Shopify publish + verified
 * read-back: the GET /products/{id}.json response echoes back exactly what
 * was requested (unless `overrides` says otherwise), so
 * `verifyPublishedProduct()` reports no field mismatches.
 */
function createSuccessFetchImpl(options: {
  readonly id?: number;
  readonly title?: string;
  readonly description?: string;
  readonly handle?: string;
  readonly tags?: string;
  readonly price?: string;
  readonly collectionName?: string;
  /** Deliberately makes the GET read-back report a different id than requested, to exercise the mismatch guard. */
  readonly readBackIdOverride?: number;
}): typeof fetch {
  const id = options.id ?? 42;
  const title = options.title ?? "Vintage Sound System Tee";
  const description = options.description ?? DESCRIPTION_TEXT;
  const handle = options.handle ?? "vintage-sound-system-tee";
  const tags = options.tags ?? "caribbean, streetwear, vintage, reggae, sound system";
  const price = options.price ?? "24.99";
  const collectionName = options.collectionName ?? "Vintage Jamaican Sound Systems";
  // Metafield values are POSTed after product creation, then read back via
  // getProduct() — capture whatever was actually POSTed instead of guessing,
  // so the SEO round-trip is faithfully simulated.
  let capturedSeoTitle: string | undefined;
  let capturedSeoDescription: string | undefined;

  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;

    if (url.includes("/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "shpat_test", expires_in: 86400 }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/products.json")) {
      return new Response(JSON.stringify({ product: { id, handle } }), { status: 200 });
    }
    if (method === "POST" && /\/products\/\d+\/metafields\.json$/.test(url)) {
      const metafield = body?.metafield as { key?: string; value?: string } | undefined;
      if (metafield?.key === "title_tag") capturedSeoTitle = metafield.value;
      if (metafield?.key === "description_tag") capturedSeoDescription = metafield.value;
      return new Response(JSON.stringify({ metafield: { id: 1 } }), { status: 200 });
    }
    if (method === "GET" && new RegExp(`/products/${id}\\.json$`).test(url)) {
      return new Response(
        JSON.stringify({
          product: {
            id: options.readBackIdOverride ?? id,
            title,
            body_html: `<p>${description}</p>`,
            handle,
            status: "active",
            tags,
            product_type: "T-Shirt",
            images: [{ src: "https://cdn.shopify.com/x.png" }],
            variants: [{ id: 1, price }],
          },
        }),
        { status: 200 },
      );
    }
    if (method === "GET" && /\/products\/\d+\/metafields\.json/.test(url)) {
      const metafields: Array<{ key: string; value: string }> = [];
      if (capturedSeoTitle !== undefined) metafields.push({ key: "title_tag", value: capturedSeoTitle });
      if (capturedSeoDescription !== undefined) metafields.push({ key: "description_tag", value: capturedSeoDescription });
      return new Response(JSON.stringify({ metafields }), { status: 200 });
    }
    if (method === "GET" && url.includes("/collects.json")) {
      return new Response(JSON.stringify({ collects: [{ collection_id: 555 }] }), { status: 200 });
    }
    // Singular lookup (by id) — used by getProduct()'s collection-title resolution.
    if (method === "GET" && /\/custom_collections\/\d+\.json/.test(url)) {
      return new Response(JSON.stringify({ custom_collection: { id: 555, title: collectionName } }), { status: 200 });
    }
    // Plural lookup (by title query) — used by findOrCreateCollection().
    if (method === "GET" && url.includes("/custom_collections.json")) {
      return new Response(JSON.stringify({ custom_collections: [{ id: 555, title: collectionName }] }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/custom_collections.json")) {
      return new Response(JSON.stringify({ custom_collection: { id: 555, title: collectionName } }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/collects.json")) {
      return new Response(JSON.stringify({ collect: { id: 1 } }), { status: 200 });
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;
}

const REAL_SHOPIFY_ENV = {
  DRY_RUN: "false",
  SHOPIFY_STORE_DOMAIN: "riddimroom.myshopify.com",
  SHOPIFY_CLIENT_ID: "id",
  SHOPIFY_CLIENT_SECRET: "secret",
};

test("publishApprovedArtworkToShopify publishes, verifies, moves to published/, and returns product id + handle + live URL + status (real, DRY_RUN=false)", async (t) => {
  const root = tempDir(t, "riddimroom-pipeline-");
  const approvedRoot = path.join(root, "approved");
  const publishedRoot = path.join(root, "published");
  createUploadedArtwork(approvedRoot, "sunset-parrot", { jobId: "job-1" });
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const result = await publishApprovedArtworkToShopify({
    approvedRoot,
    publishedRoot,
    logger,
    shopifyProviderOptions: { env: REAL_SHOPIFY_ENV, fetchImpl: createSuccessFetchImpl({ id: 501 }) },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.scanned, 1);
  assert.equal(result.value.published.length, 1);
  assert.equal(result.value.dryRunPublished.length, 0);
  assert.equal(result.value.stoppedDueTo, null);

  const item = result.value.published[0]!;
  assert.equal(item.jobId, "job-1");
  assert.equal(item.shopifyProductId, "501");
  assert.equal(item.handle, "vintage-sound-system-tee");
  assert.equal(item.liveUrl, "https://riddimroom.myshopify.com/products/vintage-sound-system-tee");
  assert.equal(item.status, "active");

  // Moved: nothing left in approved/, everything present in published/.
  assert.equal(existsSync(path.join(approvedRoot, "sunset-parrot.png")), false);
  assert.equal(existsSync(path.join(publishedRoot, "sunset-parrot.png")), true);
  assert.equal(existsSync(path.join(publishedRoot, "sunset-parrot.product.json")), true);
  assert.equal(existsSync(path.join(publishedRoot, "sunset-parrot.seo.json")), true);
  assert.equal(existsSync(path.join(publishedRoot, "sunset-parrot.tags.json")), true);
  assert.equal(existsSync(path.join(publishedRoot, "sunset-parrot.description.md")), true);
  assert.equal(existsSync(path.join(publishedRoot, "sunset-parrot.job.json")), true);
  assert.equal(existsSync(path.join(publishedRoot, "sunset-parrot.printify.json")), true);
  assert.equal(existsSync(path.join(publishedRoot, "sunset-parrot.shopify.json")), true);

  const shopifyRecord = JSON.parse(readFileSync(path.join(publishedRoot, "sunset-parrot.shopify.json"), "utf8"));
  assert.equal(shopifyRecord.shopifyProductId, item.shopifyProductId);
  assert.equal(shopifyRecord.status, "active");
});

test("publishApprovedArtworkToShopify preserves nested subdirectory structure when moving to published/ (real, DRY_RUN=false)", async (t) => {
  const root = tempDir(t, "riddimroom-pipeline-");
  const approvedRoot = path.join(root, "approved");
  const publishedRoot = path.join(root, "published");
  createUploadedArtwork(path.join(approvedRoot, "batch-1"), "nested", { jobId: "job-nested" });

  const result = await publishApprovedArtworkToShopify({
    approvedRoot,
    publishedRoot,
    shopifyProviderOptions: { env: REAL_SHOPIFY_ENV, fetchImpl: createSuccessFetchImpl({ id: 502 }) },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.published.length, 1);
  assert.equal(existsSync(path.join(publishedRoot, "batch-1", "nested.png")), true);
  assert.equal(existsSync(path.join(approvedRoot, "batch-1", "nested.png")), false);
});

test("publishApprovedArtworkToShopify never moves a DRY_RUN publish to designs/published/ and never writes <stem>.shopify.json for it (dry-run isolation)", async (t) => {
  const root = tempDir(t, "riddimroom-pipeline-");
  const approvedRoot = path.join(root, "approved");
  const publishedRoot = path.join(root, "published");
  createUploadedArtwork(approvedRoot, "sunset-parrot", { jobId: "job-1" });
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const result = await publishApprovedArtworkToShopify({
    approvedRoot,
    publishedRoot,
    logger,
    shopifyProviderOptions: { env: { DRY_RUN: "true", SHOPIFY_STORE_DOMAIN: "riddimroom.myshopify.com" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.scanned, 1);
  assert.equal(result.value.published.length, 0);
  assert.equal(result.value.dryRunPublished.length, 1);
  assert.equal(result.value.stoppedDueTo, null);

  const item = result.value.dryRunPublished[0]!;
  assert.equal(item.jobId, "job-1");
  assert.match(item.shopifyProductId, /^dry-run-product-/);

  // Nothing moved to published/ — it doesn't exist at all, since nothing real happened.
  assert.equal(existsSync(publishedRoot), false);
  // Artwork and siblings are untouched, still in approved/.
  assert.equal(existsSync(path.join(approvedRoot, "sunset-parrot.png")), true);
  // No <stem>.shopify.json (the idempotency marker for a REAL publish) was written...
  assert.equal(existsSync(path.join(approvedRoot, "sunset-parrot.shopify.json")), false);
  // ...only the separate dry-run marker, clearly labeled as such.
  const dryRunPath = path.join(approvedRoot, "sunset-parrot.shopify.dryrun.json");
  assert.equal(existsSync(dryRunPath), true);
  const dryRunRecord = JSON.parse(readFileSync(dryRunPath, "utf8"));
  assert.equal(dryRunRecord.dryRun, true);
  assert.match(dryRunRecord.shopifyProductId, /^dry-run-product-/);

  // A dry-run marker never blocks a later real publish attempt on the same artwork.
  const secondResult = await publishApprovedArtworkToShopify({
    approvedRoot,
    publishedRoot,
    shopifyProviderOptions: { env: REAL_SHOPIFY_ENV, fetchImpl: createSuccessFetchImpl({ id: 503 }) },
  });
  assert.equal(secondResult.ok, true);
  if (!secondResult.ok) return;
  assert.equal(secondResult.value.skippedAlreadyPublished.length, 0);
  assert.equal(secondResult.value.published.length, 1);
  assert.equal(existsSync(path.join(publishedRoot, "sunset-parrot.png")), true);
});

test("publishApprovedArtworkToShopify refuses to record a publish when the read-back id doesn't match the published id", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  createUploadedArtwork(approvedRoot, "sunset-parrot", { jobId: "job-1" });

  const result = await publishApprovedArtworkToShopify({
    approvedRoot,
    shopifyProviderOptions: {
      env: REAL_SHOPIFY_ENV,
      fetchImpl: createSuccessFetchImpl({ id: 42, readBackIdOverride: 999 }),
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.published.length, 0);
  assert.equal(result.value.dryRunPublished.length, 0);
  assert.ok(result.value.stoppedDueTo);
  assert.match(result.value.stoppedDueTo?.reason ?? "", /does not match/);
  // Never recorded — refusing to trust a mismatched read-back means no shopify.json at all.
  assert.equal(existsSync(path.join(approvedRoot, "sunset-parrot.shopify.json")), false);
});

test("publishApprovedArtworkToShopify skips artwork not yet uploaded to Printify (no printify.json)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  mkdirSync(approvedRoot, { recursive: true });
  writeFileSync(path.join(approvedRoot, "not-uploaded.png"), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));
  writeFileSync(
    path.join(approvedRoot, "not-uploaded.product.json"),
    JSON.stringify({ jobId: "job-x", title: "X Tee", productType: "T-Shirt" }),
  );

  const result = await publishApprovedArtworkToShopify({
    approvedRoot,
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.published.length, 0);
  assert.deepEqual(result.value.skippedNotUploaded, [path.join(approvedRoot, "not-uploaded.png")]);
});

test("publishApprovedArtworkToShopify skips artwork that already has a shopify.json (idempotent, no duplicate publish)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  createUploadedArtwork(approvedRoot, "already-published", { jobId: "job-1" });
  writeFileSync(
    path.join(approvedRoot, "already-published.shopify.json"),
    JSON.stringify({ jobId: "job-1", shopifyProductId: "dry-run-product-job-1", status: "active" }),
  );

  const result = await publishApprovedArtworkToShopify({
    approvedRoot,
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.published.length, 0);
  assert.deepEqual(result.value.skippedAlreadyPublished, [path.join(approvedRoot, "already-published.png")]);
  // Untouched — still in approved/, never moved.
  assert.equal(existsSync(path.join(approvedRoot, "already-published.png")), true);
});

test("publishApprovedArtworkToShopify stops the batch on a verification failure, writes shopify.json, but does not move the artwork", async (t) => {
  const root = tempDir(t, "riddimroom-pipeline-");
  const approvedRoot = path.join(root, "approved");
  const publishedRoot = path.join(root, "published");
  createUploadedArtwork(approvedRoot, "mismatched", { jobId: "job-1", title: "Vintage Sound System Tee" });

  let getCallCount = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && url.endsWith("/products.json")) {
      return new Response(JSON.stringify({ product: { id: 42, handle: "vintage-sound-system-tee" } }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/metafields.json")) {
      return new Response(JSON.stringify({ metafield: { id: 1 } }), { status: 200 });
    }
    if (method === "GET" && /\/products\/42\.json$/.test(url)) {
      getCallCount++;
      // Read-back reports a DIFFERENT title than what was published — a real mismatch.
      return new Response(
        JSON.stringify({
          product: {
            id: 42,
            title: "Some Other Title Entirely",
            body_html: "<p>wrong</p>",
            handle: "vintage-sound-system-tee",
            status: "active",
            tags: "caribbean, streetwear, vintage, reggae, sound system",
            product_type: "T-Shirt",
            images: [{ src: "https://cdn.shopify.com/x.png" }],
            variants: [{ id: 1, price: "24.99" }],
          },
        }),
        { status: 200 },
      );
    }
    if (method === "GET" && url.includes("/metafields.json")) {
      return new Response(JSON.stringify({ metafields: [] }), { status: 200 });
    }
    if (method === "GET" && url.includes("/collects.json")) {
      return new Response(JSON.stringify({ collects: [] }), { status: 200 });
    }
    if (method === "GET" && url.includes("/custom_collections.json")) {
      return new Response(JSON.stringify({ custom_collections: [] }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/custom_collections.json")) {
      return new Response(JSON.stringify({ custom_collection: { id: 555, title: "Vintage Jamaican Sound Systems" } }), {
        status: 200,
      });
    }
    if (method === "POST" && url.endsWith("/collects.json")) {
      return new Response(JSON.stringify({ collect: { id: 1 } }), { status: 200 });
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const result = await publishApprovedArtworkToShopify({
    approvedRoot,
    publishedRoot,
    shopifyProviderOptions: {
      env: {
        DRY_RUN: "false",
        SHOPIFY_STORE_DOMAIN: "riddimroom.myshopify.com",
        SHOPIFY_CLIENT_ID: "id",
        SHOPIFY_CLIENT_SECRET: "secret",
      },
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).includes("/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "shpat_test", expires_in: 86400 }), { status: 200 });
        }
        return fetchImpl(input, init);
      }) as typeof fetch,
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.published.length, 0);
  assert.ok(getCallCount >= 1);

  assert.ok(result.value.stoppedDueTo);
  assert.equal(result.value.stoppedDueTo?.sourcePath, path.join(approvedRoot, "mismatched.png"));
  assert.match(result.value.stoppedDueTo?.reason ?? "", /verification failed/);
  assert.ok(result.value.stoppedDueTo?.details.some((d) => d.includes("title")));
  assert.ok(result.value.stoppedDueTo?.details.some((d) => d.includes("description")));

  // Not moved — stays in approved/ for a human to inspect.
  assert.equal(existsSync(path.join(approvedRoot, "mismatched.png")), true);
  assert.equal(existsSync(path.join(publishedRoot, "mismatched.png")), false);
  const record = JSON.parse(readFileSync(path.join(approvedRoot, "mismatched.shopify.json"), "utf8"));
  assert.equal(record.status, "verification_failed");
});

test("production-safe error handling: one failed publish halts the entire batch — later artwork is never even attempted", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  // "bad" has a printify.json and product.json but no seo.json — read failure. Sorts before "good".
  mkdirSync(approvedRoot, { recursive: true });
  writeFileSync(path.join(approvedRoot, "bad.png"), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));
  writeFileSync(
    path.join(approvedRoot, "bad.product.json"),
    JSON.stringify({ jobId: "job-bad", title: "Bad Tee", productType: "T-Shirt" }),
  );
  writeFileSync(path.join(approvedRoot, "bad.printify.json"), JSON.stringify({ jobId: "job-bad", status: "uploaded" }));
  createUploadedArtwork(approvedRoot, "good", { jobId: "job-good" });

  const result = await publishApprovedArtworkToShopify({
    approvedRoot,
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Nothing published — the batch stopped at "bad" before "good" was ever reached.
  assert.equal(result.value.published.length, 0);
  assert.ok(result.value.stoppedDueTo);
  assert.equal(result.value.stoppedDueTo?.sourcePath, path.join(approvedRoot, "bad.png"));
  assert.match(result.value.stoppedDueTo?.details.join(" ") ?? "", /seo\.json/);
  assert.deepEqual(result.value.remainingUnprocessed, [path.join(approvedRoot, "good.png")]);
  // "good" was never even attempted, proving the stop happened before it, not after.
  assert.equal(existsSync(path.join(approvedRoot, "good.shopify.json")), false);
});

test("publishApprovedArtworkToShopify returns an empty report when designs/approved/ doesn't exist, without erroring", async (t) => {
  const approvedRoot = path.join(tempDir(t, "riddimroom-approved-"), "does-not-exist");

  const result = await publishApprovedArtworkToShopify({
    approvedRoot,
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    scanned: 0,
    published: [],
    dryRunPublished: [],
    skippedNotUploaded: [],
    skippedAlreadyPublished: [],
    stoppedDueTo: null,
    remainingUnprocessed: [],
  });
});

test("publishApprovedArtworkToShopify reports a ConfigError and publishes nothing when Shopify is misconfigured", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-approved-");
  createUploadedArtwork(approvedRoot, "sunset-parrot");

  const result = await publishApprovedArtworkToShopify({
    approvedRoot,
    shopifyProviderOptions: { env: { DRY_RUN: "false" } }, // missing all Shopify config
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFIG_ERROR");
  }
  assert.equal(existsSync(path.join(approvedRoot, "sunset-parrot.shopify.json")), false);
});
