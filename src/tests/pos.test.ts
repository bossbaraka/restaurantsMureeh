import { describe, it, expect, beforeEach } from 'vitest';
import { api } from '../services/api';
import { db } from '../services/db';
import { SEED_USERS, SEED_PAID_ORDER_HISTORY } from '../data/seedData';
import { RestaurantUser } from '../types/restaurant';
import { computeSalesKpis, computeVisitorKpis, summarizeByPaymentMethod, toISODate } from '../services/analytics';

const merarManager = SEED_USERS.find((u) => u.email === 'manager@merar-dining.com')!;
const lumiereManager = SEED_USERS.find((u) => u.email === 'manager@bistro-lumiere.com')!;

// Cashier accounts that belong to each tenant (role-based POS access)
const cashierMerar: RestaurantUser = {
  id: 'user-cashier-merar-test',
  restaurantId: 'rest-merar',
  name: 'كاشير ميرار',
  email: 'cashier@merar-dining.com',
  role: 'CASHIER',
  createdAt: new Date().toISOString(),
};

describe('Cashier / POS & Payment System', () => {
  beforeEach(() => {
    db.resetToSeed();
  });

  it('Seeds a POS payment ledger and multi-branch structure for the demo tenant', () => {
    const merarPayments = db.getPayments('rest-merar');
    expect(merarPayments.length).toBe(SEED_PAID_ORDER_HISTORY.length);
    expect(merarPayments.every((p) => p.restaurantId === 'rest-merar')).toBe(true);
    expect(merarPayments[0].receiptNumber).toMatch(/^RC-/);

    // Tenant isolation of the payment ledger
    expect(db.getPayments('rest-lumiere').length).toBe(0);

    // Branches: merar has 3 seeded branches, lumiere 1
    const merarBranches = db.getBranches('rest-merar');
    expect(merarBranches.length).toBe(3);
    expect(db.getBranches('rest-lumiere').length).toBe(1);
    expect(merarBranches.every((b) => b.restaurantId === 'rest-merar')).toBe(true);
  });

  it('Manager cannot read the payment ledger of another tenant (403)', async () => {
    const res = await api.getPayments(merarManager, 'rest-lumiere');
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('Cashier can access POS payments only for their own tenant', async () => {
    const own = await api.getPayments(cashierMerar, 'rest-merar');
    expect(own.success).toBe(true);
    expect(Array.isArray(own.data)).toBe(true);

    const foreign = await api.getPayments(cashierMerar, 'rest-lumiere');
    expect(foreign.success).toBe(false);
    expect(foreign.statusCode).toBe(403);
  });

  it('processes a cash order: marks orders paid, frees the table, records receipt with change', async () => {
    // Customer table 02 orders two items
    const created = await api.createOrder('rest-merar', 'TABLE-02', [
      { id: 'pos-test-item-1', productId: 'prod-sig-1', productName: 'تندرلوين بلاك أنغوس', quantity: 1, unitPrice: 135, totalPrice: 135 },
      { id: 'pos-test-item-2', productId: 'prod-app-1', productName: 'مقبلات ملكية', quantity: 1, unitPrice: 85, totalPrice: 85 },
    ]);
    expect(created.success).toBe(true);

    const before = db.getPayments('rest-merar').length;
    const res = await api.processPayment(cashierMerar, 'rest-merar', {
      tableId: 'TABLE-02',
      orderIds: [created.data!.id],
      method: 'CASH',
      cashReceived: 300,
    });

    expect(res.success).toBe(true);
    const payment = res.data!.payment;
    expect(payment.total).toBe(220);
    expect(payment.cashReceived).toBe(300);
    expect(payment.changeDue).toBe(80);
    expect(payment.tableLabel).toContain('طاولة');
    expect(payment.receiptNumber).toMatch(/^RC-/);

    // Ledger grew +1 & record is isolated by tenant
    expect(db.getPayments('rest-merar').length).toBe(before + 1);
    expect(db.getPayments('rest-lumiere').length).toBe(0);

    // Order is paid & settled
    const order = db.getOrderById('rest-merar', created.data!.id);
    expect(order?.paymentStatus).toBe('PAID');
    expect(order?.paymentMethod).toBe('CASH');

    // Table freed
    const table = db.getTableById('rest-merar', 'TABLE-02');
    expect(table?.status).toBe('AVAILABLE');
    expect(table?.activeOrderIds.length).toBe(0);
  });

  it('rejects empty/zero/duplicate payments and walk-in counter sales are supported', async () => {
    const empty = await api.processPayment(cashierMerar, 'rest-merar', { tableId: 'TABLE-03', orderIds: [], method: 'CASH' });
    expect(empty.success).toBe(false);
    expect(empty.statusCode).toBe(400);

    // Walk-in sale: no real table involved
    const walkInOrder = await api.createOrder('rest-merar', '__WALKIN__', [
      { id: 'pos-walk-item', productId: 'prod-mock-1', productName: 'عصير رمان', quantity: 2, unitPrice: 19, totalPrice: 38 },
    ]);
    expect(walkInOrder.success).toBe(true);

    const res = await api.processPayment(cashierMerar, 'rest-merar', {
      tableId: '__WALKIN__',
      orderIds: [walkInOrder.data!.id],
      method: 'MOBILE',
    });
    expect(res.success).toBe(true);
    expect(res.data!.payment.tableId).toBe('__WALKIN__');
    expect(res.data!.payment.method).toBe('MOBILE');
    // Walk-in never touches a physical table
    expect(db.getTableById('rest-merar', 'TABLE-03')).not.toBeNull();
  });

  it('card and mobile payments do not require cash fields', async () => {
    const order = await api.createOrder('rest-merar', 'TABLE-10', [
      { id: 'pos-card-item', productId: 'prod-sig-3', productName: 'غراتان الكمأة', quantity: 1, unitPrice: 118, totalPrice: 118 },
    ]);
    expect(order.success).toBe(true);

    const res = await api.processPayment(cashierMerar, 'rest-merar', {
      tableId: 'TABLE-10',
      orderIds: [order.data!.id],
      method: 'CARD',
    });
    expect(res.success).toBe(true);
    expect(res.data!.payment.cashReceived).toBeUndefined();
    expect(res.data!.payment.changeDue).toBeUndefined();
  });

  it('cannot pay the same order twice (409)', async () => {
    const order = await api.createOrder('rest-merar', 'TABLE-11', [
      { id: 'pos-double-item', productId: 'prod-sig-2', productName: 'سلمون نرويجي', quantity: 1, unitPrice: 135, totalPrice: 135 },
    ]);
    expect(order.success).toBe(true);

    const first = await api.processPayment(cashierMerar, 'rest-merar', {
      tableId: 'TABLE-11',
      orderIds: [order.data!.id],
      method: 'CARD',
    });
    expect(first.success).toBe(true);

    const second = await api.processPayment(cashierMerar, 'rest-merar', {
      tableId: 'TABLE-11',
      orderIds: [order.data!.id],
      method: 'CASH',
    });
    expect(second.success).toBe(false);
    expect(second.statusCode).toBe(409);
  });
});

describe('Multi-Branch Management', () => {
  beforeEach(() => {
    db.resetToSeed();
  });

  it('creates, renames and deletes branches with tenant isolation', async () => {
    const created = await api.saveBranch(merarManager, 'rest-merar', {
      id: 'branch-test-1',
      restaurantId: 'rest-merar',
      name: 'فرع اختباري',
      color: '#123456',
      isActive: true,
      createdAt: new Date().toISOString(),
    });
    expect(created.success).toBe(true);
    expect(db.getBranches('rest-merar').some((b) => b.id === 'branch-test-1')).toBe(true);

    // Rename
    const renamed = await api.saveBranch(merarManager, 'rest-merar', {
      ...created.data!.branch,
      name: 'فرع المطار',
    });
    expect(renamed.success).toBe(true);
    expect(db.getBranchById('rest-merar', 'branch-test-1')?.name).toBe('فرع المطار');

    // Another manager cannot touch merar branches
    const foreign = await api.saveBranch(lumiereManager, 'rest-merar', {
      id: 'branch-evil',
      restaurantId: 'rest-merar',
      name: 'قرصنة',
      isActive: true,
      createdAt: new Date().toISOString(),
    });
    expect(foreign.success).toBe(false);
    expect(foreign.statusCode).toBe(403);

    // Delete
    const del = await api.deleteBranch(merarManager, 'rest-merar', 'branch-test-1');
    expect(del.success).toBe(true);
    expect(db.getBranches('rest-merar').some((b) => b.id === 'branch-test-1')).toBe(false);
  });

  it('assigns tables to a branch and unassigns on branch delete', async () => {
    // VIP lounge tables (33-42) start unassigned by the demo seed
    await api.assignTablesToBranch(merarManager, 'rest-merar', 'branch-terrace', ['TABLE-21', 'TABLE-41', 'TABLE-42']);
    const tables = db.getTables('rest-merar');
    expect(tables.find((t) => t.id === 'TABLE-21')?.branchId).toBe('branch-terrace');
    expect(tables.find((t) => t.id === 'TABLE-41')?.branchId).toBe('branch-terrace');
    expect(tables.find((t) => t.id === 'TABLE-42')?.branchId).toBe('branch-terrace');
    expect(tables.find((t) => t.id === 'TABLE-33')?.branchId).toBeUndefined();

    // Deleting the branch unassigns its tables
    await api.deleteBranch(merarManager, 'rest-merar', 'branch-terrace');
    const after = db.getTables('rest-merar');
    expect(after.find((t) => t.id === 'TABLE-21')?.branchId).toBeUndefined();
    expect(after.find((t) => t.id === 'TABLE-41')?.branchId).toBeUndefined();
  });
});

describe('Sales & Visitor Analytics Engine', () => {
  it('splits gross revenue, collected revenue and open bills correctly', () => {
    const orders: any[] = [
      { id: '#A1', status: 'SERVED', total: 100, subtotal: 100, createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
      { id: '#A2', status: 'PREPARING', total: 60, subtotal: 60, createdAt: new Date().toISOString() },
      { id: '#A3', status: 'CANCELLED', total: 50, subtotal: 50, createdAt: new Date().toISOString() },
      { id: '#A4', status: 'SERVED', total: 200, subtotal: 200, createdAt: new Date(Date.now() - 86400000).toISOString() },
    ];
    const payments: any[] = [
      { id: 'p1', total: 200, method: 'CARD', orderIds: ['#A4'], createdAt: new Date(Date.now() - 86400000).toISOString() },
      { id: 'p2', total: 100, method: 'CASH', orderIds: ['#A1'], createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    ];

    const kpis = computeSalesKpis(orders, payments);
    expect(kpis.grossOrderValue).toBe(360); // 100 + 60 + 200 (cancelled excluded)
    expect(kpis.collectedRevenue).toBe(300);
    expect(kpis.openBillsValue).toBe(60); // only PREPARING unpaid is open
    expect(kpis.paidOrdersCount).toBe(2);
    expect(kpis.todayCollected).toBe(0);
    expect(kpis.todayOrders).toBe(1); // #A2 today (cancelled excluded)

    const methods = summarizeByPaymentMethod(payments);
    expect(methods.find((m) => m.method === 'CARD')?.total).toBe(200);
    expect(methods.find((m) => m.method === 'CASH')?.total).toBe(100);
  });

  it('computes visitor KPIs from orders and table occupancy', () => {
    const orders: any[] = [
      { id: '#V1', tableId: 'TABLE-01', status: 'PENDING', createdAt: new Date().toISOString() },
      { id: '#V2', tableId: 'TABLE-02', status: 'PREPARING', createdAt: new Date().toISOString() },
      { id: '#V3', tableId: 'TABLE-01', status: 'READY', createdAt: new Date(Date.now() - 86400000).toISOString() },
      { id: '#V4', tableId: 'TABLE-09', status: 'CANCELLED', createdAt: new Date().toISOString() },
    ];
    const tables: any[] = [
      { id: 'TABLE-01', status: 'OCCUPIED' },
      { id: 'TABLE-02', status: 'OCCUPIED' },
      { id: 'TABLE-03', status: 'AVAILABLE' },
    ];

    const visits = computeVisitorKpis(orders, tables, []);
    expect(visits.activeNow).toBe(2);
    expect(visits.visitsToday).toBe(2); // TABLE-01 + TABLE-02 today
    expect(visits.visitsYesterday).toBe(1); // TABLE-01 yesterday
    expect(visits.weekSeries.length).toBe(7);
    expect(visits.hourlyDistribution.length).toBe(24);
    expect(visits.walkInSalesCount).toBe(0);
  });

  it('formats dates in local ISO without timezone drift', () => {
    const d = new Date(2026, 8, 6, 15, 30); // Sep 6 2026 local
    expect(toISODate(d)).toBe('2026-09-06');
  });
});
