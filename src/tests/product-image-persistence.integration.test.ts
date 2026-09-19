import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

// ============================================================================
// DB INTEGRATION — product / offer image persistence through the REAL routers.
//
// Proves the catalog image contract end to end, the way the theme suite proves
// logo/cover/gallery:
//
//   upload (POST /api/uploads/image)          -> object + { url, pathUrl }
//   save product with the URL                 -> DB keeps the STABLE KEY
//   save product with the KEY                 -> key stays key (idempotent)
//   every fresh GET                           -> key re-resolved to a URL
//   replace an image                          -> old object deleted, key swapped
//   round-trip the SAME asset as a URL        -> nothing deleted (folded compare)
//   legacy /uploads/… with no object behind it-> value PRESERVED, never folded
//   data: / blob:                             -> 400, nothing written
//   another tenant's key                      -> 400
//
// Gate: runs ONLY when DATABASE_URL is set (same convention as
// theme-image-persistence.integration.test.ts). Without it the suite skips and
// product-image-persistence.test.ts remains the offline guard.
//
// Env is fixed BEFORE server modules load (server/config.ts is fail-closed).
// server/index.ts is never imported; the app is assembled from the router
// modules exactly the way the real server mounts them. Storage is a throwaway
// local directory, so "object exists" and "old object deleted" are verified
// against the filesystem instead of a live bucket.
// ============================================================================

const testEnvPath = path.resolve(__dirname, '../../.env.test');
if (fs.existsSync(testEnvPath)) {
  loadDotenv({ path: testEnvPath });
} else {
  loadDotenv();
}

const hasDb = Boolean(process.env.DATABASE_URL);
const RUN: 'on' | 'off' = hasDb ? 'on' : 'off';

const TMP_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'product-image-int-'));
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = TMP_UPLOADS;
process.env.NODE_ENV = 'test';
delete process.env.APP_URL; // same-origin mode: relative /uploads/… URLs
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'product-image-persist-test-secret-min32';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

type App = ReturnType<typeof import('express')>;

interface Ctx {
  base: string;
  idA: string;
  idB: string;
  catA: string;
  slugA: string;
  authA: Record<string, string>;
  authB: Record<string, string>;
  prisma: any;
  close: () => Promise<void>;
}

let ctx: Ctx | null = null;

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/** Mirrors api.uploadImage: `kind` travels as a form field. */
function uploadForm(bytes: Buffer, name: string, kind?: string): FormData {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/png' }), name);
  if (kind) form.append('kind', kind);
  return form;
}

/** Wait until `fn` is true (cleanup after a commit is best-effort/async). */
async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function json(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

beforeAll(async () => {
  if (RUN !== 'on') return;

  const { default: express } = await import('express');
  const uploadsRouter = (await import('../../server/routes/uploads')).default;
  const managerRouter = (await import('../../server/routes/manager')).default;
  const publicRouter = (await import('../../server/routes/public')).default;
  const { signToken, authenticateToken } = await import('../../server/middleware/auth');
  const { prisma } = await import('../../server/db/prisma');

  const run = `prodimg${Date.now().toString(36)}`;
  const idA = `rest-${run}-a`;
  const idB = `rest-${run}-b`;
  const slugA = `dishes-a-${run}`;

  for (const [id, slug] of [
    [idA, slugA],
    [idB, `dishes-b-${run}`],
  ] as const) {
    await prisma.restaurant.create({
      data: {
        id,
        slug,
        name: `Dishes Test ${slug}`,
        logoUrl: '',
        description: 'Integration test tenant',
        phone: '0000000000',
        address: 'Test Street',
        galleryImages: [],
      },
    });
    await prisma.restaurantUser.create({
      data: {
        id: `user-${run}-${slug}`,
        restaurantId: id,
        name: `Manager ${slug}`,
        email: `${slug}@dishes.test`,
        passwordHash: (await import('bcryptjs')).hashSync('persist-test-password', 10),
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
      },
    });
  }
  const catA = await prisma.category.create({
    data: { restaurantId: idA, name: 'مشاوي', nameEn: 'Grill', sortOrder: 1 },
  });

  const app: App = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(TMP_UPLOADS));
  app.use('/api/public', publicRouter);
  app.use('/api/uploads', authenticateToken, uploadsRouter);
  app.use('/api/manager', authenticateToken, managerRouter);

  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;

  const tokenFor = async (userId: string) => {
    const user = await prisma.restaurantUser.findUniqueOrThrow({ where: { id: userId } });
    return signToken({
      id: user.id,
      restaurantId: user.restaurantId,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      tv: user.tokenVersion,
    });
  };
  const tokenA = await tokenFor(`user-${run}-${slugA}`);
  const tokenB = await tokenFor(`user-${run}-dishes-b-${run}`);

  ctx = {
    base: `http://127.0.0.1:${port}`,
    idA,
    idB,
    catA: catA.id,
    slugA,
    authA: { Authorization: `Bearer ${tokenA}` },
    authB: { Authorization: `Bearer ${tokenB}` },
    prisma,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}, 60000);

afterAll(async () => {
  if (!ctx) return;
  try {
    const ids = [ctx.idA, ctx.idB];
    await ctx.prisma.product.deleteMany({ where: { restaurantId: { in: ids } } });
    await ctx.prisma.offer.deleteMany({ where: { restaurantId: { in: ids } } });
    await ctx.prisma.category.deleteMany({ where: { restaurantId: { in: ids } } });
    await ctx.prisma.restaurantUser.deleteMany({ where: { restaurantId: { in: ids } } });
    await ctx.prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await ctx.prisma.$disconnect().catch(() => undefined);
    await ctx.close().catch(() => undefined);
    fs.rmSync(TMP_UPLOADS, { recursive: true, force: true });
  }
});

describe.skipIf(RUN !== 'on')('product/offer image persistence (real routers + DB)', () => {
  const dish = (over: Record<string, unknown> = {}) => ({
    categoryId: ctx!.catA,
    name: 'صحن مشكل',
    nameEn: 'Mixed Grill',
    description: 'Test dish',
    price: 60,
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
    ...over,
  });

  async function createDish(body: Record<string, unknown>, auth = 'authA') {
    const res = await fetch(`${ctx!.base}/api/manager/menu/products`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ctx![auth] },
      body: JSON.stringify({ restaurantId: ctx!.idA, ...body }),
    });
    return { res, body: await json(res) };
  }

  async function storedImageUrl(productId: string): Promise<string> {
    const row = await ctx!.prisma.product.findUnique({ where: { id: productId } });
    return row.imageUrl;
  }

  async function uploadDishPhoto() {
    const res = await fetch(
      `${ctx!.base}/api/uploads/image?restaurantId=${encodeURIComponent(ctx!.idA)}`,
      { method: 'POST', headers: ctx!.authA, body: uploadForm(PNG_1x1, 'dish.png', 'product') }
    );
    const body = await json(res);
    expect(res.status).toBe(200);
    return body.data as { url: string; pathUrl: string; key: string };
  }

  it('1. upload response carries the stable path, and it is what gets persisted', async () => {
    const uploaded = await uploadDishPhoto();
    expect(uploaded.pathUrl).toMatch(new RegExp(`^restaurants/${ctx!.idA}/products/.+\\.png$`));
    expect(uploaded.url).toContain(uploaded.pathUrl);

    // The value ProductFormModal sends is `pathUrl ?? url` -> the key.
    const { res, body } = await createDish(dish({ image: uploaded.pathUrl }));
    expect(res.status).toBe(201);
    expect(await storedImageUrl(body.data.id)).toBe(uploaded.pathUrl);
    // …while the response still hands the caller a renderable URL.
    expect(body.data.imageUrl).toContain(uploaded.pathUrl);
    expect(body.data.imageUrl).not.toBe(uploaded.pathUrl);
    expect(body.data.imageStoragePath).toBe(uploaded.pathUrl);
    // The object really is in the (throwaway) bucket.
    expect(fs.existsSync(path.join(TMP_UPLOADS, uploaded.pathUrl))).toBe(true);
  });

  it('2. a Supabase/public URL folds into the canonical key on save', async () => {
    const uploaded = await uploadDishPhoto();
    const { res, body } = await createDish(dish({ image: uploaded.url }));
    expect(res.status).toBe(201);
    expect(await storedImageUrl(body.data.id)).toBe(uploaded.pathUrl);
  });

  it('3. an already canonical key stays canonical (re-save is idempotent)', async () => {
    const uploaded = await uploadDishPhoto();
    const created = await createDish(dish({ image: uploaded.pathUrl }));
    const id = created.body.data.id;
    const put = await fetch(`${ctx!.base}/api/manager/menu/products/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ctx!.authA },
      body: JSON.stringify({ restaurantId: ctx!.idA, image: uploaded.pathUrl }),
    });
    expect(put.status).toBe(200);
    expect(await storedImageUrl(id)).toBe(uploaded.pathUrl);
    // …and the object survived the no-op re-save.
    expect(fs.existsSync(path.join(TMP_UPLOADS, uploaded.pathUrl))).toBe(true);
  });

  it('4. reads re-resolve the key after a fresh instance', async () => {
    const uploaded = await uploadDishPhoto();
    const created = await createDish(dish({ image: uploaded.pathUrl }));
    const id = created.body.data.id;

    // A restarted process: the storage singleton is rebuilt from env alone.
    const { resetStorageForTests } = await import('../../server/services/storage');
    resetStorageForTests();

    // Guest catalog read.
    const catalog = await json(await fetch(`${ctx!.base}/api/public/restaurants/${ctx!.slugA}`));
    const guestRow = (catalog.data.products as any[]).find((x) => x.id === id);
    expect(guestRow.image).toContain(uploaded.pathUrl);
    expect(guestRow.image).not.toBe(uploaded.pathUrl);

    // Manager read (same resolver, different endpoint).
    const managerGet = await json(
      await fetch(`${ctx!.base}/api/manager/menu/products?restaurantId=${ctx!.idA}`, {
        headers: ctx!.authA,
      })
    );
    const row = (managerGet.data as any[]).find((x) => x.id === id);
    expect(row.image).toContain(uploaded.pathUrl);
    expect(row.image).not.toBe(uploaded.pathUrl);
  });

  it('5. external URLs (Unsplash/CDN seeds) stay external', async () => {
    const external = 'https://images.unsplash.com/photo-1544025162-d76694265947?w=800';
    const { res, body } = await createDish(dish({ image: external }));
    expect(res.status).toBe(201);
    expect(await storedImageUrl(body.data.id)).toBe(external);
  });

  it('6. data: and blob: payloads are refused with 400 and never written', async () => {
    for (const bad of [
      `data:image/png;base64,${PNG_1x1.toString('base64')}`,
      'blob:http://localhost:5173/6f0a-1234',
    ]) {
      const { res } = await createDish(dish({ image: bad }));
      expect(res.status, bad.slice(0, 24)).toBe(400);
    }
    // A rejected save must not have written anything.
    const rows = await ctx!.prisma.product.findMany({
      where: { restaurantId: ctx!.idA, imageUrl: { startsWith: 'data:' } },
    });
    expect(rows.length).toBe(0);
  });

  it('7. a legacy /uploads reference with no object is preserved, not destroyed', async () => {
    const legacy = `/uploads/restaurants/${ctx!.idA}/products/never-migrated.jpg`;
    // Row written before the object-storage move; the file is NOT on disk.
    const row = await ctx!.prisma.product.create({
      data: {
        restaurantId: ctx!.idA,
        categoryId: ctx!.catA,
        name: 'إرثي',
        nameEn: 'Legacy',
        description: '',
        price: 10,
        imageUrl: legacy,
      },
    });
    const put = await fetch(`${ctx!.base}/api/manager/menu/products/${row.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ctx!.authA },
      body: JSON.stringify({ restaurantId: ctx!.idA, description: 'still legacy', image: legacy }),
    });
    expect(put.status).toBe(200);
    // Not folded into a key with no object behind it:
    expect(await storedImageUrl(row.id)).toBe(legacy);
  });

  it('8. replacing a dish photo deletes the old object; re-saving does not', async () => {
    const first = await uploadDishPhoto();
    const created = await createDish(dish({ image: first.pathUrl }));
    const id = created.body.data.id;
    const firstPath = path.join(TMP_UPLOADS, first.pathUrl);
    expect(fs.existsSync(firstPath)).toBe(true);

    // Round-trip the SAME asset as a URL -> folded keys compare equal -> no delete.
    await fetch(`${ctx!.base}/api/manager/menu/products/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ctx!.authA },
      body: JSON.stringify({ restaurantId: ctx!.idA, image: first.url }),
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(fs.existsSync(firstPath)).toBe(true);

    // A real replacement -> the old object is cleaned up.
    const second = await uploadDishPhoto();
    await fetch(`${ctx!.base}/api/manager/menu/products/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ctx!.authA },
      body: JSON.stringify({ restaurantId: ctx!.idA, image: second.pathUrl }),
    });
    expect(await waitFor(() => !fs.existsSync(firstPath))).toBe(true);
    expect(await storedImageUrl(id)).toBe(second.pathUrl);
    expect(fs.existsSync(path.join(TMP_UPLOADS, second.pathUrl))).toBe(true);
  });

  it('9. another tenant key is refused, and nothing of theirs is touched', async () => {
    // Tenant B uploads a photo…
    const foreign = await fetch(
      `${ctx!.base}/api/uploads/image?restaurantId=${encodeURIComponent(ctx!.idB)}`,
      { method: 'POST', headers: ctx!.authB, body: uploadForm(PNG_1x1, 'b.png', 'product') }
    );
    const foreignBody = await json(foreign);
    expect(foreignBody.success).toBe(true);
    const foreignKey = foreignBody.data.pathUrl as string;

    // …tenant A cannot point one of its dishes at it.
    const { res, body } = await createDish(dish({ image: foreignKey }));
    expect(res.status).toBe(400);
    expect(body.error).toContain('مطعمك');
    expect(fs.existsSync(path.join(TMP_UPLOADS, foreignKey))).toBe(true);
  });

  it('offers follow the same contract (key persisted, URL returned)', async () => {
    const uploaded = await json(
      await fetch(
        `${ctx!.base}/api/uploads/image?restaurantId=${encodeURIComponent(ctx!.idA)}`,
        {
          method: 'POST',
          headers: { ...ctx!.authA },
          body: (() => {
            const f = new FormData();
            f.append('image', new Blob([PNG_1x1], { type: 'image/png' }), 'offer.png');
            f.append('kind', 'offer');
            return f;
          })(),
        }
      )
    );
    expect(uploaded.data.pathUrl).toContain(`/offers/`);

    const created = await json(
      await fetch(`${ctx!.base}/api/manager/offers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...ctx!.authA },
        body: JSON.stringify({
          restaurantId: ctx!.idA,
          title: 'عرض الغداء',
          image: uploaded.data.pathUrl,
        }),
      })
    );
    const offerId = created.data?.offer?.id ?? created.offer?.id;
    const row = await ctx!.prisma.offer.findUnique({ where: { id: offerId } });
    expect(row.image).toBe(uploaded.data.pathUrl);
    const offer = created.data?.offer ?? created.offer;
    expect(offer.image).toContain(uploaded.data.pathUrl);
    expect(offer.image).not.toBe(uploaded.data.pathUrl);

    // External offer URL stays external, and clearing is explicit ('').
    const cleared = await json(
      await fetch(`${ctx!.base}/api/manager/offers/${offerId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...ctx!.authA },
        body: JSON.stringify({ restaurantId: ctx!.idA, image: '' }),
      })
    );
    expect((await ctx!.prisma.offer.findUnique({ where: { id: offerId } })).image).toBeFalsy();
    void cleared;
  });
});
