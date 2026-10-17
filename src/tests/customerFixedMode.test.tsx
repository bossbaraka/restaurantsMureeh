// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerThemeProvider, resolveCustomerSurfaceMode } from '../theme/CustomerThemeProvider';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const restaurant = (mode: 'light' | 'dark') => ({
  id: 'r1',
  name: 'R',
  primaryColor: '#D4AF37',
  accentColor: '#C5A880',
  theme: {
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
    typography: { fontFamily: 'tajawal', headingWeight: '700', bodyWeight: '400' },
    background: {
      light: { type: 'solid', color: '#FFFFFF', url: null, storagePath: null },
      dark: { type: 'solid', color: '#0A0B0D', url: null, storagePath: null },
    },
    source: 'restaurant',
    rawConfig: {},
  },
});

const renderScope = (mode: 'light' | 'dark', forceMode?: 'light' | 'dark') => {
  const markup = renderToStaticMarkup(
    <CustomerThemeProvider restaurant={restaurant(mode)} forceMode={forceMode}>
      <div />
    </CustomerThemeProvider>
  );
  const match = markup.match(/<div class="customer-theme-scope[^>]*data-appearance="(light|dark)"/);
  return match?.[1];
};

describe('fixed restaurant-owned appearance', () => {
  it('resolves missing, invalid and legacy auto modes to dark without a device input', () => {
    expect(resolveCustomerSurfaceMode(undefined)).toBe('dark');
    expect(resolveCustomerSurfaceMode('auto')).toBe('dark');
    expect(resolveCustomerSurfaceMode('neon')).toBe('dark');
    expect(resolveCustomerSurfaceMode('light')).toBe('light');
    expect(resolveCustomerSurfaceMode('dark')).toBe('dark');
  });

  it('renders the saved restaurant mode regardless of guest storage or system preference', () => {
    window.localStorage.setItem('mureeh_guest_appearance', 'light');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    });

    expect(renderScope('dark')).toBe('dark');
    expect(renderScope('light')).toBe('light');
  });

  it('allows explicit mode overrides only for isolated theme previews', () => {
    expect(renderScope('light', 'dark')).toBe('dark');
    expect(renderScope('dark', 'light')).toBe('light');
  });

  it('does not wire a guest mode toggle into customer navigation', () => {
    const toolbar = read('../components/customer/MenuToolbar.tsx');
    const layout = read('../components/customer/CustomerLayout.tsx');
    expect(toolbar).not.toContain('CustomerModeToggle');
    expect(layout).not.toContain('CustomerModeToggle');
  });

  it('does not read device or guest appearance state in the production provider', () => {
    const provider = read('../theme/CustomerThemeProvider.tsx');
    expect(provider).not.toContain('matchMedia');
    expect(provider).not.toContain('prefers-color-scheme');
    expect(provider).not.toContain('localStorage');
    expect(provider).not.toContain('guestAppearance');
  });
});
