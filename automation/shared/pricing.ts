/**
 * Centralized retail-price policy. Currently: every shirt product uses a
 * single fixed retail price, overriding whatever the AI product-copy
 * generator or a collection's descriptive pricing band suggested — set in
 * exactly one place (`DEFAULT_SHIRT_PRICE`) so it can change without
 * touching every file that deals with price. Non-shirt product types
 * (future: hoodies, mugs, hats) are untouched — this module only knows
 * how to price shirts; everything else passes through unchanged.
 */

const DEFAULT_SHIRT_PRICE_ENV_VAR = "DEFAULT_SHIRT_PRICE";
/** Used when the env var is unset/blank/invalid. */
const FALLBACK_DEFAULT_SHIRT_PRICE = 24.99;

/** Product-type strings (case-insensitive) this policy treats as "a shirt." */
const SHIRT_PRODUCT_TYPES = new Set(["t-shirt", "tshirt", "shirt", "tee"]);

export function isShirtProductType(productType: string): boolean {
  return SHIRT_PRODUCT_TYPES.has(productType.trim().toLowerCase());
}

/** Reads the configured fixed shirt price, falling back to $24.99 if unset/invalid. */
export function getDefaultShirtPrice(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[DEFAULT_SHIRT_PRICE_ENV_VAR];
  if (raw === undefined || raw.trim().length === 0) {
    return FALLBACK_DEFAULT_SHIRT_PRICE;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_DEFAULT_SHIRT_PRICE;
}

/**
 * The price to actually charge: the fixed shirt price when `productType`
 * is a shirt (ignoring `suggestedPrice` entirely — AI suggestions and
 * collection pricing bands never apply to shirts), otherwise
 * `suggestedPrice` unchanged.
 */
export function resolveRetailPrice(
  productType: string,
  suggestedPrice: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return isShirtProductType(productType) ? getDefaultShirtPrice(env) : suggestedPrice;
}
