/**
 * Order fulfillment gate — the payment authorization boundary.
 *
 * ============================================================================
 * THE BUSINESS RULE
 * ============================================================================
 * "A customer order must NOT enter the restaurant's live operational workflow
 *  (KDS / floor screens / service API) until a cashier has verified and
 *  confirmed the payment."
 *
 * That rule is encoded here, in ONE place, as an explicit state machine over
 * `Order.fulfillmentState`. Every server transition goes through this module;
 * the operational screens key on the derived `operational` flag the API emits
 * from the same function, so the client can never invent a released order.
 *
 * ============================================================================
 * THE LIFECYCLE (semantics of the required state machine, adapted names)
 * ============================================================================
 *   customer submits order        → AWAITING_PAYMENT              (not operational)
 *   customer sends phone + receipt→ PAYMENT_VERIFICATION_PENDING   (not operational)
 *   cashier confirms the payment  → RELEASED                       (operational)
 *   cashier rejects the receipt   → PAYMENT_REJECTED               (not operational)
 *   guest re-sends a receipt      → PAYMENT_VERIFICATION_PENDING   (not operational)
 *   cashier collects cash in POS  → RELEASED                       (operational)
 *   staff order at the POS        → RELEASED immediately (money is taken in person)
 *
 * RELEASED is terminal: the gate never closes again. An order the kitchen has
 * already picked up must never be pulled back to "held" by a later event
 * (e.g. a guest uploading a receipt mid-cooking) — that is why releases are
 * one-way and why the customer flow reaches RELEASED only through a cashier.
 *
 * The axis is intentionally SEPARATE from `Order.status`
 * (PENDING → PREPARING → READY → SERVED, the kitchen's own machine) and from
 * `paymentStatus` (UNPAID | PENDING_VERIFICATION | PAID, the money):
 *   - paymentStatus answers "has the money been settled?",
 *   - fulfillmentState answers "may the restaurant start working on it?".
 * They move together for verified transfers (one transaction), but a POS
 * order is operational while its money may still be collected later, and a
 * rejected receipt is a money state (UNPAID) plus an explicit "guest must act"
 * gate.
 */

/** Fulfillment gate values (TEXT column, application-level — like paymentStatus). */
export const FULFILLMENT_STATE = {
  /** The guest submitted the order; no payment information has arrived yet. */
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  /** A receipt (bank/wallet transfer) is waiting for a cashier decision. */
  PAYMENT_VERIFICATION_PENDING: 'PAYMENT_VERIFICATION_PENDING',
  /** The cashier refused the receipt: the guest must act (new receipt or cash). */
  PAYMENT_REJECTED: 'PAYMENT_REJECTED',
  /** Payment verified/collected — the restaurant may execute the order. */
  RELEASED: 'RELEASED',
} as const;

export type FulfillmentState =
  (typeof FULFILLMENT_STATE)[keyof typeof FULFILLMENT_STATE];

/** Why the gate opened. Recorded in the audit trail and the SSE payload. */
export const RELEASE_REASON = {
  /** Cashier verified a bank/wallet transfer receipt. */
  TRANSFER_VERIFIED: 'TRANSFER_VERIFIED',
  /** Cashier collected the bill at the till (POS). */
  CASH_COLLECTED: 'CASH_COLLECTED',
  /** Order created by staff at the POS, where the money is taken in person. */
  STAFF_ORDER: 'STAFF_ORDER',
} as const;

export type ReleaseReason = (typeof RELEASE_REASON)[keyof typeof RELEASE_REASON];

/**
 * Legal transitions of the gate.
 *
 * Deliberately narrow:
 *   - nothing may enter RELEASED except through a settled payment
 *     (transfer confirmation, cash collection, or a staff-created order);
 *   - RELEASED has no outgoing edges (no rewinding to a held state);
 *   - AWAITING_PAYMENT cannot jump to PAYMENT_REJECTED (nothing to reject yet).
 */
const TRANSITIONS: Record<FulfillmentState, readonly FulfillmentState[]> = {
  [FULFILLMENT_STATE.AWAITING_PAYMENT]: [
    FULFILLMENT_STATE.PAYMENT_VERIFICATION_PENDING,
    FULFILLMENT_STATE.RELEASED,
  ],
  [FULFILLMENT_STATE.PAYMENT_VERIFICATION_PENDING]: [
    FULFILLMENT_STATE.PAYMENT_REJECTED,
    FULFILLMENT_STATE.RELEASED,
  ],
  [FULFILLMENT_STATE.PAYMENT_REJECTED]: [
    FULFILLMENT_STATE.PAYMENT_VERIFICATION_PENDING,
    FULFILLMENT_STATE.RELEASED,
  ],
  [FULFILLMENT_STATE.RELEASED]: [],
};

const ALL_STATES: readonly FulfillmentState[] = Object.values(FULFILLMENT_STATE);

export function isFulfillmentState(value: unknown): value is FulfillmentState {
  return typeof value === 'string' && (ALL_STATES as readonly string[]).includes(value);
}

/**
 * Normalizes a stored value to a gate state.
 *
 * Unknown/NULL values (a database that has not run the migration, a row written
 * by an older build) are treated as RELEASED — the pre-gate behaviour — so the
 * gate can never strand an order that the current code base does not own.
 */
export function normalizeFulfillmentState(value: unknown): FulfillmentState {
  return isFulfillmentState(value) ? value : FULFILLMENT_STATE.RELEASED;
}

/** True only for a released order: the single authorization predicate. */
export function isOperational(value: unknown): boolean {
  return normalizeFulfillmentState(value) === FULFILLMENT_STATE.RELEASED;
}

/** True while the restaurant must not execute the order. */
export function isHeldForPayment(value: unknown): boolean {
  return !isOperational(value);
}

export function canTransition(from: unknown, to: FulfillmentState): boolean {
  const current = normalizeFulfillmentState(from);
  if (current === to) return true; // idempotent no-op
  return TRANSITIONS[current].includes(to);
}

export function allowedTransitions(from: unknown): readonly FulfillmentState[] {
  return TRANSITIONS[normalizeFulfillmentState(from)];
}

/**
 * The gate columns for a release, to be written in the SAME transaction as the
 * payment claim. `now` is passed in so the caller controls the timestamp it
 * already uses for `settledAt`.
 */
export function releaseFields(now: Date): {
  fulfillmentState: FulfillmentState;
  releasedAt: Date;
} {
  return { fulfillmentState: FULFILLMENT_STATE.RELEASED, releasedAt: now };
}
