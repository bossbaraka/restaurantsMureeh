/**
 * Catalog write contract — `ingredients` and `removableIngredients` are two
 * INDEPENDENT fields.
 *
 * The create route used to answer `removableIngredients: removableIngredients
 * || ingredients || []` and the update route
 * `data.removableIngredients ?? data.ingredients`, so a descriptive
 * composition list silently became a guest-removable list — the root cause of
 * every dish with only ingredients showing a «تخصيص» button to the guest.
 *
 * Locked here against the REAL manager router (stubbed Prisma, no DB):
 *   1. create stores exactly what was sent under each key
 *   2. `ingredients` alone does NOT materialise removable ingredients
 *   3. update keeps partial semantics: absent key = untouched
 *   4. an explicit `[]` still clears the field
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'product-ingredients-contract-secret-0123456789';

type PrismaCall = Record<string, any>;

const createCalls: PrismaCall[] = [];
const updateCalls: PrismaCall[] = [];

const storedRow = {
  id: 'prod-1',
  restaurantId: 'rest-1',
  categoryId: 'cat-1',
  name: 'منسف',
  nameEn: 'Mansaf',
  description: 'وصف',
  price: 89,
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
  'user-a': {
    id: 'user-a',
    restaurantId: 'rest-1',
    name: 'مدير',
    email: 'a@test',
    role: 'RESTAURANT_MANAGER',
    status: 'ACTIVE',
    tokenVersion: 0,
    restaurant: { status: 'ACTIVE' },
  },
};

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    auditLog: { create: async () => ({}) },
    restaurantUser: { findUnique: async ({ where }: any) => users[where.id] ?? null },
    category: { findUnique: async ({ where }: any) => ({ id: where.id, restaurantId: 'rest-1' }) },
    // No paid subscription in this fixture -> FREE_LIMITS apply.
    subscription: { findUnique: async () => null },
    product: {
      count: async () => 0,
      findUnique: async ({ where }: any) => (where.id === storedRow.id ? storedRow : null),
      create: async (args: any) => {
        createCalls.push(args);
        return {
          id: 'prod-new',
          imageUrl: args.data.imageUrl,
          ingredients: args.data.ingredients,
          removableIngredients: args.data.removableIngredients,
          options: [],
          addOns: [],
        };
      },
      update: async (args: any) => {
        updateCalls.push(args);
        return { ...storedRow, ...args.data, options: [], addOns: [] };
      },
    },
  },
}));

describe('catalog write — ingredients vs removableIngredients', () => {
  let base = '';
  let token = '';
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
    token = signToken(users['user-a'] as never);
  }, 30000);

  afterAll(async () => {
    await close();
  });

  beforeEach(() => {
    createCalls.length = 0;
    updateCalls.length = 0;
  });

  const post = (body: Record<string, unknown>) =>
    fetch(`${base}/api/manager/menu/products`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  const put = (body: Record<string, unknown>) =>
    fetch(`${base}/api/manager/menu/products/prod-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  const dish = (over: Record<string, unknown> = {}) => ({
    restaurantId: 'rest-1',
    categoryId: 'cat-1',
    name: 'منسف',
    description: 'وصف',
    price: 89,
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
    ...over,
  });

  describe('POST /menu/products (create)', () => {
    it('stores ingredients=[لحم] with an explicitly empty removable list as two values', async () => {
      const res = await post(dish({ ingredients: ['لحم'], removableIngredients: [] }));
      const body = await res.json();
      expect(res.status, JSON.stringify(body)).toBe(201);
      expect(createCalls).toHaveLength(1);

      expect(createCalls[0].data.ingredients).toEqual(['لحم']);
      expect(createCalls[0].data.removableIngredients).toEqual([]);
    });

    it('never turns a descriptive list into removable ingredients', async () => {
      const res = await post(dish({ ingredients: ['لحم', 'بصل'] }));
      expect(res.status).toBe(201);

      expect(createCalls[0].data.ingredients).toEqual(['لحم', 'بصل']);
      // The old contract copied the array here — the dish then looked
      // customizable to the guest even though the venue declared no removables.
      expect(createCalls[0].data.removableIngredients).toEqual([]);
    });

    it('keeps two different lists distinct', async () => {
      const res = await post(dish({ ingredients: ['لحم', 'بصل'], removableIngredients: ['بصل'] }));
      expect(res.status).toBe(201);

      expect(createCalls[0].data.ingredients).toEqual(['لحم', 'بصل']);
      expect(createCalls[0].data.removableIngredients).toEqual(['بصل']);
    });

    it('stores empty lists when neither field was sent', async () => {
      const res = await post(dish());
      expect(res.status).toBe(201);

      expect(createCalls[0].data.ingredients).toEqual([]);
      expect(createCalls[0].data.removableIngredients).toEqual([]);
    });
  });

  describe('PUT /menu/products/:id (partial update semantics preserved)', () => {
    it('writes ingredients and leaves an absent removable list untouched', async () => {
      const res = await put({ restaurantId: 'rest-1', ingredients: ['لحم'] });
      const body = await res.json();
      expect(res.status, JSON.stringify(body)).toBe(200);

      expect(updateCalls[0].data.ingredients).toEqual(['لحم']);
      // Absent key = unchanged; it must NOT be filled from `ingredients`.
      expect(updateCalls[0].data.removableIngredients).toBeUndefined();
    });

    it('writes a removable list without touching ingredients', async () => {
      const res = await put({ restaurantId: 'rest-1', removableIngredients: ['بصل'] });
      expect(res.status).toBe(200);

      expect(updateCalls[0].data.removableIngredients).toEqual(['بصل']);
      expect(updateCalls[0].data.ingredients).toBeUndefined();
    });

    it('honours an explicit clear of the removable list', async () => {
      const res = await put({ restaurantId: 'rest-1', removableIngredients: [] });
      expect(res.status).toBe(200);

      expect(updateCalls[0].data.removableIngredients).toEqual([]);
      expect(updateCalls[0].data.ingredients).toBeUndefined();
    });

    it('keeps two different lists distinct on edit', async () => {
      const res = await put({
        restaurantId: 'rest-1',
        ingredients: ['لحم', 'بصل', 'طماطم'],
        removableIngredients: ['بصل', 'طماطم'],
      });
      expect(res.status).toBe(200);

      expect(updateCalls[0].data.ingredients).toEqual(['لحم', 'بصل', 'طماطم']);
      expect(updateCalls[0].data.removableIngredients).toEqual(['بصل', 'طماطم']);
    });
  });
});
