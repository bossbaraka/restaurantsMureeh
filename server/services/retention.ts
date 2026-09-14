import { prisma } from '../db/prisma';
import { config } from '../config';
import { discardPaymentProof, PAYMENT_STATUS } from './paymentProofs';
import { isArchivable, isPurgeEligible } from './retentionPolicy';

// The archive/retention DECISIONS live in ./retentionPolicy (pure, unit-tested
// without a database); this module performs the sweeps that apply them.
export {
  TERMINAL_PAYMENT_STATUSES,
  businessSessionEnd,
  isArchivable,
  isPurgeEligible,
} from './retentionPolicy';

// ============================================================
// Daily archive + retention of TEMPORARY operational data.
//
// What this feature is NOT allowed to do: delete financial history. Orders,
// totals, payment method/status, settlement timestamps, receipts and audit
// rows survive forever. The Archive is a TIMESTAMP MARKER on the order, not a
// copy of the table:
//
//   business session closes  →  Order.archivedAt is set
//   retention window passes  →  the transfer receipt object is deleted and
//                               Order.customerPhone / paymentProofPath are
//                               cleared, Order.retentionPurgedAt is stamped
//
// Business day ≠ calendar day. Venues routinely serve past midnight, so the
// session boundary is the tenant-LOCAL day boundary (Restaurant.timezone,
// reusing startOfDayInTimezone — the same helper the dashboard uses) shifted
// by `archiveGraceHours`. With the default 6h window, an order placed at
// 02:30 belongs to the previous business day and both close together.
//
// Everything below is idempotent and retry-safe:
//   - the archive step is a single conditional UPDATE (running it twice is a
//     no-op the second time),
//   - the purge step clears fields the sweep selects on, so a second run finds
//     nothing to do,
//   - a storage failure leaves the DB pointer intact and retries next run.
// ============================================================

export interface ArchiveSweepResult {
  /** Orders whose business session is closed and that got `archivedAt`. */
  archived: number;
  /** Orders whose temporary operational data was purged. */
  purged: number;
  /** Proof objects that could not be deleted (retried on the next run). */
  purgeFailures: number;
  /** Orders selected for a purge this run (for observability/logging). */
  candidates: string[];
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Sweeps (database) — decisions come from ./retentionPolicy
// ---------------------------------------------------------------------------

/**
 * Mark every order whose business session has closed as archived.
 *
 * Runs as ONE conditional UPDATE per candidate batch, so two concurrent sweeps
 * (or a cron overlapping a manual run) can never double-apply anything: the
 * second update matches zero rows because `archivedAt` is no longer null.
 */
export async function archiveClosedOrders(options: {
  now?: Date;
  graceHours?: number;
  batchSize?: number;
  dryRun?: boolean;
} = {}): Promise<{ archived: number; candidates: string[] }> {
  const now = options.now ?? new Date();
  const graceHours = options.graceHours ?? config.archiveGraceHours;
  const batchSize = options.batchSize ?? config.retentionBatchSize;

  // Candidate window: sessions that closed before `now`. The earliest possible
  // session end is 24h after the order's local day start, so the window is
  // computed conservatively from timestamps alone and the exact per-tenant
  // boundary is re-checked in application code below (cheap, per tenant).
  const cutoff = new Date(now.getTime() - 24 * 3_600_000);
  const candidates = await prisma.order.findMany({
    where: {
      archivedAt: null,
      createdAt: { lte: cutoff },
      OR: [
        { status: 'CANCELLED' },
        { paymentStatus: PAYMENT_STATUS.PAID, settledAt: { not: null } },
      ],
    },
    select: {
      id: true,
      restaurantId: true,
      status: true,
      paymentStatus: true,
      settledAt: true,
      createdAt: true,
      restaurant: { select: { timezone: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  const eligible = candidates.filter((order) =>
    isArchivable(order, now, order.restaurant?.timezone, graceHours)
  );
  if (eligible.length === 0 || options.dryRun) {
    // dryRun reports what WOULD be archived without writing anything.
    return { archived: 0, candidates: eligible.map((o) => o.id) };
  }

  // Conditional, tenant-scoped, idempotent: only rows that are STILL unarchived
  // are stamped, and the tenant filter comes from the row itself.
  let archived = 0;
  for (const order of eligible) {
    const result = await prisma.order.updateMany({
      where: { id: order.id, restaurantId: order.restaurantId, archivedAt: null },
      data: { archivedAt: now },
    });
    archived += result.count;
  }
  return { archived, candidates: eligible.map((o) => o.id) };
}

/**
 * Purge the temporary operational data of eligible orders (archived business,
 * or a rejected receipt whose object outlived the decision): the private
 * receipt object first, then the DB fields.
 *
 * Failure policy: deleting the object first means a crash between the two steps
 * leaves a DB pointer to a missing object — the next run deletes nothing (the
 * private delete is idempotent), clears the fields and converges. The reverse
 * order could leave a reachable receipt that nothing points to (data we would
 * never be able to find and delete).
 */
export async function purgeTemporaryOperationalData(options: {
  now?: Date;
  retentionHours?: number;
  batchSize?: number;
  dryRun?: boolean;
  restaurantId?: string;
} = {}): Promise<ArchiveSweepResult> {
  const now = options.now ?? new Date();
  const retentionHours = options.retentionHours ?? config.proofRetentionHours;
  const batchSize = options.batchSize ?? config.retentionBatchSize;

  const candidates = await prisma.order.findMany({
    where: {
      retentionPurgedAt: null,
      ...(options.restaurantId ? { restaurantId: options.restaurantId } : {}),
      // Something temporary left to remove…
      OR: [
        { customerName: { not: null } },
        { customerPhone: { not: null } },
        { paymentProofPath: { not: null } },
      ],
      // A receipt awaiting a cashier decision is never purged.
      paymentStatus: { not: PAYMENT_STATUS.PENDING_VERIFICATION },
    },
    select: {
      id: true,
      restaurantId: true,
      paymentStatus: true,
      archivedAt: true,
      paymentRejectedAt: true,
      customerName: true,
      customerPhone: true,
      paymentProofPath: true,
      retentionPurgedAt: true,
    },
    orderBy: { archivedAt: 'asc' },
    take: batchSize,
  });

  const eligible = candidates.filter((order) =>
    isPurgeEligible(order, now, retentionHours)
  );

  if (options.dryRun) {
    return {
      archived: 0,
      purged: 0,
      purgeFailures: 0,
      candidates: eligible.map((o) => o.id),
      dryRun: true,
    };
  }

  let purged = 0;
  let purgeFailures = 0;

  for (const order of eligible) {
    // 1) Storage first (idempotent).
    if (order.paymentProofPath) {
      const deleted = await discardPaymentProof(order.paymentProofPath);
      if (!deleted) {
        // Keep the pointer so the next run can retry; never claim a purge that
        // did not happen.
        purgeFailures += 1;
        continue;
      }
    }

    // 2) Then the DB fields, tenant-scoped and idempotent.
    try {
      const result = await prisma.order.updateMany({
        where: {
          id: order.id,
          restaurantId: order.restaurantId,
          retentionPurgedAt: null,
        },
        data: {
          // Temporary operational data only (name + phone + receipt). Every
          // financial attribute stays untouched for reconciliation.
          customerName: null,
          customerPhone: null,
          paymentProofPath: null,
          retentionPurgedAt: now,
        },
      });
      purged += result.count;
    } catch (err) {
      purgeFailures += 1;
      console.error(
        `[retention] failed to clear temporary data for order ${order.id}:`,
        err
      );
    }
  }

  return {
    archived: 0,
    purged,
    purgeFailures,
    candidates: eligible.map((o) => o.id),
    dryRun: false,
  };
}

/**
 * One full sweep: archive closed sessions, then purge what the retention window
 * has released. Safe to run concurrently and repeatedly.
 */
export async function runRetentionSweep(options: {
  now?: Date;
  graceHours?: number;
  retentionHours?: number;
  batchSize?: number;
  dryRun?: boolean;
} = {}): Promise<{
  archive: { archived: number; candidates: string[] };
  purge: ArchiveSweepResult;
}> {
  const now = options.now ?? new Date();
  const archive = await archiveClosedOrders({ ...options, now });
  const purge = await purgeTemporaryOperationalData({ ...options, now });
  return { archive, purge };
}
