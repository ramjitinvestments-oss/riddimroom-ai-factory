/**
 * Shape of one entry in the premium style library (./library.ts). Each
 * style is a complete apparel design system — not a single prompt
 * fragment — so the Design Director (../design-director.ts) has enough
 * to make a real creative decision.
 */

/** How visually dense/detailed the finished artwork should be. */
export type ComplexityTarget = "moderate" | "high" | "very-high";

export interface ColorPalette {
  /** How the palette should feel and why, not just a color list. */
  readonly description: string;
  /** Specific named/hinted colors a generator can anchor to. */
  readonly swatches: readonly string[];
}

export interface StyleDefinition {
  /** Stable slug, e.g. "vintage-jamaican-sound-system". */
  readonly id: string;
  readonly name: string;
  /** The one or two sentences that explain *why* this style looks the way it does. */
  readonly designPhilosophy: string;
  readonly visualCharacteristics: readonly string[];
  readonly compositionRules: readonly string[];
  readonly colorPalette: ColorPalette;
  /** Lettering guidance. May state "n/a" for purely illustrative styles. */
  readonly typography: readonly string[];
  readonly textureGuidance: readonly string[];
  readonly illustrationDirection: readonly string[];
  readonly printRecommendations: readonly string[];
  /** Things this style must never look like. */
  readonly negativePrompts: readonly string[];
  /** Keywords/niches the Design Director matches a design brief against. */
  readonly bestNiches: readonly string[];
  readonly shirtColorCompatibility: readonly string[];
  readonly complexityTarget: ComplexityTarget;
  /** Positioning + realistic price band, so downstream copy/pricing can stay consistent with the art direction. */
  readonly commercialPositioning: string;
}
