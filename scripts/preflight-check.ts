/**
 * Production pre-flight check for the apparel launch. Verifies every
 * precondition `scripts/launch-apparel.ts` depends on — credentials,
 * connectivity, artwork, metadata, placement config, existing product ids
 * — and reports pass/fail/warn for each, rather than letting the launch
 * command discover a missing precondition three stages in. Read-only:
 * this makes no writes and no Printify/Shopify mutations, only a
 * lightweight connectivity read against each (Shopify: read back the
 * existing Gold Turntable product; Printify: `GET /v1/shops.json`).
 *
 * Does not duplicate any pipeline logic — reuses the same
 * `createShopifyProvider`/`createPrintifyProvider` factories and
 * `outputPaths()` conventions every other stage script already uses.
 *
 * FAIL checks block the launch. WARN checks are reported but don't —
 * they flag things worth a human's attention (e.g. a stray dry-run
 * artifact) that don't actually risk a bad production write.
 *
 *   node --experimental-strip-types scripts/preflight-check.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRINTIFY_ENV_SPECS } from "../automation/printify/create-provider.ts";
import { createShopifyProvider } from "../automation/shopify/create-provider.ts";
import { SHOPIFY_ENV_SPECS } from "../automation/shopify/create-provider.ts";
import { readPngDimensions, hasAlphaChannel } from "../automation/ai/png.ts";
import { validateConfig } from "../automation/shared/config.ts";
import { outputPaths } from "./import-artwork.ts";

export type CheckStatus = "pass" | "fail" | "warn";

export interface PreflightCheckItem {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface PreflightCheckReport {
  readonly passed: boolean; // true only if every check is "pass" or "warn" — no "fail"
  readonly checks: readonly PreflightCheckItem[];
}

export interface PreflightCheckOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Design stems expected to already be published (have an existing Printify + Shopify product). Defaults to ["GOLDEN turntable"]. */
  readonly publishedStems?: readonly string[];
  /** Design stems expected to be pending (in designs/processed/, not yet uploaded). Defaults to the 3 pending apparel designs. */
  readonly pendingStems?: readonly string[];
  readonly approvedRoot?: string;
  readonly publishedRoot?: string;
  readonly fetchImpl?: typeof fetch;
}

interface ProductJson {
  readonly jobId?: string;
  readonly title?: string;
  readonly collectionName?: string;
}

function readJsonSafe(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

export async function runPreflightCheck(options: PreflightCheckOptions = {}): Promise<PreflightCheckReport> {
  const env = options.env ?? process.env;
  const publishedRoot = options.publishedRoot ?? path.join("designs", "published");
  const approvedRoot = options.approvedRoot ?? path.join("designs", "processed");
  const publishedStems = options.publishedStems ?? ["GOLDEN turntable"];
  const pendingStems = options.pendingStems ?? ["crown", "RR shirt 1", "treasure chest"];
  const fetchImpl = options.fetchImpl ?? fetch;

  const checks: PreflightCheckItem[] = [];

  // 1. DRY_RUN must be explicitly false — a "launch" that silently ran in dry-run and reported success
  // would be exactly the kind of fabricated progress this project's rules forbid.
  const dryRunRaw = (env.DRY_RUN ?? "true").trim().toLowerCase();
  checks.push(
    dryRunRaw === "false"
      ? { name: "DRY_RUN is false", status: "pass", detail: "Real production calls will be made." }
      : {
          name: "DRY_RUN is false",
          status: "fail",
          detail: `DRY_RUN is "${env.DRY_RUN ?? "(unset, defaults to true)"}" — set DRY_RUN=false to launch for real.`,
        },
  );

  // 2. Shopify env vars.
  const shopifyConfig = validateConfig(SHOPIFY_ENV_SPECS, env);
  checks.push(
    shopifyConfig.ok
      ? { name: "Shopify credentials configured", status: "pass", detail: "All required SHOPIFY_* env vars present." }
      : { name: "Shopify credentials configured", status: "fail", detail: shopifyConfig.error.message },
  );

  // 3. Printify env vars.
  const printifyConfig = validateConfig(PRINTIFY_ENV_SPECS, env);
  checks.push(
    printifyConfig.ok
      ? { name: "Printify credentials configured", status: "pass", detail: "All required PRINTIFY_* env vars present." }
      : { name: "Printify credentials configured", status: "fail", detail: printifyConfig.error.message },
  );

  // 4. PRINTIFY_BLACK_VARIANT_IDS.
  const blackVariantIdsRaw = env.PRINTIFY_BLACK_VARIANT_IDS;
  const blackVariantIds = (blackVariantIdsRaw ?? "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  checks.push(
    blackVariantIds.length > 0
      ? { name: "PRINTIFY_BLACK_VARIANT_IDS set", status: "pass", detail: `${blackVariantIds.length} variant id(s): ${blackVariantIds.join(", ")}` }
      : {
          name: "PRINTIFY_BLACK_VARIANT_IDS set",
          status: "fail",
          detail:
            "Not set or empty. Look these up via Printify's Catalog API — see the header comment in " +
            "scripts/regenerate-printify-product.ts for the exact command.",
        },
  );

  // 5. Placement configuration — optional overrides, informational only (defaults are baked into code).
  const placementOverrides = ["PRINTIFY_PRINT_X", "PRINTIFY_PRINT_Y", "PRINTIFY_PRINT_SCALE"].filter((k) => env[k] !== undefined);
  checks.push(
    placementOverrides.length === 0
      ? {
          name: "Placement configuration",
          status: "pass",
          detail: "Using the approved upper-chest standard baked into automation/printify/printify-provider.ts (x=0.5, y=0.35, scale=0.85).",
        }
      : {
          name: "Placement configuration",
          status: "warn",
          detail: `Overridden via env: ${placementOverrides.map((k) => `${k}=${env[k]}`).join(", ")} — confirm this is intentional.`,
        },
  );

  // 6. Printify connectivity (read-only ping).
  if (printifyConfig.ok) {
    try {
      const response = await fetchImpl("https://api.printify.com/v1/shops.json", {
        headers: { Authorization: `Bearer ${printifyConfig.value.PRINTIFY_API_KEY}` },
      });
      checks.push(
        response.ok
          ? { name: "Printify API reachable", status: "pass", detail: `GET /v1/shops.json → HTTP ${response.status}` }
          : { name: "Printify API reachable", status: "fail", detail: `GET /v1/shops.json → HTTP ${response.status}` },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({ name: "Printify API reachable", status: "fail", detail: `Request failed: ${message}` });
    }
  } else {
    checks.push({ name: "Printify API reachable", status: "fail", detail: "Skipped — Printify credentials are not configured." });
  }

  // 7. Shopify connectivity + existing product id, checked together: read back each published design's
  // real Shopify product. This is more meaningful than a bare ping — it proves both connectivity and
  // that the id on file still resolves to a real, live product.
  if (shopifyConfig.ok) {
    const shopifyProviderResult = createShopifyProvider({ env, ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}) });
    if (shopifyProviderResult.ok) {
      for (const stem of publishedStems) {
        const outputs = outputPaths(path.join(publishedRoot, `${stem}.png`));
        const shopifyJson = readJsonSafe(outputs.shopify) as { shopifyProductId?: string } | undefined;
        if (shopifyJson?.shopifyProductId === undefined) {
          checks.push({
            name: `Existing Shopify product id — "${stem}"`,
            status: "fail",
            detail: `${outputs.shopify} is missing or has no shopifyProductId.`,
          });
          continue;
        }
        const readBack = await shopifyProviderResult.value.getProduct(shopifyJson.shopifyProductId);
        checks.push(
          readBack.ok
            ? {
                name: `Existing Shopify product id — "${stem}"`,
                status: "pass",
                detail: `${shopifyJson.shopifyProductId} resolves live (title: "${readBack.value.title}").`,
              }
            : {
                name: `Existing Shopify product id — "${stem}"`,
                status: "fail",
                detail: `${shopifyJson.shopifyProductId} could not be read back: ${readBack.error.message}`,
              },
        );
      }
    } else {
      checks.push({ name: "Shopify API reachable", status: "fail", detail: shopifyProviderResult.error.message });
    }
  } else {
    checks.push({ name: "Shopify API reachable", status: "fail", detail: "Skipped — Shopify credentials are not configured." });
  }

  // 8. Existing Printify product ids for already-published designs.
  for (const stem of publishedStems) {
    const outputs = outputPaths(path.join(publishedRoot, `${stem}.png`));
    const printifyJson = readJsonSafe(outputs.printify) as
      | { printifyProductId?: string; printifyImageId?: string }
      | undefined;
    checks.push(
      printifyJson?.printifyProductId !== undefined && printifyJson.printifyImageId !== undefined
        ? {
            name: `Existing Printify product id — "${stem}"`,
            status: "pass",
            detail: `printifyProductId=${printifyJson.printifyProductId}, printifyImageId=${printifyJson.printifyImageId}`,
          }
        : {
            name: `Existing Printify product id — "${stem}"`,
            status: "fail",
            detail: `${outputs.printify} is missing printifyProductId/printifyImageId.`,
          },
    );
  }

  // 9. Required artwork + metadata + collections for pending designs.
  const seenJobIds = new Map<string, string>(); // jobId -> stem, for duplicate detection
  for (const stem of pendingStems) {
    const outputs = outputPaths(path.join(approvedRoot, `${stem}.png`));
    const pngPath = path.join(approvedRoot, `${stem}.png`);
    if (!existsSync(pngPath)) {
      checks.push({ name: `Artwork present — "${stem}"`, status: "fail", detail: `${pngPath} does not exist.` });
      continue;
    }
    const dims = readPngDimensions(readFileSync(pngPath));
    if (!dims.ok) {
      checks.push({ name: `Artwork present — "${stem}"`, status: "fail", detail: dims.error.message });
    } else if (dims.value.width !== 4500 || dims.value.height !== 5400) {
      checks.push({
        name: `Artwork present — "${stem}"`,
        status: "fail",
        detail: `${pngPath} is ${dims.value.width}x${dims.value.height}, expected 4500x5400.`,
      });
    } else if (!hasAlphaChannel(dims.value.colorType)) {
      checks.push({ name: `Artwork present — "${stem}"`, status: "fail", detail: `${pngPath} has no alpha channel (not transparent).` });
    } else {
      checks.push({ name: `Artwork present — "${stem}"`, status: "pass", detail: "4500x5400, transparent PNG." });
    }

    const requiredMetadata = [
      ["product.json", outputs.product],
      ["seo.json", outputs.seo],
      ["tags.json", outputs.tags],
      ["description.md", outputs.description],
    ] as const;
    const missingMetadata = requiredMetadata.filter(([, filePath]) => !existsSync(filePath)).map(([name]) => name);
    checks.push(
      missingMetadata.length === 0
        ? { name: `Metadata present — "${stem}"`, status: "pass", detail: "product/seo/tags/description all present." }
        : { name: `Metadata present — "${stem}"`, status: "fail", detail: `Missing: ${missingMetadata.join(", ")}` },
    );

    const productJson = readJsonSafe(outputs.product) as ProductJson | undefined;
    checks.push(
      productJson?.collectionName !== undefined && productJson.collectionName.trim().length > 0
        ? { name: `Collection assigned — "${stem}"`, status: "pass", detail: `collectionName: "${productJson.collectionName}"` }
        : { name: `Collection assigned — "${stem}"`, status: "fail", detail: `${outputs.product} has no collectionName.` },
    );

    if (productJson?.jobId !== undefined) {
      const existingStem = seenJobIds.get(productJson.jobId);
      if (existingStem !== undefined) {
        checks.push({
          name: `No duplicate pending jobs — "${stem}"`,
          status: "fail",
          detail: `jobId ${productJson.jobId} is shared with "${existingStem}" — duplicate job.`,
        });
      }
      seenJobIds.set(productJson.jobId, stem);
    }
  }
  if (pendingStems.length > 0) {
    checks.push({
      name: "No duplicate pending jobs (overall)",
      status: "pass",
      detail: `${seenJobIds.size} unique job id(s) across ${pendingStems.length} pending design(s).`,
    });
  }

  // 10. No stray dry-run artifacts left in designs/processed/ (warning only — harmless, but worth flagging).
  if (existsSync(approvedRoot)) {
    const strayDryRunFiles = readdirSync(approvedRoot).filter((f) => f.endsWith(".shopify.dryrun.json"));
    checks.push(
      strayDryRunFiles.length === 0
        ? { name: "No stray dry-run artifacts", status: "pass", detail: `No *.shopify.dryrun.json files under ${approvedRoot}.` }
        : {
            name: "No stray dry-run artifacts",
            status: "warn",
            detail: `${strayDryRunFiles.length} stray file(s) from earlier DRY_RUN testing: ${strayDryRunFiles.join(", ")}. Harmless (never affects idempotency), but safe to delete.`,
          },
    );
  }

  const passed = checks.every((c) => c.status !== "fail");
  return { passed, checks };
}

function printReport(report: PreflightCheckReport): void {
  console.log("\nPre-flight check:");
  for (const check of report.checks) {
    const marker = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    console.log(`  ${marker} ${check.name}`);
    console.log(`      ${check.detail}`);
  }
  const failCount = report.checks.filter((c) => c.status === "fail").length;
  const warnCount = report.checks.filter((c) => c.status === "warn").length;
  console.log(`\n${report.checks.length} checks — ${failCount} failed, ${warnCount} warning(s).`);
  console.log(report.passed ? "PRE-FLIGHT PASSED" : "PRE-FLIGHT FAILED — launch blocked.");
}

async function main(): Promise<void> {
  const { loadEnv } = await import("../automation/shared/config.ts");
  loadEnv();
  const report = await runPreflightCheck();
  printReport(report);
  if (!report.passed) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
