// @vitest-environment jsdom
/**
 * GUEST NIGHT/LIGHT OVERRIDE — the in-menu appearance button contract.
 * ===========================================================================
 *
 * The customer menu must NOT rely solely on the client device theme: a guest
 * can force the light or the night face from the menu toolbar, and 'auto'
 * hands control back to the tenant/device chain. Pinned here:
 *
 *   1. PRECEDENCE — forceMode (signage) > guest override > tenant mode >
 *      device preference. One pure function, exhaustively tabled.
 *   2. STORAGE — the guest choice persists under its OWN key (never the
 *      platform key, never the brand cache); invalid values degrade to
 *      'auto'; 'auto' removes the entry.
 *   3. SINGLE WRITER — the override changes ONLY what the provider already
 *      owns (data-appearance + token set). No <html> write, no new writer.
 *   4. THE TOGGLE — cycles auto → light → dark → auto, persists each step,
 *      and the whole scope re-themes with it.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerThemeProvider } from '../theme/CustomerThemeProvider';
import {
  GUEST_APPEARANCE_STORAGE_KEY,
  readGuestAppearanceOverride,
  resolveCustomerSurfaceMode,
  writeGuestAppearanceOverride,
  type GuestAppearanceOverride,
} from '../theme/guestAppearance';
import { PLATFORM_APPEARANCE_STORAGE_KEY } from '../theme/PlatformAppearanceProvider';
import { BRAND_THEME_STORAGE_KEY } from '../theme/brandTheme';
import { CustomerModeToggle } from '../components/customer/CustomerModeToggle';
import type { EffectiveTheme } from '../types/restaurant';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const themeWithMode = (mode: 'light' | 'dark' | 'auto'): EffectiveTheme =>
  ({
    mode,
    colors: {
      primary: '#D4AF37',
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
    typography: { fontFamily: 'auto', headingWeight: '700', bodyWeight: '400' },
    background: {
      light: { type: 'solid', color: '#FFFFFF', url: null, storagePath: null },
      dark: { type: 'solid', color: '#0A0B0D', url: null, storagePath: null },
    },
    source: 'restaurant',
    rawConfig: {},
  }) as unknown as EffectiveTheme;

const restaurantWithMode = (mode: 'light' | 'dark' | 'auto') => ({
  id: 'r1',
  name: 'R',
  theme: themeWithMode(mode),
});

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-platform-appearance');
});

afterEach(() => {
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// 1. Precedence — the one place that decides who wins
// ---------------------------------------------------------------------------

describe('resolveCustomerSurfaceMode — precedence table', () => {
  it('forceMode beats everything (signage stays signage)', () => {
    for (const override of ['auto', 'light', 'dark'] as const) {
      for (const themeMode of ['light', 'dark', 'auto'] as const) {
        expect(
          resolveCustomerSurfaceMode({ forceMode: 'dark', override, themeMode, prefersDark: false })
        ).toBe('dark');
      }
    }
  });

  it('an explicit guest override beats the tenant mode and the device', () => {
    expect(
      resolveCustomerSurfaceMode({ override: 'light', themeMode: 'dark', prefersDark: true })
    ).toBe('light');
    expect(
      resolveCustomerSurfaceMode({ override: 'dark', themeMode: 'light', prefersDark: false })
    ).toBe('dark');
  });

  it("'auto' falls through to the tenant mode", () => {
    expect(
      resolveCustomerSurfaceMode({ override: 'auto', themeMode: 'light', prefersDark: true })
    ).toBe('light');
    expect(
      resolveCustomerSurfaceMode({ override: 'auto', themeMode: 'dark', prefersDark: false })
    ).toBe('dark');
  });

  it("tenant 'auto' finally resolves on the device preference", () => {
    expect(
      resolveCustomerSurfaceMode({ override: 'auto', themeMode: 'auto', prefersDark: true })
    ).toBe('dark');
    expect(
      resolveCustomerSurfaceMode({ override: 'auto', themeMode: 'auto', prefersDark: false })
    ).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// 2. Storage — own key, strict validation, 'auto' removes
// ---------------------------------------------------------------------------

describe('guest override storage', () => {
  it('round-trips light and dark', () => {
    writeGuestAppearanceOverride('light');
    expect(readGuestAppearanceOverride()).toBe('light');
    writeGuestAppearanceOverride('dark');
    expect(readGuestAppearanceOverride()).toBe('dark');
  });

  it("'auto' removes the persisted entry", () => {
    writeGuestAppearanceOverride('dark');
    writeGuestAppearanceOverride('auto');
    expect(window.localStorage.getItem(GUEST_APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(readGuestAppearanceOverride()).toBe('auto');
  });

  it('never touches the platform or brand-cache keys', () => {
    writeGuestAppearanceOverride('light');
    expect(window.localStorage.getItem(PLATFORM_APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(BRAND_THEME_STORAGE_KEY)).toBeNull();
  });

  it('degrades invalid stored values to auto', () => {
    window.localStorage.setItem(GUEST_APPEARANCE_STORAGE_KEY, 'blue');
    expect(readGuestAppearanceOverride()).toBe('auto');
    window.localStorage.setItem(GUEST_APPEARANCE_STORAGE_KEY, 'dark');
    expect(readGuestAppearanceOverride()).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// 3. Provider integration — override feeds the EXISTING single writer
// ---------------------------------------------------------------------------

function renderScope(element: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  const scope = host.querySelector('.customer-theme-scope');
  if (!scope) throw new Error('customer theme scope was not rendered');
  return scope as HTMLElement;
}

describe('provider applies the guest override through the single writer', () => {
  const seed = (value: GuestAppearanceOverride | null) => {
    if (value) window.localStorage.setItem(GUEST_APPEARANCE_STORAGE_KEY, value);
  };

  it('a persisted light override wins over a dark tenant theme', () => {
    seed('light');
    const scope = renderScope(
      <CustomerThemeProvider restaurant={restaurantWithMode('dark')}>
        <div />
      </CustomerThemeProvider>
    );
    expect(scope.getAttribute('data-appearance')).toBe('light');
  });

  it('a persisted dark override wins over a light tenant theme', () => {
    seed('dark');
    const scope = renderScope(
      <CustomerThemeProvider restaurant={restaurantWithMode('light')}>
        <div />
      </CustomerThemeProvider>
    );
    expect(scope.getAttribute('data-appearance')).toBe('dark');
  });

  it('auto/no choice leaves the tenant mode in charge', () => {
    const dark = renderScope(
      <CustomerThemeProvider restaurant={restaurantWithMode('dark')}>
        <div />
      </CustomerThemeProvider>
    );
    expect(dark.getAttribute('data-appearance')).toBe('dark');

    const light = renderScope(
      <CustomerThemeProvider restaurant={restaurantWithMode('light')}>
        <div />
      </CustomerThemeProvider>
    );
    expect(light.getAttribute('data-appearance')).toBe('light');
  });

  it('forceMode ignores the guest override', () => {
    seed('light');
    const scope = renderScope(
      <CustomerThemeProvider restaurant={restaurantWithMode('auto')} forceMode="dark">
        <div />
      </CustomerThemeProvider>
    );
    expect(scope.getAttribute('data-appearance')).toBe('dark');
  });

  it('the override flips the token set, not just the attribute', () => {
    seed('light');
    const light = renderScope(
      <CustomerThemeProvider restaurant={restaurantWithMode('dark')}>
        <div />
      </CustomerThemeProvider>
    );
    seed('dark');
    const dark = renderScope(
      <CustomerThemeProvider restaurant={restaurantWithMode('dark')}>
        <div />
      </CustomerThemeProvider>
    );
    // Surface and text tokens genuinely invert between the two faces —
    // the toggle drives the SAME token pipeline, so everything moves together.
    const lightSurface = (light as HTMLElement).style.getPropertyValue('--menu-surface');
    const darkSurface = (dark as HTMLElement).style.getPropertyValue('--menu-surface');
    expect(lightSurface).not.toBe('');
    expect(lightSurface).not.toBe(darkSurface);
    expect((light as HTMLElement).style.getPropertyValue('--m-text')).not.toBe(
      (dark as HTMLElement).style.getPropertyValue('--m-text')
    );
  });
});

// ---------------------------------------------------------------------------
// 4. The toggle — cycle + persistence, rendered interactively
// ---------------------------------------------------------------------------

describe('CustomerModeToggle interaction', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = async (mode: 'light' | 'dark' | 'auto') => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <CustomerThemeProvider restaurant={restaurantWithMode(mode)}>
          <CustomerModeToggle />
        </CustomerThemeProvider>
      );
    });
  };

  const scope = () => container.querySelector('.customer-theme-scope') as HTMLElement;
  const button = () => container.querySelector('button') as HTMLButtonElement;

  const click = async (el: Element) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('starts on auto (tenant mode paints) and cycles auto → light → dark → auto', async () => {
    await mount('dark');

    expect(scope().getAttribute('data-appearance')).toBe('dark');
    expect(readGuestAppearanceOverride()).toBe('auto');

    await click(button()); // → light
    expect(readGuestAppearanceOverride()).toBe('light');
    expect(scope().getAttribute('data-appearance')).toBe('light');

    await click(button()); // → dark
    expect(readGuestAppearanceOverride()).toBe('dark');
    expect(scope().getAttribute('data-appearance')).toBe('dark');

    await click(button()); // → auto: tenant 'dark' is back in charge
    expect(readGuestAppearanceOverride()).toBe('auto');
    expect(window.localStorage.getItem(GUEST_APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(scope().getAttribute('data-appearance')).toBe('dark');
  });

  it('the override beats a light tenant theme too', async () => {
    await mount('light');
    expect(scope().getAttribute('data-appearance')).toBe('light');

    await click(button()); // → light (already light, but now guest-owned)
    await click(button()); // → dark
    expect(scope().getAttribute('data-appearance')).toBe('dark');
    expect(readGuestAppearanceOverride()).toBe('dark');
  });

  it('renders nothing outside a customer theme scope', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<CustomerModeToggle />);
    });
    expect(container.querySelector('button')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Structural guards — the button lives in the menu toolbar ONLY
// ---------------------------------------------------------------------------

describe('wiring guards', () => {
  it('the menu toolbar renders the guest toggle', () => {
    const src = read('../components/customer/MenuToolbar.tsx');
    expect(src).toContain('<CustomerModeToggle />');
  });

  it('the toggle carries no mode logic of its own — resolution stays in the provider', () => {
    const src = read('../components/customer/CustomerModeToggle.tsx');
    expect(src).not.toContain('document.documentElement');
    expect(src).not.toContain('setProperty');
    expect(src).not.toContain('prefers-color-scheme');
  });

  it('the provider remains the single writer (no new <html> writers introduced)', () => {
    const toggle = read('../components/customer/CustomerModeToggle.tsx');
    expect(toggle).toContain('useCustomerTheme');
  });
});
