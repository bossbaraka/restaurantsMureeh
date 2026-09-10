/**
 * QR welcome splash — tenant theming regression tests.
 *
 * The splash is the very first screen a guest sees after scanning the table QR,
 * and it used to hardcode a navy/gold palette (`#00072D` ×10, `#051650` ×6,
 * `#123499` ×6, `#D4AF37`/`#E2C067`, 19 `amber-*` utilities, 0 `--brand-*`
 * references) while every other customer surface — CustomerHeader, CustomerHero,
 * CartDrawer — was already driven by the tenant brand tokens. These tests pin
 * the fix by rendering the REAL component for a tenant whose brand is nothing
 * like gold, and by checking the themed CSS layer it depends on.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Root } from 'postcss';
import {
  buildBrandTokens,
  buildSplashPalette,
  rgbaCss,
  rgbToHsl,
  relativeLuminance,
} from '../theme/brandTheme';
import type { Category, Product, Restaurant } from '../types/restaurant';

// A tenant that is deliberately NOT gold/navy: a purple+cyan brand. If any
// tenant colour is still hardcoded, this render will not follow it.
const restaurant: Restaurant = {
  id: 'rest-orchid',
  name: 'مطعم الأوركيد',
  nameEn: 'ORCHID DINING',
  slug: 'orchid',
  logo: '',
  description: 'مطبخ معاصر بلمسة شرقية.',
  phone: '0599000000',
  address: 'شارع ركب، رام الله',
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

const products: Product[] = [
  {
    id: 'p1',
    restaurantId: 'rest-orchid',
    categoryId: 'c1',
    name: 'كبسة الأوركيد',
    nameEn: 'Orchid Kabsa',
    description: 'أرز بسمتي مع لحم.',
    price: 68,
    image: '',
    isAvailable: true,
    isFeatured: true,
  },
  {
    id: 'p2',
    restaurantId: 'rest-orchid',
    categoryId: 'c2',
    name: 'سلطة الأفوكادو',
    nameEn: 'Avocado Salad',
    description: 'سلطة طازجة.',
    price: 32,
    image: '',
    isAvailable: true,
  },
  {
    id: 'p3',
    restaurantId: 'rest-orchid',
    categoryId: 'c2',
    name: 'عصير برتقال طازج',
    nameEn: 'Fresh Orange Juice',
    description: 'طازج يومياً.',
    price: 14,
    image: '',
    isAvailable: true,
  },
  {
    id: 'p4',
    restaurantId: 'rest-orchid',
    categoryId: 'c1',
    name: 'منسف الديوان',
    nameEn: 'Diwan Mansaf',
    description: 'لحم ضأن مطهو ببطء.',
    price: 89,
    image: '',
    isAvailable: true,
  },
];

const categories: Category[] = [
  { id: 'c1', restaurantId: 'rest-orchid', name: 'الأطباق', nameEn: 'Mains', sortOrder: 1 },
  { id: 'c2', restaurantId: 'rest-orchid', name: 'السلطات', nameEn: 'Salads', sortOrder: 2 },
];

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      currentRestaurant: (globalThis as any).__businessTypeOverride
        ? { ...restaurant, businessType: (globalThis as any).__businessTypeOverride }
        : restaurant,
      activeTableId: 'table_7',
      products,
      categories,
    }),
  };
});

// Imported after the mock is registered.
const { LuxuryWelcomeScreen, WelcomeMenuDevice } = await import(
  '../components/customer/LuxuryWelcomeScreen'
);

const render = (initialStep: 'NETWORKING' | 'LOGO_REVEAL' | 'WELCOME_SHOWCASE' = 'NETWORKING') =>
  renderToStaticMarkup(<LuxuryWelcomeScreen onDismiss={() => {}} initialStep={initialStep} />);

const componentPath = fileURLToPath(new URL('../components/customer/LuxuryWelcomeScreen.tsx', import.meta.url));
const componentSource = readFileSync(componentPath, 'utf8');

const cssPath = fileURLToPath(new URL('../index.css', import.meta.url));
const cssText = readFileSync(cssPath, 'utf8');
const cssRoot: Root = postcss.parse(cssText, { from: cssPath });

function declarations(selector: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  cssRoot.walkRules((rule) => {
    if (rule.selectors?.some((s) => s.trim() === selector) !== true) return;
    rule.walkDecls((decl) => {
      const list = map.get(decl.prop) || [];
      list.push(decl.value);
      map.set(decl.prop, list);
    });
  });
  return map;
}

const cssValue = (selector: string, prop: string): string =>
  (declarations(selector).get(prop) || []).join(' ');

// The old hardcoded tenant palette. None of it may survive anywhere.
const LEGACY_PALETTE = ['#00072D', '#051650', '#123499', '#D4AF37', '#E2C067'];

describe('QR splash paints itself from the tenant brand tokens', () => {
  it('renders no hardcoded tenant colour for a purple-branded restaurant', () => {
    const markup = render();

    for (const legacy of LEGACY_PALETTE) {
      expect(markup.toLowerCase()).not.toContain(legacy.toLowerCase());
    }
    expect(componentSource).not.toMatch(/amber-\d+/);
    for (const legacy of LEGACY_PALETTE) {
      expect(componentSource).not.toContain(legacy);
    }
  });

  it('consumes the same --brand-* custom properties the menu uses', () => {
    const markup = render();

    expect(markup).toContain('var(--brand-primary-strong)');
    expect(markup).toContain('welcome-shell');
    expect(markup).toContain('welcome-medallion');
    // The particle canvas is decorative and must never be announced.
    expect(markup).toContain('<canvas');
    expect(markup).toContain('aria-hidden="true"');
  });

  it('never rebuilds an rgba by string-concatenating the brand hex', () => {
    // `${primaryCol}80` produced invalid CSS for `rgb()`, shorthand or named
    // brand colours — the single most common way a themed screen silently
    // falls back to the wrong colour.
    expect(componentSource).not.toMatch(/\$\{\s*\w*[Cc]ol\w*\s*\}[0-9a-fA-F]{2}/);
  });

  it('shows the tenant identity and the table the QR belongs to', () => {
    const markup = render();

    expect(markup).toContain('مطعم الأوركيد');
    expect(markup).toContain('أهلاً بك في مطعم الأوركيد');
    expect(markup).toContain('07');
  });

  it('does not invent an English name for tenants that have none', () => {
    const source = componentSource;
    // The platform wordmark must never be passed off as the tenant's nameEn.
    expect(source).not.toContain("nameEn || 'MUREEH DINING'");
  });
});

describe('QR splash hand-off into the menu', () => {
  it('sits on the exact canvas the menu is drawn on, so dismissal has no colour jump', () => {
    expect(cssValue('.welcome-shell', 'background-color')).toBe('var(--welcome-canvas)');

    const canvasToken = cssText.match(/--welcome-canvas:\s*([^;]+);/)?.[1]?.trim();
    const bodyCanvas = cssText.match(/@apply\s+bg-\[(#[0-9a-fA-F]{6})\]/)?.[1];
    expect(canvasToken).toBeTruthy();
    expect(canvasToken?.toLowerCase()).toBe(bodyCanvas?.toLowerCase());
  });

  it('themes every surface, chip, tile and CTA from the tokens', () => {
    expect(cssValue('.welcome-card', 'background-color')).toContain('var(--welcome-surface)');
    expect(cssValue('.welcome-card', 'border')).toContain('var(--brand-line)');
    expect(cssValue('.welcome-chip', 'color')).toBe('var(--brand-primary-strong)');
    expect(cssValue('.welcome-tile', 'border')).toContain('var(--brand-line)');
    expect(cssValue('.welcome-scrim', 'background')).toContain('var(--welcome-canvas)');
    expect(cssValue('.welcome-aura', 'background')).toContain('var(--brand-glow)');
  });

  it('keeps the CTA label readable for any brand colour', () => {
    // The fill comes from the tenant, the label from the contrast-safe ink that
    // `buildBrandTokens` picks with WCAG relative luminance.
    expect(cssValue('.welcome-cta', 'background-image')).toBe('var(--brand-fill)');
    expect(cssValue('.welcome-cta', 'color')).toBe('var(--brand-ink)');
    expect(cssValue('.welcome-monogram', 'color')).toBe('var(--brand-ink)');
  });

  it('neutralises its own decorative motion for reduced-motion guests', () => {
    const reduced = cssRoot.nodes
      .filter((n) => n.type === 'atrule' && (n as postcss.AtRule).name === 'media')
      .filter((n) => /prefers-reduced-motion/.test((n as postcss.AtRule).params))
      .map((n) => n.toString())
      .join('\n');

    expect(reduced).toContain('.welcome-medallion::after');
    expect(reduced).toContain('.welcome-cta::after');
    expect(reduced).toContain('.welcome-dot__timer');
    // ...and the JS loop is skipped too, not just the CSS.
    expect(componentSource).toContain('reducedMotion');
    expect(componentSource).toContain('prefers-reduced-motion: reduce');
  });
});

describe('QR splash showcase stage', () => {
  it('exposes the primary action as a real button with a contrast-safe label', () => {
    const markup = render('WELCOME_SHOWCASE');

    expect(markup).toContain('ابدأ التصفح واستكشف القائمة');
    expect(markup).toContain('welcome-cta');
    // Every interactive element is a button, so keyboard and screen-reader
    // guests can leave the splash (the old tap hint was a bare <div onClick>).
    expect(markup).not.toMatch(/<div[^>]+onClick/);
    expect(markup.match(/type="button"/g)?.length).toBeGreaterThan(4);
  });

  it('presents real catalogue facts rather than decorative filler', () => {
    const markup = render('WELCOME_SHOWCASE');

    expect(markup).toContain(`${products.length} صنف في القائمة`);
    expect(markup).toContain(`${categories.length} أقسام`);
  });

  it('shows the gallery first and the guest reviews underneath it', () => {
    const markup = render('WELCOME_SHOWCASE');
    const galleryAt = markup.indexOf('صور من أجواء وضيافة');
    const reviewsAt = markup.indexOf('آراء ضيوف المطعم');

    expect(galleryAt).toBeGreaterThan(-1);
    expect(reviewsAt).toBeGreaterThan(-1);
    expect(galleryAt).toBeLessThan(reviewsAt);
  });

  it('rotates guest reviews with an aria-live region and one control per review', () => {
    const markup = render('WELCOME_SHOWCASE');

    // Only the active review is in the DOM; the rest are reached by the dots.
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('تجربة ضيافة استثنائية');
    expect(markup).toContain('سارة القحطاني');
    expect(markup).not.toContain('م. أحمد الشريف');

    expect(markup).toContain('welcome-dot--active');
    expect(markup).toContain('welcome-dot__timer');
    for (const n of [1, 2, 3]) {
      expect(markup).toContain(`عرض التقييم ${n} من 3`);
    }
    expect(markup.match(/welcome-dot /g)?.length).toBe(3);
  });

  it('gives the guest an accessible way out at every stage', () => {
    expect(render()).toContain('تخطي للمنيو مباشرة');
    expect(render()).toContain('role="dialog"');
    expect(render()).toContain('aria-modal="true"');
    expect(render('WELCOME_SHOWCASE')).toContain('role="status"');
  });

  it('reveals the tap hint a beat after the logo, without swallowing early taps', () => {
    const markup = render('LOGO_REVEAL');

    // The medallion itself is a button, so tapping before the hint appears
    // still advances instead of doing nothing.
    expect(markup).toContain('aria-label="الدخول إلى قائمة مطعم الأوركيد"');
    expect(markup).toContain('المس للدخول إلى القائمة');
    // ...but the hint is still hidden until the reveal fires.
    expect(markup).toContain('pointer-events-none translate-y-3 opacity-0');
  });
});

describe('decorative starfield', () => {
  it('renders a hidden sky of stars on every stage', () => {
    for (const stage of ['NETWORKING', 'LOGO_REVEAL', 'WELCOME_SHOWCASE'] as const) {
      const markup = render(stage);
      expect(markup).toContain('welcome-stars');
      expect(markup.match(/class="welcome-star"/g)?.length).toBe(24);
      expect(markup.match(/welcome-star__glyph/g)?.length).toBe(24);
    }
    // Decorative only: never announced to assistive tech.
    expect(render()).toMatch(/<div class="welcome-stars[^"]*" aria-hidden="true">/);
  });

  it('is deterministic, so the sky does not reshuffle between renders', () => {
    expect(render('WELCOME_SHOWCASE')).toBe(render('WELCOME_SHOWCASE'));
  });

  it('takes its colour from the tenant brand instead of a fixed gold', () => {
    expect(cssValue('.welcome-star', 'color')).toBe('var(--brand-primary-strong)');
    expect(cssValue('.welcome-star__glyph', 'filter')).toContain('var(--brand-glow)');
    expect(cssValue('.welcome-star', 'animation-name')).toBe('welcome-drift');
    expect(cssValue('.welcome-star__glyph', 'animation-name')).toBe('welcome-twinkle');
    // The default tenant is gold, which is what makes the stars read as golden.
    expect(cssText).toMatch(/--brand-primary-strong:\s*#e6c86e/i);
  });

  it('gives each star its own drift and twinkle rhythm', () => {
    const markup = render('WELCOME_SHOWCASE');
    const durations = [...markup.matchAll(/animation-duration:([\d.]+)s/g)].map((m) => m[1]);
    expect(durations.length).toBeGreaterThanOrEqual(48);
    expect(new Set(durations).size).toBeGreaterThan(10);
    // Negative delays stagger the pulse instead of blinking in unison.
    expect(markup).toContain('animation-delay:-');
  });

  it('leaves reduced-motion guests a still sky instead of a frozen fade', () => {
    const reduced = cssRoot.nodes
      .filter((n) => n.type === 'atrule' && (n as postcss.AtRule).name === 'media')
      .filter((n) => /prefers-reduced-motion/.test((n as postcss.AtRule).params))
      .map((n) => n.toString())
      .join('\n');

    expect(reduced).toContain('.welcome-star');
    expect(reduced).toContain('animation: none');
  });
});

describe('interactive menu device', () => {
  it('is the hero object, driven by tilt custom properties not inline math', () => {
    const html = render('WELCOME_SHOWCASE');

    expect(html).toContain('welcome-device-stage');
    expect(html).toContain('welcome-device__frame');
    expect(html).toContain('welcome-device__glare');
    // The shadow lives on the STAGE, outside the rotated element, so it stays
    // on the floor instead of tilting along with the device.
    expect(html).toContain('welcome-device__shadow');
    const shadowAt = html.indexOf('welcome-device__shadow');
    const deviceClose = html.indexOf('welcome-device__glare');
    expect(shadowAt).toBeGreaterThan(deviceClose);
  });

  it('opens as a real toggle button that announces its state', () => {
    const html = render('WELCOME_SHOWCASE');

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="توسيع قائمة مطعم الأوركيد"');
    // Keyboard guests must reach it — no bare <div onClick>.
    expect(html).toMatch(/<button[^>]*welcome-device__frame/);
  });

  it("renders the tenant's actual catalogue, not placeholder dishes", () => {
    const html = render('WELCOME_SHOWCASE');

    expect(html).toContain('كبسة الأوركيد');
    expect(html).toContain('₪68');
    expect(html).toContain('طاولة 07');
    // Featured sorts first, then a teaser of three — so expanding reveals more.
    expect(html.match(/welcome-device__row/g)?.length).toBe(3);
    expect(html).toContain('الأكثر طلباً');
    expect(html).not.toContain('منسف الديوان');
  });

  it('keeps the tilt on the compositor and lets the page scroll past it', () => {
    // transform-only tilt, vars written from the pointer handler
    expect(cssValue('.welcome-device', 'will-change')).toContain('transform');
    expect(cssValue('.welcome-device', 'transform')).toContain('rotateX(var(--tilt-x))');
    expect(cssValue('.welcome-device-stage', 'touch-action')).toBe('pan-y');
    expect(cssValue('.welcome-device-stage', 'perspective')).toBeTruthy();
    // No easing while the finger is down, or the device reads as laggy.
    expect(cssValue('.welcome-device-stage--dragging .welcome-device', 'transition')).toBe('none');
  });

  it('flattens the device completely for reduced-motion guests', () => {
    const reduced = cssRoot.nodes
      .filter((n) => n.type === 'atrule' && (n as postcss.AtRule).name === 'media')
      .filter((n) => /prefers-reduced-motion/.test((n as postcss.AtRule).params))
      .map((n) => n.toString())
      .join('\n');

    expect(reduced).toContain('.welcome-device');
    expect(reduced).toContain('transform: none');
    expect(reduced).toContain('.welcome-device__glare');
  });
});

describe('§13 — QR morphs into the wordmark', () => {
  it('invites the drag before it has been taken', () => {
    const html = render('WELCOME_SHOWCASE');

    expect(html).toContain('welcome-qr-stage');
    expect(html).toContain('<canvas');
    expect(html).toContain('اسحب إصبعك على الرمز');
    // The wordmark only exists after the interaction completes.
    expect(html).not.toContain('welcome-wordmark');
  });

  it('keeps the canvas honest about being decorative-but-draggable', () => {
    const html = render('WELCOME_SHOWCASE');

    expect(html).toContain('aria-label="اسحب إصبعك على الرمز ليتحوّل إلى القائمة الرقمية"');
    // The drag must not fight page scrolling on the rest of the screen.
    expect(cssValue('.welcome-qr', 'touch-action')).toBe('none');
    expect(cssValue('.welcome-device-stage', 'touch-action')).toBe('pan-y');
  });

  it('rewards the drag with the wordmark and the meaning line', () => {
    const html = renderToStaticMarkup(
      <LuxuryWelcomeScreen
        onDismiss={() => {}}
        initialStep="WELCOME_SHOWCASE"
        initialQrMaterialized
      />
    );

    expect(html).toContain('welcome-wordmark');
    expect(html).toContain('MUREEH');
    expect(html).toContain('رمز واحد يفتح تجربة كاملة');
    expect(html).not.toContain('اسحب إصبعك على الرمز');
  });

  it('paints the wordmark from the tenant fill, not a hardcoded colour', () => {
    expect(cssValue('.welcome-wordmark', 'background-image')).toBe('var(--brand-fill)');
    expect(cssValue('.welcome-wordmark', 'color')).toBe('var(--brand-ink)');
  });
});

describe('§8 — scroll is a timeline, not a translation', () => {
  it('drives parallax from a single custom property', () => {
    expect(cssValue('.welcome-parallax', 'transform')).toContain('var(--scroll');
    expect(cssValue('.welcome-parallax', 'will-change')).toContain('transform');
    expect(render('WELCOME_SHOWCASE')).toContain('welcome-parallax');
  });

  it('brings the QR beat into focus as the guest scrolls to it', () => {
    expect(cssValue('.welcome-qr-section', 'opacity')).toContain('var(--scroll');
  });

  it('turns the progress rail into a fill, and costs no React render', () => {
    expect(render('WELCOME_SHOWCASE')).toContain('welcome-progress__fill');
    expect(cssValue('.welcome-progress__fill', 'transform')).toContain('scaleX(var(--scroll');
    // The handler writes a CSS var only — no setState in the scroll path.
    expect(componentSource).not.toContain('setScrollBeat');
    expect(componentSource).toContain("el.style.setProperty('--scroll'");
  });

  it('flattens every scroll effect for reduced-motion guests', () => {
    const reduced = cssRoot.nodes
      .filter((n) => n.type === 'atrule' && (n as postcss.AtRule).name === 'media')
      .filter((n) => /prefers-reduced-motion/.test((n as postcss.AtRule).params))
      .map((n) => n.toString())
      .join('\n');

    expect(reduced).toContain('.welcome-parallax');
    expect(reduced).toContain('transform: none');
    expect(reduced).toContain('.welcome-qr-section');
  });
});

describe('menu device, expanded', () => {
  const renderDevice = (overrides: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <WelcomeMenuDevice
        restaurantName="مطعم الأوركيد"
        restaurantNameEn="ORCHID DINING"
        monogram="O"
        logoImg=""
        tableNumStr="07"
        currency="₪"
        defaultLanguage="ar"
        products={products}
        categories={categories}
        expanded
        reducedMotion={false}
        onExpand={() => {}}
        onCollapse={() => {}}
        {...overrides}
      />
    );

  it('reveals the full catalogue and the category rail', () => {
    const html = renderDevice();

    expect(html).toContain('welcome-device--expanded');
    expect(html).toContain('aria-expanded="true"');
    // 4 dishes in the fixture, all of them now visible.
    expect(html.match(/welcome-device__row/g)?.length).toBe(4);
    expect(html).toContain('منسف الديوان');
    for (const cat of ['الكل', 'الأطباق', 'السلطات']) {
      expect(html).toContain(cat);
    }
  });

  it('switches the whole menu into the guest\'s other language', () => {
    const html = renderDevice({ defaultLanguage: 'en' });

    expect(html).toContain('Orchid Kabsa');
    expect(html).toContain('ORCHID DINING');
    expect(html).toContain('Mains');
    expect(html).not.toContain('كبسة الأوركيد');
  });

  it('shows an empty state instead of a blank box for a category with no dishes', () => {
    const html = renderDevice({
      categories: [...categories, { id: 'c9', restaurantId: 'rest-orchid', name: 'قسم فارغ', nameEn: 'Empty', sortOrder: 9 }],
    });
    // The rail renders the extra category; the collapsed-to-empty copy exists
    // in the component for when a guest selects it.
    expect(html).toContain('قسم فارغ');
  });

  it('labels the toggle for collapse, not expand, once open', () => {
    expect(renderDevice()).toContain('aria-label="تصغير قائمة المطعم"');
  });
});

describe('venue-aware framing (Restaurant.businessType)', () => {
  const renderWith = (businessType: 'RESTAURANT' | 'CAFE' | 'BAKERY') => {
    (globalThis as any).__businessTypeOverride = businessType;
    try {
      return renderToStaticMarkup(
        <LuxuryWelcomeScreen onDismiss={() => {}} initialStep="WELCOME_SHOWCASE" />
      );
    } finally {
      delete (globalThis as any).__businessTypeOverride;
    }
  };

  it('speaks the language of the venue the guest actually walked into', () => {
    expect(renderWith('RESTAURANT')).toContain('اطلب من طاولتك');
    expect(renderWith('CAFE')).toContain('دون انتظار في الطابور');
    expect(renderWith('BAKERY')).toContain('للاستلام');

    expect(renderWith('RESTAURANT')).toContain('تجربة طاولة');
    expect(renderWith('CAFE')).toContain('طلب سريع');
    expect(renderWith('BAKERY')).toContain('استلام سريع');
  });

  it('falls back to the restaurant framing when the venue kind is absent', () => {
    // Rows cached before the column existed must not render an empty tagline.
    const html = render('WELCOME_SHOWCASE');
    expect(html).toContain('اطلب من طاولتك');
  });
});

describe('stage progress is labelled, not just three anonymous dots', () => {
  it('names the beat the guest is on', () => {
    expect(render()).toContain('EXPERIENCE');
    expect(render('LOGO_REVEAL')).toContain('DISCOVER');
    expect(render('WELCOME_SHOWCASE')).toContain('CONNECT');
    expect(render()).toContain('>01<');
  });
});

describe('splash particle palette is derived from the tenant tokens', () => {
  it('keeps the tenant hues and stays visible on a dark canvas', () => {
    const tokens = buildBrandTokens('#7C3AED', '#22D3EE');
    const palette = buildSplashPalette(tokens);

    // Verified ramp: three shades carry the primary hue (262°), one carries the
    // accent hue (188°) so the field is two-tone — none of them gold (47°).
    expect(palette.shades.map((s) => Math.round(rgbToHsl(s).h))).toEqual([262, 262, 188, 262]);

    for (const shade of [...palette.shades, palette.link]) {
      const { h, l } = rgbToHsl(shade);
      // Never drift back to the legacy hardcoded gold particles.
      expect(Math.abs(h - 47)).toBeGreaterThan(40);
      // Bright enough to read against the #0A0B0D canvas.
      expect(l).toBeGreaterThan(0.45);
    }

    // The glow is the lifted primary, not the raw tenant hex (#7C3AED is too
    // dark to bloom on a near-black background).
    expect(palette.glow).toEqual({ r: 137, g: 77, b: 239 });
    expect(rgbaCss(palette.glow, 0.5)).toBe('rgba(137, 77, 239, 0.5)');
    expect(tokens.primaryStrong).toBe('#894DEF');
  });

  it('rescues a near-black brand instead of painting black on black', () => {
    const palette = buildSplashPalette(buildBrandTokens('#111111', '#111111'));

    for (const shade of [...palette.shades, palette.link]) {
      expect(relativeLuminance(shade)).toBeGreaterThan(0.2);
    }
  });

  it('formats canvas colours in the classic rgba() form', () => {
    expect(rgbaCss({ r: 212, g: 175, b: 55 }, 0.25)).toBe('rgba(212, 175, 55, 0.25)');
    // Out-of-range channels are clamped rather than producing invalid CSS.
    expect(rgbaCss({ r: 300, g: -10, b: 55 }, 1)).toBe('rgba(255, 0, 55, 1)');
  });
});
