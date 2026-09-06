import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, AUTH_TOKEN_KEY } from '../services/api';

/**
 * Cashier / POS — Live API Client Contract Suite
 * ------------------------------------------------
 * The POS never reads or writes a local database. Every receipt, order and
 * payment is created by the tenant-scoped manager API; the server re-prices
 * items from the real DB menu and rejects empty/foreign requests. This suite
 * locks the client contract (endpoint, method, JWT, tenant id, payload) and
 * the pass-through of server-side validation errors.
 */

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

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[] = [];

const json = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

function mockServer(handler: (c: FetchCall) => Response | Promise<Response>) {
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

const manager: any = {
  id: 'user-manager-merar',
  restaurantId: 'rest-merar',
  name: 'عمر القاسم',
  email: 'manager@merar-dining.com',
  role: 'RESTAURANT_MANAGER',
};

const orderRow = (id: string) => ({
  id,
  numericId: Number(id.replace('#', '')),
  restaurantId: 'rest-merar',
  tableId: 'rest-merar-T02',
  status: 'PENDING',
  paymentStatus: 'UNPAID',
  paymentMethod: 'PAY AT CASHIER',
  subtotal: 220,
  total: 220,
  createdAt: '2026-09-06T10:00:00.000Z',
  updatedAt: '2026-09-06T10:00:00.000Z',
  items: [
    { productId: 'prod-sig-1', productNameSnapshot: 'تندرلوين بلاك أنغوس', priceSnapshot: 135, quantity: 1, totalPrice: 135 },
    { productId: 'prod-app-1', productNameSnapshot: 'مقبلات ملكية', priceSnapshot: 85, quantity: 1, totalPrice: 85 },
  ],
});

beforeEach(() => {
  store.clear();
  store.set(AUTH_TOKEN_KEY, 'jwt-pos');
  (globalThis as any).window = { localStorage: localStorageShim } as Window;
  (globalThis as any).localStorage = localStorageShim;
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any).window;
});

describe('Cashier / POS & Payment — Live API Contract', () => {
  it('createManagerOrder posts cart items + table to /api/manager/orders with the JWT and tenant id', async () => {
    mockServer(() =>
      json(201, { success: true, data: { order: orderRow('#2050') }, statusCode: 201 })
    );

    const res = await api.createManagerOrder(manager, 'rest-merar', 'rest-merar-T02', [
      { id: 'i1', productId: 'prod-sig-1', productName: 'تندرلوين بلاك أنغوس', quantity: 1, unitPrice: 135, totalPrice: 135 } as any,
      { id: 'i2', productId: 'prod-app-1', productName: 'مقبلات ملكية', quantity: 1, unitPrice: 85, totalPrice: 85 } as any,
    ], 'ملاحظة كاشير');

    expect(res.success).toBe(true);
    expect(res.data?.order.id).toBe('#2050');
    expect(res.data?.order.items).toHaveLength(2);

    const call = lastCall();
    expect(call.url).toBe('http://localhost:3001/api/manager/orders');
    expect(call.init.method).toBe('POST');
    expect(header(call, 'Authorization')).toBe('Bearer jwt-pos');
    const body = parsedBody(call);
    expect(body.restaurantId).toBe('rest-merar');
    expect(body.tableId).toBe('rest-merar-T02');
    expect(body.items).toHaveLength(2);
    expect(body.notes).toBe('ملاحظة كاشير');
  });

  it('walk-in counter sale targets the same staff endpoint with the walk-in marker table', async () => {
    mockServer(() =>
      json(201, { success: true, data: { order: orderRow('#2051') }, statusCode: 201 })
    );

    const res = await api.createManagerOrder(manager, 'rest-merar', '__WALKIN__', [
      { id: 'i3', productId: 'prod-sig-1', productName: 'تندرلوين', quantity: 2, unitPrice: 135, totalPrice: 270 } as any,
    ]);

    expect(res.success).toBe(true);
    const body = parsedBody(lastCall());
    expect(body.tableId).toBe('__WALKIN__');
    expect(res.data?.order.tableId).toBe('rest-merar-T02'); // server envelope wins verbatim
  });

  it('server-side empty-cart rejection (400) is surfaced to the cashier, nothing is stored locally', async () => {
    mockServer(() =>
      json(400, { success: false, error: 'لا يمكن دفع فاتورة فارغة (0 صنف)', statusCode: 400 })
    );

    const res = await api.processPayment(manager, 'rest-merar', {
      tableId: 'rest-merar-T03',
      orderIds: [],
      method: 'CASH',
      cashReceived: 0,
    });

    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.error).toContain('فارغة');
    expect(res.data).toBeUndefined();
  });

  it('cash payment posts method/cashReceived/orderIds and maps the receipt with change', async () => {
    mockServer(() =>
      json(201, {
        success: true,
        data: {
          message: 'تم الدفع',
          payment: {
            id: 'pay-9001',
            receiptNumber: 'RC-9001',
            tableId: 'rest-merar-T02',
            tableLabel: 'طاولة 02',
            orderIds: ['#2050'],
            method: 'CASH',
            subtotal: 220,
            total: 220,
            cashReceived: 300,
            changeDue: 80,
            cashierName: 'كاشير ميرار',
            restaurantId: 'rest-merar',
            createdAt: '2026-09-06T11:00:00.000Z',
          },
        },
        statusCode: 201,
      })
    );

    const res = await api.processPayment(manager, 'rest-merar', {
      tableId: 'rest-merar-T02',
      orderIds: ['#2050'],
      method: 'CASH',
      cashReceived: 300,
    });

    expect(res.success).toBe(true);
    const payment = res.data?.payment;
    expect(payment?.receiptNumber).toBe('RC-9001');
    expect(payment?.changeDue).toBe(80);
    expect(payment?.method).toBe('CASH');
    expect(payment?.restaurantId).toBe('rest-merar');

    const body = parsedBody(lastCall());
    expect(body.restaurantId).toBe('rest-merar');
    expect(body.method).toBe('CASH');
    expect(body.cashReceived).toBe(300);
    expect(body.orderIds).toEqual(['#2050']);
  });

  it('payment ledger read is tenant-scoped in the query string; foreign-tenant 403 propagates', async () => {
    mockServer(() =>
      json(403, { success: false, error: 'غير مصرح لك بالوصول إلى سجل مدفوعات مطعم آخر', statusCode: 403 })
    );

    const foreign = await api.getPayments(manager, 'rest-lumiere');
    expect(foreign.success).toBe(false);
    expect(foreign.statusCode).toBe(403);
    expect(lastCall().url).toBe('http://localhost:3001/api/manager/payments?restaurantId=rest-lumiere');
    expect(header(lastCall(), 'Authorization')).toBe('Bearer jwt-pos');
  });

  it('receipt numbering and totals come from the server envelope — the client never fabricates them', async () => {
    mockServer(() =>
      json(201, {
        success: true,
        data: {
          payment: {
            id: 'pay-9002',
            receiptNumber: 'RC-9002',
            tableId: 'rest-merar-T05',
            tableLabel: 'طاولة 05',
            orderIds: ['#2052'],
            method: 'CARD',
            subtotal: 84,
            total: 84,
            cashierName: 'كاشير ميرار',
            restaurantId: 'rest-merar',
            createdAt: '2026-09-06T11:05:00.000Z',
          },
        },
        statusCode: 201,
      })
    );

    // Client supplies no receipt number / no total — only the server decides.
    const res = await api.processPayment(manager, 'rest-merar', {
      tableId: 'rest-merar-T05',
      orderIds: ['#2052'],
      method: 'CARD',
    });

    expect(res.success).toBe(true);
    expect(res.data?.payment.receiptNumber).toBe('RC-9002');
    expect(res.data?.payment.total).toBe(84);
    const body = parsedBody(lastCall());
    expect(body.receiptNumber).toBeUndefined();
    expect(body.total).toBeUndefined();
  });

  it('open order list for the cashier is read via the manager orders API (no local order book)', async () => {
    mockServer(() =>
      json(200, { success: true, data: [orderRow('#2049'), orderRow('#2050')], statusCode: 200 })
    );

    const res = await api.getManagerOrders('rest-merar');
    expect(res.success).toBe(true);
    expect(res.data?.length).toBe(2);
    expect(res.data?.every((o) => o.restaurantId === 'rest-merar')).toBe(true);
    expect(lastCall().url).toBe('http://localhost:3001/api/manager/orders?restaurantId=rest-merar');
  });
});
