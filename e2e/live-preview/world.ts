/**
 * LIVE PREVIEW — a runnable world for the payment fulfillment gate.
 *
 * WHAT THIS IS
 * ------------
 * The sandbox that generated this repository cannot reach binaries.prisma.sh
 * (no Prisma engine → no `prisma generate`) and has no PostgreSQL, so the real
 * Express server cannot boot here. This module therefore stands in for the
 * BACKEND ONLY, while everything a guest/cashier/kitchen actually touches stays
 * the real shipped code:
 *
 *   real:  React components, contexts, the API client (`src/services/api.ts`,
 *          including its XHR multipart upload), the SSE client helper, the
 *          language/UX copy, and — imported straight from the product —
 *          `server/services/orderLifecycle.ts` for every gate decision,
 *          `server/services/storage/imageSniff.ts` for the receipt validation
 *          and `server/validation/schemas.ts` is not needed (the client sends
 *          only what the schemas accept).
 *
 *   fake:  HTTP transport (an in-memory router that reproduces the routes'
 *          conditional-claim semantics, audit actions and SSE broadcasts),
 *          PostgreSQL, object storage, and the browser pieces jsdom lacks
 *          (EventSource, XMLHttpRequest, createObjectURL, image decoding).
 *
 * Every fake is a thin stand-in for behaviour that is pinned by the unit tests
 * (`src/tests/fulfillment-gate.test.ts`) against the real route source, so the
 * preview and the tests describe the same protocol.
 */

import {
  FULFILLMENT_STATE,
  RELEASE_REASON,
  isOperational,
  releaseFields,
} from '../../server/services/orderLifecycle';
import { sniffImage, isWithinUploadSizeLimit } from '../../server/services/storage/imageSniff';

// ============================================================================
// Fixtures — one tenant, one table, one menu, three devices
// ============================================================================

export const TENANT = {
  id: 'rest-live-preview',
  name: 'مطعم البريمير',
  nameEn: 'Premier Restaurant',
  slug: 'mureeh',
  currency: '₪',
  primaryColor: '#D4AF37',
  accentColor: '#0EA5E9',
  phone: '0599123456',
  address: 'شارع الاستقلال، رام الله',
};

export const TABLE = { id: 'table-7', number: 7, qrToken: 'qr-table-7' };
export const SESSION = { id: 'sess-live-preview', sessionToken: 'tok-live-preview' };

export const CASHIER = {
  id: 'user-cashier',
  name: 'سالم — كاشير',
  role: 'CASHIER' as const,
  restaurantId: TENANT.id,
  email: 'cashier@premier.test',
};
export const KITCHEN_STAFF = {
  id: 'user-kitchen',
  name: 'أمجد — مطبخ',
  role: 'KITCHEN' as const,
  restaurantId: TENANT.id,
  email: 'kitchen@premier.test',
};

export const MENU = {
  category: { id: 'cat-grill', name: 'المشاوي', nameEn: 'Grill', sortOrder: 1, restaurantId: TENANT.id },
  product: {
    id: 'prod-kabsa',
    restaurantId: TENANT.id,
    categoryId: 'cat-grill',
    name: 'كبسة لحم',
    nameEn: 'Lamb Kabsa',
    description: 'أرز بسمتي مع لحم الغنم الطازج',
    price: 68,
    isAvailable: true,
  },
};

// ============================================================================
// Transcript
// ============================================================================

export const transcript: string[] = [];

export function say(line: string): void {
  transcript.push(line);
  // Printed live so the run itself reads like a session log.
  console.log(line);
}

export function section(title: string): void {
  const line = `\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`;
  say(line);
}

// ============================================================================
// Server state
// ============================================================================

export type FulfillmentState = (typeof FULFILLMENT_STATE)[keyof typeof FULFILLMENT_STATE];

export interface OrderRow {
  id: string;
  numericId: number;
  restaurantId: string;
  tableId: string;
  tableNumber: number;
  sessionId: string;
  status: 'PENDING' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  paymentMethod: string;
  paymentStatus: 'UNPAID' | 'PENDING_VERIFICATION' | 'PAID';
  fulfillmentState: FulfillmentState;
  releasedAt: string | null;
  settledAt?: string | null;
  subtotal: number;
  total: number;
  customerName?: string;
  customerPhone?: string;
  transferChannel?: 'BANK' | 'WALLET';
  paymentProofPath?: string | null;
  paymentRejectedAt?: string | null;
  paymentRejectionReason?: string | null;
  items: Array<{
    id: string;
    productId: string;
    productNameSnapshot: string;
    quantity: number;
    priceSnapshot: number;
    totalPrice: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRow {
  id: string;
  receiptNumber: string;
  restaurantId: string;
  tableId: string;
  tableLabel: string;
  orderIds: string[];
  method: string;
  subtotal: number;
  total: number;
  cashierId: string;
  cashierName: string;
  note?: string;
  createdAt: string;
}

export interface AuditRow {
  action: string;
  metadata?: Record<string, unknown>;
  actor: string;
  entityId?: string;
}

export interface EmittedEvent {
  event: string;
  payload: Record<string, unknown>;
  deliveredTo: string;
}

interface FakeStream {
  url: string;
  kind: 'GUEST' | 'STAFF';
  tableId?: string;
  handlers: Record<string, Array<(event: MessageEvent) => void>>;
}

export interface HttpResult {
  status: number;
  json: Record<string, unknown>;
}

// ============================================================================
// The world
// ============================================================================

export function createWorld() {
  const state = {
    orders: new Map<string, OrderRow>(),
    payments: [] as PaymentRow[],
    audits: [] as AuditRow[],
    emitted: [] as EmittedEvent[],
    nextReceipt: 5001,
    nextNumericId: 1001,
    proofObjects: new Map<string, string>(),
  };
  const streams: FakeStream[] = [];

  // ---------------------------------------------------------------- helpers
  const audit = (action: string, metadata?: Record<string, unknown>, actor = 'النظام', entityId?: string) => {
    state.audits.push({ action, metadata, actor, entityId });
    say(`[audit]   ${action}${metadata ? ` ${JSON.stringify(metadata)}` : ''}`);
  };

  const emit = (event: string, payload: Record<string, unknown>) => {
    const tableId = payload.tableId as string | undefined;
    const targets = streams.filter(
      (stream) => stream.kind === 'STAFF' || (tableId && stream.tableId === tableId)
    );
    const audience = new Set<string>();
    for (const stream of targets) {
      audience.add(stream.kind === 'STAFF' ? 'staff' : 'guest');
      for (const handler of stream.handlers[event] || []) {
        handler(new MessageEvent(event, { data: JSON.stringify(payload) }));
      }
    }
    state.emitted.push({
      event,
      payload,
      deliveredTo: audience.size ? [...audience].join('+') : 'nobody listening',
    });
    say(`[sse]     ${event} → ${[...audience].join(' + ') || 'لا أحد يستمع'} ${JSON.stringify(payload)}`);
  };

  const findOrder = (id: string) => state.orders.get(id);

  const touch = (order: OrderRow) => {
    order.updatedAt = new Date().toISOString();
    return order;
  };

  // ------------------------------------------------------------- projections
  /** Guest tracker projection (server/routes/public.ts) — no phone, no path. */
  const guestOrderRow = (order: OrderRow) => ({
    id: order.id,
    numericId: order.numericId,
    restaurantId: order.restaurantId,
    tableId: order.tableId,
    sessionId: order.sessionId,
    subtotal: order.subtotal,
    total: order.total,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    hasPaymentProof: Boolean(order.paymentProofPath),
    paymentRejected: Boolean(order.paymentRejectedAt),
    paymentRejectedReason: order.paymentRejectionReason || undefined,
    fulfillmentState: order.fulfillmentState,
    releasedAt: order.releasedAt || undefined,
    notes: undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items,
  });

  /** Manager projection (server/routes/manager.ts) — adds the derived flag. */
  const managerOrderRow = (order: OrderRow) => ({
    ...guestOrderRow(order),
    tableNumber: order.tableNumber,
    tableName: 'الصالة الرئيسية',
    hasPaymentProof: Boolean(order.paymentProofPath),
    paymentRejectedAt: order.paymentRejectedAt || undefined,
    settledAt: order.settledAt || undefined,
    fulfillmentState: order.fulfillmentState,
    operational: isOperational(order.fulfillmentState),
    releasedAt: order.releasedAt || undefined,
    paymentRejectedReason: order.paymentRejectionReason || undefined,
  });

  /** Cashier queue projection — the only payload that carries the guest phone. */
  const verificationRow = (order: OrderRow, awaiting: boolean) => ({
    orderId: order.id,
    numericId: order.numericId,
    restaurantId: order.restaurantId,
    tableId: order.tableId,
    tableNumber: order.tableNumber,
    tableName: 'الصالة الرئيسية',
    orderStatus: order.status,
    total: order.total,
    subtotal: order.subtotal,
    itemsCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    itemsSummary: order.items.map((item) => `${item.productNameSnapshot} ×${item.quantity}`).join('، '),
    items: order.items.map((item) => ({
      productName: item.productNameSnapshot,
      quantity: item.quantity,
      unitPrice: item.priceSnapshot,
      totalPrice: item.totalPrice,
      selectedAddOns: [],
      removedIngredients: [],
    })),
    customerName: order.customerName || undefined,
    customerPhone: order.customerPhone || undefined,
    transferChannel: order.transferChannel || undefined,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    hasPaymentProof: Boolean(order.paymentProofPath),
    fulfillmentState: order.fulfillmentState,
    // The two cashier groups: a receipt to judge vs a guest who has not paid.
    state: order.paymentStatus === 'PENDING_VERIFICATION' ? 'WAITING_VERIFICATION' : 'WAITING_RECEIPT',
    paymentRejected: Boolean(order.paymentRejectedAt),
    paymentRejectedReason: order.paymentRejectionReason || undefined,
    submittedAt: order.updatedAt,
    createdAt: order.createdAt,
    awaitingGuestPayment: awaiting,
  });

  // ------------------------------------------------------------------ routes
  async function handle(
    rawUrl: string,
    method: string,
    rawBody: unknown,
    meta: { hasAuth: boolean }
  ): Promise<HttpResult> {
    const url = new URL(rawUrl, 'http://localhost:3000');
    const path = url.pathname.replace(/^\/api/, '');
    const query = url.searchParams;
    const body: any =
      rawBody instanceof FormData
        ? rawBody
        : typeof rawBody === 'string' && rawBody
          ? JSON.parse(rawBody)
          : (rawBody ?? {});

    const ok = (data: unknown, status = 200, extra: Record<string, unknown> = {}): HttpResult => ({
      status,
      json: { success: true, data, statusCode: status, ...extra },
    });
    const fail = (status: number, error: string): HttpResult => ({
      status,
      json: { success: false, error, statusCode: status },
    });

    say(`[http]    ${method} ${url.pathname}${url.search ? url.search : ''}${meta.hasAuth ? '  (Bearer ✓)' : ''}`);

    // ------------------------------------------------------------- auth
    if (path === '/auth/me') {
      const user = meta.hasAuth && cache.staffUser ? cache.staffUser : CASHIER;
      return ok({ user, restaurant: { ...TENANT } });
    }

    // ----------------------------------------------------- public catalog
    if (path === '/public/restaurants' && method === 'GET') {
      return ok({ restaurants: [{ ...TENANT }] });
    }

    if (/^\/public\/restaurants\/[^/]+$/.test(path) && method === 'GET') {
      // Mirror of the catalog route: the QR token decides whether the table
      // projection is included at all.
      const hasQr = Boolean(query.get('qrToken'));
      return ok({
        restaurant: { ...TENANT },
        categories: [MENU.category],
        products: [MENU.product],
        offers: [],
        tables: hasQr ? [{ id: TABLE.id, number: TABLE.number, restaurantId: TENANT.id }] : [],
      });
    }

    if (/^\/public\/tables\/qr\/[^/]+\/session$/.test(path) && method === 'POST') {
      return ok({
        sessionId: SESSION.id,
        sessionToken: SESSION.sessionToken,
        tableId: TABLE.id,
        tableNumber: TABLE.number,
        restaurant: { ...TENANT },
        expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      });
    }

    if (/^\/public\/tables\/[^/]+\/orders$/.test(path) && method === 'GET') {
      if (query.get('sessionToken') !== SESSION.sessionToken) return fail(403, 'جلسة QR غير صالحة أو منتهية الصلاحية');
      return ok([...state.orders.values()].filter((o) => o.sessionId === SESSION.id).map(guestOrderRow));
    }

    // -------------------------------------------------- guest: create order
    if (path === '/public/orders' && method === 'POST') {
      const numericId = state.nextNumericId++;
      const id = `#${numericId}`;
      const total = body.items.reduce(
        (sum: number, item: any) => sum + Number(item.unitPrice) * Number(item.quantity),
        0
      );
      const now = new Date().toISOString();
      const order: OrderRow = {
        id,
        numericId,
        restaurantId: TENANT.id,
        tableId: body.tableId,
        tableNumber: TABLE.number,
        sessionId: SESSION.id,
        status: 'PENDING',
        paymentMethod: 'PAY AT CASHIER',
        paymentStatus: 'UNPAID',
        // THE AUTHORIZATION BOUNDARY: the order is created OUTSIDE the
        // restaurant's operational workflow.
        fulfillmentState: FULFILLMENT_STATE.AWAITING_PAYMENT,
        releasedAt: null,
        subtotal: total,
        total,
        items: (body.items as any[]).map((item, index) => ({
          id: `item-${id}-${index}`,
          productId: item.productId,
          productNameSnapshot: item.productName,
          quantity: item.quantity,
          priceSnapshot: item.unitPrice,
          totalPrice: item.unitPrice * item.quantity,
        })),
        createdAt: now,
        updatedAt: now,
      };
      state.orders.set(order.id, order);
      audit('CUSTOMER_ORDER_CREATED', { fulfillmentState: order.fulfillmentState, previousFulfillmentState: null }, 'QR Guest', order.id);
      // NOT `ORDER_CREATED`: a guest submission is not a kitchen ticket.
      emit('ORDER_AWAITING_PAYMENT', {
        orderId: order.id,
        tableId: order.tableId,
        numericId: order.numericId,
        total: order.total,
        status: order.status,
        fulfillmentState: order.fulfillmentState,
        itemsCount: order.items.length,
      });
      return ok({ order: guestOrderRow(order) }, 201);
    }

    // -------------------------------------------- guest: cancel own order
    if (/^\/public\/orders\/[^/]+\/cancel$/.test(path) && method === 'POST') {
      const order = findOrder(decodeURIComponent(path.split('/')[3]));
      if (!order) return fail(404, 'الطلب غير موجود');
      if (order.paymentStatus === 'PAID') {
        return fail(409, 'تم تأكيد دفع هذا الطلب — يرجى التواصل مع طاقم المطعم للإلغاء.');
      }
      if (order.paymentStatus === 'PENDING_VERIFICATION') {
        return fail(409, 'إشعار الحوالة قيد التحقق من قبل الكاشير، لذلك لا يمكن إلغاء الطلب حالياً.');
      }
      if (order.status !== 'PENDING') {
        return fail(403, 'بدأ المطبخ بتحضير طلبك بالفعل، لذلك لم يعد بالإمكان تعديله أو إلغاؤه.');
      }
      touch(order);
      order.status = 'CANCELLED';
      emit('ORDER_CANCELLED', { orderId: order.id, tableId: order.tableId });
      return ok({ order: guestOrderRow(order), message: 'تم إلغاء الطلب بنجاح' });
    }

    // ------------------------------- guest: transfer receipt (multipart/XHR)
    if (/^\/public\/orders\/[^/]+\/payment-proof$/.test(path) && method === 'POST') {
      const order = findOrder(decodeURIComponent(path.split('/')[3]));
      if (!order) return fail(404, 'الطلب غير موجود');
      if (body.get('sessionToken') !== SESSION.sessionToken) {
        return fail(403, 'جلسة QR غير صالحة أو منتهية الصلاحية');
      }
      const file = body.get('proof') as File | null;
      if (!file) return fail(400, 'صورة الإشعار مطلوبة / الملف غير صالح');
      // REAL validation code, shared with the server route.
      if (!isWithinUploadSizeLimit(file.size)) {
        return fail(400, 'حجم صورة الإشعار كبير جداً (الحد الأقصى 5 ميجابايت)');
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const sniffed = sniffImage(bytes);
      if (!sniffed) return fail(400, 'الملف ليس صورة حقيقية بصيغة JPG أو PNG أو WEBP أو GIF');

      if (order.paymentStatus === 'PAID') {
        return fail(409, 'تم تأكيد دفع هذا الطلب مسبقاً.');
      }
      const now = new Date().toISOString();
      const proofKey = `restaurants/${TENANT.id}/payment-proofs/proof-${order.numericId}${sniffed.ext}`;
      state.proofObjects.set(proofKey, sniffed.mimeType);
      const previousGate = order.fulfillmentState;
      // The gate moves ONLY while it is still held: a receipt cannot re-hold a
      // ticket the kitchen already started.
      const gateUpdate = isOperational(order.fulfillmentState)
        ? {}
        : { fulfillmentState: FULFILLMENT_STATE.PAYMENT_VERIFICATION_PENDING as FulfillmentState };
      order.paymentProofPath = proofKey;
      order.paymentStatus = 'PENDING_VERIFICATION';
      order.customerName = String(body.get('customerName')).trim();
      order.customerPhone = String(body.get('customerPhone')).trim();
      order.transferChannel = body.get('transferChannel') === 'WALLET' ? 'WALLET' : 'BANK';
      order.paymentRejectedAt = null;
      order.paymentRejectionReason = null;
      Object.assign(order, gateUpdate);
      touch(order);
      audit(
        'PAYMENT_PROOF_SUBMITTED',
        {
          paymentEvent: 'PAYMENT_SUBMITTED',
          hasPhone: true,
          hasName: true,
          channel: order.transferChannel,
          previousFulfillmentState: previousGate,
          fulfillmentState: order.fulfillmentState,
          contentType: sniffed.mimeType,
        },
        'QR Guest',
        order.id
      );
      emit('PAYMENT_PROOF_SUBMITTED', {
        orderId: order.id,
        tableId: order.tableId,
        numericId: order.numericId,
        total: order.total,
        channel: order.transferChannel,
        at: now,
      });
      return ok({ order: guestOrderRow(order) }, 201);
    }

    // ------------------------------------------------ manager: order lists
    if (path === '/manager/orders' && method === 'GET') {
      const scope = query.get('operational');
      let rows = [...state.orders.values()];
      if (scope === 'true') rows = rows.filter((o) => isOperational(o.fulfillmentState));
      if (scope === 'false') rows = rows.filter((o) => !isOperational(o.fulfillmentState));
      return ok(rows.map(managerOrderRow));
    }

    if (path === '/manager/payment-verifications' && method === 'GET') {
      const includeAwaiting = query.get('include') === 'awaiting' || query.get('include') === 'all';
      const rows = [...state.orders.values()]
        .filter((o) => o.status !== 'CANCELLED')
        .filter(
          (o) =>
            o.paymentStatus === 'PENDING_VERIFICATION' ||
            (includeAwaiting &&
              (o.fulfillmentState === FULFILLMENT_STATE.AWAITING_PAYMENT ||
                o.fulfillmentState === FULFILLMENT_STATE.PAYMENT_REJECTED))
        )
        .map((o) => verificationRow(o, o.paymentStatus !== 'PENDING_VERIFICATION'));
      return ok(rows);
    }

    // ------------------------------------------------- manager: the receipt
    if (/^\/manager\/orders\/[^/]+\/payment-proof$/.test(path) && method === 'GET') {
      const order = findOrder(decodeURIComponent(path.split('/')[3]));
      if (!order?.paymentProofPath) return fail(404, 'إشعار الحوالة غير متوفر');
      return ok({ contentType: state.proofObjects.get(order.paymentProofPath) });
    }

    // ------------------------------------------------ manager: CONFIRM money
    if (/^\/manager\/orders\/[^/]+\/payment\/confirm$/.test(path) && method === 'POST') {
      const order = findOrder(decodeURIComponent(path.split('/')[3]));
      if (!order) return fail(404, 'الطلب غير موجود في هذا المطعم');
      if (order.status === 'CANCELLED') return fail(409, 'هذا الطلب ملغى ولا يمكن تأكيد دفعه.');
      if (order.paymentStatus === 'PAID') return fail(409, 'تم تأكيد دفع هذا الطلب مسبقاً.');
      if (order.paymentStatus !== 'PENDING_VERIFICATION') {
        return fail(409, 'لا يوجد إشعار حوالة بانتظار التحقق لهذا الطلب.');
      }
      if (!order.paymentProofPath) return fail(409, 'إشعار الحوالة غير متوفر لهذا الطلب.');

      const now = new Date().toISOString();
      const releasedStatus = order.status;
      const kitchenReleased = releasedStatus === 'PENDING';
      const previousFulfillmentState = order.fulfillmentState;

      // The real route runs ONE conditional updateMany inside a transaction;
      // the await below reproduces the interleaving of two concurrent
      // requests, so the second one loses the claim and gets the idempotent
      // replay (or a 409) — never a second receipt.
      await new Promise((resolve) => setTimeout(resolve, 5));

      const current = findOrder(order.id)!;
      if (current.paymentStatus !== 'PENDING_VERIFICATION') {
        if (current.paymentStatus === 'PAID') {
          const existing = state.payments.find((p) => p.orderIds.includes(current.id));
          say('[server]  lost the claim → PAID already: idempotent replay (no second receipt)');
          return {
            status: 200,
            json: {
              success: true,
              data: {
                payment: existing,
                orderId: current.id,
                orderStatus: current.status,
                kitchenReleased: current.status === 'PENDING',
                fulfillmentState: FULFILLMENT_STATE.RELEASED,
                alreadyConfirmed: true,
              },
              statusCode: 200,
            },
          };
        }
        return fail(409, 'تمت معالجة هذا الإشعار للتو من جهاز آخر. حدّث القائمة وحاول مجدداً.');
      }

      // MONEY + GATE in the same statement.
      Object.assign(current, releaseFields(new Date(now)), {
        paymentStatus: 'PAID' as const,
        paymentMethod: 'TRANSFER',
        settledAt: now,
        paymentRejectedAt: null,
        paymentRejectionReason: null,
        updatedAt: now,
      });
      const payment: PaymentRow = {
        id: `pay-${state.nextReceipt}`,
        receiptNumber: `R-${state.nextReceipt++}`,
        restaurantId: TENANT.id,
        tableId: current.tableId,
        tableLabel: `طاولة ${current.tableNumber}`,
        orderIds: [current.id],
        method: 'TRANSFER',
        subtotal: current.subtotal,
        total: current.total,
        cashierId: CASHIER.id,
        cashierName: CASHIER.name,
        note: 'تأكيد حوالة بنكية بعد التحقق من الإشعار',
        createdAt: now,
      };
      state.payments.push(payment);
      audit(
        'PAYMENT_VERIFIED',
        {
          paymentEvent: 'PAYMENT_CONFIRMED',
          method: 'TRANSFER',
          receiptNumber: payment.receiptNumber,
          kitchenReleased,
          orderId: current.id,
          paymentId: payment.id,
          previousFulfillmentState,
          fulfillmentState: FULFILLMENT_STATE.RELEASED,
        },
        CASHIER.name,
        current.id
      );
      audit(
        'ORDER_RELEASED_TO_KDS',
        {
          orderId: current.id,
          paymentId: payment.id,
          restaurantId: TENANT.id,
          previousFulfillmentState,
          fulfillmentState: FULFILLMENT_STATE.RELEASED,
          releaseReason: RELEASE_REASON.TRANSFER_VERIFIED,
          receiptNumber: payment.receiptNumber,
        },
        CASHIER.name,
        current.id
      );
      emit('PAYMENT_RECORDED', {
        receiptNumber: payment.receiptNumber,
        tableId: current.tableId,
        orderId: current.id,
        total: payment.total,
      });
      emit('ORDER_STATUS_UPDATED', {
        orderId: current.id,
        tableId: current.tableId,
        status: releasedStatus,
        kitchenReleased,
        paymentStatus: 'PAID',
      });
      emit('PAYMENT_PROOF_VERIFIED', {
        orderId: current.id,
        tableId: current.tableId,
        receiptNumber: payment.receiptNumber,
        kitchenReleased,
      });
      emit('ORDER_RELEASED_TO_KITCHEN', {
        orderId: current.id,
        tableId: current.tableId,
        numericId: current.numericId,
        total: current.total,
        orderStatus: releasedStatus,
        releasedAt: now,
        releaseReason: RELEASE_REASON.TRANSFER_VERIFIED,
      });
      return ok(
        {
          payment,
          orderId: current.id,
          orderStatus: releasedStatus,
          kitchenReleased,
          fulfillmentState: FULFILLMENT_STATE.RELEASED,
        },
        201
      );
    }

    // ------------------------------------------------- manager: REJECT money
    if (/^\/manager\/orders\/[^/]+\/payment\/reject$/.test(path) && method === 'POST') {
      const order = findOrder(decodeURIComponent(path.split('/')[3]));
      if (!order) return fail(404, 'الطلب غير موجود في هذا المطعم');
      if (order.paymentStatus === 'PAID') return fail(409, 'تم تأكيد دفع هذا الطلب مسبقاً — لا يمكن رفضه.');
      if (order.paymentStatus !== 'PENDING_VERIFICATION') {
        return fail(409, 'لا يوجد إشعار حوالة بانتظار التحقق لهذا الطلب.');
      }
      const previousFulfillmentState = order.fulfillmentState;
      const proofDeleted = Boolean(order.paymentProofPath);
      if (order.paymentProofPath) state.proofObjects.delete(order.paymentProofPath);
      const now = new Date().toISOString();
      Object.assign(order, {
        paymentStatus: 'UNPAID' as const,
        // The gate stays CLOSED and now says why.
        fulfillmentState: FULFILLMENT_STATE.PAYMENT_REJECTED as FulfillmentState,
        paymentRejectedAt: now,
        paymentRejectionReason: body.reason || 'لم يتم التحقق من إشعار الحوالة',
        paymentProofPath: proofDeleted ? null : order.paymentProofPath,
        updatedAt: now,
      });
      audit(
        'PAYMENT_REJECTED',
        {
          paymentEvent: 'PAYMENT_REJECTED',
          proofDeleted,
          orderId: order.id,
          restaurantId: TENANT.id,
          previousFulfillmentState,
          fulfillmentState: FULFILLMENT_STATE.PAYMENT_REJECTED,
        },
        CASHIER.name,
        order.id
      );
      emit('PAYMENT_PROOF_REJECTED', {
        orderId: order.id,
        tableId: order.tableId,
        reason: body.reason || undefined,
      });
      return ok({
        orderId: order.id,
        paymentStatus: 'UNPAID',
        fulfillmentState: FULFILLMENT_STATE.PAYMENT_REJECTED,
        proofDeleted,
      });
    }

    // ------------------------------------- manager: kitchen status advance
    if (/^\/manager\/orders\/[^/]+\/status$/.test(path) && method === 'PUT') {
      const order = findOrder(decodeURIComponent(path.split('/')[3]));
      if (!order) return fail(404, 'الطلب غير موجود في هذا المطعم');
      const requested = body.status as OrderRow['status'];
      // Server-enforced gate (not a UI filter).
      if (requested !== 'CANCELLED' && !isOperational(order.fulfillmentState)) {
        say('[server]  refused: the order is still held by the payment gate');
        return fail(409, 'هذا الطلب بانتظار التحقق من الدفع من قبل الكاشير — لا يمكن بدء تحضيره قبل تأكيد الدفع.');
      }
      const next: Record<string, OrderRow['status']> = {
        PENDING: 'PREPARING',
        PREPARING: 'READY',
        READY: 'SERVED',
      };
      if (next[order.status] !== requested) {
        return fail(409, `انتقال حالة غير صالح من ${order.status} إلى ${requested}`);
      }
      order.status = requested;
      touch(order);
      emit('ORDER_STATUS_UPDATED', { orderId: order.id, tableId: order.tableId, status: order.status });
      return ok({ order: managerOrderRow(order) });
    }

    // ------------------------------------------- manager: supporting lists
    if (path === '/manager/menu/categories' && method === 'GET') return ok({ categories: [MENU.category] });
    if (path === '/manager/menu/products' && method === 'GET') return ok({ products: [MENU.product] });
    if (path === '/manager/tables' && method === 'GET') {
      return ok([{ id: TABLE.id, number: TABLE.number, restaurantId: TENANT.id, status: 'OCCUPIED' }]);
    }
    if (path === '/manager/waiter-requests' && method === 'GET') return ok([]);
    if (path === '/manager/offers' && method === 'GET') return ok([]);
    if (path === '/manager/payments' && method === 'GET') return ok(state.payments);
    if (path === '/manager/branches' && method === 'GET') return ok([]);
    if (path === '/manager/subscription' && method === 'GET') return ok({ subscription: null, plans: [] });

    say(`[http]    404 — no fake route for ${method} ${path}`);
    return fail(404, `no fake route for ${method} ${path}`);
  }

  const cache: { staffUser: typeof CASHIER | typeof KITCHEN_STAFF | null } = { staffUser: null };

  // ------------------------------------------------------------------ shims
  class FakeEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readyState = 1;
    private handlers: Record<string, Array<(event: MessageEvent) => void>> = {};

    constructor(public url: string) {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const kind: 'GUEST' | 'STAFF' = params.has('token') ? 'STAFF' : 'GUEST';
      streams.push({ url, kind, tableId: params.get('tableId') || undefined, handlers: this.handlers });
      say(`[sse]     stream opened (${kind === 'STAFF' ? 'staff/tenant' : `guest/table ${params.get('tableId')}`})`);
      setTimeout(() => this.onopen?.(), 0);
    }

    addEventListener(name: string, handler: (event: MessageEvent) => void) {
      (this.handlers[name] ||= []).push(handler);
    }

    close() {
      this.readyState = FakeEventSource.CLOSED;
    }
  }

  class FakeXMLHttpRequest {
    status = 0;
    responseText = '';
    timeout = 0;
    upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private method = '';
    private url = '';

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader() {
      /* the guest upload is anonymous by design */
    }

    send(body: FormData) {
      void (async () => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
        const result = await handle(this.url, this.method, body, { hasAuth: false });
        this.status = result.status;
        this.responseText = JSON.stringify(result.json);
        setTimeout(() => this.onload?.(), 0);
      })();
    }
  }

  const response = (result: HttpResult) => ({
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    headers: { get: () => 'application/json' },
    json: async () => result.json,
    text: async () => JSON.stringify(result.json),
    // The receipt bytes themselves (the panel only needs a Blob for the
    // object URL it renders in an <img>).
    blob: async () => new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }),
  });

  /** Install every browser/server shim the preview needs. */
  function install() {
    const g = globalThis as any;

    g.fetch = async (input: string | URL, init: any = {}) => {
      const url = typeof input === 'string' ? input : input.toString();
      const headers = (init?.headers || {}) as Record<string, string>;
      const hasAuth = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
      return response(await handle(url, init?.method || 'GET', init?.body, { hasAuth }));
    };

    g.XMLHttpRequest = FakeXMLHttpRequest;
    g.EventSource = FakeEventSource;
    g.IS_REACT_ACT_ENVIRONMENT = true;

    // jsdom implements neither of these (the app calls them for image previews
    // and for the receipt object URL).
    const urlApi = URL as any;
    urlApi.createObjectURL = () => 'blob:live-preview-object';
    urlApi.revokeObjectURL = () => undefined;

    // `optimizeImageFile` decodes the picked image first; this stand-in lets
    // the real modal submit path run (the canvas step degrades to a passthrough
    // in jsdom, so the original bytes are uploaded — exactly what the real
    // pipeline does when re-encoding would not shrink the file).
    g.Image = class FakeImage {
      naturalWidth = 800;
      naturalHeight = 600;
      width = 800;
      height = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    };
  }

  return {
    state,
    streams,
    install,
    handle,
    emit,
    audit,
    guestOrderRow,
    managerOrderRow,
    verificationRow,
    /** Switch the authenticated staff identity the fake JWT resolves to. */
    setStaffUser(user: typeof CASHIER | typeof KITCHEN_STAFF | null) {
      cache.staffUser = user;
    },
    reset() {
      state.orders.clear();
      state.payments.length = 0;
      state.audits.length = 0;
      state.emitted.length = 0;
      state.proofObjects.clear();
      state.nextNumericId = 1001;
      state.nextReceipt = 5001;
      streams.length = 0;
      transcript.length = 0;
    },
  };
}

export type World = ReturnType<typeof createWorld>;

/** Real PNG header + padding: what a receipt upload from a phone looks like. */
export function receiptFile(name = 'transfer-receipt.png'): File {
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  return new File([png], name, { type: 'image/png' });
}

export const formatAuditTrail = (world: World) =>
  world.state.audits
    .map((row, index) => `${String(index + 1).padStart(2, '0')}. ${row.action} ${JSON.stringify(row.metadata ?? {})}`)
    .join('\n');
