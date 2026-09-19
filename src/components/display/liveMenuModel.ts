import type { Category, Product, Restaurant } from '../../types/restaurant';
import {
  buildBrandTokens,
  hslToCss,
  parseColor,
  rgbToHsl,
  type Rgb,
} from '../../theme/brandTheme';

/**
 * Live Menu model — the scene graph and the restaurant's visual profile.
 * ======================================================================
 * This module is PURE: no React, no DOM, no timers. Everything the screen
 * needs to know ("which scene, for how long, in what visual language") is
 * derived here from data the restaurant already owns, which makes it unit
 * testable and keeps the presentation components free of branching logic.
 *
 * Two ideas drive it:
 *
 * 1. IDENTITY FIRST — there is no fixed template. The palette, the display
 *    face, the corner radius, the Ken Burns amplitude, the reveal stagger and
 *    even how many dishes fit on a page are all *computed* from the venue's own
 *    two brand colours plus the shape of its catalog (how many dishes carry
 *    photography, how many sections it has, what kind of venue it is). A
 *    saturated-red burger joint and a desaturated-olive fine-dining room get
 *    genuinely different screens from the same code path.
 *
 * 2. A FILM, NOT A PAGE — the menu is expressed as a timeline of scenes
 *    (intro → per category: title card → hero spotlight → priced boards →
 *    outro), which is what a signage loop actually is. The sequence is a plain
 *    array, so "what plays next" is data, and the runtime only has to advance
 *    an index.
 */

/** A category with the dishes that may be shown (unavailable ones excluded). */
export interface LiveSection {
  category: Category;
  items: Product[];
}

export type LiveSceneKind = 'intro' | 'category' | 'spotlight' | 'board' | 'outro';

export interface LiveSceneBase {
  kind: LiveSceneKind;
  /** Stable key — React remounts a scene only when this changes. */
  id: string;
  durationMs: number;
  /** 1-based position of the category on screen (intro counts as 1). */
  ordinal: number;
  /** Which section this scene belongs to (`-1` for intro/outro). */
  sectionIndex: number;
  /** Hero image for the scene, when it has one (drives Ken Burns + preload). */
  image?: string;
}

export interface IntroScene extends LiveSceneBase {
  kind: 'intro';
}

export interface CategoryScene extends LiveSceneBase {
  kind: 'category';
  section: LiveSection;
  /** Arabic-Indic friendly ordinal label, e.g. «٠١». */
  ordinalLabel: string;
}

export interface SpotlightScene extends LiveSceneBase {
  kind: 'spotlight';
  section: LiveSection;
  item: Product;
}

export interface BoardScene extends LiveSceneBase {
  kind: 'board';
  section: LiveSection;
  /** The dishes on this page. */
  items: Product[];
  /** Dishes on this page that have photography, for the rotating hero panel. */
  heroes: Product[];
  page: number;
  pageCount: number;
}

export interface OutroScene extends LiveSceneBase {
  kind: 'outro';
}

export type LiveScene =
  | IntroScene
  | CategoryScene
  | SpotlightScene
  | BoardScene
  | OutroScene;

// ---------------------------------------------------------------------------
// Timing — the motion rhythm of the loop
// ---------------------------------------------------------------------------

/**
 * Base dwell per scene kind, before the venue's `rhythm` multiplier.
 * Chosen for a screen read from 3-5 metres: long enough to scan a priced row,
 * short enough that a full menu loop finishes inside ~2 minutes.
 */
export const SCENE_BASE_MS = {
  intro: 8000,
  category: 3400,
  spotlight: 5600,
  board: 4200,
  outro: 7000,
} as const;

/** Extra dwell per priced row on a board page (reading time). */
export const BOARD_MS_PER_ITEM = 1150;
/** Boards never overstay, however long the category is. */
export const BOARD_MAX_MS = 16000;
/** Hero image cross-fade period inside a board page. */
export const HERO_CYCLE_MS = 3600;

/** Digits rendered as the big category ordinal. */
export const ordinalLabel = (n: number): string =>
  String(Math.max(1, n)).padStart(2, '0');

// ---------------------------------------------------------------------------
// Visual profile
// ---------------------------------------------------------------------------

export type DisplayFace = 'serif' | 'sans';
export type BoardLayout = 'image-led' | 'type-led';

export interface LiveVisualProfile {
  /** CSS custom properties written on the stage root (the whole theme). */
  vars: Record<string, string>;
  displayFace: DisplayFace;
  layout: BoardLayout;
  /** Dishes per board page. */
  perPage: number;
  /** Ken Burns zoom amplitude (0 = static image). */
  kenBurns: number;
  /** Stagger between successive dish reveals, ms. */
  stagger: number;
  /** Multiplier applied to every scene dwell. */
  rhythm: number;
  /** Human-readable summary of *why* the screen looks the way it does. */
  rationale: string[];
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Share of dishes that carry photography (0..1). */
export function imageCoverage(sections: LiveSection[]): number {
  const items = sections.reduce((total, section) => total + section.items.length, 0);
  if (items === 0) return 0;
  const shot = sections.reduce(
    (total, section) => total + section.items.filter((item) => !!item.image).length,
    0
  );
  return shot / items;
}

/**
 * Derive the venue's screen identity from data it already owns.
 *
 * Inputs and their effect (no venue type is hardcoded to a look — each input
 * only nudges a continuous value):
 *   primary hue        → the tint of the dark canvas and the ambient glow
 *   primary saturation → vivid brands get bolder type and tighter radius;
 *                        desaturated brands read as editorial (serif display)
 *   photography ratio  → image-led split boards vs. type-led dotted-leader
 *                        boards, and how much the images breathe
 *   business type      → pacing only (a café lingers, a bakery moves)
 *   section/item counts→ how many dishes share a page
 */
export function resolveLiveProfile(
  restaurant: Pick<
    Restaurant,
    'primaryColor' | 'accentColor' | 'businessType' | 'name'
  > | null | undefined,
  sections: LiveSection[]
): LiveVisualProfile {
  const tokens = buildBrandTokens(restaurant?.primaryColor, restaurant?.accentColor);
  const primary = (parseColor(tokens.primary) as Rgb) || { r: 212, g: 175, b: 55 };
  const accent = (parseColor(tokens.accentStrong) as Rgb) || primary;
  const primaryHsl = rgbToHsl(primary);
  const accentHsl = rgbToHsl(accent);

  const coverage = imageCoverage(sections);
  const businessType = restaurant?.businessType || 'RESTAURANT';

  // ---- Canvas: the venue's hue at near-black lightness. A red brand gets a
  // warm charcoal, a blue brand a cold one; achromatic picks stay neutral
  // instead of inventing a hue.
  const canvasSat = primaryHsl.s < 0.06 ? 0.03 : clamp(primaryHsl.s, 0.1, 0.5);
  const bg0 = hslToCss(primaryHsl.h, canvasSat, 0.045);
  const bg1 = hslToCss(primaryHsl.h, canvasSat, 0.085);
  const bg2 = hslToCss(primaryHsl.h, canvasSat * 1.1, 0.13);

  // ---- Editorial vs. energetic. A continuous score, not a switch on type.
  const editorialScore =
    (1 - clamp(primaryHsl.s, 0, 1)) * 0.5 +
    clamp(coverage, 0, 1) * 0.3 +
    (businessType === 'CAFE' ? 0.14 : businessType === 'BAKERY' ? 0.06 : 0) +
    (primaryHsl.l > 0.55 ? 0.06 : 0);
  const editorial = editorialScore >= 0.5;

  const displayFace: DisplayFace = editorial ? 'serif' : 'sans';
  const layout: BoardLayout = coverage >= 0.4 ? 'image-led' : 'type-led';

  // ---- Density: image-led boards need room for the picture column.
  const perPage = layout === 'image-led' ? (editorial ? 4 : 5) : editorial ? 7 : 8;

  // ---- Rhythm: how long the screen lingers.
  const rhythm = clamp(
    (businessType === 'CAFE' ? 1.12 : businessType === 'BAKERY' ? 0.94 : 1) *
      (editorial ? 1.08 : 0.97),
    0.85,
    1.25
  );

  const kenBurns = editorial ? 0.07 : 0.11;
  const stagger = editorial ? 95 : 68;

  const rationale = [
    `تشبع اللون الأساسي ${(primaryHsl.s * 100).toFixed(0)}% → ${editorial ? 'طابع تحريري هادئ' : 'طابع نابض'}`,
    `نسبة الأطباق المصوّرة ${(coverage * 100).toFixed(0)}% → ${layout === 'image-led' ? 'لوحات بقيادة الصورة' : 'لوحات typographic'}`,
    `إيقاع العرض ×${rhythm.toFixed(2)}`,
  ];

  const vars: Record<string, string> = {
    // Canvas & ink
    '--lm-bg-0': bg0,
    '--lm-bg-1': bg1,
    '--lm-bg-2': bg2,
    '--lm-ink': editorial ? '#F7F2E7' : '#FFFFFF',
    '--lm-ink-soft': editorial ? 'rgb(247 242 231 / 0.72)' : 'rgb(255 255 255 / 0.74)',
    '--lm-ink-faint': editorial ? 'rgb(247 242 231 / 0.46)' : 'rgb(255 255 255 / 0.48)',
    // Brand
    '--lm-brand': tokens.primaryStrong,
    '--lm-brand-rgb': tokens.primaryStrongRgb,
    '--lm-accent': tokens.accentStrong,
    '--lm-fill': tokens.fill,
    '--lm-ink-on-fill': tokens.ink,
    '--lm-glow-a': hslToCss(primaryHsl.h, clamp(primaryHsl.s, 0.25, 0.9), 0.5, 0.4),
    '--lm-glow-b': hslToCss(accentHsl.h, clamp(accentHsl.s, 0.2, 0.8), 0.55, 0.32),
    '--lm-hairline': `rgb(${tokens.primaryStrongRgb} / 0.24)`,
    '--lm-hairline-soft': `rgb(${tokens.primaryStrongRgb} / 0.12)`,
    // Shape & type
    '--lm-radius': editorial ? '10px' : '22px',
    '--lm-radius-sm': editorial ? '6px' : '14px',
    '--lm-title-face': editorial
      ? "'Cormorant Garamond', 'Tajawal', serif"
      : "'Tajawal', 'Cairo', sans-serif",
    '--lm-title-weight': editorial ? '600' : '900',
    '--lm-title-tracking': editorial ? '0.005em' : '-0.022em',
    '--lm-eyebrow-spacing': editorial ? '0.42em' : '0.26em',
    // Motion (read by CSS so the whole screen shares one rhythm)
    '--lm-ken-burns': String(1 + kenBurns),
    '--lm-stagger': `${stagger}ms`,
    '--lm-scene-in': '820ms',
  };

  return { vars, displayFace, layout, perPage, kenBurns, stagger, rhythm, rationale };
}

// ---------------------------------------------------------------------------
// Scene graph
// ---------------------------------------------------------------------------

export interface BuildScenesOptions {
  profile: LiveVisualProfile;
  /** Skip the intro/outro bumper scenes (e.g. a venue with one section). */
  includeBumpers?: boolean;
}

/**
 * Build the loop: intro → (title card → spotlight → boards) per section →
 * outro. Sections with nothing to show are already filtered out by the caller,
 * so the timeline can never contain an empty beat.
 */
export function buildLiveScenes(
  sections: LiveSection[],
  options: BuildScenesOptions
): LiveScene[] {
  const { profile, includeBumpers = true } = options;
  const scale = (kind: keyof typeof SCENE_BASE_MS) =>
    Math.round(SCENE_BASE_MS[kind] * profile.rhythm);

  if (sections.length === 0) return [];

  const scenes: LiveScene[] = [];
  const showBumpers = includeBumpers && sections.length > 0;

  if (showBumpers) {
    scenes.push({
      kind: 'intro',
      id: 'intro',
      durationMs: scale('intro'),
      ordinal: 1,
      sectionIndex: -1,
    });
  }

  sections.forEach((section, sectionIndex) => {
    const ordinal = sectionIndex + 1;
    const imaged = section.items.filter((item) => !!item.image);
    const hero =
      section.items.find((item) => item.isFeatured && item.image)?.image ||
      imaged[0]?.image ||
      undefined;

    scenes.push({
      kind: 'category',
      id: `cat-${section.category.id}`,
      durationMs: scale('category'),
      ordinal,
      sectionIndex,
      section,
      ordinalLabel: ordinalLabel(ordinal),
      image: hero,
    });

    // Brand-film beat: one dish, full frame. Only when there is photography
    // to show — a text-only menu gets no fake image moment.
    const spotlightItem =
      section.items.find((item) => item.isFeatured && item.image) || imaged[0];
    if (spotlightItem) {
      scenes.push({
        kind: 'spotlight',
        id: `spot-${spotlightItem.id}`,
        durationMs: scale('spotlight'),
        ordinal,
        sectionIndex,
        section,
        item: spotlightItem,
        image: spotlightItem.image || undefined,
      });
    }

    // Priced boards, paginated so every dish is on screen at some point.
    const perPage = Math.max(1, profile.perPage);
    const pageCount = Math.ceil(section.items.length / perPage);
    for (let page = 0; page < pageCount; page += 1) {
      const items = section.items.slice(page * perPage, page * perPage + perPage);
      const durationMs = Math.min(
        BOARD_MAX_MS,
        Math.round((SCENE_BASE_MS.board + items.length * BOARD_MS_PER_ITEM) * profile.rhythm)
      );
      scenes.push({
        kind: 'board',
        id: `board-${section.category.id}-${page}`,
        durationMs,
        ordinal,
        sectionIndex,
        section,
        items,
        heroes: items.filter((item) => !!item.image),
        page,
        pageCount,
      });
    }
  });

  if (showBumpers) {
    scenes.push({
      kind: 'outro',
      id: 'outro',
      durationMs: scale('outro'),
      ordinal: Math.max(1, sections.length),
      sectionIndex: -1,
    });
  }

  return scenes;
}

/**
 * The dishes the screen may show: available ones only, in catalog order.
 * A filmed menu must never advertise a plate the kitchen marked unavailable,
 * and a section left with nothing to show must not become an empty beat.
 */
export function buildLiveSections(
  categories: Category[],
  products: Product[]
): LiveSection[] {
  return categories
    .map((category) => ({
      category,
      items: products.filter(
        (product) => product.categoryId === category.id && product.isAvailable !== false
      ),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * The first photography a section owns — used for scene backdrops and for the
 * prefetch hint, so both read the same "does this section have a picture?"
 * answer.
 */
export function sectionBackdrop(section?: LiveSection | null): string | undefined {
  if (!section) return undefined;
  return (
    section.items.find((item) => item.isFeatured && item.image)?.image ||
    section.items.find((item) => item.image)?.image
  );
}
