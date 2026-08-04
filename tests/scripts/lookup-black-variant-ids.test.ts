import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { lookupBlackVariantIds } from "../../scripts/lookup-black-variant-ids.ts";

function tempDir(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function catalogFetch(variants: ReadonlyArray<{ id: number; title: string; color?: string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    assert.match(String(input), /\/catalog\/blueprints\/12\/print_providers\/39\/variants\.json$/);
    return new Response(
      JSON.stringify({
        variants: variants.map((v) => ({ id: v.id, title: v.title, options: v.color !== undefined ? { color: v.color } : {} })),
      }),
      { status: 200 },
    );
  }) as typeof fetch;
}

const BASE_ENV = { PRINTIFY_API_KEY: "pk-test", PRINTIFY_BLUEPRINT_ID: "12", PRINTIFY_PRINT_PROVIDER_ID: "39" };

test("lookupBlackVariantIds fails clearly when required env vars are missing — never guesses", async () => {
  const result = await lookupBlackVariantIds({ env: {} });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "CONFIG_ERROR");
});

test("lookupBlackVariantIds filters by color=black (case-insensitive) and writes .env", async (t) => {
  const dir = tempDir(t, "riddimroom-env-");
  const envFilePath = path.join(dir, ".env");
  writeFileSync(envFilePath, "SOME_OTHER_VAR=keep-me\nDRY_RUN=false\n");

  const result = await lookupBlackVariantIds({
    env: BASE_ENV,
    envFilePath,
    fetchImpl: catalogFetch([
      { id: 100, title: "S / White", color: "White" },
      { id: 101, title: "S / Black", color: "Black" },
      { id: 102, title: "M / BLACK", color: "BLACK" }, // case-insensitive match
      { id: 103, title: "M / Navy", color: "Navy" },
      { id: 104, title: "L / Jet Black", color: "Jet Black" }, // substring match, like the documented jq regex
    ]),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.matched.map((v) => v.id),
    [101, 102, 104],
  );
  assert.equal(result.value.envFileUpdated, true);

  const written = readFileSync(envFilePath, "utf8");
  assert.match(written, /^PRINTIFY_BLACK_VARIANT_IDS=101,102,104$/m);
  // Everything else in the file must be untouched.
  assert.match(written, /^SOME_OTHER_VAR=keep-me$/m);
  assert.match(written, /^DRY_RUN=false$/m);
});

test("lookupBlackVariantIds replaces an existing PRINTIFY_BLACK_VARIANT_IDS line instead of duplicating it", async (t) => {
  const dir = tempDir(t, "riddimroom-env-");
  const envFilePath = path.join(dir, ".env");
  writeFileSync(envFilePath, "PRINTIFY_BLACK_VARIANT_IDS=999,998\nOTHER=1\n");

  const result = await lookupBlackVariantIds({
    env: BASE_ENV,
    envFilePath,
    fetchImpl: catalogFetch([{ id: 201, title: "S / Black", color: "Black" }]),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const written = readFileSync(envFilePath, "utf8");
  const matches = written.match(/^PRINTIFY_BLACK_VARIANT_IDS=.*$/gm) ?? [];
  assert.equal(matches.length, 1, "must not leave a duplicate PRINTIFY_BLACK_VARIANT_IDS line");
  assert.equal(matches[0], "PRINTIFY_BLACK_VARIANT_IDS=201");
  assert.match(written, /^OTHER=1$/m);
});

test("lookupBlackVariantIds fails and writes nothing when no variant matches black — refuses to guess", async (t) => {
  const dir = tempDir(t, "riddimroom-env-");
  const envFilePath = path.join(dir, ".env");
  writeFileSync(envFilePath, "OTHER=1\n");

  const result = await lookupBlackVariantIds({
    env: BASE_ENV,
    envFilePath,
    fetchImpl: catalogFetch([
      { id: 1, title: "S / White", color: "White" },
      { id: 2, title: "S / Navy", color: "Navy" },
    ]),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /none had a color matching "black"/);

  const written = readFileSync(envFilePath, "utf8");
  assert.equal(written, "OTHER=1\n", ".env must be completely untouched on failure");
});

test("lookupBlackVariantIds surfaces a real Printify API error instead of fabricating a result", async (t) => {
  const dir = tempDir(t, "riddimroom-env-");
  const envFilePath = path.join(dir, ".env");

  const result = await lookupBlackVariantIds({
    env: BASE_ENV,
    envFilePath,
    fetchImpl: (async () => new Response("blueprint not found", { status: 404 })) as typeof fetch,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "EXTERNAL_SERVICE_ERROR");
  assert.match(result.error.message, /HTTP 404/);
});
