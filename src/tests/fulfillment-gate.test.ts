import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FULFILLMENT_STATE,
  RELEASE_REASON,
  allowedTransitions,
  canTransition,
  isFulfillmentState,
  isHeldForPayment,
  isOperational,
  normalizeFulfillmentState,
  releaseFields,
} from '../../server/services/orderLifecycle';
import {
  heldOrders,
  isAwaitingGuestPayment,
  isOrderHeldForPayment,
  isOrderOperational,
  isPaymentRejected,
  isPaymentVerificationPending,
  operationalOrders,
} from '../utils/orderLifecycle';

/**
 * THE PAYMENT AUTHORIZATION BOUNDARY.
 *
 * A customer order must NOT enter the restaurant's live workflow until a
 * cashier verified (or collected) the payment. These tests pin the rule at
 * every layer that can break it:
 *
 *   1. the server policy module (runtime semantics) and its exact mirror on the
 *      client (the screens must render the server's decision, never their own);
 *   2. the schema + migration that makes the state durable;
 *   3. the routes that may (and may not) move the gate;
 *   4. the event taxonomy — submission is NOT a kitchen event;
 *   5. the client wiring (mandatory payment step, copy, KDS/POS filters);
 *   6. the security rule: the gate value is never accepted from a request.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const schema = read('../../prisma/schema.prisma');
const migration = read('../../prisma/migrations/20260914180000_add_order_fulfillment_gate/migration.sql');
const migrationDirs = readdirSync(fileURLToPath(new URL('../../prisma/migrations', import.meta.url)));
const publicRoute = read('../../server/routes/public.ts');
const managerRoute = read('../../server/routes/manager.ts');
const validationSchemas = read('../../server/validation/schemas.ts');
const types = read('../types/restaurant.ts');
const api = read('../services/api.ts');
const context = read('../context/RestaurantContext.tsx');
const tracker = read('../components/customer/OrderTrackingDrawer.tsx');
const transferModal = read('../components/customer/TransferPaymentModal.tsx');
const customerLayout = read('../components/customer/CustomerLayout.tsx');
const kds = read('../components/manager/KitchenDisplaySystem.tsx');
const liveScreen = read('../../src/components/manager/LiveRestaurantScreen.tsx');
const pos = read('../components/manager/CashierPOSView.tsx');
const verificationPanel = read('../components/manager/PaymentVerificationPanel.tsx');

const slice = (text: string, from: string, to: string) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
};

/** Same, but anchored on the LAST occurrence of `from` (the collect-till claim). */
const lastSlice = (text: string, from: string, to: string) => {
  const start = text.lastIndexOf(from);
  const end = text.indexOf(to, start + from.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
};

const confirmBlock = slice(managerRoute, "'/orders/:orderId/payment/confirm'", "'/orders/:orderId/payment/reject'");
const rejectBlock = slice(managerRoute, "'/orders/:orderId/payment/reject'", '\nexport default router;');
const cancelBlock = slice(publicRoute, "'/orders/:orderId/cancel'", "'/orders/:orderId/notes'");
const createBlock = slice(publicRoute, "'/orders',", '// POST /api/public/orders/:orderId/cancel');

describe('the gate state machine (server policy)', () => {
  it('names the four required states', () => {
    expect(FULFILLMENT_STATE).toEqual({
      AWAITING_PAYMENT: 'AWAITING_PAYMENT',
      PAYMENT_VERIFICATION_PENDING: 'PAYMENT_VERIFICATION_PENDING',
      PAYMENT_REJECTED: 'PAYMENT_REJECTED',
      RELEASED: 'RELEASED',
    });
    for (const state of Object.values(FULFILLMENT_STATE)) {
      expect(isFulfillmentState(state)).toBe(true);
    }
    expect(isFulfillmentState('PAYMENT_PENDING')).toBe(false);
    expect(isFulfillmentState(null)).toBe(false);
  });

  it('treats an unknown/legacy value as RELEASED (never strands an order)', () => {
    for (const legacy of [null, undefined, '', 'BOGUS', 42]) {
      expect(normalizeFulfillmentState(legacy)).toBe(FULFILLMENT_STATE.RELEASED);
    }
    expect(normalizeFulfillmentState('PAYMENT_REJECTED')).toBe(FULFILLMENT_STATE.PAYMENT_REJECTED);
  });

  it('authorizes ONLY a released order and holds the other three', () => {
    expect(isOperational('RELEASED')).toBe(true);
    expect(isHeldForPayment('RELEASED')).toBe(false);
    for (const held of ['AWAITING_PAYMENT', 'PAYMENT_VERIFICATION_PENDING', 'PAYMENT_REJECTED']) {
      expect(isOperational(held)).toBe(false);
      expect(isHeldForPayment(held)).toBe(true);
    }
  });

  it('keeps the transitions narrow: no way into RELEASED but a settled payment', () => {
    expect(canTransition('AWAITING_PAYMENT', 'PAYMENT_VERIFICATION_PENDING')).toBe(true);
    expect(canTransition('AWAITING_PAYMENT', 'RELEASED')).toBe(true);
    expect(canTransition('PAYMENT_VERIFICATION_PENDING', 'PAYMENT_REJECTED')).toBe(true);
    expect(canTransition('PAYMENT_VERIFICATION_PENDING', 'RELEASED')).toBe(true);
    expect(canTransition('PAYMENT_REJECTED', 'PAYMENT_VERIFICATION_PENDING')).toBe(true);
    expect(canTransition('PAYMENT_REJECTED', 'RELEASED')).toBe(true);
    // Nothing to reject before anything was submitted.
    expect(canTransition('AWAITING_PAYMENT', 'PAYMENT_REJECTED')).toBe(false);
    // RELEASED is terminal: a live ticket is never pulled back out.
    expect(allowedTransitions('RELEASED')).toEqual([]);
    expect(canTransition('RELEASED', 'PAYMENT_VERIFICATION_PENDING')).toBe(false);
    expect(canTransition('RELEASED', 'AWAITING_PAYMENT')).toBe(false);
    // Idempotent repeats are legal (a replayed request must not 409 on policy).
    for (const state of Object.values(FULFILLMENT_STATE)) {
      expect(canTransition(state, state)).toBe(true);
    }
  });

  it('opens the gate with one helper, in the caller’s own transaction timestamp', () => {
    const now = new Date('2026-09-14T18:00:00.000Z');
    expect(releaseFields(now)).toEqual({
      fulfillmentState: FULFILLMENT_STATE.RELEASED,
      releasedAt: now,
    });
    expect(RELEASE_REASON).toEqual({
      TRANSFER_VERIFIED: 'TRANSFER_VERIFIED',
      CASH_COLLECTED: 'CASH_COLLECTED',
      STAFF_ORDER: 'STAFF_ORDER',
    });
  });
});

describe('the client mirror renders the server’s decision', () => {
  it('prefers the server-derived flag, then the stored state, then legacy rules', () => {
    expect(isOrderOperational({ operational: false, fulfillmentState: 'RELEASED' })).toBe(false);
    expect(isOrderOperational({ operational: true, fulfillmentState: 'PAYMENT_REJECTED' })).toBe(true);
    expect(isOrderOperational({ fulfillmentState: 'RELEASED' })).toBe(true);
    expect(isOrderOperational({ fulfillmentState: 'PAYMENT_VERIFICATION_PENDING' })).toBe(false);
    // Legacy payload: keep the rule the screens enforced before the gate.
    expect(isOrderOperational({ paymentStatus: 'PENDING_VERIFICATION' })).toBe(false);
    expect(isOrderOperational({ paymentStatus: 'UNPAID' })).toBe(true);
    expect(isOrderOperational({})).toBe(true);
    expect(isOrderOperational(null)).toBe(false);
    expect(isOrderHeldForPayment({ fulfillmentState: 'AWAITING_PAYMENT' })).toBe(true);
  });

  it('classifies the guest-visible payment states with the same precedence', () => {
    expect(isAwaitingGuestPayment({ fulfillmentState: 'AWAITING_PAYMENT' })).toBe(true);
    expect(isAwaitingGuestPayment({ fulfillmentState: 'PAYMENT_VERIFICATION_PENDING' })).toBe(false);
    expect(isAwaitingGuestPayment({ paymentStatus: 'UNPAID' })).toBe(true);
    expect(isAwaitingGuestPayment({ paymentStatus: 'UNPAID', paymentRejected: true })).toBe(false);

    expect(isPaymentVerificationPending({ fulfillmentState: 'PAYMENT_VERIFICATION_PENDING' })).toBe(true);
    expect(isPaymentVerificationPending({ paymentStatus: 'PENDING_VERIFICATION' })).toBe(true);
    expect(isPaymentVerificationPending({ paymentStatus: 'PAID' })).toBe(false);

    expect(isPaymentRejected({ fulfillmentState: 'PAYMENT_REJECTED' })).toBe(true);
    expect(isPaymentRejected({ paymentRejected: true })).toBe(true);
    expect(isPaymentRejected({ fulfillmentState: 'AWAITING_PAYMENT' })).toBe(false);
  });

  it('filters operational/held sets without ever resurrecting a cancelled order', () => {
    const orders = [
      { id: 'a', status: 'PENDING', fulfillmentState: 'AWAITING_PAYMENT' as const },
      { id: 'b', status: 'PENDING', fulfillmentState: 'RELEASED' as const },
      { id: 'c', status: 'CANCELLED', fulfillmentState: 'AWAITING_PAYMENT' as const },
      { id: 'd', status: 'PREPARING', paymentStatus: 'PAID' },
    ];
    expect(operationalOrders(orders).map((o) => o.id)).toEqual(['b', 'd']);
    expect(heldOrders(orders).map((o) => o.id)).toEqual(['a']);
  });
});

describe('schema + migration', () => {
  it('adds the gate columns and their index to Order', () => {
    expect(schema).toMatch(/fulfillmentState\s+String\s+@default\("RELEASED"\)/);
    expect(schema).toMatch(/releasedAt\s+DateTime\?/);
    expect(schema).toContain('@@index([restaurantId, fulfillmentState])');
    // The money axis keeps its own index (both are queried by the cashier flow).
    expect(schema).toContain('@@index([restaurantId, paymentStatus])');
  });

  it('ships as an additive, reversible, data-preserving migration', () => {
    expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "fulfillmentState" TEXT NOT NULL DEFAULT 'RELEASED'`);
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3)');
    expect(migration).toContain('SET "releasedAt" = COALESCE("settledAt", "createdAt")');
    expect(migration).toContain(`WHERE "releasedAt" IS NULL`);
    expect(migration).toContain(`AND "fulfillmentState" = 'RELEASED'`);
    expect(migration).toContain(`CREATE INDEX IF NOT EXISTS "Order_restaurantId_fulfillmentState_idx"`);
    // Additive only: no dropped column/table, no type rewrite, no enum DDL.
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(migration).not.toMatch(/ALTER\s+COLUMN[^;]*TYPE/i);
    expect(migration).not.toMatch(/CREATE\s+TYPE/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
  });

  it('is superseded only by the later additive migrations in the deploy order', () => {
    // Deploy order IS the directory-name order, so the guard that matters is
    // that nothing was inserted BEFORE the gate migration (it would then run
    // first) and that every migration after it is a known, additive one.
    const sorted = [...migrationDirs].sort();
    const gateIndex = sorted.indexOf('20260914180000_add_order_fulfillment_gate');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(sorted.slice(gateIndex + 1)).toEqual([
      // H-02 staff cancel + payment void markers.
      '20260915120000_staff_cancel_and_payment_void',
      // Customer transfer payment details (Restaurant settings — the venue's
      // receiving account). Additive nullable TEXT columns, no Order change.
      '20260917120000_add_restaurant_transfer_details',
      // 2026-09 auth redesign (username/PIN/lockout columns) and counter
      // orderSource — additive, verified against real PostgreSQL.
      '20260919120000_employee_auth_redesign',
      '20260919120100_order_source_counter',
      // Restaurant contact channels & reservations (WhatsApp number + social
      // profiles). Additive nullable TEXT columns on Restaurant, no Order
      // change, no index, no data backfill.
      '20260919180000_add_restaurant_contact_channels',
    ]);
    expect(sorted[sorted.length - 1]).toBe('20260919180000_add_restaurant_contact_channels');
  });
});

describe('guest submission: an order, NOT a kitchen ticket', () => {
  it('creates the order outside the operational workflow at BOTH allocation sites', () => {
    // Two order-create sites (the retry loop + the fallback), each writing the
    // gate and the release marker inside the create transaction itself.
    expect(
      (createBlock.match(/fulfillmentState: FULFILLMENT_STATE\.AWAITING_PAYMENT/g) || []).length
    ).toBeGreaterThanOrEqual(2);
    expect((createBlock.match(/releasedAt: null,\n\s*subtotal,/g) || []).length).toBe(2);
    expect(createBlock).toContain("status: 'PENDING'");
  });

  it('publishes ORDER_AWAITING_PAYMENT and never ORDER_CREATED on submission', () => {
    expect(createBlock).toContain("realtimeService.broadcastToTable(restaurantId, tableId, 'ORDER_AWAITING_PAYMENT', {");
    expect(createBlock).not.toContain("'ORDER_CREATED'");
    expect(publicRoute).not.toContain("'ORDER_CREATED'");
  });

  it('records the submission in the audit trail under the required event name', () => {
    expect(publicRoute).toContain("action: 'CUSTOMER_ORDER_CREATED'");
    expect(publicRoute).toContain("paymentEvent: 'PAYMENT_SUBMITTED'");
    expect(publicRoute).toContain('previousFulfillmentState: previousGate');
  });

  it('moves the gate to verification only while it is still held', () => {
    expect(publicRoute).toContain('const gateUpdate = isHeldForPayment(order.fulfillmentState)');
    expect(publicRoute).toContain('{ fulfillmentState: FULFILLMENT_STATE.PAYMENT_VERIFICATION_PENDING }');
    // A receipt arriving mid-cooking must never re-hold a RELEASED order.
    expect(publicRoute).toContain('paymentStatus: PAYMENT_STATUS.PENDING_VERIFICATION,');
    expect(publicRoute).toContain('paymentRejectedAt: null,');
  });

  it('tells the guest device the gate state without leaking private fields', () => {
    expect(publicRoute).toContain('fulfillmentState: normalizeFulfillmentState(o.fulfillmentState),');
    expect(publicRoute).toContain('releasedAt: o.releasedAt?.toISOString(),');
    expect(publicRoute).toContain('hasPaymentProof: Boolean(o.paymentProofPath)');
    expect(publicRoute).not.toContain('paymentProofPath: o.paymentProofPath');
    expect(publicRoute).not.toContain('customerPhone: o.customerPhone');
  });

  it('freezes guest cancellation once the money is committed', () => {
    expect(cancelBlock).toContain('order.paymentStatus === PAYMENT_STATUS.PAID ||');
    expect(cancelBlock).toContain('order.paymentStatus === PAYMENT_STATUS.PENDING_VERIFICATION');
    // Compare-and-set against a cashier confirming in the same instant.
    expect(cancelBlock).toContain('paymentStatus: PAYMENT_STATUS.UNPAID,');
    expect(cancelBlock).toContain('if (cancelled.count !== 1) {');
  });
});

describe('cashier confirmation is the ONLY transfer release', () => {
  it('flips money AND gate in one conditional statement (no reachable split state)', () => {
    expect(confirmBlock).toContain('paymentStatus: PAYMENT_STATUS.PENDING_VERIFICATION,');
    expect(confirmBlock).toContain('...releaseFields(now),');
    expect(confirmBlock).toContain("paymentStatus: 'PAID',");
    expect(confirmBlock).toContain('settledAt: now,');
    expect(confirmBlock).toContain('cashierId: req.user!.id,');
    // Exactly one conditional claim decides the race.
    expect(confirmBlock).toContain("if (claimed.count !== 1) {");
    expect(confirmBlock).toContain("throw Object.assign(new Error('VERIFY_RACE'), { code: 'VERIFY_RACE' });");
  });

  it('never rewrites the kitchen status (a released ticket stays fresh)', () => {
    const claim = slice(
      confirmBlock,
      'const claimed = await tx.order.updateMany({',
      'if (claimed.count !== 1) {'
    );
    // The claim flips the money + the gate and NOTHING else.
    expect(claim).toContain("paymentStatus: 'PAID',");
    expect(claim).toContain('...releaseFields(now),');
    expect(claim).not.toContain('status: releasedStatus');
    expect(claim).not.toMatch(/status: '(PREPARING|READY|SERVED)'/);
    // The broadcast reports the (unchanged) kitchen status so the staff screens
    // treat a freshly released PENDING ticket like a brand-new one.
    expect(confirmBlock).toContain("const kitchenReleased = releasedStatus === 'PENDING';");
    expect(confirmBlock).toContain('status: releasedStatus,');
  });

  it('answers a lost double-confirm race idempotently (no second receipt)', () => {
    expect(confirmBlock).toContain("code === 'VERIFY_RACE'");
    expect(confirmBlock).toContain('if (current?.paymentStatus === PAYMENT_STATUS.PAID) {');
    expect(confirmBlock).toContain('alreadyConfirmed: true,');
    expect(confirmBlock).toContain('kitchenReleased: current.status === \'PENDING\',');
    // …and a genuine conflict is still a 409.
    expect(confirmBlock).toContain("error: 'تمت معالجة هذا الإشعار للتو من جهاز آخر. حدّث القائمة وحاول مجدداً.'");
    // Only the receipt allocation retry loop can produce a second attempt.
    expect(confirmBlock).toContain("if (code !== 'P2002') throw txErr;");
  });

  it('audits and broadcasts the release under the required names', () => {
    expect(confirmBlock).toContain("action: 'PAYMENT_VERIFIED'");
    expect(confirmBlock).toContain("paymentEvent: 'PAYMENT_CONFIRMED'");
    expect(confirmBlock).toContain("action: 'ORDER_RELEASED_TO_KDS'");
    expect(confirmBlock).toContain('releaseReason: RELEASE_REASON.TRANSFER_VERIFIED,');
    expect(confirmBlock).toContain('previousFulfillmentState,');
    expect(confirmBlock).toContain("realtimeService.broadcastToTable(restaurantId, order.tableId, 'ORDER_RELEASED_TO_KITCHEN', {");
    expect(confirmBlock).toContain('fulfillmentState: FULFILLMENT_STATE.RELEASED,');
    expect(confirmBlock).toContain('requireCashierOrManager()');
  });

  it('broadcasts the operational event from every release path', () => {
    expect((managerRoute.match(/'ORDER_RELEASED_TO_KITCHEN'/g) || []).length).toBe(3);
    expect((managerRoute.match(/action: 'ORDER_RELEASED_TO_KDS'/g) || []).length).toBe(3);
  });
});

describe('cashier rejection keeps the order out of the kitchen', () => {
  it('returns the money state to UNPAID and holds the gate, with a reason', () => {
    expect(rejectBlock).toContain('fulfillmentState: FULFILLMENT_STATE.PAYMENT_REJECTED,');
    expect(rejectBlock).toContain('paymentStatus: PAYMENT_STATUS.UNPAID,');
    expect(rejectBlock).toContain('paymentRejectedAt: now,');
    expect(rejectBlock).toContain('paymentRejectionReason: reason ||');
    expect(rejectBlock).toContain('if (claimed.count !== 1) {');
  });

  it('audits the rejection and tells the guest + staff screens', () => {
    expect(rejectBlock).toContain("action: 'PAYMENT_REJECTED'");
    expect(rejectBlock).toContain("paymentEvent: 'PAYMENT_REJECTED'");
    expect(rejectBlock).toContain("realtimeService.broadcastToTable(restaurantId, order.tableId, 'PAYMENT_PROOF_REJECTED', {");
    expect(rejectBlock).toContain('fulfillmentState: FULFILLMENT_STATE.PAYMENT_REJECTED,');
  });
});

describe('collecting cash at the till is the second release path', () => {
  it('splits the bill into already-operational and gate-held rows', () => {
    expect(managerRoute).toContain('const releasedByCollection = unpaidOrders.filter((o) => !isOperational(o.fulfillmentState));');
    expect(managerRoute).toContain('const closingOperational = unpaidOrders.filter((o) => isOperational(o.fulfillmentState));');
    expect(managerRoute).toContain('const releasedByCollection = ordersToPay.filter((o) => !isOperational(o.fulfillmentState));');
    expect(managerRoute).toContain('const closingOperational = ordersToPay.filter((o) => isOperational(o.fulfillmentState));');
  });

  it('claims both halves conditionally and reports the lost race', () => {
    expect(managerRoute).toContain('let claimedCount = 0;');
    expect(managerRoute).toContain('claimedCount += claimed.count;');
    expect(managerRoute).toContain('if (claimedCount !== unpaidOrders.length) {');
    expect(managerRoute).toContain("throw Object.assign(new Error('SETTLE_RACE'), { code: 'SETTLE_RACE' });");
    expect(managerRoute).toContain('if (claimedCount !== ordersToPay.length) {');
    expect(managerRoute).toContain("throw Object.assign(new Error('PAYMENT_RACE'), { code: 'PAYMENT_RACE' });");
  });

  it('releases the held rows (fresh PENDING tickets) with the collection reason', () => {
    const collectionClaim = lastSlice(
      managerRoute,
      'if (releasedByCollection.length > 0) {\n              const claimed = await tx.order.updateMany({',
      'if (claimedCount !== ordersToPay.length) {'
    );
    expect(collectionClaim).toContain('...releaseFields(now),');
    expect(collectionClaim).toContain("paymentStatus: 'PAID',");
    // The kitchen status is NOT rewritten: the ticket arrives as new.
    expect(collectionClaim).not.toContain("status: 'SERVED'");
    expect(collectionClaim).not.toContain("status: 'PREPARING'");
    expect(managerRoute).toContain('releaseReason: RELEASE_REASON.CASH_COLLECTED,');
  });

  it('lets staff orders through the gate at creation time (money at the counter)', () => {
    expect(managerRoute).toContain('...releaseFields(new Date()),');
    expect(managerRoute).toContain('releaseReason: RELEASE_REASON.STAFF_ORDER,');
  });

  it('refuses to collect while a receipt is still awaiting verification', () => {
    expect(managerRoute).toContain('هناك إشعار حوالة بانتظار التحقق على هذه الطاولة');
    expect(managerRoute).toContain("paymentStatus: 'UNPAID',");
  });
});

describe('operational screens render nothing but released orders', () => {
  it('the KDS filters through the shared predicate and counts the held ones', () => {
    expect(kds).toContain('isOrderOperational(o)');
    expect(kds).toContain("o.status !== 'CANCELLED' && !isOrderOperational(o)");
    expect(kds).toContain('heldForPayment.length > 0');
    expect(kds).toContain('بانتظار تأكيد الكاشير');
    expect(kds).not.toMatch(/paymentStatus === 'PAYMENT_VERIFICATION_PENDING'/);
  });

  it('the live floor screen uses the same predicate', () => {
    expect(liveScreen).toContain('isOrderOperational(o)');
  });

  it('the POS excludes held bills from cash collection and explains the hold', () => {
    expect(pos).toContain('isCollectable');
    expect(pos).toContain("o.paymentStatus !== 'PENDING_VERIFICATION'");
    expect(pos).toContain('isAwaitingGuestPayment(o)');
  });

  it('the cashier queue separates “waiting for the cashier” from “waiting for the guest”', () => {
    expect(verificationPanel).toContain('isOrderHeldForPayment(o)');
    expect(verificationPanel).toContain("item.state !== 'WAITING_RECEIPT'");
    expect(verificationPanel).toContain("item.state === 'WAITING_RECEIPT'");
    expect(verificationPanel).toContain('includeAwaiting: true');
    expect(verificationPanel).toContain('طلبات بانتظار دفع الزبون');
  });

  it('serves the held orders from the API, scoped to the caller’s tenant', () => {
    expect(managerRoute).toContain('operational: isOperational(o.fulfillmentState),');
    expect(managerRoute).toContain('fulfillmentState: operationalFilter.operationalOnly');
    expect(managerRoute).toContain('state: isAwaitingVerification(o.paymentStatus)');
    expect(managerRoute).toContain("req.query.include === 'awaiting' || req.query.include === 'all'");
    expect(api).toContain("query.set('operational', opts.operational ? 'true' : 'false')");
    expect(types).toContain('export type FulfillmentState =');
    expect(types).toContain('fulfillmentState?: FulfillmentState');
    expect(types).toContain('operational?: boolean');
  });

  it('the service API refuses to advance a held order (server-enforced, not just UI)', () => {
    expect(managerRoute).toContain("if (status !== 'CANCELLED' && !isOperational(order.fulfillmentState)) {");
    expect(managerRoute).toContain('لا يمكن بدء تحضيره قبل تأكيد الدفع');
  });
});

describe('the customer journey carries the required copy', () => {
  it('opens the payment step the moment the order is submitted', () => {
    expect(context).toContain('setPaymentStepOrder(res.data.order)');
    expect(context).toContain('تم إرسال طلبك، يرجى تأكيد عملية الدفع لإتمام الطلب.');
    expect(context).toContain('orderAwaitingPayment');
    expect(context).toContain('dismissPaymentStep');
    expect(customerLayout).toContain('orderAwaitingPayment');
    expect(customerLayout).toContain('<TransferPaymentModal');
  });

  it('states the three payment states on the tracker', () => {
    expect(tracker).toContain('تم إرسال طلبك، يرجى تأكيد عملية الدفع لإتمام الطلب.');
    expect(transferModal).toContain('تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع.');
    expect(tracker).toContain('تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع.');
    expect(context).toContain('تم تأكيد الدفع، وجارٍ تجهيز طلبك.');
    expect(tracker).toContain('تم تأكيد الدفع، وجارٍ تجهيز طلبك.');
    expect(tracker).toContain('لم يتم التحقق من إشعار الحوالة');
    expect(transferModal).toContain('لا يبدأ المطبخ بتحضير الطلب قبل تأكيد الدفع');
  });

  it('notifies the guest and the cashier on the release event (kitchen chime only then)', () => {
    expect(context).toContain('ORDER_AWAITING_PAYMENT');
    expect(context).toContain('ORDER_RELEASED_TO_KITCHEN');
    expect(context).toContain("'طلب جديد بانتظار دفع الزبون'");
    expect(context).toContain("'تم تأكيد الدفع، وجارٍ تجهيز طلبك.'");
  });
});

describe('end-to-end scenario walkthrough (executable manual checks)', () => {
  // The manual QA scenarios, encoded as assertions: the row is what the
  // database holds at each step, and every screen derives from it.
  type Row = {
    status: string;
    paymentStatus: string;
    fulfillmentState: string;
    paymentRejected?: boolean;
  };
  const kdsVisible = (row: Row) =>
    isOrderOperational(row) && ['PENDING', 'PREPARING', 'READY'].includes(row.status);
  // Mirror of GET /manager/payment-verifications: only a queued receipt is
  // actionable; the other rows are the (informational) waiting-for-payment list.
  const cashierQueueState = (row: Row) =>
    row.paymentStatus === 'PENDING_VERIFICATION' ? 'WAITING_VERIFICATION' : 'WAITING_RECEIPT';

  it('scenario 1 — submit: held everywhere, absent from the KDS', () => {
    const held: Row = { status: 'PENDING', paymentStatus: 'UNPAID', fulfillmentState: 'AWAITING_PAYMENT' };
    expect(kdsVisible(held)).toBe(false);
    expect(isAwaitingGuestPayment(held)).toBe(true);
    expect(cashierQueueState(held)).toBe('WAITING_RECEIPT');
    expect(isOrderHeldForPayment(held)).toBe(true);
  });

  it('scenario 2 — receipt announced: the cashier can act, the kitchen still cannot', () => {
    const queued: Row = {
      status: 'PENDING',
      paymentStatus: 'PENDING_VERIFICATION',
      fulfillmentState: 'PAYMENT_VERIFICATION_PENDING',
    };
    expect(kdsVisible(queued)).toBe(false);
    expect(isPaymentVerificationPending(queued)).toBe(true);
    expect(cashierQueueState(queued)).toBe('WAITING_VERIFICATION');
  });

  it('scenario 3 — cashier confirms: a fresh ticket appears on the KDS', () => {
    const released: Row = { status: 'PENDING', paymentStatus: 'PAID', fulfillmentState: 'RELEASED' };
    expect(kdsVisible(released)).toBe(true);
    expect(isOrderOperational(released)).toBe(true);
    expect(cashierQueueState(released)).toBe('WAITING_RECEIPT');
    expect(isPaymentVerificationPending(released)).toBe(false);
  });

  it('scenario 4 — cashier rejects: the order stays out and the guest is told', () => {
    const rejected: Row = {
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      fulfillmentState: 'PAYMENT_REJECTED',
      paymentRejected: true,
    };
    expect(kdsVisible(rejected)).toBe(false);
    expect(isPaymentRejected(rejected)).toBe(true);
    expect(isAwaitingGuestPayment(rejected)).toBe(false); // a banner, not a payment prompt
    expect(cashierQueueState(rejected)).toBe('WAITING_RECEIPT'); // nothing to confirm
  });

  it('scenario 5 — double confirm is idempotent and never re-holds a live ticket', () => {
    const released: Row = { status: 'PENDING', paymentStatus: 'PAID', fulfillmentState: 'RELEASED' };
    // A replayed confirmation is a policy no-op; the server answers 200
    // `alreadyConfirmed` with the same receipt (pinned above).
    expect(canTransition(released.fulfillmentState, 'RELEASED')).toBe(true);
    expect(releaseFields(new Date()).fulfillmentState).toBe(released.fulfillmentState);
    // A late receipt upload must not pull the ticket back out of the kitchen.
    expect(isOperational(released.fulfillmentState)).toBe(true);
  });

  it('scenario 6 — a guest receipt during cooking never hides a started ticket', () => {
    const cooking: Row = {
      status: 'PREPARING',
      paymentStatus: 'PENDING_VERIFICATION',
      fulfillmentState: 'RELEASED',
    };
    expect(kdsVisible(cooking)).toBe(true);
  });

  it('scenario 7 — cash collected at the till releases a held order as a new ticket', () => {
    const collected: Row = { status: 'PENDING', paymentStatus: 'PAID', fulfillmentState: 'RELEASED' };
    expect(kdsVisible(collected)).toBe(true);
    expect(canTransition('PAYMENT_REJECTED', 'RELEASED')).toBe(true);
    expect(canTransition('AWAITING_PAYMENT', 'RELEASED')).toBe(true);
  });

  it('scenario 8 — a cancelled order is never resurrected by the gate helpers', () => {
    const cancelled: Row = { status: 'CANCELLED', paymentStatus: 'UNPAID', fulfillmentState: 'AWAITING_PAYMENT' };
    expect(kdsVisible(cancelled)).toBe(false);
    expect(heldOrders([cancelled])).toEqual([]);
    expect(isOrderOperational({ ...cancelled, fulfillmentState: 'RELEASED' })).toBe(true); // gate ≠ lifecycle
  });
});

describe('security: the gate is derived, never supplied', () => {
  it('never accepts a gate/payment status from a request body', () => {
    // No request schema declares the gate: a crafted body cannot open it.
    expect(validationSchemas).not.toMatch(/\b(fulfillmentState|releasedAt|operational)\s*:/);
    expect(validationSchemas).not.toContain("paymentStatus: z.enum(['PAID'");
  });

  it('resolves the tenant from the authenticated session for every gate decision', () => {
    expect(confirmBlock).toContain('resolveTenantOrder(req, String(req.params.orderId))');
    expect(rejectBlock).toContain('resolveTenantOrder(req, String(req.params.orderId))');
    expect(confirmBlock).not.toContain('fulfillmentState: req.body');
    expect(rejectBlock).not.toContain('fulfillmentState: req.body');
    expect(managerRoute).toContain('if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);');
  });

  it('keeps the receipt private (no key ever reaches a client payload)', () => {
    expect(managerRoute).toContain('hasPaymentProof: Boolean(o.paymentProofPath)');
    // The ONLY place the storage key is written is the private DB update; no
    // response payload in either router maps it out to a client.
    expect((publicRoute.match(/paymentProofPath:/g) || []).length).toBe(1);
    expect(publicRoute).toContain('paymentProofPath: stored.key');
    expect(managerRoute).not.toMatch(/paymentProofPath:\s*o\.paymentProofPath/);
    expect(api).not.toContain('paymentProofPath');
  });
});
