/**
 * ONE-OFF REMEDIATION — 2026-08-05 production incident.
 *
 * The Caribbean Dictionary Series batch (Big Up, Chipping, Irie, Liming,
 * Pickney, Riddim, Soon Come, Watch Nah) was launched through the create
 * path before scripts/publish-to-shopify-via-printify.ts existed: each was
 * created via a bare Shopify Admin API call
 * (scripts/publish-to-shopify.ts), which only ever produces a single
 * generic "Default Title" variant with 0 inventory — not orderable, no
 * real fulfillment link to Printify. This script repairs those 8 specific
 * live products.
 *
 * Because Printify's publish-to-Shopify integration *creates* a product
 * rather than repairing one in place (see PrintifyPublishRequest's doc
 * comment), this is a replace, not an in-place fix:
 *   1. Find each design's existing Printify product by title (its
 *      printifyProductId was never persisted locally — see
 *      .github/workflows/launch-apparel.yml's 2026-08-05 comment for why —
 *      so it has to be looked up fresh via PrintifyProvider.findProductIdByTitle).
 *   2. Publish that Printify product to Shopify via the real integration
 *      (PrintifyProvider.publishProductToShopify) — creates a NEW, real,
 *      fulfillment-linked Shopify product with the full variant matrix.
 *   3. Apply the same tags/SEO/collection metadata (ShopifyProvider.finalizeExternalProduct)
 *      the ORIGINAL live product already had, sourced by hand from the
 *      live store on 2026-08-05 — not regenerated, so nothing about the
 *      already-approved copy or SEO changes.
 *   4. Verify: more than one real variant (the actual bug), tags, SEO,
 *      collection all match.
 *
 * This script never touches the old broken product — it only reports the
 * new replacement's id/handle. Archiving the old (and any duplicate draft)
 * products is a deliberate separate manual step once each replacement is
 * confirmed live and orderable, to avoid taking anything offline before
 * its replacement is verified.
 *
 * Must run somewhere with real network access to api.printify.com and
 * Shopify's OAuth endpoint — see .github/workflows/repair-legacy-products.yml.
 *
 *   node --experimental-strip-types scripts/repair-legacy-shopify-products.ts
 */
import { fileURLToPath } from "node:url";
import { createPrintifyProvider } from "../automation/printify/create-provider.ts";
import { createShopifyProvider } from "../automation/shopify/create-provider.ts";
import { loadEnv } from "../automation/shared/config.ts";
import { ConsoleTransport, FileTransport } from "../automation/shared/log-transport.ts";
import { Logger } from "../automation/shared/logger.ts";

/**
 * Hand-verified against the live store (Shopify MCP connector, 2026-08-05)
 * — each entry's `title` is the exact title used both at Printify upload
 * time and on the currently-live broken Shopify product (both come from
 * the same product.json.title field in the original — since-lost — batch
 * run), used to look the Printify product up. tags/seoTitle/seoDescription/
 * collection are copied verbatim from the live (broken) product so the
 * replacement carries the same already-approved metadata.
 */
const REPAIR_MANIFEST: ReadonlyArray<{
  readonly designStem: string;
  readonly title: string;
  readonly oldShopifyProductId: string;
  readonly tags: readonly string[];
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly collection: string;
}> = [
  {
    designStem: "Big Up",
    title: "Big Up Yourself T-Shirt",
    oldShopifyProductId: "8685100335254",
    tags: ["Big Up", "Caribbean Culture", "Comfortable T-Shirt", "Cultural Expression", "Island Pride", "Jamaican Patois", "Respect", "Streetwear", "Stylish Tee", "Unity"],
    seoTitle: "Big Up Yourself T-Shirt - Express Caribbean Pride",
    seoDescription: "Shop the Big Up Yourself T-Shirt - a celebration of respect and culture in vibrant Caribbean style.",
    collection: "Carnival Energy",
  },
  {
    designStem: "Chipping",
    title: "Chipping: Slow Dance T-Shirt",
    oldShopifyProductId: "8685100400790",
    tags: ["apparel", "Caribbean", "carnival", "chipping", "culture", "dance", "fashion", "festival", "fun", "island vibes", "party", "RiddimRoom", "streetwear", "summer", "t-shirt"],
    seoTitle: "Chipping Slow Dance T-Shirt | RiddimRoom",
    seoDescription: "Celebrate Caribbean culture with our Chipping T-Shirt, perfect for carnival vibes and slow dancing. A must for any festival lover!",
    collection: "Carnival Energy",
  },
  {
    designStem: "Irie",
    title: "Irie Caribbean Dictionary T-Shirt",
    oldShopifyProductId: "8685100433558",
    tags: ["Caribbean", "Casual Wear", "Good Vibes", "Irie", "Island Culture", "Positive Energy", "RiddimRoom", "Streetwear", "Tropical Fashion", "Typographic Design"],
    seoTitle: "Irie T-Shirt | Caribbean Culture",
    seoDescription: "Shop our 'Irie' t-shirt, celebrating Caribbean vibes and positivity. Perfect for all island culture lovers!",
    collection: "Caribbean Flags",
  },
  {
    designStem: "Liming",
    title: "Liming: The Art of Gathering",
    oldShopifyProductId: "8685100466326",
    tags: ["Caribbean culture", "casualwear", "friendship", "fun", "Guyana", "island vibes", "lifestyle", "liming", "streetwear", "Trinidad"],
    seoTitle: "Liming: The Art of Gathering T-Shirt",
    seoDescription: "Embrace Caribbean culture with our Liming t-shirt, celebrating friendship and fun!",
    collection: "Island Vibes",
  },
  {
    designStem: "Pickney",
    title: "Pickney Definition Tee - Caribbean Dictionary Series No. 007",
    oldShopifyProductId: "8685100499094",
    tags: ["caribbean", "childhood", "culture", "dictionary", "fashion", "humor", "island", "pickney", "playful", "slang", "streetwear", "t-shirt", "trendy", "vibrant", "youth"],
    seoTitle: "Pickney Definition Tee - Caribbean Slang Shirt",
    seoDescription: "Shop the Pickney Definition Tee, celebrating Caribbean youth culture with vibrant slang. Perfect for island pride and casual wear!",
    collection: "Caribbean Flags",
  },
  {
    designStem: "Riddim",
    title: "Riddim Typography Tee",
    oldShopifyProductId: "8685100925078",
    tags: ["Caribbean music", "cultural pride", "dancehall", "island vibes", "premium cotton", "reggae", "Riddim", "streetwear", "tropical", "typography tee"],
    seoTitle: "Riddim Typography Tee | Caribbean Music Tee",
    seoDescription: "Celebrate the heartbeat of Caribbean music with our Riddim Typography Tee. Perfect for island vibes!",
    collection: "Reggae Legends Inspired",
  },
  {
    designStem: "Soon Come",
    title: "Soon Come Phrase T-Shirt",
    oldShopifyProductId: "8685101318294",
    tags: ["caribbean apparel", "Caribbean dictionary", "casual t-shirt", "comfortable fit", "heritage clothing", "island culture", "jamaican pride", "pidgin expressions", "streetwear", "tropical wear"],
    seoTitle: "Soon Come Phrase T-Shirt | Caribbean Culture",
    seoDescription: "Shop the 'Soon Come' phrase t-shirt, celebrating Caribbean culture and expression. Perfect for vibrant casual wear!",
    collection: "Caribbean Dictionary",
  },
  {
    designStem: "Watch Nah",
    title: "Watch Nah T-Shirt",
    oldShopifyProductId: "8685101613206",
    tags: ["bold typography", "Caribbean apparel", "Caribbean pride", "casual wear", "cultural expression", "everyday wear", "fashion statement", "island style", "Jamaica", "streetwear", "t-shirt", "unique design", "watch nah"],
    seoTitle: "Watch Nah T-Shirt - Caribbean Culture",
    seoDescription: "Shop the Watch Nah T-Shirt, a vibrant piece celebrating Caribbean culture and phrases. Perfect for streetwear fans!",
    collection: "Caribbean Flags",
  },
];

export interface RepairResult {
  readonly designStem: string;
  readonly outcome: "repaired" | "failed";
  readonly oldShopifyProductId: string;
  readonly printifyProductId?: string;
  readonly newShopifyProductId?: string;
  readonly newHandle?: string;
  readonly error?: string;
}

async function main(): Promise<void> {
  loadEnv();
  const baseLogger = new Logger({ module: "scripts/repair-legacy-shopify-products", transports: [new ConsoleTransport(), new FileTransport()] });

  const printifyResult = createPrintifyProvider({ logger: baseLogger });
  if (!printifyResult.ok) {
    console.error(`Printify provider unusable: ${printifyResult.error.message}`);
    process.exitCode = 1;
    return;
  }
  const printify = printifyResult.value;

  const shopifyResult = createShopifyProvider({ logger: baseLogger });
  if (!shopifyResult.ok) {
    console.error(`Shopify provider unusable: ${shopifyResult.error.message}`);
    process.exitCode = 1;
    return;
  }
  const shopify = shopifyResult.value;

  const results: RepairResult[] = [];

  // Production-safe: stop at the first failure, same discipline as every
  // other batch stage in this pipeline — a partial run is easy to resume
  // (already-repaired designs are simply left off a re-run of this list),
  // but silently continuing past a failure risks masking a systemic
  // problem (e.g. a config error) behind a handful of "succeeded" entries.
  for (const entry of REPAIR_MANIFEST) {
    const jobId = `repair-${entry.designStem.toLowerCase().replace(/\s+/g, "-")}`;
    console.log(`\n--- ${entry.designStem} ("${entry.title}") ---`);

    const lookup = await printify.findProductIdByTitle(entry.title);
    if (!lookup.ok) {
      console.error(`  FAILED — Printify lookup: ${lookup.error.message}`);
      results.push({ designStem: entry.designStem, outcome: "failed", oldShopifyProductId: entry.oldShopifyProductId, error: `Printify lookup failed: ${lookup.error.message}` });
      break;
    }
    if (lookup.value === null) {
      console.error(`  FAILED — no Printify product titled "${entry.title}" was found`);
      results.push({ designStem: entry.designStem, outcome: "failed", oldShopifyProductId: entry.oldShopifyProductId, error: `no Printify product titled "${entry.title}" found` });
      break;
    }
    const printifyProductId = lookup.value;
    console.log(`  Printify product found: ${printifyProductId}`);

    const publish = await printify.publishProductToShopify({ jobId, printifyProductId });
    if (!publish.ok) {
      console.error(`  FAILED — Printify publish: ${publish.error.message}`);
      results.push({ designStem: entry.designStem, outcome: "failed", oldShopifyProductId: entry.oldShopifyProductId, printifyProductId, error: `Printify publish failed: ${publish.error.message}` });
      break;
    }
    console.log(`  New Shopify product created: ${publish.value.shopifyProductId} (handle: ${publish.value.shopifyHandle ?? "?"})`);

    const finalize = await shopify.finalizeExternalProduct({
      jobId,
      shopifyProductId: publish.value.shopifyProductId,
      tags: entry.tags,
      seoTitle: entry.seoTitle,
      seoDescription: entry.seoDescription,
      collection: entry.collection,
    });
    if (!finalize.ok) {
      console.error(`  FAILED — finalize (tags/SEO/collection): ${finalize.error.message}`);
      results.push({
        designStem: entry.designStem,
        outcome: "failed",
        oldShopifyProductId: entry.oldShopifyProductId,
        printifyProductId,
        newShopifyProductId: publish.value.shopifyProductId,
        error: `finalize failed: ${finalize.error.message}`,
      });
      break;
    }

    const verify = await shopify.getProduct(publish.value.shopifyProductId);
    if (!verify.ok) {
      console.error(`  FAILED — verification read-back: ${verify.error.message}`);
      results.push({
        designStem: entry.designStem,
        outcome: "failed",
        oldShopifyProductId: entry.oldShopifyProductId,
        printifyProductId,
        newShopifyProductId: publish.value.shopifyProductId,
        error: `verification read-back failed: ${verify.error.message}`,
      });
      break;
    }

    const failedChecks: string[] = [];
    if (verify.value.variants.length <= 1) failedChecks.push("variants (still a lone Default Title)");
    const expectedTags = new Set(entry.tags.map((t) => t.toLowerCase()));
    const actualTags = new Set(verify.value.tags.map((t) => t.toLowerCase()));
    if ([...expectedTags].some((t) => !actualTags.has(t))) failedChecks.push("tags");
    if (!verify.value.collections.includes(entry.collection)) failedChecks.push("collection");
    if (verify.value.seoTitle !== entry.seoTitle || verify.value.seoDescription !== entry.seoDescription) failedChecks.push("seo");

    if (failedChecks.length > 0) {
      console.error(`  FAILED — verification: ${failedChecks.join(", ")}`);
      results.push({
        designStem: entry.designStem,
        outcome: "failed",
        oldShopifyProductId: entry.oldShopifyProductId,
        printifyProductId,
        newShopifyProductId: publish.value.shopifyProductId,
        error: `verification failed: ${failedChecks.join(", ")}`,
      });
      break;
    }

    console.log(`  REPAIRED — ${verify.value.variants.length} real variants, tags/SEO/collection verified.`);
    results.push({
      designStem: entry.designStem,
      outcome: "repaired",
      oldShopifyProductId: entry.oldShopifyProductId,
      printifyProductId,
      newShopifyProductId: publish.value.shopifyProductId,
      newHandle: verify.value.handle,
    });
  }

  console.log("\n=== Repair report ===");
  for (const r of results) {
    if (r.outcome === "repaired") {
      console.log(`  REPAIRED  ${r.designStem}: old ${r.oldShopifyProductId} -> new ${r.newShopifyProductId} (handle: ${r.newHandle})`);
    } else {
      console.log(`  FAILED    ${r.designStem}: ${r.error}`);
    }
  }
  const remaining = REPAIR_MANIFEST.slice(results.length).map((e) => e.designStem);
  if (remaining.length > 0) {
    console.log(`  NOT ATTEMPTED (batch stopped early): ${remaining.join(", ")}`);
  }
  console.log(
    `\n${results.filter((r) => r.outcome === "repaired").length}/${REPAIR_MANIFEST.length} repaired. ` +
      `Old broken products are UNTOUCHED — archive them by hand once each replacement above is confirmed live and orderable.`,
  );

  if (results.some((r) => r.outcome === "failed") || remaining.length > 0) {
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
