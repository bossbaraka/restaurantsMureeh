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

describe('DisplayMenu (read-only board)', () => {
  it('renders the tenant identity and the first category as a board', () => {
    const html = render(<DisplayMenu />);

    expect(html).toContain('display-menu');
    expect(html).toContain('مطعم الديوان');
    expect(html).toContain('Diwan Restaurant');
    expect(html).toContain('المقبلات');
    expect(html).toContain('حمص بالصنوبر');
    expect(html).toContain('24');
    // The board is branded with the platform so a filmed clip credits it.
    expect(html).toContain('منصة مريح MUREEH');
  });

  it('offers no way to order: no cart, no add button, no quantity stepper', () => {
    const html = render(<DisplayMenu />);

    for (const forbidden of ['إضافة', 'السلة', 'اطلب الآن', 'menu-card', 'menu-qty', 'cart']) {
      expect(html).not.toContain(forbidden);
    }
    // ...and it says so on screen, for guests standing in front of a TV.
    expect(html).toContain('للطلب يرجى التوجه إلى الكاشير');
  });

  it('never advertises a dish the kitchen marked unavailable', () => {
    const html = render(<DisplayMenu />);

    expect(html).not.toContain('طبق نفذ من المطبخ');
  });

  it('skips categories left with nothing to show', () => {
    const html = render(<DisplayMenu />);

    // "قسم مغلق" has no products at all, so it must not appear as a section.
    expect(html).not.toContain('قسم مغلق');
    // Only the starters category is on screen at first: 1 of 2 sections.
    expect(html).toContain('1 / 2');
  });

  it('keeps the price in a tabular, currency-prefixed cell', () => {
    const html = render(<DisplayMenu />);

    expect(html).toContain('display-menu__price');
    expect(html).toContain('₪24');
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

  it('hides the controls when the board is printed or reduced-motion is on', () => {
    expect(cssText).toContain('@media print');
    expect(cssText).toContain('prefers-reduced-motion');
  });

  it('does not reintroduce the containment hack that broke card layout', () => {
    // Regression guard: content-visibility on menu cards caused overlapping cards.
    expect(cssText).not.toContain('content-visibility');
    expect(cssText).not.toContain('contain-intrinsic-size');
  });
});
