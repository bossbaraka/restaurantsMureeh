import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '../types/restaurant';

const tableId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const readyOrder: Order = {
  id: 'order-1', restaurantId: 'rest-1', tableId,
  items: [{ id: 'item-1', productId: 'p1', productName: 'كبسة', quantity: 1, unitPrice: 68, totalPrice: 68 } as Order['items'][number]],
  subtotal: 68, total: 68, status: 'READY', paymentMethod: 'PAY AT CASHIER',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      activeTable: { id: tableId, restaurantId: 'rest-1', tableNumber: 5 },
      activeTableNumber: 5,
      activeTableOrders: [readyOrder],
      isOrderTrackingOpen: false,
      setIsOrderTrackingOpen: () => {},
    }),
  };
});

const { OrderCompletedModal } = await import('../components/customer/OrderCompletedModal');

describe('OrderCompletedModal ready notification', () => {
  it('identifies the real order and printed table number without exposing the opaque table ID', () => {
    const html = renderToStaticMarkup(<OrderCompletedModal />);
    expect(html).toContain('order-1');
    expect(html).toContain('طاولة رقم 5');
    expect(html).not.toContain('طاولة رقم 47');
    expect(html).not.toContain(tableId);
  });

  it('is a non-blocking status notification with a direct tracking action', () => {
    const html = renderToStaticMarkup(<OrderCompletedModal />);
    expect(html).toContain('role="status"');
    expect(html).toContain('عرض حالة الطلب');
    expect(html).toContain('pointer-events-none');
    expect(html).not.toContain('aria-modal');
    expect(html).not.toContain('fixed inset-0');
  });
});
