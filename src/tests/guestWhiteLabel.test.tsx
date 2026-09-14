/**
 * White-label guest experience — the restaurant keeps its own identity.
 * =====================================================================
 * A guest reaches the menu by scanning a QR code that belongs to ONE
 * restaurant. From the entry layer to the footer, everything they read, tap or
 * share must carry that restaurant's identity and never the platform's: no
 * wordmark, no name, no support channel, no credit line, no platform mark in
 * the browser tab.
 *
 * These tests are written as a *scan* rather than a list of known strings, so
 * a new customer component inherits the rule automatically: any file a guest
 * can reach is checked, and the only excluded file is one that no surface
 * mounts (asserted separately below).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import type { Restaurant } from '../types/restaurant';
import {
  NEUTRAL_MENU_ICON,
  isRenderableIconUrl,
  tenantDocumentIdentity,
  tenantMonogramIcon,
} from '../hooks/useTenantDocumentIdentity';

const read = (relative: string) =>
  fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const customerDir = fileURLToPath(new URL('../components/customer', import.meta.url));

/**
 * The one file excluded from the scan: the pre-2026 welcome splash. It is not
 * mounted by any surface (pinned by the test below), so a guest can never reach
 * it — but it must never be re-mounted while it still carries a wordmark.
 */
const UNMOUNTED = new Set(['LuxuryWelcomeScreen.tsx']);

const guestSurfaces = fs
  .readdirSync(customerDir)
  .filter((file) => /\.(tsx?|jsx?)$/.test(file) && !UNMOUNTED.has(file))
  .map((file) => ({ name: file, source: fs.readFileSync(`${customerDir}/${file}`, 'utf8') }))
  // The poster/clip painter is published on the venue's own channels.
  .concat([{ name: 'socialExport.ts', source: read('../utils/socialExport.ts') }]);

/** Anything that hands the guest a platform identity instead of the venue's. */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /mureeh/i, why: 'the platform name (any casing, any script transliteration)' },
  { pattern: /مريح|مُريح/, why: 'the platform name in Arabic' },
  { pattern: /منصة/, why: 'a "platform" credit line' },
  { pattern: /powered by/i, why: 'a "powered by" credit' },
  { pattern: /t\.me\//, why: 'the platform support channel' },
  { pattern: /970593498909/, why: 'the platform support phone number' },
  { pattern: /مُدار بواسطة/, why: 'a "managed by" credit' },
];

const baseRestaurant: Restaurant = {
  id: 'rest-cedar',
  name: 'مطعم الأرز',
  nameEn: 'CEDAR HOUSE',
  slug: 'cedar',
  logo: 'https://cdn.example.test/logos/cedar.png',
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

describe('white label — nothing a guest can reach names the platform', () => {
  it('scans every guest surface, not a hand-picked list', () => {
    // The scan is only a guarantee if it really covers the guest flow.
    const names = guestSurfaces.map((surface) => surface.name);
    for (const required of [
      'RestaurantEntryExperience.tsx',
      'CustomerLayout.tsx',
      'CustomerHeader.tsx',
      'CustomerHero.tsx',
      'CartDrawer.tsx',
      'OrderTrackingDrawer.tsx',
      'DisplayMenu.tsx',
      'ProductCard.tsx',
      'CustomerLoadingExperience.tsx',
      'MenuPager.tsx',
      'socialExport.ts',
    ]) {
      expect(names, `guest surface ${required} must be scanned`).toContain(required);
    }
    expect(guestSurfaces.length).toBeGreaterThanOrEqual(20);
  });

  it.each(FORBIDDEN)('carries no $why', ({ pattern }) => {
    for (const surface of guestSurfaces) {
      expect(surface.source, `${surface.name} must not carry ${pattern}`).not.toMatch(pattern);
    }
  });

  it('dropped the credit line from the QR entry layer, CSS included', () => {
    const entry = read('../components/customer/RestaurantEntryExperience.tsx');
    expect(entry).not.toContain('entry-credit');

    const css = read('../index.css');
    const root = postcss.parse(css, { from: 'index.css' });
    let creditRule = false;
    root.walkRules((rule) => {
      if (rule.selectors.some((selector) => selector.includes('entry-credit'))) creditRule = true;
    });
    expect(creditRule).toBe(false);
  });

  it('keeps the unmounted splash out of every guest surface', () => {
    for (const surface of guestSurfaces) {
      expect(surface.source, `${surface.name} must not mount the old splash`).not.toContain(
        'LuxuryWelcomeScreen'
      );
    }
    // And the whole app never imports it: the entry layer replaced it.
    const app = read('../App.tsx');
    expect(app).not.toContain('LuxuryWelcomeScreen');
    const layout = read('../components/customer/CustomerLayout.tsx');
    expect(layout).toContain('RestaurantEntryExperience');
  });
});

describe('white label — the venue supplies the identity instead', () => {
  it('closes the menu with the restaurant name, phone and address', () => {
    const layout = read('../components/customer/CustomerLayout.tsx');
    expect(layout).toContain('currentRestaurant?.name');
    expect(layout).toContain('restaurantPhone');
    expect(layout).toContain('currentRestaurant.address');
    expect(layout).toContain('جميع الحقوق محفوظة');
    // The footer is read from the tenant, so an empty field is omitted rather
    // than filled with invented copy.
    expect(layout).toContain("(currentRestaurant?.description || '').trim()");
    expect(layout).toContain("(currentRestaurant?.phone || '').trim()");
  });

  it('routes guest support to the restaurant, not to a platform channel', () => {
    const header = read('../components/customer/CustomerHeader.tsx');
    expect(header).toContain('tel:${restaurantPhone}');
    expect(header).toContain('الاتصال بالمطعم');

    const tracking = read('../components/customer/OrderTrackingDrawer.tsx');
    expect(tracking).toContain('tel:${restaurantPhone}');
    // No number on file: the guest is pointed at the venue's own staff.
    expect(tracking).toContain('تواصل مع طاقم المطعم أو الكاشير');
  });

  it('watermarks the TV board and the exported poster with the tenant', () => {
    const display = read('../components/customer/DisplayMenu.tsx');
    expect(display).toContain('<strong>{restaurantName}</strong>');
    expect(display).toContain('القائمة الرقمية');

    const social = read('../utils/socialExport.ts');
    // The footer credit is the venue's own line, and the board URL — which
    // carries the platform's domain — is deliberately never printed.
    expect(social).toContain('input.restaurantName, input.restaurantNameEn');
    expect(social).not.toContain('input.url.replace');
  });
});

describe('white label — the browser tab', () => {
  it('builds the tab identity from the tenant record', () => {
    const arabic = tenantDocumentIdentity(baseRestaurant);
    expect(arabic.title).toBe('مطعم الأرز | CEDAR HOUSE');
    expect(arabic.description).toBe('مطبخ شامي معاصر على الشرفة.');
    expect(arabic.icon).toBe(baseRestaurant.logo);
    expect(arabic.themeColor).toBe('#7C3AED');

    const english = tenantDocumentIdentity({ ...baseRestaurant, language: 'en' });
    expect(english.title).toBe('CEDAR HOUSE | مطعم الأرز');
  });

  it('never leaks a platform mark into the favicon', () => {
    // No logo on file: the tile is built from the venue's own initial and
    // brand colours — never from a bundled platform asset.
    const identity = tenantDocumentIdentity({ ...baseRestaurant, logo: '' });
    expect(identity.icon).toContain('data:image/svg+xml');
    expect(decodeURIComponent(identity.icon)).toContain('C');
    expect(decodeURIComponent(identity.icon)).toContain('#7C3AED');
    expect(identity.icon).not.toContain('favicon.svg');

    const monogram = decodeURIComponent(tenantMonogramIcon('مطعم الأرز', '#D4AF37', '#C5A880'));
    expect(monogram).toContain('م');
  });

  it('refuses an icon URL that could execute', () => {
    expect(isRenderableIconUrl('https://cdn.example.test/logo.png')).toBe(true);
    expect(isRenderableIconUrl('/uploads/restaurants/r1/logo.png')).toBe(true);
    expect(isRenderableIconUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isRenderableIconUrl('javascript:alert(1)')).toBe(false);
    expect(isRenderableIconUrl('//evil.example/x.png')).toBe(false);
    expect(isRenderableIconUrl('')).toBe(false);

    const identity = tenantDocumentIdentity({
      ...baseRestaurant,
      logo: 'javascript:alert(1)',
    });
    expect(identity.icon).not.toContain('javascript:');
  });

  it('describes the venue when it wrote no description of its own', () => {
    const arabic = tenantDocumentIdentity({ ...baseRestaurant, description: '   ' });
    expect(arabic.description).toContain('مطعم الأرز');
    expect(arabic.description).toContain('القائمة الرقمية');

    const english = tenantDocumentIdentity({
      ...baseRestaurant,
      language: 'en',
      description: '',
    });
    expect(english.description).toContain('CEDAR HOUSE');

    // The fallback copy is the venue's, never the platform's.
    for (const identity of [arabic, english]) {
      expect(identity.description).not.toMatch(/mureeh/i);
      expect(identity.description).not.toContain('مريح');
      expect(identity.title).not.toMatch(/mureeh/i);
    }
  });

  it('keeps the pre-mount tab neutral on a QR route only', () => {
    const main = read('../main.tsx');
    // Runs before React mounts, so the platform title never flashes.
    expect(main.indexOf('prepareGuestRouteIdentity()')).toBeGreaterThan(-1);
    expect(main.indexOf('prepareGuestRouteIdentity()')).toBeLessThan(
      main.indexOf('createRoot(document')
    );

    const source = read('../hooks/useTenantDocumentIdentity.ts');
    expect(source).toContain("location.pathname.startsWith('/r/')");
    expect(NEUTRAL_MENU_ICON).not.toMatch(/mureeh/i);
    expect(decodeURIComponent(NEUTRAL_MENU_ICON)).toContain('<svg');
  });
});
