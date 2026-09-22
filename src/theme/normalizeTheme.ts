/**
 * Theme Normalization — the ONE place stored/server theme shapes become a
 * single predictable model.
 * ===========================================================================
 *
 * Pipeline position:
 *
 *   Stored Theme Configuration (Theme row / legacy columns)
 *     → themeResolver (server cascade)  → EffectiveTheme (wire contract)
 *     → normalizeTheme()                → NormalizedTheme   ← YOU ARE HERE
 *     → resolveThemeMode()              → 'light' | 'dark'
 *     → buildSemanticTokens()           → CSS custom properties
 *     → CustomerThemeProvider           → the DOM
 *
 * Why this exists
 * ---------------
 * Brand identity used to be re-derived independently by four different callers
 * (App, RestaurantContext, CustomerLayout, the entry overlay), each with its
 * own default surface mode and its own legacy-column fallback. They therefore
 * disagreed, and whichever ran last won. Normalization collapses that into a
 * single evaluation so there is exactly one answer to "what is this tenant's
 * theme".
 *
 * PURITY CONTRACT
 * ---------------
 * This module is pure: no DOM access, no localStorage, no React, no
 * module-load side effects. It is safe to call on the server, in a test, or
 * during render.
 *
 * LEGACY THEMES — NO PRESET GUESSING
 * ----------------------------------
 * `presetId` is `null` for every theme that did not explicitly record one.
 * A stored theme may hold a deliberate custom combination that happens to sit
 * near a shipped preset; inferring "closest preset" would silently reinterpret
 * the manager's intent and let later derivation overwrite their values. A
 * preset id is assigned ONLY when a manager explicitly picks one in the
 * editor. Everything a legacy theme stored is preserved verbatim in
 * `colors`/`radius`/`shadows`/`typography`/`cards`/`background` and is treated
 * as an explicit override by the token builder.
 */

import type {
  EffectiveTheme,
  ResolvedBackground,
  ThemeCardStyle,
  ThemeColors,
  ThemeMode,
  ThemeRadius,
  ThemeShadows,
  ThemeTypography,
} from '../types/restaurant';

/** The brand identity pair — the only two colors a manager must choose. */
export interface NormalizedBrand {
  primary: string;
  accent: string;
}

/**
 * The single normalized theme model every downstream consumer reads.
 *
 * It intentionally mirrors `EffectiveTheme` rather than inventing a new shape:
 * the wire contract is correct and well tested, and keeping the shapes aligned
 * is what makes semantic-output equivalence verifiable during migration.
 */
export interface NormalizedTheme {
  /** Configured mode — may be 'auto'. NEVER the resolved surface mode. */
  mode: ThemeMode;
  /**
   * Explicitly chosen preset, or null. Never inferred from stored values.
   * @see the "LEGACY THEMES" note at the top of this file.
   */
  presetId: string | null;
  /** Brand identity, theme-first with the legacy columns as fallback. */
  brand: NormalizedBrand;
  colors: ThemeColors;
  radius: ThemeRadius;
  shadows: ThemeShadows;
  typography: ThemeTypography;
  cards: ThemeCardStyle;
  background: {
    light: ResolvedBackground;
    dark: ResolvedBackground;
  };
  /** Provenance of the resolved theme (branch → restaurant → platform → fallback). */
  source: EffectiveTheme['source'] | 'legacy' | 'default';
  /**
   * True when this theme came from a real Theme row rather than from the
   * legacy columns or the platform default. Consumers use it to decide
   * whether a value is worth persisting to the first-paint cache.
   */
  hasStoredTheme: boolean;
}

/**
 * The platform's white-label default identity. Mirrors
 * `BRAND_FALLBACK` in brandTheme.ts and `FALLBACK_THEME` on the server —
 * a tenant that has chosen nothing still gets a complete, legible menu.
 */
export const DEFAULT_BRAND: NormalizedBrand = {
  primary: '#D4AF37',
  accent: '#C5A880',
};

const DEFAULT_RADIUS: ThemeRadius = {
  sm: '6px',
  md: '10px',
  lg: '16px',
  xl: '24px',
  full: '9999px',
};

const DEFAULT_SHADOWS: ThemeShadows = {
  sm: '0 1px 3px rgba(0,0,0,0.3)',
  md: '0 4px 20px rgba(0,0,0,0.4)',
  lg: '0 10px 40px rgba(0,0,0,0.5)',
};

const DEFAULT_TYPOGRAPHY: ThemeTypography = {
  fontFamily: 'auto',
  headingWeight: '700',
  bodyWeight: '400',
};

const DEFAULT_COLORS: ThemeColors = {
  primary: DEFAULT_BRAND.primary,
  secondary: '#C5A880',
  accent: DEFAULT_BRAND.accent,
  background: '#0A0B0D',
  surface: '#15171A',
  textPrimary: '#F5F5F0',
  textSecondary: '#A0A0A0',
  border: '#2A2D32',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
};

const DEFAULT_BACKGROUND_DARK: ResolvedBackground = {
  type: 'solid',
  color: '#0A0B0D',
  url: null,
  storagePath: null,
};

const DEFAULT_BACKGROUND_LIGHT: ResolvedBackground = {
  type: 'solid',
  color: '#FFFFFF',
  url: null,
  storagePath: null,
};

/** A non-empty trimmed string, else undefined. */
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The restaurant fields normalization reads. Deliberately structural rather
 * than importing the full `Restaurant` type: normalization must stay usable
 * from tests, the server, and the manager preview with a partial object.
 */
export interface ThemeSourceRestaurant {
  theme?: EffectiveTheme | null;
  primaryColor?: string | null;
  accentColor?: string | null;
}

/**
 * Brand identity resolution — theme-first, legacy columns as fallback,
 * platform default last.
 *
 * This is the ONLY precedence definition in the codebase. The legacy
 * `primaryColor`/`accentColor` columns remain readable (existing tenants and
 * seed data still depend on them) but they can no longer win over a Theme row
 * the way they did when four callers each applied their own ordering.
 */
export function resolveBrand(
  restaurant: ThemeSourceRestaurant | null | undefined
): NormalizedBrand {
  const themeColors = restaurant?.theme?.colors;
  return {
    primary:
      str(themeColors?.primary) ?? str(restaurant?.primaryColor) ?? DEFAULT_BRAND.primary,
    accent: str(themeColors?.accent) ?? str(restaurant?.accentColor) ?? DEFAULT_BRAND.accent,
  };
}

/**
 * Builds the NormalizedTheme for a restaurant.
 *
 * Works in three situations, which is precisely why the competing writers can
 * be deleted — they existed to cover each other's gaps:
 *
 *   1. A Theme row exists      → the effective theme is used in full.
 *   2. Only legacy columns     → identity from the columns, everything else
 *                                from the platform defaults.
 *   3. Nothing at all          → the white-label default theme.
 */
export function normalizeTheme(
  restaurant: ThemeSourceRestaurant | null | undefined
): NormalizedTheme {
  const effective = restaurant?.theme ?? null;
  const brand = resolveBrand(restaurant);

  // No Theme row: synthesize a complete theme from the legacy identity so the
  // menu renders a full token set instead of relying on CSS fallbacks.
  if (!effective) {
    const hasLegacy = Boolean(str(restaurant?.primaryColor) || str(restaurant?.accentColor));
    return {
      mode: 'auto',
      presetId: null,
      brand,
      colors: { ...DEFAULT_COLORS, primary: brand.primary, accent: brand.accent },
      radius: { ...DEFAULT_RADIUS },
      shadows: { ...DEFAULT_SHADOWS },
      typography: { ...DEFAULT_TYPOGRAPHY },
      cards: {},
      background: {
        light: { ...DEFAULT_BACKGROUND_LIGHT },
        dark: { ...DEFAULT_BACKGROUND_DARK },
      },
      source: hasLegacy ? 'legacy' : 'default',
      hasStoredTheme: false,
    };
  }

  // A Theme row exists. Every stored value is preserved verbatim — this is the
  // compatibility guarantee for existing tenants. Defaults only FILL GAPS.
  return {
    mode: effective.mode ?? 'auto',
    // Never inferred. Only an explicit manager choice sets this.
    presetId: null,
    brand,
    colors: {
      ...DEFAULT_COLORS,
      ...effective.colors,
      // Identity stays consistent with resolveBrand so the brand tokens and
      // the scalar color tokens can never disagree about the same color.
      primary: brand.primary,
      accent: brand.accent,
    },
    radius: { ...DEFAULT_RADIUS, ...effective.radius },
    shadows: { ...DEFAULT_SHADOWS, ...effective.shadows },
    typography: { ...DEFAULT_TYPOGRAPHY, ...effective.typography },
    cards: { ...effective.cards },
    background: {
      light: effective.background?.light ?? { ...DEFAULT_BACKGROUND_LIGHT },
      dark: effective.background?.dark ?? { ...DEFAULT_BACKGROUND_DARK },
    },
    source: effective.source ?? 'fallback',
    hasStoredTheme: true,
  };
}

/**
 * Adapter back to the `EffectiveTheme` shape.
 *
 * MIGRATION DEVICE — deliberately temporary. It lets the semantic token
 * builder reuse the existing, well-tested `buildEffectiveThemeVars` /
 * `buildBrandTokens` derivation instead of reimplementing the color math,
 * which is what makes "semantic output equivalence" provable by construction
 * rather than by eyeballing. Once every customer component reads `--m-*`
 * tokens, the derivation can move wholesale into the token builder and this
 * adapter disappears with the aliases.
 */
export function toEffectiveThemeShape(theme: NormalizedTheme): EffectiveTheme {
  return {
    mode: theme.mode,
    colors: theme.colors,
    radius: theme.radius,
    shadows: theme.shadows,
    typography: theme.typography,
    cards: theme.cards,
    background: theme.background,
    source: (theme.source === 'legacy' || theme.source === 'default'
      ? 'fallback'
      : theme.source) as EffectiveTheme['source'],
    rawConfig: {},
  };
}
