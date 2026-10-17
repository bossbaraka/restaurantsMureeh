/**
 * ARABIC FONT PROPAGATION GUARD
 * ============================
 * The restaurant menu, entry experience, and display screen all follow one
 * Arabic-first font choice. The manager may choose Cairo or Tajawal; legacy and
 * unsupported stored keys remain readable but resolve safely to Tajawal.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildCustomerThemeStyle,
  buildSemanticTokens,
  stripGenericFaces,
} from '../theme/semanticTokens';
import { normalizeTheme } from '../theme/normalizeTheme';
import { EDITOR_FONTS } from '../theme/editorModel';
import type { EffectiveTheme } from '../types/restaurant';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const effectiveTheme = (fontFamily: string): EffectiveTheme =>
  ({
    mode: 'dark',
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
    typography: { fontFamily, headingWeight: '700', bodyWeight: '400' },
    background: {
      light: { type: 'solid', color: '#FFFFFF', url: null, storagePath: null },
      dark: { type: 'solid', color: '#0A0B0D', url: null, storagePath: null },
    },
    source: 'restaurant',
    rawConfig: {},
  }) as unknown as EffectiveTheme;

const fontToken = (fontFamily: string) =>
  buildSemanticTokens(normalizeTheme({ theme: effectiveTheme(fontFamily) }), 'dark')['--m-font-chosen'];

describe('restaurant font choice — Arabic-first Cairo / Tajawal', () => {
  it('offers only the two modern Arabic menu faces', () => {
    expect(EDITOR_FONTS.map(({ id }) => id)).toEqual(['tajawal', 'cairo']);
  });

  it('puts the explicitly chosen face first and keeps the other supported Arabic face as fallback', () => {
    expect(fontToken('tajawal')).toBe('"Tajawal", "Cairo"');
    expect(fontToken('cairo')).toBe('"Cairo", "Tajawal"');
  });

  it('maps the legacy auto and unsupported font keys to the Tajawal-first stack', () => {
    for (const legacyKey of ['auto', 'amiri', 'cormorant', 'inter', 'unknown-font']) {
      expect(fontToken(legacyKey), `fontFamily=${legacyKey}`).toBe('"Tajawal", "Cairo"');
    }
  });

  it('uses the Tajawal-first stack for a restaurant with no stored theme', () => {
    const tokens = buildSemanticTokens(normalizeTheme(null), 'dark');
    expect(tokens['--m-font-chosen']).toBe('"Tajawal", "Cairo"');
  });

  it('removes generic CSS faces without dropping the authored Arabic fallbacks', () => {
    expect(stripGenericFaces('"Tajawal", "Cairo", system-ui, sans-serif')).toBe(
      '"Tajawal", "Cairo"'
    );
    expect(stripGenericFaces('"Cairo", "Tajawal", ui-sans-serif')).toBe(
      '"Cairo", "Tajawal"'
    );
    expect(stripGenericFaces('Tajawal, Cairo, system-ui, -apple-system, sans-serif')).toBe(
      'Tajawal, Cairo, -apple-system'
    );
  });

  it('is idempotent on a clean stack', () => {
    expect(stripGenericFaces('"Tajawal", "Cairo"')).toBe('"Tajawal", "Cairo"');
  });
});

describe('font propagation — shared menu, entry, and display contract', () => {
  it('emits the selected face on the canonical customer scope style', () => {
    const style = buildCustomerThemeStyle(
      normalizeTheme({ theme: effectiveTheme('cairo') }),
      'light'
    );
    expect(style['--m-font-chosen']).toBe('"Cairo", "Tajawal"');
    expect(style['--m-font']).toContain('"Cairo", "Tajawal"');
  });

  it('entry typography inherits the same canonical Arabic-first token', () => {
    const css = read('../index.css');
    expect(css).toContain("--entry-font-display: var(--m-font-chosen, 'Tajawal', sans-serif);");
    expect(css).toContain("--entry-font-text: var(--m-font-chosen, 'Tajawal', sans-serif);");
  });

  it('display typography uses --m-font and exposes no independent font picker', () => {
    const liveModel = read('../components/display/liveMenuModel.ts');
    const displaySettings = read('../components/manager/DisplayScreenSettingsView.tsx');
    expect(liveModel).toContain("'--lm-title-face': 'var(--m-font");
    expect(liveModel).toContain("'--lm-body-face': 'var(--m-font");
    expect(displaySettings).toContain('خط القائمة نفسه (Cairo أو Tajawal)');
    expect(displaySettings).not.toContain('fontFamily');
  });
});
