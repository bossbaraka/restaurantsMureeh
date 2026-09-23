/**
 * THEME TEMPLATES CONTRACTS
 * ============================================================================
 *
 * The templates are curated data that enter the EXISTING pipeline at the
 * editor's draft. These tests pin that contract from both sides:
 *
 *   data side    — 9–12 templates, unique ids, flippable surface scalars,
 *                  standard status colours, light+dark backgrounds, no
 *                  per-component groups, no cards slot;
 *   engine side  — every template config passes the server's STRICT
 *                  themeConfigSchema after toServerThemePayload, round-trips
 *                  through the editor model (toDraft → toThemeConfig) with
 *                  the named scales read back exactly (server-payload
 *                  equivalence), and renders a correct, readable LIGHT and
 *                  DARK face through the production token pipeline
 *                  (normalizeTheme → buildSemanticTokens), measured with the
 *                  engine's own contrastRatio.
 */
import { describe, it, expect } from 'vitest';
import { THEME_TEMPLATES, TEMPLATE_DRAFTS, type ThemeTemplate } from '../theme/themeTemplates';
import { toDraft, toThemeConfig } from '../theme/editorModel';
import { toServerThemePayload } from '../components/manager/BrandingSettingsView';
import { themeConfigSchema } from '../../server/validation/schemas';
import { normalizeTheme } from '../theme/normalizeTheme';
import { buildSemanticTokens, type TokenMap } from '../theme/semanticTokens';
import { contrastRatio, parseColor, type Rgb } from '../theme/brandTheme';
import type { ThemeConfig } from '../types/restaurant';

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const FONT_KEYS: readonly string[] = ['auto', 'tajawal', 'cairo', 'amiri', 'cormorant'];
const STATUS_COLORS = { success: '#10B981', warning: '#F59E0B', error: '#EF4444' } as const;

/**
 * The exact platform default values brandTheme.ts PLATFORM_DARK_DEFAULT_COLORS
 * flips per mode. Templates must keep the surface scalars inside this set so
 * light mode stays legible without any new switching mechanism.
 */
const FLIPPABLE_SURFACE_VALUES: Record<string, ReadonlySet<string>> = {
  background: new Set(['#0A0B0D']),
  surface: new Set(['#15171A', '#121416']),
  textPrimary: new Set(['#F5F5F0', '#F8FAFC']),
  textSecondary: new Set(['#A0A0A0', '#94A3B8']),
  border: new Set(['#2A2D32', '#1E293B']),
};

const legacyOf = (t: ThemeTemplate) => ({
  primaryColor: t.config.colors?.primary || '',
  accentColor: t.config.colors?.accent || '',
});

const payloadOfConfig = (cfg: ThemeConfig, t: ThemeTemplate) => toServerThemePayload(cfg, legacyOf(t));
const payloadOf = (t: ThemeTemplate) => payloadOfConfig(t.config, t);

/**
 * The editor's draft round-trip materializes the `cards` slot (toThemeConfig
 * always derives cards.radius/shadow from the chosen styles). The engine
 * resolves `--card-radius` as `cards.radius || radius.lg` and `--card-shadow`
 * as `resolveThemeShadow(cards.shadow) || shadows.md` (buildEffectiveThemeVars)
 * — so a card entry identical to the scale value renders nothing new. The
 * normalization below strips exactly those redundant entries, keeping the
 * equivalence assertion at the server-payload level (what is actually stored)
 * while allowing the documented re-derivation.
 */
function normalizeCardSlot(payload: any): any {
  const card = payload?.colors?.card;
  if (!card) return payload;
  const rest: Record<string, string> = { ...card };
  if (rest.radius === payload?.radius?.lg) delete rest.radius;
  if (rest.shadow === payload?.shadows?.md) delete rest.shadow;
  const colors = { ...payload.colors };
  if (Object.keys(rest).length === 0) delete colors.card;
  else colors.card = rest;
  return { ...payload, colors };
}

/** The engine's own contrast math — no second algorithm here. */
const contrast = (a?: string, b?: string, label = 'contrast'): number => {
  const ra = a ? parseColor(a) : null;
  const rb = b ? parseColor(b) : null;
  expect(ra, `${label}: parse ${a ?? '∅'}`).toBeTruthy();
  expect(rb, `${label}: parse ${b ?? '∅'}`).toBeTruthy();
  return contrastRatio(ra as Rgb, rb as Rgb);
};

const FILL_STOP_PATTERN = /#[0-9a-fA-F]{6}/g;

// ---------------------------------------------------------------------------
// 1 — Data integrity
// ---------------------------------------------------------------------------
describe('theme templates — data integrity', () => {
  it('ships 9–12 templates', () => {
    expect(THEME_TEMPLATES.length).toBeGreaterThanOrEqual(9);
    expect(THEME_TEMPLATES.length).toBeLessThanOrEqual(12);
  });

  it('has unique stable ids', () => {
    const ids = THEME_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('precomputes one draft per template (static data — no per-render work)', () => {
    expect(TEMPLATE_DRAFTS.size).toBe(THEME_TEMPLATES.length);
    for (const t of THEME_TEMPLATES) {
      expect(TEMPLATE_DRAFTS.has(t.id)).toBe(true);
      expect(TEMPLATE_DRAFTS.get(t.id)?.appearance).toBe('auto');
    }
  });

  for (const t of THEME_TEMPLATES) {
    describe(`template ${t.id} (${t.label})`, () => {
      it('is a full design: mode auto, valid identity, valid font', () => {
        expect(t.config.mode).toBe('auto');
        expect(t.config.colors?.primary).toMatch(HEX6);
        expect(t.config.colors?.accent).toMatch(HEX6);
        expect(FONT_KEYS).toContain(t.config.typography?.fontFamily);
        expect(t.config.typography?.headingWeight).toMatch(/^\d{3}$/);
        expect(t.config.typography?.bodyWeight).toMatch(/^\d{3}$/);
      });

      it('keeps the surface scalars on the flippable platform defaults', () => {
        const c = t.config.colors!;
        for (const key of ['background', 'surface', 'textPrimary', 'textSecondary', 'border'] as const) {
          expect(
            FLIPPABLE_SURFACE_VALUES[key].has((c[key] || '').toUpperCase()),
            `${key}=${c[key]} must be an exact platform default (mode flip depends on it)`
          ).toBe(true);
        }
      });

      it('uses the standard platform status colours', () => {
        expect(t.config.colors?.success).toBe(STATUS_COLORS.success);
        expect(t.config.colors?.warning).toBe(STATUS_COLORS.warning);
        expect(t.config.colors?.error).toBe(STATUS_COLORS.error);
      });

      it('carries an independent light and dark background', () => {
        const bg = t.config.background;
        expect(bg?.light, 'background.light must exist').toBeTruthy();
        expect(bg?.dark, 'background.dark must exist').toBeTruthy();
        for (const variant of ['light', 'dark'] as const) {
          const v = bg![variant]!;
          if (v.type === 'solid') expect(v.color, `${variant} solid needs a colour`).toMatch(HEX6);
          if (v.type === 'gradient') expect(v.gradient, `${variant} gradient needs a value`).toMatch(/^linear-gradient\(/);
        }
      });

      it('ships no per-component colour groups and no cards slot (engine-derived)', () => {
        const c = t.config.colors!;
        expect(c.button).toBeUndefined();
        expect(c.card).toBeUndefined();
        expect(c.badge).toBeUndefined();
        expect(c.category).toBeUndefined();
        expect(t.config.cards).toBeUndefined();
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 2 — Editor-model round trip (server-payload level)
// ---------------------------------------------------------------------------
describe('template → editor model round trip', () => {
  for (const t of THEME_TEMPLATES) {
    it(`${t.id}: named styles read back exactly; the stored payload is unchanged`, () => {
      const draft = toDraft(t.config, null);

      // The scales must match the named styles EXACTLY (no bespoke override)
      // — otherwise the simple editor would mislabel the design.
      expect(draft.cornerStyle, 'corner scale must be a named style').toBe(t.cornerStyle);
      expect(draft.cardStyle, 'shadow scale must be a named style').toBe(t.cardStyle);
      expect(draft.density).toBe(t.density);
      expect(draft.font).toBe(t.font);
      expect(draft.overrides.radius).toBeUndefined();
      expect(draft.overrides.shadows).toBeUndefined();
      expect(draft.overrides.typography).toBeUndefined();
      expect(draft.overrides.cards).toBeUndefined();

      const roundTripped = toThemeConfig(draft);
      expect(normalizeCardSlot(payloadOfConfig(roundTripped, t))).toEqual(normalizeCardSlot(payloadOf(t)));
    });
  }
});

// ---------------------------------------------------------------------------
// 3 — Server contract (strict zod)
// ---------------------------------------------------------------------------
describe('template configs validate against the server contract', () => {
  for (const t of THEME_TEMPLATES) {
    it(`${t.id}: toServerThemePayload passes themeConfigSchema (strict)`, () => {
      const res = themeConfigSchema.safeParse(payloadOf(t));
      expect(res.success, res.success ? '' : JSON.stringify(res.error.issues, null, 2)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 4 — Light + dark faces through the PRODUCTION token pipeline
// ---------------------------------------------------------------------------
describe('light + dark faces (production tokens, engine contrast)', () => {
  const render = (t: ThemeTemplate, mode: 'light' | 'dark'): TokenMap => {
    // The same minimal shape the manager preview feeds the pipeline
    // (ThemeTokensScope → CustomerThemeProvider → buildSemanticTokens).
    const normalized = normalizeTheme({
      theme: t.config,
      primaryColor: legacyOf(t).primaryColor,
      accentColor: legacyOf(t).accentColor,
    } as never);
    return buildSemanticTokens(normalized, mode);
  };

  for (const t of THEME_TEMPLATES) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${t.id} (${mode}): correct face, readable surfaces, text and button`, () => {
        const tokens = render(t, mode);

        // Correct face: the shell background is the flippable platform value.
        expect(tokens['--m-bg']).toBe(mode === 'light' ? '#FFFFFF' : '#0A0B0D');

        // Readable text on the shell and on the card surface (the derived
        // card background is a gradient between --m-surface-raised and
        // --m-surface — checking both stops covers the whole card).
        expect(contrast(tokens['--m-text'], tokens['--m-bg'], 'text/bg')).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--m-text'], tokens['--m-surface'], 'text/surface')).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--m-text'], tokens['--m-surface-raised'], 'text/surface-raised')).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--m-text-muted'], tokens['--m-surface'], 'muted/surface')).toBeGreaterThanOrEqual(4.5);

        // Button: the engine picks the ink WCAG-safe against the fill's
        // primary stop (readableInk) — hold that guarantee at 4.5, plus keep
        // the bold button label legible on the gradient's end stop (3.0; the
        // brand-fill gradient is the platform's shared button language).
        const stops = tokens['--m-brand-fill'].match(FILL_STOP_PATTERN) || [];
        expect(stops.length, 'brand fill is a two-stop gradient').toBe(2);
        expect(contrast(tokens['--m-button-text'], stops[0], `button/fillStart`)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--m-button-text'], stops[1], `button/fillEnd`)).toBeGreaterThanOrEqual(3.0);

        // Card border: a decorative hairline — require visibility, not a
        // full 3:1 UI-boundary ratio (existing engine design, all themes).
        expect(contrast(tokens['--m-card-border'], tokens['--m-surface'], 'border/surface')).toBeGreaterThanOrEqual(1.3);
      });
    }
  }
});
