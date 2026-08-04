/**
 * The Design Director: decides *how* a design brief should be art
 * directed. Given a brief, it picks the single best-fitting style from the
 * premium style library (./styles/library.ts) by matching the brief
 * against each style's `bestNiches` keywords — deterministic and free (no
 * extra AI call, no added latency/cost, fully unit-testable) rather than
 * random selection or an unpredictable model call.
 *
 * Used by `./compose-shirt-artwork.ts` to pick the style a composition's
 * typography and layout follow.
 */
import { getStyleById, STYLE_LIBRARY } from "./styles/library.ts";
import type { ComplexityTarget, StyleDefinition } from "./styles/types.ts";

/** General-purpose fallback when a brief doesn't clearly match any style's niche keywords. */
export const DEFAULT_STYLE_ID = "premium-streetwear";

export interface DesignDirectorDecision {
  /** The most specific niche keyword matched, or a general fallback label. */
  readonly niche: string;
  readonly style: StyleDefinition;
  readonly targetCustomer: string;
  readonly visualComplexity: ComplexityTarget;
  /** Every niche keyword from the winning style that matched the brief. */
  readonly matchedKeywords: readonly string[];
  /** True when no style matched and the default style was used instead. */
  readonly usedFallback: boolean;
}

export interface ChooseStyleOptions {
  /** Overridable for tests; defaults to the real premium style library. */
  readonly styles?: readonly StyleDefinition[];
}

/**
 * Picks the style whose `bestNiches` has the most keyword matches against
 * `brief` (case-insensitive substring matching). Ties keep whichever
 * style appears first in `styles`, so results are stable and repeatable.
 * Falls back to `DEFAULT_STYLE_ID` when nothing matches at all.
 */
export function chooseStyle(brief: string, options: ChooseStyleOptions = {}): DesignDirectorDecision {
  const styles = options.styles ?? STYLE_LIBRARY;
  const normalizedBrief = brief.trim().toLowerCase();

  let bestStyle: StyleDefinition | undefined;
  let bestMatches: readonly string[] = [];

  for (const style of styles) {
    const matches = style.bestNiches.filter((niche) => normalizedBrief.includes(niche.toLowerCase()));
    if (matches.length > bestMatches.length) {
      bestStyle = style;
      bestMatches = matches;
    }
  }

  const usedFallback = bestStyle === undefined;
  const style = bestStyle ?? getStyleById(DEFAULT_STYLE_ID) ?? styles[0];
  if (style === undefined) {
    // Programmer error, not an operational failure — the style library is never empty in practice.
    throw new Error("chooseStyle: no styles available to choose from");
  }

  const niche = usedFallback ? "general premium apparel" : longestMatch(bestMatches);

  return {
    niche,
    style,
    targetCustomer: `Shoppers into ${niche} who want ${stripTrailingPeriod(style.commercialPositioning)}`,
    visualComplexity: style.complexityTarget,
    matchedKeywords: bestMatches,
    usedFallback,
  };
}

function longestMatch(matches: readonly string[]): string {
  return [...matches].sort((a, b) => b.length - a.length)[0] ?? "";
}

function stripTrailingPeriod(text: string): string {
  return text.endsWith(".") ? text.slice(0, -1) : text;
}
