import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const db = vi.hoisted(() => ({
  tableSession: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  table: {
    findUnique: vi.fn(),
  },
  order: {
    findMany: vi.fn(),
  },
}));

vi.mock('../../server/db/prisma', () => ({ prisma: db }));

const now = new Date('2026-09-17T09:00:00.000Z');
const restaurant = {
  id: 'restaurant-a',
  slug: 'restaurant-a',
  name: 'مطعم أ',
  nameEn: 'Restaurant A',
  status: 'ACTIVE',
  businessType: 'RESTAURANT',
  logoUrl: '',
  coverImageUrl: null,
  mapImageUrl: null,
  galleryImages: [],
  logoFit: 'contain',
  logoPosition: '50% 50%',
  primaryColor: '#112233',
  accentColor: '#445566',
};
const table = {
  id: 'table-a-1',
  restaurantId: restaurant.id,
  number: 1,
  name: 'T1',
  capacity: 4,
  zone: 'MAIN_HALL',
  status: 'AVAILABLE',
  qrToken: 'physical-qr-capability',
  restaurant,
};
const session = {
  id: 'session-a-1',
  restaurantId: restaurant.id,
  tableId: table.id,
  sessionToken: 'guest-session-capability-01',
  status: 'ACTIVE',
  startedAt: now,
  endedAt: null as Date | null,
  expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  createdAt: now,
};
const order = {
  id: '#1001',
  numericId: 1001,
  restaurantId: restaurant.id,
  tableId: table.id,
  sessionId: session.id,
  subtotal: 25,
  total: 25,
  status: 'PENDING',
  paymentMethod: 'PAY AT CASHIER',
  paymentStatus: 'UNPAID',
  paymentProofPath: null,
  paymentRejectedAt: null,
  paymentRejectionReason: null,
  fulfillmentState: 'AWAITING_PAYMENT',
  releasedAt: null as Date | null,
  notes: null,
  estimatedPrepMinutes: 15,
  createdAt: now,
  updatedAt: now,
  items: [
    {
      id: 'item-1',
      productId: 'product-1',
      productNameSnapshot: 'طبق',
      productNameEnSnapshot: 'Dish',
      priceSnapshot: 25,
      quantity: 1,
      totalPrice: 25,
      selectedSize: null,
      selectedAddOns: [],
      removedIngredients: [],
      specialInstructions: null,
    },
  ],
};

function statusMatches(filter: unknown, status: string): boolean {
  if (typeof filter === 'string') return filter === status;
  if (filter && typeof filter === 'object' && 'in' in filter) {
    return Array.isArray((filter as { in: unknown }).in) &&
      ((filter as { in: string[] }).in).includes(status);
  }
  return true;
}

function installSessionLookup() {
  db.tableSession.findFirst.mockImplementation(async ({ where }: { where: Record<string, any> }) => {
    const matches =
      where.sessionToken === session.sessionToken &&
      where.restaurantId === session.restaurantId &&
      where.tableId === session.tableId &&
      statusMatches(where.status, session.status) &&
      (!where.expiresAt?.gt || session.expiresAt > where.expiresAt.gt);
    return matches ? { ...session } : null;
  });
}

let server: Server | null = null;
let baseUrl = '';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-only-guest-tracking-secret-32-chars';
  const { default: publicRoutes } = await import('../../server/routes/public');
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicRoutes);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  session.status = 'ACTIVE';
  session.endedAt = null;
  order.status = 'PENDING';
  order.paymentStatus = 'UNPAID';
  order.fulfillmentState = 'AWAITING_PAYMENT';
  order.releasedAt = null;
  order.updatedAt = now;
  installSessionLookup();
  db.table.findUnique.mockImplementation(async ({ where }: { where: { qrToken?: string } }) =>
    where.qrToken === table.qrToken ? { ...table, restaurant: { ...restaurant } } : null
  );
  db.tableSession.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...session,
    ...data,
  }));
  db.order.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    where.restaurantId === order.restaurantId &&
    where.tableId === order.tableId &&
    where.sessionId === order.sessionId
      ? [{ ...order, items: order.items.map((item) => ({ ...item })) }]
      : []
  );
});

async function track(params: {
  restaurantId?: string;
  tableId?: string;
  sessionToken?: string;
} = {}) {
  const restaurantId = params.restaurantId ?? restaurant.id;
  const tableId = params.tableId ?? table.id;
  const sessionToken = params.sessionToken ?? session.sessionToken;
  const query = new URLSearchParams({ restaurantId, sessionToken });
  return fetch(`${baseUrl}/api/public/tables/${encodeURIComponent(tableId)}/orders?${query}`);
}

async function trackedOrder() {
  const response = await track();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.data).toHaveLength(1);
  return body.data[0] as Record<string, unknown>;
}

describe('F-01 · actual public tracking route', () => {
  it('returns PAID/RELEASED → PREPARING → READY through a CLOSED session and reload', async () => {
    expect(await trackedOrder()).toMatchObject({
      id: order.id,
      paymentStatus: 'UNPAID',
      fulfillmentState: 'AWAITING_PAYMENT',
      status: 'PENDING',
    });

    // Cash settlement changes all three axes independently.
    session.status = 'CLOSED';
    session.endedAt = new Date('2026-09-17T09:05:00.000Z');
    order.paymentStatus = 'PAID';
    order.fulfillmentState = 'RELEASED';
    order.releasedAt = session.endedAt;
    order.updatedAt = session.endedAt;
    expect(await trackedOrder()).toMatchObject({
      paymentStatus: 'PAID',
      fulfillmentState: 'RELEASED',
      status: 'PENDING',
    });

    order.status = 'PREPARING';
    expect(await trackedOrder()).toMatchObject({ status: 'PREPARING' });

    order.status = 'READY';
    expect(await trackedOrder()).toMatchObject({ status: 'READY' });

    // Browser reload presents the capability saved in sessionStorage. The
    // session endpoint returns that same CLOSED owner; it does not reopen it or
    // hand a fresh scanner access to this order.
    const reloadResponse = await fetch(
      `${baseUrl}/api/public/tables/qr/${table.qrToken}/session`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: restaurant.slug,
          restaurantId: restaurant.id,
          resumeSessionToken: session.sessionToken,
        }),
      }
    );
    const reloadBody = await reloadResponse.json();
    expect(reloadResponse.status).toBe(200);
    expect(reloadBody.data).toMatchObject({
      sessionId: session.id,
      sessionToken: session.sessionToken,
      sessionStatus: 'CLOSED',
    });
    expect(db.tableSession.create).not.toHaveBeenCalled();
    expect(await trackedOrder()).toMatchObject({ id: order.id, status: 'READY' });
  });

  it('rejects invalid, wrong-table, and wrong-tenant session access', async () => {
    for (const response of [
      await track({ sessionToken: 'invalid-session-capability' }),
      await track({ restaurantId: 'restaurant-b' }),
      await track({ tableId: 'table-a-2' }),
    ]) {
      expect(response.status).toBe(403);
      expect((await response.json()).success).toBe(false);
    }
    expect(db.order.findMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid resume capability instead of exposing the active session', async () => {
    const response = await fetch(
      `${baseUrl}/api/public/tables/qr/${table.qrToken}/session`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: restaurant.id,
          resumeSessionToken: 'wrong-tenant-session-capability',
        }),
      }
    );
    expect(response.status).toBe(403);
    expect((await response.json()).success).toBe(false);
    expect(db.tableSession.create).not.toHaveBeenCalled();
  });

  it('keeps the existing active-session transfer flow trackable', async () => {
    order.paymentStatus = 'PENDING_VERIFICATION';
    order.fulfillmentState = 'PAYMENT_VERIFICATION_PENDING';
    expect(await trackedOrder()).toMatchObject({
      paymentStatus: 'PENDING_VERIFICATION',
      fulfillmentState: 'PAYMENT_VERIFICATION_PENDING',
    });

    order.paymentStatus = 'PAID';
    order.fulfillmentState = 'RELEASED';
    order.releasedAt = new Date('2026-09-17T09:10:00.000Z');
    expect(await trackedOrder()).toMatchObject({
      paymentStatus: 'PAID',
      fulfillmentState: 'RELEASED',
      status: 'PENDING',
    });
    expect(session.status).toBe('ACTIVE');
  });
});
