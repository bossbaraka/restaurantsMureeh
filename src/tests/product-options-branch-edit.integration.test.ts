import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

// ============================================================================
// DB INTEGRATION — dish EDIT persistence + branch EDIT (real routers + DB).
//
// Two shipped defects, proven fixed end to end:
//
//   dish edit   POST a dish with sizes/add-ons           -> 201, children stored
//               PUT the SAME body shape the form sends   -> 200, children replaced
//               PUT with empty lists                     -> children removed,
//                                                           omitted keys untouched
//               PUT from another tenant                  -> 403, nothing written
//
//   branch edit POST a branch                            -> 201
//               PUT the same branch (address '')         -> 200, ONE row updated,
//                                                           address cleared to NULL
//               PUT from another tenant                  -> 403
//
// Gate: runs ONLY when DATABASE_URL is set (same convention as
// product-image-persistence.integration.test.ts). Without it the suite skips
// and dish-edit-contract.test.ts / branch-edit-flow.test.tsx remain the
// offline guards.
//
// Env is fixed BEFORE server modules load (server/config.ts is fail-closed).
// server/index.ts is never imported; the app is assembled from the router
// modules exactly the way the real server mounts them.
// ============================================================================

const testEnvPath = path.resolve(__dirname, '../../.env.test');
if (fs.existsSync(testEnvPath)) {
  loadDotenv({ path: testEnvPath });
} else {
  loadDotenv();
}

const hasDb = Boolean(process.env.DATABASE_URL);
const RUN: 'on' | 'off' = hasDb ? 'on' : 'off';

const TMP_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-branch-int-'));
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = TMP_UPLOADS;
process.env.NODE_ENV = 'test';
delete process.env.APP_URL; // same-origin mode: relative /uploads/… URLs
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'dish-branch-edit-test-secret-min32-chars';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

type App = ReturnType<typeof import('express')>;

interface Ctx {
  base: string;
  idA: string;
  idB: string;
  catA: string;
  authA: Record<string, string>;
  authB: Record<string, string>;
  prisma: any;
  close: () => Promise<void>;
}

let ctx: Ctx | null = null;

async function json(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

beforeAll(async () => {
  if (RUN !== 'on') return;

  const { default: express } = await import('express');
  const managerRouter = (await import('../../server/routes/manager')).default;
  const { signToken, authenticateToken } = await import('../../server/middleware/auth');
  const { prisma } = await import('../../server/db/prisma');

  const run = `dishbr${Date.now().toString(36)}`;
  const idA = `rest-${run}-a`;
  const idB = `rest-${run}-b`;

  for (const [id, slug] of [
    [idA, `edit-a-${run}`],
    [idB, `edit-b-${run}`],
  ] as const) {
    await prisma.restaurant.create({
      data: {
        id,
        slug,
        name: `Edit Test ${slug}`,
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
        email: `${slug}@edit.test`,
        passwordHash: (await import('bcryptjs')).hashSync('edit-test-password', 10),
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
      },
    });
  }

  // Tenant A runs the multi-branch plan: POST /branches is entitlement-gated
  // (CAN_CREATE_BRANCH) and the branch ceiling comes from the plan.
  const planId = `plan-edit-${run}`;
  await prisma.plan.create({
    data: {
      id: planId,
      name: 'باقة اختبار',
      nameEn: 'Edit Test Plan',
      priceMonthly: 0,
      priceYearly: 0,
      maxTables: 200,
      maxCategories: 40,
      maxProducts: 500,
      maxBranches: 10,
      entitlements: ['CAN_CREATE_BRANCH', 'CAN_USE_ADVANCED_FEATURES'],
      description: 'Integration test plan',
      status: 'ACTIVE',
    },
  });
  await prisma.subscription.create({
    data: {
      restaurantId: idA,
      planId,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  const catA = await prisma.category.create({
    data: { restaurantId: idA, name: 'مشاوي', nameEn: 'Grill', sortOrder: 1 },
  });

  const app: App = express();
  app.use(express.json({ limit: '1mb' }));
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

  ctx = {
    base: `http://127.0.0.1:${port}`,
    idA,
    idB,
    catA: catA.id,
    authA: { Authorization: `Bearer ${await tokenFor(`user-${run}-edit-a-${run}`)}` },
    authB: { Authorization: `Bearer ${await tokenFor(`user-${run}-edit-b-${run}`)}` },
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
    await ctx.prisma.branch.deleteMany({ where: { restaurantId: { in: ids } } });
    await ctx.prisma.category.deleteMany({ where: { restaurantId: { in: ids } } });
    await ctx.prisma.subscription.deleteMany({ where: { restaurantId: { in: ids } } });
    await ctx.prisma.restaurantUser.deleteMany({ where: { restaurantId: { in: ids } } });
    await ctx.prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
    await ctx.prisma.plan.deleteMany({ where: { id: { startsWith: 'plan-edit-' } } });
  } finally {
    await ctx.prisma.$disconnect().catch(() => undefined);
    await ctx.close().catch(() => undefined);
    fs.rmSync(TMP_UPLOADS, { recursive: true, force: true });
  }
});

describe.skipIf(RUN !== 'on')('dish edit + branch edit (real routers + DB)', () => {
  /** Mirrors the body `api.saveProduct` (src/services/api.ts) sends verbatim. */
  const dish = (over: Record<string, unknown> = {}) => ({
    restaurantId: ctx!.idA,
    categoryId: ctx!.catA,
    name: 'صحن مشكل',
    nameEn: 'Mixed Grill',
    description: 'Test dish',
    price: 60,
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
    preparationTimeMinutes: 15,
    calories: 450,
    isAvailable: true,
    isFeatured: false,
    sizes: [
      { id: 'size-1758300000000', name: 'كبير', price: 5, priceModifier: 5 },
      { id: 'size-1758300000001', name: 'وسط', price: 0, priceModifier: 0 },
    ],
    addOns: [{ id: 'addon-1758300000000', name: 'جبن إضافي', price: 3, isAvailable: true }],
    allergens: ['milk'],
    ingredients: ['لحم', 'بصل'],
    removableIngredients: ['بصل'],
    ...over,
  });

  async function createDish(body: Record<string, unknown>) {
    const res = await fetch(`${ctx!.base}/api/manager/menu/products`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ctx!.authA },
      body: JSON.stringify(body),
    });
    return { res, body: await json(res) };
  }

  async function editDish(id: string, body: Record<string, unknown>) {
    const res = await fetch(`${ctx!.base}/api/manager/menu/products/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ctx!.authA },
      body: JSON.stringify(body),
    });
    return { res, body: await json(res) };
  }

  const storedDish = (id: string) =>
    ctx!.prisma.product.findUnique({ where: { id }, include: { options: true, addOns: true } });

  it('1. creates a dish with sizes, add-ons and ingredient metadata', async () => {
    const { res, body } = await createDish(dish());
    expect(res.status, JSON.stringify(body)).toBe(201);

    const row = await storedDish(body.data.id);
    expect(row.allergens).toEqual(['milk']);
    expect(row.ingredients).toEqual(['لحم', 'بصل']);
    expect(row.removableIngredients).toEqual(['بصل']);
    expect(row.options.map((o: any) => [o.name, o.priceModifier])).toEqual([
      ['كبير', 5],
      ['وسط', 0],
    ]);
    expect(row.addOns.map((a: any) => [a.name, a.price, a.isAvailable])).toEqual([
      ['جبن إضافي', 3, true],
    ]);
  });

  it('2. edits the dish with the same body shape and replaces the children', async () => {
    const created = await createDish(dish());
    const id = created.body.data.id;
    const before = await storedDish(id);

    // Exactly what the manager form sends after editing a loaded dish.
    const { res, body } = await editDish(
      id,
      dish({
        name: 'صحن مشكل فاخر',
        price: 75,
        allergens: ['milk', 'nuts'],
        ingredients: ['لحم', 'بصل', 'طماطم'],
        removableIngredients: ['بصل', 'طماطم'],
        sizes: [{ id: before.options[0].id, name: 'عائلي', price: 12, priceModifier: 12 }],
        addOns: [
          { id: before.addOns[0].id, name: 'جبن موزاريلا', price: 5, isAvailable: true },
          { id: 'addon-1758300000999', name: 'صوص حار', price: 2, isAvailable: true },
        ],
      })
    );
    expect(res.status, JSON.stringify(body)).toBe(200);

    const row = await storedDish(id);
    expect(row.name).toBe('صحن مشكل فاخر');
    expect(row.price).toBe(75);
    expect(row.allergens).toEqual(['milk', 'nuts']);
    expect(row.ingredients).toEqual(['لحم', 'بصل', 'طماطم']);
    expect(row.removableIngredients).toEqual(['بصل', 'طماطم']);
    // Full-list replacement: the removed size is gone, the new list is stored.
    expect(row.options.map((o: any) => [o.name, o.priceModifier])).toEqual([['عائلي', 12]]);
    expect(row.addOns.map((a: any) => a.name).sort()).toEqual(['جبن موزاريلا', 'صوص حار']);
    // …and the response carries them back through the exact mapper the client
    // uses, so the manager list/modal never blanks the saved customizations.
    const { mapProductRow } = await import('../services/api');
    const mapped = mapProductRow({ ...body.data, restaurantId: ctx!.idA });
    expect(mapped.sizes?.map((s) => s.name)).toEqual(['عائلي']);
    expect(mapped.addOns?.map((a) => a.name).sort()).toEqual(['جبن موزاريلا', 'صوص حار']);
  });

  it('3. empty lists clear the children while omitted keys stay untouched', async () => {
    const created = await createDish(dish());
    const id = created.body.data.id;

    const { res } = await editDish(id, { restaurantId: ctx!.idA, sizes: [], addOns: [] });
    expect(res.status).toBe(200);

    const row = await storedDish(id);
    expect(row.options).toEqual([]);
    expect(row.addOns).toEqual([]);
    // Nothing else was reset by the partial body.
    expect(row.name).toBe('صحن مشكل');
    expect(row.allergens).toEqual(['milk']);
    expect(row.removableIngredients).toEqual(['بصل']);
  });

  it('4. another tenant cannot edit the dish', async () => {
    const created = await createDish(dish());
    const id = created.body.data.id;

    const res = await fetch(`${ctx!.base}/api/manager/menu/products/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ctx!.authB },
      body: JSON.stringify({ restaurantId: ctx!.idB, name: 'مسروق' }),
    });
    expect(res.status).toBe(403);
    expect((await storedDish(id)).name).toBe('صحن مشكل');
  });

  it('5. editing a branch updates that branch instead of creating a duplicate', async () => {
    const created = await fetch(`${ctx!.base}/api/manager/branches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...ctx!.authA },
      body: JSON.stringify({
        restaurantId: ctx!.idA,
        name: 'فرع أ',
        address: 'شارع 1',
        phone: '0599111111',
        color: '#D4AF37',
      }),
    });
    expect(created.status).toBe(201);
    const branchId = (await json(created)).data.branch.id;

    // The edit the UI now sends: same id, updated name, address emptied.
    const updated = await fetch(`${ctx!.base}/api/manager/branches/${branchId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ctx!.authA },
      body: JSON.stringify({
        restaurantId: ctx!.idA,
        name: 'فرع أ المعدّل',
        address: '',
        phone: '0599222222',
        color: '#60A5FA',
        isActive: true,
      }),
    });
    expect(updated.status).toBe(200);

    const rows = await ctx!.prisma.branch.findMany({ where: { restaurantId: ctx!.idA } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(branchId);
    expect(rows[0].name).toBe('فرع أ المعدّل');
    // '' is an explicit clear, not an ignored value.
    expect(rows[0].address).toBeNull();
    expect(rows[0].phone).toBe('0599222222');
    expect(rows[0].color).toBe('#60A5FA');
  });

  it('6. another tenant cannot edit the branch', async () => {
    const branch = await ctx!.prisma.branch.findFirstOrThrow({ where: { restaurantId: ctx!.idA } });

    const res = await fetch(`${ctx!.base}/api/manager/branches/${branch.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ctx!.authB },
      body: JSON.stringify({ restaurantId: ctx!.idB, name: 'فرع مسروق' }),
    });
    expect(res.status).toBe(403);
    const after = await ctx!.prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    expect(after.name).toBe('فرع أ المعدّل');
  });
});
