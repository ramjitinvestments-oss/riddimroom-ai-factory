import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPreflightCheck } from "../../scripts/preflight-check.ts";
import { createSolidPng } from "../../automation/ai/png.ts";

function tempDir(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const PRINT_WIDTH = 4500;
const PRINT_HEIGHT = 5400;

const REAL_ENV = {
  DRY_RUN: "false",
  SHOPIFY_STORE_DOMAIN: "test-store.myshopify.com",
  SHOPIFY_CLIENT_ID: "client-1",
  SHOPIFY_CLIENT_SECRET: "secret-1",
  SHOPIFY_API_VERSION: "2025-01",
  PRINTIFY_API_KEY: "pk-test",
  PRINTIFY_SHOP_ID: "shop-1",
  PRINTIFY_BLUEPRINT_ID: "12",
  PRINTIFY_PRINT_PROVIDER_ID: "39",
  PRINTIFY_VARIANT_IDS: "111,112",
  PRINTIFY_BLACK_VARIANT_IDS: "211,212",
};

function createPublishedFixture(publishedRoot: string, stem: string, shopifyProductId: string, printifyProductId: string): void {
  mkdirSync(publishedRoot, { recursive: true });
  writeFileSync(path.join(publishedRoot, `${stem}.png`), createSolidPng(8, 8, { r: 1, g: 2, b: 3, a: 255 }));
  writeFileSync(
    path.join(publishedRoot, `${stem}.printify.json`),
    JSON.stringify({ printifyProductId, printifyImageId: `${printifyProductId}-img` }),
  );
  writeFileSync(path.join(publishedRoot, `${stem}.shopify.json`), JSON.stringify({ shopifyProductId }));
}

function createPendingFixture(approvedRoot: string, stem: string, jobId: string): void {
  mkdirSync(approvedRoot, { recursive: true });
  writeFileSync(path.join(approvedRoot, `${stem}.png`), createSolidPng(PRINT_WIDTH, PRINT_HEIGHT, { r: 1, g: 2, b: 3, a: 255 }));
  writeFileSync(
    path.join(approvedRoot, `${stem}.product.json`),
    JSON.stringify({ jobId, title: stem, collectionName: "Test Collection" }),
  );
  writeFileSync(path.join(approvedRoot, `${stem}.seo.json`), JSON.stringify({ seoTitle: stem, seoDescription: "desc" }));
  writeFileSync(path.join(approvedRoot, `${stem}.tags.json`), JSON.stringify(["tee"]));
  writeFileSync(path.join(approvedRoot, `${stem}.description.md`), `# ${stem}\n\nDescription.\n`);
}

/** A fetchImpl that answers Printify's shops ping and Shopify's token + product read-back endpoints. */
function fullyWorkingFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("api.printify.com/v1/shops.json")) {
      return new Response(JSON.stringify([{ id: "shop-1" }]), { status: 200 });
    }
    if (url.includes("/admin/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 86399 }), { status: 200 });
    }
    if (url.includes("/products/") && url.includes(".json") && !url.includes("metafields") && !url.includes("images")) {
      return new Response(
        JSON.stringify({ product: { id: 999, title: "Gold Turntable RiddimRoom T-Shirt", handle: "gold-turntable", status: "active" } }),
        { status: 200 },
      );
    }
    if (url.includes("/metafields.json")) {
      return new Response(JSON.stringify({ metafields: [] }), { status: 200 });
    }
    if (url.includes("/collects.json")) {
      return new Response(JSON.stringify({ collects: [] }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("runPreflightCheck fails when DRY_RUN is not explicitly false", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createPublishedFixture(publishedRoot, "GOLDEN turntable", "shop-prod-1", "printify-prod-1");

  const report = await runPreflightCheck({
    publishedRoot,
    approvedRoot,
    publishedStems: ["GOLDEN turntable"],
    pendingStems: [],
    env: { ...REAL_ENV, DRY_RUN: "true" },
    fetchImpl: fullyWorkingFetch(),
  });

  assert.equal(report.passed, false);
  const check = report.checks.find((c) => c.name === "DRY_RUN is false");
  assert.equal(check?.status, "fail");
});

test("runPreflightCheck fails when PRINTIFY_BLACK_VARIANT_IDS is missing", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createPublishedFixture(publishedRoot, "GOLDEN turntable", "shop-prod-1", "printify-prod-1");

  const env = { ...REAL_ENV };
  delete (env as Record<string, string>).PRINTIFY_BLACK_VARIANT_IDS;

  const report = await runPreflightCheck({
    publishedRoot,
    approvedRoot,
    publishedStems: ["GOLDEN turntable"],
    pendingStems: [],
    env,
    fetchImpl: fullyWorkingFetch(),
  });

  assert.equal(report.passed, false);
  const check = report.checks.find((c) => c.name === "PRINTIFY_BLACK_VARIANT_IDS set");
  assert.equal(check?.status, "fail");
});

test("runPreflightCheck fails when Printify/Shopify credentials are missing", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");

  const report = await runPreflightCheck({
    publishedRoot,
    approvedRoot,
    publishedStems: [],
    pendingStems: [],
    env: { DRY_RUN: "false" },
  });

  assert.equal(report.passed, false);
  assert.equal(report.checks.find((c) => c.name === "Shopify credentials configured")?.status, "fail");
  assert.equal(report.checks.find((c) => c.name === "Printify credentials configured")?.status, "fail");
});

test("runPreflightCheck detects a real live-network failure honestly (never fabricates a pass)", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createPublishedFixture(publishedRoot, "GOLDEN turntable", "shop-prod-1", "printify-prod-1");

  const alwaysFailFetch = (async () => {
    throw new Error("simulated network failure");
  }) as typeof fetch;

  const report = await runPreflightCheck({
    publishedRoot,
    approvedRoot,
    publishedStems: ["GOLDEN turntable"],
    pendingStems: [],
    env: REAL_ENV,
    fetchImpl: alwaysFailFetch,
  });

  assert.equal(report.passed, false);
  assert.equal(report.checks.find((c) => c.name === "Printify API reachable")?.status, "fail");
  assert.equal(report.checks.find((c) => c.name === 'Existing Shopify product id — "GOLDEN turntable"')?.status, "fail");
});

test("runPreflightCheck fails when a pending design is missing required artwork or metadata", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createPublishedFixture(publishedRoot, "GOLDEN turntable", "shop-prod-1", "printify-prod-1");
  // "incomplete" has artwork but no metadata files.
  mkdirSync(approvedRoot, { recursive: true });
  writeFileSync(path.join(approvedRoot, "incomplete.png"), createSolidPng(PRINT_WIDTH, PRINT_HEIGHT, { r: 1, g: 2, b: 3, a: 255 }));

  const report = await runPreflightCheck({
    publishedRoot,
    approvedRoot,
    publishedStems: ["GOLDEN turntable"],
    pendingStems: ["incomplete"],
    env: REAL_ENV,
    fetchImpl: fullyWorkingFetch(),
  });

  assert.equal(report.passed, false);
  assert.equal(report.checks.find((c) => c.name === 'Metadata present — "incomplete"')?.status, "fail");
});

test("runPreflightCheck detects duplicate jobIds across pending designs", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createPublishedFixture(publishedRoot, "GOLDEN turntable", "shop-prod-1", "printify-prod-1");
  createPendingFixture(approvedRoot, "design-a", "shared-job-id");
  createPendingFixture(approvedRoot, "design-b", "shared-job-id");

  const report = await runPreflightCheck({
    publishedRoot,
    approvedRoot,
    publishedStems: ["GOLDEN turntable"],
    pendingStems: ["design-a", "design-b"],
    env: REAL_ENV,
    fetchImpl: fullyWorkingFetch(),
  });

  assert.equal(report.passed, false);
  const duplicateCheck = report.checks.find((c) => c.name.startsWith("No duplicate pending jobs — "));
  assert.equal(duplicateCheck?.status, "fail");
});

test("runPreflightCheck warns (does not fail) on a stray dry-run artifact", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createPublishedFixture(publishedRoot, "GOLDEN turntable", "shop-prod-1", "printify-prod-1");
  mkdirSync(approvedRoot, { recursive: true });
  writeFileSync(path.join(approvedRoot, "stale.shopify.dryrun.json"), JSON.stringify({ dryRun: true }));

  const report = await runPreflightCheck({
    publishedRoot,
    approvedRoot,
    publishedStems: ["GOLDEN turntable"],
    pendingStems: [],
    env: REAL_ENV,
    fetchImpl: fullyWorkingFetch(),
  });

  const strayCheck = report.checks.find((c) => c.name === "No stray dry-run artifacts");
  assert.equal(strayCheck?.status, "warn");
  // A warning alone must not block the launch.
  assert.equal(report.passed, true);
});

test("runPreflightCheck passes end-to-end when every real precondition is genuinely met", async (t) => {
  const publishedRoot = tempDir(t, "riddimroom-published-");
  const approvedRoot = tempDir(t, "riddimroom-processed-");
  createPublishedFixture(publishedRoot, "GOLDEN turntable", "shop-prod-1", "printify-prod-1");
  createPendingFixture(approvedRoot, "crown", "job-crown");

  const report = await runPreflightCheck({
    publishedRoot,
    approvedRoot,
    publishedStems: ["GOLDEN turntable"],
    pendingStems: ["crown"],
    env: REAL_ENV,
    fetchImpl: fullyWorkingFetch(),
  });

  assert.equal(
    report.passed,
    true,
    `expected pass, got failures: ${JSON.stringify(report.checks.filter((c) => c.status === "fail"), null, 2)}`,
  );
  assert.ok(report.checks.every((c) => c.status !== "fail"));
});
