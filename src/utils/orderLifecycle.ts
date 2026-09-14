import type { FulfillmentState } from '../types/restaurant';

/**
 * Client mirror of the server's payment authorization boundary
 * (`server/services/orderLifecycle.ts`).
 *
 * The rule: ONLY an order whose payment a cashier verified (or that was created
 * by staff at the till) may appear on an operational screen or be advanced by
 * the service API. Everything else is "held".
 *
 * The predicate is intentionally simple and the server keeps enforcing the same
 * rule, so this module is a rendering decision — never a security boundary.
 * A payload WITHOUT the field is a legacy payload (server older than this
 * build): it is treated as RELEASED so a rolling deploy never blanks the KDS.
 */

/** Structural minimum this helper needs (works with any order-like payload). */
export interface GateAwareOrder {
  fulfillmentState?: FulfillmentState | null;
  operational?: boolean;
  paymentStatus?: string | null;
  paymentRejected?: boolean | null;
}

const HELD_STATES: readonly FulfillmentState[] = [
  'AWAITING_PAYMENT',
  'PAYMENT_VERIFICATION_PENDING',
  'PAYMENT_REJECTED',
];

/** Server-derived flag first; fall back to the stored state; legacy → released. */
export function isOrderOperational(order: GateAwareOrder | null | undefined): boolean {
  if (!order) return false;
  // The server always derives `operational`; prefer it when present.
  if (typeof order.operational === 'boolean') return order.operational;
  if (order.fulfillmentState) return order.fulfillmentState === 'RELEASED';
  // Legacy payload (a server older than this build): keep the rule the client
  // already enforced — a receipt still awaiting verification is not a ticket.
  return order.paymentStatus !== 'PENDING_VERIFICATION';
}

export function isOrderHeldForPayment(order: GateAwareOrder | null | undefined): boolean {
  return !isOrderOperational(order);
}

/** The guest placed the order but has not completed the payment step. */
export function isAwaitingGuestPayment(order: GateAwareOrder | null | undefined): boolean {
  if (!order) return false;
  if (order.fulfillmentState) return order.fulfillmentState === 'AWAITING_PAYMENT';
  return order.paymentStatus === 'UNPAID' && !order.paymentRejected;
}

/** A receipt is queued for the cashier (money not settled yet). */
export function isPaymentVerificationPending(order: GateAwareOrder | null | undefined): boolean {
  if (!order) return false;
  if (order.fulfillmentState) {
    return order.fulfillmentState === 'PAYMENT_VERIFICATION_PENDING';
  }
  return order.paymentStatus === 'PENDING_VERIFICATION';
}

/** The cashier refused the receipt: the guest must act. */
export function isPaymentRejected(order: GateAwareOrder | null | undefined): boolean {
  if (!order) return false;
  if (order.fulfillmentState) return order.fulfillmentState === 'PAYMENT_REJECTED';
  return Boolean(order.paymentRejected);
}

/** Orders the operational screens (KDS / live floor) must render. */
export function operationalOrders<T extends GateAwareOrder>(orders: T[]): T[] {
  return orders.filter((order) => isOrderOperational(order));
}

/** Orders the kitchen is not allowed to see yet (held by the payment gate). */
export function heldOrders<T extends GateAwareOrder>(orders: T[]): T[] {
  return orders.filter(
    (order) => isOrderHeldForPayment(order) && (order as { status?: string }).status !== 'CANCELLED'
  );
}

export const FULFILLMENT_STATES: readonly FulfillmentState[] = [
  ...HELD_STATES,
  'RELEASED',
];
