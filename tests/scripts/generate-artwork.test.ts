import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateArtwork } from "../../scripts/generate-artwork.ts";
import { readPngDimensions } from "../../automation/ai/png.ts";
import { Logger } from "../../automation/shared/logger.ts";
import type { FileOperationError } from "../../automation/shared/errors.ts";
import { ok, type Result } from "../../automation/shared/result.ts";
import type { LogTransport } from "../../automation/shared/log-transport.ts";
import type { LogEntry } from "../../automation/shared/types.ts";

class FakeTransport implements LogTransport {
  readonly name = "fake";
  readonly entries: LogEntry[] = [];

  write(entry: LogEntry): Result<void, FileOperationError> {
    this.entries.push(entry);
    return ok(undefined);
  }
}

function tempOutputRoot(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), "riddimroom-generated-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("generateArtwork saves a print-ready PNG and metadata.json under outputRoot/{jobId}", async (t) => {
  const outputRoot = tempOutputRoot(t);
  const transport = new FakeTransport();
  const logger = new Logger({ module: "test", transports: [transport] });

  const result = await generateArtwork("a mango wearing sunglasses", {
    outputRoot,
    logger,
    providerOptions: { env: { DRY_RUN: "true" } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value.artworkPath, path.join(outputRoot, result.value.jobId, "artwork.png"));
  assert.equal(result.value.metadataPath, path.join(outputRoot, result.value.jobId, "metadata.json"));

  const artworkBuffer = readFileSync(result.value.artworkPath);
  const dimensions = readPngDimensions(artworkBuffer);
  assert.equal(dimensions.ok, true);
  assert.equal(dimensions.ok ? dimensions.value.width : 0, 4500);
  assert.equal(dimensions.ok ? dimensions.value.height : 0, 5400);

  const metadata = JSON.parse(readFileSync(result.value.metadataPath, "utf8"));
  assert.equal(metadata.jobId, result.value.jobId);
  assert.equal(metadata.brief, "a mango wearing sunglasses");
  assert.equal(metadata.provider, "dry-run");
  assert.deepEqual(metadata.printDimensions, { width: 4500, height: 5400 });

  const saved = transport.entries.find((e) => e.message === "Artwork generated and saved");
  assert.ok(saved);
  assert.equal(saved?.jobId, result.value.jobId);
});

test("generateArtwork rejects a blank brief and writes nothing to disk", async (t) => {
  const outputRoot = tempOutputRoot(t);

  const result = await generateArtwork("   ", { outputRoot });

  assert.equal(result.ok, false);
  assert.equal(existsSync(outputRoot) && readdirSync(outputRoot).length, 0);
});

test("generateArtwork reports a ConfigError and writes nothing to disk when the real provider is misconfigured", async (t) => {
  const outputRoot = tempOutputRoot(t);
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const result = await generateArtwork("a mango", {
    outputRoot,
    logger,
    providerOptions: { env: { DRY_RUN: "false" } }, // no OPENAI_API_KEY
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONFIG_ERROR");
  }
  assert.equal(readdirSync(outputRoot).length, 0);
});

test("generateArtwork uses a distinct jobId (and directory) for each call", async (t) => {
  const outputRoot = tempOutputRoot(t);
  const logger = new Logger({ module: "test", transports: [new FakeTransport()] });

  const first = await generateArtwork("a mango", {
    outputRoot,
    logger,
    providerOptions: { env: { DRY_RUN: "true" } },
  });
  const second = await generateArtwork("a mango", {
    outputRoot,
    logger,
    providerOptions: { env: { DRY_RUN: "true" } },
  });

  assert.ok(first.ok && second.ok);
  if (first.ok && second.ok) {
    assert.notEqual(first.value.jobId, second.value.jobId);
  }
  assert.equal(readdirSync(outputRoot).length, 2);
});
