import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GUEST_SESSION_PURPOSE,
  guestSessionCapabilityWhere,
  type GuestSessionCapabilityWhere,
} from '../../server/services/guestSessionAuthorization';

const repoRoot = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8');

type SessionRow = {
  sessionToken: string;
  restaurantId: string;
  tableId: string;
  status: string;
  expiresAt: Date;
};

function capabilityMatches(
  row: SessionRow,
  where: GuestSessionCapabilityWhere | null
): boolean {
  if (!where) return false;
  const allowedStatuses =
    typeof where.status === 'string' ? [where.status] : where.status.in;
  return (
    row.sessionToken === where.sessionToken &&
    row.restaurantId === where.restaurantId &&
    row.tableId === where.tableId &&
    allowedStatuses.includes(row.status) &&
    row.expiresAt > where.expiresAt.gt
  );
}

const now = new Date('2026-09-17T09:00:00.000Z');
const guestSession: SessionRow = {
  sessionToken: 'guest-session-capability-01',
  restaurantId: 'restaurant-a',
  tableId: 'table-a-1',
  status: 'ACTIVE',
  expiresAt: new Date('2026-09-17T15:00:00.000Z'),
};

function trackingWhere(overrides: Partial<Parameters<typeof guestSessionCapabilityWhere>[0]> = {}) {
  return guestSessionCapabilityWhere({
    sessionToken: guestSession.sessionToken,
    restaurantId: guestSession.restaurantId,
    tableId: guestSession.tableId,
    purpose: GUEST_SESSION_PURPOSE.ORDER_TRACKING,
    now,
    ...overrides,
  });
}

describe('F-01 · table lifecycle and guest order-tracking authorization', () => {
  it('QR → order → cash PAID/RELEASED → PREPARING → READY stays visible, including reload', () => {
    const session = { ...guestSession };
    const order = {
      id: '#1001',
      restaurantId: session.restaurantId,
      tableId: session.tableId,
      sessionId: 'session-row-01',
      paymentStatus: 'UNPAID',
      fulfillmentState: 'AWAITING_PAYMENT',
      status: 'PENDING',
    };

    // The active QR capability owns the order before payment.
    expect(capabilityMatches(session, trackingWhere())).toBe(true);

    // Cash collection closes the business/table session and opens the payment
    // gate, but must not consume the already-issued tracking capability.
    session.status = 'CLOSED';
    order.paymentStatus = 'PAID';
    order.fulfillmentState = 'RELEASED';
    expect(capabilityMatches(session, trackingWhere())).toBe(true);
    expect(order).toMatchObject({
      paymentStatus: 'PAID',
      fulfillmentState: 'RELEASED',
      status: 'PENDING',
    });

    // Fulfillment remains an independent monotonic lifecycle. The same exact
    // tenant/table/session capability can read each authoritative update.
    order.status = 'PREPARING';
    expect(capabilityMatches(session, trackingWhere())).toBe(true);
    expect(order.status).toBe('PREPARING');

    order.status = 'READY';
    expect(capabilityMatches(session, trackingWhere())).toBe(true);
    expect(order.status).toBe('READY');

    // Reload restores the opaque session token saved for this tab, not merely
    // the public table QR. The resumed session remains CLOSED/read-only and
    // therefore resolves to the same order owner/session id.
    const persistedBinding = JSON.stringify({
      restaurantId: session.restaurantId,
      tableId: session.tableId,
      qrToken: 'physical-table-qr',
      sessionId: order.sessionId,
      sessionToken: session.sessionToken,
    });
    const reloaded = JSON.parse(persistedBinding) as {
      restaurantId: string;
      tableId: string;
      sessionId: string;
      sessionToken: string;
    };
    expect(
      capabilityMatches(
        session,
        trackingWhere({
          sessionToken: reloaded.sessionToken,
          restaurantId: reloaded.restaurantId,
          tableId: reloaded.tableId,
        })
      )
    ).toBe(true);
    expect(reloaded.sessionId).toBe(order.sessionId);
    expect(order.status).toBe('READY');
  });

  it('keeps CLOSED sessions read-only: interaction/write authorization is revoked', () => {
    const closed = { ...guestSession, status: 'CLOSED' };
    const interaction = guestSessionCapabilityWhere({
      sessionToken: closed.sessionToken,
      restaurantId: closed.restaurantId,
      tableId: closed.tableId,
      purpose: GUEST_SESSION_PURPOSE.INTERACTION,
      now,
    });

    expect(capabilityMatches(closed, interaction)).toBe(false);
    expect(capabilityMatches(closed, trackingWhere())).toBe(true);
  });

  it('rejects missing, invalid, expired, wrong-table, and wrong-tenant capabilities', () => {
    expect(
      guestSessionCapabilityWhere({
        sessionToken: '',
        restaurantId: guestSession.restaurantId,
        tableId: guestSession.tableId,
        purpose: GUEST_SESSION_PURPOSE.ORDER_TRACKING,
        now,
      })
    ).toBeNull();
    expect(capabilityMatches(guestSession, trackingWhere({ sessionToken: 'invalid-token' }))).toBe(false);
    expect(capabilityMatches(guestSession, trackingWhere({ restaurantId: 'restaurant-b' }))).toBe(false);
    expect(capabilityMatches(guestSession, trackingWhere({ tableId: 'table-a-2' }))).toBe(false);
    expect(
      capabilityMatches(
        { ...guestSession, expiresAt: new Date('2026-09-17T08:59:59.000Z') },
        trackingWhere()
      )
    ).toBe(false);
  });

  it('keeps the transfer-payment path active and governed by the same payment gate', () => {
    const activeTransferSession = { ...guestSession, status: 'ACTIVE' };
    const interaction = guestSessionCapabilityWhere({
      sessionToken: activeTransferSession.sessionToken,
      restaurantId: activeTransferSession.restaurantId,
      tableId: activeTransferSession.tableId,
      now,
    });
    expect(capabilityMatches(activeTransferSession, interaction)).toBe(true);
    expect(capabilityMatches(activeTransferSession, trackingWhere())).toBe(true);

    const manager = read('server/routes/manager.ts');
    const confirmStart = manager.indexOf("'/orders/:orderId/payment/confirm'");
    const rejectStart = manager.indexOf("'/orders/:orderId/payment/reject'", confirmStart);
    const transferConfirm = manager.slice(confirmStart, rejectStart);
    expect(transferConfirm).toContain('...releaseFields(now)');
    expect(transferConfirm).toContain("paymentStatus: 'PAID'");
    expect(transferConfirm).toContain('RELEASE_REASON.TRANSFER_VERIFIED');
    expect(transferConfirm).not.toContain('tableSession.updateMany');
  });

  it('wires the policy only into tracking/resume while preserving active-only mutations', () => {
    const route = read('server/routes/public.ts');
    const context = read('src/context/RestaurantContext.tsx');
    const api = read('src/services/api.ts');
    const trackingStart = route.indexOf("'/tables/:tableId/orders'");
    const orderCreateStart = route.indexOf("'/orders'", trackingStart);
    const trackingRoute = route.slice(trackingStart, orderCreateStart);

    expect(trackingRoute).toContain('GUEST_SESSION_PURPOSE.ORDER_TRACKING');
    expect(trackingRoute).toContain('sessionId: session.id');
    expect(route).toContain('resumeSessionToken');
    expect(route).toContain('sessionStatus: session.status');

    // Calls without an explicit purpose retain the INTERACTION default, which
    // requires ACTIVE. Thus orderId alone and CLOSED-session writes still fail.
    expect(route).toContain(
      'purpose: GuestSessionPurpose = GUEST_SESSION_PURPOSE.INTERACTION'
    );
    expect(route).toContain('!order.sessionId || order.sessionId !== session.id');

    // Reload keeps the unguessable grant in tab-scoped storage and presents it
    // together with the physical QR; it is never placed in the public URL.
    expect(context).toContain('sessionToken: session.session.sessionToken');
    expect(context).toContain('resumeSessionToken');
    expect(api).toContain("status: res.data.sessionStatus || 'ACTIVE'");
    expect(context).not.toContain('qr=${encodeURIComponent(currentTableSession.sessionToken)}');
  });
});
