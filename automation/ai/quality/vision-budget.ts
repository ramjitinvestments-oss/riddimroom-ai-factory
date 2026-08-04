/**
 * Daily spend tracking for the Stage 2 AI vision judge. Per the brief:
 * before every vision request, estimate today's spend so far, and skip
 * the call (falling back to Stage 1's deterministic verdict alone) once
 * the configured daily budget is exceeded.
 *
 * Cost per call is computed from the response's actual reported token
 * usage against documented per-token rates, rather than a flat guess —
 * OpenAI doesn't return a dollar figure directly, so this is the closest
 * real estimate available without a live pricing API. Update the rate
 * constants below if pricing changes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** USD per 1,000,000 tokens for the default vision-judge model (gpt-4o-mini). Documented estimate — update if pricing changes. */
export const DEFAULT_TOKEN_RATES = {
  inputPerMillionUsd: 0.15,
  outputPerMillionUsd: 0.6,
};

export const DEFAULT_DAILY_VISION_BUDGET_USD = 5;

export interface VisionUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export function estimateCostUsd(usage: VisionUsage, rates = DEFAULT_TOKEN_RATES): number {
  return (
    (usage.promptTokens / 1_000_000) * rates.inputPerMillionUsd +
    (usage.completionTokens / 1_000_000) * rates.outputPerMillionUsd
  );
}

export interface VisionSpendLedger {
  /** Total estimated USD spent on vision calls today. */
  todaySpend(): number;
  /** Records an additional `amountUsd` against today's running total. */
  recordSpend(amountUsd: number): void;
}

export interface FileVisionSpendLedgerOptions {
  /** Defaults to "logs/vision-spend.json", matching this codebase's runtime-log location. */
  readonly ledgerPath?: string;
  /** Injectable clock, for tests. */
  readonly now?: () => Date;
}

interface LedgerFile {
  [isoDate: string]: number;
}

/** Persists daily totals as a small JSON file under `logs/` (gitignored runtime data, per this repo's layout). */
export class FileVisionSpendLedger implements VisionSpendLedger {
  private readonly ledgerPath: string;
  private readonly now: () => Date;

  constructor(options: FileVisionSpendLedgerOptions = {}) {
    this.ledgerPath = options.ledgerPath ?? path.join("logs", "vision-spend.json");
    this.now = options.now ?? ((): Date => new Date());
  }

  todaySpend(): number {
    const data = this.read();
    return data[this.todayKey()] ?? 0;
  }

  recordSpend(amountUsd: number): void {
    const data = this.read();
    const key = this.todayKey();
    data[key] = (data[key] ?? 0) + amountUsd;
    this.write(data);
  }

  private todayKey(): string {
    return this.now().toISOString().slice(0, 10); // YYYY-MM-DD
  }

  private read(): LedgerFile {
    if (!existsSync(this.ledgerPath)) {
      return {};
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.ledgerPath, "utf8"));
      return isLedgerFile(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  private write(data: LedgerFile): void {
    mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
    writeFileSync(this.ledgerPath, JSON.stringify(data, null, 2));
  }
}

function isLedgerFile(value: unknown): value is LedgerFile {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** In-memory ledger for tests — same interface, no filesystem I/O. */
export class InMemoryVisionSpendLedger implements VisionSpendLedger {
  private readonly spendByDate = new Map<string, number>();
  private readonly now: () => Date;

  constructor(now: () => Date = (): Date => new Date()) {
    this.now = now;
  }

  todaySpend(): number {
    return this.spendByDate.get(this.todayKey()) ?? 0;
  }

  recordSpend(amountUsd: number): void {
    const key = this.todayKey();
    this.spendByDate.set(key, (this.spendByDate.get(key) ?? 0) + amountUsd);
  }

  private todayKey(): string {
    return this.now().toISOString().slice(0, 10);
  }
}

export function isBudgetExceeded(todaySpendUsd: number, dailyBudgetUsd: number): boolean {
  return todaySpendUsd >= dailyBudgetUsd;
}
