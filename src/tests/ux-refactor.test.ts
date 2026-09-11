import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('UX refactor regression guards', () => {
  it('keeps the QR customer menu zoomable for low-vision users', () => {
    const layout = source('../components/customer/CustomerLayout.tsx');
    expect(layout).not.toContain('user-scalable=no');
    expect(layout).not.toContain('gesturestart');
    expect(layout).not.toContain('maximum-scale=1.0');
  });

  it('never presents a fabricated preparation estimate', () => {
    const tracking = source('../components/customer/OrderTrackingDrawer.tsx');
    expect(tracking).not.toContain('12 - 18 دقيقة');
    expect(tracking).toContain('حالة المتابعة');
    expect(tracking).toContain('تحديث مباشر');
  });

  it('awaits waiter-call acceptance before showing success and blocks duplicates', () => {
    const modal = source('../components/customer/WaiterCallModal.tsx');
    const context = source('../context/RestaurantContext.tsx');

    expect(modal).toContain('const result = await callWaiter');
    expect(modal).toContain('if (!result.success) return');
    expect(modal).toContain('|| !!activeRequest');
    expect(context).toContain('Promise<{ success: boolean; error?: string }>');
    expect(context).toContain('setWaiterRequests((prev) =>');
  });

  it('starts operational roles in their primary workflow', () => {
    const manager = source('../components/manager/ManagerLayout.tsx');
    expect(manager).toContain("CASHIER: 'POS'");
    expect(manager).toContain("WAITER: 'WAITERS'");
    expect(manager).toContain("STAFF: 'WAITERS'");
    expect(manager).toContain("KITCHEN: 'ORDERS'");
  });

  it('keeps ready-order feedback non-blocking, identifiable, dismissible, and actionable', () => {
    const ready = source('../components/customer/OrderCompletedModal.tsx');
    expect(ready).toContain("role=\"status\"");
    expect(ready).toContain('عرض حالة الطلب');
    expect(ready).toContain('latestOrder.id');
    expect(ready).toContain('sessionStorage.setItem');
    expect(ready).not.toContain('aria-modal');
    expect(ready).not.toContain('fixed inset-0');
  });

  it('waits for server-confirmed product saves and retains form data on failure', () => {
    const form = source('../components/manager/ProductFormModal.tsx');
    const context = source('../context/RestaurantContext.tsx');
    expect(form).toContain('const saved = onSave');
    expect(form).toContain('await updateProduct');
    expect(form).toContain('if (saved) onClose()');
    expect(context).toContain('Promise<boolean>');
    expect(context).toContain('isMutationPending');
  });

  it('distinguishes empty datasets from filtered no-results and offers reset actions', () => {
    const orders = source('../components/manager/OrderManagement.tsx');
    const menu = source('../components/manager/MenuManagement.tsx');
    expect(orders).toContain('مسح البحث والفلاتر');
    expect(orders).toContain('orders.length === 0');
    expect(menu).toContain('عرض كافة الأطباق');
    expect(menu).toContain('products.length === 0');
  });

  it('groups existing destinations by staff mental model without adding routes', () => {
    const manager = source('../components/manager/ManagerLayout.tsx');
    expect(manager).toContain("OPERATIONS: 'العمليات اليومية'");
    expect(manager).toContain("RESTAURANT: 'إدارة المطعم'");
    expect(manager).toContain("TEAM: 'الفريق'");
    expect(manager).toContain("GROWTH: 'النمو والتقارير'");
    expect(manager).toContain("SETTINGS: 'الإعدادات'");
    expect(manager).not.toContain('قسم {String(index + 1)');
  });
});
