import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';

/**
 * Phase 3 — Branch Theme through the public customer catalog.
 *
 * Proves the full guest path with the REAL theme resolver:
 *
 *   QR token → Table (server-side lookup) → Branch → resolveEffectiveTheme
 *   → Platform → Restaurant → Branch → Effective Theme → catalog response
 *
 * The route derives the branch from the scanned table's qrToken ONLY —
 * a guest can never supply an arbitrary branch — and the resolver
 * re-validates branch ownership (defence in depth).
 */

vi.mock('../../server/config', () => ({
  config: { appUrl: 'http://localhost:3000' },
  JWT_ISSUER: 'test',
  JWT_AUDIENCE: 'test',
  JWT_ALGORITHM: 'HS256',
}));

vi.mock('../../server/services/storage', () => ({
  getStorage: () => ({
    getUrl: (key: string) => `http://cdn/${key}`,
    keyFromUrl: () => null,
    exists: async () => true,
  }),
  assetUrlResolverFor: () => (key: string) => `http://cdn/${key}`,
  assetNormalizerFor: () => ({ keyFromUrl: () => null }),
  resolveRestaurantAssets: (row: any) => ({
    ...row,
    logoUrl: row.logoUrl || '',
    coverImageUrl: row.coverImageUrl || '',
    mapImageUrl: row.mapImageUrl || '',
    galleryImages: row.galleryImages || [],
    displayBackgroundImageUrl: row.displayBackgroundImageUrl || '',
  }),
  resolveAssetReference: (value: any) => value,
  isStorageKey: (k: string) => typeof k === 'string' && k.startsWith('restaurants/'),
  keyBelongsToRestaurant: (key: string, restaurantId: string) =>
    key.startsWith(`restaurants/${restaurantId}/`),
  buildStorageKey: () => '',
}));

// ---------------------------------------------------------------------------
// Prisma mock — restaurants, tables, themes, branches
// ---------------------------------------------------------------------------

const RESTAURANT_ID = 'rest-1';

const restaurantRow = {
  id: RESTAURANT_ID,
  slug: 'testo',
  name: 'مطعم الاختبار',
  nameEn: 'Test Restaurant',
  status: 'ACTIVE',
  businessType: 'RESTAURANT',
  logoUrl: null,
  logoFit: 'cover',
  logoPosition: '50% 50%',
  coverImageUrl: null,
  description: '',
  phone: '',
  address: '',
  currency: '₪',
  language: 'ar',
  timezone: 'Asia/Jerusalem',
  primaryColor: '#FF0000',
  accentColor: '#00FF00',
  promoVideoUrl: null,
  galleryImages: [],
  latitude: null,
  longitude: null,
  mapUrl: null,
  mapImageUrl: null,
  whatsappNumber: null,
  instagramUrl: null,
  facebookUrl: null,
  tiktokUrl: null,
  youtubeUrl: null,
  websiteUrl: null,
  transferBankName: null,
  transferBankAccount: null,
  transferBankAccountHolder: null,
  transferWalletName: null,
  transferWalletNumber: null,
  transferWalletAccountHolder: null,
  transferInstructions: null,
  displayBackgroundMode: 'theme',
  displayBackgroundImageUrl: null,
  displayFont: 'auto',
  categories: [],
  products: [],
  offers: [],
  tables: [],
};

// qrToken → table (the ONLY way a branch enters the catalog path)
const tablesByQrToken: Record<string, { branchId: string | null; restaurantId: string }> = {};
// branchId → theme row
let restaurantThemeRow: { config: Record<string, unknown> } | null = null;
let branchThemeRows: Record<string, { config: Record<string, unknown> }> = {};
let platformThemeRow: { config: Record<string, unknown> } | null = null;
let legacyColors = { primaryColor: '#FF0000', accentColor: '#00FF00' };

const mockRestaurantFindUnique = vi.fn(async () => restaurantRow);
const mockRestaurantFindFirst = vi.fn(async () => legacyColors);
const mockTableFindUnique = vi.fn(async ({ where }: any) => {
  if (where?.qrToken) return tablesByQrToken[where.qrToken] ?? null;
  return null;
});
const mockBranchFindFirst = vi.fn(async ({ where }: any) => {
  // Ownership check used by the resolver: branch must belong to the restaurant
  if (where?.restaurantId !== RESTAURANT_ID) return null;
  return { id: where.id };
});
const mockThemeFindFirst = vi.fn(async ({ where }: any) => {
  if (where.restaurantId === null && where.branchId === null) return platformThemeRow;
  if (where.restaurantId === RESTAURANT_ID && where.branchId === null) return restaurantThemeRow;
  if (where.restaurantId === RESTAURANT_ID && where.branchId) {
    return branchThemeRows[where.branchId] ?? null;
  }
  return null;
});

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    restaurant: {
      findUnique: (...args: any[]) => mockRestaurantFindUnique(...args),
      findFirst: (...args: any[]) => mockRestaurantFindFirst(...args),
    },
    table: {
      findUnique: (...args: any[]) => mockTableFindUnique(...args),
    },
    branch: {
      findFirst: (...args: any[]) => mockBranchFindFirst(...args),
    },
    theme: {
      findFirst: (...args: any[]) => mockThemeFindFirst(...args),
    },
  },
}));

let server: import('node:http').Server;
let baseUrl = '';

beforeAll(async () => {
  const { default: express } = await import('express');
  const { default: publicRouter } = await import('../../server/routes/public');
  const app = express();
  app.use(publicRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  Object.keys(tablesByQrToken).forEach((k) => delete tablesByQrToken[k]);
  restaurantThemeRow = null;
  branchThemeRows = {};
  platformThemeRow = null;
  legacyColors = { primaryColor: '#FF0000', accentColor: '#00FF00' };
});

async function fetchCatalog(query = ''): Promise<any> {
  const res = await fetch(`${baseUrl}/restaurants/testo${query}`);
  return res.json();
}

describe('Phase 3 — Branch Theme reaches the guest catalog via QR', () => {
  it('A. Branch without Theme → Restaurant Theme wins', async () => {
    restaurantThemeRow = {
      config: { colors: { primary: '#123456', secondary: '#654321', accent: '#654321' } },
    };
    tablesByQrToken['qr-a'] = { branchId: 'br-1', restaurantId: RESTAURANT_ID };

    const body = await fetchCatalog('?qrToken=qr-a');
    expect(body.success).toBe(true);
    expect(body.data.theme.colors.primary).toBe('#123456');
    expect(body.data.theme.source).toBe('restaurant');
  });

  it('B. Branch Theme overrides Restaurant Theme', async () => {
    restaurantThemeRow = {
      config: { colors: { primary: '#123456', secondary: '#654321', accent: '#654321' } },
    };
    branchThemeRows['br-1'] = { config: { colors: { primary: '#0000FF' } } };
    tablesByQrToken['qr-a'] = { branchId: 'br-1', restaurantId: RESTAURANT_ID };

    const body = await fetchCatalog('?qrToken=qr-a');
    expect(body.success).toBe(true);
    expect(body.data.theme.colors.primary).toBe('#0000FF');
    // Non-overridden values still inherit from the restaurant layer
    expect(body.data.theme.colors.secondary).toBe('#654321');
    expect(body.data.theme.source).toBe('branch');
  });

  it('C. No Branch + no Restaurant Theme → platform/legacy fallback (legacy preserved)', async () => {
    tablesByQrToken['qr-a'] = { branchId: 'br-1', restaurantId: RESTAURANT_ID };

    const body = await fetchCatalog('?qrToken=qr-a');
    expect(body.success).toBe(true);
    expect(body.data.theme.colors.primary).toBe('#FF0000'); // legacy primaryColor
    expect(body.data.theme.colors.accent).toBe('#00FF00'); // legacy accentColor
    expect(body.data.theme.source).toBe('fallback');
  });

  it('D. Two QRs for two branches → each guest gets its own branch theme (no caching/leakage)', async () => {
    restaurantThemeRow = {
      config: { colors: { primary: '#123456', secondary: '#654321', accent: '#654321' } },
    };
    branchThemeRows['br-a'] = { config: { colors: { primary: '#AAA001' } } };
    branchThemeRows['br-b'] = { config: { colors: { primary: '#BBB002' } } };
    tablesByQrToken['qr-a'] = { branchId: 'br-a', restaurantId: RESTAURANT_ID };
    tablesByQrToken['qr-b'] = { branchId: 'br-b', restaurantId: RESTAURANT_ID };

    const first = await fetchCatalog('?qrToken=qr-a');
    const second = await fetchCatalog('?qrToken=qr-b');
    const firstAgain = await fetchCatalog('?qrToken=qr-a');

    expect(first.data.theme.colors.primary).toBe('#AAA001');
    expect(first.data.theme.source).toBe('branch');
    expect(second.data.theme.colors.primary).toBe('#BBB002');
    expect(second.data.theme.source).toBe('branch');
    // Re-requesting branch A after branch B returns branch A again — no caching
    expect(firstAgain.data.theme.colors.primary).toBe('#AAA001');
    // Neither leaked into the other's inheritance chain
    expect(first.data.theme.colors.primary).not.toBe(second.data.theme.colors.primary);
  });

  it('security: a qrToken from ANOTHER venue never selects a branch here', async () => {
    restaurantThemeRow = {
      config: { colors: { primary: '#123456', secondary: '#654321', accent: '#654321' } },
    };
    branchThemeRows['br-1'] = { config: { colors: { primary: '#0000FF' } } };
    // Token belongs to a table of a DIFFERENT restaurant but names br-1:
    tablesByQrToken['qr-foreign'] = { branchId: 'br-1', restaurantId: 'other-rest' };

    const withForeign = await fetchCatalog('?qrToken=qr-foreign');
    const without = await fetchCatalog();

    // The foreign token must behave exactly like no token at all
    expect(withForeign.data.theme.colors.primary).toBe('#123456');
    expect(withForeign.data.theme.source).toBe('restaurant');
    expect(withForeign.data.theme.colors.primary).toBe(without.data.theme.colors.primary);
    expect(withForeign.data.theme.colors.primary).not.toBe('#0000FF');
  });

  it('security: an unknown/arbitrary qrToken resolves nothing (restaurant level only)', async () => {
    restaurantThemeRow = {
      config: { colors: { primary: '#123456', secondary: '#654321', accent: '#654321' } },
    };
    branchThemeRows['br-1'] = { config: { colors: { primary: '#0000FF' } } };

    const body = await fetchCatalog('?qrToken=does-not-exist');
    expect(body.success).toBe(true);
    expect(body.data.theme.colors.primary).toBe('#123456');
    expect(body.data.theme.source).toBe('restaurant');
  });

  it('no token at all keeps the pre-existing behaviour (restaurant theme)', async () => {
    restaurantThemeRow = {
      config: { colors: { primary: '#123456', secondary: '#654321', accent: '#654321' } },
    };
    const body = await fetchCatalog();
    expect(body.success).toBe(true);
    expect(body.data.theme.colors.primary).toBe('#123456');
    expect(body.data.theme.source).toBe('restaurant');
  });
});
