/**
 * Dish edit — the client/server contract for the customized dish payload.
 *
 * Regression guard for the shipped 400 «Unrecognized keys: "sizes", "addOns",
 * "allergens", "ingredients", "removableIngredients"»:
 *
 * `api.saveProduct` builds ONE body for create and update, so the update
 * schema has to declare exactly what the create schema declares — and the PUT
 * handler has to persist them (a schema that validates but a route that drops
 * the values is silent data loss, not a fix).
 *
 * Pure/filesystem-level: no database and no generated Prisma client.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { productCreateSchema, productUpdateSchema } from '../../server/validation/schemas';

// The route-level proof at the bottom boots the REAL manager router (real
// validation middleware) against a stubbed Prisma client, so it needs a
// bootable server environment — fixed before any server module is imported.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'dish-edit-contract-test-secret-min32';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'dish-edit-contract-'));
delete process.env.APP_URL;

const source = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const apiSource = source('../services/api.ts');
const managerSource = source('../../server/routes/manager.ts');

/** Mirrors the body `api.saveProduct` (src/services/api.ts) sends verbatim. */
const clientDishBody = (over: Record<string, unknown> = {}) => ({
  restaurantId: 'rest-1',
  categoryId: 'cat-1',
  name: 'صحن مشكل',
  nameEn: 'Mixed Grill',
  description: 'وصف الطبق',
  price: 60,
  image: 'restaurants/rest-1/products/dish.jpg',
  badge: undefined,
  preparationTimeMinutes: 15,
  calories: 450,
  isAvailable: true,
  isFeatured: false,
  // The manager form round-trips its own ids on both children.
  sizes: [
    { id: 'size-1758300000000', name: 'كبير', nameEn: 'Large', price: 5, priceModifier: 5 },
    { id: 'opt-db-1', name: 'وسط', price: 0, priceModifier: 0 },
  ],
  addOns: [{ id: 'addon-1758300000000', name: 'جبن إضافي', price: 3, isAvailable: true }],
  allergens: ['milk'],
  ingredients: ['لحم', 'بصل'],
  removableIngredients: ['بصل'],
  ...over,
});

describe('dish edit — validation boundary', () => {
  it('accepts the exact payload the manager form sends on edit', () => {
    const parsed = productUpdateSchema.safeParse(clientDishBody());
    expect(parsed.success, JSON.stringify(parsed.success ? [] : parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.allergens).toEqual(['milk']);
    expect(parsed.data.ingredients).toEqual(['لحم', 'بصل']);
    expect(parsed.data.removableIngredients).toEqual(['بصل']);
    expect(parsed.data.sizes?.map((s) => s.name)).toEqual(['كبير', 'وسط']);
    expect(parsed.data.addOns?.map((a) => a.price)).toEqual([3]);
  });

  it('accepts the "cleared everything" edit (empty lists = remove them)', () => {
    const res = productUpdateSchema.safeParse(
      clientDishBody({
        allergens: [],
        ingredients: [],
        removableIngredients: [],
        sizes: [],
        addOns: [],
      })
    );
    expect(res.success).toBe(true);
  });

  it('accepts the same children on create (adding a dish with sizes/add-ons)', () => {
    const res = productCreateSchema.safeParse(clientDishBody());
    expect(res.success, JSON.stringify(res.success ? [] : res.error.issues)).toBe(true);
  });

  it('still rejects unknown keys, bad values and out-of-bounds lists', () => {
    // `.strict()` is intact — an undeclared top-level key is still a 400.
    expect(productUpdateSchema.safeParse(clientDishBody({ hack: 1 })).success).toBe(false);
    // …and so is an undeclared key INSIDE a size/add-on (the children stay strict).
    expect(
      productUpdateSchema.safeParse(clientDishBody({ sizes: [{ name: 'كبير', bogus: true }] })).success
    ).toBe(false);
    expect(
      productUpdateSchema.safeParse(clientDishBody({ addOns: [{ name: 'جبن', bogus: true }] })).success
    ).toBe(false);
    // Declared keys keep their bounds (no weakening to make the form pass).
    expect(productUpdateSchema.safeParse(clientDishBody({ sizes: [{ name: '' }] })).success).toBe(false);
    expect(
      productUpdateSchema.safeParse(clientDishBody({ sizes: [{ name: 'كبير', price: -5 }] })).success
    ).toBe(false);
    expect(
      productUpdateSchema.safeParse(clientDishBody({ addOns: [{ name: 'جبن', price: -1 }] })).success
    ).toBe(false);
    expect(
      productUpdateSchema.safeParse(clientDishBody({ addOns: [{ name: 'جبن', isAvailable: 'yes' }] })).success
    ).toBe(false);
    expect(productUpdateSchema.safeParse(clientDishBody({ name: 'x'.repeat(200) })).success).toBe(false);
    expect(productUpdateSchema.safeParse(clientDishBody({ price: -1 })).success).toBe(false);
    expect(productUpdateSchema.safeParse(clientDishBody({ allergens: ['a'.repeat(61)] })).success).toBe(false);
    expect(
      productUpdateSchema.safeParse(
        clientDishBody({ sizes: Array.from({ length: 31 }, (_, i) => ({ name: `حجم ${i}` })) })
      ).success
    ).toBe(false);
    expect(
      productUpdateSchema.safeParse(
        clientDishBody({ addOns: Array.from({ length: 51 }, (_, i) => ({ name: `إضافة ${i}` })) })
      ).success
    ).toBe(false);
  });

  it('keeps one shared body in api.saveProduct for create AND update', () => {
    // If the client stops sending (or starts renaming) a customization key, the
    // server contract has to be revisited together with it.
    const saveProduct = apiSource.slice(
      apiSource.indexOf('public async saveProduct('),
      apiSource.indexOf('public async deleteManagerProduct(')
    );
    for (const key of ['sizes', 'addOns', 'allergens', 'ingredients', 'removableIngredients']) {
      expect(saveProduct, `api.saveProduct must send ${key}`).toContain(`${key}:`);
    }
  });
});

describe('dish edit — route persistence contract', () => {
  const putStart = managerSource.search(/router\.put\(\s*'\/menu\/products\/:id'/);
  const deleteStart = managerSource.indexOf("router.delete('/menu/products/:id'");
  const putBlock = managerSource.slice(putStart, deleteStart);

  it('locates the PUT handler (guards the assertions below)', () => {
    expect(putStart).toBeGreaterThan(-1);
    expect(deleteStart).toBeGreaterThan(putStart);
    expect(putBlock).toContain('validateBody(productUpdateSchema)');
  });

  it('persists every customization field instead of silently dropping it', () => {
    for (const field of ['allergens', 'ingredients', 'removableIngredients', 'options', 'addOns']) {
      expect(putBlock, `PUT must write ${field}`).toContain(`${field}:`);
    }
    // Sizes/add-ons are full-list replacements: present → children replaced.
    expect(putBlock).toContain('deleteMany: {}');
    expect(putBlock).toContain('include: { options: true, addOns: true }');
    // Validation is still applied before the write.
    expect(putBlock).not.toContain('safeParse');
  });

  it('keeps the create and update mappings identical for both children', () => {
    const createStart = managerSource.search(/router\.post\(\s*'\/menu\/products'/);
    expect(createStart).toBeGreaterThan(-1);
    const createBlock = managerSource.slice(createStart, putStart);
    for (const mapping of [
      'priceModifier: s.priceModifier ?? s.price ?? 0',
      'price: s.price ?? s.priceModifier ?? 0',
      'price: a.price ?? 0',
      'isAvailable: true',
    ]) {
      expect(createBlock, `create must keep: ${mapping}`).toContain(mapping);
      expect(putBlock, `update must match create: ${mapping}`).toContain(mapping);
    }
  });
});

// ---------------------------------------------------------------------------
// Route-level proof — the REAL router + REAL validation middleware, with the
// Prisma client stubbed. Runs with no database: it proves the shipped 400 is
// gone AND that the validated values reach Prisma (a schema that accepts but a
// route that drops them would be silent data loss, not a fix).
// ---------------------------------------------------------------------------

const updateCalls: Array<Record<string, any>> = [];

const storedRow = {
  id: 'prod-1',
  restaurantId: 'rest-1',
  categoryId: 'cat-1',
  name: 'صحن مشكل',
  nameEn: 'Mixed Grill',
  description: 'وصف الطبق',
  price: 60,
  imageUrl: 'https://cdn.example.com/dish.jpg',
  available: true,
  isFeatured: false,
  badge: null,
  preparationTimeMinutes: 15,
  calories: 450,
  allergens: [],
  ingredients: [],
  removableIngredients: [],
};

const users: Record<string, any> = {
  'user-a': { id: 'user-a', restaurantId: 'rest-1', name: 'مدير', email: 'a@test', role: 'RESTAURANT_MANAGER', status: 'ACTIVE', tokenVersion: 0, restaurant: { status: 'ACTIVE' } },
  'user-b': { id: 'user-b', restaurantId: 'rest-other', name: 'مدير آخر', email: 'b@test', role: 'RESTAURANT_MANAGER', status: 'ACTIVE', tokenVersion: 0, restaurant: { status: 'ACTIVE' } },
};

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    // Denied requests record a best-effort audit event.
    auditLog: { create: async () => ({}) },
    restaurantUser: { findUnique: async ({ where }: any) => users[where.id] ?? null },
    category: { findUnique: async ({ where }: any) => ({ id: where.id, restaurantId: 'rest-1' }) },
    product: {
      findUnique: async ({ where }: any) => (where.id === storedRow.id ? storedRow : null),
      update: async (args: any) => {
        updateCalls.push(args);
        return { ...storedRow, ...args.data, options: [], addOns: [] };
      },
    },
  },
}));

describe('dish edit — real route (stubbed Prisma)', () => {
  let base = '';
  let tokenA = '';
  let tokenB = '';
  let close: () => Promise<void> = async () => undefined;

  beforeAll(async () => {
    const { default: express } = await import('express');
    const managerRouter = (await import('../../server/routes/manager')).default;
    const { signToken, authenticateToken } = await import('../../server/middleware/auth');

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/manager', authenticateToken, managerRouter);

    const server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    close = () => new Promise<void>((resolve) => server.close(() => resolve()));
    tokenA = signToken(users['user-a'] as never);
    tokenB = signToken(users['user-b'] as never);
  }, 30000);

  afterAll(async () => {
    await close();
  });

  const put = (token: string, body: Record<string, unknown>) =>
    fetch(`${base}/api/manager/menu/products/prod-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  it('accepts the manager payload and hands every customization to Prisma', async () => {
    updateCalls.length = 0;
    const res = await put(tokenA, clientDishBody());
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(updateCalls).toHaveLength(1);
    const data = updateCalls[0].data;
    expect(data.name).toBe('صحن مشكل');
    expect(data.allergens).toEqual(['milk']);
    expect(data.ingredients).toEqual(['لحم', 'بصل']);
    expect(data.removableIngredients).toEqual(['بصل']);
    // Full-list replacement of both children, mapped exactly like create.
    expect(data.options.deleteMany).toEqual({});
    expect(data.options.create).toEqual([
      { name: 'كبير', nameEn: 'Large', priceModifier: 5, price: 5 },
      { name: 'وسط', nameEn: undefined, priceModifier: 0, price: 0 },
    ]);
    expect(data.addOns).toEqual({
      deleteMany: {},
      create: [{ name: 'جبن إضافي', nameEn: undefined, price: 3, isAvailable: true }],
    });
    expect(updateCalls[0].include).toEqual({ options: true, addOns: true });
  });

  it('an empty list clears the children instead of being ignored', async () => {
    updateCalls.length = 0;
    const res = await put(tokenA, clientDishBody({ sizes: [], addOns: [] }));
    expect(res.status).toBe(200);
    expect(updateCalls[0].data.options).toEqual({ deleteMany: {}, create: [] });
    expect(updateCalls[0].data.addOns).toEqual({ deleteMany: {}, create: [] });
  });

  it('still refuses an undeclared key before touching the database', async () => {
    updateCalls.length = 0;
    const res = await put(tokenA, clientDishBody({ hack: 1 }));
    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });

  it('refuses an edit from another tenant', async () => {
    updateCalls.length = 0;
    const res = await put(tokenB, clientDishBody({ restaurantId: 'rest-other', name: 'مسروق' }));
    expect(res.status).toBe(403);
    expect(updateCalls).toHaveLength(0);
  });
});
