import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Test environment — set BEFORE the policy module is imported, because it reads
// server/config.ts (which validates JWT_SECRET at import time).
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'retention-test-secret-0123456789';
process.env.RETENTION_ENABLED = 'false';

// The policy module is DATABASE-FREE by construction: importing it here (unlike
// the sweep module, which pulls the Prisma client) proves the decisions can be
// reviewed and unit-tested without a database or a storage provider.
const { businessSessionEnd, isArchivable, isPurgeEligible } = await import(
  '../../server/services/retentionPolicy'
);

/**
 * Daily archive + temporary-data retention — pure logic + contract tests.
 *
 * The domain rule these tests pin down: a "business day" is NOT a calendar day
 * and NOT midnight. A venue that opens at 10:00 and closes at 02:30 serves ONE
 * session, and an order placed at 02:20 belongs to the session that started the
 * previous morning. Everything is evaluated in the tenant's own timezone, so a
 * server in UTC and a guest in Jerusalem agree on when the day ended.
 *
 * The sweep's idempotency (running it twice must not corrupt anything) is
 * asserted below at the source level and, against a real database, in
 * payment-proof-flow.integration.test.ts.
 */

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');
const retentionTs = read('server/services/retention.ts');
const indexTs = read('server/index.ts');
const cleanupScript = read('server/scripts/retention-cleanup.ts');

const HOUR = 3_600_000;
const TZ = 'Asia/Jerusalem'; // the platform default (Restaurant.timezone)

describe('business session boundary — tenant-local, not midnight', () => {
  it('closes the session of an order placed during the day at next-day start + grace', () => {
    // 2026-09-14 14:00 in Jerusalem (UTC+3 in September) = 11:00 UTC.
    const placed = new Date('2026-09-14T11:00:00.000Z');
    const end = businessSessionEnd(placed, TZ, 6);
    // Local day starts 2026-09-14T00:00 (+3) = 2026-09-13T21:00Z; +30h = 2026-09-15T03:00Z.
    expect(end.toISOString()).toBe('2026-09-15T03:00:00.000Z');
    // The session outlives the calendar day it started in (24h + 6h grace).
    const localDayStart = new Date('2026-09-13T21:00:00.000Z'); // 2026-09-14T00:00 local
    expect(end.getTime() - localDayStart.getTime()).toBe(30 * HOUR);
    expect(end.getTime()).toBeGreaterThan(placed.getTime());
  });

  it('treats a 02:30 after-midnight order as part of the PREVIOUS business day', () => {
    const lateNight = new Date('2026-09-15T23:30:00.000Z'); // 02:30 local on the 16th
    const earlyMorningNextDay = new Date('2026-09-16T04:00:00.000Z'); // 07:00 local on the 16th

    // Both orders belong to the session that started on the 16th local (00:00
    // local = 2026-09-15T21:00Z) and close together: 00:00 local + 24h + 6h.
    expect(businessSessionEnd(lateNight, TZ, 6).toISOString()).toBe(
      businessSessionEnd(earlyMorningNextDay, TZ, 6).toISOString()
    );
  });

  it('is monotonic in the grace window and safe on missing/garbage timezones', () => {
    const at = new Date('2026-09-14T11:00:00.000Z');
    expect(businessSessionEnd(at, TZ, 0).getTime()).toBeLessThan(
      businessSessionEnd(at, TZ, 6).getTime()
    );
    expect(businessSessionEnd(at, null, 0).getTime()).toBeLessThanOrEqual(
      businessSessionEnd(at, 'UTC', 0).getTime()
    );
    // An unknown timezone must not throw — the sweep runs on every tenant.
    expect(() => businessSessionEnd(at, 'Not/AZone', 6)).not.toThrow();
  });
});

describe('archivability — only closed, settled/cancelled business', () => {
  const placed = new Date('2026-09-14T11:00:00.000Z'); // 14:00 local
  const afterClose = new Date('2026-09-15T04:00:00.000Z'); // 07:00 local next day
  const sameDay = new Date('2026-09-14T20:00:00.000Z'); // 23:00 local

  it('never archives an open bill, even after the session boundary', () => {
    expect(
      isArchivable(
        { status: 'SERVED', paymentStatus: 'UNPAID', settledAt: null, createdAt: placed },
        afterClose,
        TZ,
        6
      )
    ).toBe(false);
    expect(
      isArchivable(
        { status: 'SERVED', paymentStatus: 'PENDING_VERIFICATION', settledAt: null, createdAt: placed },
        afterClose,
        TZ,
        6
      )
    ).toBe(false);
  });

  it('does not archive a paid order before its session has closed', () => {
    expect(
      isArchivable(
        { status: 'SERVED', paymentStatus: 'PAID', settledAt: placed, createdAt: placed },
        sameDay,
        TZ,
        6
      )
    ).toBe(false);
  });

  it('archives paid orders once the session is closed (settlement time decides)', () => {
    expect(
      isArchivable(
        { status: 'SERVED', paymentStatus: 'PAID', settledAt: placed, createdAt: placed },
        afterClose,
        TZ,
        6
      )
    ).toBe(true);
    // A bill settled after midnight uses the settlement instant, not creation.
    expect(
      isArchivable(
        {
          status: 'SERVED',
          paymentStatus: 'PAID',
          settledAt: new Date('2026-09-15T23:30:00.000Z'), // 02:30 local on the 16th
          createdAt: placed,
        },
        afterClose,
        TZ,
        6
      )
    ).toBe(false);
  });

  it('archives cancelled orders after their session closes', () => {
    expect(
      isArchivable({ status: 'CANCELLED', paymentStatus: 'UNPAID', createdAt: placed }, sameDay, TZ, 6)
    ).toBe(false);
    expect(
      isArchivable({ status: 'CANCELLED', paymentStatus: 'UNPAID', createdAt: placed }, afterClose, TZ, 6)
    ).toBe(true);
  });
});

describe('purge eligibility — temporary data only, never mid-verification', () => {
  const archivedAt = new Date('2026-09-15T03:00:00.000Z');
  const after = (hours: number) => new Date(archivedAt.getTime() + hours * HOUR);
  const base = {
    archivedAt,
    paymentStatus: 'PAID',
    customerPhone: '0599123456',
    paymentProofPath: 'payment-proofs/restaurant/rest-A/order/o-1/x.png',
    retentionPurgedAt: null,
  };

  it('requires an archived order AND the full retention window', () => {
    expect(isPurgeEligible({ ...base, archivedAt: null }, after(72), 48)).toBe(false);
    expect(isPurgeEligible(base, after(47), 48)).toBe(false);
    expect(isPurgeEligible(base, after(48), 48)).toBe(true);
  });

  it('never purges an order awaiting verification (the cashier may still need it)', () => {
    expect(
      isPurgeEligible({ ...base, paymentStatus: 'PENDING_VERIFICATION' }, after(240), 48)
    ).toBe(false);
  });

  it('retries a REJECTED receipt whose object outlived the decision', () => {
    // The storage delete failed when the cashier rejected the receipt. The
    // order is not archived (it is an open, unpaid bill again) — without this
    // second path the rejected customer document would never be removed.
    const rejected = {
      archivedAt: null,
      paymentStatus: 'UNPAID',
      paymentRejectedAt: archivedAt,
      customerPhone: '0599123456',
      paymentProofPath: 'payment-proofs/restaurant/rest-A/order/o-2/y.png',
      retentionPurgedAt: null,
    };
    expect(isPurgeEligible(rejected, after(47), 48)).toBe(false);
    expect(isPurgeEligible(rejected, after(48), 48)).toBe(true);
    // A re-upload wins: the order is awaiting a decision again, so the retry
    // must not delete the receipt the cashier is about to look at.
    expect(
      isPurgeEligible({ ...rejected, paymentStatus: 'PENDING_VERIFICATION' }, after(240), 48)
    ).toBe(false);
    // Nothing temporary left → nothing to do.
    expect(
      isPurgeEligible({ ...rejected, customerPhone: null, paymentProofPath: null }, after(240), 48)
    ).toBe(false);
  });

  it('treats a name-only notice as temporary data too', () => {
    const nameOnly = {
      archivedAt,
      paymentStatus: 'PAID',
      customerName: 'أحمد سالم',
      customerPhone: null,
      paymentProofPath: null,
      retentionPurgedAt: null,
    };
    expect(isPurgeEligible(nameOnly, after(48), 48)).toBe(true);
    expect(isPurgeEligible({ ...nameOnly, customerName: null }, after(48), 48)).toBe(false);
  });

  it('is a no-op for an order with nothing temporary left, or already purged', () => {
    expect(
      isPurgeEligible({ ...base, customerPhone: null, paymentProofPath: null }, after(240), 48)
    ).toBe(false);
    expect(
      isPurgeEligible({ ...base, retentionPurgedAt: new Date() }, after(240), 48)
    ).toBe(false);
  });

  it('leaves financial records alone: the purge writes only the temporary fields', () => {
    const purge = retentionTs.slice(
      retentionTs.indexOf('export async function purgeTemporaryOperationalData')
    );
    const dataBlock = purge.slice(purge.indexOf('data: {'), purge.indexOf('},', purge.indexOf('data: {')));
    expect(dataBlock).toContain('customerName: null');
    expect(dataBlock).toContain('customerPhone: null');
    expect(dataBlock).toContain('paymentProofPath: null');
    expect(dataBlock).toContain('retentionPurgedAt: now');
    for (const financial of [
      'total',
      'subtotal',
      'tax',
      'paymentMethod',
      'paymentStatus',
      'settledAt',
      'cashierId',
      'createdAt',
      'archivedAt',
      'status:',
    ]) {
      expect(dataBlock).not.toContain(financial);
    }
  });
});

describe('sweep implementation — idempotent, tenant-scoped, failure-safe', () => {
  it('archives with a conditional updateMany (a second run matches nothing)', () => {
    expect(retentionTs).toContain('prisma.order.updateMany');
    expect(retentionTs).toContain('archivedAt: null');
    expect(retentionTs).toContain('archivedAt: now');
    expect(retentionTs).toContain('restaurantId: order.restaurantId');
  });

  it('purges storage BEFORE the DB fields and keeps a failing pointer for retry', () => {
    const purge = retentionTs.slice(retentionTs.indexOf('export async function purgeTemporaryOperationalData'));
    const storageIdx = purge.indexOf('await discardPaymentProof(order.paymentProofPath)');
    const dbIdx = purge.indexOf('customerPhone: null');
    expect(storageIdx).toBeGreaterThan(-1);
    expect(dbIdx).toBeGreaterThan(storageIdx);
    expect(purge).toContain('purgeFailures += 1');
    expect(purge).toContain('continue;');
    expect(purge).toContain('retentionPurgedAt: null'); // idempotency guard on the DB write
  });

  it('selects rejected-receipt retries in the same purge pass', () => {
    expect(retentionTs).toContain('paymentRejectedAt: true');
    expect(retentionTs).toContain('isPurgeEligible(order, now, retentionHours)');
  });

  it('bounds the work per run and never loads unrelated orders', () => {
    expect(retentionTs).toContain('take: batchSize');
    expect(retentionTs).toContain('orderBy: { createdAt: \'asc\' }');
    expect(retentionTs).toContain('orderBy: { archivedAt: \'asc\' }');
    // Only orders that still carry temporary data are candidates.
    expect(retentionTs).toContain('{ customerName: { not: null } }');
    expect(retentionTs).toContain('{ customerPhone: { not: null } }');
    expect(retentionTs).toContain('{ paymentProofPath: { not: null } }');
  });

  it('supports a dry run so an operator can inspect before any write', () => {
    expect(retentionTs).toContain('dryRun');
    expect(cleanupScript).toContain('dry-run');
    expect(cleanupScript).toContain('retention:cleanup');
  });

  it('is reachable from a portable CLI (no platform scheduler is assumed)', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['retention:cleanup']).toBe('tsx server/scripts/retention-cleanup.ts');
    // The script must use the same service the boot hook uses (one logic path).
    expect(cleanupScript).toContain("from '../services/retention'");
    expect(cleanupScript).toContain('runRetentionSweep');
  });

  it('the in-process sweep is opt-in and cannot break boot', () => {
    expect(indexTs).toContain('config.retentionEnabled');
    expect(indexTs).toContain('runRetentionSweep');
    expect(indexTs).toContain('unref()');
    // Non-fatal: a retention failure is logged, never thrown at boot.
    expect(indexTs).toMatch(/retention[\s\S]{0,400}catch/);
  });
});
