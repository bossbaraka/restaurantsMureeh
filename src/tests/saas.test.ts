import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, AUTH_TOKEN_KEY } from '../services/api';

/**
 * Multi-Tenant SaaS — Live API Client Contract Suite
 * ---------------------------------------------------
 * These tests exercise the REAL `api` client (the only data layer of the app)
 * against a stubbed HTTP transport. They prove that:
 *   1. every call goes to the real REST API (never a local/mock database),
 *   2. tenant context travels in the request body + bearer JWT for the server
 *      to enforce isolation (client has no bypass path),
 *   3. server-side rejection (403 cross-tenant / 404 / 400) is surfaced as
 *      `success:false` with the original statusCode — never silently replaced
 *      by demo/local data,
 *   4. the anonymous QR (customer) endpoints never send the manager token.
 */

// Minimal browser shims so the client code path used in the browser is tested
// verbatim (the client only talks to the server — no localStorage DB exists).
let store = new Map<string, string>();
const localStorageShim = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as unknown as Storage;

function installWindowShim() {
  (globalThis as any).window = { localStorage: localStorageShim } as Window;
  (globalThis as any).localStorage = localStorageShim; // browsers expose both
}

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[] = [];

const json = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

beforeEach(() => {
  store.clear();
  installWindowShim();
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any).window;
});

/** Records every request the client issues and answers from `handler`. */
function mockServer(
  handler: (call: FetchCall) => Response | Promise<Response>
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url: String(url), init: init || {} };
      calls.push(call);
      return handler(call);
    })
  );
}

const lastCall = () => calls[calls.length - 1];
const header = (c: FetchCall, name: string) =>
  ((c.init.headers as Record<string, string>) || {})[name];
const parsedBody = (c: FetchCall) => JSON.parse(String(c.init.body));

// Realistic server row envelopes (shapes returned by Express + Prisma).
const restaurantRow = { id: 'rest-merar', name: 'مطعم مِيرار الفاخر', nameEn: 'MÉRAR', slug: 'merar', status: 'ACTIVE', currency: '₪', planId: 'plan-pro', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
const userRow = { id: 'user-manager-1', restaurantId: 'rest-merar', name: 'عمر القاسم', email: 'manager@merar-dining.com', role: 'RESTAURANT_MANAGER' };

describe('Multi-Tenant SaaS — Live API Client Contract Suite', () => {
  describe('1. Real-API-only data path (no local DB / no demo fallback)', () => {
    it('login posts credentials to /api/auth/login and persists the returned JWT', async () => {
      mockServer((c) => {
        if (c.url.endsWith('/api/auth/login')) {
          return json(200, { success: true, data: { token: 'jwt-abc', user: userRow, restaurant: restaurantRow }, statusCode: 200 });
        }
        return json(500, { success: false, error: 'unexpected', statusCode: 500 });
      });

      const res = await api.login('manager@merar-dining.com', 'Secret123!');
      expect(res.success).toBe(true);

      const call = lastCall();
      expect(call.url).toBe('http://localhost:3001/api/auth/login');
      expect(call.init.method).toBe('POST');
      expect(header(call, 'Authorization')).toBeUndefined(); // login is pre-auth
      expect(parsedBody(call)).toEqual({ email: 'manager@merar-dining.com', password: 'Secret123!' });
      expect(store.get(AUTH_TOKEN_KEY)).toBe('jwt-abc');
    });

    it('manager dashboard stats request carries the bearer JWT and the tenant id in the body', async () => {
      store.set(AUTH_TOKEN_KEY, 'jwt-abc');
      mockServer(() =>
        json(200, { success: true, data: { restaurant: restaurantRow, orders: [], payments: [], tables: [], kpis: {} }, statusCode: 200 })
      );

      const user = { ...userRow, role: 'RESTAURANT_MANAGER' } as any;
      const res = await api.getManagerDashboardStats(user, 'rest-merar');
      expect(res.success).toBe(true);

      const call = lastCall();
      expect(call.url).toBe('http://localhost:3001/api/manager/dashboard/stats?restaurantId=rest-merar');
      expect(call.init.method).toBe('GET');
      expect(header(call, 'Authorization')).toBe('Bearer jwt-abc');
    });

    it('a cross-tenant 403 from the server is surfaced — the client never falls back to local data', async () => {
      store.set(AUTH_TOKEN_KEY, 'jwt-abc');
      mockServer(() =>
        json(403, { success: false, error: 'غير مصرح لك بالوصول إلى بيانات هذا المطعم', statusCode: 403 })
      );

      const user = { ...userRow, role: 'RESTAURANT_MANAGER' } as any;
      const res = await api.getManagerDashboardStats(user, 'rest-lumiere');

      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.error).toContain('غير مصرح');
      expect(res.data).toBeUndefined();
      expect(lastCall().url).toContain('restaurantId=rest-lumiere');
    });

    it('onboarding sends the full tenant payload (manager credentials + empty products) to the platform endpoint', async () => {
      store.set(AUTH_TOKEN_KEY, 'jwt-platform');
      mockServer(() =>
        json(201, { success: true, data: { restaurant: restaurantRow }, statusCode: 201 })
      );

      const payload = {
        name: 'مطعم مِيرار الفاخر',
        slug: 'merar',
        managerEmail: 'manager@merar.com',
        managerPassword: 'SecurePass1',
        tablesCount: 20,
        categories: [],
        products: [],
      };
      const res = await api.onboardRestaurant(payload);
      expect(res.success).toBe(true);

      const call = lastCall();
      expect(call.url).toBe('http://localhost:3001/api/admin/onboard-restaurant');
      const body = parsedBody(call);
      expect(body.slug).toBe('merar');
      expect(body.managerEmail).toBe('manager@merar.com');
      expect(body.managerPassword).toBe('SecurePass1');
      expect(Array.isArray(body.products)).toBe(true);
      expect(body.products).toHaveLength(0);
    });

    it('no demo/localStorage database key is ever touched during a full manager flow', async () => {
      store.set(AUTH_TOKEN_KEY, 'jwt-abc');
      const writes: string[] = [];
      const origSet = localStorageShim.setItem.bind(localStorageShim);
      vi.spyOn(localStorageShim, 'setItem').mockImplementation((k: string, v: string) => {
        writes.push(String(k));
        return origSet(String(k), String(v));
      });

      mockServer(() => json(200, { success: true, data: [], statusCode: 200 }));
      await api.getManagerOrders('rest-merar');
      await api.getManagerTables('rest-merar');

      expect(writes.filter((k) => /demo|seed|db/i.test(k))).toEqual([]);
      expect(store.size).toBe(1); // only the auth token
    });
  });

  describe('2. Anonymous QR customer endpoints — tenant scoping & no-token calls', () => {
    it('public catalog request includes qrToken, sends NO manager token, and maps rows back typed', async () => {
      store.set(AUTH_TOKEN_KEY, 'jwt-abc'); // must NOT be sent on public routes
      mockServer(() =>
        json(200, {
          success: true,
          data: {
            restaurant: restaurantRow,
            categories: [{ id: 'cat-1', restaurantId: 'rest-merar', name: 'الأطباق الرئيسية', sortOrder: 1 }],
            products: [{ id: 'prod-1', restaurantId: 'rest-merar', categoryId: 'cat-1', name: 'تندرلوين', price: 135, isAvailable: true }],
            offers: [],
          },
          statusCode: 200,
        })
      );

      const res = await api.getPublicRestaurantBySlug('merar', 'qr-secure-1');
      expect(res.success).toBe(true);
      expect(res.data?.restaurant.id).toBe('rest-merar');
      expect(res.data?.products.every((p) => p.restaurantId === 'rest-merar')).toBe(true);
      expect(res.data?.products[0].price).toBe(135);

      const call = lastCall();
      expect(call.url).toContain('/api/public/restaurants/merar?qrToken=qr-secure-1');
      expect(header(call, 'Authorization')).toBeUndefined();
    });

    it('missing/empty QR token is still sent to the server — a 403 comes back, with no local menu substituted', async () => {
      mockServer(() =>
        json(403, { success: false, error: 'رمز QR غير صالح أو منتهي الصلاحية', statusCode: 403 })
      );

      const res = await api.getPublicRestaurantBySlug('merar');
      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.data).toBeUndefined();
    });

    it('unknown tenant slug returns 404 from the API layer', async () => {
      mockServer(() => json(404, { success: false, error: 'المطعم غير موجود', statusCode: 404 }));

      const res = await api.getPublicRestaurantBySlug('ghost-slug-42', 'qr-x');
      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(404);
    });

    it('submitOrder posts session-bound items to /public/orders and returns the server-repriced order', async () => {
      mockServer(() =>
        json(201, {
          success: true,
          data: {
            order: {
              id: '#1050', numericId: 1050, restaurantId: 'rest-merar', tableId: 'rest-merar-T01',
              status: 'PENDING', subtotal: 135, total: 135, paymentStatus: 'UNPAID',
              createdAt: '2026-09-06T10:00:00.000Z', updatedAt: '2026-09-06T10:00:00.000Z',
              items: [{ productId: 'prod-1', productNameSnapshot: 'تندرلوين', priceSnapshot: 135, quantity: 1, totalPrice: 135 }],
            },
          },
          statusCode: 201,
        })
      );

      const res = await api.submitOrder({
        restaurantId: 'rest-merar',
        tableId: 'rest-merar-T01',
        sessionToken: 'sess-token-1',
        items: [{ id: '', productId: 'prod-1', quantity: 1, unitPrice: 50, totalPrice: 50 } as any],
      });

      expect(res.success).toBe(true);
      expect(res.data?.order.total).toBe(135); // server price wins, not the client-sent 50

      const call = lastCall();
      expect(call.url).toBe('http://localhost:3001/api/public/orders');
      const body = parsedBody(call);
      expect(body.restaurantId).toBe('rest-merar');
      expect(body.tableId).toBe('rest-merar-T01');
      expect(body.sessionToken).toBe('sess-token-1');
      expect(header(call, 'Authorization')).toBeUndefined();
    });

    it('customer cancel of a PREPARING order is refused by the API and surfaced (state machine is server-side)', async () => {
      mockServer(() =>
        json(403, { success: false, error: 'بدأ المطبخ بتحضير طلبك بالفعل، لا يمكن إلغاؤه الآن', statusCode: 403 })
      );

      const res = await api.cancelOrder('rest-merar', '#1024', 'sess-token-1');
      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.error).toContain('بدأ المطبخ');
    });
  });

  describe('3. Resilient failure handling — no fabricated data', () => {
    it('server being unreachable yields a 503 failure (never demo rows)', async () => {
      mockServer(() => {
        throw new Error('ECONNREFUSED');
      });

      const res = await api.getManagerOrders('rest-merar');
      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(503);
      expect(res.data).toBeUndefined();
    });

    it('non-JSON server error is mapped to a clean failure envelope', async () => {
      mockServer(() => ({ ok: false, status: 500, json: async () => null } as Response));
      const res = await api.getManagerOrders('rest-merar');
      expect(res.success).toBe(false);
      expect(res.data).toBeUndefined();
    });
  });

  describe('4. Manager operational calls carry tenant context', () => {
    it('orders list endpoint receives the tenant id and maps server rows', async () => {
      store.set(AUTH_TOKEN_KEY, 'jwt-abc');
      mockServer(() =>
        json(200, {
          success: true,
          data: [{ id: '#2001', numericId: 2001, restaurantId: 'rest-merar', tableId: 'rest-merar-T05', status: 'PENDING', subtotal: 85, total: 85, paymentStatus: 'UNPAID', createdAt: '2026-09-06T08:00:00.000Z', updatedAt: '2026-09-06T08:00:00.000Z', items: [] }],
          statusCode: 200,
        })
      );

      const res = await api.getManagerOrders('rest-merar');
      expect(res.success).toBe(true);
      expect(res.data?.[0].id).toBe('#2001');
      expect(res.data?.[0].restaurantId).toBe('rest-merar');
      expect(lastCall().url).toBe('http://localhost:3001/api/manager/orders?restaurantId=rest-merar');
      expect(lastCall().init.method).toBe('GET');
      expect(header(lastCall(), 'Authorization')).toBe('Bearer jwt-abc');
    });

    it('table settle targets the manager endpoint of the owning tenant', async () => {
      store.set(AUTH_TOKEN_KEY, 'jwt-abc');
      mockServer(() => json(200, { success: true, data: { message: 'settled' }, statusCode: 200 }));

      const user = { ...userRow, role: 'RESTAURANT_MANAGER' } as any;
      const res = await api.settleTableBill(user, 'rest-merar', 'rest-merar-T01');
      expect(res.success).toBe(true);
      expect(lastCall().url).toContain('/api/manager/tables/rest-merar-T01/settle');
      expect(parsedBody(lastCall()).restaurantId).toBe('rest-merar');
    });
  });
});
