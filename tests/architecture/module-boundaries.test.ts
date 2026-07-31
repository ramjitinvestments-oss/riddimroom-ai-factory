import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Enforces the module isolation rule from CLAUDE.md: `automation/shared`
 * must never import from a platform module (`automation/ai`,
 * `automation/shopify`, `automation/printify`, `automation/social`).
 * Shared code has to stay usable by every platform module, so the
 * dependency direction only goes one way: platform modules may depend on
 * shared, shared must never depend back on a platform module.
 *
 * This is a line-based import scan rather than a full parse — sufficient
 * for catching accidental `import ... from "../ai/..."` style violations
 * without adding a parser/lint dependency.
 */

const SHARED_DIR = path.resolve(import.meta.dirname, "../../automation/shared");
const FORBIDDEN_PATTERN = /(^|\/)automation\/(ai|shopify|printify|social)(\/|$)/;
const IMPORT_SPECIFIER_PATTERN = /(?:from\s+|import\s*\(|import\s+)["']([^"']+)["']/g;

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

test("automation/shared never imports from a platform module", () => {
  const files = listTsFiles(SHARED_DIR);
  assert.ok(files.length > 0, "expected to find .ts files under automation/shared");

  const violations: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const dirPosix = path.dirname(file).split(path.sep).join("/");

    for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
      const specifier = match[1];
      if (specifier === undefined || !specifier.startsWith(".")) {
        continue;
      }
      const resolved = path.posix.normalize(path.posix.join(dirPosix, specifier));
      if (FORBIDDEN_PATTERN.test(resolved)) {
        violations.push(`${file} imports "${specifier}"`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
