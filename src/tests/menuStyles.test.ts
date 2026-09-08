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

  it('builds the rail surface from opaque brand tokens', () => {
    const rootVars = declarations(':root');
    const surface = (rootVars.get('--menu-surface') || []).join(' ');
    expect(surface).toContain('color-mix');
    expect(surface).not.toContain('transparent');
    expect((rootVars.get('--brand-soft') || []).join(' ')).not.toContain('/');
  });
});
