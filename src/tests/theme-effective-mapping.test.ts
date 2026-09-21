import { describe, expect, it } from 'vitest';
import { mapEffectiveTheme, uiThemeConfigFromServer } from '../services/api';
import {
  THEME_VAR_NAMES,
  applyEffectiveTheme,
  buildEffectiveThemeVars,
  resolveThemeShadow,
  themeShadowKey,
} from '../theme/brandTheme';
import { toServerThemePayload } from '../components/manager/BrandingSettingsView';
import type { EffectiveTheme, ThemeConfig } from '../types/restaurant';

/**
 * Phase 4 — Effective Theme mapping & runtime contract.
 *
 * Pipeline under test:
 *   DB → Theme Resolver → API payload → mapEffectiveTheme
 *     → Effective Theme → buildEffectiveThemeVars → CSS tokens
 *
 * Guards the two Phase 4 invariants:
 *   1. No supported Theme property disappears between the API and the
 *      frontend (colors.button/card/badge/category included).
 *   2. The manager edit model round-trips through toServerThemePayload ↔
 *      uiThemeConfigFromServer without silent data loss.
 */

/** A server ResolvedTheme as it arrives from resolveEffectiveTheme. */
const serverResolvedTheme = () => ({
  mode: 'dark',
  colors: {
    primary: '#123456',
    secondary: '#654321',
    accent: '#654321',
    background: '#0A0B0D',
    surface: '#15171A',
    textPrimary: '#F5F5F0',
    textSecondary: '#A0A0A0',
    border: '#2A2D32',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    button: { primaryBg: '#112233', primaryText: '#EEEEEE', secondaryBg: '#223344', secondaryText: '#DDDDDD' },
    card: { bg: '#101010', border: '#202020', shadow: '0 4px 20px rgba(0,0,0,0.4)', radius: '22px' },
    badge: { bg: '#334455', text: '#F0F0F0' },
    category: { bg: '#445566', text: '#E0E0E0', activeBg: '#556677', activeText: '#D0D0D0' },
  },
  radius: { sm: '6px', md: '10px', lg: '16px', xl: '24px', full: '9999px' },
  shadows: {
    sm: '0 1px 3px rgba(0,0,0,0.3)',
    md: '0 4px 20px rgba(0,0,0,0.4)',
    lg: '0 10px 40px rgba(0,0,0,0.5)',
  },
  typography: { fontFamily: 'cairo', headingWeight: 800, bodyWeight: 400 },
  background: {
    light: { type: 'solid', color: '#FFFFFF', url: null, storagePath: null },
    dark: {
      type: 'image+overlay',
      color: undefined,
      gradient: undefined,
      url: 'https://cdn.example/bg.jpg',
      storagePath: null, // public catalog strips storagePath
      overlay: 'rgba(0,0,0,0.6)',
      overlayOpacity: 0.7,
      blur: 2,
      position: 'top',
      size: 'cover',
      readability: { scrimOpacity: 0.55, textShadow: true },
    },
  },
  source: 'branch',
  rawConfig: {
    mode: 'dark',
    colors: {
      primary: '#123456',
      secondary: '#654321',
      accent: '#654321',
      background: '#0A0B0D',
      surface: '#15171A',
      textPrimary: '#F5F5F0',
      textSecondary: '#A0A0A0',
      border: '#2A2D32',
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      button: { primaryBg: '#112233', primaryText: '#EEEEEE', secondaryBg: '#223344', secondaryText: '#DDDDDD' },
      card: { bg: '#101010', border: '#202020', shadow: '0 4px 20px rgba(0,0,0,0.4)', radius: '22px' },
      badge: { bg: '#334455', text: '#F0F0F0' },
      category: { bg: '#445566', text: '#E0E0E0', activeBg: '#556677', activeText: '#D0D0D0' },
    },
    radius: { sm: '6px', md: '10px', lg: '16px', xl: '24px', full: '9999px' },
    shadows: {
      sm: '0 1px 3px rgba(0,0,0,0.3)',
      md: '0 4px 20px rgba(0,0,0,0.4)',
      lg: '0 10px 40px rgba(0,0,0,0.5)',
    },
    typography: { fontFamily: 'cairo', headingWeight: 800, bodyWeight: 400 },
    background: {
      dark: {
        type: 'image+overlay',
        image: { storagePath: 'restaurants/rest-1/theme/bg.jpg', aiGenerated: true },
        overlay: 'rgba(0,0,0,0.6)',
        overlayOpacity: 0.7,
        blur: 2,
        position: 'top',
        size: 'cover',
        readability: { scrimOpacity: 0.55 },
      },
    },
  },
});

describe('Effective Theme mapping — no supported property disappears', () => {
  it('preserves colors.button/card/badge/category verbatim', () => {
    const mapped = mapEffectiveTheme(serverResolvedTheme()) as EffectiveTheme;
    expect(mapped.colors.button).toEqual({
      primaryBg: '#112233',
      primaryText: '#EEEEEE',
      secondaryBg: '#223344',
      secondaryText: '#DDDDDD',
    });
    expect(mapped.colors.card).toEqual({
      bg: '#101010',
      border: '#202020',
      shadow: '0 4px 20px rgba(0,0,0,0.4)',
      radius: '22px',
    });
    expect(mapped.colors.badge).toEqual({ bg: '#334455', text: '#F0F0F0' });
    expect(mapped.colors.category).toEqual({
      bg: '#445566',
      text: '#E0E0E0',
      activeBg: '#556677',
      activeText: '#D0D0D0',
    });
  });

  it('maps scalar colors, radius, shadows and numeric weights without loss', () => {
    const mapped = mapEffectiveTheme(serverResolvedTheme()) as EffectiveTheme;
    expect(mapped.colors.primary).toBe('#123456');
    expect(mapped.colors.error).toBe('#EF4444');
    expect(mapped.radius.lg).toBe('16px');
    expect(mapped.shadows.lg).toBe('0 10px 40px rgba(0,0,0,0.5)');
    expect(mapped.typography.fontFamily).toBe('cairo');
    expect(mapped.typography.headingWeight).toBe('800');
    expect(mapped.typography.bodyWeight).toBe('400');
    expect(mapped.source).toBe('branch');
  });

  it('carries the card overrides onto the cards view model', () => {
    const mapped = mapEffectiveTheme(serverResolvedTheme()) as EffectiveTheme;
    expect(mapped.cards.radius).toBe('22px');
    expect(mapped.cards.shadow).toBe('0 4px 20px rgba(0,0,0,0.4)');
  });

  it('leaves cards empty when the API set no explicit override (scale derivation)', () => {
    const raw = serverResolvedTheme();
    delete (raw.colors as any).card;
    delete (raw.rawConfig.colors as any).card;
    const mapped = mapEffectiveTheme(raw) as EffectiveTheme;
    expect(mapped.cards.radius).toBeUndefined();
    expect(mapped.cards.shadow).toBeUndefined();
  });

  it('keeps background overlay + readability through the naming conversion', () => {
    const mapped = mapEffectiveTheme(serverResolvedTheme()) as EffectiveTheme;
    expect(mapped.background.dark.overlayColor).toBe('rgba(0,0,0,0.6)');
    expect(mapped.background.dark.overlayOpacity).toBe(0.7);
    expect(mapped.background.dark.readabilityBoost).toBe(true);
  });

  it('normalizes odd modes to auto (the documented default)', () => {
    expect(mapEffectiveTheme({ ...(serverResolvedTheme() as any), mode: 'neon' })!.mode).toBe('auto');
    expect(mapEffectiveTheme({ ...(serverResolvedTheme() as any), mode: undefined })!.mode).toBe('auto');
    expect(mapEffectiveTheme({ ...(serverResolvedTheme() as any), mode: 'light' })!.mode).toBe('light');
  });

  it('handles the PUBLIC catalog payload (rawConfig stripped, storagePath hidden)', () => {
    const publicTheme: any = { ...serverResolvedTheme() };
    delete publicTheme.rawConfig;
    publicTheme.background = {
      light: { type: 'solid', color: '#FFFFFF', url: null },
      dark: {
        type: 'image+overlay',
        url: 'https://cdn.example/bg.jpg',
        overlay: 'rgba(0,0,0,0.6)',
        overlayOpacity: 0.7,
        readability: { scrimOpacity: 0.55 },
      },
    };
    const mapped = mapEffectiveTheme(publicTheme) as EffectiveTheme;
    expect(mapped.colors.button?.primaryBg).toBe('#112233');
    expect(mapped.colors.category?.activeBg).toBe('#556677');
    expect(mapped.cards.radius).toBe('22px');
    expect(mapped.rawConfig.colors?.badge?.bg).toBe('#334455');
    expect(mapped.rawConfig.background?.dark?.overlayColor).toBe('rgba(0,0,0,0.6)');
    expect(mapped.rawConfig.background?.dark?.readabilityBoost).toBe(true);
  });
});

describe('rawConfig hydration — server config → UI edit model', () => {
  it('converts overlay/readability to the UI naming and keeps the image reference', () => {
    const mapped = mapEffectiveTheme(serverResolvedTheme()) as EffectiveTheme;
    const bg = mapped.rawConfig.background?.dark;
    expect(bg?.overlayColor).toBe('rgba(0,0,0,0.6)');
    expect(bg?.readabilityBoost).toBe(true);
    expect(bg?.image).toEqual({ storagePath: 'restaurants/rest-1/theme/bg.jpg', aiGenerated: true });
  });

  it('keeps the colour groups in the edit model so a save never drops them', () => {
    const mapped = mapEffectiveTheme(serverResolvedTheme()) as EffectiveTheme;
    expect(mapped.rawConfig.colors?.button?.primaryBg).toBe('#112233');
    expect(mapped.rawConfig.colors?.badge?.bg).toBe('#334455');
    expect(mapped.rawConfig.colors?.category?.activeBg).toBe('#556677');
  });

  it('maps a scale-matching card shadow to its key (select round-trip)', () => {
    const raw = serverResolvedTheme();
    (raw.rawConfig.colors as any).card.shadow = raw.rawConfig.shadows!.md;
    const mapped = mapEffectiveTheme(raw) as EffectiveTheme;
    expect(mapped.rawConfig.cards?.shadow).toBe('md');
  });

  it('keeps a custom CSS shadow verbatim when it matches no scale entry', () => {
    const mapped = mapEffectiveTheme(serverResolvedTheme()) as EffectiveTheme;
    // '0 4px 20px rgba(0,0,0,0.4)' equals shadows.md in this fixture → key
    expect(mapped.rawConfig.cards?.shadow).toBe('md');
    const custom = serverResolvedTheme();
    (custom.rawConfig.colors as any).card.shadow = '2px 2px 2px red';
    (custom.colors as any).card.shadow = '2px 2px 2px red';
    const mappedCustom = mapEffectiveTheme(custom) as EffectiveTheme;
    expect(mappedCustom.rawConfig.cards?.shadow).toBe('2px 2px 2px red');
    expect(mappedCustom.cards.shadow).toBe('2px 2px 2px red');
  });
});

describe('save round-trip — toServerThemePayload ↔ uiThemeConfigFromServer', () => {
  const legacy = { primaryColor: '#D4AF37', accentColor: '#C5A880' };

  it('preserves the colour groups through a full edit round-trip', () => {
    const ui = uiThemeConfigFromServer(serverResolvedTheme().rawConfig);
    const saved = toServerThemePayload(ui, legacy);
    expect(saved.colors.button).toEqual({
      primaryBg: '#112233',
      primaryText: '#EEEEEE',
      secondaryBg: '#223344',
      secondaryText: '#DDDDDD',
    });
    expect(saved.colors.card?.bg).toBe('#101010');
    expect(saved.colors.card?.border).toBe('#202020');
    expect(saved.colors.badge).toEqual({ bg: '#334455', text: '#F0F0F0' });
    expect(saved.colors.category?.activeText).toBe('#D0D0D0');
  });

  it('resolves cards.shadow keys to real CSS values on save (never stores the key)', () => {
    const ui = uiThemeConfigFromServer(serverResolvedTheme().rawConfig);
    ui.cards = { shadow: 'lg' };
    const saved = toServerThemePayload(ui, legacy);
    expect(saved.colors.card?.shadow).toBe('0 10px 40px rgba(0,0,0,0.5)');

    // …and the saved CSS value hydrates back to the same key.
    const round = uiThemeConfigFromServer({ ...saved });
    expect(round.cards?.shadow).toBe('lg');
  });

  it('preserves card radius overrides and background readability/overlay', () => {
    const ui = uiThemeConfigFromServer(serverResolvedTheme().rawConfig);
    const saved = toServerThemePayload(ui, legacy);
    expect(saved.colors.card?.radius).toBe('22px');
    expect(saved.background?.dark?.overlay).toBe('rgba(0,0,0,0.6)');
    expect(saved.background?.dark?.readability).toEqual({ scrimOpacity: 0.55 });
    expect(saved.background?.dark?.image).toEqual({
      storagePath: 'restaurants/rest-1/theme/bg.jpg',
      aiGenerated: true,
    });
  });

  it('drops unparseable group colours instead of failing the strict schema', () => {
    const ui: ThemeConfig = {
      colors: {
        primary: '#123456',
        secondary: '#654321',
        accent: '#654321',
        background: '#0A0B0D',
        surface: '#15171A',
        textPrimary: '#F5F5F0',
        textSecondary: '#A0A0A0',
        border: '#2A2D32',
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
        badge: { bg: 'not-a-color', text: '#F0F0F0' },
      },
    };
    const saved = toServerThemePayload(ui, legacy);
    expect(saved.colors.badge).toEqual({ text: '#F0F0F0' });
  });
});

describe('Theme runtime — tokens reach the DOM', () => {
  const effective = () => mapEffectiveTheme(serverResolvedTheme()) as EffectiveTheme;

  it('emits every declared theme variable', () => {
    const vars = buildEffectiveThemeVars(effective());
    for (const name of THEME_VAR_NAMES) {
      expect(vars[name], `${name} must be emitted`).toBeDefined();
    }
  });

  it('emits the colour-group tokens with their values', () => {
    const vars = buildEffectiveThemeVars(effective());
    expect(vars['--button-bg']).toBe('#112233');
    expect(vars['--card-bg']).toBe('#101010');
    expect(vars['--badge-bg']).toBe('#334455');
    expect(vars['--category-active-bg']).toBe('#556677');
  });

  it('emits empty group tokens (CSS removal) when the API set no override', () => {
    const raw = serverResolvedTheme();
    delete (raw.colors as any).badge;
    delete (raw.rawConfig.colors as any).badge;
    const vars = buildEffectiveThemeVars(mapEffectiveTheme(raw) as EffectiveTheme);
    expect(vars['--badge-bg']).toBe('');
    expect(vars['--badge-text']).toBe('');
  });

  it('derives radius tokens: card override wins, scale fills the rest', () => {
    const vars = buildEffectiveThemeVars(effective());
    expect(vars['--card-radius']).toBe('22px'); // colors.card.radius
    expect(vars['--button-radius']).toBe('10px'); // radius.md
    expect(vars['--badge-radius']).toBe('9999px'); // radius.full

    const raw = serverResolvedTheme();
    delete (raw.colors as any).card;
    delete (raw.rawConfig.colors as any).card;
    const noOverride = buildEffectiveThemeVars(mapEffectiveTheme(raw) as EffectiveTheme);
    expect(noOverride['--card-radius']).toBe('16px'); // radius.lg
  });

  it('always resolves --card-shadow to a real CSS shadow', () => {
    const vars = buildEffectiveThemeVars(effective());
    expect(vars['--card-shadow']).toBe('0 4px 20px rgba(0,0,0,0.4)');

    // Scale key stored instead of the CSS value (legacy adapter output)
    const keyed = effective();
    keyed.cards.shadow = 'lg';
    expect(buildEffectiveThemeVars(keyed)['--card-shadow']).toBe('0 10px 40px rgba(0,0,0,0.5)');

    const bare = effective();
    bare.cards.shadow = '';
    expect(buildEffectiveThemeVars(bare)['--card-shadow']).toBe('0 4px 20px rgba(0,0,0,0.4)'); // shadows.md
  });

  it('applyEffectiveTheme writes the tokens onto the style target', () => {
    const written: Record<string, string> = {};
    const target = { setProperty: (k: string, v: string) => void (written[k] = v) };
    applyEffectiveTheme(effective(), target as any);
    for (const name of THEME_VAR_NAMES) {
      expect(written[name], `${name} must be applied`).toBeDefined();
    }
    expect(written['--card-radius']).toBe('22px');
    // Legacy brand tokens remain applied for backward compatibility
    expect(written['--brand-primary']).toBeDefined();
    expect(written['--brand-accent']).toBeDefined();
  });
});

describe('shadow helpers', () => {
  it('resolves keys against the scale and passes CSS values through', () => {
    const shadows = { sm: 'S', md: 'M', lg: 'L' };
    expect(resolveThemeShadow('sm', shadows)).toBe('S');
    expect(resolveThemeShadow('lg', shadows)).toBe('L');
    expect(resolveThemeShadow('1px 1px 1px red', shadows)).toBe('1px 1px 1px red');
    expect(resolveThemeShadow(undefined, shadows)).toBe('');
  });

  it('maps scale values back to keys and reports customs as null', () => {
    const shadows = { sm: 'S', md: 'M', lg: 'L' };
    expect(themeShadowKey('sm', shadows)).toBe('sm');
    expect(themeShadowKey('M', shadows)).toBe('md');
    expect(themeShadowKey('custom', shadows)).toBeNull();
    expect(themeShadowKey(undefined, shadows)).toBeNull();
  });
});
