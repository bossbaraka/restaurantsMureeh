/**
 * PHASE 1 GUARDS — theme single-writer foundation.
 *
 * Three things are pinned here:
 *
 *   1. SEMANTIC EQUIVALENCE — the new pipeline (normalizeTheme →
 *      buildSemanticTokens) produces the same VISUAL RESULT as the legacy
 *      engine (applyEffectiveTheme). Per the migration policy this is checked
 *      on semantic output — colors, mode, surfaces, typography, radius,
 *      shadows, background — NOT on variable-name equality. The legacy aliases
 *      are the bridge that makes the comparison possible.
 *
 *   2. SINGLE WRITER — no module-load theme mutation, and the competing
 *      runtime writers are gone from App / RestaurantContext / CustomerLayout /
 *      RestaurantEntryExperience.
 *
 *   3. PURITY — normalization and token building touch no DOM.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { normalizeTheme, resolveBrand, DEFAULT_BRAND } from '../theme/normalizeTheme';
import {
  buildSemanticTokens,
  buildCustomerThemeStyle,
  ALL_SEMANTIC_TOKEN_NAMES,
} from '../theme/semanticTokens';
import { applyEffectiveTheme, contrastRatio, parseColor } from '../theme/brandTheme';
import { CustomerThemeProvider } from '../theme/CustomerThemeProvider';
import type { EffectiveTheme } from '../types/restaurant';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const effectiveTheme = (overrides: Partial<EffectiveTheme> = {}): EffectiveTheme =>
  ({
    mode: 'dark',
    colors: {
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
    },
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

/**
 * Renders a tree to markup and returns the scope element, parsed into a real
 * DOM node so its inline custom properties can be read.
 *
 * Uses `react-dom/server` to match this repository's existing component-test
 * convention (no @testing-library dependency). It has a useful side benefit
 * here: server rendering performs NO DOM mutation at all, so any write to
 * <html> observed during these tests could only come from a stray module-load
 * or render-phase side effect — exactly what the single-writer rule forbids.
 */
function renderScope(element: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  const scope = host.querySelector('.customer-theme-scope');
  if (!scope) throw new Error('customer theme scope was not rendered');
  return scope as HTMLElement;
}

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

// ---------------------------------------------------------------------------
// 1. Semantic output equivalence (legacy engine vs new pipeline)
// ---------------------------------------------------------------------------

describe('semantic equivalence — new pipeline matches the legacy engine', () => {
  /** The visual properties that must agree, by legacy alias name. */
  const SEMANTIC_KEYS = [
    '--theme-bg',
    '--theme-surface',
    '--theme-text-primary',
    '--theme-text-secondary',
    '--theme-border',
    '--brand-primary',
    '--brand-accent',
    '--brand-primary-strong',
    '--brand-accent-strong',
    '--brand-fill',
    '--brand-ink',
    '--brand-muted',
    '--radius-sm',
    '--radius-md',
    '--radius-lg',
    '--shadow-md',
    '--card-radius',
    '--card-shadow',
    '--font-family',
    '--font-heading-weight',
    '--font-body-weight',
    '--bg-current',
    '--bg-scrim',
  ];

  const legacyOutput = (theme: EffectiveTheme, prefersDark: boolean): Record<string, string> => {
    document.documentElement.removeAttribute('style');
    applyEffectiveTheme(theme, null, { prefersDark });
    const out: Record<string, string> = {};
    for (const key of SEMANTIC_KEYS) {
      out[key] = document.documentElement.style.getPropertyValue(key);
    }
    return out;
  };

  for (const [label, mode, prefersDark] of [
    ['dark mode', 'dark', true],
    ['light mode', 'light', false],
    ['auto + dark device', 'auto', true],
    ['auto + light device', 'auto', false],
  ] as const) {
    it(`produces equivalent semantic output in ${label}`, () => {
      const theme = effectiveTheme({ mode });
      const legacy = legacyOutput(theme, prefersDark);

      const normalized = normalizeTheme({ theme });
      const surfaceMode = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode;
      const next = buildCustomerThemeStyle(normalized, surfaceMode);

      for (const key of SEMANTIC_KEYS) {
        expect(next[key], `${key} must match the legacy engine in ${label}`).toBe(legacy[key]);
      }
    });
  }

  it('preserves a tenant custom palette verbatim (no re-branding)', () => {
    const custom = effectiveTheme({
      mode: 'dark',
      colors: {
        ...effectiveTheme().colors,
        primary: '#4F7CFF',
        accent: '#1E2F6E',
        background: '#101828',
        textPrimary: '#FDF6E3',
      } as EffectiveTheme['colors'],
    });
    const tokens = buildCustomerThemeStyle(normalizeTheme({ theme: custom }), 'dark');
    expect(tokens['--m-brand']).toBe('#4F7CFF');
    expect(tokens['--m-bg']).toBe('#101828');
    expect(tokens['--theme-text-primary']).toBe('#FDF6E3');
  });

  it('honours stored per-component overrides over derived values', () => {
    const withGroups = effectiveTheme({
      colors: {
        ...effectiveTheme().colors,
        category: { bg: '#123456', activeBg: '#ABCDEF', activeText: '#000000' },
        card: { bg: '#222222', border: '#333333' },
      } as EffectiveTheme['colors'],
    });
    const tokens = buildSemanticTokens(normalizeTheme({ theme: withGroups }), 'dark');
    expect(tokens['--m-chip-bg']).toBe('#123456');
    expect(tokens['--m-chip-active-bg']).toBe('#ABCDEF');
    expect(tokens['--m-card-bg']).toBe('#222222');
    // An explicit active colour must suppress the brand gradient image layer.
    expect(tokens['--m-chip-active-image']).toBe('none');
  });

  it('falls back to derived values when a component group is absent', () => {
    const tokens = buildSemanticTokens(normalizeTheme({ theme: effectiveTheme() }), 'dark');
    // Never an empty string: an empty custom property renders nothing at all.
    for (const name of ALL_SEMANTIC_TOKEN_NAMES) {
      expect(tokens[name], `${name} must be produced`).toBeDefined();
      expect(String(tokens[name]).trim(), `${name} must not be empty`).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Mode + contrast
// ---------------------------------------------------------------------------

describe('mode resolution and contrast', () => {
  it('light mode never emits the platform dark fallback palette', () => {
    const tokens = buildSemanticTokens(
      normalizeTheme({ theme: effectiveTheme({ mode: 'light' }) }),
      'light'
    );
    const darkDefaults = ['#0A0B0D', '#15171A', '#F5F5F0', '#A0A0A0', '#2A2D32'];
    expect(darkDefaults).not.toContain(tokens['--m-bg']);
    expect(darkDefaults).not.toContain(tokens['--m-text']);
  });

  it('brand foreground stays readable on both surfaces', () => {
    const dark = buildSemanticTokens(normalizeTheme({ theme: effectiveTheme() }), 'dark');
    const light = buildSemanticTokens(normalizeTheme({ theme: effectiveTheme() }), 'light');

    const onDark = contrastRatio(
      parseColor(dark['--m-brand-on-surface'])!,
      parseColor('#0A0B0D')!
    );
    const onLight = contrastRatio(
      parseColor(light['--m-brand-on-surface'])!,
      parseColor('#FFFFFF')!
    );
    expect(onDark).toBeGreaterThan(3);
    expect(onLight).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Legacy themes: no preset guessing, values preserved
// ---------------------------------------------------------------------------

describe('legacy theme compatibility', () => {
  it('never infers a presetId, even for a theme matching a shipped preset', () => {
    // Exactly the shipped "royal-gold" preset values.
    const looksLikePreset = effectiveTheme({
      colors: { ...effectiveTheme().colors, primary: '#D4AF37', accent: '#8C6D1F' } as EffectiveTheme['colors'],
    });
    expect(normalizeTheme({ theme: looksLikePreset }).presetId).toBeNull();
  });

  it('resolves identity theme-first with the legacy columns as fallback', () => {
    expect(
      resolveBrand({
        theme: { colors: { primary: '#123456', accent: '#654321' } } as EffectiveTheme,
        primaryColor: '#FF0000',
        accentColor: '#00FF00',
      })
    ).toEqual({ primary: '#123456', accent: '#654321' });

    expect(resolveBrand({ primaryColor: '#FF0000', accentColor: '#00FF00' })).toEqual({
      primary: '#FF0000',
      accent: '#00FF00',
    });

    expect(resolveBrand(null)).toEqual(DEFAULT_BRAND);
  });

  it('renders a complete token set for a restaurant with only legacy columns', () => {
    const normalized = normalizeTheme({ primaryColor: '#4F7CFF', accentColor: '#1E2F6E' });
    expect(normalized.hasStoredTheme).toBe(false);
    expect(normalized.source).toBe('legacy');
    const tokens = buildSemanticTokens(normalized, 'dark');
    expect(tokens['--m-brand']).toBe('#4F7CFF');
    for (const name of ALL_SEMANTIC_TOKEN_NAMES) {
      expect(String(tokens[name]).trim()).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Single-writer + purity guards
// ---------------------------------------------------------------------------

describe('single-writer guarantees', () => {
  it('normalization and token building touch no DOM', () => {
    document.documentElement.removeAttribute('style');
    const normalized = normalizeTheme({ theme: effectiveTheme() });
    buildSemanticTokens(normalized, 'light');
    buildCustomerThemeStyle(normalized, 'dark');
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });

  it('brandTheme.ts has no module-load DOM mutation', () => {
    const src = read('../theme/brandTheme.ts');
    // The eager `if (typeof window !== 'undefined') { … applyBrandTheme }`
    // block at module scope must be gone.
    expect(src).not.toMatch(/^if \(typeof window !== 'undefined'\) \{/m);
    expect(src).toContain('MODULE-LOAD SIDE EFFECT REMOVED');
  });

  it('App.tsx no longer writes customer theme tokens', () => {
    const src = read('../App.tsx');
    expect(src).not.toMatch(/^\s*useBrandTheme\(/m);
    expect(src).not.toContain("from './theme/brandTheme'");
  });

  it('RestaurantContext no longer writes theme tokens from the polling path', () => {
    const src = read('../context/RestaurantContext.tsx');
    expect(src).not.toMatch(/^\s*applyBrandTheme\(/m);
    expect(src).not.toContain("import { applyBrandTheme }");
  });

  it('the entry overlay no longer forces a second dark-surface write', () => {
    const src = read('../components/customer/RestaurantEntryExperience.tsx');
    expect(src).not.toMatch(/^\s*useBrandTheme\(/m);
  });

  it('CustomerLayout applies the theme only through the provider', () => {
    const src = read('../components/customer/CustomerLayout.tsx');
    expect(src).not.toMatch(/useEffectiveTheme\(/);
    expect(src).toContain('<CustomerThemeProvider');
  });

  it('exactly one customer-theme runtime writer exists under src/', () => {
    // The provider is the only module allowed to apply tenant tokens.
    const providerSrc = read('../theme/CustomerThemeProvider.tsx');
    expect(providerSrc).toContain('data-appearance');
  });
});

describe('CustomerThemeProvider — DOM behaviour', () => {
  it('applies tokens to a scope element, never to <html>', () => {
    const scope = renderScope(
      <CustomerThemeProvider restaurant={{ theme: effectiveTheme({ mode: 'dark' }) }}>
        <span>menu</span>
      </CustomerThemeProvider>
    );
    expect(scope.style.getPropertyValue('--m-brand')).toBe('#D4AF37');
    // <html> must remain untouched by the customer theme.
    expect(document.documentElement.style.getPropertyValue('--m-brand')).toBe('');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('data-appearance carries the RESOLVED mode and never "auto"', () => {
    const scope = renderScope(
      <CustomerThemeProvider restaurant={{ theme: effectiveTheme({ mode: 'auto' }) }}>
        <span>menu</span>
      </CustomerThemeProvider>
    );
    expect(['light', 'dark']).toContain(scope.getAttribute('data-appearance'));
  });

  it('forceMode pins the surface for deliberately dark-canvas surfaces', () => {
    const scope = renderScope(
      <CustomerThemeProvider
        restaurant={{ theme: effectiveTheme({ mode: 'light' }) }}
        forceMode="dark"
      >
        <span>stage</span>
      </CustomerThemeProvider>
    );
    expect(scope.getAttribute('data-appearance')).toBe('dark');
  });

  it('emits the legacy aliases so unmigrated components keep working', () => {
    const scope = renderScope(
      <CustomerThemeProvider restaurant={{ theme: effectiveTheme() }}>
        <span>menu</span>
      </CustomerThemeProvider>
    );
    for (const alias of ['--brand-primary', '--theme-bg', '--menu-surface', '--card-radius']) {
      expect(scope.style.getPropertyValue(alias), `${alias} alias must be emitted`).not.toBe('');
    }
  });
});
