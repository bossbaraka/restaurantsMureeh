// ============================================================
// Operational order visibility (audit H-03) — pure domain querying.
//
// PURE MODULE: no env, no prisma, no IO. It builds the plain `where` objects
// the route hands to Prisma, so the domain definition of "live order" is
// unit-testable without a database.
//
// The defect being fixed: the staff screens (KDS, floor, POS open bills,
// cashier payment queue) all read from GET /api/manager/orders, which
// defaulted to "the 50 newest orders" (pagination default). An order placed
// early in a busy shift — still PENDING in the kitchen, still READY at the
// pass, still unpaid SERVED at the cashier — silently fell out of the window
// once 50 newer orders existed. Guests kept seeing it in their tracker; staff
// could not see it anywhere.
//
// The domain fix (NOT a bigger limit): query the two sets the operation
// actually needs, separately, and always put LIVE orders first:
//
//   1. LIVE set — every order that still needs restaurant action, regardless
//      of age: not cancelled AND not (served AND paid). This set is naturally
//      bounded by the real throughput of a venue, and the route still applies
//      a generous cap (200) with an explicit `meta.liveHasMore` flag so the
//      pathological case is VISIBLE instead of silent.
//   2. RECENT-CLOSED set — cancelled/fully-settled orders updated within a
//      bounded sliding window (default 24h), for the history tabs and the
//      cashier's recent receipts. This set can be arbitrarily long; it is the
//      one that gets truncated first, never the live set.
//
// The default (no scope param) behaviour is untouched for backward
// compatibility: newest-first, paginated as before.
// ============================================================

/** Live kitchen/service statuses. */
export const LIVE_ORDER_STATUSES = ['PENDING', 'PREPARING', 'READY'] as const;

/** Default look-back window for recently closed/cancelled orders. */
export const OPERATIONS_HISTORY_DEFAULT_HOURS = 24;
/** Trusted bounds for a client-supplied history window. */
export const OPERATIONS_HISTORY_MIN_HOURS = 1;
export const OPERATIONS_HISTORY_MAX_HOURS = 72;

/** Route cap for the live set. If a tenant ever exceeds it, meta.liveHasMore is true. */
export const OPERATIONS_LIVE_TAKE = 200;
/** Route cap for the recent-closed set. */
export const OPERATIONS_HISTORY_TAKE = 100;

/** The one predicate that defines "still needs restaurant action". */
export function isLiveOrder(order: { status?: unknown; paymentStatus?: unknown }): boolean {
  if (!order || typeof order !== 'object') return false;
  if (order.status === 'CANCELLED') return false;
  // Fully closed: served to the guest AND paid. Everything else — pending
  // cooking, at the pass, awaiting the bill — stays visible regardless of age.
  if (order.status === 'SERVED' && order.paymentStatus === 'PAID') return false;
  return true;
}

export type PrismaWhere = Record<string, unknown>;

/**
 * LIVE set for one tenant: not cancelled AND not (served AND paid).
 * Tenant isolation is structural: `restaurantId` equality is always the outer
 * AND arm; the OR arms can only narrow inside it (no cross-tenant arms, no
 * cross-branch leakage: branch is a display attribute, the operation set is
 * tenant-wide by design so a branchless KDS never misses a ticket).
 */
export function buildManagerOrderLiveWhere(restaurantId: string): PrismaWhere {
  return {
    restaurantId,
    AND: [
      { status: { not: 'CANCELLED' } },
      {
        NOT: {
          status: 'SERVED',
          paymentStatus: 'PAID',
        },
      },
    ],
  };
}

/**
 * RECENT-CLOSED set for one tenant: cancelled OR fully settled, updated
 * within `windowHours` of `now`. Uses updatedAt (the moment the order was
 * cancelled/settled) rather than createdAt so a long-open order closed today
 * still appears in the history window.
 */
export function buildManagerOrderHistoryWhere(
  restaurantId: string,
  now: Date,
  windowHours: number
): PrismaWhere {
  const cutoff = new Date(now.getTime() - windowHours * 3_600_000);
  return {
    restaurantId,
    updatedAt: { gte: cutoff },
    OR: [{ status: 'CANCELLED' }, { status: 'SERVED', paymentStatus: 'PAID' }],
  };
}

/**
 * Parse + bound the client-supplied history window (`?closedHours=`).
 * Any garbage input falls back to the default; the trusted range is
 * [1, 72] hours so a client cannot widen the window into an unbounded scan.
 */
export function parseClosedWindowHours(raw: unknown): number {
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return Math.min(OPERATIONS_HISTORY_MAX_HOURS, Math.max(OPERATIONS_HISTORY_MIN_HOURS, Math.floor(n)));
    }
  }
  return OPERATIONS_HISTORY_DEFAULT_HOURS;
}

export interface OperationsScopeMeta {
  scope: 'operations';
  liveCount: number;
  liveHasMore: boolean;
  historyCount: number;
  historyHasMore: boolean;
  closedWindowHours: number;
}

export interface OperationsOrderRow {
  id: string;
  [key: string]: unknown;
}

/**
 * Deterministically assemble the operations payload:
 *   - LIVE orders first (oldest live first — the oldest unattended ticket is
 *     the one that must surface at the top of every operational screen),
 *   - then RECENTLY-CLOSED orders (newest first),
 *   - duplicated ids removed (an order cannot be in both sets by
 *     construction, but dedupe makes the payload robust to races between the
 *     two queries — a row closed between query 1 and query 2 matches both).
 */
export function assembleOperationsOrders<T extends { id: string }>(live: T[], history: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const row of [...live, ...history]) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}
