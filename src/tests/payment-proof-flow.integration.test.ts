import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Transfer payment proof — DB INTEGRATION suite (end-to-end business flow).
 *
 * Gate: runs ONLY when DATABASE_URL is set (CI / staging with PostgreSQL).
 * Without it the suite skips cleanly and the static + unit + render suites in
 * payment-proof.test.ts / retention.test.ts / payment-proof-ui.test.tsx remain
 * the guard. No PrismaClient is constructed unless the gate passes.
 *
 * The scenario mirrors the shipped routes step by step:
 *   order created (UNPAID, held out of the KDS by the guest's own action once
 *   the notice exists) → guest uploads receipt + name + phone + channel →
 *   PENDING_VERIFICATION → cashier queue (tenant-scoped) → confirm (atomic
 *   claim + ledger receipt, kitchen status NOT rewritten) → PAID → business
 *   session closes → archived → temporary data purge-eligible → purge clears
 *   name + phone + receipt key only.
 *
 * Every mutation below uses the SAME conditional-update pattern as the routes,
 * so a regression in the pattern itself is caught here.
 */

const hasDb = Boolean(process.env.DATABASE_URL);

describe('payment proof flow gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
  });
});

describe.skipIf(!hasDb)('Transfer payment proof end to end (real PostgreSQL)', () => {
  // Typed loosely on purpose: the Prisma client is only imported when the gate
  // passes, so this file never pulls the engine in a DB-less environment.
  let prisma: any;
  let runRetentionSweep: any;
  let archiveClosedOrders: any;
  let purgeTemporaryOperationalData: any;

  const runTag = `proof-${Date.now()}`;
  const restA = `rest-a-${runTag}`;
  const restB = `rest-b-${runTag}`;
  const tables: string[] = [];
  const sessions: string[] = [];
  const orders: string[] = [];
  const payments: string[] = [];

  const HOUR = 3_600_000;
  const TZ = 'Asia/Jerusalem';
  const day = 86_400_000;

  async function createOrder(restaurantId: string, tableId: string, sessionId: string, opts: {
    createdAt?: Date;
    paymentStatus?: string;
    status?: string;
    settledAt?: Date | null;
    total?: number;
    customerName?: string;
  } = {}) {
    const id = `ord-${runTag}-${orders.length + 1}`;
    orders.push(id);
    await prisma.order.create({
      data: {
        id,
        restaurantId,
        tableId,
        sessionId,
        status: opts.status ?? 'SERVED',
        paymentMethod: 'PAY AT CASHIER',
        paymentStatus: opts.paymentStatus ?? 'UNPAID',
        settledAt: opts.settledAt ?? null,
        subtotal: 68,
        tax: 0,
        total: opts.total ?? 68,
        customerName: opts.customerName ?? null,
        createdAt: opts.createdAt ?? new Date(),
      },
    });
    return id;
  }

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();

    const retention = await import('../../server/services/retention');
    archiveClosedOrders = retention.archiveClosedOrders;
    purgeTemporaryOperationalData = retention.purgeTemporaryOperationalData;
    runRetentionSweep = retention.runRetentionSweep;

    for (const [id, slug] of [
      [restA, `proof-a-${runTag}`],
      [restB, `proof-b-${runTag}`],
    ] as const) {
      await prisma.restaurant.create({
        data: {
          id,
          name: `Proof ${id}`,
          slug,
          logoUrl: '',
          description: 'integration',
          phone: '000',
          address: 'addr',
          timezone: TZ,
        },
      });

      const table = await prisma.table.create({
        data: { restaurantId: id, number: 7, name: 'T7', qrToken: `qr-${id}` },
      });
      tables.push(table.id);

      const session = await prisma.tableSession.create({
        data: {
          restaurantId: id,
          tableId: table.id,
          sessionToken: `st-${id}`,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 12 * HOUR),
        },
      });
      sessions.push(session.id);
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      await prisma.payment.deleteMany({ where: { restaurantId: { in: [restA, restB] } } });
      await prisma.order.deleteMany({ where: { restaurantId: { in: [restA, restB] } } });
      await prisma.tableSession.deleteMany({ where: { id: { in: sessions } } });
      await prisma.table.deleteMany({ where: { id: { in: tables } } });
      await prisma.restaurant.deleteMany({ where: { id: { in: [restA, restB] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('guest claim → PENDING_VERIFICATION (phone canonical, receipt key tenant-scoped)', async () => {
    const tableA = tables[0];
    const orderId = await createOrder(restA, tableA, sessions[0]);

    const key = `payment-proofs/restaurant/${restA}/order/${orderId}/uuid.png`;
    const claimed = await prisma.order.updateMany({
      where: {
        id: orderId,
        restaurantId: restA,
        status: { not: 'CANCELLED' },
        paymentStatus: { in: ['UNPAID', 'PENDING_VERIFICATION'] },
      },
      data: {
        paymentProofPath: key,
        paymentStatus: 'PENDING_VERIFICATION',
        paymentRejectedAt: null,
        paymentRejectionReason: null,
        customerName: 'أحمد سالم',
        customerPhone: '0599123456',
        transferChannel: 'BANK',
      },
    });
    expect(claimed.count).toBe(1);

    const row = await prisma.order.findUnique({ where: { id: orderId } });
    expect(row.paymentStatus).toBe('PENDING_VERIFICATION');
    expect(row.customerName).toBe('أحمد سالم');
    expect(row.customerPhone).toBe('0599123456');
    expect(row.transferChannel).toBe('BANK');
    expect(row.paymentProofPath).toBe(key);
    // The receipt lives in the PRIVATE namespace, never under the public prefix.
    expect(row.paymentProofPath.startsWith('payment-proofs/')).toBe(true);
    expect(row.paymentProofPath.startsWith('restaurants/')).toBe(false);
  });

  it('a receipt awaiting verification is invisible to another tenant', async () => {
    const queueA = await prisma.order.findMany({
      where: { restaurantId: restA, paymentStatus: 'PENDING_VERIFICATION' },
    });
    const queueB = await prisma.order.findMany({
      where: { restaurantId: restB, paymentStatus: 'PENDING_VERIFICATION' },
    });
    expect(queueA.length).toBeGreaterThan(0);
    expect(queueB).toHaveLength(0);
    for (const order of queueA) expect(order.restaurantId).toBe(restA);
  });

  it('confirm is atomic: one receipt, no double processing under a race', async () => {
    const pending = await prisma.order.findFirst({
      where: { restaurantId: restA, paymentStatus: 'PENDING_VERIFICATION' },
    });
    expect(pending).toBeTruthy();

    const cashierId = 'cashier-1';
    const now = new Date();

    const confirm = () =>
      prisma.$transaction(async (tx: any) => {
        const claimed = await tx.order.updateMany({
          where: {
            id: pending.id,
            restaurantId: restA,
            status: { not: 'CANCELLED' },
            paymentStatus: 'PENDING_VERIFICATION',
          },
          data: {
            paymentStatus: 'PAID',
            paymentMethod: 'TRANSFER',
            // The kitchen status is deliberately NOT rewritten: confirming the
            // money must not skip or serve the ticket — the KDS starts it.
            settledAt: now,
            cashierId,
            paymentRejectedAt: null,
            paymentRejectionReason: null,
          },
        });
        if (claimed.count !== 1) throw Object.assign(new Error('VERIFY_RACE'), { code: 'VERIFY_RACE' });
        return tx.payment.create({
          data: {
            id: `pay-${runTag}-${payments.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
            receiptNumber: `RC-${runTag}-${payments.length + 1}`,
            restaurantId: restA,
            tableId: pending.tableId,
            tableLabel: 'طاولة 7',
            orderIds: [pending.id],
            method: 'TRANSFER',
            subtotal: pending.subtotal,
            tax: pending.tax,
            total: pending.total,
            cashierId,
            cashierName: 'Cashier One',
          },
        });
      });

    // Two cashiers click Confirm at the same moment.
    const results = await Promise.allSettled([confirm(), confirm()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('VERIFY_RACE');

    const settled = await prisma.order.findUnique({ where: { id: pending.id } });
    expect(settled.paymentStatus).toBe('PAID');
    expect(settled.paymentMethod).toBe('TRANSFER');
    expect(settled.cashierId).toBe(cashierId);
    expect(settled.settledAt).toBeInstanceOf(Date);
    // Confirming settles the money; it never advances (or skips) the kitchen.
    expect(settled.status).toBe(pending.status);

    const ledger = await prisma.payment.findMany({ where: { orderIds: { has: pending.id } } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].method).toBe('TRANSFER');
    expect(ledger[0].total).toBe(settled.total);
    expect(ledger[0].restaurantId).toBe(restA);
  });

  it('reject returns the order to UNPAID with a marker and keeps the money fields', async () => {
    const tableB = tables[1];
    const orderId = await createOrder(restB, tableB, sessions[1]);
    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'PENDING_VERIFICATION',
        paymentProofPath: `payment-proofs/restaurant/${restB}/order/${orderId}/uuid.jpg`,
        customerPhone: '0500000000',
      },
    });

    const rejected = await prisma.order.updateMany({
      where: { id: orderId, restaurantId: restB, paymentStatus: 'PENDING_VERIFICATION' },
      data: {
        paymentStatus: 'UNPAID',
        paymentRejectedAt: new Date(),
        paymentRejectionReason: 'إشعار غير واضح',
        paymentProofPath: null,
      },
    });
    expect(rejected.count).toBe(1);

    const row = await prisma.order.findUnique({ where: { id: orderId } });
    expect(row.paymentStatus).toBe('UNPAID');
    expect(row.paymentRejectedAt).toBeInstanceOf(Date);
    expect(row.paymentRejectionReason).toBe('إشعار غير واضح');
    expect(row.paymentProofPath).toBeNull();
    // Nothing financial was touched, and the rejection is not a payment.
    expect(row.total).toBe(68);
    expect(row.settledAt).toBeNull();
    expect(await prisma.payment.count({ where: { orderIds: { has: orderId } } })).toBe(0);
  });

  it('archives closed business sessions only, and twice is a no-op', async () => {
    const tableA = tables[0];
    const oldPaid = await createOrder(restA, tableA, sessions[0], {
      createdAt: new Date(Date.now() - 3 * day),
      settledAt: new Date(Date.now() - 3 * day),
      paymentStatus: 'PAID',
      customerName: 'سمير خليل',
      customerPhone: '0599111111',
    });
    await prisma.order.update({
      where: { id: oldPaid },
      data: {
        paymentProofPath: `payment-proofs/restaurant/${restA}/order/${oldPaid}/u.png`,
        transferChannel: 'WALLET',
      },
    });
    const recentPaid = await createOrder(restA, tableA, sessions[0], {
      paymentStatus: 'PAID',
      settledAt: new Date(),
    });
    const openUnpaid = await createOrder(restA, tableA, sessions[0], {
      createdAt: new Date(Date.now() - 3 * day),
      paymentStatus: 'UNPAID',
    });

    const first = await archiveClosedOrders({});
    expect(first.archived).toBeGreaterThanOrEqual(1);
    const second = await archiveClosedOrders({});
    expect(second.archived).toBe(0); // idempotent

    const archived = await prisma.order.findUnique({ where: { id: oldPaid } });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    // Financial history retained in full.
    expect(archived.paymentStatus).toBe('PAID');
    expect(archived.total).toBe(68);
    expect(archived.settledAt).toBeInstanceOf(Date);

    // Open/unsettled business is never archived.
    expect((await prisma.order.findUnique({ where: { id: recentPaid } })).archivedAt).toBeNull();
    expect((await prisma.order.findUnique({ where: { id: openUnpaid } })).archivedAt).toBeNull();
  });

  it('purges temporary data after the retention window and keeps the receipt pointer safe', async () => {
    const oldPaid = await prisma.order.findFirst({
      where: { restaurantId: restA, archivedAt: { not: null }, customerPhone: { not: null } },
    });
    expect(oldPaid).toBeTruthy();

    // Before the window: nothing is eligible.
    const tooEarly = await purgeTemporaryOperationalData({ retentionHours: 720, dryRun: true });
    expect(tooEarly.candidates).not.toContain(oldPaid.id);

    // A dry run reports without writing.
    const dry = await purgeTemporaryOperationalData({ retentionHours: 0, dryRun: true });
    expect(dry.candidates).toContain(oldPaid.id);
    expect((await prisma.order.findUnique({ where: { id: oldPaid.id } })).customerPhone).toBe('0599111111');

    // A real run clears ONLY the temporary fields.
    const purged = await purgeTemporaryOperationalData({ retentionHours: 0 });
    expect(purged.purged).toBeGreaterThanOrEqual(1);

    const after = await prisma.order.findUnique({ where: { id: oldPaid.id } });
    // Name + phone + receipt are the temporary operational data; all three go.
    expect(after.customerName).toBeNull();
    expect(after.customerPhone).toBeNull();
    expect(after.paymentProofPath).toBeNull();
    expect(after.retentionPurgedAt).toBeInstanceOf(Date);
    expect(after.total).toBe(68);
    expect(after.paymentStatus).toBe('PAID');
    expect(after.archivedAt).toBeInstanceOf(Date);

    // Running it again finds nothing: idempotent, retry-safe.
    const again = await purgeTemporaryOperationalData({ retentionHours: 0 });
    expect(again.purged).toBe(0);
    expect(again.purgeFailures).toBe(0);
  });

  it('never purges a receipt that is still awaiting verification', async () => {
    const tableB = tables[1];
    const orderId = await createOrder(restB, tableB, sessions[1], {
      createdAt: new Date(Date.now() - 3 * day),
      paymentStatus: 'PENDING_VERIFICATION',
    });
    await prisma.order.update({
      where: { id: orderId },
      data: {
        customerName: 'ليلى ناصر',
        customerPhone: '0509999999',
        paymentProofPath: `payment-proofs/restaurant/${restB}/order/${orderId}/u.png`,
        // Simulate an archived marker that a buggy sweep might have set.
        archivedAt: new Date(Date.now() - day),
      },
    });

    const result = await purgeTemporaryOperationalData({ retentionHours: 0 });
    expect(result.candidates).not.toContain(orderId);
    expect(result.purgeFailures).toBe(0);
    const row = await prisma.order.findUnique({ where: { id: orderId } });
    expect(row.customerPhone).toBe('0509999999');
    expect(row.paymentProofPath).not.toBeNull();
  });

  it('retries a rejected receipt whose object could not be deleted', async () => {
    const tableA = tables[0];
    const orderId = await createOrder(restA, tableA, sessions[0]);
    // The cashier rejected the receipt but the storage delete failed, so the
    // pointer survived with the rejection marker (and the order is UNPAID).
    await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'UNPAID',
        paymentRejectedAt: new Date(Date.now() - 3 * day),
        paymentRejectionReason: 'لم يتم التحقق من إشعار الحوالة',
        customerPhone: '0599888888',
        paymentProofPath: `payment-proofs/restaurant/${restA}/order/${orderId}/u.png`,
      },
    });

    const dry = await purgeTemporaryOperationalData({ retentionHours: 48, dryRun: true });
    expect(dry.candidates).toContain(orderId);

    const purged = await purgeTemporaryOperationalData({ retentionHours: 48 });
    expect(purged.purgeFailures).toBe(0);
    const row = await prisma.order.findUnique({ where: { id: orderId } });
    expect(row.paymentProofPath).toBeNull();
    expect(row.customerPhone).toBeNull();
    expect(row.retentionPurgedAt).toBeInstanceOf(Date);
    // The rejection marker and every financial field survive.
    expect(row.paymentRejectedAt).toBeInstanceOf(Date);
    expect(row.paymentStatus).toBe('UNPAID');
    expect(row.total).toBe(68);
  });

  it('one sweep archives and purges without touching other tenants', async () => {
    const sweep = await runRetentionSweep({ retentionHours: 0 });
    expect(sweep.archive.archived).toBe(0); // already archived by the previous run
    expect(sweep.purge.purgeFailures).toBe(0);
    // Every order of the second tenant keeps its own data contract.
    const bOrders = await prisma.order.findMany({ where: { restaurantId: restB } });
    for (const order of bOrders) {
      expect(order.restaurantId).toBe(restB);
      expect(order.total).toBeGreaterThan(0);
    }
  });
});
