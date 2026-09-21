/**
 * Theme Resolution — light/dark mode, mode-aware fallbacks, and the theme-first
 * brand identity contract.
 *
 * Pipeline under test:
 *   theme.mode + device preference → resolveThemeMode (RESOLVED surface mode)
 *     → resolveModeAwareColors (dark fallback palette never renders in light)
 *     → buildBrandTokens / buildEffectiveThemeVars → CSS variables + data-theme
 *
 * Guards the Part 5/6 invariants:
 *   1. `auto` collapses to a concrete surface mode (data-theme is never "auto"
 *      — no CSS selector could key on it);
 *   2. the platform's DARK fallback palette is remapped in light mode while
 *      tenant-chosen values pass through untouched (fallback never re-brands);
 *   3. brand identity adapts for contrast per surface without changing hue;
 *   4. every identity consumer reads the theme-first brand, never the legacy
 *      columns alone.
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyEffectiveTheme,
  backgroundToCssVars,
  buildBrandTokens,
  buildEffectiveThemeVars,
  deepenForLight,
  parseColor,
  resolveBrandIdentity,
  resolveModeAwareColors,
  resolveThemeMode,
  rgbToHsl,
  type EffectiveTheme,
} from '../theme/brandTheme';

const hslOf = (hex: string) => rgbToHsl(parseColor(hex)!);

/** The dark fallback palette exactly as the server resolver fills it. */
const darkServerColors = () => ({
  primary: '#D4AF37',
  secondary: '#C5A880',
  accent: '#C5A880',
  background: '#0A0B0D',
  surface: '#15171A',
  textPrimary: '#F5F5F0',
  textSecondary: '#A0A0A0',
  border: '#2A2D32',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
});

const effectiveTheme = (overrides: Partial<EffectiveTheme> = {}): EffectiveTheme =>
  ({
    mode: 'dark',
    colors: darkServerColors() as EffectiveTheme['colors'],
    radius: { sm: '6px', md: '10px', lg: '16px', xl: '24px', full: '9999px' },
    shadows: {
      sm: '0 1px 3px rgba(0,0,0,0.3)',
      md: '0 4px 20px rgba(0,0,0,0.4)',
      lg: '0 10px 40px rgba(0,0,0,0.5)',
    },
    typography: { fontFamily: 'auto', headingWeight: '700', bodyWeight: '400' },
    cards: {},
    background: {
      light: { type: 'solid', color: '#FFFFFF', url: null, storagePath: null },
      dark: { type: 'solid', color: '#0A0B0D', url: null, storagePath: null },
    },
    source: 'restaurant',
    rawConfig: {},
    ...overrides,
  }) as EffectiveTheme;

describe('resolveThemeMode — auto collapses to a concrete surface', () => {
  it('follows the device preference for auto', () => {
    expect(resolveThemeMode('auto', true)).toBe('dark');
    expect(resolveThemeMode('auto', false)).toBe('light');
  });

  it('lets an explicit mode win over the device', () => {
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
  });

  it('treats missing/invalid modes as auto', () => {
    expect(resolveThemeMode(undefined, false)).toBe('light');
    expect(resolveThemeMode('neon', true)).toBe('dark');
  });
});

describe('resolveModeAwareColors — the dark fallback never renders in light mode', () => {
  it('passes the dark palette through untouched in dark mode', () => {
    const out = resolveModeAwareColors(darkServerColors(), 'dark');
    expect(out.background).toBe('#0A0B0D');
    expect(out.textPrimary).toBe('#F5F5F0');
    expect(out.surface).toBe('#15171A');
  });

  it('remaps only the exact platform dark defaults in light mode', () => {
    const out = resolveModeAwareColors(darkServerColors(), 'light');
    // Surface/content roles flip to the light defaults…
    expect(out.background).toBe('#FFFFFF');
    expect(out.surface).toBe('#F6F7F9');
    expect(out.textPrimary).toBe('#171B22');
    expect(out.textSecondary).toBe('#5B6472');
    expect(out.border).toBe('#E3E7EE');
    // …while BRAND hues are never redefined by the mode.
    expect(out.primary).toBe('#D4AF37');
    expect(out.accent).toBe('#C5A880');
  });

  it('respects tenant-chosen values verbatim (both platform spellings only)', () => {
    const out = resolveModeAwareColors(
      { ...darkServerColors(), background: '#101828', textPrimary: '#FDF6E3' },
      'light'
    );
    expect(out.background).toBe('#101828');
    expect(out.textPrimary).toBe('#FDF6E3');
  });

  it('covers the client mapper default spellings too', () => {
    // api.mapEffectiveTheme fills slightly different fallbacks than the server.
    const out = resolveModeAwareColors(
      { surface: '#121416', textPrimary: '#F8FAFC', textSecondary: '#94A3B8', border: '#1E293B' },
      'light'
    );
    expect(out.surface).toBe('#F6F7F9');
    expect(out.textPrimary).toBe('#171B22');
    expect(out.textSecondary).toBe('#5B6472');
    expect(out.border).toBe('#E3E7EE');
  });

  it('fills missing surface roles with light defaults in light mode', () => {
    const out = resolveModeAwareColors({ background: undefined }, 'light');
    expect(out.background).toBe('#FFFFFF');
  });
});

describe('buildBrandTokens — identity adapts per surface without changing hue', () => {
  it('keeps the primary hue and darkens it for the light canvas', () => {
    const light = buildBrandTokens('#D4AF37', '#C5A880', 'light');
    expect(light.primary).toBe('#D4AF37');
    const strongHsl = hslOf(light.primaryStrong);
    const brandHsl = hslOf('#D4AF37');
    expect(strongHsl.h).toBeCloseTo(brandHsl.h, 0);
    expect(strongHsl.l).toBeLessThan(0.45);
  });

  it('keeps light surfaces genuinely light and muted ink readable', () => {
    const light = buildBrandTokens('#D4AF37', '#C5A880', 'light');
    // soft tokens are near-white hsl() strings in light mode…
    expect(light.soft).toMatch(/97%/);
    expect(light.softStrong).toMatch(/94%/);
    // …and muted is a dark hsl for secondary text on white.
    expect(light.muted).toMatch(/32%/);
  });

  it('keeps the dark canvas behavior byte-compatible with the legacy output', () => {
    const dark = buildBrandTokens('#D4AF37', '#C5A880', 'dark');
    const defaulted = buildBrandTokens('#D4AF37', '#C5A880');
    expect(dark).toEqual(defaulted);
    expect(hslOf(dark.primaryStrong).l).toBeGreaterThanOrEqual(0.6);
  });

  it('deepenForLight never invents lightness on the light canvas', () => {
    // A near-black brand stays near-black (readable on white as-is).
    const deep = deepenForLight(parseColor('#111111')!);
    expect(hslOf(deep).l).toBeLessThan(0.2);
  });
});

describe('buildEffectiveThemeVars — mode flows into the emitted tokens', () => {
  it('dark mode emits the resolved dark values unchanged', () => {
    const vars = buildEffectiveThemeVars(effectiveTheme(), true);
    expect(vars['--theme-bg']).toBe('#0A0B0D');
    expect(vars['--theme-text-primary']).toBe('#F5F5F0');
  });

  it('light mode remaps the dark fallback into the tokens', () => {
    const vars = buildEffectiveThemeVars(effectiveTheme({ mode: 'light' }), false);
    expect(vars['--theme-bg']).toBe('#FFFFFF');
    expect(vars['--theme-text-primary']).toBe('#171B22');
    expect(vars['--theme-surface']).toBe('#F6F7F9');
    expect(vars['--theme-border']).toBe('#E3E7EE');
  });

  it('auto + light device resolves the light tokens', () => {
    const vars = buildEffectiveThemeVars(effectiveTheme({ mode: 'auto' }), false);
    expect(vars['--theme-bg']).toBe('#FFFFFF');
  });

  it('emits the background-layer contract for the single CSS reader', () => {
    const theme = effectiveTheme({
      background: {
        light: { type: 'solid', color: '#FFFFFF', url: null, storagePath: null },
        dark: {
          type: 'image+overlay',
          url: 'https://cdn.example/bg.jpg',
          overlayColor: 'rgba(0,0,0,0.6)',
          overlayOpacity: 0.7,
          blur: 2,
          readabilityBoost: true,
        },
      },
    });
    const vars = buildEffectiveThemeVars(theme, true);
    expect(vars['--bg-current']).toContain('linear-gradient(rgba(0,0,0,0.6)');
    expect(vars['--bg-current']).toContain('bg.jpg');
    expect(vars['--bg-layer-opacity']).toBe('0.7');
    expect(vars['--bg-scrim']).toBe('rgba(0, 0, 0, 0.55)');
    expect(vars['--bg-blur']).toBe('2px');

    // A light-canvas variant with the same boost gets the LIGHT scrim.
    const lightTheme = effectiveTheme({
      mode: 'light',
      background: {
        light: {
          type: 'image+overlay',
          url: 'https://cdn.example/bg.jpg',
          overlayOpacity: 0.7,
          readabilityBoost: true,
        },
        dark: { type: 'solid', color: '#0A0B0D', url: null, storagePath: null },
      },
    });
    const lightVars = buildEffectiveThemeVars(lightTheme, false);
    expect(lightVars['--bg-scrim']).toBe('rgba(255, 255, 255, 0.65)');
  });

  it('keeps the readability scrim off unless the tenant asked for it', () => {
    const vars = buildEffectiveThemeVars(effectiveTheme(), true);
    expect(vars['--bg-scrim']).toBe('transparent');
  });
});

describe('applyEffectiveTheme — data-theme carries the RESOLVED mode', () => {
  it('never writes the literal "auto" into data-theme', () => {
    document.documentElement.removeAttribute('data-theme');
    applyEffectiveTheme(effectiveTheme({ mode: 'auto' }), null, { prefersDark: true });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme-config')).toBe('auto');

    applyEffectiveTheme(effectiveTheme({ mode: 'auto' }), null, { prefersDark: false });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('re-derives the brand foreground per surface on <html>', () => {
    applyEffectiveTheme(effectiveTheme({ mode: 'dark', colors: { ...darkServerColors() } as EffectiveTheme['colors'] }), null, { prefersDark: true });
    const darkStrong = document.documentElement.style.getPropertyValue('--brand-primary-strong');

    applyEffectiveTheme(effectiveTheme({ mode: 'light', colors: { ...darkServerColors() } as EffectiveTheme['colors'] }), null, { prefersDark: false });
    const lightStrong = document.documentElement.style.getPropertyValue('--brand-primary-strong');

    // Same brand, different contrast role per surface.
    expect(darkStrong).not.toBe(lightStrong);
    expect(hslOf(lightStrong).l).toBeLessThan(hslOf(darkStrong).l);
  });
});

describe('resolveBrandIdentity — theme-first, legacy fallback', () => {
  it('prefers the effective theme colors over the legacy columns', () => {
    const identity = resolveBrandIdentity({
      theme: { colors: { primary: '#123456', accent: '#654321' } },
      primaryColor: '#FF0000',
      accentColor: '#00FF00',
    });
    expect(identity).toEqual({ primary: '#123456', accent: '#654321' });
  });

  it('falls back to the legacy columns when no theme row exists', () => {
    const identity = resolveBrandIdentity({ primaryColor: '#FF0000', accentColor: '#00FF00' });
    expect(identity).toEqual({ primary: '#FF0000', accent: '#00FF00' });
  });

  it('is safe for null/undefined restaurants (white-label default)', () => {
    expect(resolveBrandIdentity(null)).toEqual({ primary: undefined, accent: undefined });
    expect(resolveBrandIdentity(undefined)).toEqual({ primary: undefined, accent: undefined });
  });
});

describe('backgroundToCssVars — overlay dimming stays on the layer contract', () => {
  it('dims only image+overlay layers', () => {
    const dimmed = backgroundToCssVars(
      { type: 'image+overlay', url: 'https://x/y.jpg', overlayOpacity: 0.85 },
      'dark'
    );
    expect(dimmed['--bg-layer-opacity']).toBe('0.85');

    const plain = backgroundToCssVars({ type: 'image', url: 'https://x/y.jpg' }, 'dark');
    expect(plain['--bg-layer-opacity']).toBe('1');
  });
});
