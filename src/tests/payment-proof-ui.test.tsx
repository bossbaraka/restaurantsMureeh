import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '../types/restaurant';
import { isOrderOperational } from '../utils/orderLifecycle';

/**
 * Transfer payment proof — UI/source-contract tests.
 *
 * Two layers, matching the repo convention:
 *  1. the guest modal + the cashier queue are RENDERED for a tenant that is not
 *     Mureeh-gold, so a hardcoded colour or a missing state would show up here;
 *  2. the wiring a server-render cannot exercise (which endpoint, which auth,
 *     progress reporting, object-URL lifecycle, no polling, which orders the POS
 *     may collect) is pinned at the source level.
 */

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

const transferModalTsx = read('src/components/customer/TransferPaymentModal.tsx');
const trackingDrawerTsx = read('src/components/customer/OrderTrackingDrawer.tsx');
const verificationPanelTsx = read('src/components/manager/PaymentVerificationPanel.tsx');
const kitchenDisplayTsx = read('src/components/manager/KitchenDisplaySystem.tsx');
const cashierPosTsx = read('src/components/manager/CashierPOSView.tsx');
const apiTs = read('src/services/api.ts');
const contextTsx = read('src/context/RestaurantContext.tsx');
const typesTs = read('src/types/restaurant.ts');
const orderLifecycleTs = read('src/utils/orderLifecycle.ts');

const order: Order = {
  id: 'order-1',
  numericId: 42,
  restaurantId: 'rest-1',
  tableId: 'table-1',
  tableNumber: 7,
  items: [
    {
      id: 'item-1',
      productId: 'p1',
      productName: 'كبسة',
      quantity: 2,
      unitPrice: 34,
      totalPrice: 68,
    } as Order['items'][number],
  ],
  subtotal: 68,
  total: 68,
  status: 'SERVED',
  paymentMethod: 'PAY AT CASHIER',
  paymentStatus: 'UNPAID',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const submitTransferPaymentProof = vi.fn(async () => ({ success: true }));

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      currentRestaurant: {
        id: 'rest-1',
        name: 'مطعم الأوركيد',
        currency: '₪',
      },
      // A tenant brand that is deliberately not gold.
      submitTransferPaymentProof,
    }),
  };
});

const { TransferPaymentModal } = await import('../components/customer/TransferPaymentModal');

describe('guest transfer modal — rendered', () => {
  const html = renderToStaticMarkup(
    <TransferPaymentModal isOpen onClose={() => {}} order={order} />
  );

  it('states the amount from the order itself (the guest never types it)', () => {
    expect(html).toContain('الدفع عبر حوالة بنكية');
    expect(html).toContain('المبلغ المطلوب تحويله');
    expect(html).toContain('68');
    expect(html).toContain('محفظة إلكترونية');
    // There is exactly one amount surface and no editable amount field.
    expect(html).not.toMatch(/type="number"/);
  });

  it('requires the guest NAME and mobile number (the cashier must attribute the money)', () => {
    expect(html).toContain('id="transfer-name"');
    expect(html).toContain('id="transfer-phone"');
    expect(html).toContain('type="tel"');
    expect(html).toContain('inputMode="tel"');
    expect(html).toContain('type="text"');
    // Required fields, not hints: no "اختياري" label on the identity inputs.
    expect(transferModalTsx).toContain('اسم العميل');
    expect(transferModalTsx).toContain('رقم الهاتف المحمول');
    expect(transferModalTsx).not.toContain('اختياري');
    expect(transferModalTsx).toContain('maxLength={24}');
    expect(transferModalTsx).toContain('maxLength={60}');
    // Both are validated before any upload starts.
    expect(transferModalTsx).toContain("customerName.trim().length < 2");
    expect(transferModalTsx).toContain("phone.replace(/\\D/g, '').length < 7");
  });

  it('lets the guest pick the transfer channel (bank or e-wallet)', () => {
    expect(html).toContain('طريقة التحويل');
    expect(html).toContain('role="radiogroup"');
    expect(transferModalTsx).toContain("useState<TransferChannel>('BANK')");
    expect(transferModalTsx).toContain('setChannel(option.id)');
  });

  it('offers the receipt upload with an image-only picker', () => {
    expect(html).toContain('id="transfer-proof-file"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp,image/gif"');
    expect(html).toContain('إرسال إشعار التحويل');
  });

  it('renders a modal dialog with an accessible name', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="transfer-payment-title"');
  });

  it('reuses the tenant brand tokens instead of hardcoding Mureeh gold', () => {
    expect(transferModalTsx).toContain('var(--brand-primary-strong)');
    expect(transferModalTsx).toContain('brand-cta');
    expect(transferModalTsx).not.toMatch(/#D4AF37|#E2C067/i);
  });
});

describe('guest modal — upload behaviour contracts', () => {
  it('reports real upload progress and blocks double submission', () => {
    // The progress setter is handed to the API call as its onProgress callback,
    // so a real percentage is rendered instead of a frozen button.
    expect(transferModalTsx).toContain('setProgress');
    expect(transferModalTsx).toContain('setProgress,');
    expect(transferModalTsx).toContain('useState(0)');
    expect(transferModalTsx).toContain('phase === \'uploading\'');
    expect(transferModalTsx).toContain('disabled={phase === \'uploading\'}');
    expect(transferModalTsx).toContain('aria-live="polite"');
    expect(transferModalTsx).toContain('{progress}%');
  });

  it('offers validation, success and retry states', () => {
    expect(transferModalTsx).toContain('يرجى إرفاق صورة إشعار التحويل');
    // The success state states the gate explicitly (required copy).
    expect(transferModalTsx).toContain('تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع.');
    expect(transferModalTsx).toContain('إعادة المحاولة');
    expect(transferModalTsx).toContain('role="alert"');
  });

  it('tells the guest the kitchen starts only after the cashier confirms', () => {
    expect(transferModalTsx).toContain('لا يبدأ المطبخ بتحضير الطلب قبل تأكيد الدفع');
    expect(transferModalTsx).toContain('بعد تأكيد الكاشير للعملية');
  });

  it('shrinks the photo with the existing shared pipeline', () => {
    expect(transferModalTsx).toContain("import { optimizeImageFile } from '../../utils/imageOptimize'");
    expect(transferModalTsx).toContain("optimizeImageFile(file, 'general')");
  });

  it('releases the preview object URL (no leaked file handles)', () => {
    expect(transferModalTsx).toContain('URL.revokeObjectURL');
    expect(transferModalTsx.match(/revokeObjectURL/g)!.length).toBeGreaterThanOrEqual(2);
  });
});

describe('order tracking — the guest always knows the payment state', () => {
  it('shows a pending, rejected and paid state on the order card', () => {
    expect(trackingDrawerTsx).toContain('isPaymentVerificationPending(order)');
    expect(trackingDrawerTsx).toContain('تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع.');
    expect(trackingDrawerTsx).toContain('order.paymentRejected');
    expect(trackingDrawerTsx).toContain('لم يتم التحقق من إشعار الحوالة');
    expect(trackingDrawerTsx).toContain("order.paymentStatus === 'PAID'");
    // The gate predicate itself lives in the client mirror of the server
    // policy the KDS/floor screens share (see utils/orderLifecycle).
    expect(orderLifecycleTs).toContain("order.fulfillmentState === 'PAYMENT_VERIFICATION_PENDING'");
    expect(orderLifecycleTs).toContain("order.paymentStatus === 'PENDING_VERIFICATION'");
  });

  it('carries the required payment-step copy of the gate flow', () => {
    expect(trackingDrawerTsx).toContain('تم إرسال طلبك، يرجى تأكيد عملية الدفع لإتمام الطلب.');
    expect(trackingDrawerTsx).toContain('تم تأكيد الدفع، وجارٍ تجهيز طلبك.');
  });

  it('prompts the guest to SEND the notice and explains the kitchen hold', () => {
    expect(trackingDrawerTsx).toContain('دفعت عبر البنك أو المحفظة؟ أرسل إشعار التحويل');
    expect(trackingDrawerTsx).toContain('يبقى الطلب محجوزاً عن');
    expect(trackingDrawerTsx).toContain('«جاهز للبدء»');
  });

  it('offers the transfer CTA only while the order is unsettled', () => {
    expect(trackingDrawerTsx).toContain("order.status !== 'CANCELLED' && order.paymentStatus !== 'PAID'");
    expect(trackingDrawerTsx).toContain('الدفع عبر حوالة بنكية');
    expect(trackingDrawerTsx).toContain('إرسال إشعار حوالة جديد');
    expect(trackingDrawerTsx).toContain('<TransferPaymentModal');
  });
});

describe('cashier verification panel', () => {
  it('is shown to cashier/manager only', () => {
    expect(verificationPanelTsx).toContain(
      "currentUser?.role === 'CASHIER' || currentUser?.role === 'RESTAURANT_MANAGER'"
    );
    expect(verificationPanelTsx).toContain('if (!canVerify) return null;');
  });

  it('shows order #, table, amount, method, name and phone for each pending receipt', () => {
    expect(verificationPanelTsx).toContain('item.numericId');
    expect(verificationPanelTsx).toContain('item.tableNumber');
    expect(verificationPanelTsx).toContain('formatPrice(item.total, currency)');
    expect(verificationPanelTsx).toContain('حوالة بنكية');
    expect(verificationPanelTsx).toContain('item.customerName');
    expect(verificationPanelTsx).toContain('item.customerPhone');
  });

  it('shows the ORDER ITSELF with the notice (items the transfer must cover)', () => {
    expect(verificationPanelTsx).toContain('openItem.items');
    expect(verificationPanelTsx).toContain('line.productName');
    expect(verificationPanelTsx).toContain('أصناف الطلب');
    // The cashier is told that confirming is what sends the order to the KDS.
    expect(verificationPanelTsx).toContain('لا يُرسل إلى المطبخ إلا بعد تأكيدك');
    expect(verificationPanelTsx).toContain('جاهز للبدء');
    expect(verificationPanelTsx).toContain('kitchenReleased');
  });

  it('loads the receipt through the authenticated API and frees it on close', () => {
    expect(verificationPanelTsx).toContain('api.fetchPaymentProofObjectUrl(tenantId, item.orderId)');
    expect(verificationPanelTsx).toContain('URL.revokeObjectURL');
    expect(verificationPanelTsx).toContain('proofLoading');
    expect(verificationPanelTsx).toContain('proofError');
  });

  it('confirms and rejects with a busy guard and race recovery', () => {
    expect(verificationPanelTsx).toContain('api.confirmTransferPayment(currentUser, tenantId, item.orderId)');
    expect(verificationPanelTsx).toContain('api.rejectTransferPayment(');
    expect(verificationPanelTsx).toContain('busyOrderId');
    expect(verificationPanelTsx).toContain('void loadQueue();');
  });

  it('refreshes from data events instead of opening its own polling loop', () => {
    expect(verificationPanelTsx).not.toContain('setInterval');
    expect(verificationPanelTsx).toContain('pendingKey');
    expect(verificationPanelTsx).toContain('orders');
  });
});

describe('cashier POS integration — a pending receipt is not collectable cash', () => {
  it('excludes PENDING_VERIFICATION from bills and from the collection payload', () => {
    expect(cashierPosTsx).toContain("o.paymentStatus !== 'PENDING_VERIFICATION'");
    expect(cashierPosTsx).toContain('isCollectable(o)');
    expect(cashierPosTsx).toContain('awaitingVerification');
  });

  it('tells the cashier why an order was left out of the collection', () => {
    expect(cashierPosTsx).toContain('طلبات بانتظار تحقق الحوالة');
  });

  it('mounts the verification panel above the table grid', () => {
    expect(cashierPosTsx).toContain("import { PaymentVerificationPanel } from './PaymentVerificationPanel'");
    expect(cashierPosTsx).toContain('<PaymentVerificationPanel />');
    expect(cashierPosTsx.indexOf('<PaymentVerificationPanel />')).toBeLessThan(
      cashierPosTsx.indexOf('RIGHT: TABLE & BILL CONTEXT')
    );
  });
});

describe('kitchen display — a transfer order cooks only after confirmation', () => {
  it('hides every order still held by the payment gate', () => {
    // The board renders the shared authorization predicate, never a local
    // payment-status guess: held orders are excluded and counted only.
    expect(kitchenDisplayTsx).toContain('isOrderOperational(o)');
    expect(kitchenDisplayTsx).toContain("o.status !== 'CANCELLED' && !isOrderOperational(o)");
    expect(kitchenDisplayTsx).toContain('heldForPayment.length');
  });

  it('never hides a ticket the kitchen already started', () => {
    // A release is terminal, so a ticket the kitchen picked up stays on the
    // board even if a receipt arrives mid-cooking; an unpaid PENDING ticket is
    // held until a cashier verifies the payment.
    const started = {
      status: 'PREPARING',
      paymentStatus: 'PENDING_VERIFICATION',
      fulfillmentState: 'RELEASED' as const,
    };
    expect(isOrderOperational(started)).toBe(true);
    expect(isOrderOperational({ ...started, status: 'READY' })).toBe(true);
    expect(
      isOrderOperational({ status: 'PENDING', paymentStatus: 'UNPAID', fulfillmentState: 'AWAITING_PAYMENT' })
    ).toBe(false);
    expect(isOrderOperational({ status: 'PENDING', paymentStatus: 'PENDING_VERIFICATION' })).toBe(false);
    expect(isOrderOperational({ status: 'PENDING', paymentStatus: 'PAID' })).toBe(true);
  });

  it('tells the kitchen why those orders are missing and when they appear', () => {
    expect(kitchenDisplayTsx).toContain('بانتظار تأكيد الكاشير');
    expect(kitchenDisplayTsx).toContain('جاهز للبدء');
  });

  it('flags a released (paid transfer) ticket as immediately cookable', () => {
    expect(kitchenDisplayTsx).toContain("order.paymentStatus === 'PAID' && order.paymentMethod === 'TRANSFER'");
    expect(kitchenDisplayTsx).toContain('جاهز للبدء فوراً');
  });
});

describe('API client contracts', () => {
  it('uploads the receipt to the guest endpoint with progress (no auth header)', () => {
    const method = apiTs.slice(
      apiTs.indexOf('public submitPaymentProof'),
      apiTs.indexOf('public async getPaymentVerifications')
    );
    expect(method).toContain('XMLHttpRequest');
    expect(method).toContain('xhr.upload.onprogress');
    expect(method).toContain('/public/orders/${encodeURIComponent(params.orderId)}/payment-proof');
    expect(method).toContain("form.append('proof'");
    // The guest identity travels with the file: name + mobile are required and
    // the channel is a BANK|WALLET hint (never an amount).
    expect(method).toContain("form.append('customerName', params.customerName)");
    expect(method).toContain("form.append('customerPhone', params.phone)");
    expect(method).toContain("form.append('transferChannel', params.channel || 'BANK')");
    // Guests are anonymous on this path: no Authorization header is attached.
    expect(method).not.toContain('getAuthHeader');
  });

  it('maps the queue, the receipt fetch and both decisions', () => {
    expect(apiTs).toContain('getPaymentVerifications');
    expect(apiTs).toContain('fetchPaymentProofObjectUrl');
    expect(apiTs).toContain('confirmTransferPayment');
    expect(apiTs).toContain('rejectTransferPayment');
    expect(apiTs).toContain('/manager/payment-verifications?${query.toString()}');
    expect(apiTs).toContain("query.set('include', 'awaiting')");
    expect(apiTs).toContain('/payment/confirm');
    expect(apiTs).toContain('/payment/reject');
    expect(apiTs).toContain('API_BASE}/manager/orders/${encodeURIComponent(orderId)}/payment-proof');
  });

  it('carries the private-state flags (never a path or a phone) into the domain model', () => {
    expect(apiTs).toContain('hasPaymentProof: Boolean(raw.hasPaymentProof)');
    expect(apiTs).toContain('paymentRejected: Boolean(raw.paymentRejected)');
    expect(apiTs).toContain('export function mapPaymentVerificationRow');
    // The queue row carries the verified identity + the order lines.
    expect(apiTs).toContain('customerName: raw.customerName');
    expect(apiTs).toContain('transferChannel: raw.transferChannel');
  });
});

describe('frontend state wiring', () => {
  it('requires the QR session before a receipt may be announced', () => {
    expect(contextTsx).toContain('submitTransferPaymentProof');
    expect(contextTsx).toContain('currentTableSession?.sessionToken');
    expect(contextTsx).toContain('لإرسال إشعار الحوالة يرجى مسح رمز QR');
  });

  it('carries the guest identity + channel through the context action', () => {
    expect(contextTsx).toContain('customerName: details.customerName.trim()');
    expect(contextTsx).toContain('phone: details.phone.trim()');
    expect(contextTsx).toContain('channel: details.channel');
    // The guest is told what happens next (cashier → kitchen).
    expect(contextTsx).toContain('سيبدأ المطبخ بتحضير طلبك فور التأكيد');
    // Placing an order prompts the guest to announce a bank/wallet transfer.
    expect(contextTsx).toContain('هل ستدفع بتحويل بنكي أو محفظة؟');
  });

  it('chimes the kitchen when a paid transfer ticket is released', () => {
    expect(contextTsx).toContain("data.status !== 'PENDING' || !data.kitchenReleased");
  });

  it('tells the guest when the cashier confirmed and cooking started', () => {
    expect(contextTsx).toContain('أُرسل طلبك إلى المطبخ فوراً بعد التحقق من إشعار التحويل.');
  });

  it('reacts to the three payment-proof SSE events on both streams', () => {
    for (const event of ['PAYMENT_PROOF_SUBMITTED', 'PAYMENT_PROOF_VERIFIED', 'PAYMENT_PROOF_REJECTED']) {
      expect(contextTsx).toContain(event);
    }
    // The staff toast is cashier/manager only.
    expect(contextTsx).toContain("currentUser?.role !== 'CASHIER'");
  });

  it('extends the existing payment model instead of adding a parallel one', () => {
    expect(typesTs).toContain("export type PaymentStatus = 'UNPAID' | 'PENDING_VERIFICATION' | 'PAID'");
    expect(typesTs).toContain('export interface PaymentVerificationItem');
    expect(typesTs).toContain('paymentStatus?: PaymentStatus');
    // One new ledger method label, reused from the existing label map.
    expect(read('src/services/analytics.ts')).toContain("TRANSFER: 'حوالة بنكية'");
  });
});
