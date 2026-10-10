/**
 * Public SEO surface — venue pages, directory, dynamic sitemap, 404 shells.
 *
 * Two layers are covered:
 *   1. the pure renderers in server/seo/publicPages.ts (metadata, JSON-LD,
 *      snapshot, escaping, language) with hand-built venues;
 *   2. the Express handlers in server/seo/publicHandlers.ts mounted on a
 *      real HTTP server with Prisma mocked — asserting on the RAW HTML bytes
 *      a crawler receives (status, head tags, snapshot) before any JS runs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const db = vi.hoisted(() => ({
  restaurant: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  product: {
    groupBy: vi.fn(),
  },
  category: {
    groupBy: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({ prisma: db }));

const ORIGIN = 'https://mureehmenu.com';
const shellPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const SHELL = readFileSync(shellPath, 'utf8');

const updatedRestaurant = new Date('2026-09-01T10:00:00.000Z');
const updatedProduct = new Date('2026-09-20T15:30:00.000Z');
const updatedCategory = new Date('2026-09-10T08:00:00.000Z');

const category = (id: string, name: string, nameEn: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  nameEn,
  description: '',
  updatedAt: updatedCategory,
  ...extra,
});

const product = (categoryId: string, name: string, nameEn: string, price: number, extra: Record<string, unknown> = {}) => ({
  categoryId,
  name,
  nameEn,
  description: '',
  price,
  imageUrl: null,
  updatedAt: updatedProduct,
  ...extra,
});

/** A complete, publishable venue (ACTIVE, 2 sections, 4 products). */
const ghosn = {
  id: 'rest-ghosn',
  slug: 'ghosn-cafe',
  name: 'غصن كافيه',
  nameEn: 'Ghosn Cafe',
  description: 'كافيه عائلي في قلب المدينة يقدم القهوة المختصة والحلويات الطازجة مع إطلالة هادئة.',
  phone: '+970 59 000 0000',
  address: 'شارع الإرسال، رام الله',
  currency: '₪',
  language: 'ar',
  status: 'ACTIVE',
  businessType: 'CAFE',
  logoUrl: 'restaurants/rest-ghosn/logo/logo.png', // managed storage key → /uploads/… on the local driver
  coverImageUrl: 'https://cdn.example.com/ghosn/cover.jpg',
  mapImageUrl: null,
  galleryImages: [],
  latitude: 31.9,
  longitude: 35.2,
  websiteUrl: null,
  instagramUrl: 'https://instagram.com/ghosn',
  facebookUrl: '',
  tiktokUrl: null,
  youtubeUrl: null,
  updatedAt: updatedRestaurant,
  categories: [
    category('c1', 'المشروبات الساخنة', 'Hot Drinks'),
    category('c2', 'حلويات', 'Desserts', { description: 'تُحضَّر يومياً' }),
    category('c3', 'قسم فارغ', 'Empty Section'),
  ],
  products: [
    product('c1', 'قهوة تركية', 'Turkish Coffee', 8),
    product('c1', 'لاتيه', 'Latte', 12.5, { description: 'حليب كامل الدسم', imageUrl: 'https://cdn.example.com/latte.jpg' }),
    product('c2', 'كنافة', 'Kunafa', 15),
    product('c2', 'تشيز كيك "نيويورك" & توت <خاص>', 'NY Cheesecake </script><b>', 20),
  ],
};

/** ACTIVE but only one product: served, but noindex and absent from sitemap. */
const thin = {
  ...ghosn,
  id: 'rest-thin',
  slug: 'thin-venue',
  name: 'مطعم تجريبي',
  nameEn: 'Thin Venue',
  description: '',
  phone: '',
  address: '',
  latitude: null,
  longitude: null,
  instagramUrl: null,
  coverImageUrl: null,
  logoUrl: null,
  categories: [category('t1', 'الرئيسية', 'Mains')],
  products: [product('t1', 'طبق واحد', 'Single Dish', 30)],
};

/** English-language venue with an unknown currency marker. */
const english = {
  ...ghosn,
  id: 'rest-en',
  slug: 'burger-lab',
  name: 'Burger Lab',
  nameEn: 'Burger Lab',
  description: 'Smash burgers and shakes.',
  language: 'en',
  currency: 'XYZ',
  businessType: 'RESTAURANT',
  phone: '',
  address: '',
  latitude: null,
  longitude: null,
  instagramUrl: null,
  categories: [category('b1', 'Burgers', 'Burgers')],
  products: [
    product('b1', 'Classic', 'Classic', 25),
    product('b1', 'Double', 'Double', 35),
    product('b1', 'Veggie', 'Veggie', 28),
  ],
};

const suspended = { ...thin, id: 'rest-susp', slug: 'suspended-venue', name: 'موقوف', nameEn: 'Suspended', status: 'SUSPENDED' };
const maintenance = { ...thin, id: 'rest-maint', slug: 'maint-venue', name: 'صيانة', nameEn: 'Maintenance', status: 'MAINTENANCE' };

const ALL = [ghosn, thin, english, suspended, maintenance];

function installCatalog() {
  db.restaurant.findUnique.mockImplementation(async ({ where }: { where: { slug: string } }) => {
    const row = ALL.find((r) => r.slug === where.slug);
    return row ? structuredClone(row) : null;
  });
  db.restaurant.findMany.mockImplementation(async () =>
    ALL.filter((r) => r.status === 'ACTIVE').map((r) => structuredClone(r))
  );
  db.product.groupBy.mockImplementation(async () =>
    ALL.filter((r) => r.status === 'ACTIVE').map((r) => ({
      restaurantId: r.id,
      _count: { _all: r.products.length },
      _max: { updatedAt: updatedProduct },
    }))
  );
  db.category.groupBy.mockImplementation(async () =>
    ALL.filter((r) => r.status === 'ACTIVE').map((r) => ({
      restaurantId: r.id,
      _count: { _all: r.categories.filter((c) => r.products.some((p) => p.categoryId === c.id)).length },
      _max: { updatedAt: updatedCategory },
    }))
  );
}

function installCatalogFailure() {
  const boom = async () => {
    throw new Error('connection refused');
  };
  db.restaurant.findUnique.mockImplementation(boom);
  db.restaurant.findMany.mockImplementation(boom);
  db.product.groupBy.mockImplementation(boom);
  db.category.groupBy.mockImplementation(boom);
}

type Pages = typeof import('../../server/seo/publicPages');
type Handlers = typeof import('../../server/seo/publicHandlers');
type Catalog = typeof import('../../server/seo/publicCatalog');

let pages: Pages;
let handlers: Handlers;
let catalog: Catalog;
let server: Server | null = null;
let baseUrl = '';

const extractJsonLd = (html: string): any[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

const get = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, { redirect: 'manual', ...init });

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-only-public-seo-secret-32-chars!!';
  delete process.env.APP_URL;

  pages = await import('../../server/seo/publicPages');
  handlers = await import('../../server/seo/publicHandlers');
  catalog = await import('../../server/seo/publicCatalog');

  handlers.__setPublicShellForTests(SHELL);

  const app = express();
  app.get('/sitemap.xml', handlers.handleSitemap);
  app.get('/restaurants', handlers.handleDirectoryPage);
  app.get('/r/:slug', handlers.handleVenuePage);
  // Mirror of the server/index.ts SPA fallback: "/" is the shell, any other
  // extension-less path is an honest 404 shell, files are JSON 404s.
  app.get('/{*splat}', (req, res, next) => {
    if (/\.[a-zA-Z0-9]+$/.test(req.path)) {
      res.status(404).json({ success: false, error: 'Endpoint Not Found', statusCode: 404 });
      return;
    }
    if (req.path !== '/') {
      handlers.handleUnknownAppRoute(req, res, next);
      return;
    }
    res.status(200).type('html').send(SHELL);
  });

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  catalog.resetPublicCatalogCache();
  installCatalog();
});

// =====================================================================
// 1. Pure renderers
// =====================================================================

describe('publicPages — venue metadata from real records', () => {
  const venueOf = async (slug: string) => {
    const lookup = await catalog.getPublicVenue(slug);
    if (lookup.kind !== 'found') throw new Error(`expected ${slug} to be found`);
    return lookup.venue;
  };

  it('builds a unique title from name + English name and the menu intent, within 70 chars', async () => {
    const venue = await venueOf('ghosn-cafe');
    const title = pages.buildVenueTitle(venue);
    expect(title).toBe('غصن كافيه (Ghosn Cafe) — المنيو الإلكتروني والأسعار');
    expect(title.length).toBeLessThanOrEqual(70);
  });

  it('does not repeat the English name when it is already part of the Arabic name', () => {
    const title = pages.buildVenueTitle({
      ...(thin as any),
      name: 'غصن كافيه | Ghosn Cafe',
      nameEn: 'Ghosn Cafe',
      sections: [],
      productCount: 0,
      indexable: false,
      lastModified: updatedRestaurant,
    } as any);
    expect(title).toBe('غصن كافيه | Ghosn Cafe — المنيو الإلكتروني والأسعار');
  });

  it('keeps very long names inside the title budget', () => {
    const long = 'مطعم ' + 'اسم طويل جداً '.repeat(8);
    const title = pages.buildVenueTitle({
      ...(thin as any),
      name: long,
      nameEn: 'A Very Long English Name For A Restaurant That Goes On',
      sections: [],
      productCount: 0,
      indexable: false,
      lastModified: updatedRestaurant,
    } as any);
    expect(title.length).toBeLessThanOrEqual(70);
    expect(title).toContain('المنيو الإلكتروني');
  });

  it('uses the venue description when present and never emits undefined/null', async () => {
    const venue = await venueOf('ghosn-cafe');
    const description = pages.buildVenueDescription(venue);
    expect(description.startsWith('كافيه عائلي')).toBe(true);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description).not.toMatch(/undefined|null|NaN/);
  });

  it('derives a factual description from counts and section names when the venue has none', async () => {
    const venue = await venueOf('thin-venue');
    const description = pages.buildVenueDescription(venue);
    expect(description).toContain('مطعم تجريبي');
    expect(description).toContain('صنف واحد في قسم واحد');
    expect(description).toContain('الرئيسية');
    expect(description).not.toMatch(/undefined|null|NaN/);
  });

  it('JSON-LD mirrors only real fields: telephone/address/geo present for Ghosn, absent for the thin venue', async () => {
    const ghosnVenue = await venueOf('ghosn-cafe');
    const ghosnLd = pages.buildVenueJsonLd(ghosnVenue, `${ORIGIN}/r/ghosn-cafe`) as any;
    const node = ghosnLd['@graph'][0];
    expect(node['@type']).toBe('CafeOrCoffeeShop');
    expect(node.telephone).toBe('+970 59 000 0000');
    expect(node.address).toEqual({ '@type': 'PostalAddress', streetAddress: 'شارع الإرسال، رام الله' });
    expect(node.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 31.9, longitude: 35.2 });
    expect(node.sameAs).toEqual(['https://instagram.com/ghosn']);
    expect(node.image).toEqual(['https://cdn.example.com/ghosn/cover.jpg', `${ORIGIN}/uploads/restaurants/rest-ghosn/logo/logo.png`]);
    expect(node.logo).toBe(`${ORIGIN}/uploads/restaurants/rest-ghosn/logo/logo.png`);
    // Menu mirrors the visible sections — the empty section is omitted.
    const sections = node.hasMenu.hasMenuSection;
    expect(sections.map((s: any) => s.name)).toEqual(['المشروبات الساخنة', 'حلويات']);
    expect(sections[0].hasMenuItem[1]).toMatchObject({
      '@type': 'MenuItem',
      name: 'لاتيه',
      alternateName: 'Latte',
      description: 'حليب كامل الدسم',
      image: 'https://cdn.example.com/latte.jpg',
      offers: { '@type': 'Offer', price: '12.50', priceCurrency: 'ILS' },
    });

    const thinVenue = await venueOf('thin-venue');
    const thinNode = (pages.buildVenueJsonLd(thinVenue, `${ORIGIN}/r/thin-venue`) as any)['@graph'][0];
    expect(thinNode.telephone).toBeUndefined();
    expect(thinNode.address).toBeUndefined();
    expect(thinNode.geo).toBeUndefined();
    expect(thinNode.sameAs).toBeUndefined();
    expect(thinNode.image).toBeUndefined();
  });

  it('never fabricates ratings, reviews, opening hours or price ranges', async () => {
    for (const slug of ['ghosn-cafe', 'thin-venue', 'burger-lab']) {
      const raw = pages.serializeJsonLd(pages.buildVenueJsonLd(await venueOf(slug), `${ORIGIN}/r/${slug}`));
      expect(raw).not.toMatch(/aggregateRating|"Review"|openingHours|priceRange|servesCuisine/);
    }
  });

  it('omits the Offer when the currency marker cannot be mapped to ISO-4217', async () => {
    const venue = await venueOf('burger-lab');
    const node = (pages.buildVenueJsonLd(venue, `${ORIGIN}/r/burger-lab`) as any)['@graph'][0];
    const items = node.hasMenu.hasMenuSection[0].hasMenuItem;
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.offers).toBeUndefined();
    expect(pages.currencyCodeFor('₪')).toBe('ILS');
    expect(pages.currencyCodeFor('SAR')).toBe('SAR');
    expect(pages.currencyCodeFor('XYZ')).toBeNull();
  });

  it('serialises JSON-LD so venue text can never close the script element', () => {
    const raw = pages.serializeJsonLd({ name: 'NY Cheesecake </script><b>&' });
    expect(raw).not.toContain('</script>');
    expect(raw).not.toContain('<');
    expect(JSON.parse(raw)).toEqual({ name: 'NY Cheesecake </script><b>&' });
  });

  it('switches <html lang/dir>, og:locale and copy for an English venue', async () => {
    const venue = await venueOf('burger-lab');
    const html = pages.renderVenuePage(SHELL, venue);
    expect(html).toMatch(/<html lang="en" dir="ltr">/);
    expect(html).toContain('<meta property="og:locale" content="en_US" />');
    expect(html).toContain('<title>Burger Lab — Digital Menu &amp; Prices</title>');
    expect(html).toContain('<meta name="description" content="Smash burgers and shakes. Browse 3 items across 1 section with prices." />');
  });

  it('falls back to stripping individual SEO tags when a shell has no markers', async () => {
    const venue = await venueOf('ghosn-cafe');
    const shellWithoutMarkers = SHELL.replace(pages.HEAD_START_MARKER, '').replace(pages.HEAD_END_MARKER, '');
    const html = pages.renderVenuePage(shellWithoutMarkers, venue);
    expect(count(html, /<title>/g)).toBe(1);
    expect(count(html, /<link rel="canonical"/g)).toBe(1);
    expect(count(html, /<meta name="robots"/g)).toBe(1);
    expect(count(html, /<script type="application\/ld\+json">/g)).toBe(1);
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/r/ghosn-cafe" />`);
  });
});

describe('publicPages — directory', () => {
  it('renders crawlable links, a visible breadcrumb and matching BreadcrumbList/ItemList', async () => {
    const venues = await catalog.listPublishableVenues();
    const html = pages.renderDirectoryPage(venues);
    expect(html).toContain('<a href="/r/ghosn-cafe"');
    expect(html).toContain('<a href="/r/burger-lab"');
    expect(html).not.toContain('/r/thin-venue');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/restaurants" />`);
    expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    const [ld] = extractJsonLd(html);
    const types = ld['@graph'].map((n: any) => n['@type']);
    expect(types).toEqual(['CollectionPage', 'BreadcrumbList']);
    expect(ld['@graph'][0].mainEntity.itemListElement.map((i: any) => i.url).sort()).toEqual([
      `${ORIGIN}/r/burger-lab`,
      `${ORIGIN}/r/ghosn-cafe`,
    ]);
    expect(html).toContain('aria-label="breadcrumb"');
  });

  it('is honest when nothing is published: empty state + noindex', () => {
    const html = pages.renderDirectoryPage([]);
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
    expect(html).toContain('لا توجد قوائم منشورة');
    expect(html).not.toContain('ItemList');
  });
});

// =====================================================================
// 2. HTTP surface
// =====================================================================

describe('GET /r/:slug — raw HTML a crawler receives', () => {
  it('serves the venue title, description, canonical, robots, OG/Twitter and JSON-LD in the initial HTML', async () => {
    const res = await get('/r/ghosn-cafe');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();

    expect(html).toMatch(/<html lang="ar" dir="rtl">/);
    expect(html).toContain('<title>غصن كافيه (Ghosn Cafe) — المنيو الإلكتروني والأسعار</title>');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/r/ghosn-cafe" />`);
    expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/r/ghosn-cafe" />`);
    expect(html).toContain('<meta property="og:image" content="https://cdn.example.com/ghosn/cover.jpg" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toMatch(/<meta name="description" content="كافيه عائلي[^"]+" \/>/);

    // Exactly one of each — the homepage tags were replaced, not duplicated.
    expect(count(html, /<title>/g)).toBe(1);
    expect(count(html, /<link rel="canonical"/g)).toBe(1);
    expect(count(html, /<meta name="robots"/g)).toBe(1);
    expect(count(html, /<meta name="description"/g)).toBe(1);
    expect(count(html, /<script type="application\/ld\+json">/g)).toBe(1);

    // The homepage structured data must not leak onto the venue page.
    const [ld] = extractJsonLd(html);
    const types = ld['@graph'].map((n: any) => n['@type']);
    expect(types).toEqual(['CafeOrCoffeeShop', 'WebPage']);
    expect(html).not.toContain('FAQPage');
    expect(html).not.toContain('SoftwareApplication');
    // No dev/preview origin in any URL-bearing attribute, no "undefined" leaks.
    const attrUrls = [...html.matchAll(/(?:href|content|src)="([^"]*)"/g)].map((m) => m[1]!);
    for (const url of attrUrls) expect(url).not.toMatch(/localhost|127\.0\.0\.1|onrender\.com/);
    const headRegion = html.slice(html.indexOf(pages.HEAD_START_MARKER), html.indexOf(pages.HEAD_END_MARKER));
    expect(headRegion).not.toMatch(/undefined|\bnull\b|NaN/);
  });

  it('ships a server-rendered menu snapshot inside #root (content without JavaScript)', async () => {
    const html = await (await get('/r/ghosn-cafe')).text();
    const root = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<script type="module"/);
    expect(root).not.toBeNull();
    const snapshot = root![1]!;
    expect(snapshot).toContain('<h1>غصن كافيه</h1>');
    expect(snapshot).toContain('<h2 id="menu-section-1-title">المشروبات الساخنة <small lang="en">Hot Drinks</small></h2>');
    expect(snapshot).toContain('<h3>قهوة تركية</h3>');
    expect(snapshot).toContain('12.50 ₪');
    expect(snapshot).toContain('شارع الإرسال، رام الله');
    expect(snapshot).toContain('href="tel:+970590000000"');
    expect(snapshot).not.toContain('قسم فارغ'); // empty section is not advertised
    // Dangerous venue text is escaped in HTML…
    expect(snapshot).toContain('تشيز كيك &quot;نيويورك&quot; &amp; توت &lt;خاص&gt;');
    expect(snapshot).not.toContain('</script><b>');
    // …and inert inside JSON-LD, which still parses.
    const [ld] = extractJsonLd(html);
    const names = JSON.stringify(ld);
    expect(names).toContain('NY Cheesecake </script><b>'.replace('</script>', '</script>'));
    expect(html.split('<script type="application/ld+json">')[1]!.split('</script>')[0]).not.toContain('<');
    // Still the SPA shell: the module entry is intact so React takes over.
    expect(html).toMatch(/<script type="module"[^>]*src="[^"]+"/);
  });

  it('ignores QR / table / tracking parameters for metadata (canonical stays clean) while leaving the URL to the client', async () => {
    const res = await get('/r/ghosn-cafe?qr=table-token-123&utm_source=qr&view=display');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/r/ghosn-cafe" />`);
    expect(html).toContain('<title>غصن كافيه (Ghosn Cafe) — المنيو الإلكتروني والأسعار</title>');
    expect(html).not.toContain('table-token-123');
    expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    // Session / kiosk URLs keep today's boot sequence: no interim snapshot.
    expect(html).toMatch(/<div id="root"><\/div>/);
    // Tracking parameters alone do not change the page.
    const tracked = await (await get('/r/ghosn-cafe?utm_source=instagram&fbclid=x')).text();
    expect(tracked).toContain('data-seo-snapshot="venue"');
    expect(tracked).toContain(`<link rel="canonical" href="${ORIGIN}/r/ghosn-cafe" />`);
  });

  it('301s uppercase slugs and trailing slashes to the canonical form, preserving the query string', async () => {
    const upper = await get('/r/Ghosn-Cafe?qr=abc');
    expect(upper.status).toBe(301);
    expect(upper.headers.get('location')).toBe('/r/ghosn-cafe?qr=abc');

    const slash = await get('/r/ghosn-cafe/?qr=abc');
    expect(slash.status).toBe(301);
    expect(slash.headers.get('location')).toBe('/r/ghosn-cafe?qr=abc');
  });

  it('serves an ACTIVE venue with too little content but asks not to index it', async () => {
    const res = await get('/r/thin-venue');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
    expect(html).toContain('<title>مطعم تجريبي (Thin Venue) — المنيو الإلكتروني والأسعار</title>');
    expect(html).toContain('<h1>مطعم تجريبي</h1>');
  });

  it('falls back to the real platform social card (not the SVG favicon) when a venue has no imagery', async () => {
    const html = await (await get('/r/thin-venue')).text();
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/og-image.png" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${ORIGIN}/og-image.png" />`);
    expect(html).not.toMatch(/(og:image|twitter:image)" content="[^"]*favicon\.svg/); // never advertised as a social image
    expect(html).not.toContain('/api/og?type=platform');
    // Error shells use the same card.
    const missing = await (await get('/r/no-such-venue')).text();
    expect(missing).toContain(`<meta property="og:image" content="${ORIGIN}/og-image.png" />`);
  });

  it('answers 404 + noindex for a suspended venue and 503 for one in maintenance', async () => {
    const susp = await get('/r/suspended-venue');
    expect(susp.status).toBe(404);
    const suspHtml = await susp.text();
    expect(suspHtml).toContain('<meta name="robots" content="noindex, follow" />');
    expect(suspHtml).toContain('<title>موقوف — غير متاح حالياً | مُريح</title>');
    expect(suspHtml).toMatch(/<div id="root"><\/div>/); // no snapshot of private content

    const maint = await get('/r/maint-venue');
    expect(maint.status).toBe(503);
    expect(maint.headers.get('retry-after')).toBe('600');
  });

  it('returns a real 404 (never a soft 200) for unknown and malformed slugs, still with the SPA shell', async () => {
    const missing = await get('/r/does-not-exist');
    expect(missing.status).toBe(404);
    const html = await missing.text();
    expect(html).toContain('<title>الصفحة غير موجودة | مُريح</title>');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toMatch(/<script type="module"/);
    expect(html).not.toContain('FAQPage');

    const malformed = await get('/r/bad%20slug%21');
    expect(malformed.status).toBe(404);
    expect(db.restaurant.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'bad slug!' } }));
  });

  it('degrades to 503 + noindex when the catalog read fails (never a cached or indexable error)', async () => {
    installCatalogFailure();
    const res = await get('/r/ghosn-cafe');
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).not.toContain('connection refused');
  });

  it('answers HEAD like GET (status + headers) for crawlers that probe first', async () => {
    const res = await get('/r/ghosn-cafe', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('memoises venue reads for the cache TTL (one DB round-trip per slug per minute)', async () => {
    db.restaurant.findUnique.mockClear();
    await get('/r/ghosn-cafe');
    await get('/r/ghosn-cafe?qr=x');
    await get('/r/ghosn-cafe');
    expect(db.restaurant.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('GET /restaurants', () => {
  it('lists only publishable venues as plain anchors and links back home', async () => {
    const res = await get('/restaurants');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<a href="/r/ghosn-cafe"');
    expect(html).toContain('<a href="/r/burger-lab"');
    expect(html).not.toContain('thin-venue');
    expect(html).not.toContain('suspended-venue');
    expect(html).toContain('href="/"');
    expect(html).toContain('<title>دليل المطاعم والكافيهات على مُريح — تصفح المنيو الإلكتروني</title>');
  });

  it('301s the trailing-slash variant', async () => {
    const res = await get('/restaurants/');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/restaurants');
  });

  it('is served with 503 + noindex when the catalog is unavailable', async () => {
    installCatalogFailure();
    const res = await get('/restaurants');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('<meta name="robots" content="noindex, follow" />');
  });
});

describe('GET /sitemap.xml — database-backed', () => {
  it('lists the homepage, the directory and every publishable venue exactly once with real lastmod values', async () => {
    const res = await get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/xml/);
    const xml = await res.text();

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);

    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(locs.slice(0, 2)).toEqual([`${ORIGIN}/`, `${ORIGIN}/restaurants`]);
    expect(locs.slice(2).sort()).toEqual([`${ORIGIN}/r/burger-lab`, `${ORIGIN}/r/ghosn-cafe`]);
    expect(new Set(locs).size).toBe(locs.length);

    // lastmod is the newest real timestamp across venue/category/product rows.
    const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]!);
    const ghosnEntry = entries.find((e) => e.includes('/r/ghosn-cafe'))!;
    expect(ghosnEntry).toContain(`<lastmod>${updatedProduct.toISOString()}</lastmod>`);
    const homeEntry = entries.find((e) => e.includes(`<loc>${ORIGIN}/</loc>`))!;
    expect(homeEntry).not.toContain('<lastmod>'); // no real timestamp for the landing page → none invented

    for (const loc of locs) {
      expect(loc.startsWith('https://mureehmenu.com/')).toBe(true);
      expect(loc).not.toMatch(/\?/);
      expect(loc).not.toMatch(/localhost|127\.0\.0\.1|onrender\.com/i);
      expect(loc).not.toMatch(/\/(api|admin|dashboard|login|register|onboarding|uploads)\b/i);
    }
    expect(xml).not.toContain('thin-venue');
    expect(xml).not.toContain('suspended-venue');
    expect(xml).not.toContain('maint-venue');
    expect(xml).not.toMatch(/changefreq|priority/);
  });

  it('every URL in the sitemap answers 200 on this origin', async () => {
    const xml = await (await get('/sitemap.xml')).text();
    const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.replace(ORIGIN, ''));
    for (const path of paths) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    }
  });

  it('degrades to the platform entries (still valid XML, HTTP 200) when the catalog read fails', async () => {
    installCatalogFailure();
    const res = await get('/sitemap.xml');
    expect(res.status).toBe(200);
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${ORIGIN}/`]);
    expect(xml).not.toContain('connection refused');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('SPA fallback', () => {
  it('keeps "/" as a 200 shell and turns unknown app routes into 404 + noindex shells', async () => {
    const home = await get('/');
    expect(home.status).toBe(200);

    const unknown = await get('/dashboard');
    expect(unknown.status).toBe(404);
    const html = await unknown.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain('<title>الصفحة غير موجودة | مُريح</title>');
    expect(html).toMatch(/<script type="module"/);

    const file = await get('/definitely-missing.xml');
    expect(file.status).toBe(404);
    expect(file.headers.get('content-type')).toMatch(/application\/json/);
  });
});

describe('publicCatalog — index policy', () => {
  it('requires ACTIVE status, a non-empty section and MIN_INDEXABLE_PRODUCTS products', () => {
    const { isVenueIndexable, MIN_INDEXABLE_PRODUCTS } = catalog;
    expect(isVenueIndexable({ status: 'ACTIVE', productCount: MIN_INDEXABLE_PRODUCTS, sectionsWithItems: 1 })).toBe(true);
    expect(isVenueIndexable({ status: 'ACTIVE', productCount: MIN_INDEXABLE_PRODUCTS - 1, sectionsWithItems: 1 })).toBe(false);
    expect(isVenueIndexable({ status: 'ACTIVE', productCount: 10, sectionsWithItems: 0 })).toBe(false);
    expect(isVenueIndexable({ status: 'SUSPENDED', productCount: 10, sectionsWithItems: 2 })).toBe(false);
    expect(isVenueIndexable({ status: 'ONBOARDING', productCount: 10, sectionsWithItems: 2 })).toBe(false);
  });

  it('only accepts the slug charset the application itself accepts', () => {
    expect(catalog.normalizePublicSlug('Ghosn-Cafe')).toBe('ghosn-cafe');
    expect(catalog.normalizePublicSlug('bad slug!')).toBeNull();
    expect(catalog.normalizePublicSlug('../etc')).toBeNull();
    expect(catalog.normalizePublicSlug('')).toBeNull();
  });

  it('selects only public columns (no tables, QR tokens, sessions, orders or users)', async () => {
    await catalog.getPublicVenue('ghosn-cafe');
    const call = db.restaurant.findUnique.mock.calls.at(-1)![0] as { select: Record<string, unknown> };
    const selected = Object.keys(call.select);
    for (const forbidden of ['tables', 'tableSessions', 'orders', 'users', 'transferAccounts', 'subscription', 'ownerEmail', 'password']) {
      expect(selected).not.toContain(forbidden);
    }
    expect(selected).toEqual(expect.arrayContaining(['slug', 'name', 'nameEn', 'description', 'status', 'categories', 'products']));
  });
});
