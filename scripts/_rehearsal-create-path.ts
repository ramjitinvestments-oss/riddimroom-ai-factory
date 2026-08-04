// This file is retired. It was a one-off, non-CLI rehearsal harness used to
// manually verify scripts/apparel-pipeline.ts's create-path routing against
// an isolated /tmp fixture during development. That coverage is now a
// permanent, real test — see tests/scripts/apparel-pipeline.test.ts — so
// this file has no further purpose.
//
// It could not be deleted (this sandbox's mounted filesystem does not permit
// removing files once written), so it's left here neutralized: it has no
// executable `main()`, imports nothing, and does nothing if ever required.
export {};
