import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Category, Product, Restaurant } from '../types/restaurant';

/**
 * شاشة العرض (display screen) settings & device rule.
 * ===================================================
 * Two guarantees are asserted here, and neither is visible in a type check:
 *
 *  1. the automatic FILM is for the big panels only — a phone or a tablet (a
 *     coarse pointer, even in landscape) gets the static, read-only menu;
 *  2. the settings edited in «الإعدادات ← شاشة العرض» (background + font) are
 *     validated on the server, mapped on the client and actually painted.
 */

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
    image: 'https://example.test/hummus.jpg',
    isAvailable: true,
  },
  {
    id: 'p2',
    restaurantId: 'rest-diwan',
    categoryId: 'c2',
    name: 'منسف الديوان',
    nameEn: 'Diwan Mansaf',
    description: 'لحم ضأن مع لبن الجميد والأرز البسمتي.',
    price: 89,
    image: '',
    isAvailable: true,
  },
];

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      products,
      categories,
      currentRestaurant: restaurant,
      setCurrentRestaurant: () => {},
      refreshTenantData: () => {},
      showToast: () => {},
    }),
  };
});

// Imported after the mock is registered.
const { DisplayMenu } = await import('../components/customer/DisplayMenu');
const { LiveStaticMenu } = await import('../components/display/LiveStaticMenu');
const { buildLiveSections, resolveLiveProfile, shouldPlayFilm, SIGNAGE_MIN_WIDTH } = await import(
  '../components/display/liveMenuModel'
);
const { DISPLAY_FONT_KEYS: CLIENT_FONT_KEYS, mapRestaurantRow } = await import('../services/api');
const { DisplayScreenSettingsView } = await import(
  '../components/manager/DisplayScreenSettingsView'
);
const { brandingSchema, DISPLAY_FONT_KEYS: SERVER_FONT_KEYS } = await import(
  '../../server/validation/schemas'
);

const render = (ui: React.ReactElement) => renderToStaticMarkup(ui);

const cssPath = fileURLToPath(new URL('../index.css', import.meta.url));
const cssText = fs.readFileSync(cssPath, 'utf8');

/** The viewport a device reports, faked exactly the way the stage reads it. */
const withWindow = (stub: unknown, fn: () => void) => {
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = stub;
  try {
    fn();
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
};

const phone = {
  innerWidth: 390,
  navigator: { maxTouchPoints: 5 },
  matchMedia: () => ({ matches: true }), // coarse pointer
  location: { origin: 'https://app.test' },
};
const tabletLandscape = {
  innerWidth: 1194, // iPad Pro landscape — still a hand-held screen
  navigator: { maxTouchPoints: 5 },
  matchMedia: () => ({ matches: true }),
  location: { origin: 'https://app.test' },
};
const tv = {
  innerWidth: 1920,
  // A TV set: large screen, no touch at all (its remote may still report a
  // coarse pointer — which is why touch capability is asked separately).
  navigator: { maxTouchPoints: 0 },
  matchMedia: () => ({ matches: true }),
  location: { origin: 'https://app.test' },
};

describe('the automatic film is for large screens only', () => {
  it('plays on a TV/desktop and never on a phone or tablet', () => {
    // Big panel, mouse/keyboard.
    expect(shouldPlayFilm({ width: 1920, coarsePointer: false, hasTouch: false })).toBe(true);
    expect(shouldPlayFilm({ width: SIGNAGE_MIN_WIDTH, coarsePointer: false, hasTouch: false })).toBe(true);
    // A TV reports a coarse pointer through its remote but has NO touch input:
    // it must keep the automatic film.
    expect(shouldPlayFilm({ width: 1920, coarsePointer: true, hasTouch: false })).toBe(true);
    // A touchscreen laptop/desktop: the primary pointer is still a mouse.
    expect(shouldPlayFilm({ width: 1440, coarsePointer: false, hasTouch: true })).toBe(true);

    // Phones (even landscape, ≤ ~930px) and tablets (coarse pointer + touch)
    // never autoplay: the board must not advance under the guest's finger.
    expect(shouldPlayFilm({ width: 930, coarsePointer: true, hasTouch: true })).toBe(false);
    expect(shouldPlayFilm({ width: 834, coarsePointer: true, hasTouch: true })).toBe(false);
    // iPad landscape IS ≥ 1024px wide — still a hand-held screen.
    expect(shouldPlayFilm({ width: 1366, coarsePointer: true, hasTouch: true })).toBe(false);
    // A small desktop window is not a "large screen" either.
    expect(shouldPlayFilm({ width: 900, coarsePointer: false, hasTouch: false })).toBe(false);
  });

  it('renders the film on a big panel and the static menu on a hand-held screen', () => {
    withWindow(tv, () => {
      const html = render(<DisplayMenu />);
      expect(html).toContain('display-menu__scene--intro');
      expect(html).not.toContain('display-menu-static');
      expect(html).not.toContain('data-static="true"');
    });

    withWindow(phone, () => {
      const html = render(<DisplayMenu />);
      expect(html).toContain('data-static="true"');
      expect(html).toContain('display-menu-static');
      // A still page: no scene frame, no autoplay toolbar.
      expect(html).not.toContain('display-menu__scene--intro');
      expect(html).not.toContain('display-menu__controls');
      expect(html).not.toContain('إيقاف العرض التلقائي');
    });

    withWindow(tabletLandscape, () => {
      expect(render(<DisplayMenu />)).toContain('data-static="true"');
    });
  });

  it('keeps the server-rendered first frame unchanged (SSR has no viewport)', () => {
    // `renderToStaticMarkup` runs with no `window` at all: the board must paint
    // what it painted before this feature (the film) and swap on the client.
    const html = render(<DisplayMenu />);
    expect(html).toContain('display-menu__scene--intro');
    expect(html).not.toContain('data-static="true"');
  });
});

describe('the static menu (phone & tablet)', () => {
  it('shows every section and dish, still read-only', () => {
    withWindow(phone, () => {
      const html = render(<DisplayMenu />);

      expect(html).toContain('المقبلات');
      expect(html).toContain('الأطباق الرئيسية');
      expect(html).toContain('حمص بالصنوبر');
      expect(html).toContain('منسف الديوان');
      // Priced, with the dish photography the guest menu also shows.
      expect(html).toContain('₪24');
      expect(html).toContain('display-menu__thumb');
      // …and it still tells the guest where to order instead of taking one.
      expect(html).toContain('للطلب يرجى التوجه إلى الكاشير');
      for (const forbidden of ['إضافة', 'السلة', 'اطلب الآن', 'menu-card', 'cart']) {
        expect(html).not.toContain(forbidden);
      }
    });
  });

  it('renders without a viewport (safe for server rendering)', () => {
    const sections = buildLiveSections(categories, products);
    const html = render(
      <LiveStaticMenu
        chrome={{ restaurantName: 'مطعم الديوان', restaurantNameEn: 'Diwan', currency: '₪' }}
        sections={sections}
      />
    );
    expect(html).toContain('display-menu__static');
    expect(html).toContain('حمص بالصنوبر');
  });
});

describe('«شاشة العرض» settings', () => {
  it('maps the flat server row into the venue settings', () => {
    const mapped = mapRestaurantRow({
      ...restaurant,
      displayBackgroundMode: 'image',
      displayBackgroundImageUrl: 'https://cdn.test/bg.jpg',
      displayBackgroundStoragePath: 'restaurants/rest-diwan/cover/bg.jpg',
      displayFont: 'amiri',
    });
    expect(mapped.display).toEqual({
      backgroundMode: 'image',
      backgroundImage: 'https://cdn.test/bg.jpg',
      backgroundStoragePath: 'restaurants/rest-diwan/cover/bg.jpg',
      font: 'amiri',
    });

    // A venue that configured nothing (or a legacy payload) carries no settings.
    expect(mapRestaurantRow({ ...restaurant }).display).toBeUndefined();
    expect(
      mapRestaurantRow({ ...restaurant, displayFont: 'not-a-font' }).display
    ).toBeUndefined();
  });

  it('is validated on the server with the same font list the client offers', () => {
    expect(SERVER_FONT_KEYS).toEqual(CLIENT_FONT_KEYS);

    expect(
      brandingSchema.safeParse({
        restaurantId: 'rest-diwan',
        displayBackgroundMode: 'image',
        displayBackgroundImage: 'restaurants/rest-diwan/cover/bg.jpg',
        displayFont: 'amiri',
      }).success
    ).toBe(true);

    expect(brandingSchema.safeParse({ displayFont: 'comic-sans' }).success).toBe(false);
    expect(brandingSchema.safeParse({ displayBackgroundMode: 'video' }).success).toBe(false);
    expect(
      brandingSchema.safeParse({ displayBackgroundImage: 'data:image/png;base64,AAAA' }).success
    ).toBe(false);
  });

  it('paints the chosen font and the image background on the board', () => {
    const sections = buildLiveSections(categories, products);
    const profile = resolveLiveProfile(restaurant, sections, {
      backgroundMode: 'image',
      font: 'amiri',
    });
    expect(profile.vars['--lm-title-face']).toContain('Amiri');
    expect(profile.vars['--lm-body-face']).toContain('Amiri');

    // `auto` keeps the derived identity — the pre-feature behaviour.
    const auto = resolveLiveProfile(restaurant, sections, {
      backgroundMode: 'theme',
      font: 'auto',
    });
    expect(auto.vars['--lm-title-face']).not.toContain('Amiri');
    expect(auto.vars['--lm-title-face']).toBe(
      resolveLiveProfile(restaurant, sections).vars['--lm-title-face']
    );

    // The wallpaper replaces the ambient brand field only when a photo exists.
    restaurant.display = {
      backgroundMode: 'image',
      backgroundImage: 'https://example.test/bg.jpg',
      font: 'amiri',
    };
    try {
      const withPhoto = render(<DisplayMenu />);
      expect(withPhoto).toContain('display-menu__wallpaper');
      expect(withPhoto).not.toContain('display-menu__ambient-glow');

      restaurant.display = { backgroundMode: 'image', font: 'amiri' };
      const missingPhoto = render(<DisplayMenu />);
      expect(missingPhoto).not.toContain('display-menu__wallpaper');
      expect(missingPhoto).toContain('display-menu__ambient-glow');
    } finally {
      delete restaurant.display;
    }
  });

  it('is editable from its own manager section (background + fonts)', () => {
    const html = render(<DisplayScreenSettingsView />);

    expect(html).toContain('شاشة العرض (للقراءة فقط)');
    // Background source: the venue's own theme canvas, or a photograph. The
    // upload control belongs to the «صورة» mode, so it is absent until it is
    // picked (the venue can never save an image nobody uploaded).
    expect(html).toContain('من الثيم');
    expect(html).toContain('خلفية الشاشة');
    expect(html).not.toContain('رفع صورة من الجهاز');
    // Fonts, including the derived identity option.
    expect(html).toContain('خط الهوية (تلقائي)');
    for (const preset of ['طجوال', 'القاهرة', 'أميري', 'كورمورانت']) {
      expect(html).toContain(preset);
    }
    expect(html).toContain('حفظ إعدادات الشاشة');
    // The device rule is explained, not offered as a switch: a venue must never
    // be able to make the board orderable.
    expect(html).toContain('هاتف وآيباد');
    expect(html).toContain('تلفاز وحاسوب');
  });

  it('styles the display settings in index.css', () => {
    for (const selector of [
      '.display-menu__wallpaper',
      '.display-menu__static',
      '.display-menu__static-section',
      '.display-menu__thumb',
      ".display-menu__item[data-thumb='true']",
    ]) {
      expect(cssText).toContain(selector);
    }
    // The picked face is really consumed by the stylesheet (the running text),
    // not merely emitted as a token.
    expect(cssText).toContain('var(--lm-body-face');
    expect(cssText).toContain("[data-static='true']");
  });
});
