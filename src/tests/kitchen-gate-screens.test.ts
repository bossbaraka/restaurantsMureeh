import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * “الطلب لا يظهر عند المطبخ إلا بعد التأكيد” — the screens half of the gate.
 *
 * `server/services/orderLifecycle.ts` owns the rule and the routes enforce it,
 * but an order is only truly invisible to the kitchen if EVERY surface that
 * renders kitchen work derives its set from the server's `operational` flag:
 *
 *   - KitchenDisplaySystem          — the dedicated KDS board (already gated),
 *   - OrderManagement              — «شاشة الطلبات والمطبخ», and the tab a
 *                                    KITCHEN account LANDS on,
 *   - DashboardOverview            — the pipeline mini-board with its own
 *                                    «بدء التحضير» button,
 *   - TableAggregationModal        — per-order status controls on the bill,
 *   - ManagerLayout / ViewSwitcher — the badge counters that advertise work.
 *
 * Leaving any of them ungated is a real defect twice over: the kitchen sees (and
 * can start) unverified work, and the action then fails with the server's 409
 * «هذا الطلب بانتظار التحقق من الدفع…», which reads as a broken app.
 *
 * A screen must never invent its own gate logic either — it imports the shared
 * predicate so client and server cannot drift.
 */

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const orderManagement = source('../components/manager/OrderManagement.tsx');
const dashboard = source('../components/manager/DashboardOverview.tsx');
const billModal = source('../components/manager/TableAggregationModal.tsx');
const layout = source('../components/manager/ManagerLayout.tsx');
const switcher = source('../components/common/ViewSwitcher.tsx');
const kds = source('../components/manager/KitchenDisplaySystem.tsx');
const managerRoute = source('../../server/routes/manager.ts');
const apiTs = source('../services/api.ts');

describe('every kitchen-facing surface derives from the payment gate', () => {
  it('the orders/kitchen tab renders released tickets only', () => {
    expect(orderManagement).toContain(
      "from '../../utils/orderLifecycle';"
    );
    expect(orderManagement).toContain('isOrderHeldForPayment');
    expect(orderManagement).toContain('isOrderOperational');
    expect(orderManagement).toContain(
      'orders.filter((order) => isOrderOperational(order) || order.status === \'CANCELLED\')'
    );
    // …and the grid/filters/counts all read that set, never the raw list.
    expect(orderManagement).toContain('return gateVisibleOrders.filter((order) => {');
    expect(orderManagement).toContain('ALL: gateVisibleOrders.length');
    expect(orderManagement).toContain("PENDING: gateVisibleOrders.filter((o) => o.status === 'PENDING').length");
  });

  it('the orders/kitchen tab explains a held order instead of offering 409-bound work', () => {
    expect(orderManagement).toContain('heldForPayment.length > 0');
    expect(orderManagement).toContain('بانتظار');
    expect(orderManagement).toContain('تأكيد الدفع');
    // The start-preparation action exists for released orders only.
    expect(orderManagement).toMatch(
      /\{order\.status === 'PENDING' && \(\s*\n\s*<button\s*\n\s*onClick=\{\(\) => updateOrderStatus\(order\.id, 'PREPARING'\)/
    );
  });

  it('the dashboard pipeline counts and lists released work, and reports the held set on its own', () => {
    expect(dashboard).toContain(
      "import { isOrderHeldForPayment, isOrderOperational } from '../../utils/orderLifecycle';"
    );
    expect(dashboard).toContain("o.status === 'PENDING' && isOrderOperational(o)");
    expect(dashboard).toContain("o.status === 'PREPARING' && isOrderOperational(o)");
    expect(dashboard).toContain("o.status === 'READY' && isOrderOperational(o)");
    expect(dashboard).toContain("o.status !== 'CANCELLED' && isOrderHeldForPayment(o)");
    // The held set is visible as a count (so a missing ticket is explained) but
    // it is NOT presented as kitchen work: the queue line is not a button.
    expect(dashboard).toContain('طلب بانتظار تأكيد الدفع');
    expect(dashboard).toContain('لا يظهر في المطبخ إلا بعد تأكيد الكاشير للإشعار أو التحصيل من الصندوق');
  });

  it('the table bill modal offers no kitchen action for a held order', () => {
    expect(billModal).toContain(
      "import { isOrderHeldForPayment, isOrderOperational } from '../../utils/orderLifecycle';"
    );
    expect(billModal).toContain("ord.status === 'PENDING' && isOrderOperational(ord)");
    expect(billModal).toContain("ord.status === 'PREPARING' && isOrderOperational(ord)");
    expect(billModal).toContain("ord.status === 'READY' && isOrderOperational(ord)");
    expect(billModal).toContain('بانتظار تأكيد الدفع — لا يبدأ التحضير قبله');
  });

  it('the nav badges count released work only (KITCHEN tab + KDS entry)', () => {
    expect(layout).toContain("import { isOrderOperational, isPaymentVerificationPending } from '../../utils/orderLifecycle';");
    expect(layout).toContain("(o.status === 'PENDING' || o.status === 'PREPARING') && isOrderOperational(o)");
    expect(switcher).toContain("import { isOrderOperational } from '../../utils/orderLifecycle';");
    expect(switcher).toContain("(o.status === 'PENDING' || o.status === 'PREPARING') && isOrderOperational(o)");
    // The till badge: a receipt that needs a decision must not go unnoticed.
    expect(layout).toContain('isPaymentVerificationPending(o)');
  });

  it('the KDS keeps its own contract (predicate + held count + wording)', () => {
    expect(kds).toContain('isOrderOperational(o)');
    expect(kds).toContain('بانتظار تأكيد الكاشير');
    expect(kds).toContain('لا يبدأ');
    expect(kds).toContain('قبل التأكيد');
  });
});

describe('server: the dashboard kitchen metrics are the released set', () => {
  const statsBlock = managerRoute.slice(
    managerRoute.indexOf('GET /api/manager/dashboard/stats'),
    managerRoute.indexOf("router.get('/orders'")
  );

  it('counts pending/preparing/ready through the gate and exposes the held count', () => {
    expect(statsBlock.length).toBeGreaterThan(500);
    expect(statsBlock).toContain('fulfillmentState: FULFILLMENT_STATE.RELEASED');
    expect(statsBlock).toContain("prisma.order.count({ where: kitchenOrderWhere('PENDING') })");
    expect(statsBlock).toContain("status: { not: 'CANCELLED' },");
    expect(statsBlock).toContain('fulfillmentState: { not: FULFILLMENT_STATE.RELEASED }');
    expect(statsBlock).toContain('heldForPaymentCount');
  });

  it('the manager orders payload can explain WHY an order is held', () => {
    const ordersBlock = managerRoute.slice(
      managerRoute.indexOf('function formatManagerOrderRow'),
      managerRoute.indexOf('POS order creation')
    );
    expect(ordersBlock).toContain('paymentRejected: Boolean(o.paymentRejectedAt)');
    expect(ordersBlock).toContain('paymentRejectedReason: o.paymentRejectionReason || undefined');
    // The gate itself stays server-derived, never client-supplied.
    expect(ordersBlock).toContain('operational: isOperational(o.fulfillmentState)');
  });

  it('the client types the new metric (no parallel fetch for the same number)', () => {
    expect(apiTs).toContain('heldForPaymentCount: number;');
    expect(apiTs).toContain('Number(res.data.heldForPaymentCount) || 0');
  });
});
