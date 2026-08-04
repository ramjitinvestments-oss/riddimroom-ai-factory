# RiddimRoom AI Factory

An AI-powered production platform for original, commercial-safe
Caribbean-themed apparel — from user-supplied artwork to a published
product listing, with a human approval gate at the center of the
pipeline.

## Vision

RiddimRoom AI Factory exists to turn "an idea for a Caribbean-themed design"
into a live, sellable product with as little manual production work as
possible, while keeping a human firmly in control of what actually ships.

The long-term shape of the platform is a pipeline of discrete, independently
testable stages:

1. **Supply** — The user provides original, commercial-safe Caribbean-themed
   t-shirt artwork; this platform never generates artwork with AI.
2. **Prepare** — Convert supplied artwork into print-ready assets: PNG,
   4500x5400, transparent background.
3. **Mock up** — Generate product mockups so a design can be evaluated the
   way a customer would see it.
4. **Approve** — A human review gate. Nothing reaches a storefront without
   explicit approval; the `designs/` pipeline stages (`incoming` →
   `approved` → `published` / `rejected` / `archive`) exist to make that
   decision visible and auditable.
5. **Publish to Printify** — Upload approved artwork and create the
   corresponding print products via the Printify API.
6. **Publish to Shopify** — Push the resulting products to the storefront
   via the Shopify API.
7. **Promote** — Share published products to social platforms.

Each stage is built as its own module under `automation/`, using official
platform APIs wherever they exist. Browser automation (Playwright) is used
only as a fallback for actions with no API, or for visual verification of a
result — it is never the default integration path.

The platform is built incrementally, in small, independently testable
phases, rather than as one large system delivered at once. Each phase should
be verifiable on its own before the next is built on top of it.

## Project Structure

```
designs/
  incoming/    User workspace for staging supplied artwork (not processed by the pipeline)
  approved/    Artwork approved for production/print
  published/   Successfully published products
  rejected/    Rejected artwork
  archive/     Old/superseded artwork, kept for reference

mockups/       Generated product mockups (t-shirt previews, etc.)

automation/
  printify/    Printify API integration
  shopify/     Shopify API integration
  ai/          AI content generation integration (product copy, artwork analysis)
  social/      Social media publishing integration
  shared/      Code shared across automation modules

scripts/       Standalone/CLI scripts and pipeline runners
config/        Configuration files
logs/          Runtime and pipeline logs
docs/          Project documentation
tests/         Automated tests
```

## Status

Project skeleton only. No dependencies or application code have been added
yet — see `CLAUDE.md` for project rules and the current build phase.

## Setup

1. Copy `.env.example` to `.env` and fill in the required credentials.
2. (Dependency and run instructions will be added as the platform is built.)

## Production launch

`npm run launch:apparel` is the single production launch command — it runs
its own pre-flight check first (`npm run preflight`), then regenerates the
Gold Turntable T-Shirt and uploads any pending apparel designs through the
same pipeline, stopping immediately on any real failure. See
`docs/gold-turntable-regeneration-runbook.md` for what each stage does.

Printify's API and Shopify's OAuth endpoint are not reachable from every
environment (notably, not from Claude's own sandboxed execution
environment — see that runbook for how this was confirmed). Run the launch
from a machine with normal internet access, or use the GitHub Actions
workflow below.

### Running the launch via GitHub Actions

`.github/workflows/launch-apparel.yml` runs `npm run launch:apparel`
unchanged, from GitHub's own runners (which have normal outbound network
access), using credentials from GitHub Secrets instead of a local `.env`.

**1. Configure GitHub Secrets** — in the repo's Settings → Secrets and
variables → Actions (or under a `production` Environment for extra
protection — the workflow already targets an `environment: production`),
add:

| Secret | Required | Notes |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | yes | e.g. `your-store.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | yes | Dev Dashboard app client id (OAuth client credentials grant) |
| `SHOPIFY_CLIENT_SECRET` | yes | Dev Dashboard app client secret |
| `SHOPIFY_API_VERSION` | no | Defaults to `2025-01` if unset |
| `PRINTIFY_API_KEY` | yes | |
| `PRINTIFY_SHOP_ID` | yes | |
| `PRINTIFY_BLUEPRINT_ID` | yes | |
| `PRINTIFY_PRINT_PROVIDER_ID` | yes | |
| `PRINTIFY_VARIANT_IDS` | yes | Comma-separated |
| `PRINTIFY_BLACK_VARIANT_IDS` | yes | Comma-separated — look these up via Printify's Catalog API; see the header comment in `scripts/regenerate-printify-product.ts` for the exact command. The pre-flight check fails immediately if this is missing. |
| `OPENAI_API_KEY` | only if a design still needs metadata generated | Every design currently pending upload already has its metadata on file, so this isn't required for today's launch — set it anyway if you plan to add new designs later. |
| `PRINTIFY_PRINT_X` / `PRINTIFY_PRINT_Y` / `PRINTIFY_PRINT_SCALE` | no | Placement overrides — leave unset to use the approved upper-chest standard baked into `automation/printify/printify-provider.ts` |
| `DEFAULT_SHIRT_PRICE` | no | Defaults to `24.99` |

Names match `.env.example` exactly — nothing is renamed for this workflow.

**2. Run the workflow** — go to the repo's Actions tab → "Launch Apparel
(Production)" → **Run workflow**. You'll be asked to type `LAUNCH` in the
confirmation field before the job runs; anything else aborts before any
Printify/Shopify call is made. Only one launch can run at a time
(concurrent runs queue rather than overlap).

**3. Download the launch report** — once the run finishes (success or
failure), open the run in the Actions tab:
- The **Summary** tab shows a table of every design's outcome (updated /
  created / failed), Printify and Shopify product ids, and any error.
- The full `logs/` directory (the JSON launch report plus pipeline logs)
  is attached as a workflow artifact named `launch-apparel-report-<run id>`
  — download it from the run's page for the complete detail, including
  every pre-flight check's individual result.
