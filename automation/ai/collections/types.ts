/**
 * The Collection Engine's data model. A collection is a coordinated
 * product line (10-25 products), not a single design — every field here
 * exists to keep those products visually and commercially consistent
 * with each other, the way a real apparel brand plans a drop.
 */

export interface CollectionColorPalette {
  readonly description: string;
  readonly swatches: readonly string[];
}

export interface CollectionDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly visualIdentity: string;
  readonly colorPalette: CollectionColorPalette;
  readonly typographyStyle: string;
  /** Asset Library categories/tags this collection draws its hero assets from — see automation/ai/assets/. */
  readonly assetPreferences: readonly string[];
  readonly designRules: readonly string[];
  readonly seoKeywords: readonly string[];
  readonly targetAudience: string;
  /** A realistic price band, e.g. "$32-40". */
  readonly suggestedPricing: string;
  /** Other collection ids a shopper of this one is likely to also want. */
  readonly crossSellRecommendations: readonly string[];
  /** Style Library (../styles/library.ts) ids this collection's products should be drawn from. */
  readonly preferredStyleIds: readonly string[];
  /** Niche keywords the Collection Director matches a brief against. */
  readonly keywords: readonly string[];
  readonly minProducts: number;
  readonly maxProducts: number;
}
