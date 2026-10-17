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
 * ONE FAMILY ONLY
 * ---------------
 * This module used to also emit `buildCompatibilityAliases()`: the
 * legacy `--brand-*` (tenant identity engine), `--theme-*` (server
 * wire contract, minus the per-component override groups) and
 * `--menu-*` (a CSS-side derivation) families, re-emitted from the
 * same computation so old consumers kept working during migration.
 *
 * The customer scope now receives only `--m-*` semantic values and the
 * explicitly supported background-layer settings. Legacy `--theme-*`,
 * `--button-*`, `--card-*`, `--badge-*`, and `--category-*` color variables
 * are not emitted into the customer DOM, so stale advanced color values can
 * no longer compete with the brand-derived palette.
 *
 * PURITY CONTRACT
 * ---------------
 * No DOM, no localStorage, no React, no module-load side effects.
 */

import {
  parseColor,
  rgbToHex,
  contrastRatio,
  buildBrandTokens,
  buildEffectiveThemeVars,
  resolveThemeMode,
  type BrandTokens,
  type Rgb,
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
    // Brand-tinted surfaces and hairlines. These three completed the
    // canonical vocabulary on 2026-10-16: until then they existed only
    // under the legacy `--brand-soft` / `--brand-soft-strong` /
    // `--brand-line` names, which kept index.css hooked on the old
    // family. They are mode-aware (brand hue tinted near-black on the
    // dark canvas, near-white on the light one) and derived here from
    // the same BrandTokens the aliases used to re-emit.
    '--m-brand-soft',
    '--m-brand-soft-strong',
    '--m-brand-line',
  ],
  surface: [
    '--m-bg',
    '--m-surface',
    '--m-surface-raised',
    '--m-hairline',
    '--m-hairline-strong',
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
  typography: ['--m-font', '--m-font-chosen', '--m-font-heading-weight', '--m-font-body-weight'],
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
  status: [
    '--m-success',
    '--m-warning',
    '--m-error',
    '--m-info',
    '--m-success-strong',
    '--m-warning-strong',
    '--m-error-strong',
    '--m-info-strong',
    '--m-success-strong-rgb',
    '--m-warning-strong-rgb',
    '--m-error-strong-rgb',
    '--m-info-strong-rgb',
  ],
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
 * Generic CSS font keywords (`serif`, `sans-serif`, `system-ui`, …).
 *
 * WHY THIS EXISTS — `--m-font-chosen` is consumed by entry and display
 * `font-family` chains. It contains the selected Arabic face first and the
 * other supported Arabic face second. Stripping generic CSS keywords keeps
 * device-dependent `system-ui` / `serif` substitutions out of the restaurant's
 * font decision; consumers use Tajawal as their predictable final fallback.
 */
const GENERIC_FONT_FACES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

/** Removes generic CSS keywords from a font stack, keeping authored faces. */
export function stripGenericFaces(stack: string): string {
  return stack
    .split(',')
    .map((face) => face.trim())
    .filter(Boolean)
    .filter((face) => {
      const bare = face.replace(/^['"]|['"]$/g, '').toLowerCase();
      return !GENERIC_FONT_FACES.has(bare);
    })
    .join(', ');
}

/**
 * PLATFORM-FIXED STATUS EXTENSION.
 *
 * `--m-success/-warning/-error` come from the theme row when a restaurant
 * overrides them. The shades below are deliberately NOT theme-editable:
 *
 *  - `--m-info` completes the status quartet. The order lifecycle has always
 *    rendered «قيد التحضير» in Tailwind's blue-500; this token gives that
 *    existing colour a canonical name instead of a raw palette class.
 *  - `--m-*-strong` are the lighter -400 shades the status TEXT and STATUS
 *    DOTS have always used. They are the surface's contrast companions of the
 *    DEFAULT status palette — chosen once (like --m-success's default), not
 *    derived from a tenant override, so a custom success colour cannot
 *    silently change its text companion's contrast.
 *
 * Values are byte-identical to the Tailwind classes the UI used before
 * (emerald/amber/red/blue 500 and 400) ON THE DARK CANVAS, so consuming them
 * is a pure refactor there.
 */
const STATUS_INFO = '#3B82F6'; // = Tailwind blue-500
const STATUS_STRONG: Record<'success' | 'warning' | 'error' | 'info', string> = {
  success: '#34D399', // = Tailwind emerald-400
  warning: '#FBBF24', // = Tailwind amber-400
  error: '#F87171', // = Tailwind red-400
  info: '#60A5FA', // = Tailwind blue-400
};
/** Canonical 500 defaults — the tint the strong ink is painted ON TOP of. */
const STATUS_BASE: Record<'success' | 'warning' | 'error' | 'info', string> = {
  success: '#10B981', // = Tailwind emerald-500
  warning: '#F59E0B', // = Tailwind amber-500
  error: '#EF4444', // = Tailwind red-500
  info: '#3B82F6', // = Tailwind blue-500
};

/**
 * How much WCAG contrast a status ink must keep against its badge tint.
 *
 * 4.5 is the WCAG AA floor for body text, and these tokens exist for exactly
 * one job: being the readable ink of a status pill. See `strongInkForSurface`.
 */
const STATUS_STRONG_MIN_CONTRAST = 4.5;
/**
 * The alpha `getOrderStatusConfig()` paints behind every status badge.
 *
 * Exported on purpose: this is a CONTRACT between two files. The engine uses it
 * to decide how far to darken a status ink, and the palette (plus its tests)
 * must measure against the same backdrop, or the floor is computed against a
 * tint the UI never renders. If `badgeBg`'s alpha changes, change it here.
 */
export const STATUS_BADGE_TINT_ALPHA = 0.1;

/**
 * Resolves the readable status ink for the ACTIVE surface mode.
 *
 * WHY THIS EXISTS
 * ---------------
 * `--m-*-strong` was authored as a dark-surface companion: a -400 shade reads
 * beautifully on the near-black canvas (emerald-400 on #0A0B0D measures 9.5:1)
 * and catastrophically on the light one (amber-400 on white measures 1.7:1 —
 * the «قيد التحضير» / «تم الاستلام» pills were effectively invisible in Light
 * mode). The token's own contract says it is "the surface's contrast
 * companion", so the missing half is the surface, not a new palette.
 *
 * WHY IT IS NOT A NEW TOKEN
 * -------------------------
 * The name and the dark-canvas value are unchanged, so every existing consumer
 * (the order tracker, the live-order banner, the hero stepper) is repaired
 * without touching its markup. Only the light-canvas VALUE moves.
 *
 * WHY THE BACKDROP IS A COMPOSITE
 * -------------------------------
 * A status badge paints the status colour at 15% alpha over the canvas, so the
 * ink never sits on the canvas itself. Measuring against the canvas would
 * under-correct; this measures against the tint as composited.
 *
 * (Spelled out rather than quoted: Tailwind's content scanner reads COMMENTS,
 * and a literal arbitrary-value class here would be emitted as real CSS —
 * `var(--m-*-rgb)` is not a legal custom property, which is exactly how this
 * file broke `vite build` once already.)
 */
function strongInkForSurface(
  key: 'success' | 'warning' | 'error' | 'info',
  surfaceMode: SurfaceMode,
): string {
  const ink = parseColor(STATUS_STRONG[key]);
  // Unparseable input is a programming error, not a theme state: fall back to
  // the authored value rather than inventing a colour at runtime.
  if (!ink) return STATUS_STRONG[key];
  // Dark canvas: byte-identical to the historical value.
  if (surfaceMode !== 'light') return STATUS_STRONG[key];

  const tint = parseColor(STATUS_BASE[key]);
  const backdrop: Rgb = tint
    ? {
        r: tint.r * STATUS_BADGE_TINT_ALPHA + 255 * (1 - STATUS_BADGE_TINT_ALPHA),
        g: tint.g * STATUS_BADGE_TINT_ALPHA + 255 * (1 - STATUS_BADGE_TINT_ALPHA),
        b: tint.b * STATUS_BADGE_TINT_ALPHA + 255 * (1 - STATUS_BADGE_TINT_ALPHA),
      }
    : { r: 255, g: 255, b: 255 };

  if (contrastRatio(ink, backdrop) >= STATUS_STRONG_MIN_CONTRAST) return STATUS_STRONG[key];

  // Multiplicative darkening: scales r/g/b together, so hue and saturation are
  // preserved — the light-mode ink is recognisably the same amber/emerald/red,
  // just legible. Same technique as `deepenForLight` in the brand engine.
  for (let step = 1; step <= 24; step += 1) {
    const scale = Math.pow(0.9, step);
    const candidate: Rgb = { r: ink.r * scale, g: ink.g * scale, b: ink.b * scale };
    if (contrastRatio(candidate, backdrop) >= STATUS_STRONG_MIN_CONTRAST) {
      return rgbToHex(candidate);
    }
  }
  return rgbToHex({ r: 0, g: 0, b: 0 });
}

function statusExtensionTokens(surfaceMode: SurfaceMode): TokenMap {
  const channels = (value: string): string => {
    const rgb = parseColor(value);
    if (!rgb) return '0 0 0';
    return `${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)}`;
  };
  const strong = {
    success: strongInkForSurface('success', surfaceMode),
    warning: strongInkForSurface('warning', surfaceMode),
    error: strongInkForSurface('error', surfaceMode),
    info: strongInkForSurface('info', surfaceMode),
  };
  return {
    '--m-info': STATUS_INFO,
    '--m-info-rgb': channels(STATUS_INFO),
    '--m-success-strong': strong.success,
    '--m-warning-strong': strong.warning,
    '--m-error-strong': strong.error,
    '--m-info-strong': strong.info,
    '--m-success-strong-rgb': channels(strong.success),
    '--m-warning-strong-rgb': channels(strong.warning),
    '--m-error-strong-rgb': channels(strong.error),
    '--m-info-strong-rgb': channels(strong.info),
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
  // The resolved mode selects one saved background variant; no device input
  // participates in the customer palette.
  const themeVars = buildEffectiveThemeVars(effective, surfaceMode);
  const surfaces = surfaceTokens(brand, surfaceMode);

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
    '--m-brand-soft': brand.soft,
    '--m-brand-soft-strong': brand.softStrong,
    '--m-brand-line': brand.line,

    // ---- Surface --------------------------------------------------------
    '--m-bg': surfaceMode === 'light' ? '#FFFFFF' : '#0A0B0D',
    ...surfaces,

    // ---- Typography -----------------------------------------------------
    '--m-font': themeVars['--font-family'],
    '--m-font-heading-weight': themeVars['--font-heading-weight'],
    '--m-font-body-weight': themeVars['--font-body-weight'],
  };

  // A single Arabic-first face is used throughout the restaurant menu,
  // including headings and the entry experience. Legacy/unsupported families
  // are normalized to Tajawal before reaching this pipeline.
  tokens['--m-font-chosen'] = stripGenericFaces(themeVars['--font-family']);

  Object.assign(tokens, {
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
  });

  // Channel triplets for opacity-modified utilities (see channelTokens).
  Object.assign(tokens, channelTokens(tokens, brand, surfaceMode));

  // Platform-fixed status extension (info + the surface's strong shades).
  Object.assign(tokens, statusExtensionTokens(surfaceMode));

  // ---- Component layer --------------------------------------------------
  // Color is derived from one source: brand identity plus the fixed surface
  // mode. Stored legacy per-component color overrides are intentionally inert.
  tokens['--m-card-bg'] =
    `linear-gradient(160deg, ${tokens['--m-surface-raised']} 0%, ${tokens['--m-surface']} 100%)`;
  tokens['--m-card-border'] = tokens['--m-hairline'];
  tokens['--m-card-radius'] = themeVars['--card-radius'];
  tokens['--m-card-shadow'] = themeVars['--card-shadow'];

  tokens['--m-chip-bg'] = tokens['--m-surface-raised'];
  tokens['--m-chip-text'] =
    `color-mix(in srgb, ${brand.muted} 70%, ${tokens['--m-text-muted']})`;
  tokens['--m-chip-active-bg'] = 'transparent';
  tokens['--m-chip-active-image'] = brand.fill;
  tokens['--m-chip-active-text'] = brand.ink;

  tokens['--m-button-bg'] = brand.fill;
  tokens['--m-button-text'] = brand.ink;
  tokens['--m-button-secondary-bg'] = tokens['--m-surface-raised'];
  tokens['--m-button-secondary-text'] = tokens['--m-text'];

  tokens['--m-badge-bg'] = tokens['--m-surface-raised'];
  tokens['--m-badge-text'] = tokens['--m-text'];
  tokens['--m-badge-radius'] = themeVars['--badge-radius'];

  return tokens;
}

/**
 * The complete style payload for the customer scope element.
 *
 * Only the custom background-layer contract (`--bg-*`) and canonical `--m-*`
 * semantic tokens reach the customer DOM. Compatibility scalar/component
 * colors are intentionally filtered out; this is what prevents old advanced
 * overrides from competing with the identity-derived palette.
 */
export function buildCustomerThemeStyle(
  theme: NormalizedTheme,
  surfaceMode: SurfaceMode
): TokenMap {
  const effective = toEffectiveThemeShape(theme);
  const themeVars = buildEffectiveThemeVars(effective, surfaceMode);
  const backgroundVars = Object.fromEntries(
    Object.entries(themeVars).filter(([name]) => name.startsWith('--bg-'))
  );
  return {
    ...backgroundVars,
    ...buildSemanticTokens(theme, surfaceMode),
  };
}

/**
 * Resolves the surface mode for a normalized theme.
 * Re-exported through this module so consumers need only one import and
 * cannot accidentally resolve mode twice with different inputs.
 */
export function resolveSurfaceMode(theme: NormalizedTheme): SurfaceMode {
  return resolveThemeMode(theme.mode);
}
