/**
 * THEME TEMPLATES — a curated library of complete, modern menu designs.
 * ===========================================================================
 *
 * A template is a FULL `ThemeConfig` (the same UI shape the editor edits in
 * `editConfig`): identity + surface scalars + a radius scale + a shadow
 * scale + typography + a LIGHT and a DARK background. It is PURE DATA — no
 * React, no DOM, no API, no side effects — and it enters the existing
 * pipeline exactly where every other theme value enters it: the editor's
 * draft. From there the ordinary save path (toServerThemePayload →
 * PUT /manager/theme) and the ordinary runtime pipeline (normalizeTheme →
 * semantic tokens → CustomerThemeProvider) apply it.
 *
 * There is NO template resolver, NO template storage, NO template contract:
 * once saved, a template IS an ordinary stored theme.
 *
 * DESIGN CONTRACT (enforced by src/tests/themeTemplates.test.ts)
 * --------------------------------------------------------------
 * • `mode` is always 'auto' — the guest's device picks the face.
 * • The five surface scalars (background/surface/textPrimary/
 *   textSecondary/border) use the EXACT platform default values from
 *   brandTheme.ts (PLATFORM_DARK_DEFAULT_COLORS), which is what lets
 *   `resolveModeAwareColors` flip them per resolved mode. Personality comes
 *   from primary/accent, the per-mode backgrounds, typography and the
 *   radius/shadow scales — never from the surface scalars.
 * • Radius/shadows use the exact CORNER_SCALES / CARD_SHADOWS values from
 *   editorModel.ts (kept in sync by the round-trip test: `toDraft` must read
 *   them back as the named styles with NO bespoke override).
 * • NO per-component colour groups (button/card/badge/category) and NO
 *   `cards` object: the semantic token engine derives all of those per mode
 *   from the identity (semanticTokens `pick`), so a template stays correct
 *   in BOTH faces without a second, mode-blind set of colours.
 */

import type { BackgroundConfig, ThemeConfig, ThemeRadius, ThemeShadows, ThemeTypography } from '../types/restaurant';
import { toDraft, type CardStyle, type CornerStyle, type Density, type EditorFont, type ThemeDraft } from './editorModel';

/** Stable id — a UI label only, never persisted (same rule as preset ids). */
export interface ThemeTemplate {
  id: string;
  /** Arabic display name. */
  label: string;
  /** One-line Arabic description shown in the gallery card. */
  desc: string;
  /** Design intent metadata — what the round-trip test asserts against. */
  cornerStyle: CornerStyle;
  cardStyle: CardStyle;
  density: Density;
  font: EditorFont;
  /**
   * The full design. `mode: 'auto'`, eleven surface/identity scalars, named
   * radius/shadow scales, typography, and a light + dark background.
   * Never carries colour groups or a `cards` object.
   */
  config: ThemeConfig;
}

// ---------------------------------------------------------------------------
// Named scales — exact copies of editorModel.ts CORNER_SCALES / CARD_SHADOWS
// (module-private there). The round-trip test locks both sides: if either
// copy drifts, `toDraft` stops reading the named styles and the test fails.
// ---------------------------------------------------------------------------

const CORNER_SCALES: Record<CornerStyle, ThemeRadius> = {
  sharp: { sm: '2px', md: '4px', lg: '6px', xl: '8px', full: '9999px' },
  rounded: { sm: '6px', md: '10px', lg: '16px', xl: '22px', full: '9999px' },
  pill: { sm: '12px', md: '18px', lg: '26px', xl: '34px', full: '9999px' },
};

const CARD_SHADOWS: Record<CardStyle, ThemeShadows> = {
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

const DENSITY_WEIGHTS: Record<Density, Pick<ThemeTypography, 'headingWeight' | 'bodyWeight'>> = {
  compact: { headingWeight: '600', bodyWeight: '400' },
  comfortable: { headingWeight: '700', bodyWeight: '500' },
  spacious: { headingWeight: '800', bodyWeight: '500' },
};

/**
 * The two neutral surface families a template may use. Every value is an
 * EXACT entry of brandTheme.ts PLATFORM_DARK_DEFAULT_COLORS, so light mode
 * flips each one to its light counterpart automatically — the same
 * mechanism DEFAULT_THEME_FALLBACK relies on. A template never invents its
 * own surface palette.
 */
const SURFACE_FAMILIES = {
  a: { surface: '#15171A', textPrimary: '#F5F5F0', textSecondary: '#A0A0A0', border: '#2A2D32' },
  b: { surface: '#121416', textPrimary: '#F8FAFC', textSecondary: '#94A3B8', border: '#1E293B' },
} as const;

// The platform shell background (always flippable) and the standard status
// colours (platform-fixed, not a template decision).
const SHELL_BACKGROUND = '#0A0B0D';
const STATUS_COLORS = { success: '#10B981', warning: '#F59E0B', error: '#EF4444' } as const;

const solidLight = (color = '#FFFFFF'): BackgroundConfig => ({ type: 'solid', color });
const solidDark = (color = SHELL_BACKGROUND): BackgroundConfig => ({ type: 'solid', color });
const gradientLight = (gradient: string): BackgroundConfig => ({ type: 'gradient', gradient });
const gradientDark = (gradient: string): BackgroundConfig => ({ type: 'gradient', gradient });

interface TemplateSpec {
  id: string;
  label: string;
  desc: string;
  primary: string;
  accent: string;
  corner: CornerStyle;
  card: CardStyle;
  density: Density;
  font: EditorFont;
  surface: keyof typeof SURFACE_FAMILIES;
  lightBg: BackgroundConfig;
  darkBg: BackgroundConfig;
}

/** Builds the full ThemeConfig for a spec — the only place configs are shaped. */
function buildTemplateConfig(spec: TemplateSpec): ThemeConfig {
  return {
    mode: 'auto',
    colors: {
      primary: spec.primary,
      // Legacy convention (themeResolver): the accent column maps to both
      // `secondary` and `accent` — keep template saves consistent with it.
      secondary: spec.accent,
      accent: spec.accent,
      background: SHELL_BACKGROUND,
      ...SURFACE_FAMILIES[spec.surface],
      ...STATUS_COLORS,
    },
    radius: CORNER_SCALES[spec.corner],
    shadows: CARD_SHADOWS[spec.card],
    typography: {
      fontFamily: spec.font,
      ...DENSITY_WEIGHTS[spec.density],
    },
    background: { light: spec.lightBg, dark: spec.darkBg },
  };
}

/**
 * The curated gallery — ten distinct designs: different hue families, corner
 * and shadow personalities, typefaces and densities. Each carries an
 * independent light and dark background; the shell/surface scalars stay on
 * the flippable platform defaults so BOTH faces stay legible by construction.
 */
const SPECS: TemplateSpec[] = [
  {
    id: 'royal-gold',
    label: 'ذهبي ملكي',
    desc: 'كلاسيكي فاخر بدفء ذهبي للمشاوي والمطاعم الراقية',
    primary: '#D4AF37',
    accent: '#8C6D1F',
    corner: 'rounded',
    card: 'elevated',
    density: 'spacious',
    font: 'cormorant',
    surface: 'a',
    lightBg: solidLight(),
    darkBg: gradientDark('linear-gradient(180deg, #0A0B0D, #171204)'),
  },
  {
    id: 'midnight-blue',
    label: 'أزرق ليلي',
    desc: 'عصري هادئ وأنيق للمقاهي والمطاعم الحديثة',
    primary: '#3B5BDB',
    accent: '#4F7CFF',
    corner: 'rounded',
    card: 'soft',
    density: 'comfortable',
    font: 'tajawal',
    surface: 'b',
    lightBg: gradientLight('linear-gradient(180deg, #FFFFFF, #EEF3FE)'),
    darkBg: gradientDark('linear-gradient(180deg, #0A0B0D, #0D142B)'),
  },
  {
    id: 'emerald-modern',
    label: 'زمردي معاصر',
    desc: 'انتعاش وثقة راقية للمطابخ الصحية والمتوسطة',
    primary: '#10B981',
    accent: '#065F46',
    corner: 'pill',
    card: 'soft',
    density: 'comfortable',
    font: 'cairo',
    surface: 'a',
    lightBg: gradientLight('linear-gradient(180deg, #FFFFFF, #ECFAF3)'),
    darkBg: gradientDark('linear-gradient(180deg, #0A0B0D, #0B1A13)'),
  },
  {
    id: 'amber-warm',
    label: 'عنبري دافئ',
    desc: 'طاقة ودفء ترحيبي للمطاعم العائلية',
    primary: '#F59E0B',
    accent: '#92400E',
    corner: 'pill',
    card: 'elevated',
    density: 'spacious',
    font: 'cairo',
    surface: 'b',
    lightBg: gradientLight('linear-gradient(180deg, #FFFFFF, #FFF5E6)'),
    darkBg: gradientDark('linear-gradient(180deg, #0A0B0D, #1B1204)'),
  },
  {
    id: 'rose-boutique',
    label: 'وردي بوتيك',
    desc: 'نعومة أنيقة للمقاهي والحلويات',
    primary: '#EC4899',
    accent: '#B02469',
    corner: 'pill',
    card: 'soft',
    density: 'comfortable',
    font: 'tajawal',
    surface: 'a',
    lightBg: gradientLight('linear-gradient(180deg, #FFFFFF, #FDEFF5)'),
    darkBg: gradientDark('linear-gradient(180deg, #0A0B0D, #200D19)'),
  },
  {
    id: 'wine-steakhouse',
    label: 'نبيذي فاخر',
    desc: 'فخامة عميقة لمطاعم اللحوم',
    primary: '#C0392B',
    accent: '#5C1A12',
    corner: 'rounded',
    card: 'elevated',
    density: 'spacious',
    font: 'amiri',
    surface: 'a',
    lightBg: solidLight(),
    darkBg: gradientDark('linear-gradient(180deg, #0A0B0D, #1D0B09)'),
  },
  {
    id: 'silver-minimal',
    label: 'فضي مينيمال',
    desc: 'بساطة نظيفة وحديثة بحدود حادة',
    primary: '#94A3B8',
    accent: '#3E4A5B',
    corner: 'sharp',
    card: 'flat',
    density: 'compact',
    font: 'tajawal',
    surface: 'b',
    lightBg: solidLight(),
    darkBg: solidDark(),
  },
  {
    id: 'olive-sand',
    label: 'زيتوني رملي',
    desc: 'أجواء عضوية متوسطية دافئة',
    primary: '#8C9A4F',
    accent: '#C9B48A',
    corner: 'rounded',
    card: 'soft',
    density: 'comfortable',
    font: 'cairo',
    surface: 'b',
    lightBg: gradientLight('linear-gradient(180deg, #FFFFFF, #F6F5EA)'),
    darkBg: gradientDark('linear-gradient(180deg, #0A0B0D, #151509)'),
  },
  {
    id: 'navy-fine',
    label: 'كحلي راقٍ',
    desc: 'هيبة هادئة للأعمال والمطاعم الراقية',
    primary: '#3E5F8A',
    accent: '#22344E',
    corner: 'rounded',
    card: 'elevated',
    density: 'comfortable',
    font: 'cormorant',
    surface: 'a',
    lightBg: gradientLight('linear-gradient(180deg, #FFFFFF, #EFF4FA)'),
    darkBg: gradientDark('linear-gradient(180deg, #0A0B0D, #0B1322)'),
  },
  {
    id: 'teal-coastal',
    label: 'فيروزي ساحلي',
    desc: 'انتعاش بحري منعش للمحار والمأكولات البحرية',
    primary: '#14B8A6',
    accent: '#0F766E',
    corner: 'sharp',
    card: 'flat',
    density: 'compact',
    font: 'tajawal',
    surface: 'b',
    lightBg: gradientLight('linear-gradient(180deg, #FFFFFF, #EBFAF7)'),
    darkBg: gradientDark('linear-gradient(180deg, #0A0B0D, #081514)'),
  },
];

export const THEME_TEMPLATES: ThemeTemplate[] = SPECS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  desc: spec.desc,
  cornerStyle: spec.corner,
  cardStyle: spec.card,
  density: spec.density,
  font: spec.font,
  config: buildTemplateConfig(spec),
}));

/**
 * Precomputed ONCE at module load (static data — the gallery never re-derives
 * a template per render). The draft is the same projection the editor uses,
 * so a gallery preview and the main preview cannot disagree.
 */
export const TEMPLATE_DRAFTS: ReadonlyMap<string, ThemeDraft> = new Map(
  THEME_TEMPLATES.map((template) => [template.id, toDraft(template.config, null)])
);
