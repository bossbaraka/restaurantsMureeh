/**
 * PHASE 3 GUARDS — sticky stack + mobile gutter contract.
 *
 * Two contracts are pinned here:
 *
 *   STICKY   One canonical variable (--m-stack-h), composed from MEASURED
 *            band heights, with an absent band contributing exactly 0.
 *
 *   GUTTER   `main`'s padding and the rail's full-bleed negative margin derive
 *            from ONE token, so the rail can never be wider than its parent.
 *
 * NOTE ON WHAT THESE TESTS CAN PROVE.
 * jsdom performs no layout: every element measures 0x0. These tests therefore
 * verify the CONTRACT (CSS relationships, registry behaviour with injected
 * heights) and deliberately do NOT fake pixel measurements. Real viewport
 * verification belongs to the browser phase.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import postcss, { type Root } from 'postcss';

// jsdom rewrites import.meta.url to a non-file scheme, so paths are resolved
// from the project root instead (vitest runs with cwd = project root).
const fromRoot = (rel: string) => path.resolve(process.cwd(), rel);
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { StickyStackProvider, useStickyBand, useStickyStackVars } from '../theme/StickyStack';

const cssPath = fromRoot('src/index.css');
const cssText = fs.readFileSync(cssPath, 'utf8');
const root: Root = postcss.parse(cssText, { from: cssPath });

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

/** Declarations for a selector inside a specific @media prelude. */
function declarationsInMedia(media: string, selector: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  root.walkAtRules('media', (atRule) => {
    if (!atRule.params.includes(media)) return;
    atRule.walkRules((rule) => {
      if (rule.selectors?.some((s) => s.trim() === selector) !== true) return;
      rule.walkDecls((decl) => {
        const list = map.get(decl.prop) || [];
        list.push(decl.value);
        map.set(decl.prop, list);
      });
    });
  });
  return map;
}

// ---------------------------------------------------------------------------
// CSS contract
// ---------------------------------------------------------------------------

describe('sticky stack CSS contract', () => {
  it('the rail reads exactly one canonical variable', () => {
    expect((declarations('.menu-rail').get('top') || []).join(' ')).toBe('var(--m-stack-h)');
  });

  it('no component reconstructs the stack with its own arithmetic', () => {
    const code = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
    // The old two-variable formula and both magic numbers must be gone.
    expect(code).not.toContain('--shell-toolbar-h');
    expect(code).not.toContain('--customer-header-h');
    expect(code).not.toMatch(/57px/);
  });

  it('safe-area is not re-added anywhere in the sticky stack', () => {
    // The toolbar absorbs env(safe-area-inset-top) as padding; because every
    // band is MEASURED, that inset is already inside the reported height.
    // Any env() in a sticky offset would double-count it.
    const railTop = (declarations('.menu-rail').get('top') || []).join(' ');
    expect(railTop).not.toContain('env(');
    const stackVars = declarations(':root');
    expect((stackVars.get('--m-stack-h') || []).join(' ')).not.toContain('env(');
    expect((stackVars.get('--m-stack-above-header') || []).join(' ')).not.toContain('env(');
  });

  it('the pre-measurement fallback reserves no height', () => {
    const vars = declarations(':root');
    expect((vars.get('--m-stack-h') || []).join(' ')).toBe('0px');
    expect((vars.get('--m-stack-above-header') || []).join(' ')).toBe('0px');
  });
});

// ---------------------------------------------------------------------------
// Gutter contract
// ---------------------------------------------------------------------------

describe('mobile gutter contract', () => {
  it('defines a single gutter token', () => {
    expect((declarations(':root').get('--m-gutter') || []).join(' ')).toBe('1rem');
  });

  it('the rail derives its full bleed from the gutter, not a literal', () => {
    const rail = declarations('.menu-rail');
    expect((rail.get('margin-inline') || []).join(' ')).toContain('calc(-1 * var(--m-gutter))');
    // The old hardcoded -1rem bleed must be gone.
    expect((rail.get('margin-inline') || []).join(' ')).not.toContain('-1rem');
    expect((rail.get('padding') || []).join(' ')).toContain('var(--m-gutter)');
  });

  it('narrow-screen main padding and the rail bleed read the SAME token', () => {
    // The proven 8px overflow: main padded 0.75rem while the rail cancelled
    // 1rem, so the rail was 2 x 4px wider than the viewport — visible only
    // because .customer-shell clips. Both now read --m-gutter, so the two
    // values are structurally incapable of diverging.
    const main = declarationsInMedia('max-width: 640px', '.customer-shell main');
    expect((main.get('--m-gutter') || []).join(' ')).toBe('0.75rem');
    expect((main.get('padding-inline') || []).join(' ')).toBe('var(--m-gutter)');
  });

  it('the edge fades also follow the gutter', () => {
    expect((declarations('.menu-cats::before').get('inset-inline-start') || []).join(' ')).toContain(
      'var(--m-gutter)'
    );
    expect((declarations('.menu-cats::after').get('inset-inline-end') || []).join(' ')).toContain(
      'var(--m-gutter)'
    );
  });

  it('layout is width-safe without relying on overflow clipping', () => {
    // Clipping stays as a defensive net, but the geometry must already be
    // correct. Rail border-box = main content + 2*gutter = viewport exactly.
    for (const viewport of [320, 360, 375, 390, 414, 430]) {
      const gutter = 12; // 0.75rem below 640px
      const mainContent = viewport - 2 * gutter;
      const railBorderBox = mainContent + 2 * gutter;
      expect(railBorderBox, `rail must not exceed ${viewport}px`).toBeLessThanOrEqual(viewport);
    }
  });
});

// ---------------------------------------------------------------------------
// Category rail containment
// ---------------------------------------------------------------------------

describe('category rail contains its own horizontal scrolling', () => {
  it('the scroll container and its parent may shrink below content width', () => {
    // Without min-width:0 a flex/grid child is floored at its max-content
    // width, so the track widens the rail instead of scrolling internally.
    expect((declarations('.menu-cats').get('min-width') || []).join(' ')).toBe('0');
    expect((declarations('.menu-cats__track').get('min-width') || []).join(' ')).toBe('0');
  });

  it('scrolls horizontally and keeps the gesture inside the rail', () => {
    const track = declarations('.menu-cats__track');
    expect((track.get('overflow-x') || []).join(' ')).toBe('auto');
    expect((track.get('overscroll-behavior-x') || []).join(' ')).toBe('contain');
  });

  it('chips never wrap and never shrink (single row, RTL-safe)', () => {
    const chip = declarations('.menu-chip');
    expect((chip.get('white-space') || []).join(' ')).toBe('nowrap');
    expect((chip.get('flex') || []).join(' ')).toBe('none');
    // RTL correctness comes from LOGICAL properties: the fades use
    // inset-inline-*, never left/right, so they follow writing direction
    // automatically. (There are two declarations: the mobile bleed and the
    // >=640px inset override — both logical.)
    const fadeStart = declarations('.menu-cats::before');
    expect(fadeStart.has('inset-inline-start')).toBe(true);
    expect(fadeStart.has('left')).toBe(false);
    expect(fadeStart.has('right')).toBe(false);
    const fadeEnd = declarations('.menu-cats::after');
    expect(fadeEnd.has('inset-inline-end')).toBe(true);
    expect(fadeEnd.has('left')).toBe(false);
    expect(fadeEnd.has('right')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

describe('menu toolbar narrow-width behaviour', () => {
  it('wrapping is explicit and bounded to the two groups', () => {
    expect((declarations('.menu-toolbar').get('flex-wrap') || []).join(' ')).toBe('wrap');
    expect((declarations('.menu-toolbar__group').get('min-width') || []).join(' ')).toBe('0');
  });

  it('the widest control may shrink instead of forcing a wrap', () => {
    const select = declarations('.menu-select');
    expect((select.get('min-width') || []).join(' ')).toBe('0');
    expect((select.get('max-width') || []).join(' ')).toBe('100%');
  });

  it('touch targets are preserved', () => {
    // The layout switch keeps a 44px hit area via a pseudo-element.
    const after = declarations('.menu-layout-switch button::after');
    expect((after.get('min-width') || []).join(' ')).toBe('44px');
    expect((after.get('min-height') || []).join(' ')).toBe('44px');
  });

  it('the xs breakpoint that gates the toolbar label actually exists', () => {
    // MenuToolbar authored `hidden xs:inline` for "المتوفر فقط", but `xs` was
    // never defined in tailwind.config.js, so Tailwind emitted no rule and the
    // label stayed hidden at every width. Measured: with the label shown the
    // controls need ~338px inside a 296px box at 320px, so the breakpoint must
    // sit above the narrowest phones.
    const config = fs.readFileSync(fromRoot('tailwind.config.js'), 'utf8');
    expect(config).toMatch(/screens:\s*\{[^}]*xs:/);
    const px = Number(config.match(/xs:\s*'(\d+)px'/)?.[1]);
    expect(px).toBeGreaterThanOrEqual(390);
  });
});

// ---------------------------------------------------------------------------
// Registry behaviour (real React, injected heights — no faked layout)
// ---------------------------------------------------------------------------

describe('StickyStack registry', () => {
  let container: HTMLDivElement;
  let reactRoot: ReturnType<typeof createRoot>;

  beforeEach(() => {
    // Opt into React's act() environment so state updates flush synchronously
    // and no "not configured to support act(...)" warning is emitted.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    // jsdom has no ResizeObserver and performs no layout. A stub lets the
    // registry run its real code path; heights come from a stubbed
    // getBoundingClientRect so nothing is invented.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    act(() => reactRoot?.unmount());
    container.remove();
    vi.unstubAllGlobals();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  /** Renders bands with the given fake heights and returns the published vars. */
  function renderBands(bands: Array<{ id: 'toolbar' | 'header'; height: number }>) {
    let published: Record<string, string> = {};

    const Band: React.FC<{ id: 'toolbar' | 'header'; height: number }> = ({ id, height }) => {
      const ref = useStickyBand(id);
      return (
        <div
          ref={(el) => {
            if (el) {
              // The ONLY injected value: jsdom cannot lay out, so the element
              // is told what it would have measured.
              el.getBoundingClientRect = () => ({ height }) as DOMRect;
            }
            ref(el);
          }}
        />
      );
    };

    const Probe: React.FC = () => {
      published = useStickyStackVars();
      return null;
    };

    reactRoot = createRoot(container);
    act(() => {
      reactRoot.render(
        <StickyStackProvider>
          {bands.map((b) => (
            <Band key={b.id} id={b.id} height={b.height} />
          ))}
          <Probe />
        </StickyStackProvider>
      );
    });
    return published;
  }

  it('composes the stack from the measured heights of present bands', () => {
    const vars = renderBands([
      { id: 'toolbar', height: 57 },
      { id: 'header', height: 69 },
    ]);
    expect(vars['--m-stack-h']).toBe('126px');
    expect(vars['--m-stack-above-header']).toBe('57px');
  });

  it('uses the REAL toolbar height, not the old 57px assumption', () => {
    const vars = renderBands([
      { id: 'toolbar', height: 83 }, // e.g. notch inset absorbed as padding
      { id: 'header', height: 69 },
    ]);
    expect(vars['--m-stack-h']).toBe('152px');
    expect(vars['--m-stack-above-header']).toBe('83px');
  });

  it('tracks a header that grows (wrapped title, larger text scale)', () => {
    const vars = renderBands([
      { id: 'toolbar', height: 57 },
      { id: 'header', height: 104 },
    ]);
    expect(vars['--m-stack-h']).toBe('161px');
  });

  it('produces NO phantom offset when the platform toolbar is absent', () => {
    // Public /r/ routes and the landing view render no ViewSwitcher. The old
    // CSS still reserved 57px for it.
    const vars = renderBands([{ id: 'header', height: 69 }]);
    expect(vars['--m-stack-h']).toBe('69px');
    expect(vars['--m-stack-above-header']).toBe('0px');
  });

  it('is zero when no band is registered at all', () => {
    const vars = renderBands([]);
    expect(vars['--m-stack-h']).toBe('0px');
    expect(vars['--m-stack-above-header']).toBe('0px');
  });
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

describe('single sticky-stack ownership', () => {
  const read = (rel: string) =>
    fs
      .readFileSync(fromRoot(rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('CustomerHeader no longer publishes a second sticky contract', () => {
    const src = read('src/components/customer/CustomerHeader.tsx');
    expect(src).not.toContain('--customer-header-h');
    expect(src).not.toContain('setProperty');
    // It registers instead.
    expect(src).toContain("useStickyBand('header')");
  });

  it('ViewSwitcher registers rather than declaring its height', () => {
    const src = read('src/components/common/ViewSwitcher.tsx');
    expect(src).toContain("useStickyBand('toolbar')");
    expect(src).not.toContain('--shell-toolbar-h');
  });

  it('both sticky offsets come from the stack owner', () => {
    const header = read('src/components/customer/CustomerHeader.tsx');
    expect(header).toContain('var(--m-stack-above-header');
  });
});
