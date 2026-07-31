# RiddimRoom AI Factory

An AI-powered production platform for original, commercial-safe
Caribbean-themed apparel — from generated artwork to a published product
listing, with a human approval gate at the center of the pipeline.

## Vision

RiddimRoom AI Factory exists to turn "an idea for a Caribbean-themed design"
into a live, sellable product with as little manual production work as
possible, while keeping a human firmly in control of what actually ships.

The long-term shape of the platform is a pipeline of discrete, independently
testable stages:

1. **Generate** — Produce original, commercial-safe Caribbean-themed t-shirt
   artwork using AI image generation.
2. **Prepare** — Convert generated artwork into print-ready assets: PNG,
   4500x5400, transparent background.
3. **Mock up** — Generate product mockups so a design can be evaluated the
   way a customer would see it.
4. **Approve** — A human review gate. Nothing reaches a storefront without
   explicit approval; the `designs/` pipeline stages (`incoming` →
   `generated` → `approved` → `uploaded` / `archive`) exist to make that
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
  incoming/    New design briefs/inputs awaiting generation
  generated/   Raw AI-generated designs, not yet reviewed
  approved/    Designs approved for production/print
  uploaded/    Designs that have been uploaded to Printify/Shopify
  archive/     Rejected or superseded designs, kept for reference

mockups/       Generated product mockups (t-shirt previews, etc.)

automation/
  printify/    Printify API integration
  shopify/     Shopify API integration
  ai/          AI image/content generation integration
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
