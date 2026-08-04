/**
 * The premium style library: RiddimRoom's design system, one entry per
 * style. This is the thing that replaces "one generic AI-clipart look"
 * with real art direction — each style encodes how a senior apparel
 * designer would actually brief that look (composition, palette,
 * typography, texture, print constraints, and what to avoid), not just a
 * prompt keyword.
 *
 * Adding a style #16 means appending one more `StyleDefinition` to
 * `STYLE_LIBRARY` below — nothing in ../design-director.ts needs to
 * change, since it operates generically over whatever styles this array
 * contains.
 */
import type { StyleDefinition } from "./types.ts";

export const STYLE_LIBRARY: readonly StyleDefinition[] = [
  {
    id: "premium-streetwear",
    name: "Premium Streetwear",
    designPhilosophy:
      "Elevated streetwear that reads as a real fashion label, not fan art — restraint, confident " +
      "negative space, and a single strong focal graphic treated like a logo mark rather than a poster.",
    visualCharacteristics: [
      "bold single- or two-color linework",
      "a strong, instantly-readable silhouette",
      "subtle grain texture used sparingly, never as a gimmick",
      "no gradient soup — flat, confident shapes",
    ],
    compositionRules: [
      "off-center or asymmetric placement rather than dead-center",
      "chest-left or full-front badge scale, never oversized poster scale",
      "generous margin around the mark",
      "one dominant focal element with at most one or two supporting details",
    ],
    colorPalette: {
      description: "Restrained 2-3 color palette: one dominant ink color and one sharp accent.",
      swatches: ["off-black", "bone white", "one saturated accent (rust orange, cobalt, or blood red)"],
    },
    typography: [
      "if a wordmark is present: condensed sans-serif or engineered grotesk, tracked out",
      "logotype scale should feel like a brand mark, not a poster headline",
    ],
    textureGuidance: [
      "fine halftone grain or subtle paper-noise texture in shadow areas only",
      "never let texture cover the whole graphic",
    ],
    illustrationDirection: [
      "flat bold shapes with confident, unbroken outlines",
      "think in screen-print plates: imagine each color as one separate ink layer",
    ],
    printRecommendations: [
      "2-3 spot colors maximum",
      "clean vector-like edges",
      "avoid soft gradients that will not hold on a screen press",
    ],
    negativePrompts: [
      "no busy clipart",
      "no default AI centered-icon-on-white-circle look",
      "no rainbow gradients",
      "no drop shadows",
      "no stock-photo realism",
      "no visible watermark or signature",
    ],
    bestNiches: [
      "streetwear",
      "urban fashion",
      "minimal logo",
      "brand mark",
      "hype",
      "sneaker culture",
      "skate brand",
    ],
    shirtColorCompatibility: ["black", "white", "heather grey", "sand"],
    complexityTarget: "moderate",
    commercialPositioning: "$32-42 premium streetwear price point, positioned against Culture Kings / Hypland-tier drops.",
  },
  {
    id: "vintage-jamaican-sound-system",
    name: "Vintage Jamaican Sound System",
    designPhilosophy:
      "A love letter to reggae sound system culture — the stack itself is the hero, drawn with the " +
      "reverence of vintage Jamaican dancehall poster art, never a generic speaker clipart icon.",
    visualCharacteristics: [
      "towering speaker box stacks (scoops, horns, bass bins) with specific hardware detail: corner " +
        "protectors, carrying handles, grille-cloth texture, hand-painted sound-crew branding plates",
      "warm, sun-bleached color grading",
      "subtle print-registration misalignment for period authenticity",
    ],
    compositionRules: [
      "low, dramatic camera angle looking up at the stack — a hero shot, not a catalog photo",
      "stack anchored in the bottom third with poster-like breathing room above",
      "optional heat-shimmer or sound-wave lines radiating from the horns",
    ],
    colorPalette: {
      description:
        "Rasta-adjacent but tasteful — sun-faded reds, golds, and greens paired with vintage cream and " +
        "charcoal. Never neon, never a literal flag palette.",
      swatches: [
        "sun-faded gold #D9A441",
        "faded red #B5443A",
        "deep reggae green #2F5233",
        "vintage cream #EFE3C8",
        "charcoal ink #26221E",
      ],
    },
    typography: [
      "hand-painted sound-system signage lettering for any crew name — thick brush-script or chunky " +
        "vintage western-style letters, always subtly imperfect, never a clean digital font",
    ],
    textureGuidance: [
      "vintage halftone print grain",
      "sun-faded paper texture",
      "slight ink bleed at edges",
      "dust and scratch texture confined to shadow areas",
    ],
    illustrationDirection: [
      "screen-print poster illustration, not photoreal and not a flat vector clipart speaker icon",
      "render like a 1970s-80s Jamaican dancehall flyer artist depicting a real, specific rig",
    ],
    printRecommendations: [
      "3-4 spot colors",
      "strong black keyline to hold detail at small print sizes",
      "halftone shading instead of smooth gradients",
    ],
    negativePrompts: [
      "no generic boombox clipart",
      "no single simple speaker icon",
      "no modern PA/DJ equipment",
      "no cartoon smiley speakers",
      "no rainbow reggae stereotype clipart",
      "no Rastafarian flag or government flag imagery",
    ],
    bestNiches: [
      "jamaican sound system",
      "sound system",
      "dancehall",
      "reggae",
      "dub",
      "bass culture",
      "speaker stack",
      "sound clash",
      "selector",
      "vinyl",
      "riddim",
    ],
    shirtColorCompatibility: ["black", "vintage charcoal", "cream", "faded red"],
    complexityTarget: "high",
    commercialPositioning: "$34-40 heritage/culture graphic tee — the flagship RiddimRoom aesthetic.",
  },
  {
    id: "dancehall-flyer",
    name: "Dancehall Flyer",
    designPhilosophy:
      "Recreate the electric, oversaturated energy of a hand-lettered 1990s Jamaican dancehall event " +
      "flyer — the shirt itself is the flyer.",
    visualCharacteristics: [
      "chaotic-but-balanced flyer-style layout with one dominant hero figure or scene",
      "bold event-poster energy",
      "sunburst or starburst background elements",
      "glossy highlight accents",
    ],
    compositionRules: [
      "poster/flyer composition: hero image dominant in the upper two-thirds",
      "radiating starburst or rays behind the focal subject",
      "layered depth — background rays, midground subject, foreground light accents",
    ],
    colorPalette: {
      description: "High-saturation dancehall flyer colors — hot pink, electric yellow, and deep purple night-sky tones.",
      swatches: ["hot pink #E8368F", "electric yellow #F5C518", "deep purple #3C1361", "gold foil accent #E0A526"],
    },
    typography: [
      "no literal readable text — the illustrated forms (rays, banner shapes) should evoke explosive " +
        "hand-lettered flyer-headline energy without actually spelling anything out",
    ],
    textureGuidance: ["glossy print-sheen highlights", "subtle grain", "sharp rim-light edges on the hero subject"],
    illustrationDirection: [
      "bold cel-shaded illustration with strong rim lighting, poster-art rendering",
      "not photoreal, not flat corporate vector",
    ],
    printRecommendations: [
      "best as a full-color DTG print given the sunburst gradient",
      "keep dark background areas solid ink rather than gradient-heavy where possible",
    ],
    negativePrompts: [
      "no literal readable event date or venue text",
      "no generic party clipart",
      "no stock confetti PNG look",
      "no washed-out pastel colors",
    ],
    bestNiches: ["dancehall flyer", "sound clash", "dance", "jamaican dance", "party culture", "carnival night", "soca"],
    shirtColorCompatibility: ["black", "deep purple", "white"],
    complexityTarget: "very-high",
    commercialPositioning: "$32-38 event-culture statement piece.",
  },
  {
    id: "luxury-minimal",
    name: "Luxury Minimal",
    designPhilosophy: "Say less. One perfect line, enormous negative space, the confidence of a fashion-house monogram.",
    visualCharacteristics: [
      "a single-line or single-shape mark",
      "extreme restraint",
      "generous breathing room",
      "museum-quality precision",
    ],
    compositionRules: [
      "small-scale placement — left chest or centered small on an otherwise empty field",
      "never fills more than roughly 20-25% of the print area",
      "perfectly balanced, no visual clutter",
    ],
    colorPalette: {
      description: "Monochrome or near-monochrome — one ink color only, tonal sophistication over variety.",
      swatches: ["ink black", "bone white", "warm taupe", "muted gold foil (optional single accent)"],
    },
    typography: [
      "if essential: refined serif or high-end sans wordmark only, kerned wide",
      "extremely small scale — never a headline",
    ],
    textureGuidance: ["none — flat, matte, precise; texture reads as sloppy in this style"],
    illustrationDirection: [
      "a single continuous line-art or a reduced geometric abstraction of the subject",
      "editorial fashion-house restraint",
    ],
    printRecommendations: ["single-color screen print", "extremely clean edges", "no halftone, no gradient"],
    negativePrompts: [
      "no clutter",
      "no more than one focal element",
      "no bright saturated colors",
      "no busy background",
      "no multiple competing shapes",
    ],
    bestNiches: ["luxury", "minimal", "high fashion", "monogram", "quiet luxury", "editorial"],
    shirtColorCompatibility: ["white", "black", "sand", "stone grey"],
    complexityTarget: "moderate",
    commercialPositioning: "$45-65 elevated minimal basics, competing with quiet-luxury resale-grade tees.",
  },
  {
    id: "graffiti-urban",
    name: "Graffiti / Urban",
    designPhilosophy: "Raw wall-writing energy — a piece that looks like it was actually bombed on a subway car, not a font filter.",
    visualCharacteristics: [
      "wildstyle interlocking letterforms or throw-up character work",
      "spray-can drip texture",
      "chrome/3D highlight edges",
      "spray-paint overspray halo",
    ],
    compositionRules: [
      "dynamic diagonal energy",
      "letterforms or a character breaking out of an implied frame",
      "layered background tags/marks at lower opacity for depth",
    ],
    colorPalette: {
      description: "High-contrast spray-paint palette — fluorescent accents against black outline, chrome highlights.",
      swatches: ["fluorescent orange", "electric blue", "chrome silver highlight", "flat black outline", "hot magenta accent"],
    },
    typography: ["hand-styled wildstyle or bubble-letter graffiti lettering treated as illustration, never a digital font"],
    textureGuidance: [
      "spray-paint grain",
      "drip marks",
      "overspray halo/fade at can-distance edges",
      "very subtle concrete/wall texture hint behind — never a full photo background",
    ],
    illustrationDirection: ["bold graffiti-art illustration with chrome/3D bevel highlights on letterforms, can-control confidence"],
    printRecommendations: [
      "DTG recommended for the airbrush gradient fades",
      "keep outlines in solid black for screen-print viability if needed",
    ],
    negativePrompts: [
      "no generic bubble font with no graffiti technique",
      "no readable offensive tags",
      "no photoreal brick-wall background",
      "no corporate clip-art spray-can icon",
    ],
    bestNiches: ["graffiti", "urban", "hip hop", "street art", "subway art", "bombing", "writer culture"],
    shirtColorCompatibility: ["black", "white", "charcoal"],
    complexityTarget: "very-high",
    commercialPositioning: "$30-36 street-art collector tee.",
  },
  {
    id: "distressed-screen-print",
    name: "Distressed Screen Print",
    designPhilosophy:
      "Looks like it has been through ten years and a hundred washes — worn-in authenticity from day " +
      "one, the RSVLTS/vintage-band-tee playbook.",
    visualCharacteristics: ["cracked-ink texture", "uneven ink saturation", "faded edges", "subtle intentional off-register color layers"],
    compositionRules: [
      "classic vintage-tee layout: a single graphic, chest-centered or back-centered",
      "generous surrounding negative space so the distress reads clearly",
    ],
    colorPalette: {
      description: "Washed, sun-faded tones as if the original ink has aged — never a fresh saturated color.",
      swatches: ["faded navy", "washed rust", "dusty cream", "aged black (soft, not true black)"],
    },
    typography: ["vintage collegiate or western distressed lettering, cracked and worn like a 20-year-old tee"],
    textureGuidance: [
      "heavy crack/distress texture overlay on all ink areas",
      "uneven ink coverage",
      "faded halo at edges as if worn thin",
    ],
    illustrationDirection: [
      "vintage screen-print illustration rendered as if printed decades ago and naturally aged",
      "not a crisp modern vector",
    ],
    printRecommendations: ["simulate distressed screen print via discharge-ink texture", "avoid true blacks in favor of soft aged tones"],
    negativePrompts: [
      "no crisp clean modern vector look",
      "no glossy finish",
      "no bright saturated fresh-ink colors",
      "no perfectly symmetrical printing",
    ],
    bestNiches: ["vintage tee", "band tee", "distressed", "retro", "worn-in", "thrifted look"],
    shirtColorCompatibility: ["washed black", "vintage navy", "natural/off-white"],
    complexityTarget: "moderate",
    commercialPositioning: "$30-38 vintage-wash premium tee, RSVLTS-adjacent.",
  },
  {
    id: "vintage-concert-poster",
    name: "Vintage Concert Poster",
    designPhilosophy: "If this were the poster stapled to a telephone pole for the greatest show of the summer, would you tear a strip off and keep it?",
    visualCharacteristics: [
      "bold hand-illustrated central imagery",
      "ornate decorative border elements",
      "layered vintage print texture",
      "letterpress-style ink density",
    ],
    compositionRules: [
      "classic gig-poster hierarchy: dominant illustration filling most of the frame",
      "symmetrical or framed border treatment",
      "space reserved at top/bottom as if for an (unused) event-text banner",
    ],
    colorPalette: {
      description: "Rich earthy vintage print inks, limited to 2-3 colors like a real letterpress run.",
      swatches: ["burnt sienna", "deep teal", "aged gold", "cream paper base"],
    },
    typography: ["ornate vintage playbill lettering forms used as illustrated banner shapes, not literal readable text"],
    textureGuidance: ["letterpress ink texture", "visible paper grain", "slight color misregistration between layers"],
    illustrationDirection: ["hand-drawn vintage gig-poster illustration in the tradition of classic rock/reggae concert poster art"],
    printRecommendations: ["2-3 spot color screen print", "strong keyline", "avoid photographic gradients"],
    negativePrompts: ["no modern digital gradient-mesh look", "no photo-based collage", "no glossy modern flyer style"],
    bestNiches: ["concert poster", "gig poster", "music event", "band merch", "festival"],
    shirtColorCompatibility: ["cream", "black", "faded navy"],
    complexityTarget: "high",
    commercialPositioning: "$32-40 collectible gig-poster tee.",
  },
  {
    id: "retro-tourism-poster",
    name: "Retro Tourism Poster",
    designPhilosophy: "Mid-century travel-poster optimism — the destination as an idealized, sun-drenched icon, in the tradition of vintage airline and railway posters.",
    visualCharacteristics: [
      "simplified geometric landscape shapes",
      "flat sunset color bands",
      "one bold iconic landmark or scene",
      "confident negative-space sky",
    ],
    compositionRules: [
      "horizontal banded landscape composition — sky, midground, and foreground as flat color bands",
      "one hero landmark or scene centered in the lower two-thirds",
    ],
    colorPalette: {
      description: "Sun-bleached mid-century travel palette — warm sunset built from flat bands, not smooth gradients.",
      swatches: ["burnt orange", "warm coral", "deep teal ocean", "cream sky", "palm-frond green"],
    },
    typography: ["none — destination conveyed purely through imagery, no literal destination text"],
    textureGuidance: ["subtle fine-grain paper texture", "halftone dot shading confined to shadow bands"],
    illustrationDirection: [
      "flat mid-century travel-poster illustration, geometric simplification in the tradition of vintage " +
        "Pan Am / railway poster art",
      "confident flat color shapes",
    ],
    printRecommendations: ["flat spot-color bands print cleanly via screen print", "avoid smooth photographic gradients"],
    negativePrompts: ["no photoreal landscape", "no modern flat-icon clipart look", "no busy detail-heavy scene"],
    bestNiches: ["travel", "tourism", "island getaway", "beach", "destination", "vacation"],
    shirtColorCompatibility: ["cream", "white", "sky blue"],
    complexityTarget: "moderate",
    commercialPositioning: "$28-34 resort/travel gift-shop premium tee.",
  },
  {
    id: "tattoo-illustration",
    name: "Tattoo Illustration",
    designPhilosophy: "Drawn like flash off a tattoo shop's wall — bold enough to hold up as a real tattoo, not just a shirt graphic.",
    visualCharacteristics: [
      "thick confident black outlines with varied line weight",
      "traditional tattoo shading: solid black plus limited color fill",
      "classic tattoo motifs and framing (banners, roses, daggers) reinterpreted per subject",
    ],
    compositionRules: [
      "a single strong central image with a bold unbroken outline",
      "optional banner or scroll element wrapping the base of the composition",
      "balanced symmetry typical of flash sheets",
    ],
    colorPalette: {
      description: "Classic American traditional tattoo palette — limited, saturated, bold.",
      swatches: ["tattoo red #C41E3A", "traditional green #2E5E3C", "faded gold-yellow", "deep black"],
    },
    typography: ["if a banner is present: traditional tattoo banner script, illustrated rather than a literal readable brand"],
    textureGuidance: [
      "minimal — traditional tattoo art is flat and bold",
      "avoid heavy texture noise",
      "subtle shading gradient only within colored fills if needed",
    ],
    illustrationDirection: ["American traditional or neo-traditional tattoo flash illustration, bold unbroken linework, limited color fills"],
    printRecommendations: ["thick outlines hold extremely well at small print sizes and on screen press", "keep color count to 3-4"],
    negativePrompts: [
      "no thin fragile linework",
      "no photoreal shading",
      "no fine-line minimalist tattoo style unless explicitly requested",
      "no gore or explicit imagery",
    ],
    bestNiches: ["tattoo", "traditional tattoo", "flash art", "biker culture", "rebel", "old school ink"],
    shirtColorCompatibility: ["black", "white", "vintage cream"],
    complexityTarget: "high",
    commercialPositioning: "$30-36 tattoo-culture crossover tee.",
  },
  {
    id: "halftone-vintage",
    name: "Halftone Vintage",
    designPhilosophy: "Old comic-print halftone dots doing all the shading work — a graphic that looks like it was pulled from a 1960s pulp print run.",
    visualCharacteristics: [
      "visible halftone dot shading throughout",
      "slight color-plate misregistration",
      "limited flat color layered over dot-shaded value structure",
    ],
    compositionRules: [
      "bold central subject with halftone dots providing all mid-tone/shadow value",
      "clean white or single-color negative space around the subject",
    ],
    colorPalette: {
      description: "Classic 2-3 color comic-print separation — one line color, one dot-shade color, one flat spot color.",
      swatches: ["Ben-Day red", "process-cyan-adjacent blue", "warm cream paper", "ink black outline"],
    },
    typography: ["none, unless a small vintage comic-caption-style accent is needed — always illustrated, never literal type"],
    textureGuidance: ["visible halftone dot pattern as the primary shading technique", "slight print misregistration between color layers"],
    illustrationDirection: ["vintage pulp/comic print illustration built from halftone dot gradients rather than smooth shading"],
    printRecommendations: ["translates directly to screen-print halftone separations", "keep dot scale consistent for an authentic vintage-print feel"],
    negativePrompts: ["no smooth airbrush gradients", "no modern digital soft shadow", "no photoreal rendering"],
    bestNiches: ["comic", "pulp", "vintage print", "pop art adjacent", "retro print"],
    shirtColorCompatibility: ["cream", "white", "black"],
    complexityTarget: "high",
    commercialPositioning: "$28-34 vintage-print collector tee.",
  },
  {
    id: "comic-cover",
    name: "Comic Cover",
    designPhilosophy: "The hero shot off the cover of an issue #1 — dynamic action energy frozen mid-motion, ready to sell off the newsstand.",
    visualCharacteristics: [
      "a dynamic action pose",
      "dramatic foreshortening/perspective",
      "bold ink outlines with cross-hatch shading",
      "speed-line or impact energy behind the subject",
    ],
    compositionRules: [
      "diagonal dynamic composition",
      "the subject breaking the implied panel edge for energy",
      "radiating speed lines or an energy burst behind the focal figure",
    ],
    colorPalette: {
      description: "Bold saturated comic-ink palette with strong primary-color contrast.",
      swatches: ["comic red", "hero blue", "sunburst yellow", "deep ink black"],
    },
    typography: ["none — energy is conveyed through illustrated motion lines rather than literal cover-logo text"],
    textureGuidance: ["cross-hatch and spot-blot ink shading", "halftone accents in shadow", "crisp inked outlines"],
    illustrationDirection: ["American comic-cover illustration, dynamic superhero-adjacent rendering, strong inked linework"],
    printRecommendations: [
      "keep fine cross-hatch detail at a scale that survives screen print",
      "simplify the finest hatching for smaller print sizes",
    ],
    negativePrompts: [
      "no static front-facing pose",
      "no flat lifeless linework",
      "no photoreal rendering",
      "no copyrighted superhero likeness",
    ],
    bestNiches: ["comic", "superhero energy", "action", "pop culture adjacent", "dynamic pose"],
    shirtColorCompatibility: ["black", "white", "navy"],
    complexityTarget: "very-high",
    commercialPositioning: "$30-36 pop-culture statement tee.",
  },
  {
    id: "hand-illustrated",
    name: "Hand Illustrated",
    designPhilosophy: "Every line looks like it came from an actual pen in an actual sketchbook — warmth and craft over polish.",
    visualCharacteristics: [
      "organic hand-drawn linework with natural weight variation",
      "visible pen/ink texture",
      "loose, confident cross-hatching for shadow",
    ],
    compositionRules: [
      "naturalistic asymmetric composition",
      "the subject drawn as if observed and sketched, not engineered",
      "generous sketchbook-margin negative space",
    ],
    colorPalette: {
      description: "Warm ink-and-wash palette — mostly linework with light watercolor-style tonal washes.",
      swatches: ["sepia ink", "warm sand wash", "muted sage", "soft terracotta"],
    },
    typography: ["none, or if present: hand-lettered only, never a digital font"],
    textureGuidance: ["visible pen texture", "natural ink pooling at line ends", "light hand-applied watercolor-wash shading"],
    illustrationDirection: ["fine-art hand-drawn illustration, pen-and-ink with light wash, editorial-illustration quality"],
    printRecommendations: [
      "best as DTG to preserve fine linework and wash tonal variation",
      "simplify washes to flat tones if screen-printing",
    ],
    negativePrompts: ["no vector-perfect clean lines", "no digital airbrush look", "no symmetrical mechanical composition"],
    bestNiches: ["hand drawn", "sketchbook", "artisanal", "botanical", "naturalist", "craft"],
    shirtColorCompatibility: ["natural/off-white", "sand", "sage"],
    complexityTarget: "high",
    commercialPositioning: "$30-38 artisanal illustrated tee.",
  },
  {
    id: "psychedelic-music-poster",
    name: "Psychedelic Music Poster",
    designPhilosophy: "Fillmore-era liquid-light poster energy — melting typography-adjacent shapes, swirling color, maximalist trippy detail.",
    visualCharacteristics: [
      "swirling liquid-organic shapes",
      "warped perspective",
      "kaleidoscopic color transitions",
      "dense maximalist pattern-filled negative space",
    ],
    compositionRules: [
      "circular or mandala-influenced radial composition",
      "the subject dissolving into a swirling background pattern rather than isolated on empty space",
      "full-bleed maximalist coverage",
    ],
    colorPalette: {
      description: "Hyper-saturated 1960s-70s psychedelic color-wheel palette.",
      swatches: ["hot magenta", "acid green", "electric orange", "deep violet", "sunflower yellow"],
    },
    typography: ["none — swirling illustrated forms replace literal lettering entirely"],
    textureGuidance: [
      "smooth liquid-gradient color transitions — the one style here where gradients are the point, not the enemy",
      "fine linework detail within larger shapes",
    ],
    illustrationDirection: ["1960s-70s psychedelic concert-poster illustration, liquid-light-show inspired, maximalist detail"],
    printRecommendations: ["DTG strongly recommended given the gradient-heavy palette", "not screen-print friendly without major color reduction"],
    negativePrompts: ["no flat minimal composition", "no restrained color", "no empty negative space", "no rigid geometric grid"],
    bestNiches: ["psychedelic", "jam band", "60s poster", "trippy", "music festival"],
    shirtColorCompatibility: ["black", "white"],
    complexityTarget: "very-high",
    commercialPositioning: "$30-36 festival/collector statement tee.",
  },
  {
    id: "blueprint-technical",
    name: "Blueprint / Technical Illustration",
    designPhilosophy: "Presented like an engineering schematic or patent drawing — precise, diagrammatic, quietly nerdy-cool.",
    visualCharacteristics: [
      "fine single-weight line diagram style",
      "exploded-view or cutaway detailing",
      "small decorative annotation-style tick marks and dimension lines",
      "grid/graph-paper background",
    ],
    compositionRules: [
      "centered technical-diagram layout",
      "the subject rendered as if from an orthographic/isometric technical drawing",
      "thin dimension-line accents framing the subject",
    ],
    colorPalette: {
      description: "Classic blueprint palette, cyanotype-inspired — one ink color on a toned ground.",
      swatches: ["blueprint white line", "cyanotype blue ground #1B3A5C", "or inverted: white ground with navy line"],
    },
    typography: ["none — any annotation marks are decorative tick/dimension lines, never literal readable spec text"],
    textureGuidance: [
      "fine grid/graph-paper texture in the background",
      "uniform thin line weight throughout",
      "subtle paper grain in the ground color",
    ],
    illustrationDirection: ["technical/patent-drawing illustration style, isometric or orthographic rendering of the subject as a mechanical schematic"],
    printRecommendations: ["single-color screen print translates perfectly — it is already a one-ink concept", "extremely clean edges required"],
    negativePrompts: ["no color beyond the two-tone ground/line palette", "no shading beyond line hatching", "no photoreal rendering", "no literal readable measurement text"],
    bestNiches: ["technical", "blueprint", "engineering", "schematic", "nerdy niche hobbies", "gearhead"],
    shirtColorCompatibility: ["navy", "white", "black"],
    complexityTarget: "moderate",
    commercialPositioning: "$28-34 niche-hobby technical tee.",
  },
  {
    id: "premium-typography",
    name: "Premium Typography",
    designPhilosophy: "The words ARE the design — custom lettering treated with the same craft as a logotype, not a default font dropped on a shirt.",
    visualCharacteristics: [
      "custom-drawn or heavily customized lettering with considered ligatures/flourishes",
      "letterforms as the dominant, often only, visual element",
      "thoughtful positive/negative space within the letters themselves",
    ],
    compositionRules: [
      "typography-dominant layout — the lettering fills the composition as both subject and graphic",
      "an optional small supporting icon integrated into a letterform rather than floating separately",
    ],
    colorPalette: {
      description: "Confident 1-2 color palette so the letterforms read instantly.",
      swatches: ["ink black", "bone white", "single bold accent (burnt orange or cobalt)"],
    },
    typography: [
      "the entire deliverable: custom hand-lettering or heavily modified display type with intentional " +
        "stroke-weight contrast, condensed or expanded to fit apparel scale, treated as illustration rather " +
        "than a stock font applied as-is",
    ],
    textureGuidance: ["minimal, flat fills", "a very subtle grain is acceptable but must never obscure letterform clarity"],
    illustrationDirection: ["lettering-as-illustration, custom type-design thinking rather than a font-picker approach"],
    printRecommendations: ["1-2 color screen print", "extremely crisp edges required since legibility is the whole point"],
    negativePrompts: [
      "no default/generic font look",
      "no low-contrast hard-to-read lettering",
      "no competing secondary graphic stealing focus from the type",
    ],
    bestNiches: ["typography", "wordmark", "quote", "statement tee", "lettering"],
    shirtColorCompatibility: ["black", "white", "sand"],
    complexityTarget: "moderate",
    commercialPositioning: "$28-34 statement-tee typography line.",
  },
] as const;

/** Looks up a style by its stable id. Returns `undefined` if no style has that id. */
export function getStyleById(id: string): StyleDefinition | undefined {
  return STYLE_LIBRARY.find((style) => style.id === id);
}
