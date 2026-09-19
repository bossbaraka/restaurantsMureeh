import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config as loadDotenv } from 'dotenv';

/**
 * Walk-in (counter) sales — real-PostgreSQL integration gate.
 *
 * Regression map (TEST findings + P1-A):
 *   P1-A   → '__WALKIN__' is an INPUT sentinel only. Persisting the literal
 *             used to violate the Order→Table FK and 500. Counter orders must
 *             be stored as tableId NULL + orderSource COUNTER.
 *   Settle → a walk-in bill (POST /payments with tableId='__WALKIN__') must
 *             collect the counter order; the old mixed-table guard compared
 *             against the sentinel and rejected every counter bill.
 *   Isolation → counter orders never appear under a physical table's bills
 *             and vice versa; table orders keep orderSource TABLE.
 *   KDS    → the orders list carries orderSource so the KDS can badge
 *             counter tickets.
 */

loadDotenv();

const RUN = process.env.DATABASE_URL ? 'on' : 'off';
const hasDb = RUN === 'on';

describe('walk-in POS integration gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
  });
});

describe.skipIf(!hasDb)('Walk-in counter orders (real PostgreSQL)', () => {
  type App = ReturnType<typeof import('express')>;
  let app: App;
  let server: import('http').Server;
  let base: string;
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;

  const call = async (method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  beforeAll(async () => {
    const { default: express } = await import('express');
    const authRouter = (await import('../../server/routes/auth')).default;
    const managerRouter = (await import('../../server/routes/manager')).default;
    const { authenticateToken } = await import('../../server/middleware/auth');
    ({ prisma } = await import('../../server/db/prisma'));
    const bcrypt = await import('bcryptjs');

    const run = `walkin${Date.now().toString(36)}`;
    const idA = `rest-${run}`;
    ctx = {
      run, idA, slugA: `walkin-${run}`,
      pinCashier: '592614',
      tableId: `tbl-${run}`,
      productId: `prod-${run}`,
    };

    await prisma.restaurant.create({
      data: {
        id: idA, slug: ctx.slugA, name: `Walk-in ${run}`, logoUrl: '', description: 'walkin test',
        phone: '0000000000', address: 'Test', galleryImages: [], status: 'ACTIVE',
      },
    });
    await prisma.restaurantUser.create({
      data: {
        id: `cashier-${run}`, restaurantId: idA, name: 'Counter Cashier', username: `cashier.${run}`,
        // passwordHash is NOT NULL in the schema; PIN-only accounts store an
        // unguessable filler (same convention as POST /staff).
        passwordHash: bcrypt.hashSync(`no-password-${run}-${crypto.randomUUID()}`, 10),
        pinHash: bcrypt.hashSync(ctx.pinCashier, 10), role: 'CASHIER', status: 'ACTIVE',
      },
    });
    await prisma.table.create({
      data: { id: ctx.tableId, restaurantId: idA, name: 'طاولة 1', number: 1, capacity: 4 },
    });
    const cat = await prisma.category.create({
      data: { restaurantId: idA, name: 'مشروبات', nameEn: 'Drinks', sortOrder: 1 },
    });
    await prisma.product.create({
      data: { restaurantId: idA, categoryId: cat.id, name: 'قهوة', nameEn: 'Coffee', description: 'اختبار', price: 12.5, imageUrl: '', available: true },
    });
    const created = await prisma.product.findFirstOrThrow({ where: { restaurantId: idA, name: 'قهوة' } });
    ctx.productId = created.id;

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/auth', authenticateToken, authRouter);
    app.use('/api/manager', authenticateToken, managerRouter);
    server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;

    const login = await call('POST', '/api/auth/employee-login', {
      body: { restaurantCode: ctx.slugA, username: `cashier.${run}`, pin: ctx.pinCashier },
    });
    expect(login.status).toBe(200);
    ctx.token = login.json.data.token;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (ctx?.run) {
      await prisma.order.deleteMany({ where: { restaurantId: ctx.idA } });
      await prisma.payment.deleteMany({ where: { restaurantId: ctx.idA } });
      await prisma.product.deleteMany({ where: { restaurantId: ctx.idA } });
      await prisma.category.deleteMany({ where: { restaurantId: ctx.idA } });
      await prisma.table.deleteMany({ where: { restaurantId: ctx.idA } });
      await prisma.restaurantUser.deleteMany({ where: { restaurantId: ctx.idA } });
      await prisma.restaurant.deleteMany({ where: { id: ctx.idA } });
    }
    await prisma.$disconnect?.();
  });

  it('creates a counter order from the __WALKIN__ sentinel (no FK 500)', async () => {
    const r = await call('POST', '/api/manager/orders', {
      token: ctx.token,
      body: {
        restaurantId: ctx.idA,
        tableId: '__WALKIN__',
        clientRequestId: crypto.randomUUID(),
        items: [{ productId: ctx.productId, quantity: 2 }],
      },
    });
    expect(r.status).toBe(201);
    const order = r.json.data?.order ?? r.json.data ?? r.json;
    expect(order.tableId).toBeNull();
    expect(order.orderSource).toBe('COUNTER');
    expect(order.total).toBe(25);
    ctx.walkinOrder = { id: order.id, total: order.total };
  });

  it('creates a regular table order with orderSource TABLE and the real tableId', async () => {
    const r = await call('POST', '/api/manager/orders', {
      token: ctx.token,
      body: {
        restaurantId: ctx.idA,
        tableId: ctx.tableId,
        clientRequestId: crypto.randomUUID(),
        items: [{ productId: ctx.productId, quantity: 1 }],
      },
    });
    expect(r.status).toBe(201);
    const order = r.json.data?.order ?? r.json.data ?? r.json;
    expect(order.tableId).toBe(ctx.tableId);
    expect(order.orderSource).toBe('TABLE');
    expect(order.total).toBe(12.5);
    ctx.tableOrder = { id: order.id };
  });

  it('lists both tickets with their orderSource (KDS badging)', async () => {
    const r = await call('GET', `/api/manager/orders?restaurantId=${ctx.idA}`, { token: ctx.token });
    expect(r.status).toBe(200);
    const orders = r.json.data ?? r.json.orders ?? r.json;
    const list = Array.isArray(orders) ? orders : orders.orders;
    const counter = list.find((o: any) => o.id === ctx.walkinOrder.id);
    const table = list.find((o: any) => o.id === ctx.tableOrder.id);
    expect(counter?.orderSource).toBe('COUNTER');
    expect(table?.orderSource).toBe('TABLE');
  });

  it('settles the walk-in bill through the __WALKIN__ collection path', async () => {
    const r = await call('POST', '/api/manager/payments', {
      token: ctx.token,
      body: {
        restaurantId: ctx.idA,
        tableId: '__WALKIN__',
        orderIds: [ctx.walkinOrder.id],
        method: 'CASH',
        cashReceived: 30,
      },
    });
    expect([200, 201]).toContain(r.status);
    const paid = await prisma.order.findUnique({ where: { id: ctx.walkinOrder.id } });
    expect(paid.paymentStatus).toBe('PAID');
  });

  it('refuses to bill a TABLE order under a walk-in collection (no mixed bills)', async () => {
    const r = await call('POST', '/api/manager/payments', {
      token: ctx.token,
      body: {
        restaurantId: ctx.idA,
        tableId: '__WALKIN__',
        orderIds: [ctx.tableOrder.id],
        method: 'CASH',
        cashReceived: 50,
      },
    });
    expect(r.status).toBe(400);
  });

  it('refuses to bill a counter order under a physical table (no mixed bills)', async () => {
    // Another fresh counter order, billed via the TABLE path.
    const fresh = await call('POST', '/api/manager/orders', {
      token: ctx.token,
      body: {
        restaurantId: ctx.idA,
        tableId: '__WALKIN__',
        clientRequestId: crypto.randomUUID(),
        items: [{ productId: ctx.productId, quantity: 1 }],
      },
    });
    expect(fresh.status).toBe(201);
    const r = await call('POST', '/api/manager/payments', {
      token: ctx.token,
      body: {
        restaurantId: ctx.idA,
        tableId: ctx.tableId,
        orderIds: [fresh.json.data?.order?.id ?? fresh.json.data.id],
        method: 'CASH',
        cashReceived: 50,
      },
    });
    expect(r.status).toBe(400);
  });
});
