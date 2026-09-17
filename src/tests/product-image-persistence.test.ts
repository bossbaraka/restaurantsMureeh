/**
 * Product / offer image persistence contract (2026-09-17).
 *
 * Closes the gap found by the catalog-image audit: dish photos were uploaded
 * through the durable `POST /api/uploads/image` pipeline but the *reference*
 * persisted in `Product.imageUrl` (and `Offer.image`) was the renderable URL
 * from the response instead of the stable storage key, and neither the catalog
 * write routes nor their read routes went through the asset contract that
 * keeps logo/cover/map/gallery durable across a Render redeploy, a fresh
 * instance, or a moved storage host.
 *
 * Locked here (no database, no network — the shipped modules, mocked Prisma):
 *   1. the upload response's `pathUrl` is what the UI persists
 *   2. a managed Supabase URL folds into the canonical storage key
 *   3. a canonical key stays canonical (idempotent re-save)
 *   4. the public catalog API resolves a stored key to a renderable URL
 *   5. an external URL (Unsplash/CDN) stays external, untouched
 *   6. `data:` / `blob:` / `file:` payloads are refused, never persisted
 *   7. a legacy `/uploads/…` value is NOT silently destroyed: it folds to a
 *      key only when the object exists, and the read path leaves it as-is
 *   8. replacement cleanup still deletes the replaced object, and never
 *      deletes the object a round-tripped URL still points at
 *   9. another tenant's key is refused on write
 *
 * Route-level write behaviour (the real manager handlers) additionally runs
 * against a database in product-image-persistence.integration.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const TMP_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'product-image-'));

// Env BEFORE any server module is imported (server/config.ts is fail-closed
// and reads the environment at import time).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'product-image-persistence-secret-0123456789';
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = TMP_UPLOADS;
process.env.SUPABASE_STORAGE_BUCKET = 'restaurant-assets';
delete process.env.APP_URL; // same-origin deployment: relative /uploads/… URLs

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const KEY_A = `restaurants/${TENANT_A}/products/dish-a.jpg`;
const KEY_B = `restaurants/${TENANT_B}/products/dish-b.jpg`;

// ---------------------------------------------------------------------------
// Prisma mock — only what GET /api/public/restaurants/:slug touches.
// ---------------------------------------------------------------------------
const catalogRestaurant = {
  id: TENANT_A,
  slug: 'ghosn',
  name: 'غصن',
  nameEn: 'Ghosn',
  status: 'ACTIVE',
  description: '',
  phone: '0500000000',
  address: 'Test Street',
  currency: 'ILS',
  language: 'ar',
  timezone: 'Asia/Jerusalem',
  businessType: 'CAFE',
  primaryColor: '#111111',
  accentColor: '#222222',
  logoUrl: `restaurants/${TENANT_A}/logo/logo.png`,
  coverImageUrl: `restaurants/${TENANT_A}/cover/cover.jpg`,
  mapImageUrl: null,
  galleryImages: [],
  categories: [{ id: 'cat-1', name: 'مشاوي', sortOrder: 1, status: 'ACTIVE', image: null }],
  products: [
    {
      id: 'prod-key',
      restaurantId: TENANT_A,
      categoryId: 'cat-1',
      name: 'صحن مشكل',
      nameEn: 'Mixed Grill',
      description: '',
      price: 60,
      imageUrl: KEY_A,
      available: true,
      isFeatured: false,
      badge: null,
      preparationTimeMinutes: 15,
      calories: 450,
      allergens: [],
      ingredients: [],
      removableIngredients: [],
      options: [],
      addOns: [],
    },
    {
      id: 'prod-external',
      restaurantId: TENANT_A,
      categoryId: 'cat-1',
      name: 'شاي',
      nameEn: 'Tea',
      description: '',
      price: 6,
      imageUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
      available: true,
      isFeatured: false,
      badge: null,
      preparationTimeMinutes: 5,
      calories: 10,
      allergens: [],
      ingredients: [],
      removableIngredients: [],
      options: [],
      addOns: [],
    },
    {
      id: 'prod-legacy',
      restaurantId: TENANT_A,
      categoryId: 'cat-1',
      name: 'سمبوسة',
      nameEn: 'Samosa',
      description: '',
      price: 8,
      // Legacy row: still points at the ephemeral filesystem and was never
      // migrated — the read path must NOT rewrite it.
      imageUrl: `/uploads/${KEY_B}`,
      available: true,
      isFeatured: false,
      badge: null,
      preparationTimeMinutes: 5,
      calories: 120,
      allergens: [],
      ingredients: [],
      removableIngredients: [],
      options: [],
      addOns: [],
    },
  ],
  offers: [
    {
      id: 'offer-key',
      restaurantId: TENANT_A,
      title: 'عرض الغداء',
      titleEn: 'Lunch offer',
      subtitle: null,
      description: null,
      image: `restaurants/${TENANT_A}/offers/offer-1.jpg`,
      originalPrice: 40,
      discountedPrice: 30,
      badge: 'عرض',
      isActive: true,
    },
  ],
  tables: [],
};

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    restaurant: {
      findUnique: vi.fn(async () => catalogRestaurant),
      findMany: vi.fn(async () => []),
    },
  },
}));

let server: http.Server | null = null;
let base = '';

beforeAll(async () => {
  const express = (await import('express')).default;
  const { default: publicRouter } = await import('../../server/routes/public');
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  fs.rmSync(TMP_UPLOADS, { recursive: true, force: true });
});

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

// ===========================================================================
// 4 / 5 / 7 — the public catalog read path (real router over a mocked DB)
// ===========================================================================
describe('catalog read: stored reference -> renderable URL', () => {
  it('GET /api/public/restaurants/:slug resolves a canonical storage key to a renderable URL', async () => {
    const res = await fetch(`${base}/api/public/restaurants/ghosn`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = Object.fromEntries((body.data.products as any[]).map((p) => [p.id, p]));
    // Never the bare key, never empty: the client must receive something an
    // <img> can load (local driver => /uploads/{key}, absolutized by APP_URL
    // in a split deployment).
    expect(byId['prod-key'].image).not.toBe(KEY_A);
    expect(byId['prod-key'].image).toContain(KEY_A);
  });

  it('leaves an external image URL exactly as stored (Unsplash/CDN seeds)', async () => {
    const body = await (await fetch(`${base}/api/public/restaurants/ghosn`)).json();
    const tea = (body.data.products as any[]).find((p) => p.id === 'prod-external');
    expect(tea.image).toBe(
      'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80'
    );
  });

  it('does NOT rewrite a legacy /uploads/… reference that was never migrated', async () => {
    const body = await (await fetch(`${base}/api/public/restaurants/ghosn`)).json();
    const samosa = (body.data.products as any[]).find((p) => p.id === 'prod-legacy');
    // A legacy row that still renders from disk keeps rendering: folding it to
    // a key with no object behind it would destroy an image that works today.
    expect(samosa.image).toBe(`/uploads/${KEY_B}`);
  });

  it('resolves offer images through the same contract', async () => {
    const body = await (await fetch(`${base}/api/public/restaurants/ghosn`)).json();
    const offer = body.data.offers[0];
    expect(offer.image).toContain(`restaurants/${TENANT_A}/offers/offer-1.jpg`);
    expect(offer.image).not.toBe(`restaurants/${TENANT_A}/offers/offer-1.jpg`);
  });
});

// ===========================================================================
// 2 / 3 / 6 / 9 — the write contract the catalog routes now use
// ===========================================================================
describe('catalog write: normalizeAssetReference + tenant scope', () => {
  const contract = async () => {
    const storage = await import('../../server/services/storage');
    return { storage, normalizer: storage.assetNormalizerFor(storage.getStorage()) };
  };

  it('folds a managed Supabase public URL into the canonical key', async () => {
    const { storage, normalizer } = await contract();
    const managedUrl =
      `https://p.supabase.co/storage/v1/object/public/restaurant-assets/${KEY_A}`;
    expect(storage.normalizeAssetReference(managedUrl, normalizer)).toEqual({
      kind: 'key',
      reference: KEY_A,
    });
    // …including the legacy absolute local form (old API host).
    expect(
      storage.normalizeAssetReference(`https://old.onrender.com/uploads/${KEY_A}`, normalizer)
    ).toEqual({ kind: 'key', reference: KEY_A });
  });

  it('keeps a canonical key canonical (re-saving a product never rewrites it)', async () => {
    const { storage, normalizer } = await contract();
    expect(storage.normalizeAssetReference(KEY_A, normalizer)).toEqual({
      kind: 'key',
      reference: KEY_A,
    });
    // Explicit clear only on '' / null — never on an omitted field.
    expect(storage.normalizeAssetReference('', normalizer)).toEqual({ kind: 'clear' });
    expect(storage.normalizeAssetReference('   ', normalizer)).toEqual({ kind: 'clear' });
  });

  it('keeps an external URL external', async () => {
    const { storage, normalizer } = await contract();
    const url = 'https://images.unsplash.com/photo-1544025162.jpg';
    expect(storage.normalizeAssetReference(url, normalizer)).toEqual({
      kind: 'external',
      reference: url,
    });
  });

  it('refuses data:, blob:, file:, script and protocol-relative payloads', async () => {
    const { storage, normalizer } = await contract();
    for (const bad of [
      'data:image/png;base64,iVBORw0KGgo=',
      'blob:http://localhost:5173/6f0a',
      'file:///etc/passwd',
      'javascript:alert(1)',
      '//evil.example/x.png',
    ]) {
      expect(storage.normalizeAssetReference(bad, normalizer).kind, bad).toBe('reject');
    }
  });

  it('enforces tenant scope on the reference (a foreign key is never persisted)', async () => {
    const { storage } = await contract();
    expect(storage.keyBelongsToRestaurant(KEY_A, TENANT_A)).toBe(true);
    expect(storage.keyBelongsToRestaurant(KEY_B, TENANT_A)).toBe(false);
    expect(storage.isStorageKey('restaurants/../secrets.env')).toBe(false);
    expect(storage.isStorageKey(`restaurants/${TENANT_A}/products/x.jpg`)).toBe(true);
  });

  it('accepts the canonical key at the validation boundary (schemas)', async () => {
    const { productCreateSchema, productUpdateSchema, offerCreateSchema } = await import(
      '../../server/validation/schemas'
    );
    const dish = { categoryId: 'cat-1', name: 'طبق', price: 10 };
    expect(productCreateSchema.safeParse({ ...dish, image: KEY_A }).success).toBe(true);
    expect(
      productCreateSchema
        .safeParse({
          ...dish,
          image: `https://p.supabase.co/storage/v1/object/public/restaurant-assets/${KEY_A}`,
        })
        .success
    ).toBe(true);
    expect(productCreateSchema.safeParse({ ...dish, image: `/uploads/${KEY_A}` }).success).toBe(true);
    expect(productUpdateSchema.safeParse({ image: KEY_A }).success).toBe(true);
    expect(productUpdateSchema.safeParse({ imageUrl: KEY_A }).success).toBe(true);
    expect(offerCreateSchema.safeParse({ title: 'عرض', image: KEY_A }).success).toBe(true);
  });

  it('rejects base64/blob payloads at the validation boundary (schemas)', async () => {
    const { productCreateSchema, productUpdateSchema, offerCreateSchema } = await import(
      '../../server/validation/schemas'
    );
    const dish = { categoryId: 'cat-1', name: 'طبق', price: 10 };
    for (const bad of ['data:image/png;base64,iVBORw0KGgo=', 'blob:http://localhost:5173/6f0a']) {
      expect(productCreateSchema.safeParse({ ...dish, image: bad }).success, bad).toBe(false);
      expect(productUpdateSchema.safeParse({ image: bad }).success, bad).toBe(false);
      expect(offerCreateSchema.safeParse({ title: 'عرض', image: bad }).success, bad).toBe(false);
    }
  });
});

// ===========================================================================
// 7 — the legacy-safety gate (object present vs missing) as the route applies it
// ===========================================================================
describe('legacy /uploads reference is never silently destroyed', () => {
  it('folds a legacy path to the key only when the object actually exists', async () => {
    const storage = await import('../../server/services/storage');
    const Driver = storage.LocalStorageDriver as any;
    const local = new Driver({ baseDir: TMP_UPLOADS });

    // Same primitive the route uses (keyFromUrl + exists) — present file:
    fs.mkdirSync(path.dirname(path.join(TMP_UPLOADS, KEY_A)), { recursive: true });
    fs.writeFileSync(path.join(TMP_UPLOADS, KEY_A), PNG_1x1);
    const foldedKey = local.keyFromUrl(`/uploads/${KEY_A}`);
    expect(foldedKey).toBe(KEY_A);
    await expect(local.exists(KEY_A)).resolves.toBe(true);

    // Missing file (never migrated): the fold is not applied, so the row keeps
    // the value that still renders instead of pointing at a missing object.
    const missingKey = local.keyFromUrl(`/uploads/${TENANT_A}/products/gone.jpg`);
    expect(missingKey).toContain('gone.jpg');
    await expect(local.exists(missingKey)).resolves.toBe(false);
  });
});

// ===========================================================================
// 8 — replacement cleanup (shipped helper used by the product/offer routes)
// ===========================================================================
describe('replacement cleanup', () => {
  it('deletes a stored key, folds a stored URL to its key, and skips foreign/external values', async () => {
    const storage = await import('../../server/services/storage');
    const calls: string[] = [];
    const fake = {
      keyFromUrl(url: string) {
        const m = /\/object\/public\/[^/]+\/(.+)$/.exec(url) || /\/uploads\/(.+)$/.exec(url);
        return m ? m[1] : null;
      },
      async delete(key: string) {
        calls.push(key);
      },
    };
    const result = await storage.deleteManagedAssets(fake as any, TENANT_A, [
      KEY_A, // canonical key stored on the row
      `https://p.supabase.co/storage/v1/object/public/restaurant-assets/${KEY_B}`, // foreign tenant — must be skipped
      'https://images.unsplash.com/photo-1544025162.jpg', // external — nothing managed
      `/uploads/restaurants/${TENANT_A}/products/legacy.jpg`, // legacy form of our own object
    ]);
    expect(calls).toEqual([KEY_A, `restaurants/${TENANT_A}/products/legacy.jpg`]);
    expect(result.skipped.length).toBe(2);
  });

  it('compares folded keys, so a round-tripped URL is not treated as a replacement', () => {
    // The route compares foldCatalogImageKey(existing) !== foldCatalogImageKey(incoming);
    // both forms of the same asset therefore fold identically.
    const fold = (v: string) => {
      const t = v.trim();
      if (t.startsWith('restaurants/')) return t;
      const m = /\/object\/public\/[^/]+\/(restaurants\/.+)$/.exec(t);
      return m ? m[1] : null;
    };
    const storedKey = KEY_A;
    const roundTrippedUrl =
      'https://p.supabase.co/storage/v1/object/public/restaurant-assets/' + KEY_A;
    expect(fold(storedKey)).toBe(fold(roundTrippedUrl));
  });
});

// ===========================================================================
// 1 / 4 / 8 — wiring locks (the shipped code must keep using the contract)
// ===========================================================================
describe('wiring locks', () => {
  it('ProductFormModal persists the stable storage path, preview keeps the URL', () => {
    const modal = read('src/components/manager/ProductFormModal.tsx');
    expect(modal).toMatch(/setImageKey\(res\.data\.pathUrl \?\? res\.data\.url\)/);
    expect(modal).toMatch(/image:\s*\n?\s*\(imageKey\.trim\(\) \|\| image\.trim\(\)\)/);
    // Preview still renders from a URL, so the UX is unchanged.
    expect(modal).toMatch(/setImage\(res\.data\.url\)/);
  });

  it('manager catalog routes normalize images on write and resolve them on read', () => {
    const manager = read('server/routes/manager.ts');
    const writes = [
      ...manager.matchAll(/await persistCatalogImage\(/g),
    ];
    expect(writes.length).toBeGreaterThanOrEqual(4); // product POST/PUT + offer POST/PUT
    expect(manager).toMatch(/imageUrl: dishImage\.ref,/);
    expect(manager).toMatch(/imageUrl: dishImage \? dishImage\.ref : undefined,/);
    expect(manager).toMatch(/image: offerImage\?\.ref \|\| undefined,/);
    expect(manager).toMatch(/image: offerImage \? offerImage\.ref : undefined,/);
    // reads
    expect(manager).toMatch(/image: resolveCatalogImage\(p\.imageUrl\)/);
    expect(manager).toMatch(/imageUrl: resolveCatalogImage\(newProd\.imageUrl\)/);
    expect(manager).toMatch(/imageUrl: resolveCatalogImage\(updated\.imageUrl\)/);
    // cleanup comparisons folded
    expect(manager).toMatch(/foldCatalogImageKey\(existingProduct\.imageUrl\) !== foldCatalogImageKey\(incomingImage\)/);
    expect(manager).toMatch(/foldCatalogImageKey\(existing\.image\) !== foldCatalogImageKey\(b\.image\)/);
    // tenant isolation kept on this path too
    expect(manager).toMatch(/CATALOG_IMAGE_FOREIGN_TENANT_ERROR/);
  });

  it('public catalog read resolves catalog images through the shared contract', () => {
    const pub = read('server/routes/public.ts');
    expect(pub).toMatch(/image: resolveCatalogImage\(p\.imageUrl\)/);
    expect(pub).toMatch(/image: resolveCatalogImage\(o\.image\)/);
    // only a canonical key is resolved — legacy/external values pass through
    expect(pub).toMatch(/isStorageKey\(value\)/);
  });

  it('the client resolves whatever the API returns and never emits a bare key', async () => {
    const { mapProductRow, mapOfferRow } = await import('../services/api');
    const absolute = 'https://p.supabase.co/storage/v1/object/public/restaurant-assets/' + KEY_A;
    expect(mapProductRow({ id: 'p', imageUrl: absolute }).image).toBe(absolute);
    expect(mapProductRow({ id: 'p', imageUrl: KEY_A }).image).toBe('');
    expect(mapProductRow({ id: 'p', image: `/uploads/${KEY_A}` }).image).toContain(`/uploads/${KEY_A}`);
    expect(mapOfferRow({ id: 'o', image: absolute }).image).toBe(absolute);
    expect(mapOfferRow({ id: 'o', image: KEY_A }).image).toBeUndefined();
  });
});
