import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Root } from 'postcss';

const cssPath = fileURLToPath(new URL('../index.css', import.meta.url));
const root: Root = postcss.parse(fs.readFileSync(cssPath, 'utf8'), { from: cssPath });

/** Every declaration for a selector, including ones nested in @media blocks. */
function declarations(selector: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  root.walkRules((rule) => {
    if (rule.selectors?.some((s) => s.trim() === selector) !== true) return;
    rule.walkDecls((decl) => {
      const list = map.get(decl.prop) || [];
      list.push(decl.value);
      map.set(decl.prop, list);
    });
  });
  return map;
}

function has(selector: string, prop: string): boolean {
  return declarations(selector).has(prop);
}

function value(selector: string, prop: string): string {
  return (declarations(selector).get(prop) || []).join(' ');
}

describe('menu grid layout cannot overlap itself', () => {
  it('never reserves a guessed height for offscreen cards', () => {
    // content-visibility + contain-intrinsic-size under-reserved ~128px per
    // card while the real card is taller, so rows collapsed and neighbouring
    // cards painted over each other while scrolling.
    expect(has('.menu-card', 'content-visibility')).toBe(false);
    expect(has('.menu-card', 'contain-intrinsic-size')).toBe(false);
  });

  it('lays cards out as a spaced grid', () => {
    expect(value('.menu-card', 'display')).toContain('grid');
    expect(value('.menu-grid', 'display')).toContain('grid');
    expect(value('.menu-grid', 'gap')).toMatch(/\d/);
    expect(value('.menu-card', 'position')).toContain('relative');
  });

  it('lets the card body own the row height instead of the image ratio', () => {
    // aspect-ratio on a stretched grid item fights the row height computed
    // from the text column; the image now fills an absolutely sized box.
    expect(has('.menu-media', 'aspect-ratio')).toBe(false);
    expect(has('.menu-card--featured .menu-media', 'aspect-ratio')).toBe(false);
    expect(has('.menu-media', 'min-height')).toBe(true);
    expect(value('.menu-img', 'position')).toContain('absolute');
    expect(value('.menu-img', 'inset')).toBe('0');
    expect(value('.menu-media', 'position')).toContain('relative');
  });

  it('keeps the sticky rail opaque so cards never show through it', () => {
    const decls = declarations('.menu-rail');
    expect(decls.get('background-color')?.[0]).toBeTruthy();
    expect(has('.menu-rail', 'backdrop-filter')).toBe(false);
    for (const [prop, values] of decls) {
      for (const v of values) {
        expect(v, `${prop} must not fade to transparent`).not.toContain('transparent');
      }
    }
  });

  it('clips horizontal overflow without creating a sticky-breaking scroll container', () => {
    const overflowX = declarations('.customer-shell').get('overflow-x') || [];
    expect(overflowX).toContain('clip');
    expect(overflowX).not.toContain('hidden');
    expect(value('.menu-rail', 'position')).toContain('sticky');
  });

  it('sticks the rail to ONE canonical measured stack variable', () => {
    // Phase 3: the offset was `calc(var(--shell-toolbar-h, 57px) +
    // var(--customer-header-h, 69px))` — a formula assembled from two
    // independently owned numbers, one of them a hardcoded guess about
    // ViewSwitcher's height, and it reserved that height even when the
    // toolbar was not rendered. It is now a single variable composed by
    // StickyStack from MEASURED heights of the bands actually present.
    const top = value('.menu-rail', 'top');
    expect(top).toBe('var(--m-stack-h)');
    expect(top).not.toContain('calc(');
    expect(top).not.toMatch(/\d+px/);
  });

  it('contains no hardcoded sticky offsets anywhere in the stack', () => {
    const css = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // The three magic numbers this phase removes.
    expect(css).not.toContain('--shell-toolbar-h');
    expect(css).not.toContain('--customer-header-h');
    expect(css).not.toMatch(/top:\s*calc\([^)]*57px/);
    expect(css).not.toMatch(/top:\s*118px/);
  });

  it('defaults the stack to zero so an absent band adds no phantom offset', () => {
    // ViewSwitcher is conditionally rendered (hidden on the SaaS landing
    // view and absent in embedded/public contexts). The pre-measurement
    // fallback must therefore be 0, never a reserved toolbar height.
    const rootVars = declarations(':root');
    expect((rootVars.get('--m-stack-h') || []).join(' ')).toBe('0px');
    expect((rootVars.get('--m-stack-above-header') || []).join(' ')).toBe('0px');
  });

  it('declares a resolved light appearance keyed on data-theme (never "auto")', () => {
    const lightBlock = root.nodes.find(
      (node) =>
        node.type === 'rule' &&
        (node as { selectors?: string[] }).selectors?.some((s) => s.trim() === ":root[data-theme='light']")
    );
    expect(lightBlock).toBeTruthy();
    const vars = declarations(":root[data-theme='light']");
    expect((vars.get('--menu-surface') || []).join(' ')).toContain('color-mix');
    expect((vars.get('--menu-text-base') || []).join(' ')).toBeTruthy();
  });

  it('renders the theme background through ONE token-consuming layer', () => {
    // One writer (backgroundToCssVars) → one reader (.customer-bg-layer).
    // The previous inline React duplicate of the same background math drifted
    // from the engine and ignored prefers-color-scheme changes.
    const layer = declarations('.customer-bg-layer');
    expect((layer.get('background') || []).join(' ')).toContain('var(--bg-current');
    expect((layer.get('opacity') || []).join(' ')).toContain('var(--bg-layer-opacity');
    expect(declarations('.customer-bg-layer::after').get('background')?.join(' ')).toContain('var(--bg-scrim');
  });

  it('builds the rail surface from opaque brand tokens', () => {
    const rootVars = declarations(':root');
    const surface = (rootVars.get('--menu-surface') || []).join(' ');
    expect(surface).toContain('color-mix');
    expect(surface).not.toContain('transparent');
    expect((rootVars.get('--brand-soft') || []).join(' ')).not.toContain('/');
  });
});

describe('product card click model — one card-wide target, never a dead zone', () => {
  /** Resolved z-index of a selector (absent = 0, i.e. the auto/static layer). */
  const zIndexOf = (selector: string): number => {
    const raw = value(selector, 'z-index').trim().split(/\s+/).filter(Boolean).pop() || '';
    return raw === '' ? 0 : Number(raw);
  };

  it('keeps the card-wide hit area above every decorative layer', () => {
    const hit = zIndexOf('.menu-card__hit');
    expect(hit).toBeGreaterThan(0);
    // The badge overlay shipped with `z-index: 2` — above the hit — so a tap on
    // «طبق الشيف» / «حساسية» / «غير متوفر» hit an element with no handler and
    // the card did nothing at all. Nothing decorative may outrank the hit.
    const decorative = [
      '.menu-media',
      '.menu-media__scrim',
      '.menu-media__badges',
      '.menu-badge',
      '.menu-img',
      '.menu-img__skeleton',
      '.menu-img__fallback',
      '.menu-card__body',
      '.menu-card__title',
      '.menu-card__title-en',
      '.menu-card__desc',
      '.menu-card__meta',
      '.menu-meta',
      '.menu-card__footer',
      '.menu-price',
    ];
    for (const selector of decorative) {
      expect(zIndexOf(selector), `${selector} must not sit above .menu-card__hit`).toBeLessThanOrEqual(hit);
    }
  });

  it('keeps the badges visible without lifting them above the hit area', () => {
    // The scrim (a gradient only) must not swallow pointer events…
    expect(value('.menu-media__scrim', 'pointer-events')).toContain('none');
    // …and the badges are emitted AFTER it, so plain DOM order already paints
    // them on top of the scrim — no z-index is required for the visual layer.
    expect(has('.menu-media__badges', 'z-index')).toBe(false);
    expect(zIndexOf('.menu-media__badges')).toBe(0);
  });

  it('keeps the action controls above the hit area', () => {
    const hit = zIndexOf('.menu-card__hit');
    expect(zIndexOf('.menu-actions')).toBeGreaterThan(hit);
  });
});

describe('customer menu consumes the Effective Theme tokens', () => {
  // Phase 4 — Theme Property → CSS Token → UI Consumer. Each assertion pins
  // one consumer to the token that must drive it (with a visual fallback).
  it('cards consume the card radius/shadow tokens', () => {
    expect(value('.menu-card', 'border-radius')).toContain('var(--m-card-radius');
    const shadow = value('.menu-card', 'box-shadow');
    expect(shadow).toContain('var(--m-card-shadow');
    // The inset material highlight stays a fixed part of the card.
    expect(shadow).toContain('inset');
  });

  it('buttons and inputs consume the radius scale', () => {
    expect(value('.menu-add', 'border-radius')).toContain('var(--m-radius-md');
    expect(value('.menu-select', 'border-radius')).toContain('var(--m-radius-md');
    expect(value('.menu-toggle', 'border-radius')).toContain('var(--m-radius-md');
  });

  it('badges consume the badge radius token', () => {
    expect(value('.menu-badge', 'border-radius')).toContain('var(--m-badge-radius');
  });

  it('text roles consume the theme text colours and font weights', () => {
    expect(value('.menu-card__title', 'color')).toContain('var(--theme-text-primary');
    expect(value('.menu-card__title', 'font-weight')).toContain('var(--m-font-heading-weight');
    expect(value('.menu-card__desc', 'color')).toContain('var(--theme-text-secondary');
    expect(value('.menu-card__desc', 'font-weight')).toContain('var(--m-font-body-weight');
    expect(value('.menu-section-head__title', 'color')).toContain('var(--theme-text-primary');
  });

  it('status colours consume success/warning/error/border tokens', () => {
    expect(value('.menu-badge--danger', 'background')).toContain('var(--m-error');
    expect(value('.menu-badge--dark', 'border')).toContain('var(--theme-border');
  });
});
