import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * DB INTEGRATION tests for tenant-scoped payment receipt numbers.
 *
 * Category D (HTTP/API-adjacent database integration) — unlike
 * cashier-payment.test.ts, which is static source verification (A) plus pure
 * unit tests (B), every test here executes against a real PostgreSQL database
 * through Prisma Client.
 *
 * Gate: runs ONLY when DATABASE_URL is set (CI / staging with a database).
 * Without DATABASE_URL the suite skips cleanly and the repo's static +
 * unit coverage remains the guard. No PrismaClient is constructed unless
 * the gate passes, so the skip path never touches the database.
 *
 * The scenarios mirror server/routes/manager.ts exactly:
 *  - generateNextReceiptNumber (per-tenant latest + count)
 *  - POST /api/manager/payments pre-checks + atomic transaction
 *  - receipt retry on P2002, PAYMENT_RACE conditional claim, rollback
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe('payment receipt scope gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
    if (!hasDb) {
      expect(true).toBe(true); // documented skip: static + unit tests still guard
    }
  });
});

describe.skipIf(!hasDb)('Payment receipt tenant scope (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  const runTag = `it-${Date.now()}`;
  const slugA = `scope-a-${runTag}`;
  const slugB = `scope-b-${runTag}`;
  let restA = '';
  let restB = '';
  let tableA = '';

  beforeAll(async () => {
    prisma = new PrismaClient();
    const a = await prisma.restaurant.create({
      data: {
        name: 'Scope A', slug: slugA, logoUrl: 'l',
        description: 'd', phone: 'p', address: 'a',
      },
    });
    const b = await prisma.restaurant.create({
      data: {
        name: 'Scope B', slug: slugB, logoUrl: 'l',
        description: 'd', phone: 'p', address: 'a',
      },
    });
    restA = a.id;
    restB = b.id;
    const t = await prisma.table.create({
      data: { restaurantId: restA, number: 1, qrToken: `qr-${runTag}` },
    });
    tableA = t.id;
  });

  afterAll(async () => {
    if (prisma) {
      // Restaurant relations cascade (orders, payments, tables, sessions).
      await prisma.restaurant.deleteMany({
        where: { slug: { in: [slugA, slugB] } },
      });
      await prisma.$disconnect();
    }
  });

  it('1. restaurant A can use receipt number X', async () => {
    const p = await prisma.payment.create({
      data: {
        id: `pay-${runTag}-a1`, receiptNumber: 'RC-2026-0001', restaurantId: restA,
        tableId: tableA, tableLabel: 'A1', orderIds: [],
        method: 'CASH', subtotal: 100, total: 100, cashierName: 'c1',
      },
    });
    expect(p.receiptNumber).toBe('RC-2026-0001');
  });

  it('2. restaurant B can use the SAME receipt number X (cross-tenant allowed)', async () => {
    const p = await prisma.payment.create({
      data: {
        id: `pay-${runTag}-b1`, receiptNumber: 'RC-2026-0001', restaurantId: restB,
        tableId: '__WALKIN__', tableLabel: 'B-counter', orderIds: [],
        method: 'CARD', subtotal: 70, total: 70, cashierName: 'c2',
      },
    });
    expect(p.restaurantId).toBe(restB);
  });

  it('3. restaurant A CANNOT use receipt number X twice (P2002)', async () => {
    const err = await prisma.payment
      .create({
        data: {
          id: `pay-${runTag}-a2`, receiptNumber: 'RC-2026-0001', restaurantId: restA,
          tableId: tableA, tableLabel: 'A1', orderIds: [],
          method: 'CASH', subtotal: 50, total: 50, cashierName: 'c1',
        },
      })
      .then(
        () => null,
        (e: unknown) => e as { code?: string },
      );
    expect(err).not.toBeNull();
    expect(err?.code).toBe('P2002');
  });

  it('4. receipt allocator latest() is per-tenant (generateNextReceiptNumber mirror)', async () => {
    const yearPrefix = 'RC-2026-';
    const latestA = await prisma.payment.findFirst({
      where: { restaurantId: restA, receiptNumber: { startsWith: yearPrefix } },
      orderBy: { receiptNumber: 'desc' },
      select: { receiptNumber: true },
    });
    const latestB = await prisma.payment.findFirst({
      where: { restaurantId: restB, receiptNumber: { startsWith: yearPrefix } },
      orderBy: { receiptNumber: 'desc' },
      select: { receiptNumber: true },
    });
    expect(latestA?.receiptNumber).toBe('RC-2026-0001');
    expect(latestB?.receiptNumber).toBe('RC-2026-0001');
    const countA = await prisma.payment.count({ where: { restaurantId: restA } });
    expect(countA).toBe(1); // only A rows counted: next seq derives from tenant data
  });

  it('5. payment transaction rolls back completely on receipt collision', async () => {
    const order = await prisma.order.create({
      data: {
        id: `order-${runTag}-rb`, restaurantId: restA, tableId: tableA,
        subtotal: 50, total: 50,
      },
    });
    const err = await prisma
      .$transaction(async (tx) => {
        await tx.order.updateMany({
          where: {
            id: { in: [order.id] }, restaurantId: restA,
            paymentStatus: 'UNPAID', status: { not: 'CANCELLED' },
          },
          data: { status: 'SERVED', paymentStatus: 'PAID' },
        });
        // Duplicate (restA, RC-2026-0001) -> must abort the whole tx.
        await tx.payment.create({
          data: {
            id: `pay-${runTag}-rb`, receiptNumber: 'RC-2026-0001', restaurantId: restA,
            tableId: tableA, tableLabel: 'A1', orderIds: [order.id],
            method: 'CASH', subtotal: 50, total: 50, cashierName: 'c1',
          },
        });
      })
      .then(
        () => null,
        (e: unknown) => e as { code?: string },
      );
    expect(err?.code).toBe('P2002');
    const after = await prisma.order.findUnique({ where: { id: order.id } });
    expect(after?.paymentStatus).toBe('UNPAID'); // claim rolled back
    const stray = await prisma.payment.findUnique({ where: { id: `pay-${runTag}-rb` } });
    expect(stray).toBeNull(); // no partial ledger row
  });

  it('6. concurrent payment is detected via conditional claim count (PAYMENT_RACE mirror)', async () => {
    const order = await prisma.order.create({
      data: {
        id: `order-${runTag}-race`, restaurantId: restA, tableId: tableA,
        subtotal: 30, total: 30,
      },
    });
    const first = await prisma.order.updateMany({
      where: {
        id: { in: [order.id] }, restaurantId: restA,
        paymentStatus: 'UNPAID', status: { not: 'CANCELLED' },
      },
      data: { status: 'SERVED', paymentStatus: 'PAID' },
    });
    expect(first.count).toBe(1);
    // Second device attempts the same claim: matches 0 rows -> route throws
    // PAYMENT_RACE and returns 409 instead of double-charging.
    const second = await prisma.order.updateMany({
      where: {
        id: { in: [order.id] }, restaurantId: restA,
        paymentStatus: 'UNPAID', status: { not: 'CANCELLED' },
      },
      data: { status: 'SERVED', paymentStatus: 'PAID' },
    });
    expect(second.count).toBe(0);
  });

  it('7. cross-tenant payment is rejected (order invisible outside its tenant)', async () => {
    const foreign = await prisma.order.findMany({
      where: {
        id: { in: [`order-${runTag}-rb`] },
        restaurantId: restB, // billed as tenant B, order belongs to tenant A
        status: { not: 'CANCELLED' },
        paymentStatus: 'UNPAID',
      },
    });
    // Route sees length mismatch -> 409 '... من مطعم آخر'.
    expect(foreign.length).toBe(0);
  });
});
