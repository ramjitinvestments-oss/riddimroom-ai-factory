/**
 * The Collection Library: 15 coordinated product lines. Each references
 * real Style Library ids (../styles/library.ts) and real Asset Library
 * categories (../assets/) so a collection is immediately actionable by
 * the rest of the engine, not just descriptive copy.
 *
 * Commercial-safety note: "Reggae Legends Inspired" and "Caribbean Flags"
 * are deliberately scoped in `designRules` to stay era/spirit-inspired
 * and pattern-original rather than depicting real people or reproducing
 * an actual government flag — consistent with this project's existing
 * commercial-safety directive (../product-copy-prompt.ts's SAFETY_DIRECTIVE).
 *
 * Adding collection #16 means appending one more `CollectionDefinition`
 * here — nothing in ./collection-director.ts needs to change.
 */
import type { CollectionDefinition } from "./types.ts";

export const COLLECTION_LIBRARY: readonly CollectionDefinition[] = [
  {
    id: "vintage-jamaican-sound-systems",
    name: "Vintage Jamaican Sound Systems",
    description:
      "A tribute to the towering speaker stacks and sound engineers that built Jamaica's music culture from " +
      "the ground up — heritage-driven, built for people who know their sound system history.",
    visualIdentity:
      "Weathered vintage poster aesthetic: sun-faded inks, hand-painted signage lettering, real hardware " +
      "detail on every speaker box.",
    colorPalette: {
      description: "Sun-faded reds, golds, and greens against vintage cream and charcoal.",
      swatches: ["sun-faded gold", "faded red", "deep reggae green", "vintage cream", "charcoal"],
    },
    typographyStyle: "hand-painted sound-system signage lettering, thick brush-script or chunky western-style letters",
    assetPreferences: ["speaker_stack", "microphone", "turntable"],
    designRules: [
      "always render a real, specific rig — no generic speaker clipart",
      "low, dramatic hero angle",
      "halftone print texture",
      "3-4 spot colors max",
    ],
    seoKeywords: [
      "jamaican sound system shirt",
      "vintage reggae tee",
      "sound system streetwear",
      "dub culture apparel",
      "reggae heritage shirt",
    ],
    targetAudience: "Reggae/dub heritage fans, sound system culture enthusiasts, 25-45, collectors of vintage-look streetwear.",
    suggestedPricing: "$34-40",
    crossSellRecommendations: ["dub-plate-collection", "vinyl-culture", "bass-culture"],
    preferredStyleIds: ["vintage-jamaican-sound-system", "distressed-screen-print", "halftone-vintage"],
    keywords: ["sound system", "jamaican sound system", "speaker stack", "vintage sound", "dub", "reggae heritage"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "dancehall-kings",
    name: "Dancehall Kings",
    description: "High-energy dancehall flyer aesthetics celebrating the selectors, MCs, and dancers who rule the floor.",
    visualIdentity: "Oversaturated flyer poster energy: sunburst rays, glossy highlights, bold hero figures.",
    colorPalette: {
      description: "Hot pink, electric yellow, deep purple night-sky.",
      swatches: ["hot pink", "electric yellow", "deep purple", "gold foil"],
    },
    typographyStyle: "explosive hand-lettered flyer-headline energy, illustrated rather than literal",
    assetPreferences: ["microphone", "speaker_stack"],
    designRules: [
      "hero figure dominant in the upper two-thirds",
      "radiating sunburst background",
      "cel-shaded rim lighting",
      "no literal readable event text",
    ],
    seoKeywords: ["dancehall shirt", "dancehall queen tee", "jamaican party shirt", "carnival streetwear", "dancehall flyer tee"],
    targetAudience: "Dancehall/party culture fans, 18-35, festival and nightlife crowd.",
    suggestedPricing: "$32-38",
    crossSellRecommendations: ["sound-clash-series", "carnival-energy", "festival-season"],
    preferredStyleIds: ["dancehall-flyer", "psychedelic-music-poster"],
    keywords: ["dancehall", "dancehall king", "dancehall queen", "selector", "mc", "party culture"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "carnival-energy",
    name: "Carnival Energy",
    description: "The feathers, colors, and motion of Caribbean carnival season — mas bands, soca, and street parade energy.",
    visualIdentity: "Maximalist parade energy: layered color, motion, feather and costume detail.",
    colorPalette: {
      description: "Hyper-saturated carnival costume colors.",
      swatches: ["carnival magenta", "tropical teal", "sunburst orange", "royal purple"],
    },
    typographyStyle: "bold festival-poster lettering used as illustrated banners, not literal text",
    assetPreferences: ["palm_tree"],
    designRules: [
      "dynamic motion/dance pose",
      "feather and costume texture detail",
      "no real event dates or brand names",
    ],
    seoKeywords: ["carnival shirt", "soca streetwear", "caribbean carnival tee", "mas band shirt", "trinidad carnival apparel"],
    targetAudience: "Carnival/soca fans, 18-40, festival travelers.",
    suggestedPricing: "$30-36",
    crossSellRecommendations: ["island-vibes", "festival-season", "tropical-lifestyle"],
    preferredStyleIds: ["dancehall-flyer", "psychedelic-music-poster", "hand-illustrated"],
    keywords: ["carnival", "soca", "mas band", "carnival parade", "trinidad carnival"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "caribbean-flags",
    name: "Caribbean Flags",
    description:
      "Original island-pride patterns and wave motifs inspired by Caribbean color identity — never a literal " +
      "government flag, always original art.",
    visualIdentity: "Flat geometric island-color patterns and wave motifs, bold and graphic.",
    colorPalette: {
      description:
        "Each release draws from a specific island's color identity, always recombined into an original " +
        "abstract pattern, never a literal flag reproduction.",
      swatches: ["varies per release — island-inspired color combinations"],
    },
    typographyStyle: "minimal to none — the pattern is the identity",
    assetPreferences: ["palm_tree"],
    designRules: [
      "never reproduce an actual government flag design, seal, or emblem",
      "abstract wave/sun/star motifs only",
      "original pattern work, no direct flag copying",
    ],
    seoKeywords: ["caribbean pride shirt", "island flag colors tee", "caribbean streetwear", "island pride apparel"],
    targetAudience: "Caribbean diaspora, island-pride shoppers, 20-45.",
    suggestedPricing: "$28-34",
    crossSellRecommendations: ["island-vibes", "caribbean-cities", "tropical-lifestyle"],
    preferredStyleIds: ["retro-tourism-poster", "premium-typography", "premium-streetwear"],
    keywords: ["caribbean pride", "island pride", "caribbean colors", "island flag"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "reggae-legends-inspired",
    name: "Reggae Legends Inspired",
    description:
      "Designs that evoke the spirit, era, and iconography of classic reggae — inspired by the music and " +
      "culture, never a real person's likeness.",
    visualIdentity:
      "Vintage concert-poster illustration evoking the golden era of reggae without depicting any real, " +
      "identifiable individual.",
    colorPalette: {
      description: "Rich earthy vintage letterpress inks.",
      swatches: ["burnt sienna", "deep teal", "aged gold", "cream paper"],
    },
    typographyStyle: "ornate vintage playbill lettering, illustrated banner shapes",
    assetPreferences: ["microphone", "turntable"],
    designRules: [
      "NEVER depict a real, identifiable person or celebrity likeness",
      "evoke the era/spirit generically (silhouettes, symbolic imagery, lion/crown/vinyl motifs) instead of a specific face",
      "no copyrighted lyrics or trademarked slogans",
    ],
    seoKeywords: ["reggae legend shirt", "roots reggae tee", "classic reggae streetwear", "reggae tribute apparel"],
    targetAudience: "Reggae music fans, 25-55, roots/culture-driven shoppers.",
    suggestedPricing: "$32-40",
    crossSellRecommendations: ["vintage-jamaican-sound-systems", "vinyl-culture", "dub-plate-collection"],
    preferredStyleIds: ["vintage-concert-poster", "tattoo-illustration"],
    keywords: ["reggae legend", "roots reggae", "classic reggae", "reggae tribute"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "vinyl-culture",
    name: "Vinyl Culture",
    description: "For collectors and selectors — vinyl records, turntables, and the ritual of the needle drop.",
    visualIdentity: "Halftone comic-print vinyl illustration, dot-shaded records and turntables.",
    colorPalette: {
      description: "Classic 2-3 color comic-print separation.",
      swatches: ["Ben-Day red", "process blue", "warm cream", "ink black"],
    },
    typographyStyle: "none — purely illustrative",
    assetPreferences: ["turntable"],
    designRules: [
      "visible halftone dot shading",
      "record grooves and label detail rendered accurately",
      "clean white or single-color negative space",
    ],
    seoKeywords: ["vinyl record shirt", "turntable tee", "dj streetwear", "vinyl collector apparel"],
    targetAudience: "Vinyl collectors, DJs, crate-diggers, 20-45.",
    suggestedPricing: "$28-34",
    crossSellRecommendations: ["dj-culture", "dub-plate-collection", "bass-culture"],
    preferredStyleIds: ["halftone-vintage", "blueprint-technical"],
    keywords: ["vinyl", "turntable", "record collector", "crate digger", "needle drop"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "dub-plate-collection",
    name: "Dub Plate Collection",
    description: "One-of-one dub plate culture — acetate records, exclusive rhythms, sound system bragging rights.",
    visualIdentity: "Vintage Jamaican sound system aesthetic focused specifically on the dub plate/acetate object itself.",
    colorPalette: {
      description: "Sun-faded reds, golds, and greens with vintage cream.",
      swatches: ["sun-faded gold", "faded red", "deep reggae green", "vintage cream"],
    },
    typographyStyle: "hand-painted sound-system signage lettering",
    assetPreferences: ["turntable", "speaker_stack"],
    designRules: [
      "depict the acetate/dub plate itself as a specific, detailed object",
      "vintage halftone print grain",
      "3-4 spot colors",
    ],
    seoKeywords: ["dub plate shirt", "dub culture tee", "acetate record apparel", "sound system exclusive shirt"],
    targetAudience: "Deep dub/sound-system culture enthusiasts, 25-50.",
    suggestedPricing: "$34-40",
    crossSellRecommendations: ["vintage-jamaican-sound-systems", "vinyl-culture", "bass-culture"],
    preferredStyleIds: ["vintage-jamaican-sound-system", "halftone-vintage"],
    keywords: ["dub plate", "dub culture", "acetate", "exclusive rhythm", "sound system exclusive"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "caribbean-cities",
    name: "Caribbean Cities",
    description:
      "A love letter to Caribbean cities and coastlines — Kingston, Port of Spain, Bridgetown, Nassau and " +
      "beyond, in mid-century travel-poster style.",
    visualIdentity: "Flat mid-century travel-poster illustration, geometric skylines and coastlines.",
    colorPalette: {
      description: "Sun-bleached mid-century travel palette.",
      swatches: ["burnt orange", "warm coral", "deep teal ocean", "cream sky"],
    },
    typographyStyle: "none — imagery conveys the destination",
    assetPreferences: ["palm_tree"],
    designRules: [
      "flat geometric skyline/landmark silhouettes, not photoreal",
      "no literal city-name text baked into the art",
      "one hero landmark or skyline per city",
    ],
    seoKeywords: ["caribbean city shirt", "kingston jamaica tee", "caribbean travel apparel", "island city streetwear"],
    targetAudience: "Caribbean travelers and diaspora with city pride, 22-50.",
    suggestedPricing: "$28-34",
    crossSellRecommendations: ["caribbean-flags", "tropical-lifestyle", "island-vibes"],
    preferredStyleIds: ["retro-tourism-poster"],
    keywords: ["caribbean city", "kingston", "port of spain", "caribbean coastline", "island city"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "sound-clash-series",
    name: "Sound Clash Series",
    description: "Rival sound systems facing off — the competitive, high-stakes energy of a real sound clash night.",
    visualIdentity: "Dramatic diagonal composition, two forces in tension, dancehall flyer energy.",
    colorPalette: {
      description: "High-saturation dancehall flyer colors.",
      swatches: ["hot pink", "electric yellow", "deep purple", "gold foil"],
    },
    typographyStyle: "explosive illustrated flyer energy, no literal text",
    assetPreferences: ["speaker_stack"],
    designRules: [
      "two opposing elements in diagonal tension",
      "sunburst/energy-burst background",
      "no literal event branding",
    ],
    seoKeywords: ["sound clash shirt", "sound system battle tee", "dancehall competition apparel"],
    targetAudience: "Sound system culture fans who follow clash culture, 22-45.",
    suggestedPricing: "$32-38",
    crossSellRecommendations: ["dancehall-kings", "vintage-jamaican-sound-systems", "bass-culture"],
    preferredStyleIds: ["vintage-jamaican-sound-system", "dancehall-flyer", "comic-cover"],
    keywords: ["sound clash", "sound system battle", "clash culture", "rival sound system"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "island-vibes",
    name: "Island Vibes",
    description: "Laid-back beach and island-life energy — hammocks, sunsets, and slow living.",
    visualIdentity: "Flat mid-century travel-poster calm: horizon bands, palm silhouettes, warm light.",
    colorPalette: {
      description: "Warm sunset travel palette.",
      swatches: ["burnt orange", "coral", "teal ocean", "cream"],
    },
    typographyStyle: "none — purely illustrative",
    assetPreferences: ["palm_tree"],
    designRules: ["horizontal banded landscape composition", "confident negative-space sky", "no busy detail"],
    seoKeywords: ["island vibes shirt", "tropical beach tee", "laid back island apparel", "beach lifestyle streetwear"],
    targetAudience: "Beach/resort lifestyle shoppers, 20-55.",
    suggestedPricing: "$28-34",
    crossSellRecommendations: ["tropical-lifestyle", "caribbean-cities", "caribbean-food"],
    preferredStyleIds: ["retro-tourism-poster"],
    keywords: ["island vibes", "beach life", "tropical getaway", "island getaway"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "caribbean-food",
    name: "Caribbean Food",
    description: "A celebration of Caribbean cuisine and flavor — jerk, plantain, mango, and market energy.",
    visualIdentity: "Bold hand-illustrated food iconography with warm, appetizing color.",
    colorPalette: {
      description: "Warm spice-market palette.",
      swatches: ["scotch bonnet red", "mango orange", "plantain green", "deep brown"],
    },
    typographyStyle: "hand-lettered market-sign energy for any accompanying wordmark",
    assetPreferences: ["palm_tree"],
    designRules: [
      "hero food item rendered with real texture detail, not generic clipart",
      "warm, appetizing lighting",
      "no real restaurant or brand names",
    ],
    seoKeywords: ["caribbean food shirt", "jerk chicken tee", "caribbean cuisine apparel", "island food streetwear"],
    targetAudience: "Caribbean food lovers and diaspora, 20-50.",
    suggestedPricing: "$28-34",
    crossSellRecommendations: ["tropical-lifestyle", "island-vibes", "caribbean-cities"],
    preferredStyleIds: ["hand-illustrated", "halftone-vintage", "comic-cover"],
    keywords: ["caribbean food", "jerk chicken", "caribbean cuisine", "island food", "caribbean market"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "tropical-lifestyle",
    name: "Tropical Lifestyle",
    description: "An everyday-premium tropical aesthetic — palm motifs and island color reduced to elevated, wearable minimalism.",
    visualIdentity: "Restrained, elevated tropical iconography — quiet luxury meets island identity.",
    colorPalette: {
      description: "Monochrome or near-monochrome with one tropical accent.",
      swatches: ["ink black", "bone white", "one accent (palm green or sunset coral)"],
    },
    typographyStyle: "refined, small-scale wordmark only if essential",
    assetPreferences: ["palm_tree"],
    designRules: [
      "single-line or reduced geometric palm/wave mark",
      "extreme restraint, generous negative space",
      "never busy or maximalist",
    ],
    seoKeywords: ["tropical minimalist shirt", "premium island streetwear", "elevated tropical tee", "resort minimal apparel"],
    targetAudience: "Premium/resort-wear shoppers, 25-50, elevated taste.",
    suggestedPricing: "$40-55",
    crossSellRecommendations: ["island-vibes", "caribbean-flags", "caribbean-cities"],
    preferredStyleIds: ["luxury-minimal"],
    keywords: ["tropical minimal", "resort wear", "premium island", "elevated tropical"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "festival-season",
    name: "Festival Season",
    description: "Music festival energy across the Caribbean calendar — main stage lights, crowd energy, festival-poster maximalism.",
    visualIdentity: "Maximalist liquid-light psychedelic poster energy.",
    colorPalette: {
      description: "Hyper-saturated 1960s-70s psychedelic color-wheel.",
      swatches: ["hot magenta", "acid green", "electric orange", "deep violet"],
    },
    typographyStyle: "none — swirling illustrated forms replace lettering",
    assetPreferences: ["speaker_stack"],
    designRules: ["circular/mandala radial composition", "full-bleed maximalist coverage", "no real festival or brand names"],
    seoKeywords: ["festival shirt", "music festival tee", "caribbean festival apparel", "festival season streetwear"],
    targetAudience: "Festival-goers, 18-35.",
    suggestedPricing: "$30-36",
    crossSellRecommendations: ["carnival-energy", "dj-culture", "dancehall-kings"],
    preferredStyleIds: ["psychedelic-music-poster", "dancehall-flyer"],
    keywords: ["music festival", "festival season", "festival crowd", "main stage"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "dj-culture",
    name: "DJ Culture",
    description: "Turntablism and selector culture — headphones, decks, and the craft of reading a crowd.",
    visualIdentity: "Bold streetwear-scale DJ iconography, confident and graphic.",
    colorPalette: {
      description: "Restrained 2-3 color streetwear palette.",
      swatches: ["off-black", "bone white", "one saturated accent"],
    },
    typographyStyle: "condensed sans-serif brand-mark lettering if needed",
    assetPreferences: ["turntable", "microphone"],
    designRules: ["single dominant focal element", "screen-print-plate thinking, 2-3 spot colors", "no busy background"],
    seoKeywords: ["dj shirt", "turntablism tee", "dj streetwear", "selector culture apparel"],
    targetAudience: "DJs, selectors, electronic/dancehall music fans, 20-40.",
    suggestedPricing: "$32-42",
    crossSellRecommendations: ["vinyl-culture", "bass-culture", "festival-season"],
    preferredStyleIds: ["premium-streetwear", "blueprint-technical"],
    keywords: ["dj culture", "turntablism", "selector", "dj life"],
    minProducts: 10,
    maxProducts: 25,
  },
  {
    id: "bass-culture",
    name: "Bass Culture",
    description: "Heavy bass, sound system power, and the physical feeling of a rig loud enough to move your chest.",
    visualIdentity: "Bold graphic sound-wave and speaker iconography with real weight and presence.",
    colorPalette: {
      description: "Restrained streetwear palette with one loud accent.",
      swatches: ["off-black", "bone white", "rust orange or blood red accent"],
    },
    typographyStyle: "engineered grotesk wordmark, tracked out, brand-mark scale",
    assetPreferences: ["speaker_stack"],
    designRules: [
      "confident bold shapes, unbroken outlines",
      "sound-wave motifs radiating from a speaker focal point",
      "2-3 spot colors",
    ],
    seoKeywords: ["bass culture shirt", "sound system tee", "heavy bass streetwear", "subwoofer apparel"],
    targetAudience: "Bass music/sound-system fans, 18-40.",
    suggestedPricing: "$32-40",
    crossSellRecommendations: ["vintage-jamaican-sound-systems", "dub-plate-collection", "dj-culture"],
    preferredStyleIds: ["premium-streetwear", "vintage-jamaican-sound-system"],
    keywords: ["bass culture", "heavy bass", "subwoofer", "bass music"],
    minProducts: 10,
    maxProducts: 25,
  },
] as const;

/** Looks up a collection by its stable id. Returns `undefined` if no collection has that id. */
export function getCollectionById(id: string): CollectionDefinition | undefined {
  return COLLECTION_LIBRARY.find((collection) => collection.id === id);
}
