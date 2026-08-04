# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RiddimRoom AI Factory is a publishing platform for original,
commercial-safe Caribbean-themed apparel. Artwork is supplied by the user,
not AI-generated; the platform carries a design from user-supplied
artwork through to a published storefront listing:

1. User supplies original, commercial-safe Caribbean-themed t-shirt artwork into `designs/incoming/`.
2. Prepare print-ready assets: PNG, 4500x5400, transparent background.
3. Generate product mockups.
4. Human approval gate.
5. Upload approved products to Printify (API).
6. Publish products to Shopify (API).
7. Promote published products on social platforms.

## Project rules

- **API-first, Playwright-last.** Always use the official platform API
  (Printify, Shopify, OpenAI, Anthropic, Google AI, social platforms) when
  one exists. Playwright is only acceptable for actions with no available
  API, or for visual verification of a result. Never build a Playwright
  path as a shortcut around an existing API.
- **Human approval is a hard gate.** No design or product may move from
  `designs/approved/` into `designs/published/` (i.e. be sent to Printify or
  Shopify) without an explicit approval step. Do not build "auto-approve"
  behavior.
- **`designs/incoming/` is user workspace only.** Claude never processes,
  moves, or reads files there as part of the pipeline — it's where the
  user stages their own artwork before submitting it for approval.
- **The `designs/` folders are pipeline state, not just storage.** Moving a
  file between `approved/` → `published/` / `rejected/` → `archive/`
  represents a real state transition (approved for print, sent to a
  platform, rejected, or superseded). Treat these moves as meaningful
  events to log, not incidental file operations.
- **Print constraint is non-negotiable.** Print-ready artwork must be
  4500x5400 PNG with a transparent background. Validate this, don't assume
  it.
- **Production-safe error handling: never skip products, never continue
  after a failure.** If metadata generation, Printify, or Shopify fails
  for any item in a batch, that stage stops immediately — no later item is
  attempted, whether the failure is a system/API error or the artwork
  itself failing validation. Produce a detailed report of exactly what
  stopped it and what was never attempted. Re-running after a fix resumes
  cleanly: already-completed items are skipped (idempotent), not redone.
- **Module isolation.** Code for each integration lives in its own
  `automation/<platform>/` directory (`printify/`, `shopify/`, `ai/`,
  `social/`). Shared logic goes in `automation/shared/`, not duplicated
  across modules or reached into across module boundaries.
- **Small, testable phases.** Build and verify one phase of the pipeline at
  a time. Do not implement multiple pipeline stages in one pass, and do not
  scaffold future phases speculatively — build what the current phase
  needs.
- **No placeholder implementations.** Don't stub out a function with fake
  data or a "TODO: implement" body and call it done. If a phase isn't ready
  to be built, say so instead of faking it.
- **Secrets stay in `.env`.** `.env` is gitignored; `.env.example` is the
  source of truth for which variables exist. Add a new variable to
  `.env.example` whenever a new integration needs a credential.

## Repository layout

```
designs/
  incoming/    User workspace only — Claude never processes files here
  approved/    Only approved artwork exists here
  published/   Successfully published products
  rejected/    Rejected artwork
  archive/     Old artwork

mockups/       Generated product mockups
automation/
  printify/    Printify API integration
  shopify/     Shopify API integration
  ai/          AI generation integration
  social/      Social media publishing integration
  shared/      Code shared across automation modules
scripts/       Standalone/CLI scripts and pipeline runners
config/        Configuration files
logs/          Runtime and pipeline logs (gitignored)
docs/          Project documentation
tests/         Automated tests
```

## Current status

**Skeleton only.** No dependencies are installed and no application code
exists yet. Do not add dependencies, scaffolding, or pipeline logic unless
explicitly asked to in that session — wait for direction on which phase to
build next.
