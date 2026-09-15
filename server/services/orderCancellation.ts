// ============================================================
// Staff order cancellation + payment void — pure decision logic.
//
// PURE MODULE: no env, no prisma, no IO. Every value it needs arrives as a
// plain primitive so the rules are unit-testable without a database and the
// HTTP route stays a thin adapter (parity with retentionPolicy /
// orderLifecycle / paymentProofs).
//
// The state machines involved (do NOT extend them — reuse):
//
//   Order.status (Prisma enum): PENDING → PREPARING → READY → SERVED · CANCELLED
//   Order.paymentStatus (TEXT):  UNPAID → PENDING_VERIFICATION → PAID
//                                 (rejection returns to UNPAID with a marker)
//   Order.fulfillmentState (TEXT): AWAITING_PAYMENT → PAYMENT_VERIFICATION_PENDING
//                                 → RELEASED · PAYMENT_REJECTED
//
// Cancellation rule (single invariant): an order is staff-cancellable while
// its MONEY has not been claimed — i.e. paymentStatus !== 'PAID'. A PAID
// order can never be silently cancelled: the receipt is an immutable ledger
// entry and must be voided first (POST /payments/:id/void), which reverts the
// orders to UNPAID, after which they are cancellable like any unpaid bill.
//
// This deliberately covers SERVED + UNPAID orders (a settled-then-voided bill,
// or a counter order marked SERVED by mistake): the operation must remain
// correctable, which is exactly the dead-end audit H-02 reported.
// ============================================================

/** Order statuses (Prisma OrderStatus enum) — duplicated as literals to keep this module import-free from @prisma/client. */
export const PRE_SERVICE_ORDER_STATUSES = ['PENDING', 'PREPARING', 'READY'] as const;
export type PreServiceOrderStatus = (typeof PRE_SERVICE_ORDER_STATUSES)[number];

/** Order payment statuses (TEXT column convention). */
export const CANCEL_PAYMENT_STATUS = {
  UNPAID: 'UNPAID',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  PAID: 'PAID',
} as const;

/** Roles allowed to perform a staff cancellation (financial-impacting). */
export const STAFF_CANCELLATION_ROLES: ReadonlySet<string> = new Set([
  'RESTAURANT_MANAGER',
  'CASHIER',
  'SUPER_ADMIN',
  'PLATFORM_ADMIN',
]);

/** The automatic rejection reason applied when cancellation clears a queued transfer receipt. */
export const CANCELLATION_AUTO_REJECT_REASON = 'أُلغي الطلب من إدارة المطعم';

export interface StaffCancellationInput {
  /** Current Order.status (Prisma enum value). */
  status: unknown;
  /** Current Order.paymentStatus (TEXT). */
  paymentStatus: unknown;
  /** Whether a transfer receipt object is attached (paymentProofPath). */
  hasPaymentProof?: boolean;
}

export type StaffCancellationDecision =
  | {
      ok: true;
      /**
       * The order holds a transfer receipt awaiting a cashier decision. The
       * cancellation MUST clear it (same semantics as the reject endpoint):
       * paymentStatus → UNPAID, fulfillmentState → PAYMENT_REJECTED with the
       * rejection marker set, and the receipt object discarded from storage.
       */
      clearsPendingVerification: boolean;
    }
  | {
      ok: false;
      /** HTTP status the route answers with. */
      statusCode: 409;
      /** Guest/staff-safe Arabic message. */
      error: string;
      /** Stable machine reason for tests/telemetry. */
      reason:
        | 'already_paid'
        | 'already_cancelled'
        | 'unknown_status';
    };

/**
 * Decide whether a staff member may cancel this order.
 *
 * Idempotent repeats (target CANCELLED, already CANCELLED) are NOT handled
 * here — the route answers them with the order as-is, exactly like the other
 * idempotent status transitions. This predicate decides only real transitions.
 */
export function evaluateStaffCancellation(input: StaffCancellationInput): StaffCancellationDecision {
  const status = typeof input.status === 'string' ? input.status : '';
  const paymentStatus = typeof input.paymentStatus === 'string' ? input.paymentStatus : CANCEL_PAYMENT_STATUS.UNPAID;

  if (status === 'CANCELLED') {
    return { ok: false, statusCode: 409, error: 'هذا الطلب ملغى بالفعل.', reason: 'already_cancelled' };
  }

  // THE money guard: a paid order is a ledger fact. It must not leave
  // operations by being marked CANCELLED — the receipt must be voided first
  // (which reverts paymentStatus to UNPAID), then cancellation is allowed.
  if (paymentStatus === CANCEL_PAYMENT_STATUS.PAID) {
    return {
      ok: false,
      statusCode: 409,
      error: 'لا يمكن إلغاء طلب مدفوع — ألغِ الإيصال (Void) أولاً من سجل الدفعات ثم أعد المحاولة.',
      reason: 'already_paid',
    };
  }

  const knownStatuses: ReadonlySet<string> = new Set([...PRE_SERVICE_ORDER_STATUSES, 'SERVED']);
  if (!knownStatuses.has(status)) {
    return { ok: false, statusCode: 409, error: 'حالة الطلب غير معروفة — لا يمكن إلغاؤه.', reason: 'unknown_status' };
  }

  return {
    ok: true,
    clearsPendingVerification: paymentStatus === CANCEL_PAYMENT_STATUS.PENDING_VERIFICATION,
  };
}

/** UI/route gate: may THIS role attempt a staff cancellation at all? */
export function canPerformStaffCancellation(role: unknown): boolean {
  return typeof role === 'string' && STAFF_CANCELLATION_ROLES.has(role);
}

// ---------------------------------------------------------------------------
// Payment void (reversal of a ledger receipt)
// ---------------------------------------------------------------------------

export type PaymentVoidDecision =
  | { ok: true }
  | { ok: false; statusCode: 409; error: string; reason: 'already_voided' };

/**
 * A payment may be voided only when it is not voided already. Replaying the
 * void request for an already-voided receipt is answered idempotently by the
 * route (200 + current state), never by a second mutation.
 */
export function evaluatePaymentVoid(alreadyVoided: boolean): PaymentVoidDecision {
  if (alreadyVoided) {
    return {
      ok: false,
      statusCode: 409,
      error: 'هذا الإيصال ملغى (void) بالفعل.',
      reason: 'already_voided',
    };
  }
  return { ok: true };
}
