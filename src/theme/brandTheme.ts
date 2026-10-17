import type { EffectiveTheme, ResolvedBackground } from '../types/restaurant';

/**
 * Brand Theme Engine
 * ==================
 * Every tenant edits exactly two identity colors in "Branding Settings"
 * (`primaryColor` + `accentColor`). The restaurant's fixed light/dark mode
 * selects the surface; brand colors are then adapted for readable foregrounds
 * so a near-black pick cannot disappear and a bright pick cannot wash out text.
 *
 * This module derives a complete, contrast-safe set of semantic values. The
 * customer theme provider writes them to one scoped element, keeping restaurant
 * appearance independent from the platform and avoiding a product-grid remount.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface BrandTokens {
  primary: string;
  accent: string;
  primaryRgb: string;
  accentRgb: string;
  primaryStrong: string;
  accentStrong: string;
  primaryStrongRgb: string;
  ink: string;
  fill: string;
  soft: string;
  softStrong: string;
  line: string;
  lineStrong: string;
  glow: string;
  muted: string;
}

export const BRAND_FALLBACK = {
  primary: '#D4AF37',
  accent: '#C5A880',
} as const;


/**
 * The surface the brand palette is painted on. Brand IDENTITY (primary /
 * accent) never changes with it — only the contrast-adapted foreground roles
 * (`*-strong`) and the derived surface/hairline/muted tokens do, so a gold
 * brand reads gold-on-dark at night and deep-gold-on-white by day.
 */
export type SurfaceMode = 'light' | 'dark';

/**
 * Resolve a configured restaurant mode to a paintable surface. New settings
 * are explicit; legacy `auto`, missing, and invalid values safely fall back
 * to dark instead of consulting the visitor's device.
 */
export function resolveThemeMode(mode: string | undefined | null): SurfaceMode {
  return mode === 'light' ? 'light' : 'dark';
}

export const THEME_VAR_NAMES = [
  '--theme-primary',
  '--theme-secondary',
  '--theme-accent',
  '--theme-bg',
  '--theme-surface',
  '--theme-text-primary',
  '--theme-text-secondary',
  '--theme-border',
  '--theme-success',
  '--theme-warning',
  '--theme-error',
  '--button-bg',
  '--button-text',
  '--button-secondary-bg',
  '--button-secondary-text',
  '--card-bg',
  '--card-border',
  '--badge-bg',
  '--badge-text',
  '--category-bg',
  '--category-text',
  '--category-active-bg',
  '--category-active-text',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-full',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
  '--font-family',
  '--font-heading-weight',
  '--font-body-weight',
  '--button-radius',
  '--card-radius',
  '--card-shadow',
  '--badge-radius',
  '--bg-type',
  '--bg-color',
  '--bg-gradient',
  '--bg-image',
  '--bg-overlay',
  '--bg-overlay-opacity',
  '--bg-blur',
  '--bg-position',
  '--bg-size',
] as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------------------
// Color primitives
// ---------------------------------------------------------------------------

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` into RGB 0-255. */
/** Splits a comma list at depth 0 so nested functions stay intact. */
function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out.map((s) => s.trim());
}

export function parseColor(input?: string | null): Rgb | null {
  if (!input) return null;
  const value = String(input).trim();

  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    if (hex.length === 8) hex = hex.slice(0, 6);
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  // hsl()/hsla() — buildBrandTokens emits `soft`/`softStrong`/`muted` in this
  // form via hslToCss, so the surface ladder cannot be resolved to channels
  // without it.
  const hslMatch = value.match(/^hsla?\(([^)]+)\)$/i);
  if (hslMatch) {
    const parts = hslMatch[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map((p) => Number(p.replace('%', '')));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return hslToRgb({ h: parts[0], s: clamp(parts[1] / 100, 0, 1), l: clamp(parts[2] / 100, 0, 1) });
    }
  }

  // color-mix(in srgb, <color> <pct>%, <color>) — the surface tokens are
  // authored as mixes. Resolving them here keeps a single derivation of each
  // surface colour instead of duplicating the mix formula elsewhere.
  const mixMatch = value.match(/^color-mix\(\s*in\s+srgb\s*,\s*(.+)\)$/i);
  if (mixMatch) {
    const [rawA, rawB] = splitTopLevel(mixMatch[1]);
    if (rawA && rawB) {
      const pctA = rawA.match(/\s([\d.]+)%\s*$/);
      const pctB = rawB.match(/\s([\d.]+)%\s*$/);
      const colorA = parseColor(rawA.replace(/\s[\d.]+%\s*$/, '').trim());
      const bStr = rawB.replace(/\s[\d.]+%\s*$/, '').trim();
      // `transparent` contributes no colour, only alpha; for an opaque channel
      // approximation the remaining colour is the other operand.
      const colorB = bStr === 'transparent' ? colorA : parseColor(bStr);
      if (colorA && colorB) {
        const wA = pctA ? Number(pctA[1]) / 100 : pctB ? 1 - Number(pctB[1]) / 100 : 0.5;
        return mixColors(colorB, colorA, clamp(wA, 0, 1));
      }
    }
  }

  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (match) {
    const parts = match[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map((p) => Number(p.replace('%', '')));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return {
        r: Math.round(clamp(parts[0], 0, 255)),
        g: Math.round(clamp(parts[1], 0, 255)),
        b: Math.round(clamp(parts[2], 0, 255)),
      };
    }
  }

  return null;
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const lig = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  const segment = Math.floor(hue / 60) % 6;
  const table: [number, number, number][] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r1, g1, b1] = table[segment] ?? [0, 0, 0];
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

export function hslToCss(h: number, s: number, l: number, alpha?: number): string {
  const satPct = `${Math.round(clamp(s, 0, 1) * 100)}%`;
  const ligPct = `${Math.round(clamp(l, 0, 1) * 100)}%`;
  const hue = Math.round(((h % 360) + 360) % 360);
  return alpha === undefined
    ? `hsl(${hue} ${satPct} ${ligPct})`
    : `hsl(${hue} ${satPct} ${ligPct} / ${clamp(alpha, 0, 1)})`;
}

const toRgbTuple = ({ r, g, b }: Rgb): string => `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;

/** WCAG 2.1 relative luminance (0 = black, 1 = white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const DARK_INK = '#0A0B0D';
const LIGHT_INK = '#FFFFFF';

/** Picks black or white text for a given background (WCAG contrast winner). */
export function readableInk(background: Rgb | string): string {
  const bg = typeof background === 'string' ? parseColor(background) : background;
  if (!bg) return DARK_INK;
  const onDark = contrastRatio(bg, parseColor(DARK_INK) as Rgb);
  const onLight = contrastRatio(bg, parseColor(LIGHT_INK) as Rgb);
  return onDark >= onLight ? DARK_INK : LIGHT_INK;
}

/**
 * Foreground role of a brand color on the dark menu canvas: keeps the hue but
 * lifts lightness (and rescues near-black picks) so text, icons and hairline
 * borders stay visible. Achromatic picks (grey/black/white) are brightened
 * without inventing a hue, so a black brand stays a neutral silver.
 */
export function liftForDark(color: Rgb, minLightness = 0.62, minSaturation = 0.32): string {
  const hsl = rgbToHsl(color);
  const achromatic = hsl.s < 0.06;
  const l = Math.max(hsl.l, achromatic ? Math.max(minLightness, 0.72) : minLightness);
  const s = achromatic ? hsl.s : Math.max(hsl.s, minSaturation);
  return rgbToHex(hslToRgb({ h: hsl.h, s, l }));
}

/**
 * Keeps a color inside a lightness window (used for solid CTA fills).
 */
export function clampLightness(color: Rgb, min: number, max: number): string {
  const hsl = rgbToHsl(color);
  return rgbToHex(hslToRgb({ ...hsl, l: clamp(hsl.l, min, max) }));
}

/**
 * The white-label light canvas every light-mode role is measured against.
 *
 * `relativeLuminance` / `contrastRatio` above are the module's existing,
 * already-tested WCAG helpers (the CTA fill-vs-ink contract is asserted with
 * them) — the floor below reuses them rather than re-deriving luminance.
 */
const LIGHT_CANVAS: Rgb = { r: 255, g: 255, b: 255 };

/**
 * Light-mode counterpart of `liftForDark`: keeps the tenant hue but DARKENS
 * it into a foreground-safe range, so brand-colored text/icons/borders stay
 * readable on white surfaces (gold on white fails contrast; deep gold works).
 * Achromatic picks are darkened without inventing a hue.
 *
 * CONTRAST FLOOR (`minContrast`, light canvas only)
 * ------------------------------------------------
 * Clamping lightness alone does NOT make a hue readable: the platform's own
 * default gold (#D4AF37) lands on #A88924 at L=0.42, which is only 3.35:1 on
 * white — and `--m-brand-on-surface` is TEXT ink, not decoration. It paints the
 * dish price (17px/800), the table pill in the header, the resting "add"
 * button label and the meta icons, so a failing ratio there is a failing
 * primary decision surface, not a trim colour.
 *
 * The floor therefore keeps darkening (hue and saturation untouched, achromatic
 * picks included) until the result clears `minContrast` against the light
 * canvas, bounded by `floorLightness` so a hue that cannot get there
 * (pure yellow, for instance) degrades gracefully instead of collapsing to
 * black. Values that already pass are returned untouched, so every colour that
 * was compliant before still is.
 */
export function deepenForLight(
  color: Rgb,
  maxLightness = 0.42,
  minSaturation = 0.3,
  minContrast = 4.5,
  floorLightness = 0.12
): string {
  const hsl = rgbToHsl(color);
  const achromatic = hsl.s < 0.06;
  const capped = Math.min(hsl.l, maxLightness);
  const s = achromatic ? hsl.s : Math.max(hsl.s, minSaturation);

  let l = capped;
  let rgb = hslToRgb({ h: hsl.h, s, l });
  // ~1.5% lightness steps: fine enough to land just inside the target instead
  // of overshooting into a visibly different shade.
  while (l > floorLightness && contrastRatio(rgb, LIGHT_CANVAS) < minContrast) {
    l = Math.max(floorLightness, l - 0.015);
    rgb = hslToRgb({ h: hsl.h, s, l });
    if (l === floorLightness) break;
  }
  return rgbToHex(rgb);
}

/** Linear mix of two colors, `t = 0` -> a, `t = 1` -> b. */
export function mixColors(a: Rgb, b: Rgb, t: number): Rgb {
  const ratio = clamp(t, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * ratio),
    g: Math.round(a.g + (b.g - a.g) * ratio),
    b: Math.round(a.b + (b.b - a.b) * ratio),
  };
}

/**
 * Classic `rgba()` string for imperative painting (canvas 2D, SVG attributes).
 * CSS custom properties cannot be read mid-frame, so anything drawn on a
 * <canvas> needs real RGB values — this is the one sanctioned place where the
 * brand palette leaves CSS.
 */
export function rgbaCss({ r, g, b }: Rgb, alpha: number): string {
  const channel = (v: number) => Math.round(clamp(v, 0, 255));
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${clamp(alpha, 0, 1)})`;
}

/**
 * Alpha channel (0–1) carried by a RAW stored color value — `parseColor`
 * intentionally keeps RGB only, so the alpha is read here from the same
 * token shapes it already accepts: the 4th `rgba()` component (or its `%`
 * form) and `#RRGGBBAA`. Opaque formats (HEX6, `rgb()`) have no alpha
 * channel and return null (= fully opaque).
 */
export function extractAlpha(value: string | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  const fn = v.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 4) return null;
    const raw = parts[3];
    const n = Number(raw.endsWith('%') ? raw.slice(0, -1) : raw);
    if (!Number.isFinite(n)) return null;
    return clamp(raw.endsWith('%') ? n / 100 : n, 0, 1);
  }
  if (/^#[0-9a-fA-F]{8}$/.test(v)) {
    return clamp(parseInt(v.slice(7, 9), 16) / 255, 0, 1);
  }
  return null;
}

/**
 * The string a theme-editor color change is emitted as. Fields without an
 * alpha channel (and any opaque color) keep the HEX6 contract; once
 * alpha < 1 the value is emitted as `rgba(r, g, b, a)` so translucency is
 * never lost — the exact shape the server `overlayColor` schema and the CSS
 * `--bg-overlay` consumer already accept.
 */
export function formatColorOutput(rgb: Rgb, alpha: number): string {
  return alpha < 1 ? rgbaCss(rgb, alpha) : rgbToHex(rgb);
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

export function buildBrandTokens(
  primary?: string | null,
  accent?: string | null,
  surfaceMode: SurfaceMode = 'dark'
): BrandTokens {
  const primaryRgb = parseColor(primary) ?? (parseColor(BRAND_FALLBACK.primary) as Rgb);
  const accentRgb = parseColor(accent) ?? mixColors(primaryRgb, { r: 255, g: 255, b: 255 }, 0.25);

  const primaryHex = rgbToHex(primaryRgb);
  const accentHex = rgbToHex(accentRgb);
  // Foreground roles: lifted on the dark canvas, deepened on the light one —
  // identity hue preserved either way, contrast guaranteed by construction.
  const primaryStrong =
    surfaceMode === 'light' ? deepenForLight(primaryRgb, 0.4, 0.32) : liftForDark(primaryRgb);
  const accentStrong =
    surfaceMode === 'light' ? deepenForLight(accentRgb, 0.44, 0.26) : liftForDark(accentRgb, 0.68, 0.28);

  const fillStart = clampLightness(primaryRgb, 0.4, 0.68);
  const fillEnd = clampLightness(accentRgb, 0.4, 0.72);
  const ink = readableInk(fillStart);

  const primaryHsl = rgbToHsl(primaryRgb);
  const accentHsl = rgbToHsl(accentRgb);

  // Derived surfaces. Dark canvas: brand-tinted near-black. Light canvas:
  // brand-tinted near-white (the *-soft inputs themselves flip below through
  // the same tokens; buildSemanticTokens re-derives them per surfaceMode).
  const light = surfaceMode === 'light';
  return {
    primary: primaryHex,
    accent: accentHex,
    primaryRgb: toRgbTuple(primaryRgb),
    accentRgb: toRgbTuple(accentRgb),
    primaryStrong,
    accentStrong,
    primaryStrongRgb: toRgbTuple(parseColor(primaryStrong) as Rgb),
    ink,
    fill: `linear-gradient(135deg, ${fillStart} 0%, ${fillEnd} 100%)`,
    soft: light
      ? hslToCss(primaryHsl.h, clamp(primaryHsl.s, 0.14, 0.4), 0.965)
      : hslToCss(primaryHsl.h, clamp(primaryHsl.s, 0.18, 0.42), 0.09),
    softStrong: light
      ? hslToCss(primaryHsl.h, clamp(primaryHsl.s, 0.16, 0.42), 0.935)
      : hslToCss(primaryHsl.h, clamp(primaryHsl.s, 0.2, 0.46), 0.14),
    line: `rgb(${toRgbTuple(parseColor(primaryStrong) as Rgb)} / 0.22)`,
    lineStrong: `rgb(${toRgbTuple(parseColor(primaryStrong) as Rgb)} / 0.45)`,
    glow: `rgb(${toRgbTuple(parseColor(primaryStrong) as Rgb)} / 0.28)`,
    muted: light
      ? hslToCss(accentHsl.h, clamp(accentHsl.s, 0.12, 0.34), 0.32)
      : hslToCss(accentHsl.h, clamp(accentHsl.s, 0.14, 0.4), 0.66),
  };
}

/**
 * The PLATFORM DARK palette — the exact values the server fills into every
 * theme that does not override them (themeResolver FALLBACK_THEME). In LIGHT
 * mode these same values mean "unset", not "the tenant wants near-white text
 * on a white menu": any field still carrying them is substituted with its
 * light counterpart. Values the tenant actually chose (≠ these exact strings)
 * are always respected verbatim — this is a fallback remap, never a re-brand.
 */
const PLATFORM_DARK_DEFAULT_COLORS: Record<string, string[]> = {
  background: ['#0A0B0D'],
  surface: ['#15171A', '#121416'],
  textPrimary: ['#F5F5F0', '#F8FAFC'],
  textSecondary: ['#A0A0A0', '#94A3B8'],
  border: ['#2A2D32', '#1E293B'],
};

const PLATFORM_LIGHT_DEFAULT_COLORS: Record<string, string> = {
  background: '#FFFFFF',
  surface: '#F6F7F9',
  textPrimary: '#171B22',
  textSecondary: '#5B6472',
  border: '#E3E7EE',
};

/**
 * Mode-aware color resolution (PART 6 — Theme Resolution): light mode must
 * never render the dark fallback palette. `null`/undefined input colors fall
 * back to per-mode defaults; exact platform-dark default values flip to their
 * light equivalents; everything else passes through untouched.
 */
export function resolveModeAwareColors(
  colors: Record<string, string | undefined> | null | undefined,
  surfaceMode: SurfaceMode
): Record<string, string> {
  const source = colors && typeof colors === 'object' ? colors : {};
  const out: Record<string, string> = {};
  for (const key of Object.keys(source)) {
    const value = typeof source[key] === 'string' ? String(source[key]).trim() : '';
    if (surfaceMode === 'light') {
      if (!value) {
        const lightDefault = PLATFORM_LIGHT_DEFAULT_COLORS[key];
        out[key] = lightDefault || value;
        continue;
      }
      // Brand hues are mode-independent — only surface/content roles flip.
      const darkDefaults = PLATFORM_DARK_DEFAULT_COLORS[key];
      if (darkDefaults && darkDefaults.some((d) => d.toUpperCase() === value.toUpperCase())) {
        out[key] = PLATFORM_LIGHT_DEFAULT_COLORS[key] || value;
        continue;
      }
    }
    out[key] = value;
  }
  return out;
}

/**
 * Single source of the tenant brand identity used by every surface: the
 * effective theme's colors when the tenant carries one, with the legacy
 * `primaryColor`/`accentColor` columns as the fallback. Components must read
 * identity through this (or the `--m-brand*` tokens it paints) — never
 * straight off the legacy columns, which silently diverge once a Theme row
 * exists.
 */
export function resolveBrandIdentity(
  restaurant:
    | {
        theme?: { colors?: { primary?: string; accent?: string } | null } | null;
        primaryColor?: string | null;
        accentColor?: string | null;
      }
    | null
    | undefined
): { primary?: string; accent?: string } {
  const fromTheme = restaurant?.theme?.colors;
  return {
    primary: fromTheme?.primary || restaurant?.primaryColor || undefined,
    accent: fromTheme?.accent || restaurant?.accentColor || undefined,
  };
}

/**
 * Particle-field palette for the QR splash.
 *
 * The canvas API cannot consume `var(--m-brand*)`, so the tenant colours are
 * mixed here into a small luminance ramp. It is derived from
 * `primaryStrong`/`accentStrong` — not the raw brand hexes — so a tenant that
 * picks something as dark as `#111111` still gets a visible particle field
 * instead of black-on-black.
 */
export interface SplashPalette {
  /** Luminance-varied shades of the tenant brand, one per particle. */
  shades: Rgb[];
  /** Base colour of the connection lines drawn between particles. */
  link: Rgb;
  /** Canvas `shadowColor` used to bloom the larger particles. */
  glow: Rgb;
}

export function buildSplashPalette(tokens: BrandTokens): SplashPalette {
  const primary = parseColor(tokens.primaryStrong) ?? (parseColor(BRAND_FALLBACK.primary) as Rgb);
  const accent = parseColor(tokens.accentStrong) ?? primary;
  const white: Rgb = { r: 255, g: 255, b: 255 };
  const black: Rgb = { r: 0, g: 0, b: 0 };

  return {
    shades: [
      mixColors(primary, white, 0.38),
      primary,
      mixColors(accent, white, 0.22),
      mixColors(primary, black, 0.24),
    ],
    link: mixColors(primary, accent, 0.5),
    glow: primary,
  };
}




/**
 * Central Theme — EffectiveTheme -> CSS variables
 * =================================================
 * Maps the server-resolved EffectiveTheme (Platform→Restaurant→Branch) onto
 * CSS custom properties consumed by CustomerLayout and manager preview.
 * White-label preserved: no Mureeh branding injected.
 */

/**
 * One Arabic-first font family map for the restaurant menu. Legacy `auto`,
 * Amiri, Cormorant, and pre-contract keys are retained as input aliases but
 * deliberately render as Tajawal; Cairo remains the optional modern alternative.
 */
export const FONT_FAMILY_MAP: Record<string, string> = {
  auto: '"Tajawal", "Cairo", system-ui, sans-serif',
  tajawal: '"Tajawal", "Cairo", system-ui, sans-serif',
  cairo: '"Cairo", "Tajawal", system-ui, sans-serif',
  amiri: '"Tajawal", "Cairo", system-ui, sans-serif',
  cormorant: '"Tajawal", "Cairo", system-ui, sans-serif',
  inter: '"Tajawal", "Cairo", system-ui, sans-serif',
  poppins: '"Tajawal", "Cairo", system-ui, sans-serif',
};

export type ThemeShadowKey = 'sm' | 'md' | 'lg';

const THEME_SHADOW_KEYS: readonly ThemeShadowKey[] = ['sm', 'md', 'lg'];

/**
 * Resolves `colors.card.shadow` to a real CSS shadow. The value is either a
 * key into the `shadows` scale (`sm` | `md` | `lg` — what the manager select
 * stores) or a raw CSS shadow string (what the server contract holds). Keys
 * resolve against the scale; anything else passes through untouched.
 */
export function resolveThemeShadow(
  value: string | undefined | null,
  shadows: Partial<Record<ThemeShadowKey, string>> | undefined
): string {
  const v = (value || '').trim();
  if ((THEME_SHADOW_KEYS as readonly string[]).includes(v)) {
    return shadows?.[v as ThemeShadowKey] || shadows?.md || '';
  }
  return v;
}

/**
 * Inverse of `resolveThemeShadow`: returns the scale key when the stored CSS
 * shadow matches one of the scale entries (so the manager select round-trips),
 * or `null` for a custom CSS shadow.
 */
export function themeShadowKey(
  value: string | undefined | null,
  shadows: Partial<Record<ThemeShadowKey, string>> | undefined
): ThemeShadowKey | null {
  const v = (value || '').trim();
  if ((THEME_SHADOW_KEYS as readonly string[]).includes(v)) return v as ThemeShadowKey;
  for (const key of THEME_SHADOW_KEYS) {
    if (v && shadows?.[key] === v) return key;
  }
  return null;
}

export function resolveCurrentBackground(
  theme: EffectiveTheme,
  surfaceMode: SurfaceMode = resolveThemeMode(theme.mode)
): ResolvedBackground {
  return surfaceMode === 'light' ? theme.background.light : theme.background.dark;
}

/**
 * Readability scrim (the UI's «تحسين قابلية القراءة» checkbox) resolved to a
 * real CSS paint for the current surface mode — light scrim on light canvases,
 * dark scrim on dark ones. `transparent` when the boost is off.
 */
function readabilityScrim(bg: ResolvedBackground, surfaceMode: SurfaceMode): string {
  const enabled =
    bg.readabilityBoost === true ||
    !!(bg as { readability?: { scrimOpacity?: number } }).readability?.scrimOpacity;
  if (!enabled) return 'transparent';
  return surfaceMode === 'light' ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.55)';
}

export function backgroundToCssVars(bg: ResolvedBackground, surfaceMode: SurfaceMode = 'dark'): Record<string, string> {
  const vars: Record<string, string> = {
    '--bg-type': bg.type,
    '--bg-color': bg.color || '',
    '--bg-gradient': bg.gradient || '',
    '--bg-image': bg.url ? `url("${bg.url}")` : '',
    '--bg-image-url': bg.url || '',
    '--bg-overlay': bg.overlayColor || '',
    '--bg-overlay-opacity': String(bg.overlayOpacity ?? 0.5),
    '--bg-blur': `${bg.blur ?? 0}px`,
    '--bg-position': bg.position || 'center',
    '--bg-size': bg.size || 'cover',
    // Opacity of the whole backdrop layer (image+overlay dims the photo) and
    // the readability scrim painted by the layer's ::after — both consumed by
    // the single `.customer-bg-layer` rule (one background writer, no inline
    // duplicate in CustomerLayout).
    '--bg-layer-opacity': String(bg.type === 'image+overlay' ? bg.overlayOpacity ?? 0.85 : 1),
    '--bg-scrim': readabilityScrim(bg, surfaceMode),
  };
  // Convenience composite for background layer
  if (bg.type === 'solid' && bg.color) {
    vars['--bg-current'] = bg.color;
  } else if (bg.type === 'gradient' && bg.gradient) {
    vars['--bg-current'] = bg.gradient;
  } else if ((bg.type === 'image' || bg.type === 'image+overlay') && bg.url) {
    const overlay =
      bg.type === 'image+overlay' && bg.overlayColor
        ? `linear-gradient(${bg.overlayColor}, ${bg.overlayColor}), `
        : '';
    vars['--bg-current'] = `${overlay}url("${bg.url}")`;
  } else {
    vars['--bg-current'] = bg.color || bg.gradient || 'transparent';
  }
  return vars;
}

export function buildEffectiveThemeVars(
  theme: EffectiveTheme,
  surfaceMode: SurfaceMode = resolveThemeMode(theme.mode)
): Record<string, string> {
  const currentBg = resolveCurrentBackground(theme, surfaceMode);
  const bgVars = backgroundToCssVars(currentBg, surfaceMode);
  // Legacy scalar roles remain available to the manager's compatibility model;
  // the customer scope now consumes only the canonical `--m-*` palette.
  const modeColors = resolveModeAwareColors(
    theme.colors as unknown as Record<string, string | undefined>,
    surfaceMode
  );

  return {
    // Colors
    '--theme-primary': modeColors.primary || theme.colors.primary,
    '--theme-secondary': modeColors.secondary || theme.colors.secondary,
    '--theme-accent': modeColors.accent || theme.colors.accent,
    '--theme-bg': modeColors.background || theme.colors.background,
    '--theme-surface': modeColors.surface || theme.colors.surface,
    '--theme-text-primary': modeColors.textPrimary || theme.colors.textPrimary,
    '--theme-text-secondary': modeColors.textSecondary || theme.colors.textSecondary,
    '--theme-border': modeColors.border || theme.colors.border,
    '--theme-success': theme.colors.success,
    '--theme-warning': theme.colors.warning,
    '--theme-error': theme.colors.error,
    // Per-component colour groups (colors.button/card/badge/category). These
    // are OPTIONAL overrides: an absent group emits an empty value, which
    // `setProperty` treats as a removal — so the CSS consumers keep their
    // `var(--token, <current visual>)` fallbacks (the canonical
    // derived palette) until a theme explicitly sets the group.
    '--button-bg': theme.colors.button?.primaryBg || '',
    '--button-text': theme.colors.button?.primaryText || '',
    '--button-secondary-bg': theme.colors.button?.secondaryBg || '',
    '--button-secondary-text': theme.colors.button?.secondaryText || '',
    '--card-bg': theme.colors.card?.bg || '',
    '--card-border': theme.colors.card?.border || '',
    '--badge-bg': theme.colors.badge?.bg || '',
    '--badge-text': theme.colors.badge?.text || '',
    '--category-bg': theme.colors.category?.bg || '',
    '--category-text': theme.colors.category?.text || '',
    '--category-active-bg': theme.colors.category?.activeBg || '',
    '--category-active-text': theme.colors.category?.activeText || '',
    // An explicit activeBg color must paint OVER the brand gradient, so when
    // it exists we emit `none` for the image layer (else removed → the CSS
    // fallback keeps the brand fill).
    '--category-active-image': theme.colors.category?.activeBg ? 'none' : '',
    // Radius — the scale is the source of truth; `colors.card.radius` is the
    // only per-component radius override in the server contract.
    '--radius-sm': theme.radius.sm,
    '--radius-md': theme.radius.md,
    '--radius-lg': theme.radius.lg,
    '--radius-xl': theme.radius.xl,
    '--radius-full': theme.radius.full,
    '--button-radius': theme.radius.md,
    '--card-radius': theme.cards?.radius || theme.radius.lg,
    '--badge-radius': theme.radius.full,
    // Shadows — same precedence: `colors.card.shadow` override, else the scale.
    '--shadow-sm': theme.shadows.sm,
    '--shadow-md': theme.shadows.md,
    '--shadow-lg': theme.shadows.lg,
    '--card-shadow': resolveThemeShadow(theme.cards?.shadow, theme.shadows) || theme.shadows.md,
    // Typography
    '--font-family': FONT_FAMILY_MAP[theme.typography.fontFamily] || FONT_FAMILY_MAP.auto,
    '--font-heading-weight': theme.typography.headingWeight,
    '--font-body-weight': theme.typography.bodyWeight,
    // Background (current resolved)
    ...bgVars,
    // Light/Dark variants for preview switching
    '--bg-light-type': theme.background.light.type,
    '--bg-light-color': theme.background.light.color || '',
    '--bg-light-gradient': theme.background.light.gradient || '',
    '--bg-light-image': theme.background.light.url ? `url("${theme.background.light.url}")` : '',
    '--bg-dark-type': theme.background.dark.type,
    '--bg-dark-color': theme.background.dark.color || '',
    '--bg-dark-gradient': theme.background.dark.gradient || '',
    '--bg-dark-image': theme.background.dark.url ? `url("${theme.background.dark.url}")` : '',
  };
}

/**
 * @deprecated LEGACY ENGINE — no production caller remains (Phase 1/2).
 *
 * Retained only so the pre-existing test suite can keep asserting the legacy
 * behaviour that new code is verified against for semantic equivalence.
 *
 * DO NOT CALL FROM APPLICATION CODE. It writes customer theme tokens AND
 * `data-theme` onto <html>, which violates both ownership rules: the customer
 * theme is scoped to the customer subtree (CustomerThemeProvider), and <html>
 * appearance belongs to the platform (PlatformAppearanceProvider).
 *
 * Removed together with the compatibility aliases once every customer
 * component has migrated to the --m-* tokens.
 */
export function applyEffectiveTheme(
  theme: EffectiveTheme | null | undefined,
  styleTarget?: { setProperty(name: string, value: string): void } | null,
  options?: { surfaceMode?: SurfaceMode }
): void {
  if (!theme) return;
  const target =
    styleTarget ?? (typeof document !== 'undefined' ? document.documentElement.style : null);
  if (!target || typeof (target as any).setProperty !== 'function') return;

  // Optional explicit face is useful for isolated previews. Normal rendering
  // always follows the stored restaurant mode; legacy `auto` falls back dark.
  const surfaceMode = options?.surfaceMode ?? resolveThemeMode(theme.mode);
  const vars = buildEffectiveThemeVars(theme, surfaceMode);
  for (const [k, v] of Object.entries(vars)) {
    (target as any).setProperty(k, v);
  }

  // Set a concrete mode for legacy diagnostics; `auto` is never exposed.
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', surfaceMode);
    document.documentElement.setAttribute('data-theme-config', surfaceMode);
    document.documentElement.setAttribute('data-theme-source', theme.source);
    document.documentElement.style.setProperty('--theme-mode', surfaceMode);
    document.documentElement.style.setProperty('--theme-mode-config', surfaceMode);
  }
}


/**
 * MODULE-LOAD SIDE EFFECT REMOVED (theme single-writer foundation).
 *
 * This module used to paint the cached brand palette onto <html> at IMPORT
 * TIME. That made a pure color-math module a DOM writer: merely importing a
 * helper (e.g. `parseColor` in a manager form, or `buildBrandTokens` in the
 * social-export utility) repainted the tenant palette — always contrast-
 * adapted to the DARK canvas, because the eager call could not know the
 * resolved mode. In a light-mode menu it therefore installed dark-surface
 * tokens before any mode-aware code had run, and it fired in tests and on the
 * platform shell where no tenant theme applies at all.
 *
 * First paint is now owned by `CustomerThemeProvider`, which resolves the mode
 * first and applies tokens to the customer scope only. The legacy writer
 * (applyBrandTheme), its React binding (useBrandTheme) and the localStorage
 * cache helpers were deleted with the --brand-* family on 2026-10-16: the
 * canonical --m-* tokens are the only palette channel now.
 */
