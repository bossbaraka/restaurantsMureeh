/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractAlpha, formatColorOutput, parseColor } from '../theme/brandTheme';
import { ThemeColorField } from '../components/manager/ThemeColorField';

// ============================================================================
// Finding #6 — overlay colors are color + ALPHA, not plain HEX.
//
// Server contract (schemas.ts `overlayColor`): #RRGGBB | rgb()/rgba() |
// hsl()/hsla(). The engine paints the value verbatim (`--bg-overlay`,
// image+overlay gradient). A HEX-only field lost the alpha the moment an
// existing rgba() value was edited. These tests pin the preserved contract:
// read alpha from the stored formats, emit rgba(r, g, b, a) while alpha < 1,
// keep HEX6 for opaque values, and NEVER write back on mount.
// ============================================================================

describe('extractAlpha — reads the alpha channel of stored overlay values', () => {
  it('opaque formats carry no alpha channel (null = fully opaque)', () => {
    expect(extractAlpha('#000000')).toBeNull();
    expect(extractAlpha('#123456')).toBeNull();
    expect(extractAlpha('rgb(10, 20, 30)')).toBeNull();
    expect(extractAlpha(undefined)).toBeNull();
    expect(extractAlpha('')).toBeNull();
  });

  it('rgba() alpha is read from the 4th component (plain and % forms)', () => {
    expect(extractAlpha('rgba(0,0,0,0.45)')).toBeCloseTo(0.45, 10);
    expect(extractAlpha('rgba(255,255,255,0.8)')).toBeCloseTo(0.8, 10);
    expect(extractAlpha('rgba(10, 20, 30, 1)')).toBe(1);
    expect(extractAlpha('rgba(10, 20, 30, 50%)')).toBeCloseTo(0.5, 10);
  });

  it('#RRGGBBAA and comma/space/slash separators follow CSS syntax', () => {
    expect(extractAlpha('#11223344')).toBeCloseTo(0x44 / 255, 10);
    expect(extractAlpha('rgba(10 20 30 / 0.25)')).toBeCloseTo(0.25, 10);
  });

  it('formats the color parser itself cannot represent return null (no invented parsing)', () => {
    // hsla() is schema-legal but parseColor does not accept it; the field
    // treats it as opaque rather than inventing a second color parser.
    expect(extractAlpha('hsla(120, 50%, 50%, 0.4)')).toBeNull();
  });
});

describe('formatColorOutput — emission contract (rgba while translucent, HEX6 when opaque)', () => {
  it('emits rgba(r, g, b, a) — the exact schema/engine shape — while alpha < 1', () => {
    expect(formatColorOutput({ r: 0, g: 0, b: 0 }, 0.45)).toBe('rgba(0, 0, 0, 0.45)');
    expect(formatColorOutput({ r: 255, g: 255, b: 255 }, 0.8)).toBe('rgba(255, 255, 255, 0.8)');
    expect(formatColorOutput({ r: 10, g: 20, b: 30 }, 0)).toBe('rgba(10, 20, 30, 0)');
  });

  it('opaque colors stay legacy HEX6 (no churn to existing payloads)', () => {
    expect(formatColorOutput({ r: 0x12, g: 0x34, b: 0x56 }, 1)).toBe('#123456');
    expect(formatColorOutput({ r: 0, g: 0, b: 0 }, 1)).toBe('#000000');
  });
});

describe('open → edit → save round-trip preserves the stored alpha', () => {
  it('rgba(0,0,0,0.45) resolves to black with alpha 0.45 and re-emits rgba — never #000000', () => {
    const stored = 'rgba(0,0,0,0.45)';
    const rgb = parseColor(stored);
    expect(rgb).toEqual({ r: 0, g: 0, b: 0 });
    const alpha = extractAlpha(stored) ?? 1;
    // Repainting the SAME color through the picker (SV/hue drag) must not
    // collapse the value to opaque hex.
    expect(formatColorOutput(rgb!, alpha)).toBe('rgba(0, 0, 0, 0.45)');
    expect(formatColorOutput(rgb!, alpha)).not.toBe('#000000');
  });

  it('rgb(10,20,30) (no alpha channel) round-trips as HEX6', () => {
    const rgb = parseColor('rgb(10,20,30)');
    expect(rgb).toEqual({ r: 10, g: 20, b: 30 });
    expect(formatColorOutput(rgb!, extractAlpha('rgb(10,20,30)') ?? 1)).toBe('#0A141E');
  });
});

describe('ThemeColorField — overlay field never writes back on mount', () => {
  it('renders a stored rgba() value without converting it (onChange untouched)', () => {
    const explosive = () => {
      throw new Error('mounted field must not emit — alpha would be flattened on render');
    };
    const html = renderToStaticMarkup(
      React.createElement(ThemeColorField, {
        label: 'لون الطبقة',
        value: 'rgba(0,0,0,0.45)',
        allowAlpha: true,
        defaultValue: '#000000',
        onChange: explosive,
      })
    );
    expect(html).toContain('لون الطبقة');
    // The resolved swatch paints the TRANSLUCENT result, not flat black.
    expect(html).toContain('rgba(0, 0, 0, 0.45)');
  });

  it('plain semantic fields stay HEX-only (no alpha UI emitted)', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThemeColorField, {
        label: 'اللون الأساسي (Brand)',
        value: '#D4AF37',
        onChange: () => {},
      })
    );
    expect(html).toContain('#D4AF37');
    expect(html).not.toContain('شفافية اللون');
  });
});
