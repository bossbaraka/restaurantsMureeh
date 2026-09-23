/**
 * PHASE 2 GUARDS — platform / customer appearance isolation.
 *
 * The rule under test: there are exactly TWO appearance owners, and neither
 * may touch the other's world.
 *
 *   PlatformAppearanceProvider  owns  <html> class, color-scheme,
 *                                     `mureeh_appearance`, --mureeh-*
 *   CustomerThemeProvider       owns  the customer scope, --m-* tokens,
 *                                     the restaurant's resolved mode
 *
 * These tests exist because the two worlds were previously coupled through
 * <html>: a restaurant's configured mode influenced the document the manager
 * dashboard lived in, and the platform could not have an appearance of its own.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import {
  PLATFORM_APPEARANCE_STORAGE_KEY,
  DEFAULT_PLATFORM_APPEARANCE,
  readStoredAppearance,
  resolvePlatformAppearance,
} from '../theme/PlatformAppearanceProvider';
import { CustomerThemeProvider } from '../theme/CustomerThemeProvider';
import { BRAND_THEME_STORAGE_KEY } from '../theme/brandTheme';
import type { EffectiveTheme } from '../types/restaurant';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * Source with comments stripped. These guards must assert on CODE: the files
 * deliberately DOCUMENT the old coupling ("this used to write --m-* …"), and a
 * naive text search would match that prose and report a false violation.
 */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const readRoot = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const theme = (mode: 'light' | 'dark' | 'auto'): EffectiveTheme =>
  ({
    mode,
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
    shadows: { sm: 'a', md: 'b', lg: 'c' },
    typography: { fontFamily: 'auto', headingWeight: '700', bodyWeight: '400' },
    cards: {},
    background: {
      light: { type: 'solid', color: '#FFFFFF', url: null, storagePath: null },
      dark: { type: 'solid', color: '#0A0B0D', url: null, storagePath: null },
    },
    source: 'restaurant',
    rawConfig: {},
  }) as EffectiveTheme;

function renderScope(element: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  const scope = host.querySelector('.customer-theme-scope');
  if (!scope) throw new Error('customer theme scope not rendered');
  return scope as HTMLElement;
}

/** Snapshot of everything the PLATFORM owns. */
function platformState() {
  const root = document.documentElement;
  return {
    className: root.className,
    colorScheme: root.style.colorScheme,
    appearanceAttr: root.getAttribute('data-platform-appearance'),
    inlineStyle: root.getAttribute('style'),
  };
}

beforeEach(() => {
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-platform-appearance');
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Platform appearance behaviour
// ---------------------------------------------------------------------------

describe('platform appearance', () => {
  it('defaults to dark so the shipped product appearance is unchanged', () => {
    expect(DEFAULT_PLATFORM_APPEARANCE).toBe('dark');
    expect(readStoredAppearance()).toBe('dark');
  });

  it('resolves light / dark explicitly and system from the device', () => {
    expect(resolvePlatformAppearance('light', true)).toBe('light');
    expect(resolvePlatformAppearance('dark', false)).toBe('dark');
    expect(resolvePlatformAppearance('system', true)).toBe('dark');
    expect(resolvePlatformAppearance('system', false)).toBe('light');
  });

  it('persists the preference and reads it back', () => {
    localStorage.setItem(PLATFORM_APPEARANCE_STORAGE_KEY, 'light');
    expect(readStoredAppearance()).toBe('light');
  });

  it('falls back to the default for a corrupt stored value', () => {
    localStorage.setItem(PLATFORM_APPEARANCE_STORAGE_KEY, 'neon');
    expect(readStoredAppearance()).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// Storage isolation
// ---------------------------------------------------------------------------

describe('storage isolation', () => {
  it('platform and customer preferences use different keys', () => {
    expect(PLATFORM_APPEARANCE_STORAGE_KEY).toBe('mureeh_appearance');
    expect(PLATFORM_APPEARANCE_STORAGE_KEY).not.toBe(BRAND_THEME_STORAGE_KEY);
  });

  it('writing the platform preference leaves the customer cache untouched', () => {
    localStorage.setItem(BRAND_THEME_STORAGE_KEY, JSON.stringify({ primary: '#111', accent: '#222' }));
    localStorage.setItem(PLATFORM_APPEARANCE_STORAGE_KEY, 'light');
    const cached = JSON.parse(localStorage.getItem(BRAND_THEME_STORAGE_KEY) as string);
    expect(cached.primary).toBe('#111');
  });
});

// ---------------------------------------------------------------------------
// Customer → Platform isolation
// ---------------------------------------------------------------------------

describe('customer theme never touches the platform world', () => {
  it('rendering any restaurant mode leaves <html> class/color-scheme unchanged', () => {
    for (const mode of ['light', 'dark', 'auto'] as const) {
      const before = platformState();
      renderScope(
        <CustomerThemeProvider restaurant={{ theme: theme(mode) }}>
          <span>menu</span>
        </CustomerThemeProvider>
      );
      expect(platformState(), `restaurant mode ${mode} must not alter platform state`).toEqual(
        before
      );
    }
  });

  it('never writes --m-* or --mureeh-* onto <html>', () => {
    renderScope(
      <CustomerThemeProvider restaurant={{ theme: theme('light') }}>
        <span>menu</span>
      </CustomerThemeProvider>
    );
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--m-brand')).toBe('');
    expect(root.style.getPropertyValue('--m-bg')).toBe('');
    expect(root.style.getPropertyValue('--mureeh-bg')).toBe('');
  });

  it('puts the customer mode ONLY inside the scope, never as <html> data-theme', () => {
    const scope = renderScope(
      <CustomerThemeProvider restaurant={{ theme: theme('light') }}>
        <span>menu</span>
      </CustomerThemeProvider>
    );
    expect(scope.getAttribute('data-appearance')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('the provider source contains no <html> appearance mutation', () => {
    const src = readCode('../theme/CustomerThemeProvider.tsx');
    expect(src).not.toMatch(/documentElement\.classList/);
    expect(src).not.toMatch(/colorScheme/);
    expect(src).not.toMatch(/setAttribute\(\s*'data-theme'/);
  });
});

// ---------------------------------------------------------------------------
// Platform → Customer isolation
// ---------------------------------------------------------------------------

describe('platform appearance never touches the customer world', () => {
  it('changing the platform class does not change any --m-* token', () => {
    const scope = renderScope(
      <CustomerThemeProvider restaurant={{ theme: theme('dark') }}>
        <span>menu</span>
      </CustomerThemeProvider>
    );
    const before = scope.getAttribute('style');

    // Simulate the platform switching light → dark → light.
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';

    // The customer scope's inline tokens are unaffected: they live on the
    // scope element, not on <html>.
    expect(scope.getAttribute('style')).toBe(before);
  });

  it('the platform provider never reads restaurant data or writes --m-*', () => {
    const src = readCode('../theme/PlatformAppearanceProvider.tsx');
    expect(src).not.toMatch(/--m-/);
    expect(src).not.toMatch(/\brestaurant\b/i);
    expect(src).not.toMatch(/brandTheme/);
  });
});

// ---------------------------------------------------------------------------
// Ownership: exactly one writer per world
// ---------------------------------------------------------------------------

describe('single ownership of each appearance world', () => {
  it('only PlatformAppearanceProvider mutates <html> appearance', () => {
    const offenders: string[] = [];
    const files = [
      '../App.tsx',
      '../context/RestaurantContext.tsx',
      '../components/customer/CustomerLayout.tsx',
      '../components/customer/RestaurantEntryExperience.tsx',
      '../components/display/LiveMenuStage.tsx',
      '../components/manager/BrandingSettingsView.tsx',
      '../components/common/ViewSwitcher.tsx',
    ];
    for (const file of files) {
      const src = readCode(file);
      if (/documentElement\.classList/.test(src)) offenders.push(`${file}: classList`);
      if (/documentElement\.style\.colorScheme/.test(src)) offenders.push(`${file}: colorScheme`);
    }
    expect(offenders).toEqual([]);
  });

  it('no component outside the theme providers applies tenant theme tokens', () => {
    const offenders: string[] = [];
    const files = [
      '../App.tsx',
      '../context/RestaurantContext.tsx',
      '../components/customer/CustomerLayout.tsx',
      '../components/customer/RestaurantEntryExperience.tsx',
      '../components/display/LiveMenuStage.tsx',
      '../components/manager/BrandingSettingsView.tsx',
    ];
    for (const file of files) {
      const src = readCode(file);
      if (/\bapplyBrandTheme\s*\(/.test(src)) offenders.push(`${file}: applyBrandTheme`);
      if (/\bapplyEffectiveTheme\s*\(/.test(src)) offenders.push(`${file}: applyEffectiveTheme`);
      if (/\buseBrandTheme\s*\(/.test(src)) offenders.push(`${file}: useBrandTheme`);
      if (/\buseEffectiveTheme\s*\(/.test(src)) offenders.push(`${file}: useEffectiveTheme`);
    }
    expect(offenders).toEqual([]);
  });

  it('the display board uses the shared pipeline via forceMode, not its own engine', () => {
    const src = read('../components/display/LiveMenuStage.tsx');
    expect(src).toContain('<CustomerThemeProvider');
    expect(src).toContain('forceMode="dark"');
  });

  it('the manager editor saves state without applying theme to the document', () => {
    const src = read('../components/manager/BrandingSettingsView.tsx');
    expect(src).not.toMatch(/^\s*applyBrandTheme\(/m);
    expect(src).not.toContain('import { applyBrandTheme');
  });
});

// ---------------------------------------------------------------------------
// Static dark assumptions removed
// ---------------------------------------------------------------------------

describe('no static dark assumptions remain in the platform entry point', () => {
  it('index.html no longer hardcodes class="dark"', () => {
    const html = readRoot('../../index.html');
    expect(html).not.toMatch(/<html[^>]*class="[^"]*dark/);
  });

  it('index.html initializes platform appearance before paint (no flash)', () => {
    const html = readRoot('../../index.html');
    expect(html).toContain("localStorage.getItem('mureeh_appearance')");
    expect(html).toContain('prefers-color-scheme: dark');
    // PLATFORM ONLY: the pre-hydration script must not read tenant theme data
    // or write customer tokens.
    const script = html.slice(html.indexOf('<script>'), html.indexOf('</script>'));
    expect(script).not.toMatch(/--m-/);
    expect(script).not.toMatch(/merar_brand_theme/);
  });

  it('body colors come from platform tokens, not hardcoded dark hex', () => {
    const html = readRoot('../../index.html');
    expect(html).toContain('var(--mureeh-canvas');
    const css = readRoot('../index.css');
    expect(css).toContain('--mureeh-canvas');
    expect(css).toContain('--mureeh-bg');
    // Both platform modes must be defined.
    expect(css).toContain(':root:not(.dark)');
  });

  it('the restaurant light block no longer sets platform color-scheme', () => {
    const css = readRoot('../index.css');
    const start = css.indexOf(":root[data-theme='light']");
    // Strip comments: the block documents WHY color-scheme is absent.
    const block = css
      .slice(start, css.indexOf('}', start))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(block).not.toMatch(/color-scheme/);
  });
});

// ---------------------------------------------------------------------------
// STEP 2.7 — customer overlay / portal inheritance
// ---------------------------------------------------------------------------

/**
 * The previous investigation found no React portals. That is necessary but NOT
 * sufficient: custom properties inherit through the DOM tree, so what actually
 * matters is that each overlay RENDERS INSIDE the scope element — and that the
 * scope's `display: contents` does not break inheritance into a `fixed`
 * descendant (a fixed element escapes the layout flow, but not the inheritance
 * tree).
 *
 * Both halves are verified here rather than assumed.
 */
describe('customer overlays inherit the scope', () => {
  it('confirms no React portal exists in customer code', () => {
    const files = [
      '../components/customer/CartDrawer.tsx',
      '../components/customer/ProductDetailModal.tsx',
      '../components/customer/OrderTrackingDrawer.tsx',
      '../components/customer/WaiterCallModal.tsx',
      '../components/customer/TransferPaymentModal.tsx',
      '../components/customer/DirectTableEntryModal.tsx',
      '../components/customer/OrderCompletedModal.tsx',
      '../components/customer/CustomerGuideOverlay.tsx',
      '../components/customer/CustomerHeader.tsx',
      '../components/customer/CustomerLayout.tsx',
    ];
    // Comments stripped: CustomerLayout documents the portal situation in
    // prose, which a raw text search would flag as a violation.
    const offenders = files.filter((f) => /createPortal/.test(readCode(f)));
    expect(offenders).toEqual([]);
  });

  it('every overlay is rendered inside CustomerLayout, i.e. within the scope', () => {
    const layout = readCode('../components/customer/CustomerLayout.tsx');
    for (const overlay of [
      'ProductDetailModal',
      'CartDrawer',
      'OrderTrackingDrawer',
      'TransferPaymentModal',
      'WaiterCallModal',
      'DirectTableEntryModal',
      'OrderCompletedModal',
      'CustomerGuideOverlay',
      'ActiveOrdersFloatingBar',
      'CustomerOrderLiveNotifier',
    ]) {
      expect(layout, `${overlay} must render inside the themed layout`).toContain(`<${overlay}`);
    }
    // …and the layout itself is wrapped by the provider.
    expect(layout).toContain('<CustomerThemeProvider');
    expect(layout).toContain('<CustomerLayoutContent');
  });

  it('tokens inherit through display:contents into a fixed overlay', () => {
    // The real mechanism, exercised rather than assumed: `display: contents`
    // removes the box but not the inheritance relationship, and `position:
    // fixed` escapes layout flow but still inherits from its DOM parent.
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <CustomerThemeProvider restaurant={{ theme: theme('dark') }}>
        <div>
          <div id="overlay" style={{ position: 'fixed', inset: 0 }}>
            overlay
          </div>
        </div>
      </CustomerThemeProvider>
    );
    document.body.appendChild(host);
    try {
      const overlay = host.querySelector('#overlay') as HTMLElement;
      const inherited = getComputedStyle(overlay).getPropertyValue('--m-brand').trim();
      expect(inherited).toBe('#D4AF37');
      // A legacy alias must reach the overlay too, so unmigrated overlays
      // keep rendering correctly during the migration.
      expect(getComputedStyle(overlay).getPropertyValue('--brand-primary').trim()).toBe('#D4AF37');
    } finally {
      host.remove();
    }
  });

  it('the scope element creates no box (layout stays byte-identical)', () => {
    const css = readRoot('../index.css');
    const start = css.indexOf('.customer-theme-scope {');
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('display: contents');
  });
});
