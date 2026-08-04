import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_TOKEN_RATES,
  estimateCostUsd,
  FileVisionSpendLedger,
  InMemoryVisionSpendLedger,
  isBudgetExceeded,
} from "../../../automation/ai/quality/vision-budget.ts";

test("estimateCostUsd computes cost from prompt/completion token usage at the documented rates", () => {
  const cost = estimateCostUsd({ promptTokens: 1_000_000, completionTokens: 1_000_000 });
  assert.ok(Math.abs(cost - (DEFAULT_TOKEN_RATES.inputPerMillionUsd + DEFAULT_TOKEN_RATES.outputPerMillionUsd)) < 1e-9);
});

test("estimateCostUsd honors custom rates", () => {
  const cost = estimateCostUsd(
    { promptTokens: 1_000_000, completionTokens: 0 },
    { inputPerMillionUsd: 2, outputPerMillionUsd: 4 },
  );
  assert.equal(cost, 2);
});

test("isBudgetExceeded compares spend against the daily budget", () => {
  assert.equal(isBudgetExceeded(4.99, 5), false);
  assert.equal(isBudgetExceeded(5, 5), true);
  assert.equal(isBudgetExceeded(5.01, 5), true);
});

test("InMemoryVisionSpendLedger accumulates spend for the current day", () => {
  const ledger = new InMemoryVisionSpendLedger();
  assert.equal(ledger.todaySpend(), 0);
  ledger.recordSpend(0.01);
  ledger.recordSpend(0.02);
  assert.ok(Math.abs(ledger.todaySpend() - 0.03) < 1e-9);
});

test("InMemoryVisionSpendLedger tracks spend per calendar day using the injected clock", () => {
  let now = new Date("2026-08-01T00:00:00.000Z");
  const ledger = new InMemoryVisionSpendLedger(() => now);
  ledger.recordSpend(1);
  assert.equal(ledger.todaySpend(), 1);

  now = new Date("2026-08-02T00:00:00.000Z");
  assert.equal(ledger.todaySpend(), 0);
});

test("FileVisionSpendLedger persists spend to disk and reloads it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vision-ledger-"));
  const ledgerPath = path.join(dir, "vision-spend.json");
  try {
    const now = () => new Date("2026-08-01T12:00:00.000Z");
    const first = new FileVisionSpendLedger({ ledgerPath, now });
    first.recordSpend(0.5);
    first.recordSpend(0.25);

    const second = new FileVisionSpendLedger({ ledgerPath, now });
    assert.ok(Math.abs(second.todaySpend() - 0.75) < 1e-9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FileVisionSpendLedger returns 0 when no ledger file exists yet", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vision-ledger-"));
  const ledgerPath = path.join(dir, "does-not-exist.json");
  try {
    const ledger = new FileVisionSpendLedger({ ledgerPath });
    assert.equal(ledger.todaySpend(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
