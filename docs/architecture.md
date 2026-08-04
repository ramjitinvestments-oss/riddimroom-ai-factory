# Architecture conventions

These conventions apply to every module in `automation/`, starting with
Phase 1A. They exist so platform modules (Printify, Shopify, AI, social),
when they're built, all fail and recover the same way instead of each
inventing its own error handling.

## Result pattern

Public functions return `Result<T, E>` (`automation/shared/result.ts`) for
*expected, operational* failures — a missing file, invalid config, a
timed-out API call. They only `throw` for programmer errors: invariant
violations that indicate a bug, not a runtime condition a caller should
plan for.

```ts
const result = validateConfig(specs);
if (!result.ok) {
  // result.error is a typed ConfigError — handle it, don't crash.
  return;
}
// result.value is the resolved config.
```

`Result` ships with `ok`/`err` constructors, `isOk`/`isErr` guards, and
`map`/`mapErr`/`unwrapOr` helpers.

## Error taxonomy

All error classes (`automation/shared/errors.ts`) extend `AppError`, which
carries a stable, machine-readable `code`:

| Class                  | code                     | Used for |
|-------------------------|--------------------------|----------|
| `ConfigError`           | `CONFIG_ERROR`           | Missing/blank required environment variables |
| `ValidationError`       | `VALIDATION_ERROR`       | Input that fails a shape/constraint check |
| `FileOperationError`    | `FILE_OPERATION_ERROR`   | A read/write/move/mkdir/delete on disk failed |
| `JobError`              | `JOB_ERROR`              | A job could not be created, transitioned, or persisted |
| `ExternalServiceError`  | `EXTERNAL_SERVICE_ERROR` | A call to Printify/Shopify/an AI provider/a social API failed |

## Module boundaries

`automation/shared` must never import from `automation/ai`,
`automation/shopify`, `automation/printify`, or `automation/social`.
Dependencies only flow one way: platform modules may depend on shared,
shared must never depend back on a platform module. This is enforced by
`tests/architecture/module-boundaries.test.ts`, which scans shared's
source for imports reaching into a platform directory and fails the test
suite if one is found.

## Shared type contracts

`automation/shared/types.ts` defines interfaces. `LogEntry`/`LogLevel` are
now implemented by the logger (below). `Job`, `JobStatus`, and `AppConfig`
remain contracts with no implementation yet — the job system and its
config wiring are later steps.

`Job` is designed for resumability: `status` records which pipeline stage
a job has reached, `history` is an audit trail of every status
transition, and `attempts`/`lastError` capture retry state. Reloading a
persisted `Job` after a crash or restart gives enough information to
resume at `status` rather than redo already-completed stages. `data` is a
generic bag for whatever stage-specific state a job needs to carry (a
generated file path, a Printify product ID) without this shared interface
needing to know about any specific platform.

## Structured logging

`automation/shared/logger.ts` is the `Logger` class; `automation/shared/log-transport.ts`
defines the `LogTransport` adapter interface plus the two transports built
so far, `ConsoleTransport` and `FileTransport`. Adding a destination later
(an external logging provider) means implementing `LogTransport` and
passing an instance to `Logger` — `Logger` itself never changes.

Every entry is a `LogEntry`: `timestamp`, `level` (`trace`/`debug`/`info`/
`warn`/`error`/`fatal`), `module`, `jobId` (nullable), `stage` (nullable),
`message`, `metadata`, and an optional `duration` in milliseconds. It's
JSON — every transport writes it as one line, so log output is
machine-readable end to end.

**Correlation.** `logger.withJob(jobId)` returns a child logger that
stamps every subsequent entry with that job id, satisfying "every log for
a job carries that job's id" across every module the job passes through
(`withStage` does the same for stage; `withJob(id, stage)` sets both).

**Timing.** `logger.time(label, fn)` wraps an operation (e.g. "Generate
Artwork", "Upload Printify", "Publish Shopify"), logging an `info` entry
with `duration` on success or an `error` entry with `duration` (plus the
caught error) on failure. It always rethrows — timing only observes, it
never changes error semantics.

**Rotation.** `FileTransport` writes to `logs/YYYY-MM-DD.log`, recomputing
the target file from the current date on every write. One file per
calendar day is the rotation strategy — no background process, and no
single file grows without bound across days.

**Secrets.** Metadata passed to a log call is run through
`automation/shared/redact.ts`'s `redactSecrets` before it reaches any
transport: any key that looks like a credential (token, apiKey, password,
cookie, session, authorization, credential — case-insensitive, matched as
a substring) has its value masked, recursively through nested objects and
arrays. This is key-based redaction, not free-text scanning — a secret
interpolated directly into a log `message` string is not caught, so
credentials must always be passed under a descriptive metadata key, never
inlined into the message. `config.ts`'s `redact` (the low-level masking
function shared with `redactSecrets`) is re-exported from `config.ts` for
existing callers.

## MVP mode / LAUNCH MODE

Infrastructure work (an event bus was next in line) was paused in favor of
shipping the first products: Result/errors/config/logging are frozen as
"sufficient foundation," and everything since is built only as far as
the shirt pipeline (generate → prepare → product copy → approve →
Printify → Shopify → verify) actually needs. No mockup-generation stage
was built — the launch pipeline definition doesn't call for one; the
print-ready artwork itself is used as the product image on both
platforms. No additional shared primitives get added speculatively: when
`automation/printify` needed the exact same retry/backoff logic and env
helpers `automation/ai` had already built for itself, those were promoted
to `automation/shared` (`retry.ts`, `env-helpers.ts`) at that point —
platform modules aren't allowed to import from each other — not guessed
in advance.

## Dry-run mode

`DRY_RUN` (`automation/shared/config.ts`, in `CORE_ENV_SPECS`, default
`"true"`) is the cross-cutting switch every external-service module reads
via `parseBoolean(env.DRY_RUN, true)`. Defaulting to `true` is deliberate:
a fresh checkout with no `.env` configured can never accidentally hit a
real paid API. Flipping to production is meant to be a config change only
— `DRY_RUN=false` plus the real credentials — never a code change.

## Artwork: supplied by the user, not generated

RiddimRoom AI Factory is a **publishing engine**, not an image-generation
engine: artwork is supplied by the user and registered into the Asset
Library (`automation/ai/assets/`) — nothing in this codebase calls an AI
image-generation API. A design's hero artwork is looked up from the
library by category/style/tags (`automation/ai/assets/asset-search.ts`)
and, if a title is requested, composited with a real-font typography layer
(`automation/ai/typography/`) via the Composition Engine
(`automation/ai/composition/composition-canvas.ts`). If no matching asset
exists in the library, composition fails with a clear validation error
rather than generating one — see `automation/ai/compose-shirt-artwork.ts`.

The Design Director (`automation/ai/design-director.ts`) still chooses the
art direction a piece of supplied artwork is composited under. The Prompt
Expansion Engine that used to turn that decision into an image-generation
prompt has been removed — it had no caller left once the OpenAI image API
call it fed was deleted.

**Status note:** as of the "Engine Freeze," the Asset Library/Composition
Engine/Design Director/Collection Director/Typography Engine described in
this section are kept as dormant, reusable infrastructure — none of them
are wired into the active production pipeline, which is
`import-artwork.ts` → `upload-to-printify.ts` → `publish-to-shopify.ts`
(see the Orchestration scripts section below). `compose-shirt-artwork.ts`
/ `compose-collection-product.ts` / `generate-composed-artwork.ts` /
`generate-collection-product.ts` / `approve.ts` still exist and still work,
but nothing currently calls them as part of a production run.

The Provider pattern (an interface, a dry-run implementation, a real
`fetch`-based implementation, a `create<X>Provider()` factory keyed off
`DRY_RUN`) remains in use for every *external service* this engine still
calls — Printify, Shopify, and OpenAI for product copy (and optionally the
Stage 2 AI vision quality judge) — described below.

The identical provider pattern generates product listing copy:
`automation/ai/product-copy-types.ts` defines `ProductCopyProvider`;
`OpenAiProductCopyProvider` sends the design brief *and* the actual
generated artwork (as a vision input) to a structured-output chat
completion (`response_format: json_schema`), so copy is grounded in what
was actually produced, not just the original brief. Every response —
real or dry-run — is run through `product-copy-validation.ts`, which
enforces what's mechanically checkable (field lengths Shopify/Printify
expect, a sane price range, no duplicate tags); qualitative requirements
("Caribbean streetwear voice," "no keyword stuffing," "no copyrighted
phrases") are prompt directives (`product-copy-prompt.ts`), the same way
commercial-safety is a prompt concern for artwork.

## Print-ready conversion (automation/ai/prepare-print-ready.ts)

CLAUDE.md's print constraint (exactly 4500x5400 PNG, transparent
background) is non-negotiable and is validated, not assumed. Composed
artwork (and any other source image passing through this stage) can arrive
at a different aspect ratio than the print canvas, so `toPrintReadyPng()`
uses `sharp` (the one real dependency added so far, beyond the
zero-dependency hand-rolled `png.ts`) to pad — not stretch — the source to
the exact target size (`fit: "contain"`, transparent background fill),
then re-validates the *output* with `readPngDimensions`/`hasAlphaChannel`
before returning it. A source image that fails to decode, or an output
that doesn't come out to exactly the right size or lacks an alpha channel,
is reported as a `ValidationError`, never silently accepted.

## Printify and Shopify (automation/printify, automation/shopify)

Same provider shape again: `PrintifyProvider`/`ShopifyProvider`
interfaces, a dry-run implementation, a real `fetch`-based implementation
with retry/backoff, and a `create<X>Provider()` factory keyed off
`DRY_RUN`.

Printify's product-creation API requires a blueprint id, print provider
id, and variant ids that are specific to whatever product/provider the
account owner has chosen in their Printify catalog — there's no sane
universal default, so these are **required configuration**
(`PRINTIFY_BLUEPRINT_ID`/`PRINTIFY_PRINT_PROVIDER_ID`/`PRINTIFY_VARIANT_IDS`)
rather than a guessed hardcoded value. Going live requires picking real
values from the account's catalog first.

`ShopifyProvider` has a second method beyond publishing:
`verifyProductLive(shopifyProductId)`, used by the upload batch (below)
to confirm a product is actually `active` after creation — publishing
"succeeding" at the HTTP level isn't the same as the product being live,
so this is checked explicitly rather than assumed.

## Orchestration scripts (scripts/)

Each script is a thin CLI wrapper around an exported, dependency-injected
function (output root/jobs root/logger/provider config), so the actual
logic is unit-tested directly — `main()` only handles argv parsing and
console/exit-code reporting.

**Note:** the folder names below (`designs/generated/`, `designs/uploaded/`)
are what these scripts currently write to. CLAUDE.md's Repository layout
defines the target production folder taxonomy
(`incoming/`/`approved/`/`published/`/`rejected/`/`archive/`, no
`generated/` stage since artwork is user-supplied); these scripts have not
been migrated onto it yet — that's a separate follow-up, not done here.

- **`generate-composed-artwork.ts`** (`generateComposedArtworkJob`) /
  **`generate-collection-product.ts`** (`generateCollectionProductJob`) —
  resolve a hero asset from the Asset Library, composite it (plus an
  optional typography layer) via `composeShirtArtwork`/
  `composeCollectionProduct` → `toPrintReadyPng()` → save `artwork.png` +
  `metadata.json` to `designs/generated/{jobId}/`. Fail with a clear
  validation error if no matching artwork has been registered in the Asset
  Library yet — artwork is supplied by the user, never generated.
- **`generate-product-copy.ts`** (`generateProductCopy`) — reads an
  existing job's `metadata.json` + `artwork.png`, calls
  `createProductCopyProvider()`, saves `product.json` alongside them.
- **`approve.ts`** (`decideJobs`/`listPendingJobIds`) — the human approval
  gate. Batch by design from its first implementation (not retrofitted):
  `approve job-1 job-2` or `approve --all`. Moves a job's directory from
  `designs/generated/` to `designs/approved/` (or `designs/archive/` for
  `reject`) — never overwriting an existing destination, and refusing to
  move a job that isn't fully generated yet. Nothing auto-approves; a
  human runs this command.
- **`prepare-artwork.ts`** (`prepareApprovedArtwork`) — the Artwork
  Preparation stage, and the first step of the active pipeline. Scans
  `designs/approved/` for PNGs and inspects each one
  (`automation/ai/artwork-preparation.ts`: dimensions, DPI, transparency,
  color profile). If it's already Printify-suitable (exact print canvas,
  ≥300 effective DPI, transparent, PNG), it's copied through unchanged; if
  not, the *only* fixes ever applied are (a) background removal, and only
  when the background is a simple uniform color, via a flood fill from the
  canvas edge (never a blanket color-threshold sweep — same-colored
  regions enclosed by the subject are never touched), and (b) an
  aspect-preserving resize/upscale/pad onto the exact print canvas via
  `toPrintReadyPng()` (never a stretch, never a crop). The result is
  written to `designs/processed/`, mirroring the relative path under
  `designs/approved/`, alongside a `<stem>.prepared.json` report; the
  original is never modified.
  **Error handling here is deliberately different from every other stage:**
  an item that can't be safely prepared (a non-uniform background, or
  removal that would erase the subject) is a *content* problem with that
  one piece of artwork, not a pipeline problem — it's moved to
  `designs/rejected/` with a `<stem>.rejected.json` report (filename,
  reason, suggested fix) and the batch **continues** to the next item,
  rather than stopping. Only a genuine system failure (a filesystem error,
  or an unexpected exception escaping `prepareArtwork()`'s normal `Result`
  handling — a crash, not a clean validation failure) stops the whole
  batch, the same production-safe behavior every other stage uses.
  Idempotent both ways: a PNG whose `designs/processed/` *or*
  `designs/rejected/` counterpart already exists is skipped, not
  reattempted. Calls neither Printify nor Shopify.
- **`import-artwork.ts`** (`importApprovedArtwork`) — by default scans
  `designs/processed/` (Artwork Preparation's output, not the raw
  original) for print-ready PNGs and analyzes each one
  (`automation/ai/artwork-analysis-*`), writing `<stem>.product.json` /
  `.seo.json` / `.tags.json` / `.description.md` / `.job.json` beside it.
  Idempotent (a PNG with a `.job.json` is skipped) and production-safe: the
  moment one item fails validation or metadata generation, the whole scan
  stops immediately — no later PNG is attempted.
- **`upload-to-printify.ts`** (`uploadApprovedArtworkToPrintify`) — for
  each analyzed-but-not-yet-uploaded PNG in `designs/processed/`, uploads
  to Printify and writes `<stem>.printify.json`. Same stop-on-first-failure,
  idempotent-resume behavior as `import-artwork.ts`.
- **`publish-to-shopify.ts`** (`publishApprovedArtworkToShopify`) — for
  each Printify-uploaded PNG, publishes to Shopify, reads the product back
  to verify every field actually landed, writes `<stem>.shopify.json`, and
  only on a full verification pass moves the artwork (and all its sibling
  artifact files, including `<stem>.prepared.json`) to `designs/published/`.
  Same stop-on-first-failure, idempotent-resume behavior.

This is the current launch pipeline: user-supplied artwork placed in
`designs/approved/` → prepared into a print-ready file in
`designs/processed/` → analyzed → uploaded to Printify → published to
Shopify and verified live → moved to `designs/published/`. Product
Approval (Metadata Generation) and everything after it analyzes and acts
on the *processed* artwork only — the original in `designs/approved/` is
never read again once it's been prepared. Per CLAUDE.md's production-safety
rule, a failure in any of the four stages halts that stage's whole batch
immediately — nothing is skipped, and nothing continues past a failure.
Going live is purely a config change — `DRY_RUN=false` plus real
credentials for OpenAI (artwork analysis), Printify (including the catalog
ids above), and Shopify.

`generate-composed-artwork.ts` / `generate-collection-product.ts` /
`generate-product-copy.ts` / `approve.ts` above are an older,
AI-generates-the-artwork pipeline (`designs/generated/` →
`designs/approved/`) that predates CLAUDE.md's current "artwork is
user-supplied, not AI-generated" rule. They're unrelated to
`prepare-artwork.ts`/`import-artwork.ts`/`upload-to-printify.ts`/`publish-to-shopify.ts`,
which operate on `designs/approved/`/`designs/processed/` directly with no
generation stage. `scripts/run-uploads.ts`, the old combined
bounded-concurrency continue-past-failure upload/publish script, was
removed since it conflicted with the production-safety rule and is fully
superseded by `upload-to-printify.ts` + `publish-to-shopify.ts`.
