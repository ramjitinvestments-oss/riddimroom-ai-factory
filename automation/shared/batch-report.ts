/**
 * Shared shape for "stop the whole batch" reporting. Used by every
 * production pipeline stage that processes a batch of items
 * (`scripts/prepare-artwork.ts`, `scripts/import-artwork.ts`,
 * `scripts/upload-to-printify.ts`, `scripts/publish-to-shopify.ts`).
 * `stoppedDueTo` is `null` only when every item in the scan was fully
 * processed, an already-done idempotent skip, or (in `prepare-artwork.ts`
 * only) a safely-rejected item — i.e. the whole batch ran to completion.
 *
 * What counts as "stop-worthy" differs by stage: per CLAUDE.md's
 * production-safety rule, a failure in metadata generation, Printify, or
 * Shopify stops that stage immediately — no later item is attempted, and
 * nothing is silently skipped. `scripts/prepare-artwork.ts` is the one
 * exception: a per-item content problem (e.g. an unsafe-to-remove
 * background) is rejected and the batch continues; only a genuine system
 * failure (filesystem error, unexpected crash) uses `stoppedDueTo` there.
 */

/** Records exactly which item stopped a batch and why, for a detailed, actionable error report. */
export interface StoppedDueTo {
  readonly sourcePath: string;
  readonly jobId?: string;
  /** Short, human-readable stage/reason, e.g. "artwork failed validation", "Printify upload failed". */
  readonly reason: string;
  /** The underlying issue(s)/error message(s) — as many as are known. */
  readonly details: readonly string[];
}
