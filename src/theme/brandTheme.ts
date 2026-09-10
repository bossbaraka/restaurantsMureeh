import { useEffect, useMemo } from 'react';

/**
 * Brand Theme Engine
 * ==================
 * Every tenant edits exactly two colors in "Branding Settings"
 * (`primaryColor` + `accentColor`). The customer menu is rendered on a dark
 * luxury canvas, so those two raw hex values are not enough on their own:
 * a restaurant that picks `#111111` would produce invisible buttons, and a
 * restaurant that picks `#FFF700` would produce unreadable white text.
 *
 * This module turns the two brand colors into a complete, contrast-safe set of
 * CSS custom properties that the menu consumes through plain CSS classes.
 * Re-theming a restaurant is therefore a single style write on <html> —
 * no React re-render, no re-mount of the product grid.
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

export const BRAND_THEME_STORAGE_KEY = 'merar_brand_theme';

export interface CachedBrandTheme {
  primary: string;
  accent: string;
  presetId?: string;
  restaurantId?: string;
  slug?: string;
}

export function getCachedBrandTheme(): CachedBrandTheme | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BRAND_THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.primary === 'string' && typeof parsed.accent === 'string') {
      return parsed;
    }
  } catch {}
  return null;
}

export function setCachedBrandTheme(theme: CachedBrandTheme): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BRAND_THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {}
}

export const BRAND_VAR_NAMES = [
  '--brand-primary',
  '--brand-accent',
  '--brand-primary-rgb',
  '--brand-accent-rgb',
  '--brand-primary-strong',
  '--brand-accent-strong',
  '--brand-primary-strong-rgb',
  '--brand-ink',
  '--brand-fill',
  '--brand-soft',
  '--brand-soft-strong',
  '--brand-line',
  '--brand-line-strong',
  '--brand-glow',
  '--brand-muted',
] as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------------------
// Color primitives
// ---------------------------------------------------------------------------

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` into RGB 0-255. */
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

/** Keeps a color inside a lightness window (used for solid CTA fills). */
export function clampLightness(color: Rgb, min: number, max: number): string {
  const hsl = rgbToHsl(color);
  return rgbToHex(hslToRgb({ ...hsl, l: clamp(hsl.l, min, max) }));
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

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

export function buildBrandTokens(primary?: string | null, accent?: string | null): BrandTokens {
  const primaryRgb = parseColor(primary) ?? (parseColor(BRAND_FALLBACK.primary) as Rgb);
  const accentRgb = parseColor(accent) ?? mixColors(primaryRgb, { r: 255, g: 255, b: 255 }, 0.25);

  const primaryHex = rgbToHex(primaryRgb);
  const accentHex = rgbToHex(accentRgb);
  const primaryStrong = liftForDark(primaryRgb);
  const accentStrong = liftForDark(accentRgb, 0.68, 0.28);

  const fillStart = clampLightness(primaryRgb, 0.4, 0.68);
  const fillEnd = clampLightness(accentRgb, 0.4, 0.72);
  const ink = readableInk(fillStart);

  const primaryHsl = rgbToHsl(primaryRgb);
  const accentHsl = rgbToHsl(accentRgb);

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
    // Dark, brand-tinted surfaces (the menu canvas is dark luxury).
    soft: hslToCss(primaryHsl.h, clamp(primaryHsl.s, 0.18, 0.42), 0.09),
    softStrong: hslToCss(primaryHsl.h, clamp(primaryHsl.s, 0.2, 0.46), 0.14),
    line: `rgb(${toRgbTuple(parseColor(primaryStrong) as Rgb)} / 0.22)`,
    lineStrong: `rgb(${toRgbTuple(parseColor(primaryStrong) as Rgb)} / 0.45)`,
    glow: `rgb(${toRgbTuple(parseColor(primaryStrong) as Rgb)} / 0.28)`,
    muted: hslToCss(accentHsl.h, clamp(accentHsl.s, 0.14, 0.4), 0.66),
  };
}

/**
 * Particle-field palette for the QR splash.
 *
 * The canvas API cannot consume `var(--brand-*)`, so the tenant colours are
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

function tokensToCssVars(tokens: BrandTokens): Record<string, string> {
  return {
    '--brand-primary': tokens.primary,
    '--brand-accent': tokens.accent,
    '--brand-primary-rgb': tokens.primaryRgb,
    '--brand-accent-rgb': tokens.accentRgb,
    '--brand-primary-strong': tokens.primaryStrong,
    '--brand-accent-strong': tokens.accentStrong,
    '--brand-primary-strong-rgb': tokens.primaryStrongRgb,
    '--brand-ink': tokens.ink,
    '--brand-fill': tokens.fill,
    '--brand-soft': tokens.soft,
    '--brand-soft-strong': tokens.softStrong,
    '--brand-line': tokens.line,
    '--brand-line-strong': tokens.lineStrong,
    '--brand-glow': tokens.glow,
    '--brand-muted': tokens.muted,
  };
}

/**
 * Writes the tenant palette onto <html> so every themed class updates at once.
 * Safe to call during render effects and from the server (no-op without DOM).
 */
export function applyBrandTheme(
  primary?: string | null,
  accent?: string | null,
  styleTarget?: { setProperty(name: string, value: string): void } | null,
  options?: { presetId?: string; restaurantId?: string; slug?: string }
): BrandTokens {
  const cached = getCachedBrandTheme();
  const effectivePrimary = primary || (primary === undefined && cached?.primary) || BRAND_FALLBACK.primary;
  const effectiveAccent = accent || (accent === undefined && cached?.accent) || BRAND_FALLBACK.accent;

  const tokens = buildBrandTokens(effectivePrimary, effectiveAccent);
  const target =
    styleTarget ?? (typeof document !== 'undefined' ? document.documentElement.style : null);
  if (target && typeof target.setProperty === 'function') {
    const vars = tokensToCssVars(tokens);
    for (const name of BRAND_VAR_NAMES) {
      target.setProperty(name, vars[name]);
    }
  }

  // Persist to local storage if non-empty primary or accent was provided
  if (primary || accent) {
    setCachedBrandTheme({
      primary: tokens.primary,
      accent: tokens.accent,
      presetId: options?.presetId ?? cached?.presetId,
      restaurantId: options?.restaurantId ?? cached?.restaurantId,
      slug: options?.slug ?? cached?.slug,
    });
  }

  return tokens;
}

/**
 * React binding: memoizes the palette for a tenant and keeps <html> in sync.
 * Returns the tokens so components that need inline styles (e.g. `ink` on a
 * brand-filled button) can read them without touching the DOM.
 */
export function useBrandTheme(
  primary?: string | null,
  accent?: string | null,
  options?: { presetId?: string; restaurantId?: string; slug?: string }
): BrandTokens {
  const cached = useMemo(() => getCachedBrandTheme(), []);
  const resolvedPrimary = primary || (primary === undefined && cached?.primary) || BRAND_FALLBACK.primary;
  const resolvedAccent = accent || (accent === undefined && cached?.accent) || BRAND_FALLBACK.accent;

  const tokens = useMemo(
    () => buildBrandTokens(resolvedPrimary, resolvedAccent),
    [resolvedPrimary, resolvedAccent]
  );

  useEffect(() => {
    applyBrandTheme(resolvedPrimary, resolvedAccent, null, options);
  }, [resolvedPrimary, resolvedAccent, options?.presetId, options?.restaurantId, options?.slug]);

  return tokens;
}

// Eager initialization: apply cached theme immediately on script evaluation
if (typeof window !== 'undefined') {
  try {
    const cached = getCachedBrandTheme();
    if (cached?.primary && cached?.accent) {
      applyBrandTheme(cached.primary, cached.accent, null, cached);
    }
  } catch {}
}
