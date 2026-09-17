/**
 * The two capabilities carried by a QR table-session token are deliberately
 * evaluated for different purposes:
 *
 * - INTERACTION authorizes table-scoped writes only while the TableSession is
 *   ACTIVE (placing an order, editing it, uploading proof, calling a waiter).
 * - ORDER_TRACKING authorizes read-only access to orders already bound to the
 *   token's session. Closing the table does not revoke that previously-issued
 *   capability; normal expiry and exact tenant/table binding still apply.
 *
 * In other words: TableSession lifecycle is not guest order-tracking
 * authorization, and neither one advances the order fulfillment lifecycle.
 */
export const GUEST_SESSION_PURPOSE = {
  INTERACTION: 'INTERACTION',
  ORDER_TRACKING: 'ORDER_TRACKING',
} as const;

export type GuestSessionPurpose =
  (typeof GUEST_SESSION_PURPOSE)[keyof typeof GUEST_SESSION_PURPOSE];

interface GuestSessionCapabilityInput {
  sessionToken: unknown;
  restaurantId: string;
  tableId: string;
  purpose?: GuestSessionPurpose;
  now?: Date;
}

export interface GuestSessionCapabilityWhere {
  sessionToken: string;
  restaurantId: string;
  tableId: string;
  status: string | { in: string[] };
  expiresAt: { gt: Date };
}

/**
 * Builds the fail-closed Prisma predicate for a QR-session capability.
 * Returning null for malformed credentials keeps callers from accidentally
 * issuing an unscoped lookup.
 */
export function guestSessionCapabilityWhere({
  sessionToken,
  restaurantId,
  tableId,
  purpose = GUEST_SESSION_PURPOSE.INTERACTION,
  now = new Date(),
}: GuestSessionCapabilityInput): GuestSessionCapabilityWhere | null {
  if (typeof sessionToken !== 'string' || !sessionToken) return null;
  if (!restaurantId || !tableId) return null;

  return {
    sessionToken,
    restaurantId,
    tableId,
    // CLOSED is accepted only at the read-only tracking boundary. Explicitly
    // list known states so an unknown future lifecycle state fails closed.
    status:
      purpose === GUEST_SESSION_PURPOSE.ORDER_TRACKING
        ? { in: ['ACTIVE', 'CLOSED'] }
        : 'ACTIVE',
    expiresAt: { gt: now },
  };
}
