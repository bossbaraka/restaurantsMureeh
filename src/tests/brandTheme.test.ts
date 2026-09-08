import { describe, expect, it } from 'vitest';
import {
  BRAND_FALLBACK,
  BRAND_VAR_NAMES,
  applyBrandTheme,
  buildBrandTokens,
  clampLightness,
  contrastRatio,
  liftForDark,
  parseColor,
  readableInk,
  relativeLuminance,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  type Rgb,
} from '../theme/brandTheme';

const rgb = (hex: string): Rgb => {
  const parsed = parseColor(hex);
  if (!parsed) throw new Error(`unparsable color in test: ${hex}`);
  return parsed;
};

describe('parseColor', () => {
  it('parses 6-digit hex, shorthand hex and rgba()', () => {
    expect(parseColor('#D4AF37')).toEqual({ r: 212, g: 175, b: 55 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#0A0B0DFF')).toEqual({ r: 10, g: 11, b: 13 });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor('rgba(10 20 30 / 0.5)')).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('rejects values it cannot understand', () => {
    expect(parseColor('banana')).toBeNull();
    expect(parseColor('#12')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor(null)).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });
});

describe('color conversions', () => {
  it('round-trips rgb -> hsl -> rgb', () => {
    for (const hex of ['#D4AF37', '#C5A880', '#7C3AED', '#00E5A0', '#FF3B30', '#0A0B0D']) {
      const original = rgb(hex);
      const back = hslToRgb(rgbToHsl(original));
      expect(Math.abs(back.r - original.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - original.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - original.b)).toBeLessThanOrEqual(1);
    }
  });

  it('measures luminance and contrast per WCAG', () => {
    expect(relativeLuminance(rgb('#000000'))).toBeCloseTo(0, 3);
    expect(relativeLuminance(rgb('#FFFFFF'))).toBeCloseTo(1, 3);
    expect(contrastRatio(rgb('#FFFFFF'), rgb('#000000'))).toBeCloseTo(21, 0);
  });

  it('normalizes back to uppercase hex', () => {
    expect(rgbToHex(rgb('#c5a880'))).toBe('#C5A880');
  });
});

describe('contrast-safe roles on the dark menu canvas', () => {
  it('chooses a readable label color for every solid CTA fill', () => {
    const brandColors = [
      BRAND_FALLBACK.primary,
      BRAND_FALLBACK.accent,
      '#000000',
      '#FFFFFF',
      '#7C3AED',
      '#FF3B30',
      '#00E5A0',
      '#0B3D91',
      '#F5C518',
    ];
    for (const hex of brandColors) {
      const fill = rgb(clampLightness(rgb(hex), 0.4, 0.68));
      const ink = rgb(readableInk(fill));
      expect(contrastRatio(fill, ink)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('lifts near-black brand picks so borders and text stay visible', () => {
    for (const hex of ['#000000', '#0A0B0D', '#101010', '#1B1B1B']) {
      const lifted = rgb(liftForDark(rgb(hex)));
      expect(relativeLuminance(lifted)).toBeGreaterThan(0.15);
    }
  });

  it('raises dim brand colors to the foreground floor, and never past it', () => {
    // Platform gold sits below the floor, so the foreground role is brightened
    // (this is the tone the menu text used before theming was dynamic).
    const gold = rgb(BRAND_FALLBACK.primary);
    const goldBefore = rgbToHsl(gold);
    const goldAfter = rgbToHsl(rgb(liftForDark(gold)));
    expect(goldAfter.l).toBeGreaterThanOrEqual(goldBefore.l);
    expect(goldAfter.l).toBeCloseTo(0.62, 1);
    expect(goldAfter.h).toBeCloseTo(goldBefore.h, 0);

    // An already-bright brand color is passed through untouched.
    const bright = rgb('#F5F0DC');
    const brightAfter = rgbToHsl(rgb(liftForDark(bright)));
    expect(brightAfter.l).toBeCloseTo(rgbToHsl(bright).l, 2);
  });

  it('does not invent a hue for achromatic brand picks', () => {
    const lifted = rgb(liftForDark(rgb('#000000')));
    expect(rgbToHsl(lifted).s).toBeLessThan(0.06);
    expect(relativeLuminance(lifted)).toBeGreaterThan(0.4);
  });
});

describe('buildBrandTokens', () => {
  it('falls back to the platform gold when a tenant has no usable colors', () => {
    const tokens = buildBrandTokens(undefined, undefined);
    expect(tokens.primary).toBe(BRAND_FALLBACK.primary.toUpperCase());
    const broken = buildBrandTokens('not-a-color', '#zzzzzz');
    expect(broken.primary).toBe(BRAND_FALLBACK.primary.toUpperCase());
  });

  it('keeps the tenant hue in the primary token', () => {
    const tokens = buildBrandTokens('#7C3AED', '#22D3EE');
    expect(tokens.primary).toBe('#7C3AED');
    expect(tokens.accent).toBe('#22D3EE');
    // The derived foreground stays in the same hue family (violet ~262deg).
    expect(rgbToHsl(rgb(tokens.primaryStrong)).h).toBeCloseTo(rgbToHsl(rgb('#7C3AED')).h, 0);
  });

  it('exposes rgb triples so CSS can compose alpha tints', () => {
    const tokens = buildBrandTokens('#D4AF37', '#C5A880');
    expect(tokens.primaryRgb).toBe('212 175 55');
    expect(tokens.primaryStrongRgb).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    expect(tokens.fill).toContain('linear-gradient(135deg');
  });
});

describe('applyBrandTheme', () => {
  it('writes every brand variable it declares', () => {
    const written = new Map<string, string>();
    const fakeStyle = { setProperty: (name: string, value: string) => void written.set(name, value) };

    applyBrandTheme('#0F766E', '#F59E0B', fakeStyle);

    expect(written.size).toBe(BRAND_VAR_NAMES.length);
    for (const name of BRAND_VAR_NAMES) {
      expect(written.has(name), `missing css var ${name}`).toBe(true);
      expect(written.get(name)?.length, `empty css var ${name}`).toBeGreaterThan(0);
    }
    expect(written.get('--brand-primary')).toBe('#0F766E');
    expect(written.get('--brand-ink')).toMatch(/^#(0A0B0D|FFFFFF)$/);
  });

  it('returns the tokens even without a DOM target', () => {
    const tokens = applyBrandTheme('#D4AF37', '#C5A880', null);
    expect(tokens.primary).toBe('#D4AF37');
  });
});
