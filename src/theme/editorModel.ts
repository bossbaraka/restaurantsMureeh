/**
 * THEME EDITOR MODEL — the simple decisions a restaurant manager makes.
 * ===========================================================================
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The editor asked the manager to fill in the theme engine's internal state:
 * eleven raw colour pickers (surface, border, textPrimary, textSecondary,
 * success, warning, error …), four free-text CSS radius boxes and three
 * free-text CSS shadow boxes. Those are ENGINE INPUTS, not business decisions.
 * A manager knows "my restaurant is green and feels modern"; they do not know
 * what `--shadow-md: 0 4px 12px rgba(0,0,0,.3)` should be.
 *
 * THE MODEL
 * ---------
 * The manager chooses a small set of visual intents:
 *
 *     appearance · brand colours · preset · card style · corner style
 *     · font · density · background
 *
 * Everything else is DERIVED here, by the same engine the customer menu uses.
 *
 *     Simple choices  ->  derived ThemeConfig  ->  explicit overrides (advanced)
 *
 * PURITY CONTRACT
 * ---------------
 * No DOM, no React, no storage, no API. `toThemeConfig()` is a pure function
 * so the editor, the preview and the tests all agree by construction.
 *
 * OVERRIDES ARE NEVER DISCARDED
 * -----------------------------
 * A legacy theme carries values this simple model cannot express. Those are
 * preserved in `overrides` and re-applied ON TOP of the derived config, so
 * opening and saving the editor can never silently drop a stored value.
 */

import type { ThemeConfig, ThemeMode } from '../types/restaurant';

export type CardStyle = 'flat' | 'soft' | 'elevated';
export type CornerStyle = 'sharp' | 'rounded' | 'pill';
export type Density = 'compact' | 'comfortable' | 'spacious';
/** `auto` on `font` = the platform body face; on `headingFont` = "same as body". */
export type EditorFont = 'auto' | 'tajawal' | 'cairo' | 'amiri' | 'cormorant' | 'alexandria' | 'kufi';

/** A real visual preset — not just a pair of colours. */
export interface ThemePreset {
  id: string;
  label: string;
  desc: string;
  primary: string;
  accent: string;
  cardStyle: CardStyle;
  cornerStyle: CornerStyle;
  font: EditorFont;
  /** Heading face; 'auto' = inherits the body face. */
  headingFont: EditorFont;
  /** Appearance the preset was designed around. */
  appearance: ThemeMode;
}

/**
 * The manager-facing draft.
 *
 * `presetId` is null for every theme that did not have a preset EXPLICITLY
 * selected in this editor — legacy themes included. It is never inferred by
 * comparing stored colours against preset colours: two themes that happen to
 * share a primary hex are not the same theme, and claiming otherwise would
 * relabel a manager's custom work as a preset they never picked.
 */
export interface ThemeDraft {
  appearance: ThemeMode;
  primary: string;
  accent: string;
  presetId: string | null;
  cardStyle: CardStyle;
  cornerStyle: CornerStyle;
  font: EditorFont;
  /** Heading face control («خط العناوين»). 'auto' inherits the body face. */
  headingFont: EditorFont;
  density: Density;
  background: ThemeConfig['background'];
  /**
   * Stored values the simple model does not express (per-component colour
   * groups, bespoke radius/shadow scales, secondary/status colours …).
   * Applied last so nothing stored is ever lost.
   */
  overrides: Partial<ThemeConfig>;
}

export const THEME_PRESETS: ThemePreset[] = [
  // Font roles are body + heading pairs (the Arabic typography system):
  // every preset pairs a readable body face with a display face that suits
  // its character — never a Latin-only face for Arabic content.
  { id: 'royal-gold', label: 'ذهبي ملكي', desc: 'كلاسيكي فاخر دافئ', primary: '#D4AF37', accent: '#8C6D1F', cardStyle: 'elevated', cornerStyle: 'rounded', font: 'alexandria', headingFont: 'kufi', appearance: 'dark' },
  { id: 'midnight-blue', label: 'أزرق ليلي', desc: 'هادئ وعصري وأنيق', primary: '#4F7CFF', accent: '#1E2F6E', cardStyle: 'soft', cornerStyle: 'rounded', font: 'alexandria', headingFont: 'cairo', appearance: 'dark' },
  { id: 'emerald', label: 'زمردي ملكي', desc: 'انتعاش وثقة راقية', primary: '#10B981', accent: '#065F46', cardStyle: 'soft', cornerStyle: 'pill', font: 'alexandria', headingFont: 'cairo', appearance: 'light' },
  { id: 'amber', label: 'عنبري دافئ', desc: 'طاقة ودفء ترحيبي', primary: '#F59E0B', accent: '#92400E', cardStyle: 'elevated', cornerStyle: 'pill', font: 'alexandria', headingFont: 'cairo', appearance: 'light' },
  { id: 'rose', label: 'وردي فاخر', desc: 'ناعم للمقاهي والبوتيك', primary: '#EC4899', accent: '#831843', cardStyle: 'soft', cornerStyle: 'pill', font: 'alexandria', headingFont: 'auto', appearance: 'light' },
  { id: 'wine', label: 'نبيذي داكن', desc: 'فخامة مطاعم اللحوم', primary: '#C0392B', accent: '#5C1A12', cardStyle: 'elevated', cornerStyle: 'rounded', font: 'alexandria', headingFont: 'amiri', appearance: 'dark' },
  { id: 'silver', label: 'فضي معدني', desc: 'حديث بسيط نظيف', primary: '#94A3B8', accent: '#3E4A5B', cardStyle: 'flat', cornerStyle: 'sharp', font: 'alexandria', headingFont: 'auto', appearance: 'light' },
];

/** Corner scales. One choice replaces four free-text CSS boxes. */
const CORNER_SCALES: Record<CornerStyle, NonNullable<ThemeConfig['radius']>> = {
  sharp: { sm: '2px', md: '4px', lg: '6px', xl: '8px', full: '9999px' },
  rounded: { sm: '6px', md: '10px', lg: '16px', xl: '22px', full: '9999px' },
  pill: { sm: '12px', md: '18px', lg: '26px', xl: '34px', full: '9999px' },
};

/** Shadow scales. One choice replaces three free-text CSS boxes. */
const CARD_SHADOWS: Record<CardStyle, NonNullable<ThemeConfig['shadows']>> = {
  flat: {
    sm: '0 1px 2px rgba(0,0,0,0.10)',
    md: '0 1px 3px rgba(0,0,0,0.12)',
    lg: '0 2px 6px rgba(0,0,0,0.14)',
  },
  soft: {
    sm: '0 1px 3px rgba(0,0,0,0.18)',
    md: '0 4px 12px rgba(0,0,0,0.22)',
    lg: '0 10px 24px rgba(0,0,0,0.28)',
  },
  elevated: {
    sm: '0 2px 6px rgba(0,0,0,0.26)',
    md: '0 8px 20px rgba(0,0,0,0.34)',
    lg: '0 18px 40px rgba(0,0,0,0.44)',
  },
};

/**
 * Density maps to the TYPOGRAPHIC WEIGHT pair.
 *
 * The obvious encoding would be a `typography.scale` multiplier, but no such
 * field exists: `ThemeTypography` is `{ fontFamily, headingWeight, bodyWeight }`
 * and the server schema validates exactly those. Inventing `scale` would be
 * silently dropped by the strict schema on save, so the control would appear
 * to work and never persist. Weight is the density lever the contract
 * actually supports.
 */
const DENSITY_WEIGHTS: Record<Density, { headingWeight: string; bodyWeight: string }> = {
  compact: { headingWeight: '600', bodyWeight: '400' },
  comfortable: { headingWeight: '700', bodyWeight: '500' },
  spacious: { headingWeight: '800', bodyWeight: '500' },
};

const DEFAULT_PRIMARY = '#D4AF37';
const DEFAULT_ACCENT = '#C5A880';

/** Nearest card style for a stored shadow — presentation only, never persisted as a preset. */
function cardStyleFromShadow(shadow: string | undefined): CardStyle {
  if (!shadow) return 'soft';
  for (const style of ['flat', 'soft', 'elevated'] as const) {
    if (Object.values(CARD_SHADOWS[style]).some((v) => v === shadow)) return style;
  }
  return 'soft';
}

function cornerStyleFromRadius(radius: ThemeConfig['radius']): CornerStyle {
  if (!radius?.lg) return 'rounded';
  for (const style of ['sharp', 'rounded', 'pill'] as const) {
    if (CORNER_SCALES[style].lg === radius.lg) return style;
  }
  return 'rounded';
}

function densityFromWeights(typography: ThemeConfig['typography']): Density {
  const heading = String(typography?.headingWeight ?? '');
  for (const key of ['compact', 'comfortable', 'spacious'] as const) {
    if (DENSITY_WEIGHTS[key].headingWeight === heading) return key;
  }
  return 'comfortable';
}

/**
 * Reads a stored ThemeConfig into the simple model.
 *
 * Anything the simple model cannot express is kept verbatim in `overrides`,
 * so a round-trip through the editor is non-destructive.
 */
export function toDraft(config: ThemeConfig | null | undefined, presetId: string | null = null): ThemeDraft {
  const cfg = config || {};
  const colors = (cfg.colors || {}) as Partial<NonNullable<ThemeConfig['colors']>>;

  // Everything NOT represented by a simple control is an override.
  const { primary: _p, accent: _a, ...otherColors } = colors as unknown as Record<string, unknown>;
  const overrides: Partial<ThemeConfig> = {};
  if (Object.keys(otherColors).length) {
    overrides.colors = otherColors as unknown as ThemeConfig['colors'];
  }
  if (cfg.cards) overrides.cards = cfg.cards;

  // A stored radius/shadow scale that does not match a named style is bespoke
  // and must survive as an override rather than being snapped to the nearest
  // preset scale.
  const corner = cornerStyleFromRadius(cfg.radius);
  if (cfg.radius && JSON.stringify(cfg.radius) !== JSON.stringify(CORNER_SCALES[corner])) {
    overrides.radius = cfg.radius;
  }
  const card = cardStyleFromShadow(cfg.shadows?.md);
  if (cfg.shadows && JSON.stringify(cfg.shadows) !== JSON.stringify(CARD_SHADOWS[card])) {
    overrides.shadows = cfg.shadows;
  }
  if (cfg.typography) {
    const { fontFamily: _f, headingFont: _hf, headingWeight: _h, bodyWeight: _b, ...restTypography } =
      cfg.typography as unknown as Record<string, unknown>;
    if (Object.keys(restTypography).length) {
      overrides.typography = restTypography as unknown as ThemeConfig['typography'];
    }
  }

  return {
    appearance: cfg.mode || 'auto',
    primary: colors.primary || DEFAULT_PRIMARY,
    accent: colors.accent || DEFAULT_ACCENT,
    // NEVER inferred. Only an explicit selection in this editor sets it.
    presetId,
    cardStyle: card,
    cornerStyle: corner,
    font: ((cfg.typography?.fontFamily as EditorFont) || 'auto'),
    // Absent stored heading face = the inherit choice («تلقائي — مثل خط النص»).
    headingFont: ((cfg.typography?.headingFont as EditorFont) || 'auto'),
    density: densityFromWeights(cfg.typography),
    background: cfg.background,
    overrides,
  };
}

/**
 * Derives the full ThemeConfig from the simple model.
 *
 * Order matters: derived values first, stored overrides last. That is what
 * makes "simple controls + preserved advanced values" work rather than one
 * clobbering the other.
 */
export function toThemeConfig(draft: ThemeDraft): ThemeConfig {
  const derived: ThemeConfig = {
    mode: draft.appearance,
    colors: {
      ...(draft.overrides.colors || {}),
      primary: draft.primary,
      accent: draft.accent,
    } as unknown as ThemeConfig['colors'],
    radius: { ...CORNER_SCALES[draft.cornerStyle], ...(draft.overrides.radius || {}) },
    shadows: { ...CARD_SHADOWS[draft.cardStyle], ...(draft.overrides.shadows || {}) },
    typography: {
      ...(draft.overrides.typography || {}),
      fontFamily: draft.font,
      // 'auto' on the heading control means INHERIT the body face: the key is
      // omitted (absent in the contract), so the derivation falls back to the
      // body stack and no stale override can linger.
      ...(draft.headingFont !== 'auto' ? { headingFont: draft.headingFont } : {}),
      ...DENSITY_WEIGHTS[draft.density],
    } as unknown as ThemeConfig['typography'],
    cards: {
      ...(draft.overrides.cards || {}),
      // The card's own radius/shadow follow the chosen styles unless the
      // stored config explicitly overrode them.
      radius: draft.overrides.cards?.radius ?? CORNER_SCALES[draft.cornerStyle].lg,
      shadow: draft.overrides.cards?.shadow ?? CARD_SHADOWS[draft.cardStyle].md,
    },
  };
  if (draft.background) derived.background = draft.background;
  return derived;
}

/** Applies a preset, keeping everything the preset does not speak about. */
export function applyPresetToDraft(draft: ThemeDraft, presetId: string): ThemeDraft {
  const preset = THEME_PRESETS.find((p) => p.id === presetId);
  if (!preset) return draft;
  return {
    ...draft,
    presetId: preset.id,
    primary: preset.primary,
    accent: preset.accent,
    cardStyle: preset.cardStyle,
    cornerStyle: preset.cornerStyle,
    font: preset.font,
    headingFont: preset.headingFont,
    appearance: preset.appearance,
  };
}

/** Any manual edit detaches the draft from its preset. */
export function detachPreset(draft: ThemeDraft): ThemeDraft {
  return draft.presetId === null ? draft : { ...draft, presetId: null };
}

export const EDITOR_FONTS: Array<{ id: EditorFont; label: string; family: string }> = [
  { id: 'auto', label: 'تلقائي', family: 'Alexandria, Tajawal, system-ui, sans-serif' },
  { id: 'alexandria', label: 'Alexandria', family: 'Alexandria, Tajawal, sans-serif' },
  { id: 'tajawal', label: 'Tajawal', family: 'Tajawal, sans-serif' },
  { id: 'cairo', label: 'Cairo', family: 'Cairo, sans-serif' },
  { id: 'kufi', label: 'Noto Kufi', family: '"Noto Kufi Arabic", Alexandria, sans-serif' },
  { id: 'amiri', label: 'Amiri', family: 'Amiri, serif' },
  { id: 'cormorant', label: 'Cormorant', family: '"Cormorant Garamond", Alexandria, serif' },
];

/**
 * The heading-face picker («خط العناوين»). 'auto' here means "مثل خط النص"
 * (inherit the body face) — rendered with a null family so the tile inherits
 * the page font rather than promising a specific one.
 */
export const EDITOR_HEADING_FONTS: Array<{ id: EditorFont; label: string; family: string | null }> = [
  { id: 'auto', label: 'مثل خط النص', family: null },
  { id: 'alexandria', label: 'Alexandria', family: 'Alexandria, Tajawal, sans-serif' },
  { id: 'tajawal', label: 'Tajawal', family: 'Tajawal, sans-serif' },
  { id: 'cairo', label: 'Cairo', family: 'Cairo, sans-serif' },
  { id: 'kufi', label: 'Noto Kufi', family: '"Noto Kufi Arabic", Alexandria, sans-serif' },
  { id: 'amiri', label: 'Amiri', family: 'Amiri, serif' },
  { id: 'cormorant', label: 'Cormorant', family: '"Cormorant Garamond", Alexandria, serif' },
];

export const CARD_STYLE_OPTIONS: Array<{ id: CardStyle; label: string; desc: string }> = [
  { id: 'flat', label: 'مسطّح', desc: 'بسيط بلا ظلال تقريباً' },
  { id: 'soft', label: 'ناعم', desc: 'ظل خفيف متوازن' },
  { id: 'elevated', label: 'بارز', desc: 'ظل واضح يبرز الأطباق' },
];

export const CORNER_STYLE_OPTIONS: Array<{ id: CornerStyle; label: string; desc: string }> = [
  { id: 'sharp', label: 'حادة', desc: 'زوايا مستقيمة' },
  { id: 'rounded', label: 'دائرية', desc: 'انحناء معتدل' },
  { id: 'pill', label: 'منحنية جداً', desc: 'انحناء كبير وناعم' },
];

export const DENSITY_OPTIONS: Array<{ id: Density; label: string; desc: string }> = [
  { id: 'compact', label: 'مضغوط', desc: 'عناصر أكثر في الشاشة' },
  { id: 'comfortable', label: 'مريح', desc: 'التوازن الافتراضي' },
  { id: 'spacious', label: 'واسع', desc: 'مساحات أكبر وأوضح' },
];
