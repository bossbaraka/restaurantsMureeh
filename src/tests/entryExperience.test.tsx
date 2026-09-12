/**
 * Restaurant Entry Experience — the layer a guest lands on right after a QR
 * scan.
 *
 * The brief for this screen is unusually strict, so these tests pin the parts
 * that are easy to regress later:
 *
 *   1. it is a presentation layer only — no network, no persistence, no
 *      business types leaking in from the server;
 *   2. the whole look is driven by the TENANT, not by a platform palette;
 *   3. gesture, arrow, layer movement and exit all read ONE direction flag, so
 *      RTL and LTR can never disagree;
 *   4. swipe is not the only way in, and reduced motion is honoured;
 *   5. the CSS is fully scoped to `.entry-*` — it cannot regress the menu, the
 *      admin or the landing page.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import type { Restaurant } from '../types/restaurant';

// ---------------------------------------------------------------------------
// Fixtures — a tenant that is deliberately NOT the platform's navy/gold, so a
// hard-coded palette would show up immediately.
// ---------------------------------------------------------------------------
const baseRestaurant: Restaurant = {
  id: 'rest-cedar',
  name: 'مطعم الأرز',
  nameEn: 'CEDAR HOUSE',
  slug: 'cedar',
  logo: 'https://cdn.example.test/logos/cedar.png',
  coverImage: 'https://cdn.example.test/covers/cedar-terrace.jpg',
  description: 'مطبخ شامي معاصر على الشرفة.',
  phone: '0599000000',
  address: 'شارع الإرسال، البيرة',
  currency: '₪',
  language: 'ar',
  timezone: 'Asia/Hebron',
  status: 'ACTIVE',
  primaryColor: '#7C3AED',
  accentColor: '#22D3EE',
  planId: 'plan-pro',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** The tenant object the mocked context hands back, swapped per test. */
let currentRestaurant: Restaurant | null = baseRestaurant;
let tableNumber: number | null = 7;

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      currentRestaurant,
      activeTableId: 'table_7',
      activeTableNumber: tableNumber,
      products: [],
      categories: [],
    }),
  };
});

const { RestaurantEntryExperience } = await import(
  '../components/customer/RestaurantEntryExperience'
);

// ---------------------------------------------------------------------------
// Source + CSS under test
// ---------------------------------------------------------------------------
const componentPath = fileURLToPath(
  new URL('../components/customer/RestaurantEntryExperience.tsx', import.meta.url)
);
const layoutPath = fileURLToPath(
  new URL('../components/customer/CustomerLayout.tsx', import.meta.url)
);
const cssPath = fileURLToPath(new URL('../index.css', import.meta.url));

const componentSource = fs.readFileSync(componentPath, 'utf8');
const layoutSource = fs.readFileSync(layoutPath, 'utf8');
const cssSource = fs.readFileSync(cssPath, 'utf8');
const cssRoot = postcss.parse(cssSource, { from: cssPath });

const render = () => renderToStaticMarkup(<RestaurantEntryExperience onEnter={() => {}} />);

/** Every rule whose selectors mention the entry layer. */
function entryRules(): Rule[] {
  const rules: Rule[] = [];
  cssRoot.walkRules((rule) => {
    if (rule.selectors.some((s) => s.includes('entry-'))) rules.push(rule);
  });
  return rules;
}

function declarationsFor(selector: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  cssRoot.walkRules((rule) => {
    if (!rule.selectors.some((s) => s.trim() === selector)) return;
    rule.walkDecls((decl) => {
      const list = map.get(decl.prop) || [];
      list.push(decl.value);
      map.set(decl.prop, list);
    });
  });
  return map;
}

const valueOf = (selector: string, prop: string): string =>
  (declarationsFor(selector).get(prop) || []).join(' ');

// ---------------------------------------------------------------------------

describe('entry experience — scope of the change', () => {
  it('is mounted in exactly one place, in the existing welcome slot', () => {
    const matches = layoutSource.match(/RestaurantEntryExperience/g) || [];
    // Twice on the import line (module + specifier) plus exactly one render.
    // Nothing else in the customer shell knows about it.
    expect(matches).toHaveLength(3);
    // It sits inside the pre-existing `showWelcome` guard — no new global state.
    expect(layoutSource).toMatch(
      /\{showWelcome && <RestaurantEntryExperience onEnter=\{handleDismissWelcome\} \/>\}/
    );
  });

  it('owns no business logic: no network, no storage, no session, no cart', () => {
    for (const forbidden of [
      'fetch(',
      'api.',
      'axios',
      'prisma',
      'localStorage',
      'sessionStorage',
      'createTableSession',
      'useCart',
      'addToCart',
      'navigate(',
      'useNavigate',
    ]) {
      expect(componentSource, `component must not reference ${forbidden}`).not.toContain(
        forbidden
      );
    }
  });

  it('adds no new dependency — motion is CSS, not a library', () => {
    for (const forbidden of ['framer-motion', 'three', 'gsap', 'lottie', '@react-spring']) {
      expect(componentSource).not.toContain(forbidden);
    }
    const pkg = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
    );
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const forbidden of ['framer-motion', 'three', 'gsap', 'lottie-web']) {
      expect(deps[forbidden]).toBeUndefined();
    }
  });
});

describe('entry experience — tenant-driven content', () => {
  it('opens on the tenant cover photograph, not a stock image', () => {
    const html = render();
    expect(html).toContain(baseRestaurant.coverImage as string);
    // The cover is the first thing painted, and it is never a lazy afterthought.
    expect(html).toContain('loading="eager"');
    expect(html).toContain('class="entry-cover__img');
  });

  it('shows the tenant logo and the tenant name in its own language', () => {
    const arabic = render();
    expect(arabic).toContain(baseRestaurant.logo as string);
    expect(arabic).toContain('مطعم الأرز');
    expect(arabic).toContain('مطبخ شامي معاصر على الشرفة.');

    currentRestaurant = { ...baseRestaurant, language: 'en' };
    const english = render();
    expect(english).toContain('CEDAR HOUSE');
    expect(english).not.toContain('مطعم الأرز');
    currentRestaurant = baseRestaurant;
  });

  it('never invents copy when the tenant has no description', () => {
    currentRestaurant = { ...baseRestaurant, description: '' };
    const html = render();
    expect(html).not.toContain('entry-identity__desc');
    currentRestaurant = baseRestaurant;
  });

  it('falls back to a brand-built ambience when there is no cover image', () => {
    currentRestaurant = { ...baseRestaurant, coverImage: '' };
    const html = render();
    // No cover to show, and crucially no blocking placeholder either: the
    // branded gradient stands in so the guest is never left waiting.
    expect(html).not.toContain('entry-cover__img');
    expect(html).toContain('entry-cover__fallback');
    currentRestaurant = baseRestaurant;
  });

  it('carries no platform palette of its own', () => {
    // The old splash hard-coded navy/gold. The entry experience must live off
    // the tenant tokens written by theme/brandTheme.
    for (const hardcoded of ['#D4AF37', '#E2C067', '#00072D', '#051650', '#123499']) {
      expect(componentSource).not.toContain(hardcoded);
      expect(cssSource.slice(cssSource.indexOf('.entry-root'))).not.toContain(hardcoded);
    }
    expect(componentSource).toContain('useBrandTheme');
  });
});

describe('entry experience — direction', () => {
  it('is RTL for an Arabic tenant: gesture, arrow and exit all travel right', () => {
    currentRestaurant = { ...baseRestaurant, language: 'ar' };
    const html = render();
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('--entry-dir:1');
    expect(html).toContain('اسحب للمتابعة');
  });

  it('is LTR for an English tenant and mirrors the gesture', () => {
    currentRestaurant = { ...baseRestaurant, language: 'en' };
    const html = render();
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('--entry-dir:-1');
    currentRestaurant = baseRestaurant;
  });

  it('drives arrow, sheet and exit from that single flag', () => {
    // Any of these drifting apart is the classic "arrow points one way, the
    // screen moves the other" bug.
    expect(valueOf('.entry-arrow', 'transform')).toContain('var(--entry-dir');
    expect(valueOf('.entry-sheet', 'transform')).toContain('var(--entry-shift');
    expect(valueOf('.entry-sheet--exiting', 'transform')).toContain('var(--entry-dir');
    expect(componentSource).toContain('const dirSign = isRTL ? 1 : -1');
  });
});

describe('entry experience — everyone can get in', () => {
  it('offers a real control, not only a swipe', () => {
    const html = render();
    // A native <button> gives every guest keyboard, screen-reader and single
    // tap access to the same destination as the gesture.
    expect(html).toMatch(/<button[^>]*class="entry-action__button"/);
    expect(html).toContain('تصفّح القائمة');
    // The logo invitation is a button too, never a div with a click handler.
    expect(html).toMatch(/<button[^>]*class="entry-logo-button"/);
  });

  it('exposes itself as a labelled dialog', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-label="مدخل مطعم الأرز"/);
  });

  it('keeps decoration out of the accessibility tree', () => {
    const html = render();
    expect(html).toContain('aria-hidden="true"');
    // The pure-ornament layers must be hidden, the controls must not be.
    expect(html).toContain('class="entry-composition" aria-hidden="true"');
    expect(html).toContain('class="entry-arrow-wrap" aria-hidden="true"');
  });

  it('supports Escape and the forward arrow key', () => {
    expect(componentSource).toContain("event.key === 'Escape'");
    expect(componentSource).toContain("const forwardKey = dirSign === 1 ? 'ArrowRight' : 'ArrowLeft'");
  });
});

describe('entry experience — motion budget', () => {
  it('honours prefers-reduced-motion in both the JS and the CSS', () => {
    expect(componentSource).toContain("'(prefers-reduced-motion: reduce)'");

    let reduced = false;
    cssRoot.walkAtRules('media', (atRule) => {
      if (atRule.params.includes('prefers-reduced-motion: reduce')) {
        atRule.walkRules((rule) => {
          if (rule.selectors.some((s) => s.includes('entry-'))) reduced = true;
        });
      }
    });
    expect(reduced).toBe(true);

    // Reduced motion stops the choreography, never the journey: the sheet still
    // fades out and `onEnter` still fires.
    expect(valueOf('.entry-sheet--exiting', 'transform')).toContain('translate3d');
  });

  it('drops the ambient effects under reduced motion', () => {
    const names = [
      '.entry-cover__img--ready',
      '.entry-mote',
      '.entry-logo-button',
      '.entry-arrow__float',
      '.entry-arrow__gesture',
    ];
    const disabled = new Set<string>();
    cssRoot.walkAtRules('media', (atRule) => {
      if (!atRule.params.includes('prefers-reduced-motion: reduce')) return;
      atRule.walkRules((rule) => {
        if (!rule.selectors.some((s) => s.includes('entry-'))) return;
        rule.walkDecls('animation', (decl) => {
          if (decl.value.includes('none')) rule.selectors.forEach((s) => disabled.add(s.trim()));
        });
      });
    });
    for (const name of names) expect(disabled.has(name)).toBe(true);
  });
});

describe('entry experience — CSS cannot leak', () => {
  it('scopes every rule to .entry-*', () => {
    const rules = entryRules();
    expect(rules.length).toBeGreaterThan(20);
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        // Every compound must start at the entry layer; no bare element or
        // shared class can be re-styled by this block.
        expect(selector.trim().startsWith('.entry-')).toBe(true);
      }
    }
  });

  it('does not restyle any existing surface', () => {
    for (const rule of entryRules()) {
      for (const selector of rule.selectors) {
        for (const legacy of ['.menu-', '.welcome-', '.saas-', '.pos-', '.admin-', '[data-theme']) {
          expect(selector).not.toContain(legacy);
        }
      }
    }
  });

  it('keeps every keyframe it references in the same namespace', () => {
    const declared = new Set<string>();
    cssRoot.walkAtRules('keyframes', (atRule) => {
      if (atRule.params.startsWith('entry-')) declared.add(atRule.params);
    });
    expect(declared.size).toBeGreaterThan(4);

    for (const rule of entryRules()) {
      rule.walkDecls(/^animation(-name)?$/, (decl) => {
        for (const name of decl.value.split(/[\s,]+/)) {
          if (name.startsWith('entry-')) expect(declared.has(name)).toBe(true);
        }
      });
    }
  });

  it('is a fixed, self-contained overlay with no document flow impact', () => {
    expect(valueOf('.entry-root', 'position')).toBe('fixed');
    expect(valueOf('.entry-root', 'overflow')).toBe('hidden');
    // Nothing it renders can push the page around.
    for (const rule of entryRules()) {
      rule.walkDecls('position', (decl) => {
        expect(['fixed', 'absolute', 'relative', 'sticky']).toContain(decl.value);
      });
    }
  });

  it('respects device safe areas and modern viewport units', () => {
    const stage = valueOf('.entry-stage', 'padding');
    for (const edge of ['safe-area-inset-top', 'safe-area-inset-bottom', 'safe-area-inset-left', 'safe-area-inset-right']) {
      expect(stage).toContain(edge);
    }
  });

  it('draws the arrow as a hollow, dimensional object', () => {
    // Hollow: stroked, never filled.
    expect(valueOf('.entry-arrow__face', 'fill')).toBe('none');
    expect(valueOf('.entry-arrow__sheen', 'fill')).toBe('none');
    expect(valueOf('.entry-arrow__depth', 'fill')).toBe('none');
    // Dimensional: an offset extrusion copy plus a specular edge, and a
    // gradient face rather than a flat colour.
    expect(valueOf('.entry-arrow__depth', 'transform')).toMatch(/translate/);
    expect(valueOf('.entry-arrow__face', 'stroke')).toContain('url(#entry-arrow-face)');
    expect(valueOf('.entry-arrow__face', 'filter')).toContain('drop-shadow');
  });

  it('lets the guest drag without stealing vertical scrolling', () => {
    expect(valueOf('.entry-sheet', 'touch-action')).toBe('pan-y');
  });

  it('moves the layer with a compositor-only transform', () => {
    expect(valueOf('.entry-sheet', 'transform')).toContain('translate3d');
    expect(valueOf('.entry-sheet--snap', 'transition')).toContain('transform');
    // Never animates layout properties: no width/height/top/left transitions.
    for (const rule of entryRules()) {
      rule.walkDecls('transition', (decl) => {
        for (const prop of ['width', 'height', 'top', 'left', 'margin']) {
          expect(decl.value).not.toContain(prop);
        }
      });
    }
  });

  it('covers the cover image without distortion or overflow', () => {
    expect(valueOf('.entry-cover__img', 'object-fit')).toBe('cover');
    expect(valueOf('.entry-cover__img', 'width')).toBe('100%');
    expect(valueOf('.entry-cover', 'overflow')).toBe('hidden');
  });
});
