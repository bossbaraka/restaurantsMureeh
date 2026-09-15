import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isLiveOrder,
  buildManagerOrderLiveWhere,
  buildManagerOrderHistoryWhere,
  parseClosedWindowHours,
  assembleOperationsOrders,
  OPERATIONS_HISTORY_DEFAULT_HOURS,
  OPERATIONS_HISTORY_MIN_HOURS,
  OPERATIONS_HISTORY_MAX_HOURS,
  OPERATIONS_LIVE_TAKE,
  OPERATIONS_HISTORY_TAKE,
} from '../../server/services/orderVisibility';

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

/**
 * H-03 (adversarial audit 2026-09-15) — operational order visibility.
 *
 * The defect: staff screens consumed the default "50 newest orders" page, so
 * an order that was still alive but older than the window silently vanished
 * from the KDS/floor/POS while the guest kept seeing it.
 *
 * The fix is domain-aware querying — these tests simulate the exact
 * 51-order / 100-order scenarios from the audit task without a database:
 * the route composes `live = findMany(buildManagerOrderLiveWhere)` and
 * `history = findMany(buildManagerOrderHistoryWhere)`, then merges via
 * assembleOperationsOrders. Both where-builders and the merge are pure.
 */

interface FakeOrder {
  id: string;
  restaurantId: string;
  branchId?: string;
  status: string;
  paymentStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

const NOW = new Date('2026-09-15T20:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);

function makeOrder(partial: Partial<FakeOrder> & { id: string }): FakeOrder {
  return {
    restaurantId: 'tenant-a',
    status: 'PENDING',
    paymentStatus: 'UNPAID',
    createdAt: hoursAgo(1),
    updatedAt: hoursAgo(1),
    ...partial,
  };
}

/** Mirror of the route's logical pipeline, applied to an in-memory dataset. */
function simulateOperationsScope(dataset: FakeOrder[], tenantId: string, closedHours = OPERATIONS_HISTORY_DEFAULT_HOURS) {
  const liveWhere = buildManagerOrderLiveWhere(tenantId);
  const historyWhere = buildManagerOrderHistoryWhere(tenantId, NOW, closedHours);
  expect(liveWhere.restaurantId).toBe(tenantId);
  expect(historyWhere.restaurantId).toBe(tenantId);

  const closedCutoff = new Date(NOW.getTime() - closedHours * 3_600_000);
  const live = dataset
    .filter((o) => o.restaurantId === tenantId && isLiveOrder(o))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, OPERATIONS_LIVE_TAKE);
  const isClosed = (o: FakeOrder) =>
    o.status === 'CANCELLED' || (o.status === 'SERVED' && o.paymentStatus === 'PAID');
  const history = dataset
    .filter((o) => o.restaurantId === tenantId && isClosed(o) && o.updatedAt >= closedCutoff)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, OPERATIONS_HISTORY_TAKE);
  return assembleOperationsOrders(live, history);
}

describe('H-03 · live-order predicate', () => {
  it('treats in-flight statuses as live regardless of payment step', () => {
    for (const status of ['PENDING', 'PREPARING', 'READY']) {
      expect(isLiveOrder({ status, paymentStatus: 'UNPAID' })).toBe(true);
      expect(isLiveOrder({ status, paymentStatus: 'PAID' })).toBe(true);
    }
  });
  it('treats SERVED + UNPAID as live (the open bill the cashier must close)', () => {
    expect(isLiveOrder({ status: 'SERVED', paymentStatus: 'UNPAID' })).toBe(true);
    expect(isLiveOrder({ status: 'SERVED', paymentStatus: 'PENDING_VERIFICATION' })).toBe(true);
  });
  it('excludes completed (SERVED + PAID) and cancelled orders', () => {
    expect(isLiveOrder({ status: 'SERVED', paymentStatus: 'PAID' })).toBe(false);
    expect(isLiveOrder({ status: 'CANCELLED', paymentStatus: 'UNPAID' })).toBe(false);
    expect(isLiveOrder({ status: 'CANCELLED', paymentStatus: 'PAID' })).toBe(false);
  });
  it('safe-fails garbage', () => {
    // @ts-expect-error adversarial input
    expect(isLiveOrder(null)).toBe(false);
    // @ts-expect-error adversarial input
    expect(isLiveOrder(undefined)).toBe(false);
  });
});

describe('H-03 · where-builder shape (tenant isolation is structural)', () => {
  it('the live where pins restaurantId and ANDs the live invariant', () => {
    const where = buildManagerOrderLiveWhere('tenant-a') as any;
    expect(where.restaurantId).toBe('tenant-a');
    const arms: any[] = where.AND;
    expect(arms).toEqual([
      { status: { not: 'CANCELLED' } },
      { NOT: { status: 'SERVED', paymentStatus: 'PAID' } },
    ]);
  });
  it('no where-builder arm may reference another tenant or a branch filter', () => {
    const json = JSON.stringify(buildManagerOrderLiveWhere('tenant-a')) + JSON.stringify(buildManagerOrderHistoryWhere('tenant-a', NOW, 24));
    expect(json).not.toContain('tenant-b');
    expect(json).not.toContain('branchId'); // operation set is tenant-wide by design
  });
  it('the history where windows on updatedAt, not createdAt', () => {
    const where = buildManagerOrderHistoryWhere('tenant-a', NOW, 12) as any;
    const cutoff = new Date(NOW.getTime() - 12 * 3_600_000);
    expect(where.updatedAt).toEqual({ gte: cutoff });
    expect(where.OR).toEqual([{ status: 'CANCELLED' }, { status: 'SERVED', paymentStatus: 'PAID' }]);
  });
  it('closedHours input is bounded to the trusted 1..72 range', () => {
    expect(parseClosedWindowHours('24')).toBe(24);
    expect(parseClosedWindowHours('0')).toBe(OPERATIONS_HISTORY_MIN_HOURS);
    expect(parseClosedWindowHours('-50')).toBe(OPERATIONS_HISTORY_MIN_HOURS);
    expect(parseClosedWindowHours('999999')).toBe(OPERATIONS_HISTORY_MAX_HOURS);
    expect(parseClosedWindowHours('abc')).toBe(OPERATIONS_HISTORY_DEFAULT_HOURS);
    expect(parseClosedWindowHours(undefined)).toBe(OPERATIONS_HISTORY_DEFAULT_HOURS);
    expect(parseClosedWindowHours('')).toBe(OPERATIONS_HISTORY_DEFAULT_HOURS);
  });
});

describe('H-03 · the audit scenarios (51 / 100 orders)', () => {
  it('51 orders: the oldest active order survives 50 newer completed ones', () => {
    const oldestActive = makeOrder({ id: 'ord-old-active', createdAt: daysAgo(2), status: 'PENDING', paymentStatus: 'UNPAID', updatedAt: daysAgo(2) });
    const newerClosed = Array.from({ length: 50 }, (_, i) =>
      makeOrder({
        id: `ord-closed-${i}`,
        createdAt: hoursAgo(Math.max(0.1, 20 - i * 0.3)),
        updatedAt: hoursAgo(Math.max(0.1, 20 - i * 0.3)),
        status: 'SERVED',
        paymentStatus: 'PAID',
      })
    );
    const result = simulateOperationsScope([oldestActive, ...newerClosed], 'tenant-a');
    const ids = result.map((o) => o.id);
    expect(ids).toContain('ord-old-active');
    expect(ids[0]).toBe('ord-old-active'); // oldest live first
    // All 50 recent-closed also present (within the history window + cap).
    expect(result).toHaveLength(51);
  });

  it('100 orders: 2-week-old active order remains discoverable', () => {
    const veryOldActive = makeOrder({ id: 'ord-2w-pending', createdAt: daysAgo(14), status: 'PREPARING', updatedAt: hoursAgo(2) });
    const oldOpenBill = makeOrder({ id: 'ord-3w-served-unpaid', createdAt: daysAgo(21), status: 'SERVED', paymentStatus: 'UNPAID', updatedAt: daysAgo(21) });
    const newer = Array.from({ length: 98 }, (_, i) =>
      makeOrder({
        id: `ord-new-${i}`,
        createdAt: hoursAgo(Math.max(0.05, 30 - i * 0.3)),
        updatedAt: hoursAgo(Math.max(0.05, 30 - i * 0.3)),
        status: i % 3 === 0 ? 'CANCELLED' : 'SERVED',
        paymentStatus: i % 3 === 0 ? 'UNPAID' : 'PAID',
      })
    );
    const result = simulateOperationsScope([veryOldActive, oldOpenBill, ...newer], 'tenant-a');
    const ids = result.map((o) => o.id);
    expect(ids).toContain('ord-2w-pending');
    expect(ids).toContain('ord-3w-served-unpaid'); // open SERVED bill never disappears
    // Live orders lead the payload.
    expect(ids.slice(0, 2)).toEqual(['ord-3w-served-unpaid', 'ord-2w-pending']);
  });

  it('completed orders beyond the history window do not pollute the queue', () => {
    const staleClosed = makeOrder({ id: 'ord-stale-closed', status: 'SERVED', paymentStatus: 'PAID', createdAt: daysAgo(10), updatedAt: daysAgo(10) });
    const staleCancelled = makeOrder({ id: 'ord-stale-cancelled', status: 'CANCELLED', createdAt: daysAgo(8), updatedAt: daysAgo(8) });
    const active = makeOrder({ id: 'ord-active' });
    const result = simulateOperationsScope([staleClosed, staleCancelled, active], 'tenant-a');
    const ids = result.map((o) => o.id);
    expect(ids).toContain('ord-active');
    expect(ids).not.toContain('ord-stale-closed');
    expect(ids).not.toContain('ord-stale-cancelled');
  });

  it('a long-open order closed inside the window lands in history (updatedAt semantics)', () => {
    const longOpen = makeOrder({
      id: 'ord-long-open',
      createdAt: daysAgo(5),
      updatedAt: hoursAgo(2), // settled two hours ago after being open for 5 days
      status: 'SERVED',
      paymentStatus: 'PAID',
    });
    const result = simulateOperationsScope([longOpen], 'tenant-a');
    expect(result.map((o) => o.id)).toContain('ord-long-open');
  });

  it('multiple branches of one tenant share the operation set (no branch hiding)', () => {
    const branchAActive = makeOrder({ id: 'ord-a-active', branchId: 'branch-a', status: 'READY', createdAt: hoursAgo(1) });
    const branchBActive = makeOrder({ id: 'ord-b-active', branchId: 'branch-b', status: 'PENDING', createdAt: hoursAgo(4) });
    const branchBClosedNewer = makeOrder({ id: 'ord-b-closed', branchId: 'branch-b', status: 'SERVED', paymentStatus: 'PAID', createdAt: hoursAgo(0.5), updatedAt: hoursAgo(0.5) });
    const result = simulateOperationsScope([branchAActive, branchBActive, branchBClosedNewer], 'tenant-a');
    const ids = result.map((o) => o.id);
    expect(ids).toContain('ord-a-active');
    expect(ids).toContain('ord-b-active');
    expect(ids).toContain('ord-b-closed'); // recent history, after live rows
    expect(ids.slice(0, 2)).toEqual(['ord-b-active', 'ord-a-active']);
  });

  it('multiple tenants never mix: foreign rows cannot enter the operation payload', () => {
    const myActive = makeOrder({ id: 'ord-mine', restaurantId: 'tenant-a' });
    const foreignActive = makeOrder({ id: 'ord-foreign', restaurantId: 'tenant-b' });
    const foreignClosed = makeOrder({ id: 'ord-foreign-closed', restaurantId: 'tenant-b', status: 'SERVED', paymentStatus: 'PAID' });
    const result = simulateOperationsScope([myActive, foreignActive, foreignClosed], 'tenant-a');
    const ids = result.map((o) => o.id);
    expect(ids).toContain('ord-mine');
    expect(ids).not.toContain('ord-foreign');
    expect(ids).not.toContain('ord-foreign-closed');
  });
});

describe('H-03 · merge invariants', () => {
  it('live rows lead; history rows follow; duplicates collapse once', () => {
    const live = [{ id: 'l2' }, { id: 'l1' }]; // route sorts live asc already
    const history = [{ id: 'h1' }, { id: 'l1' }]; // raced row appears in both
    const merged = assembleOperationsOrders(live, history);
    expect(merged.map((o) => o.id)).toEqual(['l2', 'l1', 'h1']);
  });
  it('truncation can only touch history — live capacity alone bounds it', () => {
    expect(OPERATIONS_LIVE_TAKE).toBe(200);
    expect(OPERATIONS_HISTORY_TAKE).toBe(100);
  });
});

describe('H-03 · route contract', () => {
  const managerTs = read('server/routes/manager.ts');
  const contextTs = read('src/context/RestaurantContext.tsx');

  it('the route honors scope=operations and reports truncation via meta', () => {
    expect(managerTs).toContain("req.query.scope === 'operations'");
    expect(managerTs).toContain('liveHasMore: liveTotal > live.length');
    expect(managerTs).toContain('historyHasMore: historyTotal > history.length');
    expect(managerTs).toContain('buildManagerOrderLiveWhere(restaurantId)');
    expect(managerTs).toContain('buildManagerOrderHistoryWhere(restaurantId, now, closedHours)');
  });
  it('the default endpoint behavior (take/skip pagination) is preserved for other callers', () => {
    expect(managerTs).toContain('parsePagination(req.query as Record<string, unknown>)');
    expect(managerTs).toMatch(/orderBy: \{ createdAt: 'desc' \},\s*take,\s*skip,/);
  });
  it('the staff screens fetch the operations scope (KDS/floor/POS data source)', () => {
    expect(contextTs).toContain("api.getManagerOrders(tenantId, { scope: 'operations' })");
  });
});
