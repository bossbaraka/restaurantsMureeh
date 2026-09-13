/**
 * QR entry experience — regression suite for the redesigned post-scan journey.
 *
 * The reported failure: a guest scanning a valid table QR ended on
 * "تعذر تحميل قائمة المطعم / هذا المطعم غير متاح للطلب حالياً" plus a
 * bounce to the SaaS landing page. The fix has four load-bearing pieces, and
 * each is pinned here:
 *
 *   1. server — an inactive tenant still returns its PUBLIC identity on the
 *      403s, so the guest device can render a *branded* unavailable screen;
 *   2. api    — the client surfaces that identity on failed responses;
 *   3. context — the QR journey is a state machine (RESOLVING / READY /
 *      UNAVAILABLE / ERROR): a stale-slug printed QR gets one token-only
 *      retry, and a guest is NEVER bounced to the SaaS landing page with a
 *      generic error toast;
 *   4. UI     — four composed, tenant-branded state screens replace the old
 *      dead-ends, the internal console bar is hidden from anonymous guests,
 *      and the CSS is fully scoped (.qrstate-* / .customer-hero__*).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Restaurant } from '../types/restaurant';

// ---------------------------------------------------------------------------
// Fixtures — a tenant that is deliberately NOT the platform's navy/gold.
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

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      currentRestaurant,
      activeTableId: null,
      activeTableNumber: null,
      products: [],
      categories: [],
    }),
  };
});

const { QrResolvingScreen, RestaurantUnavailableScreen, QrErrorScreen, QrRequiredPrompt } =
  await import('../components/customer/RestaurantEntryStates');
const { ProductCard } = await import('../components/customer/ProductCard');
const { RestaurantEntryExperience } = await import(
  '../components/customer/RestaurantEntryExperience'
);

const baseProduct: import('../types/restaurant').Product = {
  id: 'p-motion',
  restaurantId: 'rest-cedar',
  categoryId: 'c1',
  name: 'شيش طاووق',
  nameEn: 'Chicken Shish',
  description: 'دجاج مشوي على الفحم.',
  price: 78,
  image: 'https://cdn.example.test/dishes/shish.jpg',
  isAvailable: true,
  preparationTimeMinutes: 20,
};

// ---------------------------------------------------------------------------
// Sources under test
// ---------------------------------------------------------------------------
const read = (relative: string) =>
  fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const publicRoutes = read('../../server/routes/public.ts');
const apiSource = read('../services/api.ts');
const restaurantContext = read('../context/RestaurantContext.tsx');
const layoutSource = read('../components/customer/CustomerLayout.tsx');
const appSource = read('../App.tsx');
const stateSource = read('../components/customer/RestaurantEntryStates.tsx');
const cssSource = read('../index.css');

// ---------------------------------------------------------------------------
// 1. Server — inactive tenants return their public identity on the 403s
// ---------------------------------------------------------------------------
describe('server: inactive-tenant 403s carry the public restaurant identity', () => {
  it('defines the public-identity helper', () => {
    expect(publicRoutes).toContain('function publicRestaurantMeta(');
  });

  it('the QR session endpoint returns the identity when the venue is inactive', () => {
    // The session POST is the exact call a guest device makes after a scan.
    // [2] = the text after the route string itself (the string appears in the
    // doc comment and again in the router.post() call).
    const sessionRoute = publicRoutes.split('/tables/qr/:qrToken/session')[2] || '';
    const inactiveBranch = sessionRoute.split("restaurant.status !== 'ACTIVE'")[1] || '';
    expect(inactiveBranch).toContain('data: { restaurant: publicRestaurantMeta(restaurant) }');
    expect(inactiveBranch).toContain('statusCode: 403');
  });

  it('the public catalog returns the identity when the venue is inactive', () => {
    const catalogRoute = publicRoutes.split('/restaurants/:slug')[2] || '';
    const inactiveBranch = catalogRoute.split("restaurant.status !== 'ACTIVE'")[1] || '';
    expect(inactiveBranch).toContain('data: { restaurant: publicRestaurantMeta(restaurant) }');
    expect(inactiveBranch).toContain('statusCode: 403');
  });

  it('the identity stays public: no tokens, no prices, no plans leaked', () => {
    // Only the helper's own body (up to the next route registration).
    const helper =
      (publicRoutes.split('function publicRestaurantMeta(')[1] || '')
        .split("router.get('/events'")[0] || '';
    expect(helper).not.toContain('qrToken');
    expect(helper).not.toContain('passwordHash');
    expect(helper).not.toContain('planId');
    // Every field the helper publishes must already be public via the directory.
    expect(helper).toContain('slug: restaurant.slug');
    expect(helper).toContain('logoUrl: restaurant.logoUrl');
  });
});

// ---------------------------------------------------------------------------
// 2. API client — the failed-response identity is surfaced, not swallowed
// ---------------------------------------------------------------------------
describe('api client: failed responses surface the restaurant identity', () => {
  const methodBody = (name: string) => {
    const rest = apiSource.split(`${name}(`)[1] || '';
    return rest.split('\n  // ')[0]; // up to the next documented method
  };

  it('createTableSession maps data.restaurant on rejections', () => {
    const body = methodBody('createTableSession');
    expect(body).toContain('if (res.data && res.data.restaurant)');
    expect(body).toContain('data: { restaurant: mapRestaurantRow(res.data.restaurant) }');
  });

  it('getPublicRestaurantBySlug maps data.restaurant on rejections', () => {
    const body = methodBody('getPublicRestaurantBySlug');
    expect(body).toContain('if (res.data && res.data.restaurant)');
    expect(body).toContain('data: { restaurant: mapRestaurantRow(res.data.restaurant) }');
  });
});

// ---------------------------------------------------------------------------
// 3. Context — the QR journey state machine
// ---------------------------------------------------------------------------
describe('context: QR entry state machine', () => {
  it('models the four journey phases', () => {
    expect(restaurantContext).toContain("phase: 'RESOLVING'");
    expect(restaurantContext).toContain("phase: 'READY'");
    expect(restaurantContext).toContain("phase: 'UNAVAILABLE'");
    expect(restaurantContext).toContain("phase: 'ERROR'");
  });

  it('retries a stale-slug printed QR with the token alone (opaque capability)', () => {
    // One retry WITHOUT the slug hint: the server resolves the true tenant
    // from the token, so a renamed slug can no longer kill a valid QR.
    expect(restaurantContext).toMatch(/sessionRes\.statusCode === 400/);
    expect(restaurantContext).toContain('sessionRes = await api.createTableSession(targetToken);');
  });

  it('renders the branded unavailable screen instead of an error', () => {
    expect(restaurantContext).toContain("phase: 'UNAVAILABLE'");
    expect(restaurantContext).toContain('restaurantUnavailableReason(');
    // The 10s poll also flips live when the venue goes inactive mid-session.
    expect(restaurantContext).toMatch(/Live status flip/);
  });

  it('never bounces a scanned QR to the SaaS landing page with a toast', () => {
    // The reported failure — the scary generic toast — is gone for good.
    expect(restaurantContext).not.toContain('تعذر تحميل قائمة المطعم');
    // The guest QR flow ends in CUSTOMER (a designed screen), never in the
    // landing page, and never raises a load-failure error toast (the only
    // toast left in the flow is the one-table binding notice). The
    // staff-facing display-board branch at the top of the effect is exempt —
    // its bounce is intentional.
    const guestFlow = restaurantContext.split('if (!slug) return;')[1] || '';
    const effect = guestFlow.split('}, []);')[0] || '';
    expect(effect).not.toContain("setViewMode('SAAS_LANDING')");
    // No load-failure toasts — the guest always lands on a designed screen.
    expect(effect).not.toContain('تعذر تحميل');
    expect(effect).toContain('لا يمكن تغيير الطاولة');
    expect(effect).toContain("setViewMode('CUSTOMER')");
  });

  it('offers a retry that re-runs the QR resolution from scratch', () => {
    expect(restaurantContext).toContain('retryQrEntry');
    expect(restaurantContext).toContain('window.location.reload()');
  });

  it('keeps the one-table-per-device binding behaviour', () => {
    expect(restaurantContext).toContain('merar_table_binding');
    expect(restaurantContext).toContain('لا يمكن تغيير الطاولة');
  });
});

// ---------------------------------------------------------------------------
// 4. UI — composed state screens, guest-only chrome, scoped CSS
// ---------------------------------------------------------------------------
describe('customer layout: state screens replace the dead-ends', () => {
  it('renders one composed screen per journey phase', () => {
    expect(layoutSource).toContain('<QrResolvingScreen restaurant={currentRestaurant} />');
    expect(layoutSource).toContain('<RestaurantUnavailableScreen');
    expect(layoutSource).toContain('<QrErrorScreen');
    expect(layoutSource).toContain('<QrRequiredPrompt restaurant={currentRestaurant} />');
  });

  it('the old dead-ends are gone', () => {
    expect(layoutSource).not.toContain('هذا الرابط غير صالح للدخول المباشر');
    // The old alarm-red suspended card no longer exists.
    expect(layoutSource).not.toContain('border-red-500/40');
    // A KNOWN non-active venue (mid-session flip) renders the same screen.
    expect(layoutSource).toContain("currentRestaurant.status !== 'ACTIVE'");
  });

  it('still mounts the entry experience in its existing slot', () => {
    expect(layoutSource).toMatch(
      /\{showWelcome && <RestaurantEntryExperience onEnter=\{handleDismissWelcome\} \/>\}/
    );
  });
});

describe('app shell: guests see the restaurant world, not the staff console', () => {
  it('hides the internal ViewSwitcher bar for anonymous guests', () => {
    expect(appSource).toMatch(/!\(safeViewMode === 'CUSTOMER' && !currentUser\)/);
  });
});

describe('entry state screens: tenant-branded, deterministic, logic-free', () => {
  it('owns no business logic: no network, no storage, no session, no cart', () => {
    for (const forbidden of ['fetch(', 'api.', 'axios', 'prisma', 'localStorage', 'sessionStorage', 'createTableSession', 'addToCart']) {
      expect(stateSource, `component must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('is deterministic: no Math.random in the paint', () => {
    expect(stateSource).not.toContain('Math.random(');
  });

  it('resolving screen — the venue cover + a composed "preparing" state', () => {
    const html = renderToStaticMarkup(<QrResolvingScreen restaurant={baseRestaurant} />);
    expect(html).toContain(baseRestaurant.coverImage as string);
    expect(html).toContain('جارٍ تجهيز طاولتكم');
    expect(html).toContain('qrstate-scanner');
  });

  it('unavailable screen — the reported message, now a designed state', () => {
    const html = renderToStaticMarkup(
      <RestaurantUnavailableScreen restaurant={baseRestaurant} reason="SUSPENDED" onRetry={() => {}} />
    );
    expect(html).toContain('هذا المطعم غير متاح للطلب حالياً');
    expect(html).toContain('إعادة المحاولة');
    expect(html).toContain('tel:0599000000');
    // Brand, not alarm: the state tint comes from the tenant tokens.
    expect(html).toContain('qrstate-statusicon--muted');
  });

  it('unavailable screen — maintenance and onboarding get their own copy', () => {
    const maintenance = renderToStaticMarkup(
      <RestaurantUnavailableScreen restaurant={baseRestaurant} reason="MAINTENANCE" onRetry={() => {}} />
    );
    expect(maintenance).toContain('المطعم تحت الصيانة الآن');

    const onboarding = renderToStaticMarkup(
      <RestaurantUnavailableScreen restaurant={baseRestaurant} reason="ONBOARDING" onRetry={() => {}} />
    );
    expect(onboarding).toContain('يستعد لبدء العمل');
  });

  it('error screen — invalid QR gets a retry + support, not a landing page', () => {
    const html = renderToStaticMarkup(
      <QrErrorScreen restaurant={baseRestaurant} kind="INVALID_QR" onRetry={() => {}} />
    );
    expect(html).toContain('تعذر فتح القائمة عبر رمز QR');
    expect(html).toContain('إعادة المحاولة');
    expect(html).toContain('t.me/Mureeh_tech_bot');

    const network = renderToStaticMarkup(
      <QrErrorScreen restaurant={baseRestaurant} kind="NETWORK" onRetry={() => {}} />
    );
    expect(network).toContain('لا يوجد اتصال بالشبكة');
  });

  it('required prompt — a browser-opened catalog asks for the table QR', () => {
    const html = renderToStaticMarkup(<QrRequiredPrompt restaurant={baseRestaurant} />);
    expect(html).toContain('افتح القائمة عبر رمز QR');
    expect(html).toContain('مطعم الأرز');
  });

  it('follows the tenant language (dir + copy)', () => {
    currentRestaurant = { ...baseRestaurant, language: 'en' };
    const html = renderToStaticMarkup(
      <QrErrorScreen restaurant={currentRestaurant} kind="INVALID_QR" onRetry={() => {}} />
    );
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('We could not open the menu from this QR');
    currentRestaurant = baseRestaurant;
    const rtl = renderToStaticMarkup(
      <QrErrorScreen restaurant={baseRestaurant} kind="INVALID_QR" onRetry={() => {}} />
    );
    expect(rtl).toContain('dir="rtl"');
  });
});

describe('css: fully scoped state + hero styles', () => {
  const selectors = cssSource.match(/\.qrstate-[a-z-]+(?:__[a-z-]+)?(?:--[a-z-]+)?/g) || [];
  const unique = new Set(selectors);

  it('defines the state-layer selectors', () => {
    for (const s of [
      '.qrstate-root',
      '.qrstate-scanner__line',
      '.qrstate-statusicon--error',
      '.qrstate-statusicon--muted',
      '.qrstate-btn--primary',
      '.qrstate-card',
      '.qrstate-credit',
    ]) {
      expect(unique.has(s), `missing ${s}`).toBe(true);
    }
  });

  it('keeps every animation behind prefers-reduced-motion: no-preference', () => {
    expect(cssSource).toContain('@keyframes qrstate-scan');
    expect(cssSource).toContain('@keyframes qrstate-mote');
    expect(cssSource).toContain('prefers-reduced-motion: no-preference');
    // And an explicit reduced-motion fallback block.
    expect(cssSource).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.qrstate-scanner__line/);
  });

  it('paints the state screens from tenant tokens, not a hardcoded palette', () => {
    expect(cssSource).toContain('--brand-primary-rgb');
    expect(cssSource).toContain('--brand-ink');
  });

  it('adds the cinematic hero drift + hairline brand frame', () => {
    expect(cssSource).toContain('.customer-hero__frame');
    expect(cssSource).toContain('@keyframes customer-hero-drift');
    const driftBlock = cssSource.split('customer-hero-drift')[1] || '';
    expect(cssSource).toMatch(/prefers-reduced-motion: no-preference[\s\S]*?\.customer-hero__img/);
    expect(driftBlock).toContain('scale(1.13)');
  });
});

// ---------------------------------------------------------------------------
// 5. Luxury motion layer — constellation, thread of light, menu turn
// ---------------------------------------------------------------------------
describe('luxury motion layer: constellation + thread + menu turn', () => {
  const plexusSource = read('../components/customer/PlexusField.tsx');
  const entrySource = read('../components/customer/RestaurantEntryExperience.tsx');
  const heroSource = read('../components/customer/CustomerHero.tsx');
  const cardSource = read('../components/customer/ProductCard.tsx');

  it('PlexusField is a deterministic, dependency-free canvas constellation', () => {
    // Deterministic: seeded PRNG places every point — no Math.random in the tree.
    expect(plexusSource).toContain('mulberry32');
    expect(plexusSource).not.toContain('Math.random');
    // No animation library: one <canvas> and a rAF loop.
    for (const forbidden of ['framer-motion', 'three', 'gsap', 'lottie', '@react-spring']) {
      expect(plexusSource).not.toContain(forbidden);
    }
    // Tenant-coloured: it reads the brand token, never a hardcoded tenant hue.
    expect(plexusSource).toContain('--brand-primary-strong');
    // Mindful: reduced motion → one static frame; full teardown on unmount.
    expect(plexusSource).toContain("prefers-reduced-motion: reduce");
    expect(plexusSource).toContain('cancelAnimationFrame');
    expect(plexusSource).toContain('disconnect()');
    // Decorative: out of the accessibility tree.
    expect(plexusSource).toContain('aria-hidden="true"');
  });

  it('the entry experience carries the constellation and the Thread of Light', () => {
    expect(entrySource).toContain('<PlexusField className="entry-plexus"');
    expect(entrySource).toContain('entry-thread__path');
    // The real component renders both layers (the canvas field + the SVG
    // thread) in its cover, before the content.
    const html = renderToStaticMarkup(<RestaurantEntryExperience onEnter={() => {}} />);
    expect(html).toContain('entry-thread');
    expect(html).toContain('entry-thread__path');
    expect(html).toContain('class="entry-plexus"');
  });

  it('the thread is drawn from tenant tokens in a same-namespace keyframe', () => {
    expect(cssSource).toContain('.entry-thread__path');
    expect(cssSource).toContain('@keyframes entry-thread-draw');
    expect(cssSource).toContain('stroke: url(#entry-thread-grad)');
    // And it rests under reduced motion (the LAST reduce block is the
    // motion layer's — earlier ones are the global animation reset).
    const reduced = cssSource.split('@media (prefers-reduced-motion: reduce)').pop() || '';
    expect(reduced).toContain('.entry-thread__path');
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it('every entry-state screen keeps its constellation', () => {
    const count = stateSource.split('<PlexusField className="qrstate-plexus"').length - 1;
    expect(count).toBe(4);
    expect(cssSource).toContain('.qrstate-plexus');
  });

  it('product cards settle in with a staggered scroll reveal', () => {
    expect(cardSource).toContain('IntersectionObserver');
    const html = renderToStaticMarkup(
      <ProductCard
        product={baseProduct}
        currency="₪"
        cartQuantity={0}
        priority={false}
        featured={false}
        revealIndex={2}
        onSelect={() => {}}
        onQuickAdd={() => {}}
        onQuantityChange={() => {}}
      />
    );
    expect(html).toContain('menu-card--reveal');
    // The hidden state + entrance live ONLY in the no-preference query
    // (the motion layer's is the last one in the sheet).
    const noPref = cssSource.split('@media (prefers-reduced-motion: no-preference)').pop() || '';
    expect(noPref).toContain('.menu-card--reveal');
    expect(cssSource).toContain('@keyframes menu-card-in');
    expect(cssSource).toContain('calc(var(--reveal-i, 0) * 55ms)');
    // Fill mode must not freeze the hover transform afterwards.
    expect(cssSource).toMatch(/menu-card-in 0\.62s cubic-bezier\(0\.22, 1, 0\.36, 1\) backwards/);
  });

  it('the menu "turns" on category change: keyed grid + self-drawing rule', () => {
    expect(layoutSource).toContain('key={`grid-${isSearching ? \'search\' : effectiveCategoryId}`}');
    expect(layoutSource).toContain('key={`section-head-${effectiveCategoryId}`}');
    expect(cssSource).toContain('@keyframes menu-rule-draw');
    expect(cssSource).toContain('@keyframes menu-head-in');
    expect(cssSource).toContain('.menu-section-head__rule');
  });

  it('the scroll thread fills with reading progress from the reading start', () => {
    expect(layoutSource).toContain('customer-thread');
    expect(layoutSource).toContain('scaleX(');
    expect(cssSource).toContain('.customer-thread__fill');
    expect(cssSource).toMatch(/transform-origin:\s*right center/);
    expect(cssSource).toContain('transform: scaleX(0)');
  });

  it('the hero photograph drifts slower than the scroll (depth parallax)', () => {
    expect(heroSource).toContain('customer-hero__parallax');
    expect(heroSource).toContain('translate3d(0, ');
    // Reduced-motion guests skip the parallax entirely.
    expect(heroSource).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(cssSource).toContain('.customer-hero__parallax');
  });

  it('no new animation dependency was introduced', () => {
    const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const forbidden of ['framer-motion', 'three', 'gsap', 'lottie-web', '@react-spring', 'motion']) {
      expect(deps[forbidden], `unexpected dependency ${forbidden}`).toBeUndefined();
    }
  });
});
