import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateStaffCancellation,
  evaluatePaymentVoid,
  canPerformStaffCancellation,
  STAFF_CANCELLATION_ROLES,
  CANCELLATION_AUTO_REJECT_REASON,
  PRE_SERVICE_ORDER_STATUSES,
} from '../../server/services/orderCancellation';
import { orderStatusSchema, paymentVoidSchema } from '../../server/validation/schemas';
import { computeSalesKpis } from '../services/analytics';
import type { Order, PaymentRecord } from '../types/restaurant';

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8').replace(/\r\n/g, '\n');

/**
 * H-02 (adversarial audit 2026-09-15) — staff order cancellation.
 *
 * Prior state: no staff cancellation path existed anywhere; the only way to
 * remove an erroneous order from operations was to falsely mark it PAID.
 * These tests pin the domain predicates (no DB), the request validation, and
 * the route-level enforcement contract.
 */
describe('H-02 · staff cancellation decision matrix', () => {
  it('allows PENDING / PREPARING / READY orders that are UNPAID', () => {
    for (const status of PRE_SERVICE_ORDER_STATUSES) {
      const decision = evaluateStaffCancellation({ status, paymentStatus: 'UNPAID' });
      expect(decision.ok).toBe(true);
      if (decision.ok) expect(decision.clearsPendingVerification).toBe(false);
    }
  });

  it('allows SERVED + UNPAID (voided-then-corrected bills must not strand)', () => {
    const decision = evaluateStaffCancellation({ status: 'SERVED', paymentStatus: 'UNPAID' });
    expect(decision.ok).toBe(true);
  });

  it('REJECTS any PAID order — the receipt must be voided first', () => {
    for (const status of [...PRE_SERVICE_ORDER_STATUSES, 'SERVED']) {
      const decision = evaluateStaffCancellation({ status, paymentStatus: 'PAID' });
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.statusCode).toBe(409);
        expect(decision.reason).toBe('already_paid');
        expect(decision.error).toContain('Void');
      }
    }
  });

  it('REJECTS cancelling an already-CANCELLED order as a mutation', () => {
    const decision = evaluateStaffCancellation({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe('already_cancelled');
  });

  it('marks orders in PENDING_VERIFICATION for receipt auto-rejection', () => {
    const decision = evaluateStaffCancellation({
      status: 'PENDING',
      paymentStatus: 'PENDING_VERIFICATION',
      hasPaymentProof: true,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.clearsPendingVerification).toBe(true);
  });

  it('safe-fails on unknown/garbage states', () => {
    for (const bad of ['DONE', '', 42, null, undefined, ['PENDING']]) {
      // @ts-expect-error deliberately adversarial inputs
      const decision = evaluateStaffCancellation({ status: bad, paymentStatus: 'UNPAID' });
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.reason).toBe('unknown_status');
    }
  });

  it('auto-reject reason + role set are stable constants', () => {
    expect(CANCELLATION_AUTO_REJECT_REASON).toContain('أُلغي');
    expect([...STAFF_CANCELLATION_ROLES].sort()).toEqual([
      'CASHIER',
      'PLATFORM_ADMIN',
      'RESTAURANT_MANAGER',
      'SUPER_ADMIN',
    ]);
  });

  it('role predicate: cashier/manager/platform yes; waiter/kitchen/staff no', () => {
    expect(canPerformStaffCancellation('CASHIER')).toBe(true);
    expect(canPerformStaffCancellation('RESTAURANT_MANAGER')).toBe(true);
    expect(canPerformStaffCancellation('SUPER_ADMIN')).toBe(true);
    expect(canPerformStaffCancellation('PLATFORM_ADMIN')).toBe(true);
    expect(canPerformStaffCancellation('WAITER')).toBe(false);
    expect(canPerformStaffCancellation('KITCHEN')).toBe(false);
    expect(canPerformStaffCancellation('STAFF')).toBe(false);
    expect(canPerformStaffCancellation(undefined)).toBe(false);
    expect(canPerformStaffCancellation('cashier')).toBe(false);
  });
});

describe('H-02 · payment void decision matrix', () => {
  it('allows voiding a live receipt', () => {
    expect(evaluatePaymentVoid(false).ok).toBe(true);
  });
  it('rejects a second void mutation (replays are idempotent at the route, not a re-write)', () => {
    const decision = evaluatePaymentVoid(true);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.statusCode).toBe(409);
      expect(decision.reason).toBe('already_voided');
    }
  });
});

describe('H-02 · voided receipts never count as revenue (KPI integrity)', () => {
  // After a void: receipt flagged (stays in the ledger), order reverted to
  // UNPAID. Sales KPIs must treat the voided receipt as non-money.
  const revertedOrder: Order = {
    id: 'ord-1',
    restaurantId: 'tenant-a',
    tableId: 'tbl-1',
    items: [],
    subtotal: 100,
    total: 100,
    status: 'SERVED',
    paymentMethod: 'CASH',
    paymentStatus: 'UNPAID',
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T12:00:00.000Z',
  };
  const voidedReceipt: PaymentRecord = {
    id: 'pay-1',
    receiptNumber: 'RC-000001',
    restaurantId: 'tenant-a',
    tableId: 'tbl-1',
    tableLabel: 'طاولة 1',
    orderIds: ['ord-1'],
    method: 'CASH' as any,
    subtotal: 100,
    total: 100,
    cashierName: 'Cashier',
    voidedAt: '2026-09-15T12:00:00.000Z',
    voidReason: 'تحصيل بالخطأ',
    createdAt: '2026-09-15T11:00:00.000Z',
  };

  it('a voided receipt contributes zero collected revenue and zero paid-orders', () => {
    const kpis = computeSalesKpis([revertedOrder], [voidedReceipt]);
    expect(kpis.collectedRevenue).toBe(0);
    expect(kpis.paidOrdersCount).toBe(0);
    expect(kpis.grossOrderValue).toBe(100); // the order exists (not cancelled)
    expect(kpis.ordersCount).toBe(1);
  });

  it('a live receipt still counts (control)', () => {
    const kpis = computeSalesKpis(
      [{ ...revertedOrder, paymentStatus: 'PAID' }],
      [{ ...voidedReceipt, voidedAt: undefined, voidReason: undefined }]
    );
    expect(kpis.collectedRevenue).toBe(100);
    expect(kpis.paidOrdersCount).toBe(1);
  });

  it('cancelled orders are already excluded from gross — the H-02 relationship holds', () => {
    const kpis = computeSalesKpis([{ ...revertedOrder, status: 'CANCELLED', cancelledAt: '2026-09-15T12:30:00.000Z' }], []);
    expect(kpis.grossOrderValue).toBe(0);
    expect(kpis.cancelledValue).toBe(100);
  });
});

describe('H-02 · validation schemas', () => {
  it('orderStatusSchema accepts CANCELLED with an optional reason', () => {
    const parsed = orderStatusSchema.safeParse({ status: 'CANCELLED', reason: 'طلب بالخطأ على الطاولة' });
    expect(parsed.success).toBe(true);
  });
  it('orderStatusSchema still accepts plain flow transitions without reason', () => {
    expect(orderStatusSchema.safeParse({ status: 'PREPARING' }).success).toBe(true);
  });
  it('orderStatusSchema rejects reasons over 200 chars and unknown keys', () => {
    expect(orderStatusSchema.safeParse({ status: 'CANCELLED', reason: 'x'.repeat(201) }).success).toBe(false);
    expect(orderStatusSchema.safeParse({ status: 'CANCELLED', hack: true }).success).toBe(false);
  });
  it('paymentVoidSchema accepts empty body + optional bounded reason, rejects unknown keys', () => {
    expect(paymentVoidSchema.safeParse({}).success).toBe(true);
    expect(paymentVoidSchema.safeParse({ reason: 'تحصيل مكرر' }).success).toBe(true);
    expect(paymentVoidSchema.safeParse({ reason: 'x'.repeat(201) }).success).toBe(false);
    expect(paymentVoidSchema.safeParse({ amount: 5 }).success).toBe(false);
  });
});

describe('H-02 · route + persistence contract', () => {
  const managerTs = read('server/routes/manager.ts');
  const schemaPrisma = read('prisma/schema.prisma');
  const migrationSql = read('prisma/migrations/20260915120000_staff_cancel_and_payment_void/migration.sql');

  it('cancellation runs through a compare-and-set pinned on the status snapshot', () => {
    expect(managerTs).toContain("where: { id: orderId, restaurantId: targetRestId, status: order.status }");
    expect(managerTs).toContain('cancelClaim.count !== 1');
  });
  it('cancellation writes the marker columns and never deletes the order', () => {
    expect(managerTs).toContain("status: 'CANCELLED',");
    expect(managerTs).toContain('cancelledAt,');
    expect(managerTs).toContain('cancelReason: reason || undefined,');
    expect(managerTs).toContain('cancelledByUserId: req.user!.id,');
  });
  it('cancellation of a verification-pending order auto-rejects the receipt in the same write', () => {
    expect(managerTs).toContain('decision.clearsPendingVerification');
    expect(managerTs).toContain('FULFILLMENT_STATE.PAYMENT_REJECTED');
    expect(managerTs).toContain('discardPaymentProof(order.paymentProofPath)');
  });
  it('role gate is enforced server-side (cashier/manager/platform only)', () => {
    expect(managerTs).toContain('canPerformStaffCancellation(req.user!.role)');
  });
  it('audit event ORDER_CANCELLED is emitted with actor + previous status + ip', () => {
    expect(managerTs).toContain("action: 'ORDER_CANCELLED'");
    expect(managerTs).toContain('previousStatus: order.status,');
    expect(managerTs).toContain('ipAddress: req.ip,');
  });
  it('SSE ORDER_CANCELLED is broadcast table-scoped', () => {
    expect(managerTs).toContain("broadcastToTable(targetRestId, order.tableId, 'ORDER_CANCELLED'");
  });
  it('void route exists with cashier/manager authorization + idempotent replay + CAS race guard', () => {
    expect(managerTs).toContain("'/payments/:paymentId/void'");
    expect(managerTs).toContain('alreadyVoided: true');
    expect(managerTs).toContain('voidedAt: null },');
    expect(managerTs).toContain('VOID_RACE');
    const voidIdx = managerTs.indexOf("'/payments/:paymentId/void'");
    const header = managerTs.slice(voidIdx, voidIdx + 400);
    expect(header).toContain('requireCashierOrManager()');
    expect(header).toContain('validateBody(paymentVoidSchema)');
  });
  it('void reverts covered orders to UNPAID / AWAITING_PAYMENT in one transaction', () => {
    expect(managerTs).toContain('FULFILLMENT_STATE.AWAITING_PAYMENT');
    expect(managerTs).toContain("paymentStatus: PAYMENT_STATUS.UNPAID,");
    expect(managerTs).toContain('settledAt: null,');
    expect(managerTs).toContain('releasedAt: null,');
  });
  it('audit event PAYMENT_VOIDED + SSE PAYMENT_VOIDED are emitted', () => {
    expect(managerTs).toContain("action: 'PAYMENT_VOIDED'");
    expect(managerTs).toContain("'PAYMENT_VOIDED', {");
  });
  it('schema carries the new nullable columns on Order + Payment', () => {
    expect(schemaPrisma).toMatch(/cancelledAt\s+DateTime\?/);
    expect(schemaPrisma).toMatch(/cancelReason\s+String\?/);
    expect(schemaPrisma).toMatch(/cancelledByUserId\s+String\?/);
    expect(schemaPrisma).toMatch(/voidedAt\s+DateTime\?/);
    expect(schemaPrisma).toMatch(/voidReason\s+String\?/);
    expect(schemaPrisma).toMatch(/voidedByUserId\s+String\?/);
  });
  it('migration is additive and idempotent (IF NOT EXISTS)', () => {
    for (const stmt of [
      'ALTER TABLE "Order"\n  ADD COLUMN IF NOT EXISTS "cancelledAt"',
      'ALTER TABLE "Order"\n  ADD COLUMN IF NOT EXISTS "cancelReason"',
      'ALTER TABLE "Payment"\n  ADD COLUMN IF NOT EXISTS "voidedAt"',
      'ALTER TABLE "Payment"\n  ADD COLUMN IF NOT EXISTS "voidReason"',
    ]) {
      expect(migrationSql).toContain(stmt);
    }
  });
});
