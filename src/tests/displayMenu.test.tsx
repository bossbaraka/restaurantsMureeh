import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Root } from 'postcss';
import type { Category, Product, Restaurant } from '../types/restaurant';

// The display board reads the catalog straight from the restaurant context.
const restaurant: Restaurant = {
  id: 'rest-diwan',
  name: 'مطعم الديوان',
  nameEn: 'Diwan Restaurant',
  slug: 'diwan',
  logo: '',
  description: 'مطبخ شامي أصيل',
  phone: '0593000000',
  address: 'رام الله',
  currency: '₪',
  language: 'ar',
  timezone: 'Asia/Hebron',
  status: 'ACTIVE',
  primaryColor: '#D4AF37',
  accentColor: '#C5A880',
  planId: 'plan-pro',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const categories: Category[] = [
  { id: 'c1', restaurantId: 'rest-diwan', name: 'المقبلات', nameEn: 'Starters', sortOrder: 1 },
  { id: 'c2', restaurantId: 'rest-diwan', name: 'الأطباق الرئيسية', nameEn: 'Mains', sortOrder: 2 },
  { id: 'c3', restaurantId: 'rest-diwan', name: 'قسم مغلق', nameEn: 'Closed', sortOrder: 3 },
];

const products: Product[] = [
  {
    id: 'p1',
    restaurantId: 'rest-diwan',
    categoryId: 'c1',
    name: 'حمص بالصنوبر',
    nameEn: 'Hummus',
    description: 'حمص بلدي مع زيت زيتون وصنوبر محمص.',
    price: 24,
    image: '',
    isAvailable: true,
    preparationTimeMinutes: 8,
    calories: 320,
  },
  {
    id: 'p2',
    restaurantId: 'rest-diwan',
    categoryId: 'c2',
    name: 'منسف الديوان',
    nameEn: 'Diwan Mansaf',
    description: 'لحم ضأن مع لبن الجميد والأرز البسمتي.',
    price: 89,
    image: 'https://example.test/mansaf.jpg',
    isAvailable: true,
    isFeatured: true,
    badge: 'الأشهر',
    preparationTimeMinutes: 35,
  },
  {
    id: 'p3',
    restaurantId: 'rest-diwan',
    categoryId: 'c2',
    name: 'طبق نفذ من المطبخ',
    nameEn: 'Sold Out',
    description: 'غير متاح اليوم.',
    price: 55,
    image: '',
    isAvailable: false,
  },
];

// Partial mock: the board reads its catalog from the context, but the real
// `isDisplayModeUrl` must stay available so the URL gate is tested for real.
vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      products,
      categories,
      currentRestaurant: restaurant,
    }),
  };
});

// Imported after the mock is registered.
const { DisplayMenu } = await import('../components/customer/DisplayMenu');
const { isDisplayModeUrl } = await import('../context/RestaurantContext');
const { buildLiveScenes, buildLiveSections, resolveLiveProfile } = await import(
  '../components/display/liveMenuModel'
);
const { LiveBoardScene } = await import('../components/display/LiveScenes');

const render = (ui: React.ReactElement) => renderToStaticMarkup(ui);

const cssPath = fileURLToPath(new URL('../index.css', import.meta.url));
const cssRoot: Root = postcss.parse(fs.readFileSync(cssPath, 'utf8'), { from: cssPath });
const cssText = fs.readFileSync(cssPath, 'utf8');

function selectorExists(selector: string): boolean {
  let found = false;
  cssRoot.walkRules((rule) => {
    if (rule.selectors?.some((s) => s.trim() === selector)) found = true;
  });
  return found;
}

/** The board page of a given section, exactly as the screen plays it. */
function renderBoard(sectionIndex: number): string {
  const sections = buildLiveSections(categories, products);
  const profile = resolveLiveProfile(restaurant, sections);
  const scenes = buildLiveScenes(sections, { profile });
  const board = scenes.find(
    (scene) => scene.kind === 'board' && scene.sectionIndex === sectionIndex
  );
  if (!board || board.kind !== 'board') throw new Error('no board scene');
  return render(
    <LiveBoardScene
      scene={board}
      chrome={{ restaurantName: restaurant.name, restaurantNameEn: restaurant.nameEn, currency: '₪' }}
      leaders={profile.layout === 'type-led'}
    />
  );
}

describe('DisplayMenu (read-only signage)', () => {
  it('opens on the tenant identity and keeps it on screen at all times', () => {
    const html = render(<DisplayMenu />);

    expect(html).toContain('display-menu');
    expect(html).toContain('مطعم الديوان');
    expect(html).toContain('Diwan Restaurant');
    // The first frame is the brand bumper; the menu starts right after it.
    expect(html).toContain('display-menu__scene--intro');
    // The board is branded with the platform so a filmed clip credits it.
    expect(html).toContain('منصة مريح MUREEH');
  });

  it('paints the screen from the tenant brand, not a fixed template', () => {
    const html = render(<DisplayMenu />);

    // The visual profile is written as custom properties on the root, derived
    // from the venue's own colours — a different venue gets different values.
    expect(html).toContain('--lm-brand:');
    expect(html).toContain('--lm-title-face:');
    expect(html).toContain('--lm-ken-burns:');
    // ...and the CSS keeps brand-token fallbacks for the pre-profile paint.
    expect(cssText).toContain('--lm-brand: var(--brand-primary-strong');
  });

  it('offers no way to order: no cart, no add button, no quantity stepper', () => {
    const html = render(<DisplayMenu />);

    for (const forbidden of ['إضافة', 'السلة', 'اطلب الآن', 'menu-card', 'menu-qty', 'cart']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('hides the reservation CTA when the venue published no WhatsApp number', () => {
    const html = render(<DisplayMenu />);

    expect(html).not.toContain('احجز طاولتك');
    expect(html).not.toContain('display-menu__cta');
  });

  it('never advertises a dish the kitchen marked unavailable', () => {
    expect(render(<DisplayMenu />)).not.toContain('طبق نفذ من المطبخ');
    expect(renderBoard(1)).not.toContain('طبق نفذ من المطبخ');
  });

  it('skips categories left with nothing to show', () => {
    const html = render(<DisplayMenu />);

    // "قسم مغلق" has no products at all, so it must not appear as a section.
    expect(html).not.toContain('قسم مغلق');
    // Two sections are on the loop, and the rail says so from frame one.
    expect(html).toContain('1 / 2');
  });

  it('renders a priced board with the dish, its note and a tabular price', () => {
    const html = renderBoard(0);

    expect(html).toContain('المقبلات');
    expect(html).toContain('حمص بالصنوبر');
    expect(html).toContain('display-menu__price');
    expect(html).toContain('₪24');
    // A filmed board tells the guest how to order without offering to take it.
    expect(html).toContain('للطلب يرجى التوجه إلى الكاشير');
  });

  it('keeps every dish reachable by paginating long categories', () => {
    const sections = buildLiveSections(categories, products);
    const profile = resolveLiveProfile(restaurant, sections);
    const scenes = buildLiveScenes(sections, { profile });
    const boards = scenes.filter((scene) => scene.kind === 'board');
    const shown = boards.flatMap((scene) =>
      scene.kind === 'board' ? scene.items.map((item) => item.id) : []
    );

    // Every available dish appears on exactly one board page.
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown).toEqual(expect.arrayContaining(['p1', 'p2']));
  });
});

describe('isDisplayModeUrl', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  const withLocation = (search: string, fn: () => void) => {
    (globalThis as { window?: unknown }).window = { location: { search, pathname: '/r/diwan' } };
    try {
      fn();
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  };

  beforeAll(() => {
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('detects the display link and ignores ordinary QR links', () => {
    withLocation('?view=display', () => expect(isDisplayModeUrl()).toBe(true));
    withLocation('?mode=tv', () => expect(isDisplayModeUrl()).toBe(true));
    withLocation('?qr=abc123', () => expect(isDisplayModeUrl()).toBe(false));
    withLocation('', () => expect(isDisplayModeUrl()).toBe(false));
    withLocation('?view=menu', () => expect(isDisplayModeUrl()).toBe(false));
  });

  it('is safe when there is no window at all', () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(isDisplayModeUrl()).toBe(false);
  });
});

describe('display menu styles', () => {
  it('styles the board from the tenant brand tokens', () => {
    expect(selectorExists('.display-menu')).toBe(true);
    expect(selectorExists('.display-menu__item')).toBe(true);
    expect(selectorExists('.display-menu__price')).toBe(true);
    expect(selectorExists('.display-menu__controls')).toBe(true);

    let boardUsesBrand = false;
    cssRoot.walkRules((rule) => {
      if (!rule.selectors?.some((s) => s.trim() === '.display-menu')) return;
      rule.walkDecls((decl) => {
        if (decl.value.includes('--brand-')) boardUsesBrand = true;
      });
    });
    expect(boardUsesBrand).toBe(true);
  });

  it('animates on the compositor only, and never fakes card height', () => {
    // Signage runs for hours: motion is limited to opacity/transform.
    expect(cssText).toContain('@keyframes lm-scene-in');
    expect(cssText).toContain('@keyframes lm-ken-burns');
    expect(cssText).not.toMatch(/lm-[a-z-]+\s*\{[^}]*\b(top|left|width|height|margin)\s*:[^}]*\banimation/);
    // Regression guard: content-visibility on menu cards caused overlapping cards.
    expect(cssText).not.toContain('content-visibility');
    expect(cssText).not.toContain('contain-intrinsic-size');
  });

  it('hides the controls when the board is printed or reduced-motion is on', () => {
    expect(cssText).toContain('@media print');
    expect(cssText).toContain('prefers-reduced-motion');
    expect(cssText).toContain('.display-menu__cta,');
  });
});
