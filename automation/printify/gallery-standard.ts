/**
 * The approved apparel gallery standard — one shared definition every
 * product's Shopify image sync goes through, instead of each product
 * re-deriving its own slot order. This is what "no future upload should
 * require manual corrections" and "never build one-off solutions" mean at
 * the code level: the mapping lives here exactly once.
 *
 * Desired order: Hero, Lifestyle, Lifestyle Alternate, Studio Front,
 * Studio Back, Flat Lay, Folded, Close-up, Fabric Detail — mapped to this
 * account's real Printify blueprint/print-provider camera_label values.
 * `cameraLabel: null` means that blueprint's mockup set has no matching
 * camera angle; `mapMockupsToGallery` reports that slot as unmapped
 * rather than filling it with a mislabeled substitute. This was derived
 * from the 62 real mockup URLs Printify actually returned for the Gold
 * Turntable T-Shirt (blueprint 12 / print provider 39) — if a future
 * blueprint or print provider offers a different camera set (e.g. a real
 * flat-lay angle appears), update the table here once and every product
 * picks it up automatically.
 */
import type { ShopifyReplacementImage } from "../shopify/types.ts";

export interface GallerySlotDefinition {
  readonly slot: string;
  readonly cameraLabel: string | null;
  readonly altSuffix: string;
}

export const APPAREL_GALLERY_STANDARD: readonly GallerySlotDefinition[] = [
  { slot: "Hero", cameraLabel: "front", altSuffix: "front view" },
  { slot: "Lifestyle", cameraLabel: "lifestyle", altSuffix: "worn by a model, lifestyle scene" },
  { slot: "Lifestyle Alternate", cameraLabel: "duo", altSuffix: "worn by a model, alternate lifestyle scene" },
  { slot: "Studio Front", cameraLabel: "front-2", altSuffix: "studio front view" },
  { slot: "Studio Back", cameraLabel: "back-2", altSuffix: "studio back view" },
  { slot: "Flat Lay", cameraLabel: null, altSuffix: "flat lay" },
  { slot: "Folded", cameraLabel: "folded", altSuffix: "folded product photo" },
  { slot: "Close-up", cameraLabel: "front-collar-closeup", altSuffix: "close-up detail" },
  {
    slot: "Fabric Detail",
    cameraLabel: "back-collar-closeup",
    altSuffix: "fabric/print detail (closest available angle — no dedicated fabric macro shot in this blueprint)",
  },
];

export interface GalleryMappingResult {
  readonly images: readonly ShopifyReplacementImage[];
  readonly mappedSlots: ReadonlyArray<{ readonly slot: string; readonly src: string }>;
  readonly unmappedSlots: readonly string[];
}

function cameraLabelOf(mockupUrl: string): string | null {
  try {
    return new URL(mockupUrl).searchParams.get("camera_label");
  } catch {
    return null;
  }
}

/**
 * Maps a product's regenerated Printify mockup URLs onto the approved
 * gallery standard, in final Shopify position order (position 1 = first
 * match = the featured image used everywhere a single image represents
 * the product — collection cards, homepage cards, search results, cart
 * previews, structured data, Open Graph).
 */
export function mapMockupsToGallery(
  mockupUrls: readonly string[],
  productTitle: string,
): GalleryMappingResult {
  const images: ShopifyReplacementImage[] = [];
  const mappedSlots: Array<{ slot: string; src: string }> = [];
  const unmappedSlots: string[] = [];
  let position = 1;

  for (const { slot, cameraLabel, altSuffix } of APPAREL_GALLERY_STANDARD) {
    if (cameraLabel === null) {
      unmappedSlots.push(slot);
      continue;
    }
    const match = mockupUrls.find((url) => cameraLabelOf(url) === cameraLabel);
    if (match === undefined) {
      unmappedSlots.push(`${slot} (expected camera_label="${cameraLabel}" not found in regenerated mockups)`);
      continue;
    }
    mappedSlots.push({ slot, src: match });
    images.push({ src: match, altText: `${productTitle} — ${altSuffix}`, position });
    position += 1;
  }

  return { images, mappedSlots, unmappedSlots };
}
