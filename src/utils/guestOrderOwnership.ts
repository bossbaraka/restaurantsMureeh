/**
 * Per-device guest identity & order ownership on shared QR table sessions.
 *
 * When multiple people sit at the same physical table and scan the table's QR,
 * they share the active `TableSession` (so the restaurant can manage the table
 * and aggregate or split its bill), while each person places their own order
 * with their `customerName`.
 *
 * This helper keeps track of which orders were placed from THIS browser/device
 * so `OrderTrackingDrawer` can show full item details and edit/cancel controls
 * for the guest's own orders while showing a privacy-preserving summary card
 * ("صاحب الطلب فقط + حالة التحضير") for other table-mates' orders.
 */

export const GUEST_NAME_STORAGE_KEY = 'merar_guest_name';
export const GUEST_OWNED_ORDERS_STORAGE_KEY = 'merar_guest_owned_orders';
const MAX_STORED_OWNED_ORDERS = 100;

export function getSavedGuestName(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (window.localStorage.getItem(GUEST_NAME_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveGuestName(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = name.trim();
    if (trimmed) {
      window.localStorage.setItem(GUEST_NAME_STORAGE_KEY, trimmed);
    }
  } catch {
    // ignore storage quota/privacy errors
  }
}

export function getOwnedOrderIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GUEST_OWNED_ORDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function recordOwnedOrderId(orderId: string): void {
  if (typeof window === 'undefined' || !orderId) return;
  try {
    const current = getOwnedOrderIds().filter((id) => id !== orderId);
    current.push(orderId);
    const bounded = current.slice(-MAX_STORED_OWNED_ORDERS);
    window.localStorage.setItem(GUEST_OWNED_ORDERS_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // ignore storage quota/privacy errors
  }
}

export function isGuestOwnOrder(
  order: { id: string; customerName?: string },
  tableOrders: Array<{ id: string; customerName?: string }> = []
): boolean {
  const ownedIds = getOwnedOrderIds();
  if (ownedIds.includes(order.id)) return true;

  const savedName = getSavedGuestName();
  const orderOwnerName = (order.customerName || '').trim();

  // If the order explicitly carries another guest's name and this device has a
  // different saved guest name, treat it as a table-mate's order.
  if (savedName && orderOwnerName && savedName !== orderOwnerName) {
    return false;
  }

  // If this device owns at least one order on this table session, any other
  // order not in `ownedIds` (and not matching `savedName`) was placed by
  // another guest at the same table.
  const deviceHasOrderOnTable = tableOrders.some((o) => ownedIds.includes(o.id));
  if (deviceHasOrderOnTable) {
    if (savedName && orderOwnerName && savedName === orderOwnerName) {
      return true;
    }
    return false;
  }

  // Fallback for single-guest sessions or when the device hasn't recorded
  // ownership yet (e.g. viewing a single order on the table).
  return true;
}
