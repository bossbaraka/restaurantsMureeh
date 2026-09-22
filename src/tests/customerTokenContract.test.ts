/**
 * PHASE 4 — the customer semantic token contract.
 *
 * The migration removed every hardcoded colour fallback from the customer
 * layer, which is only safe if the provider GUARANTEES each token exists.
 * These tests pin that guarantee, the light/dark correctness the migration is
 * supposed to unlock, and the contrast of the pairs the UI actually renders.
 */
import { describe, expect, it } from 'vitest';
import { buildCustomerThemeStyle, buildSemanticTokens } from '../theme/semanticTokens';
import { normalizeTheme } from '../theme/normalizeTheme';
import { parseColor, contrastRatio, type Rgb } from '../theme/brandTheme';

type Tokens = Record<string, string>;

const theme = (primary: string, mode: 'light' | 'dark' | 'auto' = 'dark') =>
  normalizeTheme({ id: 'r', name: 'R', theme: { mode, colors: { primary } } } as never);

const build = (primary: string, mode: 'light' | 'dark'): Tokens =>
  buildCustomerThemeStyle(theme(primary), mode) as Tokens;

/** The palettes the phase brief requires, plus extremes. */
const PALETTES: Array<[string, string]> = [
  ['gold', '#D4AF37'],
  ['red', '#E02424'],
  ['green', '#0E9F6E'],
  ['blue', '#1C64F2'],
  ['white', '#FFFFFF'],
  ['black', '#000000'],
  ['high-saturation magenta', '#FF00AA'],
];

/** Tokens the customer layer now consumes with no fallback. */
const REQUIRED = [
  '--m-bg',
  '--m-surface',
  '--m-surface-raised',
  '--m-text',
  '--m-text-muted',
  '--m-text-subtle',
  '--m-hairline',
  '--m-hairline-strong',
  '--m-brand',
  '--m-brand-accent',
  '--m-brand-on-surface',
  '--m-brand-ink',
  '--m-brand-fill',
  '--m-brand-glow',
  '--m-card-bg',
  '--m-card-border',
  '--m-chip-bg',
  '--m-chip-text',
  '--m-chip-active-bg',
  '--m-chip-active-text',
  '--m-badge-bg',
  '--m-badge-text',
  '--m-button-bg',
  '--m-button-text',
  '--m-button-secondary-bg',
  '--m-button-secondary-text',
  '--m-success',
  '--m-warning',
  '--m-error',
  '--m-font',
  '--m-shadow-lg',
];

/** Channel tokens backing the Tailwind `m-*` colours (opacity modifiers). */
const REQUIRED_CHANNELS = [
  '--m-bg-rgb',
  '--m-surface-rgb',
  '--m-surface-raised-rgb',
  '--m-text-rgb',
  '--m-text-muted-rgb',
  '--m-text-subtle-rgb',
  '--m-hairline-rgb',
  '--m-brand-rgb',
  '--m-brand-accent-rgb',
  '--m-brand-on-surface-rgb',
];

describe('token presence — no consumer needs a fallback', () => {
  for (const [name, primary] of PALETTES) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${name} / ${mode} emits every required token`, () => {
        const tokens = build(primary, mode);
        const missing = REQUIRED.filter((t) => !tokens[t] || String(tokens[t]).trim() === '');
        expect(missing).toEqual([]);
      });
    }
  }

  it('emits channel triplets for every opacity-capable colour', () => {
    for (const [, primary] of PALETTES) {
      for (const mode of ['light', 'dark'] as const) {
        const tokens = build(primary, mode);
        for (const channel of REQUIRED_CHANNELS) {
          expect(tokens[channel], `${channel} @ ${primary}/${mode}`).toMatch(/^\d+ \d+ \d+$/);
        }
      }
    }
  });
});

describe('light/dark correctness', () => {
  const lum = (value: string): number => {
    const rgb = parseColor(value) as Rgb;
    return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  };

  it('light mode is genuinely light and dark mode genuinely dark', () => {
    // The whole point of the migration: `bg-luxury-950` was #0A0B0D in BOTH
    // modes. The semantic token must actually invert.
    for (const [name, primary] of PALETTES) {
      const light = build(primary, 'light');
      const dark = build(primary, 'dark');
      expect(lum(light['--m-surface']), `${name} light surface`).toBeGreaterThan(0.6);
      expect(lum(dark['--m-surface']), `${name} dark surface`).toBeLessThan(0.4);
    }
  });

  it('text polarity follows the surface — never light text on a light card', () => {
    for (const [name, primary] of PALETTES) {
      const light = build(primary, 'light');
      const dark = build(primary, 'dark');
      expect(lum(light['--m-text']), `${name} light text`).toBeLessThan(0.4);
      expect(lum(dark['--m-text']), `${name} dark text`).toBeGreaterThan(0.6);
    }
  });

  it('auto resolves through the same pipeline, not a separate branch', () => {
    const auto = buildSemanticTokens(theme('#D4AF37', 'auto'), 'light') as Tokens;
    const explicit = buildSemanticTokens(theme('#D4AF37', 'light'), 'light') as Tokens;
    expect(auto['--m-surface']).toBe(explicit['--m-surface']);
    expect(auto['--m-text']).toBe(explicit['--m-text']);
  });
});

describe('contrast — WCAG AA on the pairs the UI actually renders', () => {
  const ratio = (fg: string, bg: string): number =>
    contrastRatio(parseColor(fg) as Rgb, parseColor(bg) as Rgb);

  for (const [name, primary] of PALETTES) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${name} / ${mode}: body and muted text stay readable`, () => {
        const t = build(primary, mode);
        // AA for normal text.
        expect(ratio(t['--m-text'], t['--m-surface']), 'text on surface').toBeGreaterThanOrEqual(4.5);
        expect(
          ratio(t['--m-text'], t['--m-surface-raised']),
          'text on raised surface'
        ).toBeGreaterThanOrEqual(4.5);
        // Muted text is secondary; AA large / UI component minimum.
        expect(
          ratio(t['--m-text-muted'], t['--m-surface']),
          'muted text on surface'
        ).toBeGreaterThanOrEqual(3);
      });

      it(`${name} / ${mode}: primary button label is readable on its fill`, () => {
        const t = build(primary, mode);
        // --m-button-bg is a GRADIENT (brand.fill), so it has no single
        // colour. The label's readability is governed by the brand colour the
        // gradient is built from, which is what brand.ink is chosen against.
        expect(t['--m-button-bg']).toContain('gradient');
        expect(ratio(t['--m-button-text'], t['--m-brand'])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('compatibility aliases still resolve', () => {
  it('legacy families remain emitted for unmigrated consumers', () => {
    const tokens = build('#D4AF37', 'dark');
    // Phase 4 does not remove aliases; CSS and non-customer code still use them.
    for (const legacy of ['--brand-primary', '--theme-bg', '--menu-surface']) {
      expect(tokens[legacy], legacy).toBeTruthy();
    }
  });

  it('aliases agree with the semantic tokens they mirror', () => {
    for (const mode of ['light', 'dark'] as const) {
      const t = build('#1C64F2', mode);
      // Same derivation, so they cannot drift.
      expect(t['--brand-primary-strong']).toBe(t['--m-brand-on-surface']);
      expect(t['--menu-surface']).toBe(t['--m-surface']);
      expect(t['--theme-bg']).toBe(t['--m-bg']);
    }
  });
});
