# RiddimRoom Apparel Production Runbook

This is the permanent runbook for the apparel pipeline — not a one-time
launch checklist for a single product. Every design, present or future,
goes through the same code path described here. Gold Turntable is used
throughout as the worked example (it's the first product this pipeline
ever ran against), but nothing below is specific to it; every command
takes a design stem argument and works the same way for Crown, RR Shirt
1, Treasure Chest, or anything supplied later.

The only thing that cannot be done from Claude's sandbox is the live
network calls to Printify and OpenAI — that sandbox's proxy blocks
`api.printify.com` and `api.openai.com` outright (`403
blocked-by-allowlist`), confirmed repeatedly across sessions. Shopify's
Admin API is reachable from Claude's side via the connected Shopify MCP.
Every command below is written to run standalone from your own machine,
using this repo's real pipeline code end to end, with `DRY_RUN=false` and
a real `.env`.

## Pipeline architecture

```
Artwork
  ↓  scripts/prepare-artwork.ts       (crop/pad/validate to 4500x5400 transparent PNG)
Validation
  ↓  automation/ai/artwork-validation.ts   (dimensions, DPI, alpha channel)
Metadata / SEO / Collections
  ↓  scripts/import-artwork.ts        (AI analysis → title, description, SEO, tags, collection)
Printify Upload
  ↓  scripts/upload-to-printify.ts    (create product, Printify auto-generates mockups)
Mockup Generation
  ↓  (Printify's own render step, triggered by the upload above)
Shopify Sync
  ↓  scripts/publish-to-shopify.ts    (create Shopify product, verify every field read back)
Collection Assignment
  ↓  ShopifyProvider.findOrCreateCollection() (inside publishProduct — auto-creates if missing)
Image Ordering
  ↓  scripts/sync-product-images.ts   (approved 9-slot gallery order, position 1 = featured)
Verification
  ↓  manual — see "Verification checklist" below
Publish Ready
```

## Why `designs/approved/`, `designs/processed/`, `designs/published/`, and `designs/rejected/` are tracked in git

`scripts/preflight-check.ts` and `scripts/launch-apparel.ts` read real
files out of these directories (the prepared 4500x5400 PNGs, the
generated `*.product.json`/`*.seo.json`/`*.tags.json`/`*.description.md`,
and the `*.printify.json`/`*.shopify.json` records of what's already
live). Until August 2026 these directories were gitignored (`designs/*/*`
with only `.gitkeep` tracked), which meant a fresh checkout — including
every GitHub Actions run — started with those directories empty. Preflight
was working correctly: it was correctly detecting that a fresh checkout
had none of the artwork/metadata the launch needs, not enforcing some
obsolete directory layout. The commit that finalized the CI pipeline
(`adf1f74`, "Finalize apparel production pipeline") added the CI workflow
and the gitignore rule that hid its own required inputs from CI in the
same commit.

The fix: these four directories' real contents (not `designs/incoming/`,
which stays gitignored — see CLAUDE.md, it's user workspace only and the
pipeline never reads it) are now committed to git, so a fresh checkout —
local or CI — has the same pipeline state this repository's own working
copy does. `designs/archive/` is still gitignored; at the time of this
fix it held only leftover test-fixture debris (`good.*`, jobId
`job-good`) rather than any genuine archived design, so there was nothing
real to track yet.

One command — `scripts/apparel-pipeline.ts <design stem>` — walks a
design through every stage above automatically, detecting whether it's a
first-time upload or an update to something already live and routing
accordingly. You can also run each stage script individually if you want
to stop and inspect between steps; both are documented below.

Every stage script is independently idempotent (a stage already completed
for a design is skipped, not redone) and production-safe (a real failure
stops the whole batch immediately — nothing later is attempted, nothing
partial is recorded as success). This is enforced by the underlying
stage scripts (`scripts/import-artwork.ts`, `scripts/upload-to-printify.ts`,
`scripts/publish-to-shopify.ts`), not reimplemented by the orchestrator.

## The single entry point

```bash
DRY_RUN=false node --experimental-strip-types scripts/apparel-pipeline.ts "<design stem>"
```

The design stem is the filename (no extension) under `designs/processed/`
(for a design never uploaded before) or `designs/published/` (for one
already live) — e.g. `"GOLDEN turntable"`, `"crown"`, `"RR shirt 1"`,
`"treasure chest"`.

What it does, in order:

1. Checks whether `designs/published/<stem>.printify.json` already
   exists.
2. **If it exists** (the design is already live): routes straight to the
   **update path** — regenerates the existing Printify product (reused
   id, approved placement, approved black garment) and syncs the
   regenerated mockups onto the existing Shopify product (reused id,
   approved gallery order). Nothing is created twice.
3. **If it doesn't exist** (first time): routes to the **create path** —
   runs the standard import → upload → publish stages, then
   automatically chains into the same regenerate + sync steps above, so
   a first-time upload comes out the other end already on the approved
   black garment with the full approved gallery, not just the single
   flat-artwork image Shopify's create call sets by default. This is
   what makes "no future upload should require manual corrections" true
   in practice — you never have to remember a second command for a new
   design.
4. If any stage genuinely fails (Printify/Shopify error, validation
   failure, missing config), the whole run stops immediately with a
   clear reason. It never fabricates a "done" result — see "Duplicate
   prevention and dry-run isolation" below for exactly how that's
   guaranteed structurally, not just by convention.

## First apparel upload (a design that's never been published)

Example: Crown, RR Shirt 1, or Treasure Chest — all three are fully
prepared and waiting in `designs/processed/` as of this writing (real
4500×5400 RGBA PNGs, complete `product.json`/`seo.json`/`tags.json`/
`description.md`).

```bash
DRY_RUN=false node --experimental-strip-types scripts/apparel-pipeline.ts "crown"
```

This is the create path described above. Under the hood it's equivalent
to running these three existing, unmodified stage scripts in order, then
the regenerate + sync steps:

```bash
DRY_RUN=false node --experimental-strip-types scripts/import-artwork.ts
DRY_RUN=false node --experimental-strip-types scripts/upload-to-printify.ts
DRY_RUN=false node --experimental-strip-types scripts/publish-to-shopify.ts
DRY_RUN=false node --experimental-strip-types scripts/regenerate-printify-product.ts "crown"
DRY_RUN=false node --experimental-strip-types scripts/sync-product-images.ts "crown"
```

(The first three scan the whole `designs/processed/` directory, not just
one design — that's their established, already-tested behavior, and it's
safe because each is idempotent: any design already uploaded/published is
skipped automatically.)

Collections these three designs publish into — `DJ Culture`, `Caribbean
Flags`, `Island Vibes` — do not exist on the live store yet. Shopify's
`findOrCreateCollection()` (already wired into `publishProduct()`)
auto-creates them on first publish; a bare auto-created collection has no
image/SEO/sort settings, so expect a short follow-up polish pass on those
three collection pages after they exist — the same kind of pass already
done for Vinyl Culture and Best Sellers.

## Updating an existing shirt (regenerate color/placement, resync gallery)

Example: Gold Turntable — already live, needs its garment switched to
black and its gallery replaced with the corrected-placement mockups.

```bash
DRY_RUN=false node --experimental-strip-types scripts/apparel-pipeline.ts "GOLDEN turntable"
```

This is the update path: `designs/published/GOLDEN turntable.printify.json`
already exists, so the orchestrator skips straight to regenerate + sync.
Equivalent to running the two stages individually:

```bash
DRY_RUN=false node --experimental-strip-types scripts/regenerate-printify-product.ts "GOLDEN turntable"
DRY_RUN=false node --experimental-strip-types scripts/sync-product-images.ts "GOLDEN turntable"
```

(`scripts/regenerate-gold-turntable-printify.ts` and
`scripts/sync-gold-turntable-images.ts` still exist as thin,
backward-compatible wrappers around these two generic scripts, hardcoded
to the `"GOLDEN turntable"` stem — kept only so the exact commands
documented in earlier sessions keep working unchanged. Every other
product uses the generic scripts with its own stem.)

## Regenerating mockups

Regenerating mockups is not a separate action — it's what
`scripts/regenerate-printify-product.ts` does. It reuses the existing
Printify product id (`PUT`, never `POST`) and the existing artwork image
id (never re-uploaded or resized), applies the approved upper-chest
placement standard baked into `automation/printify/printify-provider.ts`
(`x=0.5, y=0.35, scale=0.85`), and switches the product's variants to
whichever variant ids you pass (see "Changing garment colors" below).
Printify regenerates its full mockup set as a side effect of that update
call — there's no separate "regenerate mockups" API call to make.

## Changing garment colors

Nothing in this repository can guess which Printify variant ids
correspond to which color — that mapping is account- and
catalog-specific. Look it up for real, once per blueprint/print-provider,
using `scripts/lookup-black-variant-ids.ts` — it calls Printify's own
Catalog API, filters for variants whose color matches "black", and writes
the result straight into `.env` as `PRINTIFY_BLACK_VARIANT_IDS` (never
guesses; fails clearly and writes nothing if no variant matches):

```bash
npm run lookup:black-variants
```

Equivalently, by hand, if you'd rather inspect the raw API response first:

```bash
curl -s "https://api.printify.com/v1/catalog/blueprints/$PRINTIFY_BLUEPRINT_ID/print_providers/$PRINTIFY_PRINT_PROVIDER_ID/variants.json" \
  -H "Authorization: Bearer $PRINTIFY_API_KEY" \
  | jq '.variants[] | select(.options.color | test("Black"; "i")) | {id, title}'
```

...then add the resulting ids (one per size, same count as
`PRINTIFY_VARIANT_IDS` today) to `.env` yourself:

```bash
PRINTIFY_BLACK_VARIANT_IDS=<comma-separated ids from above>
```

`scripts/regenerate-printify-product.ts` reads this by default. To
regenerate in a color other than black (a colorway this codebase hasn't
been told about yet), don't add a new hardcoded env var — call the
exported `regeneratePrintifyProduct()` function directly with an explicit
`variantIds` option, e.g. from a short one-off script:

```ts
import { regeneratePrintifyProduct } from "./scripts/regenerate-printify-product.ts";
await regeneratePrintifyProduct("GOLDEN turntable", { variantIds: [/* the new color's variant ids */] });
```

This deliberately stays a manual, explicit step — this project's rules
forbid guessing a color-to-variant-id mapping from anything already on
file.

## Replacing galleries / syncing Shopify

These are the same operation: `scripts/sync-product-images.ts` reads a
design's regenerated Printify mockup URLs, maps them onto the approved
9-slot gallery standard, and calls `ShopifyProvider.replaceProductImages()`
— which adds the new images at their approved positions and then removes
every old image, on the one existing Shopify product id (never a new
product). Title, handle, URL, variants, SEO metafields, tags, and reviews
are untouched; this call only ever replaces the image gallery.

The gallery order and the mapping from "gallery slot" to Printify's real
`camera_label` values live in exactly one place —
`automation/printify/gallery-standard.ts` — so every product gets the
same order automatically:

| Slot | camera_label | Notes |
|---|---|---|
| 1. Hero | `front` | |
| 2. Lifestyle | `lifestyle` | |
| 3. Lifestyle Alternate | `duo` | |
| 4. Studio Front | `front-2` | |
| 5. Studio Back | `back-2` | |
| 6. Flat Lay | — | no matching camera angle in this blueprint's mockup set — honestly left unmapped, never filled with a mislabeled substitute |
| 7. Folded | `folded` | |
| 8. Close-up | `front-collar-closeup` | |
| 9. Fabric Detail | `back-collar-closeup` | closest available angle; this blueprint has no dedicated fabric-weave macro shot |

This table was built from the 62 real mockup URLs Printify returned for
Gold Turntable's actual prior upload — not guessed. If a future blueprint
or print provider offers a real flat-lay angle, update the table in
`gallery-standard.ts` once and every product (past and future) picks it
up on its next regeneration; nothing else needs to change.

Because Shopify's featured image (read by collection cards, homepage
cards, search results, cart previews, structured data, and Open Graph) is
always image position 1, putting the Hero shot first is what fixes every
one of those surfaces in a single call — no separate step per surface.

## Rollback

Every write this pipeline makes to its own tracking files
(`<stem>.printify.json`, `<stem>.shopify.json`) is a plain JSON file
under version control. To roll back a regeneration:

1. `git log -- "designs/published/<stem>.printify.json"` to find the
   commit before the regeneration, and restore that file's `mockupUrls`
   and (if present) remove `colorRegeneratedAt`/`garmentColorVariantIds`.
2. Re-run `scripts/sync-product-images.ts "<stem>"` — since it reads
   whatever `mockupUrls` are currently on file, this pushes the old
   mockup set back onto Shopify's gallery the same way it pushed the new
   one.
3. If you need the Printify product itself back on its previous garment
   color/placement, run `scripts/regenerate-printify-product.ts "<stem>"`
   again with the old variant ids (pass them via the `variantIds` option
   as shown above, or temporarily set `PRINTIFY_BLACK_VARIANT_IDS` back
   to the previous non-black set's ids).

There is no destructive step anywhere in this pipeline — Printify's
`updateProductColorAndPlacement()` is a `PUT` (overwrite in place, always
reversible by another `PUT`), and Shopify's `replaceProductImages()` adds
the new images before removing the old ones, so a mid-call failure never
leaves the product with zero images (see `ShopifyApiProvider.replaceProductImages()`
in `automation/shopify/shopify-provider.ts`).

## Recovery (resuming after a failure)

Every stage script uses the same production-safe pattern: the moment one
item fails, the whole run stops immediately, and the failure is reported
with `stoppedDueTo` (what failed and why) and `remainingUnprocessed`
(what was never even attempted). Nothing after the failure point is
silently skipped or fabricated as successful.

To resume: fix whatever caused the failure (bad artwork, missing env var,
a real Printify/Shopify API error) and re-run the exact same command.
Idempotency means every item that already succeeded is skipped, not
redone — you're only ever retrying the item that actually failed, plus
whatever hadn't been reached yet.

Specific idempotency markers, per stage:

- **Import**: `<stem>.job.json` existing means already analyzed — skipped.
- **Printify upload**: `<stem>.printify.json` existing means already
  uploaded — skipped (this is also the create-vs-update router's own
  signal).
- **Shopify publish**: `<stem>.shopify.json` existing means already
  published — skipped, never re-attempted automatically even if the
  first attempt's `status` was `verification_failed` (a human should
  look at why before retrying).
- **Regenerate**: not itself idempotent by design — it's meant to be
  re-run deliberately (a new color, a corrected placement). It always
  reuses the same product id, so re-running it never creates a
  duplicate; it just updates the same product again.
- **Sync**: refuses to run at all until `regenerate` has stamped
  `colorRegeneratedAt` onto `<stem>.printify.json` — this is what stops a
  sync from ever pushing a stale mockup set onto Shopify under the
  assumption it's new.

## Duplicate prevention and dry-run isolation

Two structural guarantees make "never duplicate products" true, not just
documented:

1. **Update calls are `PUT`, not `POST`.** `regeneratePrintifyProduct()`
   and `syncProductImages()` both read the existing product id from the
   design's own published job file and pass it straight into a `PUT`. A
   second run against the same design updates the same product again;
   it structurally cannot create a second one, because it never calls
   the create endpoint.
2. **`DRY_RUN=true` results are never recorded as real, and never
   trigger the next stage.** `publish-to-shopify.ts` writes dry-run
   results to `<stem>.shopify.dryrun.json` (not `<stem>.shopify.json` —
   the file every idempotency/routing check actually looks for) and
   never moves the artwork into `designs/published/`. This was verified
   directly in this session: running the full create-path orchestration
   in `DRY_RUN=true` against an isolated test fixture correctly stopped
   after the dry-run publish and reported "not yet published — nothing
   to do," rather than fabricating a chain into the regenerate/sync
   steps against a product that doesn't actually exist. That's not an
   incidental side effect — it's the exact anti-fabrication guarantee
   this project's rules require, and it's now covered by a permanent
   regression test (`tests/scripts/apparel-pipeline.test.ts`).

## Verification checklist

Run this after any regenerate + sync, for every product touched:

- Product page: `https://riddimroom.com/products/<handle>`
- Collection page(s) the product belongs to
- Homepage "Caribbean Apparel" / featured sections
- Best Sellers collection, if linked there
- Site search for the product's name/keywords
- Related/recommended products wherever this product appears as a
  recommendation
- Cart preview (add to cart, check the mini-cart image)
- View page source → confirm the `Product` JSON-LD `image` array and the
  `og:image` meta tag both point at the new mockup

Against the fuller validation checklist Message 4 asked for (Artwork,
Placement, Scaling, Variants, Printify, Shopify, SEO, Collections,
Gallery, Accessibility, Performance, Structured Data) — what's actually
automated today versus what still needs a human pass:

- **Automated**: Artwork (dimensions/DPI/alpha via
  `automation/ai/artwork-validation.ts`), Placement/Scaling (fixed
  constants applied identically every time, never recalculated per-item),
  Printify/Shopify (id reuse enforced structurally, see above), Gallery
  (mapped via `gallery-standard.ts`, unmapped slots reported honestly
  rather than guessed), SEO/Collections (verified read-back after publish
  in `publish-to-shopify.ts`'s `verifyPublishedProduct()`).
- **Not automated, needs a human pass**: Variants (correct
  size/price live on Shopify — spot-checked, not machine-verified per
  release), Accessibility (alt text is generated from the gallery
  standard's slot names, but a full a11y audit is a separate manual
  pass), Performance (LCP/CLS are theme/CSS concerns, unrelated to which
  product image is live), Structured Data (checked manually via "view
  page source" above, not asserted in code).

One deliberate boundary on "reject poor mockups automatically" (Message
4's Mockups section): this pipeline validates *completeness* — did the
expected `camera_label` set come back, is every URL a real, fetchable
image — not aesthetic quality. There's no reliable way to automate "does
this mockup look good" without a vision-quality-judge model call, and
fabricating that judgment would be worse than not having it. A slot with
no matching mockup is reported as unmapped (see the gallery table above);
it is never silently filled with a worse photo to make the count come
out right.

## What's still genuinely blocked

Nothing in this repository is faked or stubbed. Every script above is
real, type-checked, and rehearsed end-to-end in `DRY_RUN=true` (including
a full create-then-update rehearsal against an isolated fixture, and a
realistic-mockup-data rehearsal of the gallery mapping — both reverted
afterward with no trace left in real job files). The only thing that
cannot happen from this sandbox is the live network call to Printify
itself — confirmed repeatedly, structural (`403 blocked-by-allowlist` on
the sandbox's fixed proxy), not something retrying fixes. Once
`PRINTIFY_BLACK_VARIANT_IDS` (or whatever variant ids a given run needs)
is set and you run any command above with `DRY_RUN=false` from your own
machine, that live call — and everything downstream of it — runs for
real, using this exact code.
