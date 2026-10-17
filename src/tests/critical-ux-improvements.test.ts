// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { posOrderSchema, publicOrderSchema } from '../../server/validation/schemas';
import {
  getOwnedOrderIds,
  getSavedGuestName,
  isGuestOwnOrder,
  recordOwnedOrderId,
  saveGuestName,
} from '../utils/guestOrderOwnership';

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

describe('Critical UX & Security Improvements (P0)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  describe('1. Upfront Payment Method Selection & Guest Name Attribution', () => {
    it('accepts optional customerName in publicOrderSchema and rejects overly long names', () => {
      const valid = publicOrderSchema.safeParse({
        restaurantId: 'rest-1',
        tableId: 'tbl-1',
        sessionToken: 'session-token-12345',
        items: [{ productId: 'prod-1', quantity: 1 }],
        customerName: 'أحمد محمود',
      });
      expect(valid.success).toBe(true);

      const tooLong = publicOrderSchema.safeParse({
        restaurantId: 'rest-1',
        tableId: 'tbl-1',
        sessionToken: 'session-token-12345',
        items: [{ productId: 'prod-1', quantity: 1 }],
        customerName: 'أ'.repeat(200),
      });
      expect(tooLong.success).toBe(false);
    });

    it('renders upfront payment method radio cards and guest name input in OrderConfirmationModal', () => {
      const modal = read('src/components/customer/OrderConfirmationModal.tsx');
      expect(modal).toContain('order-confirm-guest-name');
      expect(modal).toContain('اسم صاحب الطلب');
      expect(modal).toContain('نقداً أو بطاقة عند الكاشير');
      expect(modal).toContain('حوالة بنكية أو محفظة');
      expect(modal).toContain("paymentMethod === 'TRANSFER'");
      expect(modal).toContain('createOrder(orderNotes, {');
    });

    it('routes TRANSFER choice to TransferPaymentModal and CASHIER choice directly to OrderTrackingDrawer', () => {
      const ctx = read('src/context/RestaurantContext.tsx');
      expect(ctx).toContain("if (options?.paymentMethod === 'TRANSFER') {");
      expect(ctx).toContain('setPaymentStepOrder(res.data.order);');
      expect(ctx).toContain('setIsOrderTrackingOpen(true);');
    });
  });

  describe('2. QR URL Token Scrubbing & Multi-Guest Table Session Privacy', () => {
    it('scrubs ?qr= from the browser URL after establishing the table session while keeping merar_table_binding', () => {
      const ctx = read('src/context/RestaurantContext.tsx');
      expect(ctx).toContain('const cleanUrl = `/r/${currentRestaurant.slug}`;');
      expect(ctx).toContain("window.history.replaceState({ tableId: activeTableId, slug: currentRestaurant.slug }, '', cleanUrl)");
      expect(ctx).not.toContain('const newUrl = `/r/${currentRestaurant.slug}?qr=${encodeURIComponent(qrToken)}`;');
      expect(ctx).toContain('merar_table_binding');
    });

    it('distinguishes the current guest device orders from other table-mates orders on the same TableSession', () => {
      saveGuestName('أحمد');
      recordOwnedOrderId('#1001');

      expect(getSavedGuestName()).toBe('أحمد');
      expect(getOwnedOrderIds()).toEqual(['#1001']);

      const tableOrders = [
        { id: '#1001', customerName: 'أحمد' },
        { id: '#1002', customerName: 'سارة' },
      ];

      expect(isGuestOwnOrder(tableOrders[0], tableOrders)).toBe(true);
      expect(isGuestOwnOrder(tableOrders[1], tableOrders)).toBe(false);
    });

    it('shows only owner name and preparation status for other table-mates orders in OrderTrackingDrawer', () => {
      const drawer = read('src/components/customer/OrderTrackingDrawer.tsx');
      expect(drawer).toContain('isGuestOwnOrder(order, activeTableOrders)');
      expect(drawer).toContain('صاحب الطلب: {order.customerName}');
      expect(drawer).toContain('يظهر اسم صاحب الطلب وحالة التحضير فقط حفاظاً على الخصوصية');
    });

    it('persists and returns customerName in public and manager order routes', () => {
      const publicRoute = read('server/routes/public.ts');
      const managerRoute = read('server/routes/manager.ts');
      expect(publicRoute).toContain('customerName: o.customerName || undefined');
      expect(publicRoute).toContain('customerName: customerName?.trim() || undefined');
      expect(managerRoute).toContain('customerName: o.customerName || undefined');
    });
  });

  describe('3. Cashier POS Dish Customization (Sizes, Add-Ons, Removable Ingredients, Notes)', () => {
    it('accepts selectedSizeId, selectedSize, and selectedAddOnIds in posOrderSchema', () => {
      const parsed = posOrderSchema.safeParse({
        restaurantId: 'rest-1',
        tableId: '__WALKIN__',
        items: [
          {
            productId: 'prod-1',
            quantity: 2,
            selectedSizeId: 'size-large',
            selectedSize: 'كبير',
            selectedAddOnIds: ['addon-cheese', 'addon-mushroom'],
            selectedAddOns: ['جبنة إضافية', 'فطر'],
            removedIngredients: ['بصل'],
            specialInstructions: 'بدون ملح',
          },
        ],
      });
      expect(parsed.success).toBe(true);
    });

    it('prices sizes and add-ons in manager POS order creation and provides POS customization modal', () => {
      const managerRoute = read('server/routes/manager.ts');
      const posView = read('src/components/manager/CashierPOSView.tsx');

      expect(managerRoute).toContain('include: { options: true, addOns: true }');
      expect(managerRoute).toContain('selectedSize: sizeSnapshot');
      expect(managerRoute).toContain('selectedAddOns: addOnSnapshots');

      expect(posView).toContain('POS DISH CUSTOMIZATION MODAL');
      expect(posView).toContain('selectedSizeId: l.selectedSize?.id');
      expect(posView).toContain('selectedAddOnIds: l.selectedAddOns?.map((a) => a.id).filter(Boolean)');
      expect(posView).toContain('مطابق ({formatPrice(grandTotal)})');
    });
  });
});
