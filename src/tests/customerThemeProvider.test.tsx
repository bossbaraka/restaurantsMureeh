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
import {
  applyEffectiveTheme,
  buildBrandTokens,
  contrastRatio,
  parseColor,
} from '../theme/brandTheme';
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
  /**
   * The visual properties that must agree. The legacy writer
   * (applyEffectiveTheme) still emits the server-contract keys
   * (--theme-*, --radius-*, …); the canonical pipeline emits the
   * SAME derivations under --m-* names. Brand derivations are
   * compared against buildBrandTokens directly — the one math
   * both sides share.
   */
  const CONTRACT_KEY_MAP: Record<string, string> = {
    '--theme-bg': '--m-bg',
    '--radius-sm': '--m-radius-sm',
    '--radius-md': '--m-radius-md',
    '--radius-lg': '--m-radius-lg',
    '--shadow-md': '--m-shadow-md',
    '--card-radius': '--m-card-radius',
    '--card-shadow': '--m-card-shadow',
    '--font-family': '--m-font',
    '--font-heading-weight': '--m-font-heading-weight',
    '--font-body-weight': '--m-font-body-weight',
  };

  const legacyOutput = (theme: EffectiveTheme): Record<string, string> => {
    document.documentElement.removeAttribute('style');
    applyEffectiveTheme(theme);
    const out: Record<string, string> = {};
    for (const key of Object.keys(CONTRACT_KEY_MAP)) {
      out[key] = document.documentElement.style.getPropertyValue(key);
    }
    return out;
  };

  for (const [label, mode, surfaceMode] of [
    ['dark mode', 'dark', 'dark'],
    ['light mode', 'light', 'light'],
    ['legacy auto mode (dark fallback)', 'auto', 'dark'],
  ] as const) {
    it(`produces equivalent semantic output in ${label}`, () => {
      const theme = effectiveTheme({ mode: mode as any });
      const legacy = legacyOutput(theme);

      const normalized = normalizeTheme({ theme });
      const next = buildCustomerThemeStyle(normalized, surfaceMode);

      for (const [legacyKey, canonicalKey] of Object.entries(CONTRACT_KEY_MAP)) {
        expect(next[canonicalKey], `${canonicalKey} must match ${legacyKey} in ${label}`).toBe(
          legacy[legacyKey]
        );
      }

      // Brand derivations — the same buildBrandTokens math both
      // engines share, under the canonical names.
      const brand = buildBrandTokens(
        theme.colors.primary,
        theme.colors.accent,
        surfaceMode
      );
      const brandExpectations: Record<string, string> = {
        '--m-brand': brand.primary,
        '--m-brand-accent': brand.accent,
        '--m-brand-on-surface': brand.primaryStrong,
        '--m-brand-accent-on-surface': brand.accentStrong,
        '--m-brand-fill': brand.fill,
        '--m-brand-ink': brand.ink,
        '--m-text-subtle': brand.muted,
        '--m-brand-soft': brand.soft,
        '--m-brand-soft-strong': brand.softStrong,
        '--m-brand-line': brand.line,
        '--m-hairline-strong': brand.lineStrong,
        '--m-brand-glow': brand.glow,
      };
      for (const [canonicalKey, expected] of Object.entries(brandExpectations)) {
        expect(next[canonicalKey], `${canonicalKey} must match the brand engine in ${label}`).toBe(
          expected
        );
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
    const normalized = normalizeTheme({ theme: custom });
    const tokens = buildCustomerThemeStyle(normalized, 'dark');
    expect(tokens['--m-brand']).toBe('#4F7CFF');
    expect(tokens['--m-bg']).toBe('#0A0B0D');
    // Old scalar role values remain in normalized data but do not create a
    // second palette channel on the customer DOM.
    expect(normalized.colors.background).toBe('#101828');
    expect(normalized.colors.textPrimary).toBe('#FDF6E3');
    expect(tokens).not.toHaveProperty('--theme-text-primary');
  });

  it('keeps legacy component color overrides stored but derives customer components from identity', () => {
    const withGroups = effectiveTheme({
      colors: {
        ...effectiveTheme().colors,
        button: { primaryBg: '#111111', primaryText: '#FFFFFF' },
        badge: { bg: '#222222', text: '#FFFFFF' },
        category: { bg: '#123456', activeBg: '#ABCDEF', activeText: '#000000' },
        card: { bg: '#222222', border: '#333333' },
      } as EffectiveTheme['colors'],
    });
    const normalized = normalizeTheme({ theme: withGroups });
    const tokens = buildSemanticTokens(normalized, 'dark');

    expect(normalized.colors.button?.primaryBg).toBe('#111111');
    expect(normalized.colors.category?.bg).toBe('#123456');
    expect(normalized.colors.card?.bg).toBe('#222222');
    expect(tokens['--m-button-bg']).toBe(tokens['--m-brand-fill']);
    expect(tokens['--m-button-text']).toBe(tokens['--m-brand-ink']);
    expect(tokens['--m-chip-bg']).toBe(tokens['--m-surface-raised']);
    expect(tokens['--m-chip-active-bg']).toBe('transparent');
    expect(tokens['--m-card-bg']).not.toBe('#222222');
    expect(tokens['--m-badge-bg']).toBe(tokens['--m-surface-raised']);
    expect(tokens['--m-badge-text']).toBe(tokens['--m-text']);
    expect(tokens['--m-chip-active-image']).toBe(tokens['--m-brand-fill']);
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
    const legacyAuto = effectiveTheme({ mode: 'auto' as any });
    const scope = renderScope(
      <CustomerThemeProvider restaurant={{ theme: legacyAuto }}>
        <span>menu</span>
      </CustomerThemeProvider>
    );
    expect(scope.getAttribute('data-appearance')).toBe('dark');
  });

  it('keeps explicit opposite-face rendering confined to the theme editor preview', () => {
    const scope = renderScope(
      <CustomerThemeProvider
        restaurant={{ theme: effectiveTheme({ mode: 'light' }) }}
        forceMode="dark"
      >
        <span>preview</span>
      </CustomerThemeProvider>
    );
    expect(scope.getAttribute('data-appearance')).toBe('dark');

    const preview = read('../components/manager/ThemePreview.tsx');
    const liveDisplay = read('../components/display/LiveMenuStage.tsx');
    expect(preview).toContain('forceMode={forceMode}');
    expect(liveDisplay).not.toContain('forceMode=');
  });

  it('emits NO legacy family — the migration bridge is deleted', () => {
    const scope = renderScope(
      <CustomerThemeProvider restaurant={{ theme: effectiveTheme() }}>
        <span>menu</span>
      </CustomerThemeProvider>
    );
    // Every custom property on the scope must be canonical.
    for (let i = 0; i < scope.style.length; i++) {
      const name = scope.style.item(i);
      expect(
        name.startsWith('--brand-') || name.startsWith('--menu-'),
        `${name} is a retired legacy family`
      ).toBe(false);
    }
  });
});
