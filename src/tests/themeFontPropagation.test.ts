/**
 * FONT PROPAGATION GUARD — every guest-facing surface follows ONE font decision.
 * ===========================================================================
 *
 * WHAT THIS PINS
 * --------------
 * The theme engine's contract for typography propagation:
 *
 *   1. `--m-font-chosen` is emitted ONLY when the tenant explicitly chose a
 *      font (typography.fontFamily ≠ 'auto'). It is an OPTIONAL presence
 *      token — deliberately outside SEMANTIC_TOKEN_NAMES, whose members are
 *      pinned to be always non-empty. Its "absent" encoding is the empty
 *      string, the exact convention the per-component colour overrides use,
 *      so `var(--m-font-chosen, <face>)` falls back cleanly.
 *
 *   2. When present, the value contains ONLY authored faces — generic CSS
 *      keywords (`serif`, `system-ui`, …) are stripped, so consumers keep
 *      control of script-coverage fallbacks (Arabic stays on Tajawal instead
 *      of falling into a device serif behind a Latin-only display face).
 *
 *   3. The entry experience consumes the token theme-first with its shipped
 *      faces as fallbacks — an explicit font re-types the entry page, a
 *      tenant without a font choice renders byte-identically to before.
 *
 *   4. The pipeline end-to-end: normalizeTheme → buildSemanticTokens →
 *      buildCustomerThemeStyle carries the token to the single writer.
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
import type { EffectiveTheme } from '../types/restaurant';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const effectiveTheme = (fontFamily: string): EffectiveTheme =>
  ({
    mode: 'auto',
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

const GENERIC_KEYWORDS = [
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
];

describe('--m-font-chosen — presence contract', () => {
  it('is ABSENT (empty) when no font was explicitly chosen', () => {
    for (const source of [effectiveTheme('auto'), null, undefined]) {
      const tokens = buildSemanticTokens(normalizeTheme({ theme: source }), 'dark');
      expect(tokens['--m-font-chosen']).toBe('');
    }
  });

  it('is emitted for every editor font choice with its authored face', () => {
    const cases: Array<[string, string]> = [
      ['tajawal', '"Tajawal"'],
      ['cairo', '"Cairo"'],
      ['amiri', '"Amiri"'],
      ['cormorant', '"Cormorant Garamond"'],
    ];
    for (const [fontFamily, expected] of cases) {
      const tokens = buildSemanticTokens(normalizeTheme({ theme: effectiveTheme(fontFamily) }), 'dark');
      expect(tokens['--m-font-chosen'], `fontFamily=${fontFamily}`).toBe(expected);
    }
  });

  it('carries no generic CSS font keywords', () => {
    for (const fontFamily of ['tajawal', 'cairo', 'amiri', 'cormorant']) {
      const tokens = buildSemanticTokens(normalizeTheme({ theme: effectiveTheme(fontFamily) }), 'dark');
      const faces = tokens['--m-font-chosen'].split(',').map((f) =>
        f.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
      );
      for (const keyword of GENERIC_KEYWORDS) {
        expect(faces, `fontFamily=${fontFamily}`).not.toContain(keyword);
      }
    }
  });

  it('never invents a face for an unknown legacy font key — falls back to absent', () => {
    const tokens = buildSemanticTokens(
      normalizeTheme({ theme: effectiveTheme('definitely-not-a-font') }),
      'dark'
    );
    expect(tokens['--m-font-chosen']).toBe('');
  });

  it('does not disturb the always-present --m-font token', () => {
    const auto = buildSemanticTokens(normalizeTheme({ theme: effectiveTheme('auto') }), 'dark');
    const chosen = buildSemanticTokens(normalizeTheme({ theme: effectiveTheme('cairo') }), 'dark');
    expect(auto['--m-font']).not.toBe('');
    expect(chosen['--m-font']).toContain('Cairo');
    expect(chosen['--m-font-chosen']).toBe('"Cairo"');
  });
});

describe('stripGenericFaces', () => {
  it('keeps authored faces and drops every generic keyword', () => {
    expect(stripGenericFaces('"Tajawal", system-ui, sans-serif')).toBe('"Tajawal"');
    expect(stripGenericFaces('"Cormorant Garamond", serif')).toBe('"Cormorant Garamond"');
    expect(stripGenericFaces('Tajawal, Cairo, system-ui, -apple-system, sans-serif')).toBe(
      'Tajawal, Cairo, -apple-system'
    );
  });

  it('is idempotent on an already-clean stack', () => {
    expect(stripGenericFaces('"Amiri"')).toBe('"Amiri"');
  });
});

describe('entry experience consumes the token theme-first', () => {
  const css = read('../index.css');

  it('entry display face chains --m-font-chosen before the shipped serif', () => {
    expect(css).toContain(
      '--entry-font-display: var(--m-font-chosen, var(--font-serif, Georgia, serif));'
    );
  });

  it('entry text face chains --m-font-chosen before the shipped sans stack', () => {
    expect(css).toContain(
      '--entry-font-text: var(--m-font-chosen, var(--font-sans, system-ui, -apple-system, sans-serif));'
    );
  });
});

describe('single-writer delivery', () => {
  it('buildCustomerThemeStyle carries the token to the scope for explicit fonts', () => {
    const style = buildCustomerThemeStyle(
      normalizeTheme({ theme: effectiveTheme('amiri') }),
      'dark'
    );
    expect(style['--m-font-chosen']).toBe('"Amiri"');
  });

  it('buildCustomerThemeStyle emits the absent encoding for auto fonts', () => {
    const style = buildCustomerThemeStyle(normalizeTheme({ theme: effectiveTheme('auto') }), 'light');
    expect(style['--m-font-chosen']).toBe('');
  });
});
