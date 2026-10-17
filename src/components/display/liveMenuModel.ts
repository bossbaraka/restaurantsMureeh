import type { Category, Product, Restaurant } from '../../types/restaurant';
import {
  parseColor,
  rgbToHsl,
  type Rgb,
  resolveBrandIdentity,
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
 * 1. IDENTITY FIRST — the restaurant's shared --m-* palette and Arabic font
 *    are authoritative. This module derives the board's layout, corner radius,
 *    motion, reveal rhythm and page density from brand/catalog characteristics
 *    without creating another color or font source.
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

/**
 * The automatic film plays on the BIG panels only — a TV or a computer. A phone
 * or a tablet gets the static, scrollable menu instead: the same read-only
 * board content (and the same ban on ordering), composed for a hand-held screen
 * that is read up close, at its own pace.
 *
 * Three facts about the device decide it, and each one covers a case the others
 * cannot:
 *   width        — a phone is never 1024px wide, even in landscape (≤ ~930px),
 *                  so width alone already excludes every phone;
 *   coarsePointer + touch — an iPad in landscape IS ≥ 1024px wide, but it is a
 *                  hand-held screen with a finger as its pointer, so it stays
 *                  on the static menu, exactly as specified;
 *   hasTouch     — a TV set has a large screen and NO touch input (its remote
 *                  often reports a coarse pointer!), so it must never be
 *                  demoted to the static menu for that reason alone. A
 *                  touchscreen laptop keeps its mouse/trackpad as the primary
 *                  pointer and therefore keeps the film.
 */
export const SIGNAGE_MIN_WIDTH = 1024;

export function shouldPlayFilm(viewport: {
  width: number;
  coarsePointer: boolean;
  /** `navigator.maxTouchPoints > 0` — a screen the user can touch. */
  hasTouch: boolean;
}): boolean {
  if (viewport.width < SIGNAGE_MIN_WIDTH) return false;
  // A touch-first device (tablet) is hand-held even when it is 1024px+ wide.
  if (viewport.coarsePointer && viewport.hasTouch) return false;
  return true;
}

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
 *   primary saturation → nudges editorial/energetic layout density and pacing
 *   photography ratio  → image-led split boards vs. type-led dotted-leader
 *                        boards, and how much the images breathe
 *   business type      → pacing only (a café lingers, a bakery moves)
 *   section/item counts→ how many dishes share a page
 */
export function resolveLiveProfile(
  restaurant: Pick<
    Restaurant,
    'primaryColor' | 'accentColor' | 'businessType' | 'name' | 'theme'
  > | null | undefined,
  sections: LiveSection[]
): LiveVisualProfile {
  // Theme-first identity: a tenant with an effective theme must derive the
  // live profile from the theme's colors, not from stale legacy columns.
  const identity = resolveBrandIdentity(restaurant);
  const primary = (parseColor(identity.primary) as Rgb) || { r: 212, g: 175, b: 55 };
  const primaryHsl = rgbToHsl(primary);

  const coverage = imageCoverage(sections);
  const businessType = restaurant?.businessType || 'RESTAURANT';

  // ---- Editorial vs. energetic. A continuous score, not a switch on type.
  // Layout personality may respond to brand/catalog data, but color itself is
  // painted exclusively from the restaurant's canonical --m-* tokens.
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
    // The canonical customer palette is the only source for display colors.
    '--lm-bg-0': 'var(--m-bg, #0A0B0D)',
    '--lm-bg-1': 'var(--m-surface, #15171A)',
    '--lm-bg-2': 'var(--m-surface-raised, #20232A)',
    '--lm-ink': 'var(--m-text, #F3F5F9)',
    '--lm-ink-soft': 'var(--m-text-muted, #CFD6E2)',
    '--lm-ink-faint': 'var(--m-text-subtle, #A0A0A0)',
    '--lm-brand': 'var(--m-brand-on-surface, #E6C86E)',
    '--lm-brand-rgb': 'var(--m-brand-on-surface-rgb, 230 200 110)',
    '--lm-accent': 'var(--m-brand-accent-on-surface, #D9C3A3)',
    '--lm-fill': 'var(--m-brand-fill, linear-gradient(135deg, #D4AF37, #C5A880))',
    '--lm-ink-on-fill': 'var(--m-brand-ink, #0A0B0D)',
    '--lm-glow-a': 'var(--m-brand-glow, rgb(230 200 110 / 0.28))',
    '--lm-glow-b': 'rgb(var(--m-brand-accent-rgb, 197 168 128) / 0.26)',
    '--lm-hairline': 'var(--m-hairline, rgb(230 200 110 / 0.24))',
    '--lm-hairline-soft': 'color-mix(in srgb, var(--m-hairline, rgb(230 200 110 / 0.24)) 55%, transparent)',
    // Shape & type; the same restaurant-selected Arabic face covers the whole menu.
    '--lm-radius': editorial ? '10px' : '22px',
    '--lm-radius-sm': editorial ? '6px' : '14px',
    '--lm-title-face': 'var(--m-font, "Tajawal", "Cairo", sans-serif)',
    '--lm-body-face': 'var(--m-font, "Tajawal", "Cairo", system-ui, sans-serif)',
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
