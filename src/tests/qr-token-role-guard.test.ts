import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canReadQrToken,
  serializeStaffTable,
  serializeStaffTables,
  QR_TOKEN_READER_ROLES,
  type StaffTableRow,
} from '../../server/services/tableSerialization';

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

/**
 * H-01 (adversarial audit 2026-09-15) — QR capability tokens must never reach
 * ordinary staff roles. A qrToken is an anonymous capability (mint a 6-hour
 * guest session at that table, observe its order stream, spam waiter calls)
 * with zero audit attribution, so leaking it to KITCHEN/WAITER/CASHIER/STAFF
 * credentials is privilege escalation by response shape.
 *
 * These tests pin BOTH the pure serializer (the security decision logic) and
 * the route contract (the serializer is actually used everywhere the staff
 * table payload is built).
 */
describe('H-01 · QR token role guard (table serialization)', () => {
  const sampleTable: StaffTableRow = {
    id: 'tbl-1',
    restaurantId: 'rest-a',
    number: 7,
    capacity: 4,
    zone: 'MAIN_HALL',
    status: 'AVAILABLE',
    qrToken: 'qr-secret-token-abcdef',
    hasWaiterCall: false,
    activeOrderIds: ['order-1'],
    lastActivityAt: '2026-09-15T10:00:00.000Z',
  };

  describe('role matrix', () => {
    it('KITCHEN must not receive qrToken', () => {
      expect(canReadQrToken('KITCHEN')).toBe(false);
    });
    it('WAITER must not receive qrToken', () => {
      expect(canReadQrToken('WAITER')).toBe(false);
    });
    it('CASHIER must not receive qrToken', () => {
      expect(canReadQrToken('CASHIER')).toBe(false);
    });
    it('STAFF must not receive qrToken', () => {
      expect(canReadQrToken('STAFF')).toBe(false);
    });
    it('RESTAURANT_MANAGER keeps qrToken (QR management surface)', () => {
      expect(canReadQrToken('RESTAURANT_MANAGER')).toBe(true);
    });
    it('platform roles keep qrToken (tenant administration)', () => {
      expect(canReadQrToken('SUPER_ADMIN')).toBe(true);
      expect(canReadQrToken('PLATFORM_ADMIN')).toBe(true);
    });
    it('unknown / undefined / tampered roles are denied', () => {
      expect(canReadQrToken(undefined)).toBe(false);
      expect(canReadQrToken(null)).toBe(false);
      expect(canReadQrToken('')).toBe(false);
      expect(canReadQrToken('kitchen')).toBe(false); // case-sensitive token
      expect(canReadQrToken('RESTAURANT_MANAGER ')).toBe(false); // padded
      expect(canReadQrToken({})).toBe(false);
      expect(canReadQrToken(['RESTAURANT_MANAGER'])).toBe(false);
    });
  });

  describe('serializer contract', () => {
    it('OMITS the qrToken key entirely for unauthorized roles', () => {
      const payload = serializeStaffTable(sampleTable, false);
      expect('qrToken' in payload).toBe(false);
      expect(JSON.stringify(payload)).not.toContain('qr-secret-token-abcdef');
    });
    it('keeps every operational field the staff screens need', () => {
      const payload = serializeStaffTable(sampleTable, false);
      expect(payload).toMatchObject({
        id: 'tbl-1',
        restaurantId: 'rest-a',
        tableNumber: 7,
        capacity: 4,
        zone: 'MAIN_HALL',
        status: 'AVAILABLE',
        hasWaiterCall: false,
      });
      expect(payload.activeOrderIds).toEqual(['order-1']);
    });
    it('includes qrToken exactly once for authorized roles', () => {
      const payload = serializeStaffTable(sampleTable, true);
      expect(payload.qrToken).toBe('qr-secret-token-abcdef');
    });
    it('serializeStaffTables applies the role decision to the whole list', () => {
      const kitchenView = serializeStaffTables([sampleTable, { ...sampleTable, id: 'tbl-2' }], 'KITCHEN');
      expect(kitchenView).toHaveLength(2);
      kitchenView.forEach((row) => expect('qrToken' in row).toBe(false));
      const managerView = serializeStaffTables([sampleTable], 'RESTAURANT_MANAGER');
      expect(managerView[0].qrToken).toBe('qr-secret-token-abcdef');
    });
    it('reader-role set contains exactly the QR-management roles', () => {
      expect([...QR_TOKEN_READER_ROLES].sort()).toEqual([
        'PLATFORM_ADMIN',
        'RESTAURANT_MANAGER',
        'SUPER_ADMIN',
      ]);
    });
  });
});

describe('H-01 · route contract (server-side enforcement, not React-hiding)', () => {
  const managerTs = read('server/routes/manager.ts');

  it('GET /tables decides token visibility from the JWT role via canReadQrToken', () => {
    expect(managerTs).toContain('canReadQrToken(req.user?.role)');
  });

  it('GET /tables builds the payload through serializeStaffTable', () => {
    expect(managerTs).toContain('serializeStaffTable(');
  });

  it('no unconditional qrToken emission remains in the staff table list', () => {
    // The previous shape hard-coded `qrToken: t.qrToken` in the GET /tables
    // formatter for every role. That exact inline emission must be gone
    // (the serializer owns the field now).
    expect(managerTs).not.toMatch(/const formatted = tables\.map\(\(t\) => \(\{[^}]*qrToken/);
  });

  it('other capability-returning routes stay manager-gated (regenerate-qr)', () => {
    const regenerateIdx = managerTs.indexOf("router.post('/tables/:id/regenerate-qr'");
    expect(regenerateIdx).toBeGreaterThan(-1);
    const routeHeader = managerTs.slice(regenerateIdx, regenerateIdx + 200);
    expect(routeHeader).toContain('requireManager()');
  });
});
