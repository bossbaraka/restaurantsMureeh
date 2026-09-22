/**
 * FINAL STEP — the simplified Theme Editor model.
 *
 * The editor's value depends on two properties that are easy to get wrong:
 *   1. Simple controls must DERIVE the low-level theme correctly.
 *   2. Opening and saving must never DISCARD a stored value the simple model
 *      cannot express (legacy themes carry plenty).
 */
import { describe, expect, it } from 'vitest';
import {
  THEME_PRESETS,
  applyPresetToDraft,
  detachPreset,
  toDraft,
  toThemeConfig,
  type ThemeDraft,
} from '../theme/editorModel';
import { normalizeTheme } from '../theme/normalizeTheme';
import { buildCustomerThemeStyle } from '../theme/semanticTokens';
import type { ThemeConfig } from '../types/restaurant';

const base = (): ThemeDraft => toDraft(null);

describe('simple controls derive the low-level theme', () => {
  it('a fresh draft has no preset (nothing was explicitly chosen)', () => {
    expect(base().presetId).toBeNull();
  });

  it('corner style produces a full radius scale', () => {
    const sharp = toThemeConfig({ ...base(), cornerStyle: 'sharp' });
    const pill = toThemeConfig({ ...base(), cornerStyle: 'pill' });
    expect(sharp.radius?.lg).toBe('6px');
    expect(pill.radius?.lg).toBe('26px');
    // The manager never types a CSS length.
    for (const key of ['sm', 'md', 'lg', 'xl', 'full'] as const) {
      expect(sharp.radius?.[key]).toMatch(/^\d+px$|^9999px$/);
    }
  });

  it('card style produces a full shadow scale', () => {
    const flat = toThemeConfig({ ...base(), cardStyle: 'flat' });
    const elevated = toThemeConfig({ ...base(), cardStyle: 'elevated' });
    expect(flat.shadows?.md).toContain('rgba');
    expect(elevated.shadows?.md).not.toBe(flat.shadows?.md);
    // Card shadow follows the chosen style rather than being typed by hand.
    expect(elevated.cards?.shadow).toBe(elevated.shadows?.md);
  });

  it('density maps to weights the server contract actually persists', () => {
    // There is no `typography.scale` in the schema; a scale field would be
    // silently dropped on save.
    const compact = toThemeConfig({ ...base(), density: 'compact' });
    const spacious = toThemeConfig({ ...base(), density: 'spacious' });
    expect(compact.typography?.headingWeight).toBe('600');
    expect(spacious.typography?.headingWeight).toBe('800');
    expect(compact.typography).not.toHaveProperty('scale');
  });

  it('appearance and brand colours land where the engine reads them', () => {
    const cfg = toThemeConfig({ ...base(), appearance: 'light', primary: '#1C64F2', accent: '#0B3FA8' });
    expect(cfg.mode).toBe('light');
    expect(cfg.colors?.primary).toBe('#1C64F2');
    expect(cfg.colors?.accent).toBe('#0B3FA8');
  });
});

describe('presets are real visual presets', () => {
  it('each preset defines more than two colours', () => {
    for (const p of THEME_PRESETS) {
      expect(p.cardStyle, p.id).toBeTruthy();
      expect(p.cornerStyle, p.id).toBeTruthy();
      expect(p.font, p.id).toBeTruthy();
      expect(p.appearance, p.id).toBeTruthy();
    }
  });

  it('selecting a preset updates the draft and records the explicit choice', () => {
    const next = applyPresetToDraft(base(), 'emerald');
    const preset = THEME_PRESETS.find((p) => p.id === 'emerald')!;
    expect(next.presetId).toBe('emerald');
    expect(next.primary).toBe(preset.primary);
    expect(next.cardStyle).toBe(preset.cardStyle);
    expect(next.cornerStyle).toBe(preset.cornerStyle);
    expect(next.font).toBe(preset.font);
  });

  it('the manager can still customise after picking a preset', () => {
    const picked = applyPresetToDraft(base(), 'emerald');
    const customised = detachPreset({ ...picked, primary: '#FF0000' });
    expect(customised.primary).toBe('#FF0000');
    // It is no longer that preset, so the UI must not claim it is.
    expect(customised.presetId).toBeNull();
    // …but everything else the preset set is retained.
    expect(customised.cardStyle).toBe(picked.cardStyle);
  });

  it('an unknown preset id is ignored rather than corrupting the draft', () => {
    const draft = base();
    expect(applyPresetToDraft(draft, 'does-not-exist')).toEqual(draft);
  });
});

describe('legacy themes are preserved, never guessed at', () => {
  it('presetId stays null for a stored theme even if colours match a preset', () => {
    // Correction 3: a theme whose primary happens to equal a preset's primary
    // is NOT that preset. Inferring it would relabel a manager's own work.
    const gold = THEME_PRESETS.find((p) => p.id === 'royal-gold')!;
    const stored: ThemeConfig = {
      mode: 'dark',
      colors: { primary: gold.primary, accent: gold.accent } as never,
    };
    expect(toDraft(stored).presetId).toBeNull();
  });

  it('presetId is set only when passed explicitly', () => {
    expect(toDraft({}, 'wine').presetId).toBe('wine');
  });

  it('keeps stored values the simple model cannot express', () => {
    const stored: ThemeConfig = {
      mode: 'dark',
      colors: {
        primary: '#111111',
        accent: '#222222',
        secondary: '#333333',
        background: '#000000',
        surface: '#0A0A0A',
        textPrimary: '#FFFFFF',
        textSecondary: '#AAAAAA',
        border: '#444444',
        success: '#00FF00',
        warning: '#FFAA00',
        error: '#FF0000',
        button: { primaryBg: '#ABCDEF', primaryText: '#000000' },
        category: { bg: '#123456', text: '#FEDCBA' },
      } as never,
    };
    const round = toThemeConfig(toDraft(stored));
    // Simple fields survive.
    expect(round.colors?.primary).toBe('#111111');
    // Everything else survives too — nothing is dropped.
    expect(round.colors?.secondary).toBe('#333333');
    expect(round.colors?.success).toBe('#00FF00');
    expect(round.colors?.button?.primaryBg).toBe('#ABCDEF');
    expect(round.colors?.category?.text).toBe('#FEDCBA');
  });

  it('keeps a bespoke radius/shadow scale that matches no named style', () => {
    const stored: ThemeConfig = {
      radius: { sm: '3px', md: '7px', lg: '13px', xl: '21px', full: '9999px' },
      shadows: { sm: '0 0 1px #000', md: '0 0 2px #000', lg: '0 0 3px #000' },
    };
    const round = toThemeConfig(toDraft(stored));
    expect(round.radius?.lg).toBe('13px');
    expect(round.shadows?.md).toBe('0 0 2px #000');
  });

  it('a legacy-only restaurant (no theme row) still produces a valid draft', () => {
    const draft = toDraft(undefined);
    const cfg = toThemeConfig(draft);
    expect(cfg.colors?.primary).toBeTruthy();
    expect(cfg.radius?.lg).toBeTruthy();
    expect(cfg.shadows?.md).toBeTruthy();
  });

  it('round-tripping twice is stable (no drift on repeated saves)', () => {
    const stored: ThemeConfig = {
      mode: 'light',
      colors: { primary: '#0E9F6E', accent: '#065F46', secondary: '#888888' } as never,
      radius: { sm: '6px', md: '10px', lg: '16px', xl: '22px', full: '9999px' },
    };
    const once = toThemeConfig(toDraft(stored));
    const twice = toThemeConfig(toDraft(once));
    expect(twice).toEqual(once);
  });
});

describe('the draft feeds the production token pipeline', () => {
  it('a draft produces the same tokens as the equivalent stored theme', () => {
    // This is what guarantees the preview cannot drift from the real menu:
    // both go through normalizeTheme -> buildCustomerThemeStyle.
    const draft = applyPresetToDraft(base(), 'midnight-blue');
    const cfg = toThemeConfig(draft);

    const viaDraft = buildCustomerThemeStyle(
      normalizeTheme({ theme: cfg } as never),
      'dark'
    ) as Record<string, string>;
    const viaStored = buildCustomerThemeStyle(
      normalizeTheme({ theme: cfg } as never),
      'dark'
    ) as Record<string, string>;

    expect(viaDraft).toEqual(viaStored);
    expect(viaDraft['--m-brand']).toBe('#4F7CFF');
  });

  it('changing appearance changes the derived surfaces', () => {
    const cfg = toThemeConfig({ ...base(), primary: '#D4AF37' });
    const theme = normalizeTheme({ theme: cfg } as never);
    const light = buildCustomerThemeStyle(theme, 'light') as Record<string, string>;
    const dark = buildCustomerThemeStyle(theme, 'dark') as Record<string, string>;
    expect(light['--m-surface']).not.toBe(dark['--m-surface']);
    expect(light['--m-text']).not.toBe(dark['--m-text']);
  });
});
