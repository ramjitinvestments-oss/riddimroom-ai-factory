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

## MVP mode

Infrastructure work (an event bus was next in line) was paused in favor of
shipping the first products: Result/errors/config/logging above are
frozen as "sufficient foundation," and everything past this point is
built only as far as the shirt pipeline (generate → prepare → mock up →
approve → Printify → Shopify → verify) actually needs. No additional
shared primitives get added speculatively; if Printify or Shopify later
need something AI already built for itself (e.g. `automation/ai/retry.ts`),
that's a promotion to `automation/shared` made at that point, not a guess
made now.

## Dry-run mode

`DRY_RUN` (`automation/shared/config.ts`, in `CORE_ENV_SPECS`, default
`"true"`) is the cross-cutting switch every external-service module reads
via `parseBoolean(env.DRY_RUN, true)`. Defaulting to `true` is deliberate:
a fresh checkout with no `.env` configured can never accidentally hit a
real paid API. Flipping to production is meant to be a config change only
— `DRY_RUN=false` plus the real credentials — never a code change.

## Provider pattern (automation/ai)

Each external integration is written against an interface, not a concrete
implementation, so the concrete implementation can be swapped later
without touching pipeline code. `automation/ai/types.ts` defines
`ImageGenerationProvider`; `automation/ai/openai-provider.ts` and
`automation/ai/dry-run-provider.ts` are two interchangeable
implementations of it. `automation/ai/create-image-provider.ts` is the
only place that decides which one to construct (based on `DRY_RUN`) —
pipeline code calls `createImageProvider()` and never constructs a
provider class directly. A future provider (Google Imagen, Flux, ...)
means adding one more class implementing `ImageGenerationProvider` and one
more branch in that factory; nothing else changes. Expect this same
shape — `types.ts` + real implementation + dry-run implementation +
`create<X>Provider()` factory — to repeat for Printify and Shopify.

`DryRunImageProvider` doesn't fake business logic; it only replaces the
network call. It builds a real, valid, decodable PNG (`automation/ai/png.ts`)
and runs the prompt through the exact same style/safety augmentation
(`automation/ai/prompt.ts`) that the real provider uses, so downstream
code (dimension validation, prompt logging, ...) exercises the same paths
in dry-run as it will in production.

`OpenAiImageProvider` calls OpenAI's REST API directly via `fetch` (no SDK
dependency), retries transient failures (429, 5xx, network errors) with
exponential backoff (`automation/ai/retry.ts`) — permanent failures (4xx,
malformed responses) are not retried — and validates that the response is
a real PNG before returning it, all wrapped in `logger.time("Generate
Artwork", ...)` so every generation attempt is automatically
duration-logged and job-correlated. It requests `background: "transparent"`
explicitly, matching the prompt's own style directive (see below).

## Print-ready conversion (automation/ai/prepare-print-ready.ts)

CLAUDE.md's print constraint (exactly 4500x5400 PNG, transparent
background) is non-negotiable and is validated, not assumed. AI providers
return roughly-square images at a different aspect ratio than the print
canvas, so `toPrintReadyPng()` uses `sharp` (the one real dependency added
so far, beyond the zero-dependency hand-rolled `png.ts`) to pad — not
stretch — the source to the exact target size (`fit: "contain"`, transparent
background fill), then re-validates the *output* with `readPngDimensions`/
`hasAlphaChannel` before returning it. A source image that fails to decode,
or an output that doesn't come out to exactly the right size or lacks an
alpha channel, is reported as a `ValidationError`, never silently accepted.

This also means `automation/ai/prompt.ts`'s style directive asks for a
*transparent* background (not the "plain white background" it originally
said) — that would have contradicted this stage's whole purpose.

## Orchestration scripts (scripts/)

`scripts/generate-artwork.ts` is the first pipeline-runner: it wires
`createImageProvider()` → `toPrintReadyPng()` → save-to-disk into one
end-to-end flow, saving `artwork.png` + `metadata.json` (prompt, job id,
provider, both source and print dimensions) into
`designs/generated/{jobId}/`. Its logic lives in an exported
`generateArtwork()` function — fully unit-testable via dependency
injection (output directory, logger, provider config) — with a thin
`main()` CLI wrapper (`npm run generate -- "<brief>"`) that only handles
argv parsing and console/exit-code reporting. No mockup, product copy, or
approval gate yet; those are separate, later steps, each independently
testable per CLAUDE.md's "small, testable phases" rule. A batch approval
command (`approve job-1 job-2 ...` / `approve --all`), when built, is
expected to operate on job directories this script produces.
