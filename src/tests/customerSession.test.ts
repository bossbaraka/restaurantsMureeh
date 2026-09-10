import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Regression coverage for the customer ordering session hardening:
 *
 *  1. Guests could not see their order status (the public catalog never
 *     returned orders, so the "المطبخ الحي" tracker stayed empty). The fix
 *     ships a session-scoped orders endpoint + wires it into the guest menu.
 *  2. Guests could switch tables / "log in" by typing any table number, and
 *     every table's QR token was published on the public catalog. The fix
 *     makes entry QR-only, binds one table per device, and stops leaking
 *     tokens.
 *  3. The customer map/video fell back to platform defaults because the
 *     catalog omitted the venue's location and media fields.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const schema = read('../../prisma/schema.prisma');
const publicRoutes = read('../../server/routes/public.ts');
const tableModal = read('../components/customer/DirectTableEntryModal.tsx');
const guideOverlay = read('../components/customer/CustomerGuideOverlay.tsx');
const guideBus = read('../components/customer/guideBus.ts');
const restaurantContext = read('../context/RestaurantContext.tsx');

describe('customer order status', () => {
  it('ships a session-scoped public orders endpoint', () => {
    expect(publicRoutes).toMatch(/\/tables\/:tableId\/orders/);
    expect(publicRoutes).toContain('getQrSession(sessionToken, restaurantId, tableId)');
  });

  it('fetches the guest orders inside refreshTenantData', () => {
    expect(restaurantContext).toContain('getTableSessionOrders');
  });
});

describe('QR-only entry & one table per device', () => {
  it('never publishes table QR tokens on the public catalog', () => {
    // The tables array mapping must not carry the qrToken field.
    const tablesBlock = publicRoutes.match(/tables: \(restaurant\.tables \|\| \[\]\)\.map[\s\S]*?\}\),\s*$/m)?.[0] || '';
    expect(tablesBlock).not.toContain('qrToken: t.qrToken');
  });

  it('publishes venue location and media for the customer map/video', () => {
    const restaurantBlock = publicRoutes.match(/restaurant: \{[\s\S]*?promoVideoUrl: restaurant\.promoVideoUrl,[\s\S]*?\},/)?.[0] || '';
    expect(restaurantBlock).toContain('latitude: restaurant.latitude');
    expect(restaurantBlock).toContain('longitude: restaurant.longitude');
    expect(restaurantBlock).toContain('promoVideoUrl: restaurant.promoVideoUrl');
    expect(restaurantBlock).toContain('galleryImages: restaurant.galleryImages');
  });

  it('stores venue location columns on the Restaurant model', () => {
    const restaurantModel = schema.match(/model Restaurant \{[\s\S]*?\n\}/)?.[0] || '';
    expect(restaurantModel).toContain('latitude');
    expect(restaurantModel).toContain('longitude');
    expect(restaurantModel).toContain('mapUrl');
  });

  it('keeps the table selector QR-only for guests', () => {
    expect(tableModal).toContain('الدخول عبر رمز QR فقط');
    expect(tableModal).toContain('isConsoleUser');
    expect(tableModal).toContain('لا يُمكن إدخال رقم الطاولة يدوياً');
  });

  it('persists a one-table binding in the session', () => {
    expect(restaurantContext).toContain('merar_table_binding');
    expect(restaurantContext).toContain('لا يمكن تغيير الطاولة');
  });
});

describe('customer guide', () => {
  it('ships the interactive guide with an external open trigger', () => {
    expect(guideBus).toContain('export function openCustomerGuide');
    expect(guideBus).toContain('GUIDE_OPEN_EVENT');
    expect(guideOverlay).toContain('data-guide');
  });
});
