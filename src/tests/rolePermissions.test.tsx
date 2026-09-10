import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Staff role/permission matrix regression coverage.
 *
 * Security contract being pinned here:
 *  - The CASHIER is limited to available tables, orders (incl. live kitchen
 *    status) and cash settlement (POS) — and nothing else.
 *  - Other staff roles get only the tabs their responsibilities require.
 *  - The client matrix is cosmetic, so the server must mirror it: revenue
 *    analytics are manager-only, and staff may only flip table availability
 *    (never renumber/rezone/move tables).
 *  - The cashier's manual order-acceptance path
 *    (PUT /manager/orders/:orderId/status via requireServiceStaff) must keep
 *    the CASHIER role in its allowed set.
 */

const authContextSrc = readFileSync(
  fileURLToPath(new URL('../context/AuthContext.tsx', import.meta.url)),
  'utf8'
);
const managerRoutesSrc = readFileSync(
  fileURLToPath(new URL('../../server/routes/manager.ts', import.meta.url)),
  'utf8'
);
const authMiddlewareSrc = readFileSync(
  fileURLToPath(new URL('../../server/middleware/auth.ts', import.meta.url)),
  'utf8'
);
const apiSrc = readFileSync(
  fileURLToPath(new URL('../services/api.ts', import.meta.url)),
  'utf8'
);
const restaurantContextSrc = readFileSync(
  fileURLToPath(new URL('../context/RestaurantContext.tsx', import.meta.url)),
  'utf8'
);

const tabsOf = (role: string): string[] => {
  const matrixBlock = authContextSrc.match(
    /ROLE_MANAGER_TAB_ACCESS: Record<string, string\[\]> = \{([\s\S]*?)\};/
  );
  expect(matrixBlock, 'ROLE_MANAGER_TAB_ACCESS matrix exists').toBeTruthy();
  const match = matrixBlock![1].match(new RegExp(`${role}: \\[([^\\]]*)\\]`));
  expect(match, `ROLE_MANAGER_TAB_ACCESS entries include ${role}`).toBeTruthy();
  return (match?.[1].match(/'[A-Z_]+'/g) || []).map((t) => t.replace(/'/g, ''));
};

describe('staff role → manager tab matrix', () => {
  it('CASHIER sees only POS, ORDERS and TABLES (available tables + orders + kitchen status)', () => {
    expect(tabsOf('CASHIER').sort()).toEqual(['ORDERS', 'POS', 'TABLES']);
  });

  it('WAITER sees orders, tables and waiter calls — no POS or analytics', () => {
    expect(tabsOf('WAITER').sort()).toEqual(['ORDERS', 'TABLES', 'WAITERS']);
  });

  it('KITCHEN sees only live order status', () => {
    expect(tabsOf('KITCHEN')).toEqual(['ORDERS']);
  });

  it('STAFF sees orders, tables and waiter calls — no POS or menu management', () => {
    expect(tabsOf('STAFF').sort()).toEqual(['ORDERS', 'TABLES', 'WAITERS']);
  });

  it('managers and platform admins keep full access', () => {
    for (const role of ['RESTAURANT_MANAGER', 'PLATFORM_ADMIN', 'SUPER_ADMIN']) {
      const tabs = tabsOf(role);
      expect(tabs).toContain('OVERVIEW');
      expect(tabs).toContain('ANALYTICS');
      expect(tabs).toContain('STAFF');
      expect(tabs.length).toBe(13);
    }
  });
});

describe('server-side enforcement mirrors the matrix', () => {
  it('dashboard stats (revenue KPIs) require the manager role', () => {
    expect(managerRoutesSrc).toMatch(
      /router\.get\('\/dashboard\/stats', requireManager\(\)/
    );
  });

  it('table updates accept service staff but restrict non-managers to availability flips', () => {
    const putTableBlock = managerRoutesSrc.match(
      /router\.put\(\s*'\/tables\/:id',[\s\S]*?validateBody\(tableUpdateSchema\)/
    );
    expect(putTableBlock).toBeTruthy();
    expect(putTableBlock?.[0]).toContain('requireServiceStaff()');
    // Structural fields stay manager-only.
    expect(managerRoutesSrc).toContain('TABLE_STRUCTURAL_KEYS');
    expect(managerRoutesSrc).toMatch(/TABLE_STATUS_WRITE_ROLES\.has\(req\.user!\.role\)/);
    expect(managerRoutesSrc).toContain("'CASHIER', 'WAITER', 'STAFF'");
  });

  it('manual order acceptance keeps CASHIER among allowed service roles', () => {
    const statusRoute = managerRoutesSrc.match(
      /router\.put\(\s*'\/orders\/:orderId\/status',[\s\S]*?validateBody\(orderStatusSchema\)/
    );
    expect(statusRoute).toBeTruthy();
    expect(statusRoute?.[0]).toContain('requireServiceStaff()');
    const serviceGroup = authMiddlewareSrc.match(
      /requireServiceStaff = \(\)\s*=>\s*requireRole\(([^)]*)\)/
    );
    expect(serviceGroup).toBeTruthy();
    expect(serviceGroup?.[1]).toContain("'CASHIER'");
  });

  it('payments and POS order creation stay cashier-or-manager only', () => {
    expect(managerRoutesSrc).toMatch(/router\.post\(\s*'\/payments',[\s\S]*?requireCashierOrManager\(\)/);
    expect(managerRoutesSrc).toMatch(/router\.post\(\s*'\/orders',[\s\S]*?requireCashierOrManager\(\)/);
    const cashierGroup = authMiddlewareSrc.match(
      /requireCashierOrManager = \(\)\s*=>\s*requireRole\(([^)]*)\)/
    );
    expect(cashierGroup?.[1]).toContain("'CASHIER'");
  });
});

describe('cashier table-availability client path', () => {
  it('api exposes a status-only table update (no structural fields in the body)', () => {
    const method = apiSrc.match(
      /updateTableStatus\([\s\S]*?body: \{\s*restaurantId, status \}/
    );
    expect(method).toBeTruthy();
  });

  it('context updateTableStatus uses the status-only API', () => {
    expect(restaurantContextSrc).toMatch(
      /api\.updateTableStatus\(currentRestaurant\.id, tableId, status\)/
    );
  });
});
