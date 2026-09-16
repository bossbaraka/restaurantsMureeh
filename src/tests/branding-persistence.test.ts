import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ============================================================================
// Focused regression suite — restaurant image & theme PERSISTENCE.
//
// Guards the exact production failure modes where a tenant's images or
// branding disappeared / reset after a Render restart or redeploy, a customer
// QR entry, an admin tenant switch, or a partial restaurant API payload:
//
//   1. storage driver inference (Supabase creds present => supabase)
//   2. public asset bucket ensured idempotently during storage readiness
//   3. universal asset normalization (legacy /uploads, host-prefixed,
//      Supabase public URL, canonical key, external URL untouched)
//   4. QR GET + QR session payloads carry the complete visual identity
//   5. createTableSession maps that identity (no default-gold reset)
//   6. resolveRestaurantAssets keeps every valid reference
//   7. partial identity payload merges into existing state (never erases)
//   8. bare `/` never starts a customer entry run
//   9. seeds never overwrite custom logo/cover assets
//
// Env is fixed BEFORE server modules load (server/config.ts is fail-closed
// and reads env at import time). No network, no database: Prisma is mocked.
// ============================================================================

const TMP_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'branding-persist-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'branding-persistence-test-secret-0123456789';
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = TMP_UPLOADS;
process.env.SUPABASE_STORAGE_BUCKET = 'restaurant-assets';
delete process.env.APP_URL;

// ---------------------------------------------------------------------------
// Prisma mock — only what the two QR endpoints touch.
// ---------------------------------------------------------------------------
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const brandedRestaurant = {
  id: TENANT_ID,
  slug: 'ghosn',
  name: 'غصن',
  nameEn: 'Ghosn',
  status: 'ACTIVE',
  businessType: 'CAFE',
  logoUrl: `restaurants/${TENANT_ID}/logo/logo-1.png`,
  coverImageUrl: `restaurants/${TENANT_ID}/cover/cover-1.jpg`,
  mapImageUrl: null,
  galleryImages: [],
  logoFit: 'contain',
  logoPosition: '20% 80%',
  primaryColor: '#123456',
  accentColor: '#654321',
};
const table = {
  id: 'table-1',
  number: 7,
  name: 'T7',
  capacity: 4,
  zone: 'A',
  status: 'AVAILABLE',
  qrToken: 'qr-token-abc',
  restaurant: brandedRestaurant,
};

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    table: {
      findUnique: vi.fn(async ({ where }: { where: { qrToken: string } }) =>
        where.qrToken === table.qrToken ? table : null
      ),
    },
    tableSession: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'session-1',
        ...data,
      })),
    },
  },
}));

// ---------------------------------------------------------------------------
// Real HTTP server over the REAL public router (no source-text matching).
// ---------------------------------------------------------------------------
let server: http.Server | null = null;
let base = '';

async function startPublicRouter() {
  const express = (await import('express')).default;
  const { default: publicRouter } = await import('../../server/routes/public');
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  await startPublicRouter();
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  fs.rmSync(TMP_UPLOADS, { recursive: true, force: true });
});

// ===========================================================================
// 1. Storage driver inference
// ===========================================================================
describe('storage driver resolution (Render ephemeral filesystem)', () => {
  const VALID_SECRET = 'x'.repeat(40);
  const saved = { ...process.env };

  async function loadConfig() {
    vi.resetModules();
    return vi.importActual('../../server/config.ts') as Promise<any>;
  }

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in saved)) delete process.env[k];
    }
    Object.assign(process.env, saved);
    vi.resetModules();
  });

  it('infers supabase when both credentials exist and STORAGE_DRIVER is unset', async () => {
    delete process.env.STORAGE_DRIVER;
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://mureeh.example';
    process.env.DATABASE_URL = 'postgresql://u:p@db.internal:5432/app';
    process.env.JWT_SECRET = VALID_SECRET;
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('supabase');
  });

  it('honours an explicit STORAGE_DRIVER over inference', async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = VALID_SECRET;
    process.env.STORAGE_DRIVER = 'local';
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('local');
  });

  it('keeps the existing local default when no credentials exist', async () => {
    delete process.env.STORAGE_DRIVER;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = VALID_SECRET;
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('local');
  });

  it('does not infer supabase from only one of the two credentials', async () => {
    delete process.env.STORAGE_DRIVER;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = VALID_SECRET;
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('local');
  });
});

// ===========================================================================
// 2. Public bucket readiness
// ===========================================================================
describe('SupabaseStorageDriver public bucket readiness', () => {
  function fakeAdapter(calls: Array<{ name: string; isPublic?: boolean }>) {
    return {
      async upload() {},
      async remove() {},
      getPublicUrl: (key: string) =>
        `https://project.supabase.co/storage/v1/object/public/restaurant-assets/${key}`,
      async listNames() {
        return [] as string[];
      },
      async download() {
        return null;
      },
      async ensureBucket(name: string, isPublic?: boolean) {
        calls.push({ name, isPublic });
      },
    };
  }

  it('ensurePublicBucket() creates restaurant-assets as PUBLIC, idempotently', async () => {
    const { SupabaseStorageDriver } = await import('../../server/services/storage/supabase');
    const calls: Array<{ name: string; isPublic?: boolean }> = [];
    const driver = new SupabaseStorageDriver(
      { url: 'https://project.supabase.co', serviceRoleKey: 'k', bucket: 'restaurant-assets' },
      fakeAdapter(calls),
      'payment-proofs',
      fakeAdapter([])
    );
    await driver.ensurePublicBucket();
    await driver.ensurePublicBucket();
    expect(calls).toEqual([
      { name: 'restaurant-assets', isPublic: true },
      { name: 'restaurant-assets', isPublic: true },
    ]);
  });

  it('receipt bucket stays PRIVATE (ensureReady unchanged)', async () => {
    const { SupabaseStorageDriver } = await import('../../server/services/storage/supabase');
    const privateCalls: Array<{ name: string; isPublic?: boolean }> = [];
    const driver = new SupabaseStorageDriver(
      { url: 'https://project.supabase.co', serviceRoleKey: 'k', bucket: 'restaurant-assets' },
      fakeAdapter([]),
      'payment-proofs',
      fakeAdapter(privateCalls)
    );
    const ready = await driver.ensureReady();
    expect(ready.ok).toBe(true);
    expect(privateCalls).toEqual([{ name: 'payment-proofs', isPublic: false }]);
  });

  it('verifyStorageReady wires ensurePublicBucket for supabase and stays a no-op for local', async () => {
    const storage = await import('../../server/services/storage');
    // Source contract for the supabase branch (the singleton is built from
    // config, so the supabase driver cannot be injected without credentials).
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../server/services/storage/index.ts'),
      'utf8'
    );
    const body = src.slice(src.indexOf('export async function verifyStorageReady'));
    expect(body).toContain('instanceof SupabaseStorageDriver');
    expect(body).toContain('ensurePublicBucket()');
    // Local driver path: readiness still succeeds with no bucket call.
    storage.resetStorageForTests();
    const local = await storage.verifyStorageReady();
    expect(local.ok).toBe(true);
  });
});

// ===========================================================================
// 3. Universal asset normalization
// ===========================================================================
describe('assetNormalizerFor — universal key recovery', () => {
  const KEY = `restaurants/${TENANT_ID}/logo/abc.png`;

  async function normalizers() {
    const storage = await import('../../server/services/storage');
    const local = new storage.LocalStorageDriver({ baseDir: TMP_UPLOADS });
    const supa = new storage.SupabaseStorageDriver(
      { url: 'https://project.supabase.co', serviceRoleKey: 'k', bucket: 'restaurant-assets' },
      {
        async upload() {},
        async remove() {},
        getPublicUrl: (key: string) =>
          `https://project.supabase.co/storage/v1/object/public/restaurant-assets/${key}`,
        async listNames() {
          return [];
        },
        async download() {
          return null;
        },
        async ensureBucket() {},
      },
      'payment-proofs',
      {
        async upload() {},
        async remove() {},
        getPublicUrl: () => '',
        async listNames() {
          return [];
        },
        async download() {
          return null;
        },
        async ensureBucket() {},
      }
    );
    return {
      local: storage.assetNormalizerFor(local),
      supabase: storage.assetNormalizerFor(supa),
    };
  }

  it('Supabase public URL -> canonical key (under either active driver)', async () => {
    const n = await normalizers();
    const url = `https://project.supabase.co/storage/v1/object/public/restaurant-assets/${KEY}`;
    expect(n.supabase.keyFromUrl(url)).toBe(KEY);
    expect(n.local.keyFromUrl(url)).toBe(KEY); // rows written before the migration
    expect(n.local.keyFromUrl(`${url}?t=123`)).toBe(KEY);
  });

  it('/uploads/... and https://host/uploads/... -> canonical key (even under supabase)', async () => {
    const n = await normalizers();
    expect(n.supabase.keyFromUrl(`/uploads/${KEY}`)).toBe(KEY);
    expect(n.supabase.keyFromUrl(`https://api.mureeh.example/uploads/${KEY}`)).toBe(KEY);
    expect(n.supabase.keyFromUrl(`https://old-host.onrender.com/uploads/${KEY}?v=2`)).toBe(KEY);
    expect(n.local.keyFromUrl(`/uploads/${KEY}`)).toBe(KEY);
  });

  it('canonical restaurants/... key stays canonical', async () => {
    const n = await normalizers();
    expect(n.local.keyFromUrl(KEY)).toBe(KEY);
    expect(n.supabase.keyFromUrl(KEY)).toBe(KEY);
    expect(n.supabase.keyFromUrl(`/${KEY}`)).toBe(KEY);
  });

  it('unrelated external URLs remain external/unresolved', async () => {
    const n = await normalizers();
    const externals = [
      'https://images.unsplash.com/photo-1501339847302?auto=format&w=400',
      'https://cdn.example.com/restaurants/other/logo.png', // looks tenant-ish but is not managed
      'https://evil.example/object/public/restaurant-assets/../../etc/passwd',
      '/uploads/../secret',
      'data:image/png;base64,AAAA',
      '',
    ];
    for (const value of externals) {
      expect(n.local.keyFromUrl(value), value).toBeNull();
      expect(n.supabase.keyFromUrl(value), value).toBeNull();
    }
  });

  it('normalizeAssetReference / resolveAssetReference round-trip legacy shapes', async () => {
    const storage = await import('../../server/services/storage');
    const n = (await normalizers()).supabase;
    const toUrl = (k: string) =>
      `https://project.supabase.co/storage/v1/object/public/restaurant-assets/${k}`;
    expect(storage.normalizeAssetReference(`/uploads/${KEY}`, n)).toEqual({ kind: 'key', reference: KEY });
    expect(storage.normalizeAssetReference('https://images.unsplash.com/x.jpg', n)).toEqual({
      kind: 'external',
      reference: 'https://images.unsplash.com/x.jpg',
    });
    expect(storage.resolveAssetReference(`https://old.host/uploads/${KEY}`, n, toUrl)).toEqual({
      reference: KEY,
      url: toUrl(KEY),
    });
  });
});

// ===========================================================================
// 4. QR GET + QR session payloads
// ===========================================================================
const REQUIRED_IDENTITY = {
  primaryColor: '#123456',
  accentColor: '#654321',
  logoFit: 'contain',
  logoPosition: '20% 80%',
  businessType: 'CAFE',
  logo: `/uploads/${brandedRestaurant.logoUrl}`,
  coverImage: `/uploads/${brandedRestaurant.coverImageUrl}`,
};

describe('customer QR endpoints carry the complete visual identity', () => {
  it('GET /api/public/tables/qr/:qrToken', async () => {
    const res = await fetch(`${base}/api/public/tables/qr/${table.qrToken}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { restaurant: Record<string, unknown> } };
    expect(body.data.restaurant).toMatchObject({
      id: TENANT_ID,
      slug: 'ghosn',
      ...REQUIRED_IDENTITY,
    });
  });

  it('POST /api/public/tables/qr/:qrToken/session', async () => {
    const res = await fetch(`${base}/api/public/tables/qr/${table.qrToken}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { sessionToken: string; restaurant: Record<string, unknown> };
    };
    expect(body.data.sessionToken).toBeTruthy();
    expect(body.data.restaurant).toMatchObject({
      id: TENANT_ID,
      slug: 'ghosn',
      ...REQUIRED_IDENTITY,
    });
  });
});

// (5. Frontend createTableSession mapping lives in
//  branding-persistence.client.test.ts — it needs a jsdom `window`.)

// ===========================================================================
// 6. resolveRestaurantAssets keeps every valid reference
// ===========================================================================
describe('resolveRestaurantAssets', () => {
  it('resolves logo, cover, map and gallery without losing references', async () => {
    const storage = await import('../../server/services/storage');
    const local = new storage.LocalStorageDriver({ baseDir: TMP_UPLOADS });
    const n = storage.assetNormalizerFor(local);
    const toUrl = storage.assetUrlResolverFor(local, 'https://api.mureeh.example');
    const row = {
      logoUrl: `restaurants/${TENANT_ID}/logo/l.png`,
      coverImageUrl: `https://project.supabase.co/storage/v1/object/public/restaurant-assets/restaurants/${TENANT_ID}/cover/c.jpg`,
      mapImageUrl: `/uploads/restaurants/${TENANT_ID}/map/m.png`,
      galleryImages: [
        `https://old.onrender.com/uploads/restaurants/${TENANT_ID}/gallery/g1.jpg`,
        'https://images.unsplash.com/photo-1?w=800',
      ],
    };
    const out = storage.resolveRestaurantAssets(row, n, toUrl);
    expect(out.logoStoragePath).toBe(row.logoUrl);
    expect(out.logoUrl).toBe(`https://api.mureeh.example/uploads/${row.logoUrl}`);
    expect(out.coverStoragePath).toBe(`restaurants/${TENANT_ID}/cover/c.jpg`);
    expect(out.coverImageUrl).toBe(`https://api.mureeh.example/uploads/restaurants/${TENANT_ID}/cover/c.jpg`);
    expect(out.mapStoragePath).toBe(`restaurants/${TENANT_ID}/map/m.png`);
    expect(out.mapImageUrl).toBe(`https://api.mureeh.example/uploads/restaurants/${TENANT_ID}/map/m.png`);
    expect(out.galleryStoragePaths).toEqual([
      `restaurants/${TENANT_ID}/gallery/g1.jpg`,
      'https://images.unsplash.com/photo-1?w=800',
    ]);
    expect(out.galleryImages).toEqual([
      `https://api.mureeh.example/uploads/restaurants/${TENANT_ID}/gallery/g1.jpg`,
      'https://images.unsplash.com/photo-1?w=800',
    ]);
  });
});

// ===========================================================================
// 7. Context merge — partial identity never erases branding
// ===========================================================================
describe('mergeRestaurantIdentity (RestaurantContext onIdentity)', () => {
  const existing = {
    id: TENANT_ID,
    name: 'غصن',
    slug: 'ghosn',
    logo: 'https://x/logo.png',
    coverImage: 'https://x/cover.jpg',
    primaryColor: '#123456',
    accentColor: '#654321',
    logoFit: 'contain',
    logoPosition: '20% 80%',
    galleryImages: ['https://x/g1.jpg'],
    mapImageUrl: 'https://x/map.png',
  };

  it('existing branding + partial identity payload = branding intact', async () => {
    const { mergeRestaurantIdentity } = await import('../services/customerEntry');
    const merged = mergeRestaurantIdentity(existing, {
      id: TENANT_ID,
      name: 'غصن',
      slug: 'ghosn',
      logo: 'https://x/logo-v2.png',
      // typical partial payload: theme fields absent / emptied by a mapper
      coverImage: undefined,
      galleryImages: [],
      primaryColor: '',
    } as Partial<typeof existing>);
    expect(merged).toEqual({ ...existing, logo: 'https://x/logo-v2.png' });
  });

  it('updates fields that are present, keeps the rest, replaces on a different tenant', async () => {
    const { mergeRestaurantIdentity } = await import('../services/customerEntry');
    const updated = mergeRestaurantIdentity(existing, { id: TENANT_ID, primaryColor: '#000000' });
    expect(updated.primaryColor).toBe('#000000');
    expect(updated.accentColor).toBe('#654321');
    expect(updated.coverImage).toBe('https://x/cover.jpg');

    const other = mergeRestaurantIdentity(existing, { id: 'other', name: 'Other' } as Partial<typeof existing>);
    expect(other).toEqual({ id: 'other', name: 'Other' });

    const fresh = mergeRestaurantIdentity(null, { id: TENANT_ID, name: 'x' } as Partial<typeof existing>);
    expect(fresh).toEqual({ id: TENANT_ID, name: 'x' });
  });

  it('RestaurantContext.onIdentity merges instead of replacing', () => {
    const ctx = fs.readFileSync(path.resolve(__dirname, '../context/RestaurantContext.tsx'), 'utf8');
    const onIdentity = ctx.slice(ctx.indexOf('onIdentity: (restaurant) =>'), ctx.indexOf('onIdentity: (restaurant) =>') + 400);
    expect(onIdentity).toContain('mergeRestaurantIdentity(prev');
    expect(onIdentity).not.toMatch(/setCurrentRestaurant\(restaurant as unknown as Restaurant\)/);
  });
});

// ===========================================================================
// 8. Root entry — bare `/` never starts customer entry
// ===========================================================================
describe('customer entry URL parsing', () => {
  it('bare / yields no slug and no qr token (no customer entry)', async () => {
    const { parseCustomerEntryUrl } = await import('../services/customerEntry');
    expect(parseCustomerEntryUrl({ pathname: '/', search: '' })).toEqual({ slug: '', qrToken: '' });
    expect(parseCustomerEntryUrl({ pathname: '', search: '' })).toEqual({ slug: '', qrToken: '' });
    expect(parseCustomerEntryUrl(null)).toEqual({ slug: '', qrToken: '' });
  });

  it('/r/{slug} and QR routes still start correctly', async () => {
    const { parseCustomerEntryUrl } = await import('../services/customerEntry');
    expect(parseCustomerEntryUrl({ pathname: '/r/ghosn', search: '' })).toEqual({ slug: 'ghosn', qrToken: '' });
    expect(parseCustomerEntryUrl({ pathname: '/r/Ghosn', search: '?qr=tok-1' })).toEqual({
      slug: 'ghosn',
      qrToken: 'tok-1',
    });
    expect(parseCustomerEntryUrl({ pathname: '/', search: '?qr=tok-2' })).toEqual({ slug: '', qrToken: 'tok-2' });
    expect(parseCustomerEntryUrl({ pathname: '/', search: '?r=marer' })).toEqual({ slug: 'mureeh', qrToken: '' });
  });

  it('the mount effect guards on slug OR qrToken', () => {
    const ctx = fs.readFileSync(path.resolve(__dirname, '../context/RestaurantContext.tsx'), 'utf8');
    expect(ctx).toContain('if (slug || qrToken) {');
    expect(ctx).not.toContain("const slug = rawSlug || 'mureeh'");
    expect(ctx).not.toContain("return { slug: 'mureeh', qrToken: '' }");
  });

  it('a QR-only link resolves the catalog from the session venue, never a default slug', async () => {
    const { runCustomerEntry } = await import('../services/customerEntry');
    const catalogCalls: string[] = [];
    const sessionCalls: Array<string | undefined> = [];
    const outcome = await runCustomerEntry(
      { slug: '', qrToken: 'tok-1' },
      {
        async createTableSession(token, slug) {
          sessionCalls.push(slug);
          return {
            success: true,
            statusCode: 200,
            data: {
              session: { id: 's', sessionToken: 't' },
              table: { id: 'table-1', tableNumber: 7 },
              restaurant: { id: TENANT_ID, slug: 'ghosn' },
            },
          };
        },
        async getCatalog(slug) {
          catalogCalls.push(slug);
          return {
            success: true,
            statusCode: 200,
            data: { restaurant: { id: TENANT_ID }, categories: [], products: [], offers: [] },
          };
        },
      },
      { isStale: () => false, wait: async () => {} }
    );
    expect(outcome.outcome).toBe('READY');
    expect(sessionCalls).toEqual([undefined]);
    expect(catalogCalls).toEqual(['ghosn']);
  });
});

// ===========================================================================
// 8b. Tenant switching — admin overview / manager dashboard payloads
// ===========================================================================
describe('tenant switching payloads keep the visual identity', () => {
  it('admin overview restaurant entries carry the branding fields', () => {
    const admin = fs.readFileSync(path.resolve(__dirname, '../../server/routes/admin.ts'), 'utf8');
    const block = admin.slice(admin.indexOf("router.get('/overview'"), admin.indexOf('subscriptions,\n        plans:'));
    for (const field of [
      'primaryColor: r.primaryColor',
      'accentColor: r.accentColor',
      'logoFit: r.logoFit',
      'logoPosition: r.logoPosition',
      'businessType: r.businessType',
      'description: r.description',
      'phone: r.phone',
      'address: r.address',
      'galleryImages: assets.galleryImages',
      'mapImageUrl: assets.mapImageUrl',
    ]) {
      expect(block, field).toContain(field);
    }
  });

  it('manager dashboard restaurant payload carries the branding fields', () => {
    const manager = fs.readFileSync(path.resolve(__dirname, '../../server/routes/manager.ts'), 'utf8');
    const start = manager.indexOf('const dashboardRestaurant = resolveRestaurantAssets(');
    const block = manager.slice(start, manager.indexOf('subscription: restaurant.subscription', start));
    for (const field of [
      'description: restaurant.description',
      'phone: restaurant.phone',
      'address: restaurant.address',
      'logoFit: restaurant.logoFit',
      'logoPosition: restaurant.logoPosition',
      'businessType: restaurant.businessType',
      'galleryImages: dashboardRestaurant.galleryImages',
      'mapImageUrl: dashboardRestaurant.mapImageUrl',
      'promoVideoUrl: restaurant.promoVideoUrl',
    ]) {
      expect(block, field).toContain(field);
    }
  });

  it('mapRestaurantRow keeps a full admin payload branding-complete (no partial replacement)', async () => {
    const { mapRestaurantRow } = await import('../services/api');
    const mapped = mapRestaurantRow({
      id: TENANT_ID,
      name: 'غصن',
      slug: 'ghosn',
      logo: '/uploads/restaurants/x/logo/l.png',
      coverImage: '/uploads/restaurants/x/cover/c.jpg',
      primaryColor: '#123456',
      accentColor: '#654321',
      logoFit: 'contain',
      logoPosition: '20% 80%',
      businessType: 'CAFE',
      galleryImages: ['/uploads/restaurants/x/gallery/g.jpg'],
      mapImageUrl: '/uploads/restaurants/x/map/m.png',
      status: 'ACTIVE',
    });
    expect(mapped.primaryColor).toBe('#123456');
    expect(mapped.accentColor).toBe('#654321');
    expect(mapped.logoFit).toBe('contain');
    expect(mapped.logoPosition).toBe('20% 80%');
    expect(mapped.coverImage).toContain('/cover/c.jpg');
    expect(mapped.galleryImages).toHaveLength(1);
    expect(mapped.mapImageUrl).toContain('/map/m.png');
  });
});

// ===========================================================================
// 9. Seeds never overwrite custom assets
// ===========================================================================
describe('seed safety', () => {
  for (const file of ['seed-shoqrah.ts', 'seed-ghosn.ts']) {
    it(`${file} keeps existing logoUrl / coverImageUrl`, () => {
      const src = fs.readFileSync(path.resolve(__dirname, `../../server/db/${file}`), 'utf8');
      const updateBlock = src.slice(src.indexOf('} else {\n    // Never overwrite custom production assets'));
      const stmt = updateBlock.slice(0, updateBlock.indexOf('});') + 3);
      expect(stmt).toMatch(/logoUrl: restaurant\.logoUrl \? undefined : \w+Data\.logoUrl/);
      expect(stmt).toMatch(/coverImageUrl: restaurant\.coverImageUrl \? undefined : \w+Data\.coverImageUrl/);
    });
  }
});
