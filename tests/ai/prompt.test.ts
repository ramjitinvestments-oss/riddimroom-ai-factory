import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTShirtPrompt } from "../../automation/ai/prompt.ts";

test("buildTShirtPrompt includes the trimmed design brief", () => {
  const prompt = buildTShirtPrompt("  a parrot wearing sunglasses  ");
  assert.match(prompt, /^a parrot wearing sunglasses\./);
});

test("buildTShirtPrompt adds a t-shirt-appropriate style directive", () => {
  const prompt = buildTShirtPrompt("a parrot");
  assert.match(prompt, /flat vector illustration/);
  assert.match(prompt, /no photorealism/);
});

test("buildTShirtPrompt adds a commercial-safety directive", () => {
  const prompt = buildTShirtPrompt("a parrot");
  assert.match(prompt, /no copyrighted characters/);
  assert.match(prompt, /no real identifiable people/);
});
