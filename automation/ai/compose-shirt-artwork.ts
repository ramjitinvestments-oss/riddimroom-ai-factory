/**
 * The artwork stage: Design Director -> Asset Library (user-supplied
 * artwork only — this engine no longer generates images) -> Composition
 * Engine -> Typography Engine -> a validated, print-ready PNG. The hero
 * asset for a composition must already exist in the Asset Library,
 * registered there from artwork the user supplied; nothing in this module
 * calls an image-generation provider.
 */
import { chooseStyle, type DesignDirectorDecision } from "./design-director.ts";
import { AssetLibrary } from "./assets/asset-library.ts";
import type { AssetSearchQuery } from "./assets/asset-search.ts";
import type { AssetRecord } from "./assets/types.ts";
import { CompositionCanvas } from "./composition/composition-canvas.ts";
import { STYLE_LIBRARY } from "./styles/library.ts";
import { buildAdaptiveTextLayerRequest, type AdaptiveTypographyChoice } from "./typography/adaptive-typography.ts";
import type { TextCurve, TextOutline, TextShadow } from "./typography/types.ts";
import { PRINT_HEIGHT, PRINT_WIDTH, toPrintReadyPng } from "./prepare-print-ready.ts";
import { ConfigError, ExternalServiceError, FileOperationError, ValidationError } from "../shared/errors.ts";
import { ConsoleTransport, FileTransport } from "../shared/log-transport.ts";
import { Logger } from "../shared/logger.ts";
import { err, ok, type Result } from "../shared/result.ts";

export interface ComposeShirtArtworkRequest {
  readonly jobId: string;
  /** Feeds the Design Director (style/niche selection). */
  readonly brief: string;
  /** Which asset category to use as the hero (e.g. "speaker_stack", "microphone"). */
  readonly heroCategory: string;
}

export interface TitleTextOptions {
  readonly text: string;
  readonly fontFamily?: string;
  /**
   * Target garment color (e.g. "black", "white", "vintage charcoal" — the
   * same vocabulary as a style's `shirtColorCompatibility`). When given,
   * fill/outline/shadow are all resolved automatically for guaranteed
   * contrast against that shirt color — see ./typography/adaptive-typography.ts.
   * Any of `color`/`outline`/`shadow` explicitly set below still wins over
   * the automatic choice for that specific field.
   */
  readonly shirtColor?: string;
  /** Only relevant with `shirtColor` — overrides the default 4.5:1 minimum. */
  readonly minContrastRatio?: number;
  readonly color?: string;
  readonly outline?: TextOutline;
  readonly shadow?: TextShadow;
  readonly curve?: TextCurve;
}

export interface ComposeShirtArtworkOptions {
  readonly heroVariant?: string;
  readonly heroTags?: readonly string[];
  /** Adds a rendered (real-font) title/wordmark layer beneath the hero. Omit for hero-only compositions. */
  readonly title?: TitleTextOptions;
  /**
   * Restricts the Design Director to choosing among these Style Library
   * ids (falls back to the full library if none of them match the brief
   * — the Design Director's own documented fallback behavior). Omit to
   * consider the full Style Library, unrestricted — the original
   * behavior. Used by the Collection Engine (../collections/) to keep a
   * collection's products visually coordinated, without this module
   * needing to know anything about collections itself.
   */
  readonly allowedStyleIds?: readonly string[];
  readonly assetLibrary?: AssetLibrary;
  readonly logger?: Logger;
}

export interface ComposedArtwork {
  readonly jobId: string;
  readonly imageBuffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly decision: DesignDirectorDecision;
  readonly heroAsset: AssetRecord;
  /** Present when `title.shirtColor` was given — the resolved color/contrast decision, for reporting/audit. */
  readonly typographyContrast?: AdaptiveTypographyChoice;
}

type ComposeShirtArtworkError = ConfigError | ExternalServiceError | ValidationError | FileOperationError;

const HERO_WIDTH_RATIO = 0.7;
const HERO_HEIGHT_RATIO = 0.55;
const HERO_TOP_RATIO = 0.12;
const TITLE_Y_RATIO = 0.82;
const TITLE_MAX_WIDTH_RATIO = 0.8;

export async function composeShirtArtwork(
  request: ComposeShirtArtworkRequest,
  options: ComposeShirtArtworkOptions = {},
): Promise<Result<ComposedArtwork, ComposeShirtArtworkError>> {
  if (request.jobId.trim().length === 0) {
    return err(new ValidationError(["jobId must not be blank"]));
  }
  if (request.brief.trim().length === 0) {
    return err(new ValidationError(["brief must not be blank"]));
  }
  if (request.heroCategory.trim().length === 0) {
    return err(new ValidationError(["heroCategory must not be blank"]));
  }

  const logger =
    options.logger ??
    new Logger({ module: "automation/ai/compose-shirt-artwork", transports: [new ConsoleTransport(), new FileTransport()] });
  const jobLogger = logger.withJob(request.jobId, "compose-artwork");

  const allowedStyles =
    options.allowedStyleIds !== undefined
      ? STYLE_LIBRARY.filter((style) => options.allowedStyleIds!.includes(style.id))
      : undefined;
  const decision = chooseStyle(request.brief, allowedStyles !== undefined ? { styles: allowedStyles } : {});
  const library = options.assetLibrary ?? new AssetLibrary();

  const heroQuery: AssetSearchQuery = {
    category: request.heroCategory,
    style: decision.style.id,
    ...(options.heroVariant !== undefined ? { variant: options.heroVariant } : {}),
    ...(options.heroTags !== undefined ? { tags: options.heroTags } : {}),
  };

  const heroAsset = library.findBest(heroQuery);

  if (heroAsset === null) {
    return err(
      new ValidationError([
        `no asset found in the library for category "${request.heroCategory}" (style: ${decision.style.id}) — ` +
          "artwork is supplied by the user, not generated: register the hero asset in the Asset Library " +
          "(automation/ai/assets/) before composing this product",
      ]),
    );
  }

  const canvas = new CompositionCanvas(PRINT_WIDTH, PRINT_HEIGHT);

  const heroWidthPx = Math.round(PRINT_WIDTH * HERO_WIDTH_RATIO);
  const heroHeightPx = Math.round(PRINT_HEIGHT * HERO_HEIGHT_RATIO);
  canvas.addLayer({
    kind: "asset",
    role: "hero",
    query: heroQuery,
    xPx: Math.round((PRINT_WIDTH - heroWidthPx) / 2),
    yPx: Math.round(PRINT_HEIGHT * HERO_TOP_RATIO),
    widthPx: heroWidthPx,
    heightPx: heroHeightPx,
  });

  let typographyContrast: AdaptiveTypographyChoice | undefined;

  if (options.title !== undefined) {
    const title = options.title;
    const baseTextFields = {
      xPx: Math.round(PRINT_WIDTH / 2),
      yPx: Math.round(PRINT_HEIGHT * TITLE_Y_RATIO),
      maxWidthPx: Math.round(PRINT_WIDTH * TITLE_MAX_WIDTH_RATIO),
      textAnchor: "middle" as const,
      ...(title.fontFamily !== undefined ? { fontFamily: title.fontFamily } : {}),
      ...(title.curve !== undefined ? { curve: title.curve } : {}),
    };

    if (title.shirtColor !== undefined) {
      const adaptive = buildAdaptiveTextLayerRequest(
        { text: title.text, canvasWidthPx: PRINT_WIDTH, canvasHeightPx: PRINT_HEIGHT, ...baseTextFields },
        title.shirtColor,
        title.minContrastRatio !== undefined ? { minContrastRatio: title.minContrastRatio } : {},
      );
      if (!adaptive.ok) {
        return err(adaptive.error);
      }
      const { adaptiveTypography, ...resolvedTextLayer } = adaptive.value;
      typographyContrast = adaptiveTypography;

      canvas.addLayer({
        kind: "text",
        role: "text",
        text: {
          ...resolvedTextLayer,
          // explicit fields, if given, still win over the automatic choice
          ...(title.color !== undefined ? { color: title.color } : {}),
          ...(title.outline !== undefined ? { outline: title.outline } : {}),
          ...(title.shadow !== undefined ? { shadow: title.shadow } : {}),
        },
      });
    } else {
      canvas.addLayer({
        kind: "text",
        role: "text",
        text: {
          text: title.text,
          ...baseTextFields,
          ...(title.color !== undefined ? { color: title.color } : {}),
          ...(title.outline !== undefined ? { outline: title.outline } : {}),
          ...(title.shadow !== undefined ? { shadow: title.shadow } : {}),
        },
      });
    }
  }

  const rendered = await canvas.render(library);
  if (!rendered.ok) {
    return err(rendered.error);
  }

  const printReady = await toPrintReadyPng(rendered.value);
  if (!printReady.ok) {
    return err(printReady.error);
  }

  jobLogger.info("Composed artwork rendered", {
    metadata: { heroAssetId: heroAsset.id, style: decision.style.id },
  });

  return ok({
    jobId: request.jobId,
    imageBuffer: printReady.value.buffer,
    width: printReady.value.width,
    height: printReady.value.height,
    decision,
    heroAsset,
    ...(typographyContrast !== undefined ? { typographyContrast } : {}),
  });
}
