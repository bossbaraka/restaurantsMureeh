import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Receipt rejection / staff cancellation — state-first ordering (F-06 gate).
 *
 * Invariant under test: a transfer receipt (private object) is deleted ONLY
 * AFTER the conditional state transition (CAS `updateMany`) succeeded. Covered
 * for both callers that discard a receipt:
 *
 *   POST /api/manager/orders/:orderId/payment/reject
 *   PUT  /api/manager/orders/:orderId/status  { status: 'CANCELLED' }
 *
 * Scenarios:
 *   1. happy path            → transition, then object removed, pointer cleared,
 *                               `proofDeleted: true` (contract unchanged);
 *   2. concurrency (CAS miss) → a cashier confirmation that lands between the
 *                               handler's read and its claim wins: 409, the
 *                               order stays PAID and the receipt object SURVIVES;
 *   3. file-delete failure    → DB transition kept, pointer KEPT for the
 *                               retention sweep, `proofDeleted: false`;
 *   4. repeated request       → 409, idempotent (nothing is deleted twice,
 *                               no second transition);
 *   5. authorization          → a WAITER can neither reject nor cancel.
 *
 * The concurrent writer is injected deterministically with a Prisma `$use`
 * middleware that runs right after the handler's own `order.findUnique`.
 * Storage is the real local driver in a temp directory.
 */

const TMP_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-order-pub-'));
const TMP_PRIVATE = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-order-priv-'));
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = TMP_UPLOADS;
process.env.PRIVATE_UPLOAD_DIR = TMP_PRIVATE;

// Wrap (not replace) the receipt-discard helper so a test can (a) observe the
// DB state at the moment the object is deleted and (b) simulate a storage
// failure. Every other export keeps its real implementation.
const discardSpy = vi.fn();
vi.mock('../../server/services/paymentProofs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../server/services/paymentProofs')>();
  discardSpy.mockImplementation((key: string | null | undefined) => orig.discardPaymentProof(key));
  return { ...orig, discardPaymentProof: discardSpy };
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe('payment proof reject ordering gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
  });
});

describe.skipIf(!hasDb)('Receipt discard happens only after a successful state transition (real PostgreSQL)', () => {
  type App = ReturnType<typeof import('express')>;
  let app: App;
  let server: import('http').Server;
  let base: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let storePaymentProof: typeof import('../../server/services/paymentProofs')['storePaymentProof'];
  let loadPaymentProof: typeof import('../../server/services/paymentProofs')['loadPaymentProof'];
  let realDiscard: typeof import('../../server/services/paymentProofs')['discardPaymentProof'];
  let managerToken = '';
  let waiterToken = '';

  const run = `rejord${Date.now().toString(36)}`;
  const restaurantId = `rest-${run}`;
  const managerId = `mgr-${run}`;
  const waiterId = `wtr-${run}`;
  let tableId = '';
  let orderSeq = 0;
  const orderIds: string[] = [];

  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );

  // Deterministic concurrent writer: runs ONCE, right after the handler's own
  // `order.findUnique` for `orderId`, i.e. between its read and its CAS.
  let raceHook: { orderId: string; run: () => Promise<void> } | null = null;

  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const reject = (orderId: string, token = managerToken, reason = 'صورة غير واضحة') =>
    call('POST', `/api/manager/orders/${orderId}/payment/reject`, token, { reason });
  const cancel = (orderId: string, token = managerToken, reason = 'الزبون غادر') =>
    call('PUT', `/api/manager/orders/${orderId}/status`, token, { status: 'CANCELLED', reason });

  const readOrder = (id: string) => prisma.order.findUnique({ where: { id } });
  const proofExists = async (key: string) => (await loadPaymentProof(key)) !== null;

  /** An order awaiting verification with a REAL receipt object in storage. */
  async function pendingOrder() {
    orderSeq += 1;
    const id = `ord-${run}-${orderSeq}`;
    orderIds.push(id);
    const stored = await storePaymentProof({ restaurantId, orderId: id, buffer: PNG_1x1, size: PNG_1x1.length });
    if (!stored.ok) throw new Error(`fixture upload failed: ${stored.reason}`);
    await prisma.order.create({
      data: {
        id,
        restaurantId,
        tableId,
        status: 'PENDING',
        paymentMethod: 'TRANSFER',
        paymentStatus: 'PENDING_VERIFICATION',
        fulfillmentState: 'PAYMENT_VERIFICATION_PENDING',
        paymentProofPath: stored.key,
        customerName: 'ضيف',
        subtotal: 40,
        tax: 0,
        total: 40,
      },
    });
    expect(await proofExists(stored.key)).toBe(true);
    return { id, key: stored.key };
  }

  /** Simulates the cashier confirming the SAME order concurrently. */
  const armConcurrentConfirm = (orderId: string) => {
    raceHook = {
      orderId,
      run: async () => {
        await prisma.order.updateMany({
          where: { id: orderId, paymentStatus: 'PENDING_VERIFICATION' },
          data: { paymentStatus: 'PAID', fulfillmentState: 'RELEASED', settledAt: new Date() },
        });
      },
    };
  };

  beforeAll(async () => {
    const { default: express } = await import('express');
    const managerRouter = (await import('../../server/routes/manager')).default;
    const { signToken, authenticateToken } = await import('../../server/middleware/auth');
    ({ prisma } = await import('../../server/db/prisma'));
    const proofs = await import('../../server/services/paymentProofs');
    storePaymentProof = proofs.storePaymentProof;
    loadPaymentProof = proofs.loadPaymentProof;
    const originalModule = await vi.importActual<typeof import('../../server/services/paymentProofs')>(
      '../../server/services/paymentProofs'
    );
    realDiscard = originalModule.discardPaymentProof;
    const bcrypt = await import('bcryptjs');

    prisma.$use(async (params: any, next: (p: any) => Promise<unknown>) => {
      const result = await next(params);
      if (
        raceHook &&
        params.model === 'Order' &&
        params.action === 'findUnique' &&
        params.args?.where?.id === raceHook.orderId
      ) {
        const hook = raceHook;
        raceHook = null;
        await hook.run();
      }
      return result;
    });

    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        slug: `reject-order-${run}`,
        name: `Reject Ordering ${run}`,
        logoUrl: '',
        description: 'F-06 ordering test',
        phone: '0000000000',
        address: 'Test',
        galleryImages: [],
        status: 'ACTIVE',
      },
    });
    const table = await prisma.table.create({
      data: { restaurantId, number: 3, name: 'T3', qrToken: `qr-${run}` },
    });
    tableId = table.id;
    const mkUser = (id: string, role: string, extra: Record<string, unknown>) =>
      prisma.restaurantUser.create({
        data: {
          id,
          restaurantId,
          name: `${role} ${run}`,
          passwordHash: bcrypt.hashSync(`no-password-${id}`, 10),
          role,
          status: 'ACTIVE',
          ...extra,
        },
      });
    const manager = await mkUser(managerId, 'RESTAURANT_MANAGER', { email: `manager@${run}.test` });
    const waiter = await mkUser(waiterId, 'WAITER', { username: `waiter.${run}`, pinHash: bcrypt.hashSync('417038', 10) });
    const tokenFor = (u: any) =>
      signToken({
        id: u.id,
        restaurantId: u.restaurantId,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        tv: u.tokenVersion,
      });
    managerToken = tokenFor(manager);
    waiterToken = tokenFor(waiter);

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/manager', authenticateToken, managerRouter);
    server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (prisma) {
      await prisma.auditLog?.deleteMany?.({ where: { restaurantId } }).catch(() => {});
      await prisma.order.deleteMany({ where: { restaurantId } });
      await prisma.restaurantUser.deleteMany({ where: { restaurantId } });
      await prisma.table.deleteMany({ where: { restaurantId } });
      await prisma.restaurant.deleteMany({ where: { id: restaurantId } });
      await prisma.$disconnect?.();
    }
    fs.rmSync(TMP_UPLOADS, { recursive: true, force: true });
    fs.rmSync(TMP_PRIVATE, { recursive: true, force: true });
  });

  beforeEach(() => {
    raceHook = null;
    discardSpy.mockClear();
    discardSpy.mockImplementation((key: string | null | undefined) => realDiscard(key));
  });

  // -------------------------------------------------------------------------
  // POST /payment/reject
  // -------------------------------------------------------------------------
  describe('POST /orders/:orderId/payment/reject', () => {
    it('happy path: the state transition is committed BEFORE the object is deleted; contract unchanged', async () => {
      const { id, key } = await pendingOrder();
      const seenAtDelete: Array<{ paymentStatus: string; fulfillmentState: string | null }> = [];
      discardSpy.mockImplementation(async (k: string | null | undefined) => {
        const row = await readOrder(id);
        seenAtDelete.push({ paymentStatus: row.paymentStatus, fulfillmentState: row.fulfillmentState });
        return realDiscard(k);
      });

      const r = await reject(id);
      expect(r.status).toBe(200);
      expect(r.json.data).toMatchObject({
        orderId: id,
        paymentStatus: 'UNPAID',
        fulfillmentState: 'PAYMENT_REJECTED',
        proofDeleted: true,
      });

      // Ordering proof: when the delete ran, the order had ALREADY moved.
      expect(discardSpy).toHaveBeenCalledTimes(1);
      expect(discardSpy).toHaveBeenCalledWith(key);
      expect(seenAtDelete).toEqual([{ paymentStatus: 'UNPAID', fulfillmentState: 'PAYMENT_REJECTED' }]);

      const after = await readOrder(id);
      expect(after.paymentStatus).toBe('UNPAID');
      expect(after.fulfillmentState).toBe('PAYMENT_REJECTED');
      expect(after.paymentProofPath).toBeNull();
      expect(after.paymentRejectedAt).not.toBeNull();
      expect(after.status).toBe('PENDING'); // kitchen status untouched
      expect(await proofExists(key)).toBe(false);
    });

    it('concurrency: a confirmation that lands between read and claim wins — 409, order stays PAID, receipt SURVIVES', async () => {
      const { id, key } = await pendingOrder();
      armConcurrentConfirm(id);

      const r = await reject(id);
      expect(r.status).toBe(409);
      expect(raceHook).toBeNull(); // the concurrent writer did run

      const after = await readOrder(id);
      expect(after.paymentStatus).toBe('PAID');
      expect(after.fulfillmentState).toBe('RELEASED');
      expect(after.paymentProofPath).toBe(key);
      expect(after.paymentRejectedAt).toBeNull();
      // The evidence of a PAID order must never be destroyed by a losing reject.
      expect(discardSpy).not.toHaveBeenCalled();
      expect(await proofExists(key)).toBe(true);
    });

    it('file-delete failure: transition kept, pointer KEPT for the retention sweep, proofDeleted=false', async () => {
      const { id, key } = await pendingOrder();
      discardSpy.mockImplementationOnce(async () => false);

      const r = await reject(id);
      expect(r.status).toBe(200);
      expect(r.json.data.proofDeleted).toBe(false);

      const after = await readOrder(id);
      expect(after.paymentStatus).toBe('UNPAID');
      expect(after.fulfillmentState).toBe('PAYMENT_REJECTED');
      expect(after.paymentProofPath).toBe(key); // retryable: sweep still sees it
      expect(await proofExists(key)).toBe(true);

      // A repeat is refused (no second transition) and deletes nothing.
      discardSpy.mockClear();
      const again = await reject(id);
      expect(again.status).toBe(409);
      expect(discardSpy).not.toHaveBeenCalled();
      const final = await readOrder(id);
      expect(final.paymentProofPath).toBe(key);
      expect(final.paymentStatus).toBe('UNPAID');
    });

    it('repeated request after success is a 409 no-op', async () => {
      const { id, key } = await pendingOrder();
      expect((await reject(id)).status).toBe(200);
      discardSpy.mockClear();
      const again = await reject(id);
      expect(again.status).toBe(409);
      expect(discardSpy).not.toHaveBeenCalled();
      const after = await readOrder(id);
      expect(after.paymentStatus).toBe('UNPAID');
      expect(after.paymentProofPath).toBeNull();
      expect(await proofExists(key)).toBe(false);
    });

    it('a guest re-upload that races the rejection keeps ITS pointer (only the rejected key is cleared)', async () => {
      const { id, key } = await pendingOrder();
      // Second object standing in for the guest's new receipt.
      const fresh = await storePaymentProof({ restaurantId, orderId: id, buffer: PNG_1x1, size: PNG_1x1.length });
      if (!fresh.ok) throw new Error('fixture');
      discardSpy.mockImplementationOnce(async (k: string | null | undefined) => {
        // Guest re-upload lands after the rejection claim, before the pointer clear.
        await prisma.order.update({
          where: { id },
          data: { paymentProofPath: fresh.key, paymentStatus: 'PENDING_VERIFICATION' },
        });
        return realDiscard(k);
      });

      const r = await reject(id);
      expect(r.status).toBe(200);
      expect(r.json.data.proofDeleted).toBe(true);

      const after = await readOrder(id);
      expect(after.paymentProofPath).toBe(fresh.key); // not clobbered to null
      expect(after.paymentStatus).toBe('PENDING_VERIFICATION');
      expect(await proofExists(key)).toBe(false);
      expect(await proofExists(fresh.key)).toBe(true);
    });

    it('authorization: a WAITER cannot reject (403) and nothing changes', async () => {
      const { id, key } = await pendingOrder();
      const r = await reject(id, waiterToken);
      expect(r.status).toBe(403);
      const after = await readOrder(id);
      expect(after.paymentStatus).toBe('PENDING_VERIFICATION');
      expect(after.paymentProofPath).toBe(key);
      expect(await proofExists(key)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // PUT /orders/:orderId/status { status: 'CANCELLED' }
  // -------------------------------------------------------------------------
  describe('PUT /orders/:orderId/status (staff cancellation of a pending-verification order)', () => {
    it('happy path: CANCELLED is committed BEFORE the receipt is deleted; pointer cleared', async () => {
      const { id, key } = await pendingOrder();
      const seenAtDelete: string[] = [];
      discardSpy.mockImplementation(async (k: string | null | undefined) => {
        seenAtDelete.push((await readOrder(id)).status);
        return realDiscard(k);
      });

      const r = await cancel(id);
      expect(r.status).toBe(200);
      expect(r.json.data.order).toMatchObject({
        id,
        status: 'CANCELLED',
        paymentStatus: 'UNPAID',
        fulfillmentState: 'PAYMENT_REJECTED',
        paymentProofPath: null,
      });
      expect(discardSpy).toHaveBeenCalledTimes(1);
      expect(discardSpy).toHaveBeenCalledWith(key);
      expect(seenAtDelete).toEqual(['CANCELLED']);

      const after = await readOrder(id);
      expect(after.status).toBe('CANCELLED');
      expect(after.paymentStatus).toBe('UNPAID');
      expect(after.paymentProofPath).toBeNull();
      expect(after.cancelledByUserId).toBe(managerId);
      expect(await proofExists(key)).toBe(false);
    });

    it('concurrency (money guard): a confirmation between read and claim wins — 409, order stays PAID and NOT cancelled, receipt survives', async () => {
      const { id, key } = await pendingOrder();
      armConcurrentConfirm(id);

      const r = await cancel(id);
      expect(r.status).toBe(409);
      expect(raceHook).toBeNull();

      const after = await readOrder(id);
      expect(after.status).toBe('PENDING');
      expect(after.paymentStatus).toBe('PAID');
      expect(after.paymentProofPath).toBe(key);
      expect(after.cancelledAt).toBeNull();
      expect(discardSpy).not.toHaveBeenCalled();
      expect(await proofExists(key)).toBe(true);
    });

    it('file-delete failure: CANCELLED kept, pointer KEPT for the sweep; repeat is an idempotent 200 that deletes nothing', async () => {
      const { id, key } = await pendingOrder();
      discardSpy.mockImplementationOnce(async () => false);

      const r = await cancel(id);
      expect(r.status).toBe(200);
      expect(r.json.data.order.status).toBe('CANCELLED');
      expect(r.json.data.order.paymentProofPath).toBe(key);

      const after = await readOrder(id);
      expect(after.status).toBe('CANCELLED');
      expect(after.paymentStatus).toBe('UNPAID');
      expect(after.paymentProofPath).toBe(key);
      expect(await proofExists(key)).toBe(true);

      discardSpy.mockClear();
      const again = await cancel(id);
      expect(again.status).toBe(200); // already-cancelled short-circuit (unchanged contract)
      expect(discardSpy).not.toHaveBeenCalled();
      expect((await readOrder(id)).paymentProofPath).toBe(key);
    });

    it('a PAID order is refused up front (money guard) and keeps its receipt', async () => {
      const { id, key } = await pendingOrder();
      await prisma.order.update({ where: { id }, data: { paymentStatus: 'PAID', fulfillmentState: 'RELEASED' } });
      const r = await cancel(id);
      expect(r.status).toBe(409);
      expect(discardSpy).not.toHaveBeenCalled();
      const after = await readOrder(id);
      expect(after.status).toBe('PENDING');
      expect(after.paymentProofPath).toBe(key);
      expect(await proofExists(key)).toBe(true);
    });

    it('authorization: a WAITER cannot cancel (403) and nothing changes', async () => {
      const { id, key } = await pendingOrder();
      const r = await cancel(id, waiterToken);
      expect(r.status).toBe(403);
      const after = await readOrder(id);
      expect(after.status).toBe('PENDING');
      expect(after.paymentProofPath).toBe(key);
      expect(await proofExists(key)).toBe(true);
    });
  });
});
