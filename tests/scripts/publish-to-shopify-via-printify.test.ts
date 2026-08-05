import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishApprovedArtworkToShopifyViaPrintify } from "../../scripts/publish-to-shopify-via-printify.ts";
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

function silentLogger(): Logger {
  return new Logger({ module: "test", transports: [new FakeTransport()] });
}

/** Simulates one design already uploaded to Printify (has printify.json) and ready to publish. */
function createUploadedArtwork(
  approvedRoot: string,
  stem: string,
  overrides: {
    readonly jobId?: string;
    readonly title?: string;
    readonly collectionName?: string;
    readonly printifyProductId?: string;
  } = {},
): void {
  mkdirSync(approvedRoot, { recursive: true });
  const jobId = overrides.jobId ?? `job-${stem}`;
  const title = overrides.title ?? "Riddim Tee";
  const printifyProductId = overrides.printifyProductId ?? `printify-prod-${stem}`;

  writeFileSync(path.join(approvedRoot, `${stem}.png`), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));
  writeFileSync(
    path.join(approvedRoot, `${stem}.product.json`),
    JSON.stringify({
      jobId,
      title,
      productType: "T-Shirt",
      ...(overrides.collectionName !== undefined ? { collectionName: overrides.collectionName } : {}),
    }),
  );
  writeFileSync(
    path.join(approvedRoot, `${stem}.seo.json`),
    JSON.stringify({ seoTitle: `${title} — Shop Now`, seoDescription: `Shop the ${title}.` }),
  );
  writeFileSync(path.join(approvedRoot, `${stem}.tags.json`), JSON.stringify(["caribbean", "riddim", "tee"]));
  writeFileSync(path.join(approvedRoot, `${stem}.description.md`), `# ${title}\n\nA solid, dependable design.\n`);
  writeFileSync(
    path.join(approvedRoot, `${stem}.printify.json`),
    JSON.stringify({
      jobId,
      printifyProductId,
      printifyImageId: `printify-img-${stem}`,
      mockupUrls: [],
      priceUsd: 24.99,
      status: "uploaded",
      uploadedAt: "2026-08-01T00:00:00.000Z",
    }),
  );
}

/** Printify fetchImpl: publish.json ack, then a GET reporting the external Shopify id/handle immediately. */
function createPrintifyFetchImpl(options: { readonly shopifyProductId: string; readonly shopifyHandle: string }): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && url.endsWith("/publish.json")) {
      return new Response("", { status: 200 });
    }
    if (method === "GET" && /\/products\/[^/]+\.json$/.test(url)) {
      return new Response(
        JSON.stringify({ id: "printify-prod", external: { id: options.shopifyProductId, handle: options.shopifyHandle } }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected Printify request: ${method} ${url}`);
  }) as typeof fetch;
}

/**
 * Shopify fetchImpl covering finalizeExternalProduct (PUT tags, SEO
 * metafields) and the getProduct() read-back used for verification. Reports
 * `variantCount` variants — the real load-bearing check this script adds
 * over the old bare-create path.
 */
function createShopifyFetchImpl(options: {
  readonly shopifyProductId: string;
  readonly handle: string;
  readonly variantCount: number;
  readonly collectionName?: string;
}): typeof fetch {
  const { shopifyProductId, handle, variantCount, collectionName } = options;
  let capturedSeoTitle: string | undefined;
  let capturedSeoDescription: string | undefined;
  let capturedTags = "";

  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;

    if (url.includes("/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "shpat_test", expires_in: 86400 }), { status: 200 });
    }
    if (method === "PUT" && new RegExp(`/products/${shopifyProductId}\\.json$`).test(url)) {
      const product = body?.product as { tags?: string } | undefined;
      capturedTags = product?.tags ?? "";
      return new Response(JSON.stringify({ product: { id: shopifyProductId } }), { status: 200 });
    }
    if (method === "POST" && new RegExp(`/products/${shopifyProductId}/metafields\\.json$`).test(url)) {
      const metafield = body?.metafield as { key?: string; value?: string } | undefined;
      if (metafield?.key === "title_tag") capturedSeoTitle = metafield.value;
      if (metafield?.key === "description_tag") capturedSeoDescription = metafield.value;
      return new Response(JSON.stringify({ metafield: { id: 1 } }), { status: 200 });
    }
    if (method === "GET" && new RegExp(`/products/${shopifyProductId}/metafields\\.json`).test(url)) {
      const metafields: Array<{ key: string; value: string }> = [];
      if (capturedSeoTitle !== undefined) metafields.push({ key: "title_tag", value: capturedSeoTitle });
      if (capturedSeoDescription !== undefined) metafields.push({ key: "description_tag", value: capturedSeoDescription });
      return new Response(JSON.stringify({ metafields }), { status: 200 });
    }
    if (method === "GET" && url.includes("/collects.json")) {
      return new Response(JSON.stringify({ collects: collectionName !== undefined ? [{ collection_id: 555 }] : [] }), { status: 200 });
    }
    if (method === "GET" && /\/custom_collections\/\d+\.json/.test(url)) {
      return new Response(JSON.stringify({ custom_collection: { id: 555, title: collectionName } }), { status: 200 });
    }
    if (method === "GET" && url.includes("/custom_collections.json")) {
      return new Response(JSON.stringify({ custom_collections: collectionName !== undefined ? [{ id: 555, title: collectionName }] : [] }), {
        status: 200,
      });
    }
    if (method === "POST" && url.endsWith("/custom_collections.json")) {
      return new Response(JSON.stringify({ custom_collection: { id: 555, title: collectionName } }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/collects.json")) {
      return new Response(JSON.stringify({ collect: { id: 1 } }), { status: 200 });
    }
    if (method === "GET" && new RegExp(`/products/${shopifyProductId}\\.json$`).test(url)) {
      return new Response(
        JSON.stringify({
          product: {
            id: shopifyProductId,
            title: "Riddim Tee",
            body_html: "<p>Printify-controlled description</p>",
            handle,
            status: "active",
            tags: capturedTags,
            product_type: "T-Shirt",
            images: [{ src: "https://images.printify.com/mockup1.jpg" }, { src: "https://images.printify.com/mockup2.jpg" }],
            variants: Array.from({ length: variantCount }, (_, i) => ({ id: i + 1, price: "24.99" })),
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected Shopify request: ${method} ${url}`);
  }) as typeof fetch;
}

const REAL_PRINTIFY_ENV = {
  DRY_RUN: "false",
  PRINTIFY_API_KEY: "pk-test",
  PRINTIFY_SHOP_ID: "shop-1",
  PRINTIFY_BLUEPRINT_ID: "5",
  PRINTIFY_PRINT_PROVIDER_ID: "9",
  PRINTIFY_VARIANT_IDS: "111",
};

const REAL_SHOPIFY_ENV = {
  DRY_RUN: "false",
  SHOPIFY_STORE_DOMAIN: "riddimroom.myshopify.com",
  SHOPIFY_CLIENT_ID: "id",
  SHOPIFY_CLIENT_SECRET: "secret",
};

test("publishApprovedArtworkToShopifyViaPrintify publishes via Printify's native integration, finalizes tags/SEO/collection, verifies a real multi-variant product, and moves to published/ (real, DRY_RUN=false)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  const publishedRoot = tempDir(t, "riddimroom-published-");
  createUploadedArtwork(approvedRoot, "riddim", { collectionName: "Caribbean Dictionary Series" });

  const result = await publishApprovedArtworkToShopifyViaPrintify({
    approvedRoot,
    publishedRoot,
    logger: silentLogger(),
    printifyProviderOptions: {
      env: REAL_PRINTIFY_ENV,
      fetchImpl: createPrintifyFetchImpl({ shopifyProductId: "999888", shopifyHandle: "riddim-tee" }),
    },
    shopifyProviderOptions: {
      env: REAL_SHOPIFY_ENV,
      fetchImpl: createShopifyFetchImpl({
        shopifyProductId: "999888",
        handle: "riddim-tee",
        variantCount: 15, // 5 sizes x 3 colors-equivalent — the point is "more than one"
        collectionName: "Caribbean Dictionary Series",
      }),
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.published.length, 1);
  const published = result.value.published[0]!;
  assert.equal(published.printifyProductId, "printify-prod-riddim");
  assert.equal(published.shopifyProductId, "999888");
  assert.equal(published.handle, "riddim-tee");
  assert.equal(published.liveUrl, "https://riddimroom.myshopify.com/products/riddim-tee");
  assert.equal(result.value.stoppedDueTo, null);

  // Artwork and every sibling artifact moved out of processed/ into published/.
  assert.equal(existsSync(path.join(approvedRoot, "riddim.png")), false);
  assert.equal(existsSync(path.join(publishedRoot, "riddim.png")), true);
  const shopifyJson: unknown = JSON.parse(readFileSync(path.join(publishedRoot, "riddim.shopify.json"), "utf8"));
  assert.deepEqual((shopifyJson as { provider?: string }).provider, "printify-native");
});

test("publishApprovedArtworkToShopifyViaPrintify stops the batch and does not move the artwork when the product only has one variant (the exact bug this integration fixes)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  const publishedRoot = tempDir(t, "riddimroom-published-");
  createUploadedArtwork(approvedRoot, "irie");

  const result = await publishApprovedArtworkToShopifyViaPrintify({
    approvedRoot,
    publishedRoot,
    logger: silentLogger(),
    printifyProviderOptions: {
      env: REAL_PRINTIFY_ENV,
      fetchImpl: createPrintifyFetchImpl({ shopifyProductId: "111222", shopifyHandle: "irie-tee" }),
    },
    shopifyProviderOptions: {
      env: REAL_SHOPIFY_ENV,
      fetchImpl: createShopifyFetchImpl({ shopifyProductId: "111222", handle: "irie-tee", variantCount: 1 }),
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.published.length, 0);
  assert.notEqual(result.value.stoppedDueTo, null);
  assert.match(result.value.stoppedDueTo!.reason, /verification failed/);
  assert.ok(result.value.stoppedDueTo!.details.some((d) => d.includes("variants")));

  // Never moved — a failed verification must never leave designs/processed/ empty-handed.
  assert.equal(existsSync(path.join(approvedRoot, "irie.png")), true);
  assert.equal(existsSync(path.join(publishedRoot, "irie.png")), false);
});

test("publishApprovedArtworkToShopifyViaPrintify skips artwork with no printify.json yet (not uploaded)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  mkdirSync(approvedRoot, { recursive: true });
  writeFileSync(path.join(approvedRoot, "unready.png"), createSolidPng(8, 8, { r: 1, g: 1, b: 1, a: 255 }));

  const result = await publishApprovedArtworkToShopifyViaPrintify({
    approvedRoot,
    logger: silentLogger(),
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.skippedNotUploaded, [path.join(approvedRoot, "unready.png")]);
  assert.equal(result.value.published.length, 0);
});

test("publishApprovedArtworkToShopifyViaPrintify skips artwork that already has a shopify.json (idempotent, never re-publishes)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createUploadedArtwork(approvedRoot, "big-up");
  writeFileSync(path.join(approvedRoot, "big-up.shopify.json"), JSON.stringify({ shopifyProductId: "already-done" }));

  const result = await publishApprovedArtworkToShopifyViaPrintify({
    approvedRoot,
    logger: silentLogger(),
    printifyProviderOptions: {
      env: REAL_PRINTIFY_ENV,
      fetchImpl: (async () => {
        throw new Error("must not call Printify for an already-published design");
      }) as unknown as typeof fetch,
    },
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.skippedAlreadyPublished, [path.join(approvedRoot, "big-up.png")]);
  assert.equal(result.value.published.length, 0);
});

test("publishApprovedArtworkToShopifyViaPrintify never moves a DRY_RUN publish to designs/published/ and never writes <stem>.shopify.json for it (dry-run isolation)", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  const publishedRoot = tempDir(t, "riddimroom-published-");
  createUploadedArtwork(approvedRoot, "liming");

  const result = await publishApprovedArtworkToShopifyViaPrintify({
    approvedRoot,
    publishedRoot,
    logger: silentLogger(),
    printifyProviderOptions: { env: { DRY_RUN: "true" } },
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.published.length, 0);
  assert.equal(result.value.dryRunPublished.length, 1);
  assert.equal(existsSync(path.join(approvedRoot, "liming.png")), true);
  assert.equal(existsSync(path.join(publishedRoot, "liming.png")), false);
  assert.equal(existsSync(path.join(approvedRoot, "liming.shopify.json")), false);
  assert.equal(existsSync(path.join(approvedRoot, "liming.shopify.dryrun.json")), true);
});

test("publishApprovedArtworkToShopifyViaPrintify reports a ConfigError and publishes nothing when Printify is misconfigured", async (t) => {
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createUploadedArtwork(approvedRoot, "chipping");

  const result = await publishApprovedArtworkToShopifyViaPrintify({
    approvedRoot,
    logger: silentLogger(),
    printifyProviderOptions: { env: { DRY_RUN: "false" } }, // missing required Printify config
    shopifyProviderOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, false);
});
