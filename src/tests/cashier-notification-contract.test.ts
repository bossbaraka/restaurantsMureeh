import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api, AUTH_TOKEN_KEY } from '../services/api';
import {
  paymentConfirmSchema,
  paymentRejectSchema,
  tableSettleSchema,
  paymentCreateSchema,
} from '../../server/validation/schemas';

/**
 * THE CASHIER'S TWO DECISIONS — «تأكيد الدفع» and «رفض الإشعار».
 *
 * A guest notification used to be un-actionable: both buttons answered with
 * «تعذر تأكيد الدفع» / «تعذر رفض الإشعار» even though nothing about the order was
 * wrong. Root cause: the shared API client appends the tenant id to every
 * manager body (`{ restaurantId, … }`) and these route bodies are `.strict()`
 * — an unknown key is a rejection, so the request died in `validateBody` with
 * an HTTP 400 before the route ever looked at the payment.
 *
 * What no check covered at the time: the client's REAL serialized body against
 * the server's REAL schema. Unit tests grepped route source; the live-preview
 * world faked HTTP and skipped the schemas ("the client sends only what the
 * schemas accept"). So the contract could drift with everything green.
 *
 * This suite closes that gap in both directions:
 *   1. every body the till sends must parse under the schema the route uses;
 *   2. a server-side SUCCESS must never be rendered as a failure (the
 *      idempotent `alreadyConfirmed` replay carries no ledger row).
 */

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

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
const parsedBody = (c: FetchCall = lastCall()) => JSON.parse(String(c.init.body));

const TENANT = 'rest-merar';
const ORDER_ID = '#1001';

const cashier: any = {
  id: 'user-cashier-merar',
  restaurantId: TENANT,
  name: 'سالم',
  email: 'cashier@merar-dining.com',
  role: 'CASHIER',
};

const paymentRow = {
  id: 'pay-1',
  receiptNumber: 'RC-2026-0007',
  restaurantId: TENANT,
  tableId: 'rest-merar-T02',
  tableLabel: 'طاولة 2',
  orderIds: [ORDER_ID],
  method: 'TRANSFER',
  subtotal: 100,
  tax: 0,
  total: 100,
  cashierName: 'سالم',
  createdAt: '2026-09-14T10:00:00.000Z',
};

/** A zod failure carries only "Unrecognized key" strings, so print the issues. */
const expectAccepted = (
  schema: { safeParse(v: unknown): { success: boolean; error?: any } },
  body: unknown,
  label: string
) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `${label}: the server rejects this body with 400 — ${JSON.stringify(parsed.error.issues)}`
    );
  }
};

describe('cashier notification endpoints — client body vs server schema', () => {
  beforeEach(() => {
    store = new Map();
    calls = [];
    store.set(AUTH_TOKEN_KEY, 'jwt-cashier');
    (globalThis as any).window = { localStorage: localStorageShim } as Window;
    (globalThis as any).localStorage = localStorageShim;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  });

  it('POST …/payment/confirm sends a body the strict schema accepts', async () => {
    mockServer(() =>
      json(201, {
        success: true,
        data: {
          payment: paymentRow,
          orderId: ORDER_ID,
          orderStatus: 'PENDING',
          kitchenReleased: true,
          fulfillmentState: 'RELEASED',
        },
        statusCode: 201,
      })
    );

    const res = await api.confirmTransferPayment(cashier, TENANT, ORDER_ID);
    expect(res.success).toBe(true);
    expect(lastCall().url).toContain(`/manager/orders/${encodeURIComponent(ORDER_ID)}/payment/confirm`);

    const body = parsedBody();
    expectAccepted(paymentConfirmSchema, body, 'payment/confirm body');
    // The tenant id the client carries is decoration: the route resolves the
    // tenant from the JWT and must not be steered by the body.
    expect(body.restaurantId).toBe(TENANT);
    // …and no money/state field is ever client-supplied.
    expect(body).not.toHaveProperty('paymentStatus');
    expect(body).not.toHaveProperty('fulfillmentState');
    expect(body).not.toHaveProperty('total');
  });

  it('POST …/payment/confirm accepts an optional cashier note alongside it', async () => {
    mockServer(() => json(201, { success: true, data: { payment: paymentRow }, statusCode: 201 }));
    await api.confirmTransferPayment(cashier, TENANT, ORDER_ID, 'طابق إشعار البنك');
    expectAccepted(paymentConfirmSchema, parsedBody(), 'payment/confirm body with note');
  });

  it('POST …/payment/reject sends a body the strict schema accepts (with and without a reason)', async () => {
    mockServer(() =>
      json(200, {
        success: true,
        data: {
          orderId: ORDER_ID,
          paymentStatus: 'UNPAID',
          fulfillmentState: 'PAYMENT_REJECTED',
        },
        statusCode: 200,
      })
    );

    const withReason = await api.rejectTransferPayment(cashier, TENANT, ORDER_ID, 'الإشعار غير واضح');
    expect(withReason.success).toBe(true);
    expect(withReason.data?.fulfillmentState).toBe('PAYMENT_REJECTED');
    expectAccepted(paymentRejectSchema, parsedBody(), 'payment/reject body');

    const withoutReason = await api.rejectTransferPayment(cashier, TENANT, ORDER_ID);
    expect(withoutReason.success).toBe(true);
    expectAccepted(paymentRejectSchema, parsedBody(), 'payment/reject body (no reason)');
  });

  it('POST /manager/tables/:id/settle also satisfies its strict schema', async () => {
    // The same defect closed the counter's "تصفية الطاولة" action: it is pinned
    // here so the whole family of manager bodies stays contract-checked.
    mockServer(() => json(200, { success: true, data: { orderIds: [ORDER_ID] }, statusCode: 200 }));
    const res = await api.settleTableBill(cashier, TENANT, 'rest-merar-T02', 'CASH');
    expect(res.success).toBe(true);
    expectAccepted(tableSettleSchema, parsedBody(), 'tables/:id/settle body');
  });

  it('POST /manager/payments (cash collection that releases a held bill) is accepted too', async () => {
    mockServer(() => json(201, { success: true, data: { payment: paymentRow }, statusCode: 201 }));
    await api.processPayment(cashier, TENANT, {
      tableId: 'rest-merar-T02',
      orderIds: [ORDER_ID],
      method: 'CASH',
      cashReceived: 100,
    });
    expectAccepted(paymentCreateSchema, parsedBody(), 'payments body');
  });
});

describe('the till must never read a server success as a failure', () => {
  beforeEach(() => {
    store = new Map();
    calls = [];
    store.set(AUTH_TOKEN_KEY, 'jwt-cashier');
    (globalThis as any).window = { localStorage: localStorageShim } as Window;
    (globalThis as any).localStorage = localStorageShim;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  });

  it('200 { alreadyConfirmed, payment: null } is a SUCCESS with no receipt line', async () => {
    mockServer(() =>
      json(200, {
        success: true,
        data: {
          payment: null,
          orderId: ORDER_ID,
          orderStatus: 'PENDING',
          kitchenReleased: true,
          fulfillmentState: 'RELEASED',
          alreadyConfirmed: true,
        },
        statusCode: 200,
      })
    );

    const res = await api.confirmTransferPayment(cashier, TENANT, ORDER_ID);
    // The money is settled and the gate is open — reporting «تعذر تأكيد الدفع»
    // here invites a second settlement attempt on a paid order.
    expect(res.success).toBe(true);
    expect(res.data?.alreadyConfirmed).toBe(true);
    expect(res.data?.payment).toBeNull();
    expect(res.data?.kitchenReleased).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('a server refusal keeps its own Arabic reason for the toast', async () => {
    mockServer(() =>
      json(409, { success: false, error: 'تم تأكيد دفع هذا الطلب مسبقاً.', statusCode: 409 })
    );
    const res = await api.confirmTransferPayment(cashier, TENANT, ORDER_ID);
    expect(res.success).toBe(false);
    expect(res.error).toBe('تم تأكيد دفع هذا الطلب مسبقاً.');
  });
});

describe('PaymentVerificationPanel — decision handling', () => {
  const panel = source('../components/manager/PaymentVerificationPanel.tsx');

  it('branches on the server verdict, and reads a possibly-absent receipt defensively', () => {
    expect(panel).toContain('if (res.success) {');
    // No unguarded property path into the (nullable) receipt.
    expect(panel).not.toMatch(/res\.data\.payment\.\w/);
    expect(panel).toContain('const receipt = res.data?.payment || null;');
    expect(panel).toContain('receipt.receiptNumber');
    // A replay is reported as what it is, not as a fresh confirmation.
    expect(panel).toContain('كان هذا الإشعار مؤكداً مسبقاً');
  });

  it('names both failures with the server reason as the message body', () => {
    expect(panel).toContain("'تعذر تأكيد الدفع'");
    expect(panel).toContain("'تعذر رفض الإشعار'");
    expect(panel).toMatch(/res\.error \|\| 'لم يقبل الخادم التأكيد/);
    expect(panel).toMatch(/res\.error \|\| 'لم يقبل الخادم الرفض/);
  });

  it('states that a rejected receipt keeps the order out of the kitchen', () => {
    expect(panel).toContain('الطلب بقي خارج المطبخ');
  });
});
