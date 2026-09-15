// ============================================================
// Staff table serialization (audit H-01) — pure role-gated shaping.
//
// PURE MODULE: no env, no prisma, no IO.
//
// The defect being fixed: GET /api/manager/tables ran behind `requireAuth`
// only and returned each table's `qrToken` to EVERY authenticated staff role.
// A qrToken is an anonymous capability — the codebase itself forbids the same
// exposure on the public side (public.ts: "publishing every table's token on
// a public endpoint would let any guest enumerate and 'scan' any table
// without the physical card"). KITCHEN/WAITER/STAFF accounts have no
// QR-management surface that legitimately needs the token; handing it to them
// (and to anyone who later reads their device/session) created anonymous
// 6-hour guest sessions at any table with zero audit attribution.
//
// Rule (least privilege): only roles that operate the QR management surface
// receive qrToken — RESTAURANT_MANAGER plus platform staff. Waiter/Kitchen/
// Cashier/Staff table views work with statuses + numbers only.
//
// The serializer OMITS the key entirely (not `qrToken: null`, not
// `qrToken: undefined`) for unauthorized roles: a response that documents a
// suppressed field trains clients to probe for it.
// ============================================================

/** Roles that may receive table qrToken values (QR management surface). */
export const QR_TOKEN_READER_ROLES: ReadonlySet<string> = new Set([
  'RESTAURANT_MANAGER',
  'SUPER_ADMIN',
  'PLATFORM_ADMIN',
]);

/** May this role receive QR capability tokens? Unknown/undefined → false. */
export function canReadQrToken(role: unknown): boolean {
  return typeof role === 'string' && QR_TOKEN_READER_ROLES.has(role);
}

export interface StaffTableRow {
  id: string;
  restaurantId: string;
  /** Prisma Table.number column (serialized as tableNumber). */
  number: number;
  capacity: number;
  zone: string;
  status: string;
  qrToken: string;
  hasWaiterCall: boolean;
  activeOrderIds: string[];
  lastActivityAt?: string;
}

/**
 * Build the staff table payload. `includeQrToken` must come from
 * `canReadQrToken(req.user.role)` — never from a request parameter.
 */
export function serializeStaffTable(
  row: StaffTableRow,
  includeQrToken: boolean
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: row.id,
    restaurantId: row.restaurantId,
    tableNumber: row.number,
    capacity: row.capacity,
    zone: row.zone,
    status: row.status,
    hasWaiterCall: row.hasWaiterCall,
    activeOrderIds: row.activeOrderIds,
    lastActivityAt: row.lastActivityAt,
  };
  if (includeQrToken) {
    // Insert exactly one key; the JSON contract for authorized roles is
    // unchanged by the H-01 fix.
    base.qrToken = row.qrToken;
  }
  return base;
}

/** Convenience: serialize a whole list for a given role. */
export function serializeStaffTables(
  rows: StaffTableRow[],
  role: unknown
): Record<string, unknown>[] {
  const includeQrToken = canReadQrToken(role);
  return rows.map((row) => serializeStaffTable(row, includeQrToken));
}
