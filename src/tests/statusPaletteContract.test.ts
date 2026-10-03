/**
 * THE ORDER-STATUS PALETTE CONTRACT.
 * ===========================================================================
 *
 * `getOrderStatusConfig()` in src/utils/formatting.ts is the SINGLE owner of
 * the order lifecycle's colours, labels and step order. Three real defects
 * were repaired there, and each is easy to reintroduce because the naive
 * repair ("just write the colour you want") reintroduces it:
 *
 *   1. HARDCODED PALETTE CLASSES. The hero stepper carried its own copy of the
 *      palette (amber/emerald/blue Tailwind classes) and it DRIFTED: PREPARING
 *      was painted amber — PENDING's colour — and SERVED was painted blue —
 *      PREPARING's. The hero and the order tracker told the guest two
 *      different stories about the same order.
 *   2. THEME-BLINDNESS. Those Tailwind-300 classes are dark-surface inks.
 *      amber-300 on the light canvas measures ~1.7:1 — invisible in Light mode.
 *   3. A DARK-ONLY NEUTRAL. SERVED used literal `text-zinc-300`, also a
 *      dark-surface ink (1.47:1 on the light canvas).
 *
 * These tests pin the invariants, not the exact colours, so the palette can
 * still be retuned — it just cannot silently stop being theme-aware or stop
 * being the single source of truth.
 */
import { describe, expect, it } from 'vitest';
import { getOrderStatusConfig } from '../utils/formatting';
import {
  buildSemanticTokens,
  STATUS_BADGE_TINT_ALPHA,
} from '../theme/semanticTokens';
import { normalizeTheme } from '../theme/normalizeTheme';
import { parseColor, contrastRatio, type Rgb } from '../theme/brandTheme';

type Tokens = Record<string, string>;

const theme = (mode: 'light' | 'dark') =>
  normalizeTheme({ id: 'r', name: 'R', theme: { mode, colors: {} } } as never);

const tokensFor = (mode: 'light' | 'dark'): Tokens =>
  buildSemanticTokens(theme(mode), mode) as Tokens;

/**
 * Raw Tailwind palette utilities. Each one encodes a FIXED shade, which is
 * exactly what cannot survive a light/dark switch. `--m-*` tokens are fine
 * because the theme engine resolves them per mode.
 */
const HARDCODED_PALETTE = /\b(?:bg|text|border|from|to|via|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

/** Every lifecycle status the UI can render. */
/** Every member of the OrderStatus union — exhaustive, so a new status must
 *  satisfy this contract before it ships. */
const STATUSES = ['PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'] as const;

describe('getOrderStatusConfig — single source of truth', () => {
  it.each(STATUSES)('%s resolves its colours through --m-* tokens', (status) => {
    const cfg = getOrderStatusConfig(status);

    // The three colour slots must be token-driven. A raw palette class here is
    // defect (1) and (2) coming back: a colour that cannot follow the theme.
    for (const slot of [cfg.badgeBg, cfg.badgeText, cfg.dotColor] as string[]) {
      expect(slot, `${status}: "${slot}"`).not.toMatch(HARDCODED_PALETTE);
    }
  });

  it('orders the lifecycle strictly by step index', () => {
    // The hero stepper reads `stepIndex` to decide which steps are "reached".
    // If these drift out of order the stepper lights up the wrong steps — the
    // ordering IS the contract, not an implementation detail.
    const order = ['PENDING', 'PREPARING', 'READY', 'SERVED'] as const;
    const indices = order.map((s) => getOrderStatusConfig(s).stepIndex);

    expect(indices).toEqual([1, 2, 3, 4]);
  });

  it('parks terminal/cancelled states off the progress scale', () => {
    // 0 == "no progress". Anything else would paint a cancelled order as
    // underway on the hero stepper.
    for (const s of ['CANCELLED'] as const) {
      expect(getOrderStatusConfig(s).stepIndex).toBe(0);
    }
  });

  it('gives every status a customer-facing label', () => {
    for (const status of STATUSES) {
      const cfg = getOrderStatusConfig(status);
      expect(cfg.label, status).toBeTruthy();
      expect(cfg.customerTitle, status).toBeTruthy();
    }
  });
});

describe('--m-*-strong — the surface contrast companion', () => {
  const KEYS = ['success', 'warning', 'error', 'info'] as const;

  /**
   * The backdrop a status ink is ACTUALLY painted on: the status colour at 15%
   * alpha over the canvas. `getOrderStatusConfig` uses that alpha for every
   * badge, so measuring against the bare canvas would under-correct.
   */
  const backdropFor = (base: string, canvas: Rgb, alpha = STATUS_BADGE_TINT_ALPHA): Rgb => ({
    r: base[0] * alpha + canvas.r * (1 - alpha),
    g: base[1] * alpha + canvas.g * (1 - alpha),
    b: base[2] * alpha + canvas.b * (1 - alpha),
  });

  const CANONICAL_BASE: Record<(typeof KEYS)[number], [number, number, number]> = {
    success: [16, 185, 129], // emerald-500
    warning: [245, 158, 11], // amber-500
    error: [239, 68, 68], // red-500
    info: [59, 130, 246], // blue-500
  };

  it.each(KEYS)('%s keeps WCAG AA (4.5:1) on the LIGHT canvas', (key) => {
    const light = tokensFor('light');
    const ink = parseColor(light[`--m-${key}-strong`]);
    expect(ink).not.toBeNull();

    const white: Rgb = { r: 255, g: 255, b: 255 };
    const ratio = contrastRatio(ink!, backdropFor(CANONICAL_BASE[key], white));
    expect(ratio, `${key}-strong ${light[`--m-${key}-strong`]} on light`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(KEYS)('%s keeps WCAG AA (4.5:1) on the DARK canvas', (key) => {
    const dark = tokensFor('dark');
    const ink = parseColor(dark[`--m-${key}-strong`]);
    expect(ink).not.toBeNull();

    const near: Rgb = { r: 10, g: 11, b: 13 }; // --m-bg dark
    const ratio = contrastRatio(ink!, backdropFor(CANONICAL_BASE[key], near));
    expect(ratio, `${key}-strong ${dark[`--m-${key}-strong`]} on dark`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(KEYS)('%s adapts to the mode instead of being one fixed shade', (key) => {
    // The whole point of the fix: the -400 shade reads on dark and fails on
    // light, so the LIGHT value must differ. A single shade for both modes is
    // defect (2) returning.
    const dark = tokensFor('dark')[`--m-${key}-strong`];
    const light = tokensFor('light')[`--m-${key}-strong`];

    expect(dark).not.toBe(light);
  });

  it('emits the channel triples the arbitrary-value utilities consume', () => {
    // `text-[rgb(var(--m-warning-strong-rgb,...))]` needs the -rgb form. If one
    // is emitted without the other the class silently falls back to the
    // hardcoded value in the Tailwind class and the theme stops mattering.
    const light = tokensFor('light');
    for (const key of KEYS) {
      expect(light[`--m-${key}-strong`]).toBeTruthy();
      expect(light[`--m-${key}-strong-rgb`]).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
  });
});
