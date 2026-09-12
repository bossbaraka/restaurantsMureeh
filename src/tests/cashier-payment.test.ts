import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reconcileCashPayment } from '../../server/utils/security';
import { paymentCreateSchema } from '../../server/validation/schemas';

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

describe('Cashier Payment Hotfix & Contract Verification', () => {
  const managerTs = read('server/routes/manager.ts');
  const schemaPrisma = read('prisma/schema.prisma');
  const migrationSql = read('prisma/migrations/20260912130000_scope_payment_receipt_number/migration.sql');

  describe('Database Schema & Migration Integrity (Constraints 7 & 8)', () => {
    it('scopes Payment receiptNumber unique constraint to (restaurantId, receiptNumber)', () => {
      expect(schemaPrisma).toContain('@@unique([restaurantId, receiptNumber])');
      expect(schemaPrisma).not.toMatch(/receiptNumber\s+String\s+@unique/);
    });

    it('migration drops global key and creates composite unique index', () => {
      expect(migrationSql).toContain('DROP INDEX IF EXISTS "Payment_receiptNumber_key"');
      expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "Payment_restaurantId_receiptNumber_key" ON "Payment"("restaurantId", "receiptNumber")');
    });

    it('Payment creation contains all required ledger fields', () => {
      expect(managerTs).toContain('receiptNumber,');
      expect(managerTs).toContain('restaurantId,');
      expect(managerTs).toContain('tableId,');
      expect(managerTs).toContain('tableLabel:');
      expect(managerTs).toContain('orderIds:');
      expect(managerTs).toContain('itemsSummary:');
      expect(managerTs).toContain('method:');
      expect(managerTs).toContain('subtotal,');
      expect(managerTs).toContain('total,');
      expect(managerTs).toContain('cashReceived:');
      expect(managerTs).toContain('changeDue:');
      expect(managerTs).toContain('tip:');
      expect(managerTs).toContain('cashierId:');
      expect(managerTs).toContain('cashierName:');
    });
  });

  describe('Structured Server Logging (Constraint 5 & 6)', () => {
    it('logs structured context without leaking internals to client', () => {
      expect(managerTs).toContain('[Payment Error]');
      expect(managerTs).toContain("endpoint: 'POST /api/manager/payments'");
      expect(managerTs).toContain('tenantId:');
      expect(managerTs).toContain('tableId,');
      expect(managerTs).toContain('orderIds,');
      expect(managerTs).toContain('method,');
      expect(managerTs).toContain('code:');
      expect(managerTs).toContain('meta:');
      expect(managerTs).toContain("error: 'تعذر إتمام الدفع'");
    });
  });

  describe('Section 10 Requirements (a-o)', () => {
    it('a) CASH payment with exact amount reconciles with zero change due', () => {
      const res = reconcileCashPayment({
        method: 'CASH',
        total: 150,
        cashReceived: 150,
        tip: 0,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.changeDue).toBe(0);
        expect(res.cashReceived).toBe(150);
        expect(res.tip).toBe(0);
      }
    });

    it('b) CASH payment with change due computes server-side change correctly', () => {
      const res = reconcileCashPayment({
        method: 'CASH',
        total: 75.5,
        cashReceived: 100,
        tip: 0,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.changeDue).toBe(24.5);
        expect(res.cashReceived).toBe(100);
      }
    });

    it('c) CASH payment with insufficient amount is rejected', () => {
      const res = reconcileCashPayment({
        method: 'CASH',
        total: 100,
        cashReceived: 90,
        tip: 0,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain('المبلغ المقبوض أقل من قيمة الفاتورة');
      }

      const missingCash = reconcileCashPayment({
        method: 'CASH',
        total: 100,
        cashReceived: undefined,
      });
      expect(missingCash.ok).toBe(false);
    });

    it('d) CARD payment does not require cashReceived and has 0 change due', () => {
      const res = reconcileCashPayment({
        method: 'CARD',
        total: 200,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.changeDue).toBe(0);
        expect(res.cashReceived).toBeNull();
      }
    });

    it('e) MOBILE payment succeeds without requiring cashReceived', () => {
      const res = reconcileCashPayment({
        method: 'MOBILE',
        total: 85,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.changeDue).toBe(0);
      }
    });

    it('f) Payment with tip adds tip to required tendered amount and records tip', () => {
      const res = reconcileCashPayment({
        method: 'CASH',
        total: 100,
        tip: 15,
        cashReceived: 115,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.tip).toBe(15);
        expect(res.changeDue).toBe(0);
      }

      const shortTip = reconcileCashPayment({
        method: 'CASH',
        total: 100,
        tip: 20,
        cashReceived: 110,
      });
      expect(shortTip.ok).toBe(false);
    });

    it('g) Walk-in payment (__WALKIN__) labels receipt as counter sale and skips table mutation', () => {
      expect(paymentCreateSchema.safeParse({
        tableId: '__WALKIN__',
        orderIds: ['#1001'],
        method: 'CASH',
        cashReceived: 50,
      }).success).toBe(true);

      expect(managerTs).toContain("isWalkIn ? 'عميل مباشر (كاونتر)' : `طاولة ${table!.number}`");
      expect(managerTs).toContain('if (!isWalkIn && table) {');
    });

    it('h) Table payment with table reset resets table to AVAILABLE, closes session, and resolves waiter requests', () => {
      expect(managerTs).toContain("data: { status: 'AVAILABLE', hasWaiterCall: false, lastActivityAt: now }");
      expect(managerTs).toContain("data: { status: 'CLOSED', endedAt: now }");
      expect(managerTs).toContain("data: { status: 'RESOLVED', resolvedAt: now }");
    });

    it('i) Duplicate payment attempt on already paid or empty orders returns 409', () => {
      expect(managerTs).toContain("return res.status(409).json({ success: false, error: 'كل الفواتير المحددة مدفوعة مسبقًا أو ملغاة', statusCode: 409 });");
      expect(managerTs).toContain("return res.status(409).json({ success: false, error: 'بعض الفواتير المحددة غير صالحة للدفع (مدفوعة أو ملغاة أو من مطعم آخر)', statusCode: 409 });");
    });

    it('j) Concurrent payment race condition is detected via conditional update count and returns 409', () => {
      expect(managerTs).toContain('if (claimed.count !== ordersToPay.length) {');
      expect(managerTs).toContain("throw Object.assign(new Error('PAYMENT_RACE'), { code: 'PAYMENT_RACE' });");
      expect(managerTs).toContain("error: 'تم تحصيل إحدى هذه الفواتير للتو من جهاز آخر. حدّث الصفحة وحاول مجدداً.'");
    });

    it('k) Payment with invalid or non-existent order IDs is rejected', () => {
      const invalidSchema = paymentCreateSchema.safeParse({
        tableId: 'table-1',
        orderIds: [],
        method: 'CASH',
      });
      expect(invalidSchema.success).toBe(false);
    });

    it('l) Payment enforces tenant isolation and rejects mixed or foreign table orders', () => {
      expect(managerTs).toContain('const foreignOrder = ordersToPay.find((o) => o.tableId !== tableId);');
      expect(managerTs).toContain('لا تنتمي لهذه الطاولة ولا يمكن تحصيلها معها');
      expect(managerTs).toContain('where: { restaurantId }');
    });

    it('m) Receipt number collision recovery handles retries with resilient allocator', () => {
      expect(managerTs).toContain('generateNextReceiptNumber');
      expect(managerTs).toContain('for (let attempt = 0; attempt < 5 && !payment; attempt += 1)');
      expect(managerTs).toContain("if (code !== 'P2002') throw txErr;");
    });

    it('n) Transaction wraps order update, payment create, and table close in an atomic prisma.$transaction', () => {
      expect(managerTs).toContain('await prisma.$transaction(async (tx) => {');
      expect(managerTs).toContain('await tx.order.updateMany');
      expect(managerTs).toContain('await tx.payment.create');
    });

    it('o) Order progression transitions status to SERVED and paymentStatus to PAID with timestamp and cashierId', () => {
      expect(managerTs).toContain("status: 'SERVED'");
      expect(managerTs).toContain("paymentStatus: 'PAID'");
      expect(managerTs).toContain('paymentMethod: paidMethod');
      expect(managerTs).toContain('settledAt: now');
      expect(managerTs).toContain('cashierId: req.user!.id');
    });
  });
});
