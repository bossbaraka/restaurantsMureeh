/**
 * Menu page turn — the CSS and wiring contract.
 *
 * What is pinned here:
 *   1. the CSS is a real 3D page turn (perspective + a spine on the RTL edge),
 *      compositor-only, and fully flattened for reduced-motion guests;
 *   2. the pager under the grid is a real, labelled, thumb-sized control that
 *      names the section it leads to;
 *   3. the guest menu wires the whole thing up, and adds no library to do it.
 *
 * The runtime behaviour of the hook (direction detection, the restart trap,
 * reduced motion, page requests) lives in `menuPageFlipBehaviour.test.tsx`,
 * which needs a DOM.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Root as CssRoot } from 'postcss';
import { MENU_TURN_MS } from '../hooks/useMenuPageFlip';
import { MenuPager } from '../components/customer/MenuPager';

const cssPath = fileURLToPath(new URL('../index.css', import.meta.url));
const cssText = fs.readFileSync(cssPath, 'utf8');
const cssRoot: CssRoot = postcss.parse(cssText, { from: cssPath });
const hookSource = fs.readFileSync(
  fileURLToPath(new URL('../hooks/useMenuPageFlip.ts', import.meta.url)),
  'utf8'
);
const layoutSource = fs.readFileSync(
  fileURLToPath(new URL('../components/customer/CustomerLayout.tsx', import.meta.url)),
  'utf8'
);

/** Every declaration of a selector, including inside @media blocks. */
function declarations(selector: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  cssRoot.walkRules((rule) => {
    if (!rule.selectors?.some((s) => s.trim() === selector)) return;
    rule.walkDecls((decl) => {
      const list = map.get(decl.prop) || [];
      list.push(decl.value);
      map.set(decl.prop, list);
    });
  });
  return map;
}

const valueOf = (selector: string, prop: string): string =>
  (declarations(selector).get(prop) || []).join(' ');

const hasSelector = (selector: string): boolean => declarations(selector).size > 0;

function keyframeProps(name: string): Set<string> {
  const props = new Set<string>();
  cssRoot.walkAtRules('keyframes', (atRule) => {
    if (atRule.params !== name) return;
    atRule.walkDecls((decl) => props.add(decl.prop));
  });
  return props;
}

const keyframeExists = (name: string): boolean => {
  let found = false;
  cssRoot.walkAtRules('keyframes', (atRule) => {
    if (atRule.params === name) found = true;
  });
  return found;
};

// ---------------------------------------------------------------------------
// CSS contract
// ---------------------------------------------------------------------------
describe('page turn — CSS', () => {
  it('builds a real 3D turn around the RTL spine', () => {
    // Perspective on the wrapper, rotation on the sheet, hinge on the right
    // edge — an Arabic booklet is held at its right and pages come from the left.
    expect(valueOf('.menu-page', 'perspective')).toMatch(/\d+px/);
    expect(valueOf('.menu-page__sheet', 'transform-origin')).toBe('100% 50%');
    expect(valueOf('.menu-page__sheet', 'transform')).toContain('rotateY');
  });

  it('keeps the vertical scroll with the browser and takes only horizontal drags', () => {
    // (The reduced-motion block overrides this to `auto` — see below — so the
    // joined value carries both.)
    expect(valueOf('.menu-page', 'touch-action')).toContain('pan-y');
    expect(hookSource).toContain("event.pointerType !== 'touch'");
    // The axis is decided once, so a swipe never steals a scroll.
    expect(hookSource).toContain("g.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'");
  });

  it('animates both directions from one shared pair of keyframes', () => {
    const next = ".menu-page[data-turning='true'][data-flip='next'] .menu-page__sheet";
    const prev = ".menu-page[data-turning='true'][data-flip='prev'] .menu-page__sheet";
    expect(hasSelector(next)).toBe(true);
    expect(hasSelector(prev)).toBe(true);
    expect(valueOf(next, 'animation')).toContain('page-turn-next');
    expect(valueOf(prev, 'animation')).toContain('page-turn-prev');
    expect(keyframeExists('page-turn-next')).toBe(true);
    expect(keyframeExists('page-turn-prev')).toBe(true);

    // The read-only TV board reuses the very same motion.
    expect(hasSelector(".display-menu__page[data-turning='true'][data-flip='next']")).toBe(true);
    expect(valueOf('.display-menu__page', 'transform-origin')).toBe('100% 50%');
    expect(valueOf('.display-menu__board', 'perspective')).toMatch(/\d+px/);
  });

  it('is compositor-only: transform and opacity, never layout', () => {
    for (const name of ['page-turn-next', 'page-turn-prev', 'page-turn-settle']) {
      const props = keyframeProps(name);
      expect(props.size).toBeGreaterThan(0);
      for (const prop of props) {
        expect(['transform', 'opacity']).toContain(prop);
      }
    }
    // And the sheet never transitions a layout property either.
    for (const prop of ['width', 'height', 'top', 'left', 'margin']) {
      expect(valueOf('.menu-page__sheet', 'transition')).not.toContain(prop);
    }
  });

  it('sells the paper: a sheen sweep and a spine shadow, both inert to touch', () => {
    expect(valueOf('.menu-page__sheen', 'pointer-events')).toBe('none');
    expect(valueOf('.menu-page__spine', 'pointer-events')).toBe('none');
    expect(valueOf('.menu-page__sheen', 'background')).toContain('linear-gradient');
    expect(valueOf('.menu-page__spine', 'background')).toContain('linear-gradient');
    expect(hasSelector(".menu-page[data-turning='true'][data-flip='next'] .menu-page__sheen")).toBe(true);
    expect(hasSelector(".menu-page[data-turning='true'] .menu-page__spine")).toBe(true);
  });

  it('settles the dishes onto the page one after another', () => {
    expect(hasSelector(".menu-page[data-turning='true'] .menu-grid > *")).toBe(true);
    expect(valueOf(".menu-page[data-turning='true'] .menu-grid > *", 'animation')).toContain(
      'page-turn-settle'
    );
    // A cascade, not a stampede: the delays grow and stay short.
    const first = valueOf(
      ".menu-page[data-turning='true'] .menu-grid > *:nth-child(1)",
      'animation-delay'
    );
    const last = valueOf(
      ".menu-page[data-turning='true'] .menu-grid > *:nth-child(8)",
      'animation-delay'
    );
    expect(parseFloat(first)).toBeLessThan(parseFloat(last));
    expect(parseFloat(last)).toBeLessThanOrEqual(MENU_TURN_MS);
  });

  it('flattens completely for reduced-motion guests and hides the ornament', () => {
    let sheetDisabled = false;
    let ornamentHidden = false;
    cssRoot.walkAtRules('media', (atRule) => {
      if (!atRule.params.includes('prefers-reduced-motion: reduce')) return;
      atRule.walkRules((rule) => {
        const selectors = rule.selectors.map((s) => s.trim());
        rule.walkDecls('animation', (decl) => {
          if (decl.value.includes('none') && selectors.includes('.menu-page__sheet')) {
            sheetDisabled = true;
          }
        });
        rule.walkDecls('display', (decl) => {
          if (
            decl.value === 'none' &&
            selectors.includes('.menu-page__sheen') &&
            selectors.includes('.menu-page__spine')
          ) {
            ornamentHidden = true;
          }
        });
      });
    });
    expect(sheetDisabled).toBe(true);
    expect(ornamentHidden).toBe(true);
    // The swipe is a motion gesture: it is switched off in JS as well.
    expect(hookSource).toContain('Boolean(swipe) && enabled && !reducedMotion');
  });

  it('publishes one duration, so the JS timer and the CSS cannot drift apart', () => {
    expect(MENU_TURN_MS).toBe(560);
    expect(
      valueOf(".menu-page[data-turning='true'][data-flip='next'] .menu-page__sheet", 'animation')
    ).toContain(`${MENU_TURN_MS}ms`);
    expect(hookSource).toContain(`export const MENU_TURN_MS = ${MENU_TURN_MS}`);
  });

  it('gives the pager thumb-sized targets themed by the tenant', () => {
    expect(parseFloat(valueOf('.menu-pager__btn', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(valueOf('.menu-pager__btn', 'background')).toContain('var(--menu-surface');
    expect(valueOf('.menu-pager__btn:hover:not(:disabled)', 'background-image')).toContain(
      'var(--brand-fill)'
    );
    expect(valueOf('.menu-pager__count', 'color')).toContain('var(--brand-primary-strong)');
  });
});

// ---------------------------------------------------------------------------
// Pager
// ---------------------------------------------------------------------------
const pagerPages = [
  { id: 'all', name: 'كافة الأطباق' },
  { id: 'c1', name: 'المقبلات' },
  { id: 'c2', name: 'المشاوي' },
];

describe('page turn — the pager', () => {
  it('names the section it leads to and shows the position in the booklet', () => {
    const html = renderToStaticMarkup(
      <MenuPager
        pages={pagerPages}
        activeIndex={1}
        canTurnPrev
        canTurnNext
        onTurn={() => {}}
        swipeHint
      />
    );

    expect(html).toContain('menu-pager');
    expect(html).toContain('2 / 3');
    expect(html).toContain('المقبلات');
    // The next page is announced, so a flip is never a surprise.
    expect(html).toContain('الصفحة التالية: المشاوي');
    expect(html).toContain('الصفحة السابقة: كافة الأطباق');
    // Screen-reader guests get the same position as a polite status.
    expect(html).toContain('role="status"');
    expect(html).toContain('صفحة 2 من 3: المقبلات');
    // The swipe is taught on phones, where it is available.
    expect(html).toContain('اسحب أفقياً لتقليب القائمة');
  });

  it('disables the ends instead of wrapping', () => {
    const first = renderToStaticMarkup(
      <MenuPager pages={pagerPages} activeIndex={0} canTurnPrev={false} canTurnNext onTurn={() => {}} />
    );
    const last = renderToStaticMarkup(
      <MenuPager
        pages={pagerPages}
        activeIndex={2}
        canTurnPrev
        canTurnNext={false}
        onTurn={() => {}}
      />
    );

    expect(first).toContain('لا توجد صفحة سابقة');
    expect(first.match(/disabled=""/g)).toHaveLength(1);
    expect(last).toContain('لا توجد صفحة تالية');
    expect(last.match(/disabled=""/g)).toHaveLength(1);
  });

  it('renders nothing for a single-page menu', () => {
    const html = renderToStaticMarkup(
      <MenuPager pages={[pagerPages[0]!]} activeIndex={0} canTurnPrev={false} canTurnNext={false} onTurn={() => {}} />
    );
    expect(html).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
describe('page turn — wiring into the guest menu', () => {
  it('wraps the section head, the grid and the pager in one turning sheet', () => {
    expect(layoutSource).toContain('useMenuPageFlip');
    expect(layoutSource).toContain('className="menu-page"');
    expect(layoutSource).toContain('<div className="menu-page__sheet">');
    expect(layoutSource).toContain('data-flip={flipDirection');
    expect(layoutSource).toContain('<MenuPager');
    // The ornament layers are decoration only.
    expect(layoutSource).toContain('className="menu-page__sheen" aria-hidden="true"');
    expect(layoutSource).toContain('className="menu-page__spine" aria-hidden="true"');
  });

  it('treats "everything" as page one and keeps the kitchen\'s own order', () => {
    expect(layoutSource).toContain("{ id: 'all', name: 'كافة الأطباق' }");
    expect(layoutSource).toContain('...categories.map((category) => ({ id: category.id, name: category.name }))');
    // A search is not a page: the turn is suspended while results are live.
    expect(layoutSource).toContain('enabled: !isSearching');
  });

  it('adds no animation dependency to do it', () => {
    for (const forbidden of ['framer-motion', 'gsap', 'lottie', '@react-spring', 'three']) {
      expect(hookSource).not.toContain(forbidden);
    }
    const pkg = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
    );
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const forbidden of ['framer-motion', 'gsap', 'lottie-web', 'three']) {
      expect(deps[forbidden]).toBeUndefined();
    }
  });
});
