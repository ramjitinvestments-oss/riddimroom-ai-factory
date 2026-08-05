# Printify ↔ Shopify Architecture Audit & Repair Plan

**Date:** 2026-08-05
**Status:** Investigation complete. No repair executed. Nothing created, published, reconnected, migrated, or deleted as part of this report.
**Scope:** Full inventory of every Printify shop and every Shopify product, root-caused explanation of the 26 non-orderable Caribbean Dictionary Series listings, and an exact, unexecuted repair plan.

All data below comes from two authoritative, read-only, same-day pulls:
- Printify: `scripts/audit-printify-inventory.ts`, run via GitHub Actions run [`0edf001` / run 31028878349](../.github/workflows/audit-printify-inventory.yml) — `GET /v1/shops.json` + `GET /v1/shops/{id}/products.json` for every shop on the account.
- Shopify: Admin GraphQL `products` query against `53y20t-ky.myshopify.com`, 50-per-page, `hasNextPage: false` (single page covered the whole catalog).

---

## 1. Architecture diagram

```
                         PRINTIFY ACCOUNT (3 shops)
   ┌──────────────────────────┬──────────────────────────┬──────────────────────────┐
   │  Riddimroom.com           │  My Store                 │  My Shopify Store        │
   │  id 18594781              │  id 18595310              │  id 28435012             │
   │  sales_channel: none      │  sales_channel: none      │  sales_channel: shopify  │
   │  (bound to a DEAD store,  │  (never used)             │  ── CORRECT / LIVE ──    │
   │   qpsykx-wf.myshopify.com)│                            │                          │
   │  27 products, 0 linked    │  0 products                │  6 products, 5 linked   │
   └──────────────┬────────────┴──────────────┬─────────────┴──────────────┬───────────┘
                  │ never publishes            │ empty                     │ publishes correctly
                  │ (dead store / disconnected)│                            │
                  ▼                            ▼                            ▼
        27 orphan Printify products      (nothing)          6 Printify products, 5 linked
        for the 9 Caribbean                                 by external.id to 5 live,
        Dictionary Series designs,                           healthy Shopify products
        never reaching Shopify                                (+ 1 unlinked duplicate,
                                                                 flagged in §3)

                          SHOPIFY STORE: 53y20t-ky.myshopify.com (riddimroom.com)
   ┌───────────────────────────────┬───────────────────────────────────────────────┐
   │ 5 healthy apparel products     │ 26 broken apparel listings (9 designs)         │
   │ vendor="Printify"               │ vendor="RiddimRoom", 1 variant, 0 inventory    │
   │ 5 variants, 49995 inventory     │ 9 ACTIVE (un-orderable) + 17 DRAFT duplicates  │
   │ created via Printify's native   │ created via the OLD bare-Shopify-Admin-API     │
   │ publish integration             │ fallback path — never touched Printify at all │
   └───────────────────────────────┴───────────────────────────────────────────────┘
   + 15 unrelated non-apparel digital products (DJ drops, animation packs) — out of scope
```

**PRINTIFY_SHOP_ID currently configured:** `18594781` (Riddimroom.com) — **wrong shop.** It is bound to a Shopify store (`qpsykx-wf.myshopify.com`) that no longer exists ("This store is currently unavailable"), confirmed independently in `.env`'s own inline history note from an earlier session. This is why every native-publish attempt against it fails with Printify error 8254, and why reconnecting `Riddimroom.com` is not viable — there is no live store on the other end to reconnect to.

**Correct shop:** `28435012` ("My Shopify Store"), `sales_channel: shopify`, actively connected to `53y20t-ky.myshopify.com`. This is proven two ways: (a) Printify itself reports its sales channel as `shopify`, not disconnected; (b) its 5 linked products' `external.id`s match, one-for-one, the 5 healthy Shopify products (Gold Turntable, Caribbean Unity Crown, From The Islands, Caribbean Treasure Chest, Bacchanal).

---

## 2. Printify shop report

| Shop | Printify Shop ID | Sales Channel | Connected? | Products | Linked to Shopify | Not Linked |
|---|---|---|---|---|---|---|
| Riddimroom.com | 18594781 | none (bound to a dead Shopify store) | **No** | 27 | 0 | 27 |
| My Store | 18595310 | none | No | 0 | 0 | 0 |
| **My Shopify Store** | **28435012** | **shopify** (→ 53y20t-ky.myshopify.com) | **Yes** | 6 | 5 | 1 |

`PRINTIFY_SHOP_ID` is currently set to `18594781`. It should be `28435012`. This single value is the root of the entire incident — see §5.

---

## 3. Shopify mapping report

45 total products in the live store, cleanly separated by a reliable forensic signature (`vendor` + variant count + inventory) with no ambiguity:

| Category | Count | Signature | Notes |
|---|---|---|---|
| Non-apparel digital products | 15 | vendor=RiddimRoom, various | DJ drops / animation packs — unrelated to this incident, not touched |
| Healthy apparel products | 5 | vendor=Printify, 5 variants, 49995 inventory | Gold Turntable, Caribbean Unity Crown, From The Islands, Caribbean Treasure Chest, Bacchanal — all correctly linked to Printify shop 28435012 |
| Broken apparel — ACTIVE | 9 | vendor=RiddimRoom, 1 variant, 0 inventory | Un-orderable (this is the original "8 non-orderable products" incident, plus Wah Gwaan, a 9th case found during this audit) |
| Broken apparel — DRAFT duplicates | 17 | vendor=RiddimRoom, 1 variant, 0 inventory | Never customer-visible, but clutter the admin and confuse "is this design live" |

The `external.id` cross-reference confirms it directly: none of the 26 broken listings' Shopify product IDs appear anywhere in Printify's data (not in the correct shop, not in the dead shop, not anywhere) — they were never created by Printify at all. They exist only because an older code path (`scripts/publish-to-shopify.ts`'s bare Shopify Admin API create, superseded 2026-08-05 by the Printify-native path wired in commit `8e2c7e3`) created a placeholder Shopify product directly, with a single default variant and no real inventory, and never involved Printify.

**One item flagged for manual review, not automatic cleanup:** Printify product `6a72b9221299797f13041225`, "Copy of Caribbean Treasure Chest RiddimRoom T-Shirt," sits in the *correct* shop (28435012) but is **not** linked to any Shopify product. This is very likely an accidental duplicate created via the Printify editor (a browser tab on this exact product got stuck in an unsaved "Leave site?" state earlier this session). It is not part of the Caribbean Dictionary Series incident and should not be deleted without separately confirming with you that it's safe to remove.

---

## 4. Duplicate product mapping (per design)

All 9 Caribbean Dictionary Series designs follow the same pattern: **zero** correct products in the live-connected Printify shop, but multiple orphans scattered across the wrong Printify shop and the live Shopify store.

| Design | Printify orphans in dead shop (18594781) | Shopify ACTIVE (broken) | Shopify DRAFT duplicates (broken) |
|---|---|---|---|
| Big Up | 3 | 1 — `8685100335254` | 2 |
| Chipping | 3 | 1 — `8685100400790` | 2 |
| Irie | 3 | 1 — `8685100433558` | 2 |
| Liming | 3 | 1 — `8685100466326` | 2 |
| Pickney | 3 | 1 — `8685100499094` | 2 |
| Riddim | 3 | 1 — `8685100925078` | 2 |
| Soon Come | 3 | 1 — `8685101318294` | 2 |
| Watch Nah | 3 | 1 — `8685101613206` | 2 |
| Wah Gwaan | 3 | 1 — `8685192020118` | 1 |
| **Total** | **27** | **9** | **17** |

Each Printify orphan trio (927 variants defined, only 12 enabled — a normal blueprint variant matrix, not itself a defect) represents one full pipeline retry against the dead shop; each retry independently produced its own bare-create Shopify duplicate, which is why there are 2–3 Shopify copies per design instead of exactly one.

**Wah Gwaan is a special case.** In addition to the shop-binding problem shared by all 9 designs, its Printify-side regeneration previously failed separately with error 8251 (a blueprint/variant validation error), which is why it has only one draft duplicate instead of two and was created later (14:16–14:22) than the other 8 (12:49). This needs its own diagnosis before it can be re-created, independent of the shop fix — see open task #125.

---

## 5. Root cause report

**Primary cause:** `PRINTIFY_SHOP_ID` is configured to `18594781` ("Riddimroom.com"), a Printify shop bound to a Shopify store that has since been deleted (`qpsykx-wf.myshopify.com`). No sales-channel connection exists or can exist for this shop anymore — it is not a "disconnected, reconnect it" situation, it is a dead end.

**Why this produced 26 broken Shopify listings instead of just failed API calls:** at the time the Caribbean Dictionary Series batch ran, the pipeline's Shopify-publish stage (`scripts/publish-to-shopify.ts`) did not yet go through Printify's native publish integration — that wiring (Task #123, commit `8e2c7e3`) was built and shipped *during this same session*, after the incident had already occurred. The pre-fix pipeline created Shopify products directly via the bare Shopify Admin API, with a single default variant and zero real inventory, entirely independent of Printify. That path "succeeded" from Shopify's point of view (a product record was created) while being functionally useless (nothing to sell — no size/color options, no inventory).

**Why there are 3 Printify-side orphans and 2–3 Shopify-side duplicates per design, not 1:** the batch was retried multiple times after failures, and nothing in the old pipeline checked "does a product for this design already exist in the right place" before creating a new one — `findProductIdByTitle` (needed for that check) didn't exist yet, and even once built, it would have had to search the *correct* shop, which was never the one configured. Each retry therefore created a fresh Printify product in the dead shop and a fresh bare Shopify listing, rather than detecting and reusing prior work.

**Contributing factor, already fixed this session:** commit `8e2c7e3` also fixed an ordering bug where the pipeline published to Shopify *before* regenerating the Printify product onto the correct (black, multi-size) variant set, which would have caused single-variant Shopify listings even with a correctly connected shop. That fix (regenerate before publish) is real and durable but was not, by itself, sufficient to fix these 26 items, because the shop-binding problem sits one layer below it.

---

## 6. Exact repair plan (design only — not executed)

This is the recommended sequence. Nothing in this section has been run.

1. **Correct the configuration.** Change `PRINTIFY_SHOP_ID` from `18594781` to `28435012` in `.env` and in the GitHub Actions `production` environment secret. Verify with the existing read-only `diagnose:printify-shop` script, which should report the configured shop as connected (`sales_channel: shopify`) instead of the current "no sales_channel" warning.
2. **Touch nothing that already works.** The 5 healthy products (Gold Turntable, Caribbean Unity Crown, From The Islands, Caribbean Treasure Chest, Bacchanal) and their Printify counterparts in shop 28435012 are left exactly as they are.
3. **Resolve the flagged orphan separately.** Confirm with you whether Printify product `6a72b9221299797f13041225` ("Copy of Caribbean Treasure Chest...") is safe to delete before doing anything with it — it's unrelated to the 9-design incident.
4. **Diagnose Wah Gwaan's error 8251** (task #125) before attempting to re-create it — it needs its own fix, not just the shop correction.
5. **Re-create each of the 9 designs fresh, one at a time, against the corrected shop**, using the already-fixed, already-tested pipeline (`publish-to-shopify-via-printify.ts` + the regenerate-before-publish ordering from commit `8e2c7e3`). This is a genuine first-time creation for each design in the correct shop — there is nothing there yet to "update." Verify each one individually after creation: multi-variant, linked (`external.id` present), orderable.
6. **Only after a given design's new product is verified live and correct**, remove that design's old broken artifacts: its 1 dead-shop Printify orphans (3 of them) and its old broken Shopify listings (1 active + 1–2 draft). One-to-one, per design, only after verification — never a bulk delete across all 9 at once, and never before the replacement is confirmed working.
7. **Account hygiene (manual, outside this codebase):** once all 9 designs are repaired and the dead-shop orphans are cleared, the `Riddimroom.com` and `My Store` Printify shops are empty dead weight and could be archived directly in Printify's dashboard — a decision for you, not something this pipeline should ever do automatically.

**Future protection**, so this class of failure can't recur silently:
- Extend `scripts/preflight-check.ts` to hard-fail (not just warn) if the configured `PRINTIFY_SHOP_ID`'s `sales_channel` is anything other than `"shopify"`, and run it automatically before every publish, not just on manual request — this is exactly what you asked for when you said the pipeline should fail loudly on a disconnected shop rather than silently publish elsewhere.
- Before creating any new Printify product, call `findProductIdByTitle` (already built, tested, shipped) scoped to the *validated* shop, and treat a match as "already exists" rather than creating a duplicate — this is what prevents a retried batch from ever again producing 3x orphans.
- Confirm no code path for apparel still calls the old bare-Shopify-Admin-API create — `apparel-pipeline.ts`'s create path now always routes through the Printify-native publish function; this should be spot-checked as part of executing step 5 above, not assumed.

---

## Open items not covered by this report

- Task #125 (Wah Gwaan error 8251) needs its own diagnosis before step 4 above can run.
- This report is discovery and design only, per your instruction: no shop reconnection, no product creation, no publishing, no deletion has occurred. Execution requires your explicit go-ahead on this plan.
