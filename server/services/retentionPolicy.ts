import { config } from '../config';
import { startOfDayInTimezone } from '../utils/datetime';
import { PAYMENT_STATUS } from './paymentProofs';

// ============================================================
// Retention / archive POLICY — pure, database-free decisions.
//
// Split out from the sweep (server/services/retention.ts) on purpose: these
// rules are business policy and must be unit-testable — and reviewable — with
// no database connection, no Prisma client and no storage provider.
//
// What the policy encodes:
//   * a business session ends at the tenant-LOCAL day boundary plus a grace
//     window (so a venue that serves past midnight closes ONE session, not two);
//   * only settled or cancelled business is archivable — never an open bill;
//   * temporary operational data (guest phone + private receipt object) becomes
//     purgeable only after the archive marker AND the retention window, and
//     NEVER while a receipt is still awaiting a cashier decision.
//
// Financial history is not affected by any of this: the archive is a marker on
// the order, and a purge clears only the two temporary fields.
// ============================================================

/** Order states whose temporary data may eventually be purged. */
export const TERMINAL_PAYMENT_STATUSES = [PAYMENT_STATUS.PAID, PAYMENT_STATUS.UNPAID] as const;

/**
 * Instant at which the business session containing `at` is considered closed:
 * the start of the NEXT tenant-local day plus the configured grace window.
 *
 * `at` is evaluated in the tenant's own timezone, so the value does not depend
 * on where the server happens to run.
 */
export function businessSessionEnd(
  at: Date,
  timeZone: string | null | undefined,
  graceHours: number = config.archiveGraceHours
): Date {
  const dayStart = startOfDayInTimezone(at, timeZone);
  // The local day start is already the correct boundary for the day that
  // contains `at` (startOfDayInTimezone shifts wall-clock midnight back by the
  // zone offset), so the end of that session is 24h + grace later.
  return new Date(dayStart.getTime() + (24 + Math.max(0, graceHours)) * 3_600_000);
}

/**
 * An order may be archived once its business session has closed AND it is
 * financially settled or cancelled. Never archive an open bill: a table can
 * legitimately still be paying after midnight.
 */
export function isArchivable(
  order: { paymentStatus: string; status: string; settledAt?: Date | null; createdAt: Date },
  now: Date,
  timeZone: string | null | undefined,
  graceHours: number = config.archiveGraceHours
): boolean {
  if (order.status === 'CANCELLED') {
    return now >= businessSessionEnd(order.createdAt, timeZone, graceHours);
  }
  if (order.paymentStatus !== PAYMENT_STATUS.PAID) return false;
  const reference = order.settledAt ?? order.createdAt;
  return now >= businessSessionEnd(reference, timeZone, graceHours);
}

/**
 * Temporary operational data becomes purgeable `retentionHours` after the order
 * was archived. A still-pending verification is never purged: the cashier may
 * not have looked at the receipt yet.
 *
 * There are exactly two ways to become eligible, and both are time-based:
 *   A. the order was archived (its business session closed), or
 *   B. the cashier REJECTED the receipt and the object outlived the decision —
 *      which happens when the storage delete failed at decision time. Without
 *      this second path a failed delete on an order that is never settled would
 *      keep a customer document forever.
 * A re-upload always wins: it moves the order out of these states (pending
 * verification) before the retry can run.
 */
export function isPurgeEligible(
  order: {
    archivedAt?: Date | null;
    paymentStatus: string;
    paymentRejectedAt?: Date | null;
    customerName?: string | null;
    customerPhone?: string | null;
    paymentProofPath?: string | null;
    retentionPurgedAt?: Date | null;
  },
  now: Date,
  retentionHours: number = config.proofRetentionHours
): boolean {
  if (order.retentionPurgedAt) return false;
  if (order.paymentStatus === PAYMENT_STATUS.PENDING_VERIFICATION) return false;
  if (!(TERMINAL_PAYMENT_STATUSES as readonly string[]).includes(order.paymentStatus)) {
    return false;
  }
  const hasTemporaryData = Boolean(
    order.customerName || order.customerPhone || order.paymentProofPath
  );
  if (!hasTemporaryData) return false;

  const windowMs = retentionHours * 3_600_000;
  if (order.archivedAt) return now.getTime() - order.archivedAt.getTime() >= windowMs;
  if (order.paymentRejectedAt) {
    return now.getTime() - order.paymentRejectedAt.getTime() >= windowMs;
  }
  return false;
}
