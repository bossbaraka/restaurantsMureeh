import { getPrivateStorage, paymentProofKeyBelongsToRestaurant } from './storage';
import { sniffImage, isWithinUploadSizeLimit, MAX_IMAGE_BYTES } from './storage/imageSniff';

// ============================================================
// Transfer payment proof — storage + state helpers.
//
// Design notes (see docs/PAYMENT-PROOF-ARCHITECTURE-ANALYSIS.md):
//  - The receipt image is PRIVATE data. It lives in the private storage
//    namespace (private bucket / non-served directory) and is only ever read
//    through an authenticated, tenant-checked API route. A private object has
//    no public URL at all, so knowing an order id or a key grants nothing.
//  - Upload validation reuses the existing, proven pipeline: multer size cap +
//    magic-byte sniffing (client MIME type and filename are never trusted) +
//    server-derived extension + server-generated, tenant-scoped key.
//  - The payment status values below extend the EXISTING Order.paymentStatus
//    string column (UNPAID | PAID). No new enum, no parallel state field, and
//    the collect paths in the POS keep working unchanged.
// ============================================================

/** Order.paymentStatus values used by this feature (plus the existing ones). */
export const PAYMENT_STATUS = {
  /** Collectable at the cashier (existing default). */
  UNPAID: 'UNPAID',
  /** The guest uploaded a receipt; a cashier must confirm or reject it. */
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  /** Settled. `settledAt` / `cashierId` record when and by whom. */
  PAID: 'PAID',
} as const;

/**
 * Ledger method recorded for a transfer that a cashier verified. It is NOT
 * added to the POS input enum: a manual transfer entry stays a deliberate,
 * separate product decision, and this value is only ever produced server-side.
 */
export const TRANSFER_PAYMENT_METHOD = 'TRANSFER' as const;

/** Reuse the platform-wide image cap (5 MB) — no second limit to maintain. */
export const MAX_PAYMENT_PROOF_BYTES = MAX_IMAGE_BYTES;

export type ProofRejectionReason = 'too_large' | 'not_an_image' | 'storage_unavailable';

export type StoreProofResult =
  | { ok: true; key: string; size: number }
  | { ok: false; reason: ProofRejectionReason };

/**
 * Validate + persist one receipt image in the private namespace.
 *
 * The DB is NOT touched here: callers persist the returned key only after the
 * upload succeeded, and delete the object again if the DB write then fails.
 * That ordering can leave an unreferenced object on a crash (bounded, no data
 * loss, never a dangling DB pointer), which is the safe direction to fail.
 */
export async function storePaymentProof(params: {
  restaurantId: string;
  orderId: string;
  buffer: Buffer;
  size: number;
}): Promise<StoreProofResult> {
  // Defense in depth alongside the multer limit.
  if (!isWithinUploadSizeLimit(params.size)) {
    return { ok: false, reason: 'too_large' };
  }
  // Magic bytes only: the client MIME type and the filename are attacker input.
  const sniffed = sniffImage(params.buffer);
  if (!sniffed) {
    return { ok: false, reason: 'not_an_image' };
  }

  try {
    const stored = await getPrivateStorage().uploadPrivate({
      restaurantId: params.restaurantId,
      orderId: params.orderId,
      buffer: params.buffer,
      mimeType: sniffed.mimeType,
      ext: sniffed.ext,
      size: params.size,
    });
    return { ok: true, key: stored.key, size: stored.size };
  } catch (err) {
    console.error('[payment-proof] private storage upload failed:', err);
    return { ok: false, reason: 'storage_unavailable' };
  }
}

/**
 * Best-effort removal of a private object. Used to clean up (a) the previous
 * receipt when a guest re-uploads and (b) the freshly uploaded object when the
 * following DB write failed. Failures are logged, never thrown: a storage
 * hiccup must not roll back a committed business change.
 */
export async function discardPaymentProof(key: string | null | undefined): Promise<boolean> {
  if (!key) return true;
  try {
    await getPrivateStorage().deletePrivate(key);
    return true;
  } catch (err) {
    console.error(`[payment-proof] private delete failed for "${key}":`, err);
    return false;
  }
}

/** Read one receipt image for an already-authorized caller (null when gone). */
export async function loadPaymentProof(
  key: string
): Promise<{ body: Buffer; mimeType: string } | null> {
  const stored = await getPrivateStorage().readPrivate(key);
  if (!stored) return null;
  // Re-sniff on read: the response Content-Type is always derived from the
  // actual bytes we are about to serve, never from stored/echoed metadata.
  const sniffed = sniffImage(stored.body);
  if (!sniffed) return null;
  return { body: stored.body, mimeType: sniffed.mimeType };
}

/** True while a transfer receipt is waiting for a cashier decision. */
export function isAwaitingVerification(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === PAYMENT_STATUS.PENDING_VERIFICATION;
}

/**
 * Field-level authorization for receipt access. The order id and the storage
 * key always come from the database row resolved for the authenticated tenant;
 * this guard is the second, structural check that a key can never point at
 * another tenant's object (same sanitized-prefix contract as the public
 * namespace).
 */
export function proofBelongsToTenant(
  key: string | null | undefined,
  restaurantId: string | null | undefined
): boolean {
  return paymentProofKeyBelongsToRestaurant(key, restaurantId);
}

/**
 * Guest-facing view of the proof workflow for an order the guest already owns
 * (its QR session was verified). Deliberately minimal: a state, a boolean and
 * the rejection reason — never the storage key, never the phone.
 */
export function customerPaymentProofView(order: {
  paymentStatus: string;
  paymentMethod?: string | null;
  paymentProofPath?: string | null;
  paymentRejectedAt?: Date | null;
  paymentRejectionReason?: string | null;
  settledAt?: Date | null;
}): {
  paymentStatus: string;
  hasPaymentProof: boolean;
  paymentRejected: boolean;
  paymentRejectedReason?: string;
  paymentRejectedAt?: string;
} {
  return {
    paymentStatus: order.paymentStatus,
    hasPaymentProof: Boolean(order.paymentProofPath),
    paymentRejected: Boolean(order.paymentRejectedAt),
    paymentRejectedReason: order.paymentRejectionReason || undefined,
    paymentRejectedAt: order.paymentRejectedAt?.toISOString(),
  };
}
