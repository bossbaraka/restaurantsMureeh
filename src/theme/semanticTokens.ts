/**
 * Semantic Customer Tokens — the canonical `--m-*` vocabulary.
 * ===========================================================================
 *
 * Pipeline position:
 *
 *   NormalizedTheme + resolved surface mode
 *     → buildSemanticTokens()   ← YOU ARE HERE
 *     → a flat { '--m-…': value } object
 *     → CustomerThemeProvider applies it to ONE scope element
 *
 * WHY A NEW PREFIX
 * ----------------
 * The repository currently carries three overlapping families:
 *
 *   --brand-*  tenant identity + derived surfaces (legacy engine)
 *   --theme-*  the server EffectiveTheme contract
 *   --menu-*   a THIRD derivation, re-computed in CSS from --brand-*
 *
 * The same visual property is reachable through all three, so the rendered
 * result depended on which family happened to be populated. `--m-*` is a new,
 * unambiguous namespace: everything below is canonical, and the legacy names
 * are emitted alongside as ALIASES pointing at the same values.
 *
 * NO BIG-BANG RENAME
 * ------------------
 * `buildCompatibilityAliases()` re-emits the full legacy `--brand-*`,
 * `--theme-*` and `--menu-*` sets. Existing customer components keep working
 * untouched while they migrate one at a time. The aliases are DERIVED FROM the
 * same computation as the semantic tokens, so the two can never drift — and
 * they are deleted only once a lint guard proves no consumer remains.
 *
 * PURITY CONTRACT
 * ---------------
 * No DOM, no localStorage, no React, no module-load side effects.
 */

import {
  parseColor,
  buildBrandTokens,
  buildEffectiveThemeVars,
  resolveThemeMode,
  type BrandTokens,
  type SurfaceMode,
} from './brandTheme';
import { toEffectiveThemeShape, type NormalizedTheme } from './normalizeTheme';

export type { SurfaceMode };

/** A flat map of CSS custom property name → value. */
export type TokenMap = Record<string, string>;

/**
 * The canonical semantic token names, grouped by layer.
 *
 * Exported so tests can assert completeness (every name here must be produced
 * by `buildSemanticTokens`) and so the migration lint can recognise a valid
 * token reference.
 */
export const SEMANTIC_TOKEN_NAMES = {
  identity: [
    '--m-brand',
    '--m-brand-rgb',
    '--m-brand-accent',
    '--m-brand-accent-rgb',
    '--m-brand-on-surface',
    '--m-brand-on-surface-rgb',
    '--m-brand-accent-on-surface',
    '--m-brand-fill',
    '--m-brand-ink',
    '--m-brand-glow',
  ],
  surface: [
    '--m-bg',
    '--m-surface',
    '--m-surface-raised',
    '--m-hairline',
    '--m-hairline-strong',
    // Media placeholder end-stop. It was already emitted by surfaceTokens()
    // and aliased to --menu-media-end; listing it here makes it part of the
    // tracked contract (completeness assertions, migration lint).
    '--m-media-end',
  ],
  content: ['--m-text', '--m-text-muted', '--m-text-subtle'],
  component: [
    '--m-card-bg',
    '--m-card-border',
    '--m-card-radius',
    '--m-card-shadow',
    '--m-chip-bg',
    '--m-chip-text',
    '--m-chip-active-bg',
    '--m-chip-active-image',
    '--m-chip-active-text',
    '--m-button-bg',
    '--m-button-text',
    '--m-button-secondary-bg',
    '--m-button-secondary-text',
    '--m-badge-bg',
    '--m-badge-text',
    '--m-badge-radius',
  ],
  typography: [
    '--m-font',
    '--m-font-heading',
    '--m-font-heading-weight',
    '--m-font-body-weight',
  ],
  shape: [
    '--m-radius-sm',
    '--m-radius-md',
    '--m-radius-lg',
    '--m-radius-xl',
    '--m-radius-full',
    '--m-shadow-sm',
    '--m-shadow-md',
    '--m-shadow-lg',
  ],
  status: ['--m-success', '--m-warning', '--m-error'],
} as const;

/** Every canonical token name, flattened. */
export const ALL_SEMANTIC_TOKEN_NAMES: readonly string[] = Object.values(
  SEMANTIC_TOKEN_NAMES
).flat();

/**
 * Surface/chrome tokens per resolved mode.
 *
 * These are the values `index.css` currently hardcodes in `:root` and in the
 * `:root[data-theme='light']` block as the `--menu-*` family. Moving them here
 * means the light/dark surface ladder is computed in ONE place from the brand
 * hue, rather than being half in JS and half in CSS — the split that let a
 * dark-adapted brand token sit on a light surface.
 */
function surfaceTokens(brand: BrandTokens, mode: SurfaceMode): TokenMap {
  const light = mode === 'light';
  return {
    '--m-surface': light
      ? `color-mix(in srgb, ${brand.soft} 62%, #ffffff)`
      : `color-mix(in srgb, ${brand.soft} 55%, #0e1014)`,
    '--m-surface-raised': light
      ? `color-mix(in srgb, ${brand.softStrong} 55%, #ffffff)`
      : `color-mix(in srgb, ${brand.softStrong} 45%, #14161c)`,
    '--m-hairline': light
      ? `color-mix(in srgb, ${brand.primary} 22%, transparent)`
      : `color-mix(in srgb, ${brand.primary} 14%, transparent)`,
    '--m-hairline-strong': brand.lineStrong,
    '--m-text': light ? '#10141b' : '#f3f5f9',
    '--m-text-muted': light ? '#3c4352' : '#cfd6e2',
    '--m-text-subtle': brand.muted,
    '--m-media-end': light ? '#e6e9ef' : '#0b0d11',
  };
}

/**
 * RGB CHANNEL TOKENS — `"r g b"` triplets for the surface/content ladder.
 *
 * WHY THIS EXISTS.
 * The customer UI expresses roughly 120 of its colours with a Tailwind opacity
 * modifier (`bg-luxury-950/80`, `border-luxury-800/60`). Tailwind 3 compiles
 * those to `rgb(<channels> / <alpha>)`, which a colour token can only satisfy
 * if it is exposed as bare channels — a `var()` holding a finished colour
 * cannot be given an alpha this way.
 *
 * Without these, migrating an opacity-modified class would force either
 * dropping the transparency (a visible change, forbidden this phase) or
 * inlining a hardcoded rgba (re-introducing the leak). These triplets let the
 * SAME semantic colour serve both the solid and the translucent case.
 *
 * Derived from the same values as the tokens above, so the two cannot drift.
 */
function channelTokens(tokens: TokenMap, brand: BrandTokens, mode: SurfaceMode): TokenMap {
  const channels = (value: string): string => {
    const rgb = parseColor(value);
    // Every input here is produced by our own builders, so a parse failure is
    // a programming error rather than bad tenant data. Fail loudly in dev
    // rather than emitting a silently wrong colour.
    if (!rgb) return '0 0 0';
    return `${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)}`;
  };
  // --m-hairline is intentionally translucent (mixed with `transparent`), so
  // its channels are taken from the colour it is a tint OF, composited on the
  // surface it sits on. Border alpha then comes from the utility modifier.
  const hairlineBase = mode === 'light'
    ? `color-mix(in srgb, ${brand.primary} 22%, ${tokens['--m-surface']})`
    : `color-mix(in srgb, ${brand.primary} 14%, ${tokens['--m-surface']})`;
  return {
    '--m-bg-rgb': channels(tokens['--m-bg']),
    '--m-surface-rgb': channels(tokens['--m-surface']),
    '--m-surface-raised-rgb': channels(tokens['--m-surface-raised']),
    '--m-text-rgb': channels(tokens['--m-text']),
    '--m-text-muted-rgb': channels(tokens['--m-text-muted']),
    '--m-text-subtle-rgb': channels(tokens['--m-text-subtle']),
    '--m-hairline-rgb': channels(hairlineBase),
    // Status channels, so status colours can also carry an opacity modifier
    // (glows, pulses, tinted backgrounds) without inlining an rgba literal.
    '--m-success-rgb': channels(tokens['--m-success']),
    '--m-warning-rgb': channels(tokens['--m-warning']),
    '--m-error-rgb': channels(tokens['--m-error']),
  };
}

/**
 * Builds the canonical semantic token set.
 *
 * @param theme       the normalized theme (already brand-resolved)
 * @param surfaceMode the RESOLVED mode — 'light' or 'dark', never 'auto'
 *
 * Color derivation delegates to the existing, tested engine
 * (`buildBrandTokens` / `buildEffectiveThemeVars`). That is deliberate: the
 * contrast math in `brandTheme.ts` is the genuinely correct part of the old
 * system, and reusing it is what keeps the migration semantically equivalent
 * instead of a visual rewrite.
 */
export function buildSemanticTokens(
  theme: NormalizedTheme,
  surfaceMode: SurfaceMode
): TokenMap {
  const brand = buildBrandTokens(theme.brand.primary, theme.brand.accent, surfaceMode);
  const effective = toEffectiveThemeShape(theme);
  // `prefersDark` only selects which stored background variant applies; the
  // resolved mode already decided light vs dark, so pass it consistently.
  const themeVars = buildEffectiveThemeVars(effective, surfaceMode === 'dark');
  const surfaces = surfaceTokens(brand, surfaceMode);

  // An optional per-component override is an EMPTY STRING when unset (the
  // server contract's "absent" encoding). `pick` therefore falls back to the
  // derived value rather than emitting an empty custom property, which would
  // resolve to nothing and render an invisible element.
  const pick = (override: string | undefined, derived: string): string => {
    const value = typeof override === 'string' ? override.trim() : '';
    return value.length > 0 ? value : derived;
  };

  const tokens: TokenMap = {
    // ---- Identity -------------------------------------------------------
    '--m-brand': brand.primary,
    '--m-brand-rgb': brand.primaryRgb,
    '--m-brand-accent': brand.accent,
    '--m-brand-accent-rgb': brand.accentRgb,
    '--m-brand-on-surface': brand.primaryStrong,
    '--m-brand-on-surface-rgb': brand.primaryStrongRgb,
    '--m-brand-accent-on-surface': brand.accentStrong,
    '--m-brand-fill': brand.fill,
    '--m-brand-ink': brand.ink,
    '--m-brand-glow': brand.glow,

    // ---- Surface --------------------------------------------------------
    '--m-bg': themeVars['--theme-bg'],
    ...surfaces,

    // ---- Typography -----------------------------------------------------
    '--m-font': themeVars['--font-family'],
    // Heading face — resolved by buildEffectiveThemeVars: the stored
    // `headingFont` override, else the body stack ("same as body" fallback).
    '--m-font-heading': themeVars['--font-family-heading'],
    '--m-font-heading-weight': themeVars['--font-heading-weight'],
    '--m-font-body-weight': themeVars['--font-body-weight'],

    // ---- Shape ----------------------------------------------------------
    '--m-radius-sm': themeVars['--radius-sm'],
    '--m-radius-md': themeVars['--radius-md'],
    '--m-radius-lg': themeVars['--radius-lg'],
    '--m-radius-xl': themeVars['--radius-xl'],
    '--m-radius-full': themeVars['--radius-full'],
    '--m-shadow-sm': themeVars['--shadow-sm'],
    '--m-shadow-md': themeVars['--shadow-md'],
    '--m-shadow-lg': themeVars['--shadow-lg'],

    // ---- Status (platform-fixed, not manager-editable) ------------------
    '--m-success': themeVars['--theme-success'],
    '--m-warning': themeVars['--theme-warning'],
    '--m-error': themeVars['--theme-error'],
  };

  // Channel triplets for opacity-modified utilities (see channelTokens).
  Object.assign(tokens, channelTokens(tokens, brand, surfaceMode));

  // ---- Component layer --------------------------------------------------
  // Thin semantic aliases over identity/surface, with the stored per-component
  // groups (colors.button/card/badge/category) acting as explicit overrides.
  tokens['--m-card-bg'] = pick(
    themeVars['--card-bg'],
    `linear-gradient(160deg, ${tokens['--m-surface-raised']} 0%, ${tokens['--m-surface']} 100%)`
  );
  tokens['--m-card-border'] = pick(themeVars['--card-border'], tokens['--m-hairline']);
  tokens['--m-card-radius'] = themeVars['--card-radius'];
  tokens['--m-card-shadow'] = themeVars['--card-shadow'];

  tokens['--m-chip-bg'] = pick(themeVars['--category-bg'], tokens['--m-surface-raised']);
  tokens['--m-chip-text'] = pick(
    themeVars['--category-text'],
    `color-mix(in srgb, ${brand.muted} 70%, ${tokens['--m-text-muted']})`
  );
  tokens['--m-chip-active-bg'] = pick(themeVars['--category-active-bg'], 'transparent');
  // When an explicit active color exists it must paint OVER the brand
  // gradient, so the image layer is switched off. Mirrors the existing
  // --category-active-image contract exactly.
  tokens['--m-chip-active-image'] = pick(themeVars['--category-active-image'], brand.fill);
  tokens['--m-chip-active-text'] = pick(themeVars['--category-active-text'], brand.ink);

  tokens['--m-button-bg'] = pick(themeVars['--button-bg'], brand.fill);
  tokens['--m-button-text'] = pick(themeVars['--button-text'], brand.ink);
  tokens['--m-button-secondary-bg'] = pick(
    themeVars['--button-secondary-bg'],
    tokens['--m-surface-raised']
  );
  tokens['--m-button-secondary-text'] = pick(
    themeVars['--button-secondary-text'],
    tokens['--m-text']
  );

  tokens['--m-badge-bg'] = pick(themeVars['--badge-bg'], tokens['--m-surface-raised']);
  tokens['--m-badge-text'] = pick(themeVars['--badge-text'], tokens['--m-text']);
  tokens['--m-badge-radius'] = themeVars['--badge-radius'];

  return tokens;
}

/**
 * COMPATIBILITY ALIASES — temporary, deleted when migration completes.
 *
 * Re-emits every legacy token name (`--brand-*`, `--theme-*`, `--menu-*`,
 * `--bg-*`, `--radius-*`, `--shadow-*`, `--card-*`, `--category-*`, …) so that
 * customer components which have not yet migrated keep rendering byte-
 * identically. Values come from the SAME derivation as the semantic tokens, so
 * an alias can never disagree with its canonical counterpart.
 *
 * Note the `--menu-*` family: `index.css` currently derives it in CSS from
 * `--brand-*`. Emitting it explicitly here means the scope element no longer
 * depends on those `:root` / `[data-theme='light']` CSS blocks being present,
 * which is what allows the theme to be scoped to a subtree in Phase 2.
 */
export function buildCompatibilityAliases(
  theme: NormalizedTheme,
  surfaceMode: SurfaceMode
): TokenMap {
  const brand = buildBrandTokens(theme.brand.primary, theme.brand.accent, surfaceMode);
  const effective = toEffectiveThemeShape(theme);
  const themeVars = buildEffectiveThemeVars(effective, surfaceMode === 'dark');
  const surfaces = surfaceTokens(brand, surfaceMode);

  return {
    // Legacy tenant identity family.
    '--brand-primary': brand.primary,
    '--brand-accent': brand.accent,
    '--brand-primary-rgb': brand.primaryRgb,
    '--brand-accent-rgb': brand.accentRgb,
    '--brand-primary-strong': brand.primaryStrong,
    '--brand-accent-strong': brand.accentStrong,
    '--brand-primary-strong-rgb': brand.primaryStrongRgb,
    '--brand-ink': brand.ink,
    '--brand-fill': brand.fill,
    '--brand-soft': brand.soft,
    '--brand-soft-strong': brand.softStrong,
    '--brand-line': brand.line,
    '--brand-line-strong': brand.lineStrong,
    '--brand-glow': brand.glow,
    '--brand-muted': brand.muted,

    // The CSS-derived menu chrome family, now emitted explicitly so the scope
    // element is self-sufficient.
    '--menu-surface': surfaces['--m-surface'],
    '--menu-surface-raised': surfaces['--m-surface-raised'],
    '--menu-hairline': surfaces['--m-hairline'],
    '--menu-text-base': surfaces['--m-text-muted'],
    '--menu-text-strong': surfaces['--m-text'],
    '--menu-media-end': surfaces['--m-media-end'],

    // The full server-contract family (--theme-*, --bg-*, --radius-*, … ).
    ...themeVars,
  };
}

/**
 * The complete style payload for the customer scope element: canonical
 * semantic tokens plus the temporary aliases.
 *
 * One object, applied once, by one owner.
 */
export function buildCustomerThemeStyle(
  theme: NormalizedTheme,
  surfaceMode: SurfaceMode
): TokenMap {
  return {
    ...buildCompatibilityAliases(theme, surfaceMode),
    ...buildSemanticTokens(theme, surfaceMode),
  };
}

/**
 * Resolves the surface mode for a normalized theme.
 * Re-exported through this module so consumers need only one import and
 * cannot accidentally resolve mode twice with different inputs.
 */
export function resolveSurfaceMode(
  theme: NormalizedTheme,
  prefersDark: boolean
): SurfaceMode {
  return resolveThemeMode(theme.mode, prefersDark);
}
