import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Order } from '../types/restaurant';

/**
 * The order-completed message ("تم إنجاز طلبك") must:
 *  1. show the same table number printed on the table's QR card (registry
 *     `tableNumber`), never digits scraped out of the opaque table ID;
 *  2. stack above the z-50 layer (live notifier / drawers / welcome screen)
 *     so it never overlaps them.
 */

const tableId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'; // digits "47" ≠ real number

const readyOrder: Order = {
  id: 'order-1',
  restaurantId: 'rest-1',
  tableId,
  items: [
    {
      id: 'item-1',
      productId: 'p1',
      productName: 'كبسة',
      quantity: 1,
      unitPrice: 68,
      totalPrice: 68,
    } as Order['items'][number],
  ],
  subtotal: 68,
  total: 68,
  status: 'READY',
  paymentMethod: 'PAY AT CASHIER',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      activeTableId: tableId,
      activeTable: { id: tableId, restaurantId: 'rest-1', tableNumber: 5 },
      activeTableNumber: 5,
      activeTableOrders: [readyOrder],
      tables: [{ id: tableId, restaurantId: 'rest-1', tableNumber: 5 }],
      currentRestaurant: { id: 'rest-1', name: 'مطعم الاختبار', currency: '₪' },
      setIsWaiterModalOpen: () => {},
      showToast: () => {},
    }),
  };
});

// Imported after the mock is registered.
const { OrderCompletedModal } = await import('../components/customer/OrderCompletedModal');

describe('OrderCompletedModal', () => {
  it('shows the table number printed on the QR card, not digits from the table ID', () => {
    const html = renderToStaticMarkup(<OrderCompletedModal />);

    expect(html).toContain('تم إنجاز طلبك بنجاح');
    expect(html).toContain('طاولة رقم 5');
    expect(html).not.toContain('طاولة رقم 47');
    expect(html).not.toContain(tableId);
  });

  it('stacks above the z-50 overlays so it never overlaps them', () => {
    const html = renderToStaticMarkup(<OrderCompletedModal />);
    expect(html).toContain('z-60');

    // The authored z-60 must really compile to CSS (Tailwind's default scale
    // stops at 50), otherwise the modal paints under the z-50 notifier.
    const configPath = fileURLToPath(new URL('../../tailwind.config.js', import.meta.url));
    const configSource = readFileSync(configPath, 'utf8');
    expect(configSource).toMatch(/zIndex:\s*{[^}]*'60':\s*'60'/s);
  });
});
