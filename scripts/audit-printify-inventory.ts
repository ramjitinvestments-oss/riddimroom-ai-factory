/**
 * READ-ONLY audit — never writes to Printify or Shopify, never creates,
 * publishes, or modifies anything. Part of the 2026-08-05 infrastructure
 * audit (see scripts/diagnose-printify-shop.ts's header comment for the
 * incident this responds to).
 *
 * For every Printify shop on this account: lists every product (paginated
 * GET /shops/{id}/products.json) and records exactly what Printify itself
 * reports for it — id, title, visibility, variant count/enabled count,
 * and the `external` field (the Shopify product id/handle Printify's own
 * publish integration linked it to, if any). This is the ground truth for
 * "which Printify shop actually holds which products, and which of those
 * are actually linked to a live Shopify product."
 *
 * Writes the full raw inventory to logs/printify-inventory-<timestamp>.json
 * and prints a per-shop summary table to stdout. Does not touch Shopify's
 * API at all — the Shopify-side inventory is pulled separately (this
 * factory's Shopify MCP connector, not this codebase) and cross-referenced
 * by hand/report, not by this script.
 *
 *   node --experimental-strip-types scripts/audit-printify-inventory.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../automation/shared/config.ts";
import { ExternalServiceError, ValidationError } from "../automation/shared/errors.ts";
import { err, ok, type Result } from "../automation/shared/result.ts";

const PRINTIFY_API_BASE = "https://api.printify.com/v1";
const PAGE_SIZE = 50;

interface ShopEntry {
  readonly id: number;
  readonly title: string;
  readonly sales_channel?: string;
}

interface PrintifyVariant {
  readonly id?: number;
  readonly price?: number;
  readonly is_enabled?: boolean;
}

interface PrintifyProductEntry {
  readonly id?: string;
  readonly title?: string;
  readonly visible?: boolean;
  readonly is_locked?: boolean;
  readonly blueprint_id?: number;
  readonly print_provider_id?: number;
  readonly variants?: readonly PrintifyVariant[];
  readonly external?: { readonly id?: string; readonly handle?: string } | null;
  readonly created_at?: string;
  readonly updated_at?: string;
}

interface ListProductsResponse {
  readonly data?: readonly PrintifyProductEntry[];
  readonly current_page?: number;
  readonly last_page?: number;
  readonly total?: number;
}

export interface ShopInventory {
  readonly shopId: number;
  readonly shopTitle: string;
  readonly salesChannel: string | undefined;
  readonly connected: boolean;
  readonly totalProducts: number;
  readonly linkedToShopify: number; // external.id present
  readonly notLinkedToShopify: number;
  readonly lockedProducts: number;
  readonly singleVariantOrFewer: number; // variants.length <= 1 -- the "broken" signature
  readonly products: readonly {
    readonly printifyProductId: string;
    readonly title: string;
    readonly visible: boolean | undefined;
    readonly isLocked: boolean | undefined;
    readonly variantCount: number;
    readonly enabledVariantCount: number;
    readonly shopifyProductId: string | undefined;
    readonly shopifyHandle: string | undefined;
    readonly createdAt: string | undefined;
    readonly updatedAt: string | undefined;
  }[];
}

export interface AuditPrintifyInventoryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

type AuditError = ValidationError | ExternalServiceError;

async function listAllProducts(
  apiKey: string,
  shopId: number,
  fetchImpl: typeof fetch,
): Promise<PrintifyProductEntry[]> {
  const all: PrintifyProductEntry[] = [];
  let page = 1;
  for (;;) {
    const response = await fetchImpl(
      `${PRINTIFY_API_BASE}/shops/${shopId}/products.json?page=${page}&limit=${PAGE_SIZE}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new ExternalServiceError("printify", `list products failed for shop ${shopId}: ${response.status} ${text}`, {
        statusCode: response.status,
      });
    }
    const body = (await response.json()) as ListProductsResponse;
    const products = body.data ?? [];
    all.push(...products);
    const lastPage = body.last_page ?? page;
    if (products.length === 0 || page >= lastPage) break;
    page += 1;
  }
  return all;
}

export async function auditPrintifyInventory(
  options: AuditPrintifyInventoryOptions = {},
): Promise<Result<readonly ShopInventory[], AuditError>> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = env.PRINTIFY_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    return err(new ValidationError(["PRINTIFY_API_KEY is not set"]));
  }

  try {
    const shopsResponse = await fetchImpl(`${PRINTIFY_API_BASE}/shops.json`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!shopsResponse.ok) {
      const text = await shopsResponse.text().catch(() => "<no body>");
      return err(new ExternalServiceError("printify", `list shops failed: ${shopsResponse.status} ${text}`, { statusCode: shopsResponse.status }));
    }
    const shops = (await shopsResponse.json()) as readonly ShopEntry[];

    const inventories: ShopInventory[] = [];
    for (const shop of shops) {
      const products = await listAllProducts(apiKey, shop.id, fetchImpl);
      const mapped = products.map((p) => {
        const variantCount = p.variants?.length ?? 0;
        const enabledVariantCount = p.variants?.filter((v) => v.is_enabled === true).length ?? 0;
        return {
          printifyProductId: p.id ?? "(missing id)",
          title: p.title ?? "(missing title)",
          visible: p.visible,
          isLocked: p.is_locked,
          variantCount,
          enabledVariantCount,
          shopifyProductId: p.external?.id ?? undefined,
          shopifyHandle: p.external?.handle ?? undefined,
          createdAt: p.created_at,
          updatedAt: p.updated_at,
        };
      });

      inventories.push({
        shopId: shop.id,
        shopTitle: shop.title,
        salesChannel: shop.sales_channel,
        connected: shop.sales_channel !== undefined && shop.sales_channel !== null && shop.sales_channel !== "disconnected",
        totalProducts: mapped.length,
        linkedToShopify: mapped.filter((p) => p.shopifyProductId !== undefined).length,
        notLinkedToShopify: mapped.filter((p) => p.shopifyProductId === undefined).length,
        lockedProducts: mapped.filter((p) => p.isLocked === true).length,
        singleVariantOrFewer: mapped.filter((p) => p.variantCount <= 1).length,
        products: mapped,
      });
    }

    return ok(inventories);
  } catch (error) {
    if (error instanceof ExternalServiceError || error instanceof ValidationError) {
      return err(error);
    }
    return err(new ExternalServiceError("printify", "audit failed", { cause: error }));
  }
}

async function main(): Promise<void> {
  loadEnv();
  const now = new Date();
  const result = await auditPrintifyInventory();
  if (!result.ok) {
    console.error(`Audit failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const inventories = result.value;

  console.log("\n=== Printify Shop Inventory ===\n");
  console.log(
    "Shop".padEnd(20) +
      "Id".padEnd(12) +
      "SalesChannel".padEnd(14) +
      "Connected".padEnd(11) +
      "Products".padEnd(10) +
      "LinkedToShopify".padEnd(18) +
      "SingleVariant".padEnd(15) +
      "Locked",
  );
  for (const inv of inventories) {
    console.log(
      inv.shopTitle.padEnd(20) +
        String(inv.shopId).padEnd(12) +
        (inv.salesChannel ?? "none").padEnd(14) +
        String(inv.connected).padEnd(11) +
        String(inv.totalProducts).padEnd(10) +
        String(inv.linkedToShopify).padEnd(18) +
        String(inv.singleVariantOrFewer).padEnd(15) +
        String(inv.lockedProducts),
    );
  }

  console.log("\n=== Per-shop product detail ===");
  for (const inv of inventories) {
    console.log(`\n--- ${inv.shopTitle} (id ${inv.shopId}) — ${inv.totalProducts} products ---`);
    for (const p of inv.products) {
      console.log(
        `  ${p.printifyProductId}  "${p.title}"  variants=${p.variantCount}(${p.enabledVariantCount} enabled)  ` +
          `shopify=${p.shopifyProductId ?? "(not linked)"}  handle=${p.shopifyHandle ?? "-"}  ` +
          `locked=${p.isLocked ?? "?"}  visible=${p.visible ?? "?"}`,
      );
    }
  }

  mkdirSync("logs", { recursive: true });
  const outPath = path.join("logs", `printify-inventory-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, JSON.stringify(inventories, null, 2));
  console.log(`\nFull raw inventory written to ${outPath}`);
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
