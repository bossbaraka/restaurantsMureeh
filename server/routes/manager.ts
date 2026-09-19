import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma';
import { config } from '../config';
import {
  requireAuth,
  requireTenantAccess,
  requireManager,
  requireCashierOrManager,
  requireServiceStaff,
  requireStepUp,
  isPlatformUser,
} from '../middleware/auth';
import { realtimeService } from '../services/realtime';
import {
  FREE_TRIAL_DAYS,
  isTrialPlan,
  withTrialMeta,
  evaluatePlanChange,
  effectiveSubscriptionState,
} from '../services/plans';
import { logAuditEvent } from '../services/audit';
import {
  getStorage,
  deleteManagedAssets,
  assetNormalizerFor,
  assetUrlResolverFor,
  normalizeAssetReference,
  resolveRestaurantAssets,
  isStorageKey,
  keyBelongsToRestaurant,
  type NormalizedAsset,
} from '../services/storage';
import {
  discardPaymentProof,
  loadPaymentProof,
  proofBelongsToTenant,
  isAwaitingVerification,
  transferChannelLabel,
  TRANSFER_PAYMENT_METHOD,
  PAYMENT_STATUS,
} from '../services/paymentProofs';
import {
  FULFILLMENT_STATE,
  RELEASE_REASON,
  isOperational,
  normalizeFulfillmentState,
  releaseFields,
} from '../services/orderLifecycle';
import {
  evaluateStaffCancellation,
  evaluatePaymentVoid,
  canPerformStaffCancellation,
  CANCELLATION_AUTO_REJECT_REASON,
} from '../services/orderCancellation';
import {
  OPERATIONS_LIVE_TAKE,
  OPERATIONS_HISTORY_TAKE,
  parseClosedWindowHours,
  buildManagerOrderLiveWhere,
  buildManagerOrderHistoryWhere,
  assembleOperationsOrders,
} from '../services/orderVisibility';
import { canReadQrToken, serializeStaffTable } from '../services/tableSerialization';
import { generateQrToken, csvField, roundMoney, parsePagination, reconcileCashPayment } from '../utils/security';
import { normalizeWhatsappNumber } from '../utils/contactChannels';

/**
 * The shape the till needs from an order that ONLY the cash collection
 * releases (it was held by the payment gate until this moment). Declared
 * structurally so the two collection paths spell out what they touch.
 */
type CollectionReleasedOrder = {
  id: string;
  numericId: number;
  total: number;
  status: string;
  fulfillmentState: string | null;
};
import { startOfDayInTimezone } from '../utils/datetime';
import {
  paymentLimiter,
  paymentProofReadLimiter,
  orderStatusLimiter,
  staffMutationLimiter,
} from '../middleware/rateLimit';
import {
  validateBody,
  posOrderSchema,
  orderStatusSchema,
  waiterStatusSchema,
  tableCreateSchema,
  tableUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
  staffCreateSchema,
  staffUpdateSchema,
  offerCreateSchema,
  offerUpdateSchema,
  planChangeSchema,
  tableSettleSchema,
  brandingSchema,
  CONTACT_CHANNEL_FIELDS,
  branchCreateSchema,
  branchUpdateSchema,
  assignTablesSchema,
  paymentCreateSchema,
  paymentConfirmSchema,
  paymentRejectSchema,
  paymentVoidSchema,
} from '../validation/schemas';
import bcrypt from 'bcryptjs';
import { OrderStatus, TableZone, TableStatus, TenantRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

const router = Router();

// ============================================================
// Tenant resolution + ownership helpers
// ------------------------------------------------------------
// Non-platform actors ALWAYS resolve to their own JWT tenant —
// query/body restaurantId values are untrusted hints that can only
// narrow nothing and escalate nowhere. Platform admins resolve to
// the explicitly requested tenant (query first, then body).
// ============================================================

function getTenantId(req: Request): string | undefined {
  if (isPlatformUser(req)) {
    return (
      (req.query.restaurantId as string) ||
      req.body?.restaurantId ||
      req.user?.restaurantId ||
      undefined
    );
  }
  return req.user?.restaurantId || undefined;
}

function ownTenant(
  req: Request,
  restaurantId: string | null | undefined
): boolean {
  return (
    !!restaurantId && (isPlatformUser(req) || req.user!.restaurantId === restaurantId)
  );
}

function deny(
  req: Request,
  res: Response,
  msg = 'غير مصرح لك بالوصول لبيانات هذا المطعم (Tenant Isolation Violation)'
) {
  // Best-effort audit of denied cross-tenant attempts (never blocks).
  if (req.user) {
    logAuditEvent({
      restaurantId: req.user.restaurantId,
      userId: req.user.id,
      actor: req.user.name,
      actorRole: req.user.role,
      action: 'TENANT_ACCESS_DENIED',
      details: `محاولة وصول مرفوضة عبر ${req.method} ${req.path}: ${msg}`,
      ipAddress: req.ip,
    }).catch(() => undefined);
  }
  return res.status(403).json({ success: false, error: msg, statusCode: 403 });
}

// ---------- Plan limits + entitlements (server-enforced) ----------

// Fallback when a tenant has no usable subscription: the most restrictive
// (free-trial) limits. Every real tenant gets a subscription at onboarding, so
// this path only exists to stop an orphaned row from growing without a plan.
const FREE_LIMITS = { maxTables: 8, maxCategories: 3, maxProducts: 15, maxBranches: 1 };

async function getPlanLimits(restaurantId: string): Promise<typeof FREE_LIMITS> {
  const subscription = await prisma.subscription.findUnique({
    where: { restaurantId },
    include: { plan: true },
  });
  // Effective period state: a row still marked ACTIVE/TRIAL after its period
  // end (e.g. scheduler never ran) must not keep unlocking paid quotas.
  const state = effectiveSubscriptionState(subscription);
  if (
    !subscription ||
    !state.entitled ||
    !subscription.plan ||
    subscription.plan.status !== 'ACTIVE'
  ) {
    return { ...FREE_LIMITS };
  }
  return {
    maxTables: subscription.plan.maxTables,
    maxCategories: subscription.plan.maxCategories,
    maxProducts: subscription.plan.maxProducts,
    maxBranches: subscription.plan.maxBranches,
  };
}

async function restaurantHasEntitlement(
  restaurantId: string,
  key: string
): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({
    where: { restaurantId },
    include: { plan: true },
  });
  const state = effectiveSubscriptionState(subscription);
  return (
    !!subscription &&
    state.entitled &&
    !!subscription.plan &&
    subscription.plan.status === 'ACTIVE' &&
    subscription.plan.entitlements.includes(key)
  );
}

// ----------------------------------------------------------------------------

router.use(requireAuth);

// Menu reads stay tenant-scoped (defense in depth alongside per-row checks).
router.use('/menu', requireTenantAccess((req) => getTenantId(req)));

// GET /api/manager/dashboard/stats — revenue/subscription analytics: managers
// only. Staff roles must not read tenant financial KPIs (role matrix).
router.get('/dashboard/stats', requireManager(), async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: 'restaurantId is required', statusCode: 400 });
    }

    // Verify tenant access
    if (!ownTenant(req, restaurantId)) return deny(req, res);

    // Analytics KPIs are a paid entitlement: this endpoint is the one place
    // that can leak revenue/AOV figures, so it is gated server-side (not just
    // in the Analytics tab's UI lock screen).
    if (
      !isPlatformUser(req) &&
      !(await restaurantHasEntitlement(restaurantId, 'CAN_USE_ANALYTICS'))
    ) {
      return res.status(403).json({
        success: false,
        error: 'التحليلات ومؤشرات المبيعات متاحة في باقة المحترفين والمؤسسات. قم بالترقية للمتابعة.',
        statusCode: 403,
      });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
    });

    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'المطعم غير موجود', statusCode: 404 });
    }

    // All-time revenue / order KPIs are aggregated INSIDE PostgreSQL (the
    // previous implementation pulled every order + order-item row into Node
    // and reduced in process — unbounded memory/latency growth as the tenant
    // traded). Cancelled orders never count as revenue.
    const settledOrderWhere = {
      restaurantId,
      status: { not: 'CANCELLED' as const },
    };

    const [allTimeAgg, todayAgg] = await Promise.all([
      prisma.order.aggregate({
        where: settledOrderWhere,
        _sum: { total: true },
        _avg: { total: true },
        _count: { _all: true },
      }),
      // todayOrdersCount must mean orders created during the restaurant's
      // CURRENT local day — not the lifetime order total it previously held.
      prisma.order.aggregate({
        where: {
          ...settledOrderWhere,
          createdAt: { gte: startOfDayInTimezone(new Date(), restaurant.timezone) },
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);

    const totalRevenue = roundMoney(allTimeAgg._sum.total ?? 0);
    const allTimeOrdersCount = allTimeAgg._count._all;
    const todayOrdersCount = todayAgg._count._all;
    const todayRevenue = roundMoney(todayAgg._sum.total ?? 0);
    const averageOrderValue = allTimeOrdersCount > 0
      ? Math.round(totalRevenue / allTimeOrdersCount)
      : 0;

    // Kitchen workload = RELEASED work only. A guest order the payment gate is
    // still holding is not a ticket, so counting it as «new/preparing/ready»
    // would advertise pending kitchen work for money nobody has verified (and
    // make the dashboard disagree with the KDS, which filters on the same
    // predicate). `heldForPaymentCount` reports that held set as what it is:
    // the cashier's queue, not the kitchen's.
    const kitchenOrderWhere = (status: string) => ({
      restaurantId,
      status,
      fulfillmentState: FULFILLMENT_STATE.RELEASED,
    });
    const [pendingOrdersCount, preparingOrdersCount, readyOrdersCount,
      heldForPaymentCount, totalTablesCount, activeTablesCount, pendingWaitersCount] = await Promise.all([
      prisma.order.count({ where: kitchenOrderWhere('PENDING') }),
      prisma.order.count({ where: kitchenOrderWhere('PREPARING') }),
      prisma.order.count({ where: kitchenOrderWhere('READY') }),
      prisma.order.count({
        where: {
          restaurantId,
          status: { not: 'CANCELLED' },
          fulfillmentState: { not: FULFILLMENT_STATE.RELEASED },
        },
      }),
      prisma.table.count({ where: { restaurantId } }),
      prisma.table.count({
        where: { restaurantId, status: { in: ['OCCUPIED', 'BILL_REQUESTED'] } },
      }),
      prisma.waiterRequest.count({ where: { restaurantId, status: 'PENDING' } }),
    ]);

    // Popular products: GROUP BY the snapshot name inside the database and
    // return only the top 5 — no full order-item scan into Node.
    const popularRows = await prisma.orderItem.groupBy({
      by: ['productNameSnapshot'],
      where: { order: { restaurantId, status: { not: 'CANCELLED' } } },
      _sum: { quantity: true, totalPrice: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    });
    const popularProducts = popularRows
      .filter((r) => r.productNameSnapshot)
      .map((r) => ({
        name: r.productNameSnapshot,
        count: r._sum.quantity ?? 0,
        revenue: roundMoney(r._sum.totalPrice ?? 0),
      }));

    const dashboardRestaurant = resolveRestaurantAssets(
      restaurant,
      assetNormalizerFor(getStorage()),
      assetUrlResolverFor(getStorage(), config.appUrl)
    );
    return res.json({
      success: true,
      data: {
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          nameEn: restaurant.nameEn,
          slug: restaurant.slug,
          logo: dashboardRestaurant.logoUrl,
          coverImage: dashboardRestaurant.coverImageUrl,
          logoStoragePath: dashboardRestaurant.logoStoragePath,
          coverStoragePath: dashboardRestaurant.coverStoragePath,
          currency: restaurant.currency,
          primaryColor: restaurant.primaryColor,
          accentColor: restaurant.accentColor,
          // Remaining branding state so a dashboard load never replaces a
          // complete restaurant object with one missing these fields.
          description: restaurant.description,
          phone: restaurant.phone,
          address: restaurant.address,
          logoFit: restaurant.logoFit,
          logoPosition: restaurant.logoPosition,
          businessType: restaurant.businessType,
          galleryImages: dashboardRestaurant.galleryImages,
          galleryStoragePaths: dashboardRestaurant.galleryStoragePaths,
          mapImageUrl: dashboardRestaurant.mapImageUrl,
          mapStoragePath: dashboardRestaurant.mapStoragePath,
          promoVideoUrl: restaurant.promoVideoUrl,
        },
        subscription: restaurant.subscription,
        plan: restaurant.subscription?.plan,
        totalRevenue,
        todayRevenue,
        todayOrdersCount,
        activeTablesCount,
        totalTablesCount,
        pendingOrdersCount,
        preparingOrdersCount,
        readyOrdersCount,
        // Orders the payment gate is holding (never kitchen work, always the
        // cashier's queue): the manager sees the number, not the tickets.
        heldForPaymentCount,
        pendingWaitersCount,
        averageOrderValue,
        popularProducts,
      },
      statusCode: 200,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(500).json({ success: false, error: 'تعذر استرجاع إحصائيات لوحة التحكم', statusCode: 500 });
  }
});

// GET /api/manager/orders — paginated (M-01 DoS hardening, capped at 100)
type ManagerOrderRow = Prisma.OrderGetPayload<{ include: { items: true; table: true } }>;

function formatManagerOrderRow(o: ManagerOrderRow) {
  return {
    id: o.id,
    numericId: o.numericId,
    restaurantId: o.restaurantId,
    tableId: o.tableId,
    tableNumber: o.table?.number,
    tableName: o.table?.name || undefined,
    // 'TABLE' (QR/table service) or 'COUNTER' (POS walk-in, tableId NULL).
    orderSource: o.orderSource,
    sessionId: o.sessionId || undefined,
    subtotal: o.subtotal,
    total: o.total,
    status: o.status,
    paymentMethod: o.paymentMethod,
    // Settlement state of the order (UNPAID | PENDING_VERIFICATION | PAID).
    // Without it the cashier screen could not tell a bill awaiting transfer
    // verification from a plain unpaid bill — and could not exclude it from
    // a cash collection. The guest phone is intentionally NOT exposed here:
    // it is only returned by the cashier verification queue.
    paymentStatus: o.paymentStatus,
    hasPaymentProof: Boolean(o.paymentProofPath),
    paymentRejectedAt: o.paymentRejectedAt?.toISOString(),
    // A held order must be explainable where it is absent: the operational
    // screens show "rejected — the guest must act" instead of silently
    // dropping the ticket. Derived from the stored marker, never from the
    // gate value the client sends (there is no such thing).
    paymentRejected: Boolean(o.paymentRejectedAt),
    paymentRejectedReason: o.paymentRejectionReason || undefined,
    settledAt: o.settledAt?.toISOString(),
    // Payment authorization boundary, computed HERE (never from the client):
    // `fulfillmentState` is the stored gate and `operational` is the single
    // predicate the KDS/floor screens may act on.
    fulfillmentState: normalizeFulfillmentState(o.fulfillmentState),
    operational: isOperational(o.fulfillmentState),
    releasedAt: o.releasedAt?.toISOString(),
    // Staff cancellation markers (audit H-02) — when/why. The cancelling
    // user id stays server-side; the AuditLog carries the actor.
    cancelledAt: o.cancelledAt?.toISOString(),
    cancelReason: o.cancelReason || undefined,
    notes: o.notes || undefined,
    estimatedPrepMinutes: o.estimatedPrepMinutes ?? undefined,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productNameSnapshot,
      productNameEn: i.productNameEnSnapshot || undefined,
      unitPrice: i.priceSnapshot,
      quantity: i.quantity,
      totalPrice: i.totalPrice,
      selectedSize: i.selectedSize || undefined,
      selectedAddOns: i.selectedAddOns,
      removedIngredients: i.removedIngredients,
      specialInstructions: i.specialInstructions || undefined,
    })),
  };
}

router.get('/orders', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

    if (!ownTenant(req, restaurantId)) return deny(req, res);

    const { take, skip } = parsePagination(req.query as Record<string, unknown>);
    // Optional server-side scope for the operational screens: `?operational=true`
    // returns only orders whose payment was verified (the KDS/floor set), while
    // `?operational=false` returns exactly the held ones (the cashier's
    // "waiting for payment" list). Absent/other values keep the historical
    // "all orders" behaviour for existing clients.
    const operationalParam = req.query.operational;
    const operationalFilter =
      operationalParam === 'true' || operationalParam === '1'
        ? { operationalOnly: true }
        : operationalParam === 'false' || operationalParam === '0'
          ? { operationalOnly: false }
          : null;

    // ---------------------------------------------------------------------
    // OPERATIONAL VISIBILITY SCOPE (audit H-03).
    //
    // The historical default — "the N newest orders" — silently dropped any
    // live order older than the pagination window: in a busy shift a PENDING
    // ticket placed early vanished from the kitchen once 50 newer orders
    // existed. Instead of raising the limit, `scope=operations` queries the
    // domain sets the screens actually need (see services/orderVisibility):
    //
    //   1. LIVE: not-cancelled AND not-(served AND paid), ANY age, oldest
    //      first — the oldest unattended ticket is always reachable;
    //   2. RECENTLY-CLOSED: cancelled/settled rows updated within a bounded
    //      sliding window (default 24h, max 72h), newest first — for the
    //      history/cancelled tabs and the cashier's recent receipts.
    //
    // Truncation can only ever touch the history set, and it is REPORTED via
    // `meta.*HasMore` instead of being silent.
    // ---------------------------------------------------------------------
    if (req.query.scope === 'operations') {
      const closedHours = parseClosedWindowHours(req.query.closedHours);
      const now = new Date();
      const liveWhere = buildManagerOrderLiveWhere(restaurantId);
      const historyWhere = buildManagerOrderHistoryWhere(restaurantId, now, closedHours);
      const include = { items: true, table: true } as const;

      const [liveTotal, live, historyTotal, history] = await Promise.all([
        prisma.order.count({ where: liveWhere }),
        prisma.order.findMany({
          where: liveWhere,
          include,
          orderBy: { createdAt: 'asc' },
          take: OPERATIONS_LIVE_TAKE,
        }),
        prisma.order.count({ where: historyWhere }),
        prisma.order.findMany({
          where: historyWhere,
          include,
          orderBy: { updatedAt: 'desc' },
          take: OPERATIONS_HISTORY_TAKE,
        }),
      ]);

      const merged = assembleOperationsOrders(live, history);
      return res.json({
        success: true,
        data: merged.map(formatManagerOrderRow),
        meta: {
          scope: 'operations',
          liveCount: live.length,
          liveTotal,
          liveHasMore: liveTotal > live.length,
          historyCount: history.length,
          historyTotal,
          historyHasMore: historyTotal > history.length,
          closedWindowHours: closedHours,
        },
        statusCode: 200,
      });
    }

    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        ...(operationalFilter
          ? {
              fulfillmentState: operationalFilter.operationalOnly
                ? FULFILLMENT_STATE.RELEASED
                : { not: FULFILLMENT_STATE.RELEASED },
            }
          : {}),
      },
      include: {
        items: true,
        table: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    const formatted = orders.map(formatManagerOrderRow);

    return res.json({ success: true, data: formatted, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع الطلبات', statusCode: 500 });
  }
});

// POST /api/manager/orders — POS / counter order placed by tenant staff
// (manager/cashier). Server re-prices every item from the tenant's own menu.
router.post(
  '/orders',
  requireCashierOrManager(),
  validateBody(posOrderSchema),
  async (req: Request, res: Response) => {
    try {
      const restaurantId = getTenantId(req);
      if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);

      const { tableId, items, notes, clientRequestId } = req.body as {
        tableId: string;
        items: Array<{
          productId: string;
          quantity?: number;
          removedIngredients?: string[];
          specialInstructions?: string;
          notes?: string;
        }>;
        notes?: string;
        clientRequestId?: string;
      };
      // Optional only for rolling compatibility with already-open POS clients.
      // Current clients always supply one stable UUID per logical checkout.
      const effectiveClientRequestId = clientRequestId || randomUUID();

      const isWalkIn = tableId === '__WALKIN__';
      // '__WALKIN__' is an INPUT sentinel only — never persisted. Counter
      // orders are represented properly: tableId NULL + orderSource COUNTER
      // (the old code passed the literal straight into the Order→Table FK
      // and 500'd — P1-A).
      const effectiveTableId: string | null = isWalkIn ? null : tableId;
      if (!isWalkIn) {
        const table = await prisma.table.findUnique({ where: { id: tableId } });
        if (!table || table.restaurantId !== restaurantId) {
          return res.status(404).json({ success: false, error: 'الطاولة غير موجودة في هذا المطعم', statusCode: 404 });
        }
      }

      const productIds = [...new Set(items.map((item) => item.productId))];
      const products = await prisma.product.findMany({
        where: { restaurantId, id: { in: productIds } },
      });
      if (products.length !== productIds.length) {
        return res.status(400).json({ success: false, error: 'يحتوي الطلب على طبق غير صالح لهذا المطعم', statusCode: 400 });
      }
      const unavailable = products.find((p) => !p.available);
      if (unavailable) {
        return res.status(400).json({ success: false, error: `الطبق "${unavailable.name}" غير متوفر حالياً`, statusCode: 400 });
      }
      const productMap = new Map(products.map((product) => [product.id, product]));

      const pricedItems = items.map((item) => {
        const product = productMap.get(item.productId)!;
        const quantity =
          Number.isInteger(item.quantity) && (item.quantity as number) > 0
            ? Math.min(item.quantity as number, 50)
            : 1;
        const unitPrice = roundMoney(product.price);
        return {
          productId: product.id,
          productNameSnapshot: product.name,
          productNameEnSnapshot: product.nameEn || undefined,
          priceSnapshot: unitPrice,
          quantity,
          selectedAddOns: [] as string[],
          removedIngredients: item.removedIngredients || [],
          specialInstructions: item.specialInstructions || item.notes || undefined,
          totalPrice: roundMoney(unitPrice * quantity),
        };
      });
      const subtotal = roundMoney(pricedItems.reduce((sum, item) => sum + item.totalPrice, 0));

      const isSameLogicalRequest = (order: {
        tableId: string | null;
        notes: string | null;
        items: Array<{
          productId: string | null;
          quantity: number;
          removedIngredients: string[];
          specialInstructions: string | null;
        }>;
      }) =>
        order.tableId === effectiveTableId &&
        (order.notes || '') === (notes || '') &&
        order.items.length === pricedItems.length &&
        order.items.every((saved, index) => {
          const requested = pricedItems[index];
          return saved.productId === requested.productId &&
            saved.quantity === requested.quantity &&
            JSON.stringify(saved.removedIngredients) === JSON.stringify(requested.removedIngredients) &&
            (saved.specialInstructions || '') === (requested.specialInstructions || '');
        });

      const findReplay = () => prisma.order.findUnique({
        where: {
          restaurantId_clientRequestId: {
            restaurantId,
            clientRequestId: effectiveClientRequestId,
          },
        },
        include: { items: true },
      });

      const existingRequest = await findReplay();
      if (existingRequest) {
        if (!isSameLogicalRequest(existingRequest)) {
          return res.status(409).json({ success: false, error: 'معرّف الإرسال مستخدم لطلب مختلف', statusCode: 409 });
        }
        return res.status(200).json({ success: true, data: { order: existingRequest }, statusCode: 200 });
      }

      // Order-number allocation retries only genuine number collisions. The
      // restaurant/request UUID constraint is resolved as an authoritative replay.
      const existingOrders = await prisma.order.findMany({
        where: { restaurantId },
        select: { id: true, numericId: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const orderCount = await prisma.order.count({ where: { restaurantId } });

      const MAX_ALLOCATABLE_NUM = 2_000_000_000;
      let maxNum = 1000;
      for (const ord of existingOrders) {
        if (ord.numericId && ord.numericId > maxNum) maxNum = Math.min(ord.numericId, MAX_ALLOCATABLE_NUM);
        const match = ord.id.match(/^#(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) maxNum = Math.min(num, MAX_ALLOCATABLE_NUM);
        }
      }

      const startNum = Math.max(1001, maxNum + 1, Math.min(orderCount + 1001, MAX_ALLOCATABLE_NUM));
      const createOrder = (nextNum: number) => prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            id: `#${nextNum}`,
            numericId: nextNum,
            restaurantId,
            tableId: effectiveTableId,
            orderSource: isWalkIn ? 'COUNTER' : 'TABLE',
            sessionId: null,
            clientRequestId: effectiveClientRequestId,
            status: 'PENDING',
            paymentMethod: 'PAY AT CASHIER',
            // Staff-created order: money is taken in person at the counter, so
            // the order is operational immediately (the payment gate exists for
            // guest self-service orders, not for the till).
            ...releaseFields(new Date()),
            subtotal,
            total: subtotal,
            notes: notes || undefined,
            items: { create: pricedItems },
          },
          include: { items: true },
        });
        if (!isWalkIn) {
          await tx.table.update({
            where: { id: tableId },
            data: { status: 'OCCUPIED', lastActivityAt: new Date() },
          });
        }
        return created;
      });

      let newOrder: Awaited<ReturnType<typeof createOrder>> | null = null;
      let replayed = false;
      let conflictingReplay = false;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 25 && !newOrder; attempt += 1) {
        try {
          newOrder = await createOrder(startNum + attempt);
        } catch (createErr: unknown) {
          lastError = createErr;
          if ((createErr as { code?: string })?.code !== 'P2002') throw createErr;
          const concurrentRequest = await findReplay();
          if (concurrentRequest) {
            conflictingReplay = !isSameLogicalRequest(concurrentRequest);
            newOrder = concurrentRequest;
            replayed = true;
          }
          // Otherwise this was an order-number collision; allocate the next number.
        }
      }

      if (!newOrder) {
        try {
          newOrder = await createOrder(startNum + Math.floor(Math.random() * 90000) + 100);
        } catch (fallbackErr) {
          lastError = fallbackErr;
          if ((fallbackErr as { code?: string })?.code === 'P2002') {
            const concurrentRequest = await findReplay();
            if (concurrentRequest) {
              conflictingReplay = !isSameLogicalRequest(concurrentRequest);
              newOrder = concurrentRequest;
              replayed = true;
            }
          }
        }
      }

      if (conflictingReplay) {
        return res.status(409).json({ success: false, error: 'معرّف الإرسال مستخدم لطلب مختلف', statusCode: 409 });
      }
      if (!newOrder) {
        console.error('POS order id allocation failed:', lastError);
        return res.status(500).json({ success: false, error: 'تعذر إنشاء فاتورة الكاشير، حاول مجدداً', statusCode: 500 });
      }
      if (replayed) {
        return res.status(200).json({ success: true, data: { order: newOrder }, statusCode: 200 });
      }

      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'POS_ORDER_CREATED',
        entity: 'Order',
        entityId: newOrder.id,
        details: `فاتورة كاشير ${newOrder.id} بقيمة ${subtotal} (${isWalkIn ? 'عميل مباشر' : 'طاولة ' + tableId})`,
        metadata: {
          // Staff orders are the third (and only pre-authorized) way through
          // the payment gate: the money is taken in person at the counter.
          releaseReason: RELEASE_REASON.STAFF_ORDER,
          fulfillmentState: FULFILLMENT_STATE.RELEASED,
        },
      });

      // Counter orders have no table channel — broadcast to the restaurant's
      // staff channel so KDS/waiter screens still get the live event.
      if (effectiveTableId) {
        realtimeService.broadcastToTable(restaurantId, effectiveTableId, 'ORDER_CREATED', {
          orderId: newOrder.id,
          tableId: effectiveTableId,
          total: newOrder.total,
          status: newOrder.status,
          itemsCount: newOrder.items.length,
        });
      } else {
        realtimeService.broadcastToRestaurant(restaurantId, 'ORDER_CREATED', {
          orderId: newOrder.id,
          tableId: null,
          total: newOrder.total,
          status: newOrder.status,
          itemsCount: newOrder.items.length,
        });
      }

      return res.status(201).json({ success: true, data: { order: newOrder }, statusCode: 201 });
    } catch (err) {
      console.error('POS order error:', err);
      return res.status(500).json({ success: false, error: 'تعذر إنشاء فاتورة الكاشير', statusCode: 500 });
    }
  }
);

// PUT /api/manager/orders/:orderId/status — KDS / service status updates.
router.put(
  '/orders/:orderId/status',
  requireServiceStaff(),
  orderStatusLimiter,
  validateBody(orderStatusSchema),
  async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      const { status, restaurantId, reason } = req.body as {
        status: OrderStatus;
        restaurantId?: string;
        reason?: string;
      };
      const targetRestId = restaurantId || req.user?.restaurantId;

      if (!targetRestId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

      if (!ownTenant(req, targetRestId)) return deny(req, res);

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.restaurantId !== targetRestId) {
        return res.status(404).json({ success: false, error: 'الطلب غير موجود في هذا المطعم', statusCode: 404 });
      }

      // PAYMENT AUTHORIZATION BOUNDARY (server-enforced, not a UI filter): an
      // order whose payment the cashier has not verified must not be started,
      // plated or served. The KDS never renders it, so a transition here could
      // only come from a crafted request or a stale bundle — both are refused.
      if (status !== 'CANCELLED' && !isOperational(order.fulfillmentState)) {
        return res.status(409).json({
          success: false,
          error:
            'هذا الطلب بانتظار التحقق من الدفع من قبل الكاشير — لا يمكن بدء تحضيره قبل تأكيد الدفع.',
          statusCode: 409,
        });
      }

      // --------------------------------------------------------------------
      // CANCELLATION (audit H-02, 2026-09-15). Reuses the existing CANCELLED
      // enum value — no state invented. Invariants enforced here:
      //   * ROLE: only cashier/manager/platform (financial-impacting action);
      //     waiters/kitchen/service-staff get 403.
      //   * MONEY GUARD: a PAID order can never be cancelled — the receipt is
      //     an immutable ledger entry and must be voided first, which reverts
      //     the order to UNPAID (see POST /payments/:paymentId/void).
      //   * TRANSFER PROOF: cancelling an order awaiting cashier verification
      //     auto-rejects the receipt in the same compare-and-set (storage
      //     object discarded first, same policy as the reject endpoint), so no
      //     screen can show "cancelled but still awaiting a decision".
      //   * ISOLATION: tenant check above already ran; the CAS below still
      //     pins restaurantId + the status snapshot so a concurrent transition
      //     (kitchen starting cooking mid-cancel) fails loudly, not silently.
      //   * REPLAY: repeating CANCEL on an already-cancelled order returns the
      //     order idempotently (same convention as the flow transitions).
      //   * AUDIT: ORDER_CANCELLED is written with actor, previous status and
      //     reason; the order row is NEVER deleted (financial history is
      //     preserved — the retention/archive sweeps treat it exactly like
      //     before, by status).
      // --------------------------------------------------------------------
      if (status === 'CANCELLED') {
        if (!canPerformStaffCancellation(req.user!.role)) {
          return res.status(403).json({
            success: false,
            error: 'إلغاء الطلب متاح للكاشير أو مدير المطعم فقط',
            statusCode: 403,
          });
        }
        if (order.status === 'CANCELLED') {
          return res.json({ success: true, data: { order }, statusCode: 200 });
        }
        const decision = evaluateStaffCancellation(order);
        if (!decision.ok) {
          return res
            .status(decision.statusCode)
            .json({ success: false, error: decision.error, statusCode: decision.statusCode });
        }

        const proofDeleted =
          decision.clearsPendingVerification && order.paymentProofPath
            ? await discardPaymentProof(order.paymentProofPath)
            : true;

        const cancelledAt = new Date();
        const cancelClaim = await prisma.order.updateMany({
          where: { id: orderId, restaurantId: targetRestId, status: order.status },
          data: {
            status: 'CANCELLED',
            cancelledAt,
            cancelReason: reason || undefined,
            cancelledByUserId: req.user!.id,
            ...(decision.clearsPendingVerification
              ? {
                  paymentStatus: PAYMENT_STATUS.UNPAID,
                  fulfillmentState: FULFILLMENT_STATE.PAYMENT_REJECTED,
                  paymentRejectedAt: cancelledAt,
                  paymentRejectionReason: reason || CANCELLATION_AUTO_REJECT_REASON,
                  ...(proofDeleted ? { paymentProofPath: null } : {}),
                }
              : {}),
          },
        });
        if (cancelClaim.count !== 1) {
          return res.status(409).json({
            success: false,
            error: 'تغيرت حالة الطلب بواسطة مستخدم آخر. حدّث القائمة وحاول مجدداً.',
            statusCode: 409,
          });
        }
        const cancelledOrder = await prisma.order.findUnique({ where: { id: orderId } });

        await logAuditEvent({
          restaurantId: targetRestId,
          userId: req.user!.id,
          actor: req.user!.name,
          actorRole: req.user!.role,
          action: 'ORDER_CANCELLED',
          entity: 'Order',
          entityId: orderId,
          details: `تم إلغاء الطلب ${orderId} (كان ${order.status})${reason ? ` — ${reason}` : ''}`,
          metadata: {
            previousStatus: order.status,
            paymentStatus: order.paymentStatus,
            clearedPendingVerification: decision.clearsPendingVerification,
            proofDiscarded: decision.clearsPendingVerification ? proofDeleted : undefined,
            reason: reason || undefined,
          },
          ipAddress: req.ip,
        });

        if (order.tableId) {
          realtimeService.broadcastToTable(targetRestId, order.tableId, 'ORDER_CANCELLED', {
            orderId,
            tableId: order.tableId,
            previousStatus: order.status,
            cancelledAt: cancelledAt.toISOString(),
          });
        } else {
          realtimeService.broadcastToRestaurant(targetRestId, 'ORDER_CANCELLED', {
            orderId,
            tableId: null,
            previousStatus: order.status,
            cancelledAt: cancelledAt.toISOString(),
          });
        }

        return res.json({ success: true, data: { order: cancelledOrder }, statusCode: 200 });
      }

      // Enforce the operational state machine at the authority boundary, not
      // only in UI buttons. Idempotent repeats are safe; skips, reversals and
      // resurrection of CANCELLED/SERVED orders are rejected.
      const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
        PENDING: 'PREPARING',
        PREPARING: 'READY',
        READY: 'SERVED',
      };
      if (status === order.status) {
        return res.json({ success: true, data: { order }, statusCode: 200 });
      }
      if (nextStatus[order.status] !== status) {
        return res.status(409).json({
          success: false,
          error: `انتقال حالة غير صالح من ${order.status} إلى ${status}`,
          statusCode: 409,
        });
      }

      // Compare-and-set prevents two operators acting on the same stale card
      // from both claiming success or overwriting a newer state.
      const changed = await prisma.order.updateMany({
        where: { id: orderId, restaurantId: targetRestId, status: order.status },
        data: { status },
      });
      if (changed.count !== 1) {
        return res.status(409).json({
          success: false,
          error: 'تغيرت حالة الطلب بواسطة مستخدم آخر. حدّث القائمة وحاول مجدداً.',
          statusCode: 409,
        });
      }
      const updated = await prisma.order.findUnique({ where: { id: orderId } });

      await logAuditEvent({
        restaurantId: targetRestId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'ORDER_STATUS_CHANGED',
        entity: 'Order',
        entityId: orderId,
        details: `تم تغيير حالة الطلب ${orderId} من ${order.status} إلى ${status}`,
      });

      // Broadcast update via SSE (table-scoped: no cross-table leakage)
      if (order.tableId) {
        realtimeService.broadcastToTable(targetRestId, order.tableId, 'ORDER_STATUS_UPDATED', {
          orderId,
          status,
          tableId: order.tableId,
        });
      } else {
        realtimeService.broadcastToRestaurant(targetRestId, 'ORDER_STATUS_UPDATED', {
          orderId,
          status,
          tableId: null,
        });
      }

      return res.json({ success: true, data: { order: updated }, statusCode: 200 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر تحديث حالة الطلب', statusCode: 500 });
    }
  }
);

// GET /api/manager/tables
router.get('/tables', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

    if (!ownTenant(req, restaurantId)) return deny(req, res);

    const tables = await prisma.table.findMany({
      where: { restaurantId },
      include: {
        orders: {
          where: { status: { in: ['PENDING', 'PREPARING', 'READY'] } },
          select: { id: true },
        },
      },
      orderBy: { number: 'asc' },
    });

    // H-01 (2026-09-15 audit): the qrToken is the anonymous capability printed
    // on the table's QR card. Only roles that operate the QR-management
    // surface may receive it; for waiter/kitchen/staff the key is OMITTED
    // from the payload entirely (see services/tableSerialization).
    const includeQrToken = canReadQrToken(req.user?.role);
    const formatted = tables.map((t) =>
      serializeStaffTable(
        {
          id: t.id,
          restaurantId: t.restaurantId,
          number: t.number,
          capacity: t.capacity,
          zone: t.zone,
          status: t.status,
          qrToken: t.qrToken,
          hasWaiterCall: t.hasWaiterCall,
          activeOrderIds: t.orders.map((o) => o.id),
          lastActivityAt: t.lastActivityAt?.toISOString(),
        },
        includeQrToken
      )
    );

    return res.json({ success: true, data: formatted, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع الطاولات', statusCode: 500 });
  }
});

// POST /api/manager/tables (Create Table)
router.post(
  '/tables',
  requireManager(),
  validateBody(tableCreateSchema),
  async (req: Request, res: Response) => {
    try {
      const targetRestId = getTenantId(req);

      if (!targetRestId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

      if (!ownTenant(req, targetRestId)) return deny(req, res);

      const { tableNumber, capacity, zone, name } = req.body as {
        tableNumber: number;
        capacity?: number;
        zone?: TableZone;
        name?: string;
      };

      const limits = await getPlanLimits(targetRestId);
      const tablesCount = await prisma.table.count({ where: { restaurantId: targetRestId } });
      if (tablesCount >= limits.maxTables) {
        return res.status(403).json({
          success: false,
          error: `وصلت للحد الأقصى للطاولات في باقتك (${limits.maxTables}). قم بالترقية لإضافة المزيد.`,
          statusCode: 403,
        });
      }

      const num = tableNumber;
      const numStr = num < 10 ? `0${num}` : `${num}`;
      const tableId = `${targetRestId}-T${numStr}`;

      const duplicate = await prisma.table.findFirst({ where: { restaurantId: targetRestId, number: num } });
      if (duplicate) {
        return res.status(409).json({ success: false, error: `يوجد طاولة بهذا الرقم بالفعل (طاولة ${numStr})`, statusCode: 409 });
      }

      const newTable = await prisma.table.create({
        data: {
          id: tableId,
          restaurantId: targetRestId,
          number: num,
          name: name || `طاولة ${numStr}`,
          capacity: capacity ?? 4,
          zone: zone || 'MAIN_HALL',
          status: 'AVAILABLE',
          qrToken: generateQrToken(),
        },
      });

      await logAuditEvent({
        restaurantId: targetRestId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'TABLE_CREATED',
        entity: 'Table',
        entityId: newTable.id,
        details: `تمت إضافة طاولة جديدة رقم ${num}`,
      });

      return res.status(201).json({ success: true, data: { table: newTable }, statusCode: 201 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر إنشاء الطاولة', statusCode: 500 });
    }
  }
);

async function generateNextReceiptNumber(
  restaurantId: string,
  now: Date,
  attempt: number
): Promise<string> {
  const yearPrefix = `RC-${now.getFullYear()}-`;
  const latest = await prisma.payment.findFirst({
    where: {
      restaurantId,
      receiptNumber: { startsWith: yearPrefix },
    },
    orderBy: { receiptNumber: 'desc' },
    select: { receiptNumber: true },
  });
  let maxSeq = 0;
  if (latest?.receiptNumber) {
    const parts = latest.receiptNumber.split('-');
    const parsed = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(parsed)) maxSeq = parsed;
  }
  const count = await prisma.payment.count({ where: { restaurantId } });
  const base = Math.max(maxSeq, count);
  const seq = base + 1 + attempt;
  return `${yearPrefix}${String(seq).padStart(4, '0')}`;
}

// POST /api/manager/tables/:id/settle (Settle Table Bill)
router.post(
  '/tables/:id/settle',
  requireCashierOrManager(),
  paymentLimiter,
  validateBody(tableSettleSchema),
  async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const table = await prisma.table.findUnique({ where: { id } });
    if (!table) return res.status(404).json({ success: false, error: 'الطاولة غير موجودة', statusCode: 404 });
    // Strict ownership: only the tenant that owns the table (or a platform admin) can settle it.
    if (!ownTenant(req, table.restaurantId)) return deny(req, res);

    const now = new Date();
    const {
      paymentMethod,
      note,
      cashReceived,
      tip,
    } = req.body as {
      paymentMethod?: string;
      note?: string;
      cashReceived?: number;
      tip?: number;
    };
    const paidMethod = paymentMethod || 'CASH';

    // A transfer receipt is waiting for a cashier decision: closing the table
    // now would end the guest's session while their payment is still unverified
    // (and would hide the order from the verification queue). Refuse instead.
    const pendingVerification = await prisma.order.count({
      where: {
        tableId: String(id),
        restaurantId: table.restaurantId,
        status: { not: 'CANCELLED' },
        paymentStatus: PAYMENT_STATUS.PENDING_VERIFICATION,
      },
    });
    if (pendingVerification > 0) {
      return res.status(409).json({
        success: false,
        error:
          'هناك إشعار حوالة بانتظار التحقق على هذه الطاولة. تحقق منه (قبول أو رفض) قبل تسوية الحساب.',
        statusCode: 409,
      });
    }

    // Find active/unpaid orders on this table
    const unpaidOrders = await prisma.order.findMany({
      where: {
        tableId: id,
        restaurantId: table.restaurantId,
        status: { not: 'CANCELLED' },
        paymentStatus: 'UNPAID',
      },
      include: { items: true },
    });

    // Which of these bills never passed the payment gate? Collecting them in
    // person IS the verification, so this same transaction opens the gate for
    // them. Because the kitchen never received those orders, they keep their
    // PENDING status and arrive as fresh tickets instead of being marked
    // SERVED without ever having been cooked.
    const releasedByCollection = unpaidOrders.filter((o) => !isOperational(o.fulfillmentState));
    const closingOperational = unpaidOrders.filter((o) => isOperational(o.fulfillmentState));

    let paymentRecord: Awaited<ReturnType<typeof prisma.payment.create>> | null = null;

    if (unpaidOrders.length > 0) {
      const total = roundMoney(unpaidOrders.reduce((sum, o) => sum + o.total, 0));
      const subtotal = roundMoney(unpaidOrders.reduce((sum, o) => sum + o.subtotal, 0));

      // Cash reconciliation: CASH requires sufficient tendered cash and the
      // change is computed server-side, never supplied/trusted from the client.
      // Legacy callers that omit cashReceived keep the exact-cash behaviour.
      const reconciliation = reconcileCashPayment({
        method: paidMethod,
        total,
        tip: tip ?? 0,
        cashReceived:
          paidMethod === 'CASH'
            ? cashReceived === undefined
              ? total // legacy quick-settle: assume exact cash
              : cashReceived
            : undefined,
      });
      if (!reconciliation.ok) {
        return res.status(400).json({ success: false, error: reconciliation.error, statusCode: 400 });
      }

      // Receipt allocation retries on unique receipt-number collisions (concurrent POS).
      let receiptError: unknown = null;
      let settled = false;
      for (let attempt = 0; attempt < 5 && !settled; attempt++) {
        try {
          const receiptNumber = await generateNextReceiptNumber(table.restaurantId, now, attempt);

          paymentRecord = await prisma.$transaction(async (tx) => {
            // Conditional claim: only rows that are STILL UNPAID flip. A
            // concurrent settle/payment (double click, two cashiers) claims
            // zero rows here and gets a 409 instead of producing a duplicate
            // receipt and a double-posted ledger entry.
            let claimedCount = 0;

            if (closingOperational.length > 0) {
              const claimed = await tx.order.updateMany({
                where: {
                  id: { in: closingOperational.map((o) => o.id) },
                  restaurantId: table.restaurantId,
                  status: { not: 'CANCELLED' },
                  paymentStatus: 'UNPAID',
                },
                data: {
                  status: 'SERVED',
                  paymentStatus: 'PAID',
                  paymentMethod: paidMethod,
                  settledAt: now,
                  cashierId: req.user!.id,
                },
              });
              claimedCount += claimed.count;
            }

            if (releasedByCollection.length > 0) {
              const claimed = await tx.order.updateMany({
                where: {
                  id: { in: releasedByCollection.map((o) => o.id) },
                  restaurantId: table.restaurantId,
                  status: { not: 'CANCELLED' },
                  paymentStatus: 'UNPAID',
                },
                data: {
                  // Kitchen status stays PENDING (fresh ticket) and the gate
                  // opens in the SAME statement as the money.
                  ...releaseFields(now),
                  paymentStatus: 'PAID',
                  paymentMethod: paidMethod,
                  settledAt: now,
                  cashierId: req.user!.id,
                },
              });
              claimedCount += claimed.count;
            }

            if (claimedCount !== unpaidOrders.length) {
              throw Object.assign(new Error('SETTLE_RACE'), { code: 'SETTLE_RACE' });
            }

            const receipt = await tx.payment.create({
              data: {
                id: `pay-${randomUUID()}`,
                receiptNumber,
                restaurantId: table.restaurantId,
                branchId: table.branchId || undefined,
                tableId: id,
                tableLabel: `طاولة ${table.number}`,
                orderIds: unpaidOrders.map((o) => o.id),
                itemsSummary: unpaidOrders
                  .flatMap((o) => o.items.map((i) => i.productNameSnapshot))
                  .slice(0, 4)
                  .join('، '),
                method: paidMethod,
                subtotal,
                total,
                cashReceived:
                  paidMethod === 'CASH' && reconciliation.cashReceived !== null
                    ? reconciliation.cashReceived
                    : undefined,
                changeDue: reconciliation.changeDue > 0 ? reconciliation.changeDue : 0,
                tip: reconciliation.tip > 0 ? reconciliation.tip : undefined,
                cashierId: req.user!.id,
                cashierName: req.user!.name,
                note: note || 'تسوية إغلاق الطاولة وإثبات الدفع',
              },
            });

            // Reset table status and resolve waiter calls inside the SAME
            // transaction so a receipt can never exist without the table closing.
            await tx.table.update({
              where: { id },
              data: { status: 'AVAILABLE', hasWaiterCall: false, lastActivityAt: now },
            });
            await tx.tableSession.updateMany({
              where: { tableId: id, restaurantId: table.restaurantId, status: 'ACTIVE' },
              data: { status: 'CLOSED', endedAt: now },
            });
            await tx.waiterRequest.updateMany({
              where: { tableId: id, restaurantId: table.restaurantId, status: 'PENDING' },
              data: { status: 'RESOLVED', resolvedAt: now },
            });

            return receipt;
          });
          settled = true;
        } catch (txErr: unknown) {
          const code = (txErr as { code?: string })?.code;
          if (code === 'SETTLE_RACE') {
            return res.status(409).json({
              success: false,
              error: 'تمت تسوية هذا الحساب للتو من جهاز آخر. حدّث الصفحة وحاول مجدداً.',
              statusCode: 409,
            });
          }
          receiptError = txErr;
          if (code !== 'P2002') throw txErr;
        }
      }
      if (!settled || !paymentRecord) {
        console.error('[Table Settle Error] Receipt allocation exhausted:', {
          endpoint: 'POST /api/manager/tables/:id/settle',
          tenantId: table.restaurantId,
          tableId: id,
          orderIds: unpaidOrders.map((o) => o.id),
          method: paidMethod,
          message: (receiptError as any)?.message || 'Failed to allocate unique receipt number after retries',
          code: (receiptError as any)?.code,
          meta: (receiptError as any)?.meta,
        });
        return res.status(500).json({ success: false, error: 'تعذر إتمام التسوية، حاول مجدداً', statusCode: 500 });
      }
    } else {
      // Nothing unpaid on the table — still perform the idempotent close
      // (free table / close session / resolve calls), but never create a
      // duplicate payment receipt for an already-paid bill.
      await prisma.$transaction(async (tx) => {
        await tx.table.update({
          where: { id },
          data: { status: 'AVAILABLE', hasWaiterCall: false, lastActivityAt: now },
        });
        await tx.tableSession.updateMany({
          where: { tableId: id, restaurantId: table.restaurantId, status: 'ACTIVE' },
          data: { status: 'CLOSED', endedAt: now },
        });
        await tx.waiterRequest.updateMany({
          where: { tableId: id, restaurantId: table.restaurantId, status: 'PENDING' },
          data: { status: 'RESOLVED', resolvedAt: now },
        });
      });
    }

    await logAuditEvent({
      restaurantId: table.restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'TABLE_SETTLED',
      entity: 'Table',
      entityId: id,
      details: `تمت تسوية ودفع طلبات الطاولة ${table.number} ${paymentRecord ? `(إيصال ${paymentRecord.receiptNumber})` : ''}`,
      ipAddress: req.ip,
    });

    // Orders that only NOW became operational (paid in person at the till
    // while still held by the gate) are announced to the kitchen explicitly:
    // the floor/KDS screens must show them instantly, exactly like a verified
    // transfer. Nothing is announced for orders the kitchen already had.
    if (releasedByCollection.length > 0) {
      await Promise.all(
        releasedByCollection.map((released: CollectionReleasedOrder) =>
          logAuditEvent({
            restaurantId: table.restaurantId,
            userId: req.user!.id,
            actor: req.user!.name,
            actorRole: req.user!.role as TenantRole,
            action: 'ORDER_RELEASED_TO_KDS',
            entity: 'Order',
            entityId: released.id,
            details: `تم الإفراج عن الطلب ${released.id} للمطبخ بعد تحصيل الدفع (${paidMethod})`,
            metadata: {
              orderId: released.id,
              paymentId: paymentRecord?.id,
              restaurantId: table.restaurantId,
              previousFulfillmentState: normalizeFulfillmentState(released.fulfillmentState),
              fulfillmentState: FULFILLMENT_STATE.RELEASED,
              releaseReason: RELEASE_REASON.CASH_COLLECTED,
              paymentMethod: paidMethod,
            },
            ipAddress: req.ip,
          }).catch(() => undefined)
        )
      );
      for (const released of releasedByCollection) {
        realtimeService.broadcastToTable(
          table.restaurantId,
          id,
          'ORDER_RELEASED_TO_KITCHEN',
          {
            orderId: released.id,
            tableId: id,
            numericId: released.numericId,
            total: released.total,
            orderStatus: released.status,
            releasedAt: now.toISOString(),
            releaseReason: RELEASE_REASON.CASH_COLLECTED,
          }
        );
      }
    }

    realtimeService.broadcastToTable(table.restaurantId, id, 'TABLE_SETTLED', { tableId: id });
    if (paymentRecord) {
      realtimeService.broadcastToTable(table.restaurantId, id, 'PAYMENT_RECORDED', {
        receiptNumber: paymentRecord.receiptNumber,
        tableId: id,
        total: paymentRecord.total,
      });
    }

    return res.json({
      success: true,
      message: `تمت تسوية ودفع حساب طاولة ${table.number} بنجاح`,
      data: { payment: paymentRecord },
      statusCode: 200,
    });
  } catch (err) {
    console.error('[Table Settle Error]', {
      endpoint: 'POST /api/manager/tables/:id/settle',
      tableId: req.params?.id,
      message: (err as any)?.message || String(err),
      code: (err as any)?.code,
      meta: (err as any)?.meta,
    });
    return res.status(500).json({ success: false, error: 'تعذر تصفية حساب الطاولة', statusCode: 500 });
  }
  }
);

// POST /api/manager/tables/:id/regenerate-qr (Regenerate Secure QR Token)
router.post('/tables/:id/regenerate-qr', requireManager(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const table = await prisma.table.findUnique({ where: { id } });
    if (!table) return res.status(404).json({ success: false, error: 'الطاولة غير موجودة', statusCode: 404 });
    if (!ownTenant(req, table.restaurantId)) return deny(req, res);

    // Opaque CSPRNG token — no restaurant/table IDs embedded, no Math.random.
    const newToken = generateQrToken();
    const updated = await prisma.table.update({
      where: { id },
      data: { qrToken: newToken },
    });

    // Rotating the QR invalidates in-flight anonymous sessions on this table.
    await prisma.tableSession.updateMany({
      where: { tableId: id, restaurantId: table.restaurantId, status: 'ACTIVE' },
      data: { status: 'CLOSED', endedAt: new Date() },
    });

    await logAuditEvent({
      restaurantId: table.restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'QR_REGENERATED',
      entity: 'Table',
      entityId: id,
      details: `تم تجديد رمز QR الأمني للطاولة ${id}`,
    });

    return res.json({ success: true, data: { table: updated }, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر تجديد رمز QR', statusCode: 500 });
  }
});

// GET /api/manager/menu/categories
// ============================================================
// CATALOG IMAGE PERSISTENCE (dish photos, offer photos)
//
// The SAME reference contract `PUT /branding` uses for logo/cover/map/gallery,
// so a dish photo and a logo are persisted identically: the DATABASE holds the
// stable tenant-scoped object key, and every response re-derives the renderable
// URL from that key. That is what makes an image survive a redeploy, a fresh
// instance, or a moved storage host — a stored absolute URL does not.
//
//   canonical key          -> persisted verbatim (idempotent, no storage I/O)
//   managed public URL     -> folded back into its object key (host-free)
//   legacy `/uploads/…`    -> folded into the key ONLY when the object is
//                            actually present in the active storage; a row that
//                            was never migrated keeps its current value, so a
//                            legacy reference is never silently retargeted at
//                            a missing object (it stays detectable for
//                            `npm run storage:migrate`)
//   external http(s) URL   -> persisted verbatim (external assets are stable
//                            by design: Unsplash/CDN seeds keep working)
//   '' / whitespace        -> explicit "no image"
//   data: / blob: / file:  -> refused with 400, never persisted
// ============================================================

type CatalogImageResult = { ok: true; ref: string } | { ok: false; error: string };

const CATALOG_IMAGE_TRANSIENT_ERROR =
  'رابط الصورة غير صالح — ارفع الصورة عبر زر الرفع من جهازك ثم احفظ مجدداً';
const CATALOG_IMAGE_FOREIGN_TENANT_ERROR = 'رابط الصورة لا ينتمي لمطعمك';

/**
 * Normalize an incoming catalog image value into the reference to persist.
 * `restaurantId` is the tenant that owns the row — a key from another
 * restaurant's namespace is refused, exactly as the branding route does.
 */
async function persistCatalogImage(
  raw: string,
  restaurantId: string
): Promise<CatalogImageResult> {
  const storage = getStorage();
  const normalized = normalizeAssetReference(raw, assetNormalizerFor(storage));
  if (normalized.kind === 'reject') {
    return { ok: false, error: CATALOG_IMAGE_TRANSIENT_ERROR };
  }
  if (normalized.kind === 'clear') return { ok: true, ref: '' };
  if (normalized.kind === 'external') return { ok: true, ref: normalized.reference };

  const key = normalized.reference;
  if (!keyBelongsToRestaurant(key, restaurantId)) {
    return { ok: false, error: CATALOG_IMAGE_FOREIGN_TENANT_ERROR };
  }
  // Already the canonical form — nothing to fold, nothing to verify.
  if (isStorageKey(raw)) return { ok: true, ref: key };
  // Folded from a URL: keep the fold only when the object is really there.
  const present = await storage.exists(key).catch(() => false);
  return { ok: true, ref: present ? key : String(raw).trim() };
}

/**
 * Response side of the contract: a canonical key becomes a renderable URL,
 * every other stored form (external URL, legacy `/uploads/…`) is handed back
 * untouched — a value that renders today must keep rendering.
 */
function resolveCatalogImage(value: string | null | undefined): string {
  if (!value) return '';
  if (!isStorageKey(value)) return String(value);
  return assetUrlResolverFor(getStorage(), config.appUrl)(String(value));
}

/** Fold any stored form to its object key, for replacement comparisons only —
 *  a client that round-trips the same asset as a URL must not trigger a
 *  delete of the object the row still points at. */
function foldCatalogImageKey(value: string | null | undefined): string | null {
  const value$ = String(value ?? '').trim();
  if (!value$) return null;
  if (isStorageKey(value$)) return value$;
  try {
    return getStorage().keyFromUrl(value$);
  } catch {
    return null;
  }
}

router.get('/menu/categories', async (req: Request, res: Response) => {
  const restaurantId = getTenantId(req);
  if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

  const categories = await prisma.category.findMany({
    where: { restaurantId },
    orderBy: { sortOrder: 'asc' },
  });
  return res.json({ success: true, data: categories, statusCode: 200 });
});

// POST /api/manager/menu/categories
router.post(
  '/menu/categories',
  requireManager(),
  validateBody(categoryCreateSchema),
  async (req: Request, res: Response) => {
    const targetRestId = getTenantId(req);
    if (!targetRestId || !ownTenant(req, targetRestId)) return deny(req, res);

    const { name, nameEn } = req.body as { name: string; nameEn?: string };

    const limits = await getPlanLimits(targetRestId);
    const count = await prisma.category.count({ where: { restaurantId: targetRestId } });
    if (count >= limits.maxCategories) {
      return res.status(403).json({
        success: false,
        error: `وصلت للحد الأقصى للتصنيفات في باقتك (${limits.maxCategories}). قم بالترقية لإضافة المزيد.`,
        statusCode: 403,
      });
    }

    const newCat = await prisma.category.create({
      data: {
        restaurantId: targetRestId,
        name,
        nameEn: nameEn || undefined,
        sortOrder: count + 1,
      },
    });

    await logAuditEvent({
      restaurantId: targetRestId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'CATEGORY_CREATED',
      entity: 'Category',
      entityId: newCat.id,
      details: `تم إنشاء تصنيف جديد: ${name}`,
    });

    return res.status(201).json({ success: true, data: newCat, statusCode: 201 });
  }
);

// PUT /api/manager/menu/categories/:id
router.put(
  '/menu/categories/:id',
  requireManager(),
  validateBody(categoryUpdateSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await prisma.category.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ success: false, error: 'التصنيف غير موجود', statusCode: 404 });
      if (!ownTenant(req, existing.restaurantId)) return deny(req, res);

      const { name, nameEn, sortOrder } = req.body as {
        name?: string;
        nameEn?: string;
        sortOrder?: number;
      };
      const updated = await prisma.category.update({
        where: { id },
        data: {
          name: name !== undefined ? name : undefined,
          nameEn: nameEn !== undefined ? nameEn : undefined,
          sortOrder: sortOrder !== undefined ? sortOrder : undefined,
        },
      });
      return res.json({ success: true, data: { category: updated }, statusCode: 200 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر تعديل التصنيف', statusCode: 500 });
    }
  }
);

// DELETE /api/manager/menu/categories/:id
router.delete('/menu/categories/:id', requireManager(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) return res.status(404).json({ success: false, error: 'التصنيف غير موجود', statusCode: 404 });
    if (!ownTenant(req, category.restaurantId)) return deny(req, res);

    const productsCount = await prisma.product.count({ where: { categoryId: id } });
    if (productsCount > 0) {
      return res.status(409).json({
        success: false,
        error: `لا يمكن حذف التصنيف: يحتوي على ${productsCount} أطباق. انقل الأطباق أولاً.`,
        statusCode: 409,
      });
    }

    await prisma.category.delete({ where: { id } });
    // Best-effort cleanup of the category image (avoid orphaned files).
    if (category.image) {
      void deleteManagedAssets(getStorage(), category.restaurantId, [category.image]);
    }
    await logAuditEvent({
      restaurantId: category.restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'CATEGORY_DELETED',
      entity: 'Category',
      entityId: id,
      details: `تم حذف التصنيف ${category.name}`,
    });
    return res.json({ success: true, message: 'تم حذف التصنيف', statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر حذف التصنيف', statusCode: 500 });
  }
});

// GET /api/manager/menu/products
router.get('/menu/products', async (req: Request, res: Response) => {
  const restaurantId = getTenantId(req);
  if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

  const products = await prisma.product.findMany({
    where: { restaurantId },
    include: { options: true, addOns: true },
    orderBy: { sortOrder: 'asc' },
  });

  const formatted = products.map((p) => ({
    id: p.id,
    restaurantId: p.restaurantId,
    categoryId: p.categoryId,
    name: p.name,
    nameEn: p.nameEn,
    description: p.description,
    price: p.price,
    image: resolveCatalogImage(p.imageUrl),
    isAvailable: p.available,
    isFeatured: p.isFeatured,
    badge: p.badge || undefined,
    preparationTimeMinutes: p.preparationTimeMinutes || 15,
    calories: p.calories || 450,
    allergens: p.allergens,
    ingredients: p.ingredients,
    removableIngredients: p.removableIngredients,
    sizes: p.options.map((o) => ({
      id: o.id,
      name: o.name,
      nameEn: o.nameEn || undefined,
      priceModifier: o.priceModifier,
      price: o.price,
    })),
    addOns: p.addOns.map((a) => ({
      id: a.id,
      name: a.name,
      nameEn: a.nameEn || undefined,
      price: a.price,
      isAvailable: a.isAvailable,
    })),
  }));

  return res.json({ success: true, data: formatted, statusCode: 200 });
});

// POST /api/manager/menu/products
router.post(
  '/menu/products',
  requireManager(),
  validateBody(productCreateSchema),
  async (req: Request, res: Response) => {
    try {
      const {
        categoryId,
        name,
        nameEn,
        description,
        price,
        image,
        badge,
        preparationTimeMinutes,
        calories,
        isAvailable,
        isFeatured,
        allergens,
        ingredients,
        removableIngredients,
        sizes,
        addOns,
      } = req.body as {
        categoryId: string;
        name: string;
        nameEn?: string;
        description?: string;
        price: number;
        image?: string;
        badge?: string;
        preparationTimeMinutes?: number;
        calories?: number;
        isAvailable?: boolean;
        isFeatured?: boolean;
        allergens?: string[];
        ingredients?: string[];
        removableIngredients?: string[];
        sizes?: Array<{ name: string; nameEn?: string; price?: number; priceModifier?: number }>;
        addOns?: Array<{ name: string; nameEn?: string; price?: number }>;
      };

      const targetRestId = getTenantId(req);
      if (!targetRestId || !ownTenant(req, targetRestId)) return deny(req, res);

      // The category must belong to the same tenant (composite ownership).
      const category = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!category || category.restaurantId !== targetRestId) {
        return res.status(400).json({ success: false, error: 'التصنيف المحدد لا ينتمي لمطعمك', statusCode: 400 });
      }

      const limits = await getPlanLimits(targetRestId);
      const productsCount = await prisma.product.count({ where: { restaurantId: targetRestId } });
      if (productsCount >= limits.maxProducts) {
        return res.status(403).json({
          success: false,
          error: `وصلت للحد الأقصى للأطباق في باقتك (${limits.maxProducts}). قم بالترقية لإضافة المزيد.`,
          statusCode: 403,
        });
      }

      // Dish photo: persist the STABLE reference (key), never a renderable URL
      // (see the catalog image contract above). A rejected payload (base64 /
      // blob / another tenant's key) fails the whole save with 400.
      const dishImage = await persistCatalogImage(String(image ?? ''), targetRestId);
      if (!dishImage.ok) {
        return res.status(400).json({
          success: false,
          error: dishImage.error,
          statusCode: 400,
        });
      }

      const newProd = await prisma.product.create({
        data: {
          restaurantId: targetRestId,
          categoryId,
          name,
          nameEn: nameEn || name,
          description: description || '',
          price,
          imageUrl: dishImage.ref,
          badge: badge || undefined,
          preparationTimeMinutes: preparationTimeMinutes ?? 15,
          calories: calories ?? 450,
          available: isAvailable !== false,
          isFeatured: isFeatured || false,
          allergens: allergens || [],
          ingredients: ingredients || [],
          removableIngredients: removableIngredients || ingredients || [],
          options: {
            create: (sizes || []).map((s) => ({
              name: s.name,
              nameEn: s.nameEn || undefined,
              priceModifier: s.priceModifier ?? s.price ?? 0,
              price: s.price ?? s.priceModifier ?? 0,
            })),
          },
          addOns: {
            create: (addOns || []).map((a) => ({
              name: a.name,
              nameEn: a.nameEn || undefined,
              price: a.price ?? 0,
              isAvailable: true,
            })),
          },
        },
        include: { options: true, addOns: true },
      });

      await logAuditEvent({
        restaurantId: targetRestId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'PRODUCT_CREATED',
        entity: 'Product',
        entityId: newProd.id,
        details: `تم إنشاء طبق جديد: ${name} (₪${price})`,
      });

      // The client keeps receiving a renderable URL in `imageUrl`; the key
      // itself stays in the database (the response also carries it as
      // `imageStoragePath` so a caller can round-trip the stable reference).
      return res.status(201).json({
        success: true,
        data: {
          ...newProd,
          imageUrl: resolveCatalogImage(newProd.imageUrl),
          imageStoragePath: newProd.imageUrl,
        },
        statusCode: 201,
      });
    } catch (err) {
      console.error('Create product error:', err);
      return res.status(500).json({ success: false, error: 'تعذر إنشاء الطبق', statusCode: 500 });
    }
  }
);

// PUT /api/manager/menu/products/:id/stock (Instant Stock Toggle)
router.put('/menu/products/:id/stock', requireManager(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return res.status(404).json({ success: false, error: 'الطبق غير موجود', statusCode: 404 });
    if (!ownTenant(req, product.restaurantId)) return deny(req, res);

    const updated = await prisma.product.update({
      where: { id },
      data: { available: !product.available },
    });

    await logAuditEvent({
      restaurantId: product.restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'STOCK_TOGGLED',
      entity: 'Product',
      entityId: id,
      details: `تم تغيير حالة توفر طبق ${product.name} إلى ${updated.available ? 'متوفر' : 'نفد المخزون'}`,
    });

    return res.json({ success: true, data: { product: updated }, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر تحديث حالة المخزون', statusCode: 500 });
  }
});

// PUT /api/manager/menu/products/:id (Update Product)
router.put(
  '/menu/products/:id',
  requireManager(),
  validateBody(productUpdateSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const data = req.body as {
        categoryId?: string;
        name?: string;
        nameEn?: string;
        description?: string;
        price?: number;
        image?: string;
        imageUrl?: string;
        badge?: string | null;
        preparationTimeMinutes?: number;
        calories?: number;
        isAvailable?: boolean;
        isFeatured?: boolean;
      };

      const existingProduct = await prisma.product.findUnique({ where: { id } });
      if (!existingProduct) return res.status(404).json({ success: false, error: 'الطبق غير موجود', statusCode: 404 });
      if (!ownTenant(req, existingProduct.restaurantId)) return deny(req, res);
      if (data.categoryId) {
        const targetCategory = await prisma.category.findUnique({ where: { id: data.categoryId } });
        if (!targetCategory || targetCategory.restaurantId !== existingProduct.restaurantId) {
          return res.status(400).json({ success: false, error: 'التصنيف المحدد لا ينتمي لمطعمك', statusCode: 400 });
        }
      }

      // Only explicitly provided fields are updated — omitted fields are
      // left untouched instead of being reset to defaults.
      // The dish photo goes through the catalog image contract first, so the
      // column keeps the stable key (omitted = unchanged, '' = explicit clear).
      const incomingImage =
        data.image !== undefined || data.imageUrl !== undefined
          ? (data.image ?? data.imageUrl)
          : undefined;
      const dishImage =
        incomingImage !== undefined
          ? await persistCatalogImage(String(incomingImage), existingProduct.restaurantId)
          : undefined;
      if (dishImage && !dishImage.ok) {
        return res.status(400).json({
          success: false,
          error: dishImage.error,
          statusCode: 400,
        });
      }

      const updated = await prisma.product.update({
        where: { id },
        data: {
          name: data.name !== undefined ? data.name : undefined,
          nameEn: data.nameEn !== undefined ? data.nameEn : undefined,
          description: data.description !== undefined ? data.description : undefined,
          price: data.price !== undefined ? data.price : undefined,
          imageUrl: dishImage ? dishImage.ref : undefined,
          categoryId: data.categoryId !== undefined ? data.categoryId : undefined,
          available: data.isAvailable !== undefined ? data.isAvailable : undefined,
          isFeatured: data.isFeatured !== undefined ? data.isFeatured : undefined,
          badge: data.badge !== undefined ? data.badge : undefined,
          preparationTimeMinutes: data.preparationTimeMinutes !== undefined ? data.preparationTimeMinutes : undefined,
          calories: data.calories !== undefined ? data.calories : undefined,
        },
      });

      // Best-effort cleanup of a replaced dish image — AFTER the DB commit.
      // Comparison happens on FOLDED keys, so a client that round-trips the
      // same asset as a URL (instead of the key) never deletes the object the
      // row still points at.
      if (
        incomingImage !== undefined &&
        existingProduct.imageUrl &&
        foldCatalogImageKey(existingProduct.imageUrl) !== foldCatalogImageKey(incomingImage)
      ) {
        void deleteManagedAssets(getStorage(), existingProduct.restaurantId, [
          existingProduct.imageUrl,
        ]);
      }

      // Response contract: `imageUrl` stays a renderable URL for every client
      // (manager list, POS tile, print preview) and the stable reference itself
      // is exposed additively as `imageStoragePath`.
      return res.json({
        success: true,
        data: {
          ...updated,
          imageUrl: resolveCatalogImage(updated.imageUrl),
          imageStoragePath: updated.imageUrl,
        },
        statusCode: 200,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر تعديل الطبق', statusCode: 500 });
    }
  }
);

// DELETE /api/manager/menu/products/:id
router.delete('/menu/products/:id', requireManager(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return res.status(404).json({ success: false, error: 'الطبق غير موجود', statusCode: 404 });
    if (!ownTenant(req, product.restaurantId)) return deny(req, res);

    const referenced = await prisma.orderItem.count({ where: { productId: id } });
    if (referenced > 0) {
      return res.status(409).json({
        success: false,
        error: 'لا يمكن حذف الطبق: مرتبط بفواتير سابقة. عطّل توفره بدلاً من الحذف.',
        statusCode: 409,
      });
    }

    await prisma.product.delete({ where: { id } });
    // Best-effort cleanup of the product's image (avoid orphaned files).
    if (product.imageUrl) {
      void deleteManagedAssets(getStorage(), product.restaurantId, [product.imageUrl]);
    }
    await logAuditEvent({
      restaurantId: product.restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'PRODUCT_DELETED',
      entity: 'Product',
      entityId: id,
      details: `تم حذف الطبق ${product.name}`,
    });
    return res.json({ success: true, message: 'تم حذف الطبق', statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر حذف الطبق', statusCode: 500 });
  }
});

// GET /api/manager/waiter-requests — paginated
router.get('/waiter-requests', async (req: Request, res: Response) => {
  const restaurantId = getTenantId(req);
  if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });
  if (!ownTenant(req, restaurantId)) return deny(req, res);

  const { take, skip } = parsePagination(req.query as Record<string, unknown>);
  const reqs = await prisma.waiterRequest.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  });
  return res.json({ success: true, data: reqs, statusCode: 200 });
});

// PUT /api/manager/waiter-requests/:id/status
router.put(
  '/waiter-requests/:id/status',
  requireServiceStaff(),
  validateBody(waiterStatusSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body as { status: 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED' | 'CANCELLED' };

      const existing = await prisma.waiterRequest.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ success: false, error: 'النداء غير موجود', statusCode: 404 });
      if (!ownTenant(req, existing.restaurantId)) return deny(req, res);

      const expectedStatus = status === 'ACKNOWLEDGED' ? 'PENDING' : status === 'RESOLVED' ? 'ACKNOWLEDGED' : null;
      if (status === existing.status) {
        return res.json({ success: true, data: existing, statusCode: 200 });
      }
      if (!expectedStatus || existing.status !== expectedStatus) {
        return res.status(409).json({
          success: false,
          error: `انتقال حالة نداء غير صالح من ${existing.status} إلى ${status}`,
          statusCode: 409,
        });
      }

      const changed = await prisma.waiterRequest.updateMany({
        where: { id, restaurantId: existing.restaurantId, status: expectedStatus },
        data: {
          status,
          resolvedAt: status === 'RESOLVED' ? new Date() : null,
        },
      });
      if (changed.count !== 1) {
        return res.status(409).json({
          success: false,
          error: 'تغيرت حالة النداء بواسطة مستخدم آخر. حدّث القائمة وحاول مجدداً.',
          statusCode: 409,
        });
      }
      const reqObj = (await prisma.waiterRequest.findUnique({ where: { id } }))!;

      if (status === 'RESOLVED') {
        const remainingActive = await prisma.waiterRequest.count({
          where: {
            tableId: reqObj.tableId,
            restaurantId: reqObj.restaurantId,
            status: { in: ['PENDING', 'ACKNOWLEDGED'] },
          },
        });
        if (remainingActive === 0) {
          await prisma.table.update({
            where: { id: reqObj.tableId },
            data: { hasWaiterCall: false },
          });
        }
      }

      realtimeService.broadcastToTable(
        reqObj.restaurantId,
        reqObj.tableId,
        'WAITER_STATUS_UPDATED',
        { id: reqObj.id, status: reqObj.status, tableId: reqObj.tableId }
      );

      await logAuditEvent({
        restaurantId: reqObj.restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'WAITER_STATUS_CHANGED',
        entity: 'WaiterRequest',
        entityId: id,
        details: `تم تغيير حالة النداء ${id} إلى ${status}`,
      });

      return res.json({ success: true, data: reqObj, statusCode: 200 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر تحديث حالة النداء', statusCode: 500 });
    }
  }
);

// GET /api/manager/export/orders (CSV Export — manager only, entitled plans)
router.get('/export/orders', requireManager(), async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });
    if (!ownTenant(req, restaurantId)) return deny(req, res);

    if (
      !isPlatformUser(req) &&
      !(await restaurantHasEntitlement(restaurantId, 'CAN_EXPORT_REPORTS'))
    ) {
      return res.status(403).json({
        success: false,
        error: 'تصدير التقارير متاح في باقة المحترفين والمؤسسات. قم بالترقية للمتابعة.',
        statusCode: 403,
      });
    }

    // Optional explicit range (ISO timestamps). Exports must never dump an
    // unbounded result set into memory; a hard cap bounds the response.
    const EXPORT_CAP = 10_000;
    const dateWhere: { createdAt?: { gte?: Date; lte?: Date } } = {};
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ success: false, error: '\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0628\u062f\u0627\u064a\u0629 \u063a\u064a\u0631 \u0635\u0627\u0644\u062d', statusCode: 400 });
      }
      dateWhere.createdAt = { ...dateWhere.createdAt, gte: d };
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ success: false, error: '\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0646\u0647\u0627\u064a\u0629 \u063a\u064a\u0631 \u0635\u0627\u0644\u062d', statusCode: 400 });
      }
      dateWhere.createdAt = { ...dateWhere.createdAt, lte: d };
    }

    const matchingCount = await prisma.order.count({
      where: { restaurantId, ...dateWhere },
    });
    if (matchingCount > EXPORT_CAP) {
      // Signals to operators the report is not exhaustive; narrow the range.
      res.setHeader('X-Export-Truncated', '1');
      res.setHeader('X-Export-Total-Matching', String(matchingCount));
    }

    const orders = await prisma.order.findMany({
      where: { restaurantId, ...dateWhere },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_CAP,
    });

    // \uFEFF BOM keeps Arabic text readable in Excel; every cell is
    // formula-injection neutralized (CWE-1236).
    let csv = '\uFEFFOrder ID,Table,Date,Status,Total,Items Count,Notes\n';
    orders.forEach((o) => {
      const itemsCount = o.items.reduce((s, i) => s + i.quantity, 0);
      csv +=
        [
          csvField(o.id),
          csvField(o.tableId),
          csvField(o.createdAt.toISOString()),
          csvField(o.status),
          csvField(o.total),
          csvField(itemsCount),
          csvField(o.notes || ''),
        ].join(',') + '\n';
    });

    const safeName = restaurantId.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-export-${safeName}-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ success: false, error: 'CSV Export Failed', statusCode: 500 });
  }
});

// ============================================================================
// REAL FEATURE SURFACE — Staff, Offers, Subscription, Branding, Branches,
// Payments (POS). Every handler re-verifies ownership of the target row
// against the JWT tenant (platform admins excepted).
// ============================================================================

// ---------- Table update (capacity/zone/status/branch) ----------
// Table write roles: managers (and platform admins) can change everything;
// floor staff may only flip table availability — cashier responsibility
// "الطاولات المتاحة" — but never renumber/rezone/move tables (priv-esc guard).
const TABLE_FULL_WRITE_ROLES = new Set(['RESTAURANT_MANAGER', 'PLATFORM_ADMIN', 'SUPER_ADMIN']);
const TABLE_STATUS_WRITE_ROLES = new Set(['CASHIER', 'WAITER', 'STAFF']);
const TABLE_STRUCTURAL_KEYS = ['tableNumber', 'capacity', 'zone', 'branchId', 'name'] as const;

router.put(
  '/tables/:id',
  requireServiceStaff(),
  validateBody(tableUpdateSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const table = await prisma.table.findUnique({ where: { id } });
      if (!table) return res.status(404).json({ success: false, error: 'الطاولة غير موجودة', statusCode: 404 });
      if (!ownTenant(req, table.restaurantId)) return deny(req, res);

      if (!TABLE_FULL_WRITE_ROLES.has(req.user!.role)) {
        const touchesStructural = TABLE_STRUCTURAL_KEYS.some((k) => k in (req.body as object));
        if (touchesStructural || !TABLE_STATUS_WRITE_ROLES.has(req.user!.role)) {
          return res.status(403).json({
            success: false,
            error: 'غير مصرح بتعديل بيانات الطاولة — يمكنك تغيير حالة الطاولة فقط',
            statusCode: 403,
          });
        }
      }

      const { tableNumber, capacity, zone, status, branchId, name } = req.body as {
        tableNumber?: number;
        capacity?: number;
        zone?: TableZone;
        status?: TableStatus;
        branchId?: string | '' | null;
        name?: string;
      };

      if (tableNumber !== undefined && tableNumber !== table.number) {
        const duplicate = await prisma.table.findFirst({
          where: { restaurantId: table.restaurantId, number: tableNumber },
        });
        if (duplicate) {
          return res.status(409).json({ success: false, error: `يوجد طاولة برقم ${tableNumber} بالفعل`, statusCode: 409 });
        }
      }

      if (branchId) {
        const branch = await prisma.branch.findUnique({ where: { id: branchId } });
        if (!branch || branch.restaurantId !== table.restaurantId) {
          return res.status(400).json({ success: false, error: 'الفرع المحدد لا ينتمي لمطعمك', statusCode: 400 });
        }
      }

      // Only the owning tenant may move its table between its own branches.
      const updated = await prisma.table.update({
        where: { id },
        data: {
          number: tableNumber !== undefined ? tableNumber : undefined,
          name: name !== undefined ? name : undefined,
          capacity: capacity !== undefined ? capacity : undefined,
          zone: zone !== undefined ? zone : undefined,
          status: status !== undefined ? status : undefined,
          branchId: branchId !== undefined ? (branchId || null) : undefined,
        },
      });

      await logAuditEvent({
        restaurantId: table.restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'TABLE_UPDATED',
        entity: 'Table',
        entityId: id,
        details: `تم تحديث بيانات الطاولة ${id}`,
      });

      return res.json({ success: true, data: { table: updated }, statusCode: 200 });
    } catch (err) {
      console.error('Table update error:', err);
      return res.status(500).json({ success: false, error: 'تعذر تحديث الطاولة', statusCode: 500 });
    }
  }
);

// ---------- Staff management (tenant users) ----------

const STAFF_SAFE_SELECT = {
  id: true,
  restaurantId: true,
  name: true,
  email: true,
  username: true,
  role: true,
  status: true,
  avatar: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

const PLATFORM_ROLE_SET = new Set(['PLATFORM_ADMIN', 'SUPER_ADMIN']);

router.get('/staff', requireManager(), async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);

    // hasPin is computed server-side: the hash itself never leaves the DB.
    const rows = await prisma.restaurantUser.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'asc' },
      select: { ...STAFF_SAFE_SELECT, pinHash: true },
    });
    const staff = rows.map((r) => {
      const hasPin = !!r.pinHash;
      const { pinHash, ...safe } = r;
      return { ...safe, hasPin };
    });
    return res.json({ success: true, data: staff, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع الموظفين', statusCode: 500 });
  }
});

router.post(
  '/staff',
  requireManager(),
  staffMutationLimiter,
  validateBody(staffCreateSchema),
  async (req: Request, res: Response) => {
    try {
      const restaurantId = getTenantId(req);
      if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);

      const { name, email, username, password, pin, role } = req.body as {
        name: string;
        email?: string;
        username?: string;
        password?: string;
        pin?: string;
        role: 'RESTAURANT_MANAGER' | 'WAITER' | 'KITCHEN' | 'CASHIER' | 'STAFF';
      };

      // Creating staff is a sensitive operation: require fresh step-up
      // verification (password) from the manager.
      if (!requireStepUp(req, res)) return;

      const isManagerRole = role === 'RESTAURANT_MANAGER';

      // ---- Credential policy (2026-09 auth redesign) --------------------
      // Managers:      email + strong password (NO PIN — never PIN-only).
      // Shift staff:   per-tenant username + 6-digit PIN (NO password and
      //                NO email — synthetic emails and derived
      //                `Staff-{PIN}!` passwords are permanently gone).
      if (isManagerRole) {
        if (!email) {
          return res.status(400).json({ success: false, error: 'البريد الإلكتروني مطلوب لحساب المدير', statusCode: 400 });
        }
        if (!password) {
          return res.status(400).json({ success: false, error: 'كلمة مرور قوية (8 أحرف فأكثر) مطلوبة لحساب المدير', statusCode: 400 });
        }
        if (pin) {
          return res.status(400).json({ success: false, error: 'حسابات المديرين لا تستخدم رمز PIN — البريد وكلمة المرور فقط', statusCode: 400 });
        }
      } else {
        if (!username) {
          return res.status(400).json({ success: false, error: 'اسم المستخدم مطلوب للموظف (يستخدمه في دخول الموظفين)', statusCode: 400 });
        }
        if (!pin) {
          return res.status(400).json({ success: false, error: 'رمز PIN من 6 أرقام مطلوب للموظف', statusCode: 400 });
        }
        if (password) {
          return res.status(400).json({ success: false, error: 'حسابات الموظفين لا تحمل كلمات مرور — اسم المستخدم ورمز PIN فقط', statusCode: 400 });
        }
      }

      const normalizedEmail = email ? email.toLowerCase() : undefined;
      if (normalizedEmail) {
        const existing = await prisma.restaurantUser.findUnique({ where: { email: normalizedEmail } });
        if (existing) return res.status(409).json({ success: false, error: 'هذا البريد مستخدم مسبقًا', statusCode: 409 });
      }
      if (username) {
        const existingUsername = await prisma.restaurantUser.findUnique({
          where: { restaurantId_username: { restaurantId: String(restaurantId), username } },
        });
        if (existingUsername) {
          return res.status(409).json({ success: false, error: 'اسم المستخدم مستخدم مسبقاً في هذا المطعم', statusCode: 409 });
        }
      }

      const user = await prisma.restaurantUser.create({
        data: {
          id: `user-${randomUUID()}`,
          restaurantId,
          name,
          email: normalizedEmail,
          username: username || undefined,
          // Shift staff never receive a password: passwordHash is a NOT NULL
          // column, so an unguessable random value is stored and NO route
          // will ever accept it (password login rejects shift roles first).
          passwordHash: password
            ? await bcrypt.hash(password, 12)
            : await bcrypt.hash(`no-password-${randomUUID()}`, 12),
          pinHash: pin ? await bcrypt.hash(pin, 10) : undefined,
          role,
          status: 'ACTIVE',
        },
        select: STAFF_SAFE_SELECT,
      });
      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'STAFF_CREATED',
        entity: 'RestaurantUser',
        entityId: user.id,
        details: `تمت إضافة موظف ${name} بدور ${role} — ${isManagerRole ? 'دخول بالبريد وكلمة المرور' : `دخول الموظفين (اسم المستخدم: ${username})`}`,
        ipAddress: req.ip,
      });
      return res.status(201).json({ success: true, data: { user }, statusCode: 201 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر إضافة الموظف', statusCode: 500 });
    }
  }
);

router.put(
  '/staff/:id',
  requireManager(),
  staffMutationLimiter,
  validateBody(staffUpdateSchema),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const target = await prisma.restaurantUser.findUnique({ where: { id } });
      if (!target) return res.status(404).json({ success: false, error: 'الموظف غير موجود', statusCode: 404 });
      if (!target.restaurantId || !ownTenant(req, target.restaurantId)) return deny(req, res);

      // Tenant managers can never touch platform accounts through this route.
      if (PLATFORM_ROLE_SET.has(target.role) && !isPlatformUser(req)) {
        return deny(req, res, 'غير مصرح لك بتعديل حسابات إدارة المنصة');
      }

      const { name, username, email, role, status, password, pin } = req.body as {
        name?: string;
        username?: string;
        email?: string;
        role?: 'RESTAURANT_MANAGER' | 'WAITER' | 'KITCHEN' | 'CASHIER' | 'STAFF';
        status?: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
        password?: string;
        pin?: string;
      };

      // Sensitive changes (credentials / role / status) require fresh
      // step-up verification. Plain name edits stay friction-free.
      const sensitiveChange =
        username !== undefined ||
        email !== undefined ||
        role !== undefined ||
        status !== undefined ||
        password !== undefined ||
        pin !== undefined;
      if (sensitiveChange && !requireStepUp(req, res)) return;

      // Nobody may change their own role or status (self-lockout / self-heal).
      if (req.user!.id === id && (role !== undefined || status !== undefined)) {
        return res.status(400).json({
          success: false,
          error: 'لا يمكنك تغيير دورك أو حالتك بنفسك. اطلب ذلك من مدير آخر.',
          statusCode: 400,
        });
      }

      // Last-manager protection: a tenant must keep at least one active manager.
      const demotingManager =
        target.role === 'RESTAURANT_MANAGER' &&
        ((role !== undefined && role !== 'RESTAURANT_MANAGER') ||
          (status !== undefined && status !== 'ACTIVE'));
      if (demotingManager && !isPlatformUser(req)) {
        const otherManagers = await prisma.restaurantUser.count({
          where: {
            restaurantId: target.restaurantId,
            role: 'RESTAURANT_MANAGER',
            status: 'ACTIVE',
            id: { not: id },
          },
        });
        if (otherManagers === 0) {
          return res.status(400).json({
            success: false,
            error: 'لا يمكن إزالة آخر مدير نشط للمطعم. عيّن مديراً آخر أولاً.',
            statusCode: 400,
          });
        }
      }

      // ---- Role-transition credential completeness -----------------------
      // The target must end up with the credentials its NEW role requires:
      //   manager     → email + password (PIN is not used);
      //   shift staff → username + PIN (password/email not used).
      const effectiveRole = role ?? target.role;
      const willBeManager = effectiveRole === 'RESTAURANT_MANAGER';
      const effectivePin = pin === undefined ? null : pin === '' ? null : pin;
      const effectivePassword = password ?? null;

      if (willBeManager) {
        if (pin !== undefined && pin !== '') {
          return res.status(400).json({ success: false, error: 'حسابات المديرين لا تستخدم رمز PIN', statusCode: 400 });
        }
        const effectiveEmail = email ?? target.email;
        if (!effectiveEmail || !effectivePassword) {
          return res.status(400).json({
            success: false,
            error: 'عند تحويل الموظف إلى مدير: أدخل بريداً إلكترونياً وكلمة مرور قوية له',
            statusCode: 400,
          });
        }
        // Hygiene: managers do not use PIN login — clear a legacy shift PIN
        // when the account moves to the manager model.
        if (target.pinHash && pin === undefined) {
          await prisma.restaurantUser.update({
            where: { id },
            data: { pinHash: null },
          });
        }
      } else {
        if (password) {
          return res.status(400).json({ success: false, error: 'حسابات الموظفين لا تحمل كلمات مرور', statusCode: 400 });
        }
        const effectiveUsername = username ?? target.username;
        if (!effectiveUsername) {
          return res.status(400).json({
            success: false,
            error: 'اسم المستخدم مطلوب للموظف قبل تحويله إلى دور تشغيلي',
            statusCode: 400,
          });
        }
      }

      // Username uniqueness within the tenant (when changed).
      if (username !== undefined && username !== target.username) {
        const clash = await prisma.restaurantUser.findUnique({
          where: { restaurantId_username: { restaurantId: target.restaurantId!, username } },
        });
        if (clash) {
          return res.status(409).json({ success: false, error: 'اسم المستخدم مستخدم مسبقاً في هذا المطعم', statusCode: 409 });
        }
      }

      const credentialsChanged =
        password !== undefined ||
        (pin !== undefined && pin !== '') ||
        username !== undefined ||
        email !== undefined ||
        (role !== undefined && role !== target.role) ||
        (status !== undefined && status !== target.status);

      if (email !== undefined && email !== target.email) {
        const emailClash = await prisma.restaurantUser.findUnique({ where: { email } });
        if (emailClash) {
          return res.status(409).json({ success: false, error: 'هذا البريد مستخدم مسبقًا', statusCode: 409 });
        }
      }

      const updated = await prisma.restaurantUser.update({
        where: { id },
        data: {
          name: name !== undefined ? name : undefined,
          email: email !== undefined ? email : undefined,
          username: username !== undefined ? username : undefined,
          role: role !== undefined ? role : undefined,
          status: status !== undefined ? status : undefined,
          passwordHash: password ? await bcrypt.hash(password, 12) : undefined,
          pinHash:
            pin !== undefined && pin !== ''
              ? await bcrypt.hash(pin, 10)
              : pin === ''
                ? null
                : undefined,
          // Revoke the target's sessions when their authority changes, and
          // reset the per-account failure budget so a re-issued credential
          // doubles as an early unlock (AUTH-02 recovery path).
          tokenVersion: credentialsChanged ? { increment: 1 } : undefined,
          failedAuthCount: credentialsChanged ? 0 : undefined,
          authLockedUntil: credentialsChanged ? null : undefined,
        },
        select: STAFF_SAFE_SELECT,
      });
      await logAuditEvent({
        restaurantId: target.restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'STAFF_UPDATED',
        entity: 'RestaurantUser',
        entityId: id,
        details: `تم تحديث بيانات الموظف ${target.name}` +
          (role !== undefined && role !== target.role ? ` — تغيير الدور من ${target.role} إلى ${role}` : '') +
          (status !== undefined && status !== target.status ? ` — تغيير الحالة إلى ${status}` : '') +
          (password !== undefined ? ' — تغيير كلمة المرور' : '') +
          (pin !== undefined ? (pin === '' ? ' — إلغاء رمز PIN' : ' — إعادة إصدار رمز PIN') : '') +
          (username !== undefined ? ' — تغيير اسم المستخدم' : '') +
          (email !== undefined ? ' — تغيير البريد' : ''),
        ipAddress: req.ip,
      });
      return res.json({ success: true, data: { user: updated }, statusCode: 200 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر تحديث الموظف', statusCode: 500 });
    }
  }
);

router.delete('/staff/:id', requireManager(), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    // Deleting a user record is destructive (historical attribution moves to
    // SetNull). Prefer DEACTIVATION (status=INACTIVE) — deletion requires a
    // fresh step-up verification on top of the manager role.
    if (!requireStepUp(req, res)) return;
    const target = await prisma.restaurantUser.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ success: false, error: 'الموظف غير موجود', statusCode: 404 });
    if (!target.restaurantId || !ownTenant(req, target.restaurantId)) return deny(req, res);
    if (PLATFORM_ROLE_SET.has(target.role) && !isPlatformUser(req)) {
      return deny(req, res, 'غير مصرح لك بحذف حسابات إدارة المنصة');
    }
    if (req.user!.id === id) return res.status(400).json({ success: false, error: 'لا يمكنك حذف حسابك الحالي', statusCode: 400 });

    if (target.role === 'RESTAURANT_MANAGER' && target.status === 'ACTIVE' && !isPlatformUser(req)) {
      const otherManagers = await prisma.restaurantUser.count({
        where: {
          restaurantId: target.restaurantId,
          role: 'RESTAURANT_MANAGER',
          status: 'ACTIVE',
          id: { not: id },
        },
      });
      if (otherManagers === 0) {
        return res.status(400).json({
          success: false,
          error: 'لا يمكن حذف آخر مدير نشط للمطعم. عيّن مديراً آخر أولاً.',
          statusCode: 400,
        });
      }
    }

    await prisma.restaurantUser.delete({ where: { id } });
    await logAuditEvent({
      restaurantId: target.restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'STAFF_DELETED',
      entity: 'RestaurantUser',
      entityId: id,
      details: `تم حذف الموظف ${target.name}`,
    });
    return res.json({ success: true, message: 'تم حذف الموظف', statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر حذف الموظف', statusCode: 500 });
  }
});

// ---------- Offers management ----------
router.get('/offers', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
    const offers = await prisma.offer.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
    });
    // Catalog image contract on read: a stored key becomes a renderable URL,
    // every other stored form is returned exactly as stored.
    return res.json({
      success: true,
      data: offers.map((offer: { image: string | null }) => ({
        ...offer,
        image: resolveCatalogImage(offer.image) || null,
        imageStoragePath: offer.image || null,
      })),
      statusCode: 200,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع العروض', statusCode: 500 });
  }
});

router.post(
  '/offers',
  requireManager(),
  validateBody(offerCreateSchema),
  async (req: Request, res: Response) => {
    try {
      const restaurantId = getTenantId(req);
      if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
      const b = req.body as {
        title: string;
        titleEn?: string;
        subtitle?: string;
        description?: string;
        image?: string;
        originalPrice?: number;
        discountedPrice?: number;
        discountPercentage?: number;
        badge?: string;
        bgGradient?: string;
        isActive?: boolean;
        code?: string;
      };
      // Offer photo: same persistence contract as dish photos and branding —
      // the database keeps the stable key, the response carries the URL.
      const offerImage =
        b.image !== undefined && b.image !== null
          ? await persistCatalogImage(String(b.image), restaurantId)
          : undefined;
      if (offerImage && !offerImage.ok) {
        return res.status(400).json({
          success: false,
          error: offerImage.error,
          statusCode: 400,
        });
      }

      const offer = await prisma.offer.create({
        data: {
          id: `offer-${randomUUID()}`,
          restaurantId,
          title: b.title,
          titleEn: b.titleEn || undefined,
          subtitle: b.subtitle || undefined,
          description: b.description || undefined,
          image: offerImage?.ref || undefined,
          originalPrice: b.originalPrice,
          discountedPrice: b.discountedPrice,
          discountPercentage: b.discountPercentage,
          badge: b.badge || undefined,
          bgGradient: b.bgGradient || undefined,
          isActive: b.isActive !== false,
          code: b.code || undefined,
        },
      });
      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'OFFER_CREATED',
        entity: 'Offer',
        entityId: offer.id,
        details: `تم إنشاء عرض ${b.title}`,
      });
      return res.status(201).json({
        success: true,
        data: {
          offer: {
            ...offer,
            image: resolveCatalogImage(offer.image) || null,
            imageStoragePath: offer.image || null,
          },
        },
        statusCode: 201,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر إنشاء العرض', statusCode: 500 });
    }
  }
);

router.put(
  '/offers/:id',
  requireManager(),
  validateBody(offerUpdateSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await prisma.offer.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ success: false, error: 'العرض غير موجود', statusCode: 404 });
      if (!ownTenant(req, existing.restaurantId)) return deny(req, res);
      const b = req.body as {
        title?: string;
        titleEn?: string;
        subtitle?: string;
        description?: string;
        image?: string;
        originalPrice?: number;
        discountedPrice?: number;
        discountPercentage?: number;
        badge?: string;
        bgGradient?: string;
        isActive?: boolean;
        code?: string;
      };
      // Offer photo goes through the same catalog image contract as dish photos
      // (omitted = unchanged, '' = explicit clear, managed URL = folded to key).
      const offerImage =
        b.image !== undefined && b.image !== null
          ? await persistCatalogImage(String(b.image), existing.restaurantId)
          : undefined;
      if (offerImage && !offerImage.ok) {
        return res.status(400).json({
          success: false,
          error: offerImage.error,
          statusCode: 400,
        });
      }

      const updated = await prisma.offer.update({
        where: { id },
        data: {
          title: b.title !== undefined ? b.title : undefined,
          titleEn: b.titleEn !== undefined ? b.titleEn : undefined,
          subtitle: b.subtitle !== undefined ? b.subtitle : undefined,
          description: b.description !== undefined ? b.description : undefined,
          image: offerImage ? offerImage.ref : undefined,
          originalPrice: b.originalPrice !== undefined ? b.originalPrice : undefined,
          discountedPrice: b.discountedPrice !== undefined ? b.discountedPrice : undefined,
          discountPercentage: b.discountPercentage !== undefined ? b.discountPercentage : undefined,
          badge: b.badge !== undefined ? b.badge : undefined,
          bgGradient: b.bgGradient !== undefined ? b.bgGradient : undefined,
          isActive: b.isActive !== undefined ? b.isActive : undefined,
          code: b.code !== undefined ? b.code : undefined,
        },
      });
      // Best-effort cleanup of a replaced offer image, AFTER the DB commit.
      // Folded keys are compared so round-tripping the same asset as a URL
      // never deletes the object the row still references.
      if (
        b.image !== undefined &&
        existing.image &&
        foldCatalogImageKey(existing.image) !== foldCatalogImageKey(b.image)
      ) {
        void deleteManagedAssets(getStorage(), existing.restaurantId, [existing.image]);
      }
      return res.json({
        success: true,
        data: {
          offer: {
            ...updated,
            image: resolveCatalogImage(updated.image) || null,
            imageStoragePath: updated.image || null,
          },
        },
        statusCode: 200,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر تعديل العرض', statusCode: 500 });
    }
  }
);

router.delete('/offers/:id', requireManager(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.offer.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: 'العرض غير موجود', statusCode: 404 });
    if (!ownTenant(req, existing.restaurantId)) return deny(req, res);
    await prisma.offer.delete({ where: { id } });
    // Best-effort cleanup of the offer image (avoid orphaned files).
    if (existing.image) {
      void deleteManagedAssets(getStorage(), existing.restaurantId, [existing.image]);
    }
    await logAuditEvent({
      restaurantId: existing.restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'OFFER_DELETED',
      entity: 'Offer',
      entityId: id,
      details: `تم حذف العرض ${existing.title}`,
    });
    return res.json({ success: true, message: 'تم حذف العرض', statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر حذف العرض', statusCode: 500 });
  }
});

// ---------- Subscription (current + plan catalog + change plan) ----------
router.get('/subscription', requireManager(), async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
    const subscription = await prisma.subscription.findUnique({
      where: { restaurantId },
      include: { plan: true },
    });
    const plans = await prisma.plan.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ priceMonthly: 'asc' }, { id: 'asc' }],
    });
    // Additive computed fields: effectiveStatus applies period-end / grace
    // rules without mutating the stored row; clients may ignore these safely.
    const effective = effectiveSubscriptionState(subscription);
    const subscriptionWithState = subscription
      ? {
          ...subscription,
          effectiveStatus: effective.effectiveStatus,
          entitlementActive: effective.entitled,
          daysRemaining: effective.daysRemaining,
          daysPastDue: effective.daysPastDue,
        }
      : subscription;
    // trialDays is derived server-side so no client hardcodes the trial length.
    return res.json({ success: true, data: { subscription: subscriptionWithState, plans: plans.map(withTrialMeta) }, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع الاشتراك', statusCode: 500 });
  }
});

router.put(
  '/subscription/plan',
  requireManager(),
  validateBody(planChangeSchema),
  async (req: Request, res: Response) => {
    try {
      const restaurantId = getTenantId(req);
      if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
      const { planId } = req.body as { planId: string };
      const plan = await prisma.plan.findUnique({ where: { id: planId } });
      if (!plan || plan.status !== 'ACTIVE') {
        return res.status(400).json({ success: false, error: 'الباقة المحددة غير متاحة', statusCode: 400 });
      }
      // Audit H-02: authorize the *transition*, not merely the target plan.
      // Trusting a client-supplied planId let any manager grant themselves a
      // higher-tier plan for free, since no payment provider is wired up.
      const currentSubscription = await prisma.subscription.findUnique({
        where: { restaurantId },
        include: { plan: true },
      });
      const verdict = evaluatePlanChange({
        current: currentSubscription?.plan ?? null,
        target: plan,
        isPlatformActor: isPlatformUser(req),
      });
      if (!verdict.allowed) {
        // 402 = a paid UPGRADE. There is no payment gateway, so the manager
        // never receives the paid plan: the request is recorded as an audit
        // event platform staff see in their overview/audit feed, and we
        // answer 202 Accepted ("request received, pending approval"). Payment
        // is settled out-of-band and a platform admin then activates the
        // target plan (platform override below). 403 (free-trial self-grant)
        // remains a hard rejection.
        if (verdict.statusCode === 402) {
          await logAuditEvent({
            restaurantId,
            userId: req.user!.id,
            actor: req.user!.name,
            actorRole: req.user!.role,
            action: 'SUBSCRIPTION_UPGRADE_REQUESTED',
            entity: 'Subscription',
            entityId: restaurantId,
            details: `طلب ترقية مدفوع إلى ${plan.name} (${planId}) بانتظار موافقة إدارة المنصة بعد التحقق من الدفع.`,
            metadata: {
              targetPlanId: plan.id,
              targetPlanName: plan.name,
              targetPriceMonthly: plan.priceMonthly,
              requestedAt: new Date().toISOString(),
            },
            ipAddress: req.ip,
          });
          return res.status(202).json({
            success: true,
            data: {
              pending: true,
              requestStatus: 'PENDING_PLATFORM_APPROVAL',
              requestedPlanId: plan.id,
            },
            message: verdict.reason,
            statusCode: 202,
          });
        }
        await logAuditEvent({
          restaurantId,
          userId: req.user!.id,
          actor: req.user!.name,
          actorRole: req.user!.role,
          action: 'PLAN_CHANGE_DENIED',
          entity: 'Subscription',
          entityId: restaurantId,
          details: `محاولة تغيير الباقة إلى ${plan.name} رُفضت: ${verdict.reason}`,
          ipAddress: req.ip,
        });
        return res.status(verdict.statusCode).json({
          success: false,
          error: verdict.reason,
          statusCode: verdict.statusCode,
        });
      }
      // A downgrade is entitlements-only: we change the plan binding (which
      // locks the higher-tier features and new-usage ceilings) but NEVER
      // delete the tenant's existing rows. Rows that now exceed the target
      // plan's ceilings are simply left in place — the plan's create-guards
      // and entitlement gates take effect going forward. Blocking the change
      // here (or pruning data) would destroy a paying tenant's history, so we
      // intentionally allow it to proceed.
      const platformActivation = isPlatformUser(req);
      const now = new Date();
      const freshPeriod = {
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400 * 1000),
      };
      const subscription = await prisma.subscription.upsert({
        where: { restaurantId },
        create: {
          restaurantId,
          planId,
          status: 'ACTIVE',
          ...freshPeriod,
        },
        update: platformActivation
          ? {
              // Admin approval of an upgrade (out-of-band payment confirmed):
              // open a fresh ACTIVE period and clear a PAST_DUE/CANCELLED
              // state. Tenant self-downgrades never touch period or status.
              planId,
              status: 'ACTIVE',
              cancelAtPeriodEnd: false,
              ...freshPeriod,
            }
          : { planId },
      });
      await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { planId },
      });
      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'PLAN_CHANGED',
        entity: 'Subscription',
        entityId: subscription.id,
        details: `تم تغيير باقة الاشتراك إلى ${plan.name}${platformActivation ? ' (تفعيل من إدارة المنصة)' : ''}`,
        metadata: { targetPlanId: planId, platformActivation },
        ipAddress: req.ip,
      });
      return res.json({ success: true, data: { subscription }, statusCode: 200 });
    } catch (err) {
      console.error('Change plan error:', err);
      return res.status(500).json({ success: false, error: 'تعذر تغيير الباقة', statusCode: 500 });
    }
  }
);

// ---------- Branding ----------
router.put(
  '/branding',
  requireManager(),
  validateBody(brandingSchema),
  async (req: Request, res: Response) => {
    try {
      const restaurantId = getTenantId(req);
      if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
      const b = req.body as {
        name?: string;
        nameEn?: string;
        description?: string;
        phone?: string;
        address?: string;
        logo?: string;
        coverImage?: string;
        currency?: string;
        language?: string;
        timezone?: string;
        primaryColor?: string;
        accentColor?: string;
        logoFit?: 'cover' | 'contain';
        logoPosition?: string;
        businessType?: 'RESTAURANT' | 'CAFE' | 'BAKERY';
        promoVideoUrl?: string;
        galleryImages?: string[];
        latitude?: number;
        longitude?: number;
        mapUrl?: string | '';
        mapImage?: string;
        // Customer transfer payment details. Same contract as every other field
        // here: `undefined` (omitted) leaves the column untouched, `''` is an
        // explicit clear. Never gated by an entitlement (see below).
        transferBankName?: string;
        transferBankAccount?: string;
        transferBankAccountHolder?: string;
        transferWalletName?: string;
        transferWalletNumber?: string;
        transferWalletAccountHolder?: string;
        transferInstructions?: string;
        // Contact channels & reservations. Same contract as every other field
        // here: `undefined` (omitted) leaves the column untouched, `''` is an
        // explicit clear. Already validated by `validateBody(brandingSchema)`
        // (HTTPS + per-platform host allowlist, no credentials, no control
        // characters). Never gated by an entitlement.
        whatsappNumber?: string;
        instagramUrl?: string;
        facebookUrl?: string;
        tiktokUrl?: string;
        youtubeUrl?: string;
        websiteUrl?: string;
      };

      const hasCustomBrandingFields =
        b.promoVideoUrl !== undefined ||
        b.galleryImages !== undefined;

      if (
        hasCustomBrandingFields &&
        !isPlatformUser(req) &&
        !(await restaurantHasEntitlement(restaurantId, 'CAN_CUSTOM_BRANDING'))
      ) {
        return res.status(403).json({
          success: false,
          error: 'تخصيص معرض الصور الترويجي وفيديو الأجواء يتطلب باقة المحترفين الفاخرة أو باقة المؤسسات.',
          statusCode: 403,
        });
      }

      // ------------------------------------------------------------------
      // Image fields — the persistent-reference contract (STEP 10/11):
      //
      //   field omitted          -> UNCHANGED (Prisma `undefined`)
      //   null / ''              -> EXPLICIT deletion (a separate,
      //                              intentional operation)
      //   managed URL or key     -> folded into the tenant-scoped object
      //                              key (host-independent stable path)
      //   external http(s) URL   -> persisted verbatim (stable by design)
      //   data: / blob: / script -> REJECTED — never persisted
      //
      // The database holds the stable reference; the response below carries
      // BOTH the resolved renderable URL and the reference itself.
      // ------------------------------------------------------------------
      const storage = getStorage();
      const normalizer = assetNormalizerFor(storage);

      // The persistable reference of a normalized asset: the stable key
      // (managed) or the external URL — undefined for clear/reject. A
      // `reject` never reaches here (400'd above); this keeps the union
      // narrowed for the compiler as well as for runtime.
      const persistableRef = (n: NormalizedAsset): string | undefined =>
        n.kind === 'key' || n.kind === 'external' ? n.reference : undefined;

      const normLogo: NormalizedAsset | undefined =
        b.logo !== undefined ? normalizeAssetReference(b.logo, normalizer) : undefined;
      const normCover: NormalizedAsset | undefined =
        b.coverImage !== undefined ? normalizeAssetReference(b.coverImage, normalizer) : undefined;
      const normMap: NormalizedAsset | undefined =
        b.mapImage !== undefined ? normalizeAssetReference(b.mapImage, normalizer) : undefined;
      const normGallery: NormalizedAsset[] | undefined =
        b.galleryImages !== undefined
          ? b.galleryImages.map((u) => normalizeAssetReference(u, normalizer))
          : undefined;

      const rejected = [
        ...(normLogo ? [normLogo] : []),
        ...(normCover ? [normCover] : []),
        ...(normMap ? [normMap] : []),
        ...(normGallery ?? []),
      ].filter(
        (n): n is Extract<NormalizedAsset, { kind: 'reject' }> => n.kind === 'reject'
      );
      if (rejected.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'رابط الصورة غير صالح — ارفع الصورة عبر زر الرفع من جهازك ثم احفظ مجدداً',
          statusCode: 400,
        });
      }

      // Tenant isolation: a managed storage key always lives under its owner
      // tenant's folder (`restaurants/{tenantId}/…`). A tenant can never
      // point its theme at another restaurant's asset or at a key outside
      // its own namespace — the same boundary the upload/delete routes enforce.
      const keyTenantError = (
        n: NormalizedAsset | undefined,
        label: string
      ): string | null => {
        if (n && n.kind === 'key' && !keyBelongsToRestaurant(n.reference, restaurantId)) {
          return `رابط ${label} لا ينتمي لمطعمك`;
        }
        return null;
      };
      for (const [label, n] of [
        ['الشعار', normLogo],
        ['صورة الغلاف', normCover],
        ['صورة الخريطة', normMap],
      ] as const) {
        const tenantError = keyTenantError(n, label);
        if (tenantError) {
          return res.status(400).json({
            success: false,
            error: tenantError,
            statusCode: 400,
          });
        }
      }
      if (normGallery) {
        for (const n of normGallery) {
          if (n.kind === 'key' && !keyBelongsToRestaurant(n.reference, restaurantId)) {
            return res.status(400).json({
              success: false,
              error: 'رابط صورة المعرض لا ينتمي لمطعمك',
              statusCode: 400,
            });
          }
        }
      }

      // Capture the pre-update references so replaced images can be cleaned
      // up AFTER the database commit succeeds (never before — see rule 7).
      const existing = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: {
          logoUrl: true,
          coverImageUrl: true,
          mapImageUrl: true,
          galleryImages: true,
        },
      });

      // Fold any legacy stored form (absolute local URL on any host, Supabase
      // public URL, raw key) down to the object key for change comparison.
      const foldToKey = (v: string | null | undefined): string | null => {
        if (!v) return null;
        const t = String(v).trim();
        if (!t) return null;
        if (isStorageKey(t)) return t;
        try {
          return storage.keyFromUrl(t);
        } catch {
          return null;
        }
      };

      // Customer transfer payment details: the venue's receiving account shown
      // to the guest in the transfer modal. Plain nullable TEXT columns — no
      // storage driver, no asset normalization and NO entitlement gate (a venue
      // must be able to publish its own account on any plan). Same write
      // semantics as every field above: omitted -> `undefined` (column
      // untouched), '' -> `null` (explicit clear), otherwise the trimmed value
      // `validateBody(brandingSchema)` already bounded and character-checked.
      // Values are never written to the audit log below (no IBAN / wallet
      // number in AuditLog.details or metadata).
      const transferColumn = (value: string | undefined): string | null | undefined => {
        if (value === undefined) return undefined;
        if (value.trim() === '') return null;
        return value;
      };

      // Contact channels & reservations: plain nullable TEXT columns, no
      // storage driver and NO entitlement gate. Same write semantics as the
      // transfer fields. The WhatsApp number is additionally NORMALIZED to
      // canonical E.164 (`+` + digits) so the guest-side `wa.me` deep link is
      // built from one shape only; a value `validateBody` already accepted can
      // always be normalized, and `null` (the fallback) means "no reservation
      // channel", which is what hides the CTA on the Live Menu.
      const whatsappColumn = (value: string | undefined): string | null | undefined => {
        if (value === undefined) return undefined;
        if (value.trim() === '') return null;
        return normalizeWhatsappNumber(value)?.e164 ?? null;
      };

      const updated = await prisma.restaurant.update({
        where: { id: restaurantId },
        data: {
          name: b.name !== undefined ? b.name : undefined,
          nameEn: b.nameEn !== undefined ? b.nameEn : undefined,
          description: b.description !== undefined ? b.description : undefined,
          phone: b.phone !== undefined ? b.phone : undefined,
          address: b.address !== undefined ? b.address : undefined,
          // Omitted -> undefined (unchanged); explicit clear -> '';
          // otherwise the stable reference itself (key or external URL).
          logoUrl: normLogo
            ? normLogo.kind === 'clear'
              ? ''
              : persistableRef(normLogo)
            : undefined,
          coverImageUrl: normCover
            ? normCover.kind === 'clear'
              ? null
              : persistableRef(normCover)
            : undefined,
          currency: b.currency !== undefined ? b.currency : undefined,
          language: b.language !== undefined ? b.language : undefined,
          timezone: b.timezone !== undefined ? b.timezone : undefined,
          primaryColor: b.primaryColor !== undefined ? b.primaryColor : undefined,
          accentColor: b.accentColor !== undefined ? b.accentColor : undefined,
          logoFit: b.logoFit !== undefined ? b.logoFit : undefined,
          logoPosition: b.logoPosition !== undefined ? b.logoPosition : undefined,
          // Venue kind is descriptive metadata, not paid visual customisation,
          // so it is deliberately outside `hasCustomBrandingFields` above.
          businessType: b.businessType !== undefined ? b.businessType : undefined,
          promoVideoUrl: b.promoVideoUrl !== undefined ? b.promoVideoUrl : undefined,
          galleryImages: normGallery
            ? normGallery
                .map((g) => persistableRef(g) ?? '')
                .filter((u) => u !== '')
            : undefined,
          latitude: b.latitude !== undefined ? b.latitude : undefined,
          longitude: b.longitude !== undefined ? b.longitude : undefined,
          mapUrl:
            b.mapUrl !== undefined
              ? b.mapUrl === ''
                ? null
                : b.mapUrl
              : undefined,
          mapImageUrl: normMap
            ? normMap.kind === 'clear'
              ? null
              : persistableRef(normMap)
            : undefined,
          transferBankName: transferColumn(b.transferBankName),
          transferBankAccount: transferColumn(b.transferBankAccount),
          transferBankAccountHolder: transferColumn(b.transferBankAccountHolder),
          transferWalletName: transferColumn(b.transferWalletName),
          transferWalletNumber: transferColumn(b.transferWalletNumber),
          transferWalletAccountHolder: transferColumn(b.transferWalletAccountHolder),
          transferInstructions: transferColumn(b.transferInstructions),
          // Contact channels & reservations (see `whatsappColumn` above).
          whatsappNumber: whatsappColumn(b.whatsappNumber),
          instagramUrl: transferColumn(b.instagramUrl),
          facebookUrl: transferColumn(b.facebookUrl),
          tiktokUrl: transferColumn(b.tiktokUrl),
          youtubeUrl: transferColumn(b.youtubeUrl),
          websiteUrl: transferColumn(b.websiteUrl),
        },
      });
      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'BRANDING_UPDATED',
        entity: 'Restaurant',
        entityId: restaurantId,
        details: `تم تحديث هوية المطعم البصرية`,
      });

      // Separate, VALUE-FREE audit trail for the transfer receiving account:
      // which fields changed is operationally useful, the values are not — an
      // IBAN or a wallet number must never land in AuditLog.details/metadata
      // (it is a settings table, not a secret store, and audit rows are read by
      // platform staff and exported). Logged only when the request actually
      // carried transfer fields.
      const touchedTransferFields = (
        [
          ['transferBankName', 'اسم البنك'],
          ['transferBankAccount', 'رقم الحساب البنكي'],
          ['transferBankAccountHolder', 'صاحب الحساب البنكي'],
          ['transferWalletName', 'اسم المحفظة'],
          ['transferWalletNumber', 'رقم المحفظة'],
          ['transferWalletAccountHolder', 'صاحب المحفظة'],
          ['transferInstructions', 'تعليمات التحويل'],
        ] as const
      )
        .filter(([key]) => b[key] !== undefined)
        .map(([, label]) => label);
      if (touchedTransferFields.length > 0) {
        await logAuditEvent({
          restaurantId,
          userId: req.user!.id,
          actor: req.user!.name,
          actorRole: req.user!.role,
          action: 'TRANSFER_DETAILS_UPDATED',
          entity: 'Restaurant',
          entityId: restaurantId,
          // Field NAMES only — never the account number, IBAN or wallet number.
          details: `تم تحديث بيانات التحويل المعروضة للعميل: ${touchedTransferFields.join('، ')}`,
        });
      }

      // Same value-free policy for the contact channels: which channels the
      // venue publishes is operationally useful, the phone number and the
      // profile URLs are not audit material (they are already public to every
      // guest, and audit rows are read by platform staff and exported).
      const touchedContactFields = CONTACT_CHANNEL_FIELDS.filter(
        ([key]) => b[key] !== undefined
      ).map(([, label]) => label);
      if (touchedContactFields.length > 0) {
        await logAuditEvent({
          restaurantId,
          userId: req.user!.id,
          actor: req.user!.name,
          actorRole: req.user!.role,
          action: 'CONTACT_CHANNELS_UPDATED',
          entity: 'Restaurant',
          entityId: restaurantId,
          details: `تم تحديث قنوات التواصل والحجز: ${touchedContactFields.join('، ')}`,
        });
      }

      // Best-effort cleanup of replaced/deleted managed assets — AFTER the
      // DB commit. Only keys owned by this tenant are touched; failures are
      // logged, never thrown, so a storage hiccup cannot roll back the
      // committed branding. Comparison is done on FOLDED keys so a legacy
      // URL and the same asset's canonical key compare equal (no false
      // "replacement" when the client round-trips an existing asset).
      if (existing) {
        const replaced: string[] = [];
        const replacedByField = (
          n: NormalizedAsset | undefined,
          existingRef: string | null | undefined
        ) => {
          if (!n) return; // omitted — unchanged, nothing to clean
          const oldKey = foldToKey(existingRef);
          if (!oldKey) return; // legacy external/unknown — nothing managed
          const newKey =
            n.kind === 'key' || n.kind === 'external'
              ? foldToKey(n.reference)
              : null;
          if (oldKey !== newKey) replaced.push(String(existingRef));
        };
        replacedByField(normLogo, existing.logoUrl);
        replacedByField(normCover, existing.coverImageUrl);
        replacedByField(normMap, existing.mapImageUrl);
        if (normGallery) {
          const nextKeys = new Set(
            normGallery
              .filter(
                (g): g is Extract<NormalizedAsset, { kind: 'key' | 'external' }> =>
                  g.kind === 'key' || g.kind === 'external'
              )
              .map((g) => foldToKey(g.reference))
              .filter((k): k is string => !!k)
          );
          for (const old of existing.galleryImages) {
            const oldKey = foldToKey(old);
            if (oldKey && !nextKeys.has(oldKey)) replaced.push(old);
          }
        }
        if (replaced.length > 0) {
          void deleteManagedAssets(storage, restaurantId, replaced);
        }
      }

      // Single contract for the response: renderable URLs in the existing
      // fields + the stable references themselves in the additive
      // `*StoragePath` fields (the { storagePath, url } persistence pair).
      const restaurantPayload = resolveRestaurantAssets(
        updated,
        normalizer,
        assetUrlResolverFor(storage, config.appUrl)
      );
      return res.json({ success: true, data: { restaurant: restaurantPayload }, statusCode: 200 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر تحديث الهوية البصرية', statusCode: 500 });
    }
  }
);

// ---------- Multi-branch management ----------
router.get('/branches', requireManager(), async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
    const branches = await prisma.branch.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { tables: true } } },
    });
    return res.json({ success: true, data: branches, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع الفروع', statusCode: 500 });
  }
});

router.post(
  '/branches',
  requireManager(),
  validateBody(branchCreateSchema),
  async (req: Request, res: Response) => {
    try {
      const restaurantId = getTenantId(req);
      if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);

      if (
        !isPlatformUser(req) &&
        !(await restaurantHasEntitlement(restaurantId, 'CAN_CREATE_BRANCH'))
      ) {
        return res.status(403).json({
          success: false,
          error: 'إدارة الفروع متاحة في باقة المؤسسات. قم بالترقية للمتابعة.',
          statusCode: 403,
        });
      }

      // Hard ceiling on branches: every location carries hosting/QR/print cost,
      // so the enterprise plan is bounded rather than open-ended.
      const limits = await getPlanLimits(restaurantId);
      const branchCount = await prisma.branch.count({ where: { restaurantId } });
      if (branchCount >= limits.maxBranches) {
        return res.status(403).json({
          success: false,
          error: `وصلت للحد الأقصى لعدد الفروع في باقتك (${limits.maxBranches}). تواصل مع إدارة المنصة لإضافة فروع إضافية.`,
          statusCode: 403,
        });
      }

      const b = req.body as {
        name: string;
        address?: string;
        phone?: string;
        color?: string;
        isActive?: boolean;
      };
      const branch = await prisma.branch.create({
        data: {
          id: `branch-${randomUUID()}`,
          restaurantId,
          name: b.name,
          address: b.address || undefined,
          phone: b.phone || undefined,
          color: b.color || undefined,
          isActive: b.isActive !== false,
        },
      });
      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'BRANCH_CREATED',
        entity: 'Branch',
        entityId: branch.id,
        details: `تم إنشاء فرع ${branch.name}`,
      });
      return res.status(201).json({ success: true, data: { branch }, statusCode: 201 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر إنشاء الفرع', statusCode: 500 });
    }
  }
);

router.put(
  '/branches/:id',
  requireManager(),
  validateBody(branchUpdateSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await prisma.branch.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ success: false, error: 'الفرع غير موجود', statusCode: 404 });
      if (!ownTenant(req, existing.restaurantId)) return deny(req, res);
      const b = req.body as {
        name?: string;
        address?: string;
        phone?: string;
        color?: string;
        isActive?: boolean;
      };
      const branch = await prisma.branch.update({
        where: { id },
        data: {
          name: b.name !== undefined ? b.name : undefined,
          address: b.address !== undefined ? b.address : undefined,
          phone: b.phone !== undefined ? b.phone : undefined,
          color: b.color !== undefined ? b.color : undefined,
          isActive: b.isActive !== undefined ? b.isActive : undefined,
        },
      });
      return res.json({ success: true, data: { branch }, statusCode: 200 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر تعديل الفرع', statusCode: 500 });
    }
  }
);

router.delete('/branches/:id', requireManager(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.branch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: 'الفرع غير موجود', statusCode: 404 });
    if (!ownTenant(req, existing.restaurantId)) return deny(req, res);
    await prisma.branch.delete({ where: { id } }); // tables branchId -> null via onDelete: SetNull
    await logAuditEvent({
      restaurantId: existing.restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'BRANCH_DELETED',
      entity: 'Branch',
      entityId: id,
      details: `تم حذف فرع ${existing.name}`,
    });
    return res.json({ success: true, message: 'تم حذف الفرع', statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر حذف الفرع', statusCode: 500 });
  }
});

router.post(
  '/branches/assign-tables',
  requireManager(),
  validateBody(assignTablesSchema),
  async (req: Request, res: Response) => {
    try {
      const restaurantId = getTenantId(req);
      if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
      const { branchId, tableIds } = req.body as {
        branchId?: string | '' | null;
        tableIds: string[];
      };
      const uniqueTableIds = [...new Set(tableIds)];
      if (branchId) {
        const branch = await prisma.branch.findUnique({ where: { id: branchId } });
        if (!branch || branch.restaurantId !== restaurantId) {
          return res.status(400).json({ success: false, error: 'الفرع لا ينتمي لمطعمك', statusCode: 400 });
        }
      }
      const owned = await prisma.table.count({
        where: { id: { in: uniqueTableIds }, restaurantId },
      });
      if (owned !== uniqueTableIds.length) {
        return res.status(403).json({ success: false, error: 'بعض الطاولات لا تنتمي لمطعمك', statusCode: 403 });
      }
      // Unassign tables previously assigned to this branch that are not in the new selection list
      if (branchId) {
        await prisma.table.updateMany({
          where: { branchId, id: { notIn: uniqueTableIds }, restaurantId },
          data: { branchId: null },
        });
      }

      await prisma.table.updateMany({
        where: { id: { in: uniqueTableIds }, restaurantId },
        data: { branchId: branchId || null },
      });
      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'TABLES_BRANCH_ASSIGNED',
        details: `تم تحديث توزيع الطاولات على فرع ${branchId || 'غير مصنف'} (إجمالي: ${uniqueTableIds.length} طاولة)`,
      });
      return res.json({ success: true, message: 'تم تحديث توزيع الطاولات بنجاح', statusCode: 200 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر توزيع الطاولات', statusCode: 500 });
    }
  }
);

// ---------- Payments (POS ledger) — paginated, hard cap 100
router.get('/payments', requireCashierOrManager(), async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
    const { take, skip } = parsePagination(req.query as Record<string, unknown>);
    const payments = await prisma.payment.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 100),
      skip,
    });
    const formatted = payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      restaurantId: p.restaurantId,
      branchId: p.branchId || undefined,
      tableId: p.tableId,
      tableLabel: p.tableLabel,
      orderIds: p.orderIds,
      itemsSummary: p.itemsSummary || undefined,
      method: p.method,
      subtotal: p.subtotal,
      tax: p.tax,
      total: p.total,
      cashReceived: p.cashReceived ?? undefined,
      changeDue: p.changeDue ?? undefined,
      tip: p.tip ?? undefined,
      cashierId: p.cashierId || undefined,
      cashierName: p.cashierName,
      note: p.note || undefined,
      // Void marker (audit H-02): a voided receipt stays visible in the ledger
      // list — voiding never deletes or rewrites it.
      voidedAt: p.voidedAt?.toISOString(),
      voidReason: p.voidReason || undefined,
      createdAt: p.createdAt.toISOString(),
    }));
    return res.json({ success: true, data: formatted, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع سجل الدفعات', statusCode: 500 });
  }
});

// POST /api/manager/payments/:paymentId/void — reverse a ledger receipt.
//
// (Audit H-02, 2026-09-15.) An erroneous collection must be correctable
// WITHOUT being left as fabricated revenue and WITHOUT deleting anything:
//   * The receipt row is an IMMUTABLE ledger entry — voiding marks
//     voidedAt/voidReason/voidedByUserId; amounts are never rewritten and the
//     row is never deleted (auditors keep the full trail).
//   * Every covered order that is still PAID reverts atomically in the same
//     transaction to UNPAID / AWAITING_PAYMENT (settledAt/cashierId/releasedAt
//     cleared): the bill re-enters the cashier's collectable list and the
//     staff-cancellation money guard, and it no longer counts as settled.
//   * REPLAY: voiding an already-voided receipt answers idempotently with the
//     current state — never a second mutation (double-click / retry safe).
//   * RACE: a compare-and-set on `voidedAt: null` means exactly one of two
//     concurrent void requests mutates; the loser gets 409.
//   * AUDIT: PAYMENT_VOIDED with actor, receipt number, amount, covered order
//     ids and IP — the inverse of PROCESS_PAYMENT.
router.post(
  '/payments/:paymentId/void',
  requireCashierOrManager(),
  paymentLimiter,
  validateBody(paymentVoidSchema),
  async (req: Request, res: Response) => {
    try {
      const restaurantId = getTenantId(req);
      if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
      // Voiding money movement is a high-risk action: require fresh step-up
      // verification (cashier: PIN, manager: password).
      if (!requireStepUp(req, res)) return;
      const paymentId = String(req.params.paymentId);
      const { reason } = req.body as { reason?: string };

      const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.restaurantId !== restaurantId) {
        return res
          .status(404)
          .json({ success: false, error: 'الإيصال غير موجود في هذا المطعم', statusCode: 404 });
      }

      if (payment.voidedAt) {
        return res.json({
          success: true,
          data: {
            paymentId: payment.id,
            alreadyVoided: true,
            voidedAt: payment.voidedAt.toISOString(),
          },
          statusCode: 200,
        });
      }

      const decision = evaluatePaymentVoid(Boolean(payment.voidedAt));
      if (!decision.ok) {
        return res
          .status(decision.statusCode)
          .json({ success: false, error: decision.error, statusCode: decision.statusCode });
      }

      const now = new Date();
      let reverted = 0;
      try {
        reverted = await prisma.$transaction(async (tx) => {
          const claimed = await tx.payment.updateMany({
            where: { id: payment.id, restaurantId, voidedAt: null },
            data: {
              voidedAt: now,
              voidReason: reason || undefined,
              voidedByUserId: req.user!.id,
            },
          });
          if (claimed.count !== 1) {
            throw Object.assign(new Error('VOID_RACE'), { code: 'VOID_RACE' });
          }
          const affected = await tx.order.updateMany({
            where: {
              id: { in: payment.orderIds },
              restaurantId,
              paymentStatus: PAYMENT_STATUS.PAID,
            },
            data: {
              paymentStatus: PAYMENT_STATUS.UNPAID,
              settledAt: null,
              cashierId: null,
              fulfillmentState: FULFILLMENT_STATE.AWAITING_PAYMENT,
              releasedAt: null,
            },
          });
          return affected.count;
        });
      } catch (txErr: unknown) {
        if ((txErr as { code?: string })?.code === 'VOID_RACE') {
          return res.status(409).json({
            success: false,
            error: 'تم إلغاء هذا الإيصال للتو من جهاز آخر. حدّث الصفحة.',
            statusCode: 409,
          });
        }
        throw txErr;
      }

      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role as TenantRole,
        action: 'PAYMENT_VOIDED',
        entity: 'Payment',
        entityId: payment.id,
        details: `تم إلغاء الإيصال ${payment.receiptNumber} (${payment.total}) — عاد ${reverted} طلبًا إلى غير مدفوع${reason ? ` — ${reason}` : ''}`,
        metadata: {
          paymentId: payment.id,
          receiptNumber: payment.receiptNumber,
          total: payment.total,
          method: payment.method,
          orderIds: payment.orderIds,
          revertedOrders: reverted,
          reason: reason || undefined,
          voidedAt: now.toISOString(),
        },
        ipAddress: req.ip,
      }).catch(() => undefined);

      realtimeService.broadcastToTable(restaurantId, payment.tableId, 'PAYMENT_VOIDED', {
        paymentId: payment.id,
        receiptNumber: payment.receiptNumber,
        tableId: payment.tableId,
        total: payment.total,
        revertedOrders: reverted,
        voidedAt: now.toISOString(),
      });

      return res.json({
        success: true,
        data: {
          paymentId: payment.id,
          alreadyVoided: false,
          voidedAt: now.toISOString(),
          revertedOrders: reverted,
        },
        statusCode: 200,
      });
    } catch (err: unknown) {
      console.error('[Payment Void Error]', {
        endpoint: 'POST /api/manager/payments/:paymentId/void',
        paymentId: req.params?.paymentId,
        tenantId: getTenantId(req),
        message: (err as any)?.message || String(err),
      });
      return res.status(500).json({ success: false, error: 'تعذر إلغاء الإيصال', statusCode: 500 });
    }
  }
);

router.post(
  '/payments',
  requireCashierOrManager(),
  paymentLimiter,
  validateBody(paymentCreateSchema),
  async (req: Request, res: Response) => {
    try {
      const restaurantId = getTenantId(req);
      if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
      const { orderIds, method, cashReceived, tip, note, tableId } = req.body as {
        tableId: string;
        orderIds: string[];
        method: 'CASH' | 'CARD' | 'MOBILE' | 'SPLIT';
        cashReceived?: number;
        tip?: number;
        note?: string;
      };
      const isWalkIn = tableId === '__WALKIN__';
      const table = isWalkIn ? null : await prisma.table.findFirst({ where: { id: tableId, restaurantId } });
      if (!isWalkIn && !table) return res.status(404).json({ success: false, error: 'الطاولة غير موجودة في هذا المطعم', statusCode: 404 });

      const ordersToPay = await prisma.order.findMany({
        where: {
          id: { in: orderIds },
          restaurantId,
          status: { not: 'CANCELLED' },
          paymentStatus: 'UNPAID',
        },
        include: { items: true },
      });
      if (ordersToPay.length === 0) {
        return res.status(409).json({ success: false, error: 'كل الفواتير المحددة مدفوعة مسبقًا أو ملغاة', statusCode: 409 });
      }
      if (ordersToPay.length !== [...new Set(orderIds)].length) {
        return res.status(409).json({ success: false, error: 'بعض الفواتير المحددة غير صالحة للدفع (مدفوعة أو ملغاة أو من مطعم آخر)', statusCode: 409 });
      }
      // Orders still held by the payment gate are RELEASED by this collection:
      // money taken in person is a verified payment, and because the kitchen
      // never received them they keep PENDING status and arrive as new tickets.
      const releasedByCollection = ordersToPay.filter((o) => !isOperational(o.fulfillmentState));
      const closingOperational = ordersToPay.filter((o) => isOperational(o.fulfillmentState));

      // Every billed order must belong to the billed table (no mixed-table
      // bills). Walk-in collections bill counter orders, whose persisted
      // tableId is NULL — compare against the effective value, not the input
      // sentinel (null !== '__WALKIN__' would reject every counter bill).
      const effectiveBillTableId = isWalkIn ? null : tableId;
      const foreignOrder = ordersToPay.find((o) => o.tableId !== effectiveBillTableId);
      if (foreignOrder) {
        return res.status(400).json({
          success: false,
          error: `الفاتورة ${foreignOrder.id} لا تنتمي لهذه الطاولة ولا يمكن تحصيلها معها`,
          statusCode: 400,
        });
      }

      const total = roundMoney(ordersToPay.reduce((sum, o) => sum + o.total, 0));
      const subtotal = roundMoney(ordersToPay.reduce((sum, o) => sum + o.subtotal, 0));
      if (total <= 0) return res.status(400).json({ success: false, error: 'قيمة الفاتورة صفرية', statusCode: 400 });

      const paidMethod = method;
      // Shared cash reconciliation: CASH requires sufficient tendered cash
      // (missing/short payment is rejected, never silently marked PAID) and the
      // change due is computed server-side. Identical rules to table settle.
      const reconciliation = reconcileCashPayment({
        method: paidMethod,
        total,
        tip: tip ?? 0,
        cashReceived,
      });
      if (!reconciliation.ok) {
        return res.status(400).json({ success: false, error: reconciliation.error, statusCode: 400 });
      }
      const tipValue = reconciliation.tip;
      const cashValue = reconciliation.cashReceived ?? 0;
      const changeValue = reconciliation.changeDue;

      const now = new Date();

      // Receipt allocation retries on unique collisions (concurrent POS).
      let payment: Awaited<ReturnType<typeof prisma.payment.create>> | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 5 && !payment; attempt += 1) {
        const receiptNumber = await generateNextReceiptNumber(restaurantId, now, attempt);
        try {
          payment = await prisma.$transaction(async (tx) => {
            // Conditional claim: only still-UNPAID rows flip; the count
            // check below turns a lost double-submit race into a 409.
            let claimedCount = 0;

            if (closingOperational.length > 0) {
              const claimed = await tx.order.updateMany({
                where: {
                  id: { in: closingOperational.map((o) => o.id) },
                  restaurantId,
                  paymentStatus: 'UNPAID',
                  status: { not: 'CANCELLED' },
                },
                data: {
                  status: 'SERVED',
                  paymentStatus: 'PAID',
                  paymentMethod: paidMethod,
                  settledAt: now,
                  cashierId: req.user!.id,
                },
              });
              claimedCount += claimed.count;
            }

            if (releasedByCollection.length > 0) {
              const claimed = await tx.order.updateMany({
                where: {
                  id: { in: releasedByCollection.map((o) => o.id) },
                  restaurantId,
                  paymentStatus: 'UNPAID',
                  status: { not: 'CANCELLED' },
                },
                data: {
                  // Gate opens in the same statement as the money; the kitchen
                  // status stays PENDING so the order is cooked as a new ticket.
                  ...releaseFields(now),
                  paymentStatus: 'PAID',
                  paymentMethod: paidMethod,
                  settledAt: now,
                  cashierId: req.user!.id,
                },
              });
              claimedCount += claimed.count;
            }

            if (claimedCount !== ordersToPay.length) {
              throw Object.assign(new Error('PAYMENT_RACE'), { code: 'PAYMENT_RACE' });
            }

            const record = await tx.payment.create({
              data: {
                id: `pay-${randomUUID()}`,
                receiptNumber,
                restaurantId,
                branchId: table?.branchId || undefined,
                tableId,
                tableLabel: isWalkIn ? 'عميل مباشر (كاونتر)' : `طاولة ${table!.number}`,
                orderIds: ordersToPay.map((o) => o.id),
                itemsSummary: ordersToPay
                  .flatMap((o) => o.items.map((i) => i.productNameSnapshot))
                  .slice(0, 4)
                  .join('، '),
                method: paidMethod,
                subtotal,
                total,
                cashReceived: paidMethod === 'CASH' && cashValue > 0 ? cashValue : undefined,
                changeDue: changeValue > 0 ? changeValue : undefined,
                tip: tipValue > 0 ? tipValue : undefined,
                cashierId: req.user!.id,
                cashierName: req.user!.name,
                note: note || undefined,
              },
            });

            if (!isWalkIn && table) {
              await tx.table.update({
                where: { id: table.id },
                data: { status: 'AVAILABLE', hasWaiterCall: false, lastActivityAt: now },
              });
              await tx.tableSession.updateMany({
                where: { tableId: table.id, restaurantId, status: 'ACTIVE' },
                data: { status: 'CLOSED', endedAt: now },
              });
              await tx.waiterRequest.updateMany({
                where: { tableId: table.id, restaurantId, status: 'PENDING' },
                data: { status: 'RESOLVED', resolvedAt: now },
              });
            }
            return record;
          });
        } catch (txErr: unknown) {
          lastError = txErr;
          const code = (txErr as { code?: string })?.code;
          if (code === 'PAYMENT_RACE') {
            return res.status(409).json({
              success: false,
              error: 'تم تحصيل إحدى هذه الفواتير للتو من جهاز آخر. حدّث الصفحة وحاول مجدداً.',
              statusCode: 409,
            });
          }
          if (code !== 'P2002') throw txErr;
        }
      }
      if (!payment) {
        console.error('[Payment Error] Receipt allocation exhausted:', {
          endpoint: 'POST /api/manager/payments',
          tenantId: restaurantId,
          tableId,
          orderIds,
          method,
          message: (lastError as any)?.message || 'Failed to allocate unique receipt number after retries',
          code: (lastError as any)?.code,
          meta: (lastError as any)?.meta,
        });
        return res.status(500).json({ success: false, error: 'تعذر إتمام الدفع، حاول مجدداً', statusCode: 500 });
      }

      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'PROCESS_PAYMENT',
        entity: 'Payment',
        entityId: payment.id,
        details: `إيصال ${payment.receiptNumber} — ${payment.tableLabel} — ${total} (${paidMethod})`,
        ipAddress: req.ip,
      });

      if (releasedByCollection.length > 0) {
        await Promise.all(
          releasedByCollection.map((released: CollectionReleasedOrder) =>
            logAuditEvent({
              restaurantId,
              userId: req.user!.id,
              actor: req.user!.name,
              actorRole: req.user!.role as TenantRole,
              action: 'ORDER_RELEASED_TO_KDS',
              entity: 'Order',
              entityId: released.id,
              details: `تم الإفراج عن الطلب ${released.id} للمطبخ بعد تحصيل الدفع (${paidMethod})`,
              metadata: {
                orderId: released.id,
                paymentId: payment.id,
                restaurantId,
                previousFulfillmentState: normalizeFulfillmentState(released.fulfillmentState),
                fulfillmentState: FULFILLMENT_STATE.RELEASED,
                releaseReason: RELEASE_REASON.CASH_COLLECTED,
                paymentMethod: paidMethod,
              },
              ipAddress: req.ip,
            }).catch(() => undefined)
          )
        );
        for (const released of releasedByCollection) {
          realtimeService.broadcastToTable(restaurantId, tableId, 'ORDER_RELEASED_TO_KITCHEN', {
            orderId: released.id,
            tableId,
            numericId: released.numericId,
            total: released.total,
            orderStatus: released.status,
            releasedAt: now.toISOString(),
            releaseReason: RELEASE_REASON.CASH_COLLECTED,
          });
        }
      }

      realtimeService.broadcastToTable(restaurantId, tableId, 'PAYMENT_RECORDED', {
        receiptNumber: payment.receiptNumber,
        tableId,
        total,
      });

      return res.status(201).json({ success: true, data: { payment }, statusCode: 201 });
    } catch (err: unknown) {
      console.error('[Payment Error]', {
        endpoint: 'POST /api/manager/payments',
        tenantId: getTenantId(req),
        tableId: (req.body as any)?.tableId,
        orderIds: (req.body as any)?.orderIds,
        method: (req.body as any)?.method,
        message: (err as any)?.message || String(err),
        code: (err as any)?.code,
        meta: (err as any)?.meta,
      });
      return res.status(500).json({ success: false, error: 'تعذر إتمام الدفع', statusCode: 500 });
    }
  }
);

// ============================================================================
// TRANSFER PAYMENT VERIFICATION (cashier)
// ----------------------------------------------------------------------------
// The guest uploads a bank-transfer receipt (POST /api/public/orders/:id/
// payment-proof). These endpoints are the CASHIER side: see what is waiting,
// look at the receipt, then accept (→ PAID + ledger receipt) or reject
// (→ UNPAID again + rejection marker so the guest knows to pay at the till).
//
// Authorization model:
//   - requireCashierOrManager() on every route (money + personal data),
//   - tenant resolved from the JWT only (ownTenant on the order's row),
//   - the storage key is read from the ORDER ROW, never from the request, and
//     is re-checked against the tenant namespace before storage is touched,
//   - no amount, status, receipt number, cashier id or tenant id is ever taken
//     from the client.
// ============================================================================

/** Resolve an order the authenticated caller is allowed to act on. */
async function resolveTenantOrder(req: Request, orderId: string) {
  const restaurantId = getTenantId(req);
  if (!restaurantId || !ownTenant(req, restaurantId)) return { error: 'forbidden' as const };
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { table: { select: { number: true, name: true, branchId: true } } },
  });
  if (!order || order.restaurantId !== restaurantId) return { error: 'not_found' as const };
  return { order, restaurantId };
}

// GET /api/manager/payment-verifications — the cashier verification queue.
// Deliberately its own endpoint (not a filter on /orders): it is the only place
// that returns the guest phone, and it is restricted to cashier/manager roles.
router.get('/payment-verifications', requireCashierOrManager(), async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);
    const { take } = parsePagination(req.query as Record<string, unknown>);

    // The verification queue itself is defined by the MONEY state
    // (PENDING_VERIFICATION), so a receipt that was already queued before the
    // fulfillment gate shipped is still verifiable. `?include=awaiting` adds
    // the orders that have not completed their payment step yet — they carry a
    // different `state`, have no receipt, and cannot be confirmed from here.
    const includeAwaiting =
      req.query.include === 'awaiting' || req.query.include === 'all';

    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        status: { not: 'CANCELLED' },
        OR: [
          { paymentStatus: PAYMENT_STATUS.PENDING_VERIFICATION },
          ...(includeAwaiting
            ? [
                {
                  fulfillmentState: {
                    in: [
                      FULFILLMENT_STATE.AWAITING_PAYMENT,
                      FULFILLMENT_STATE.PAYMENT_REJECTED,
                    ],
                  },
                },
              ]
            : []),
        ],
      },
      include: {
        items: true,
        table: { select: { number: true, name: true, zone: true, branchId: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.min(take, 100),
    });

    const data = orders.map((o) => ({
      orderId: o.id,
      numericId: o.numericId,
      restaurantId: o.restaurantId,
      branchId: o.table?.branchId || o.branchId || undefined,
      tableId: o.tableId,
      tableNumber: o.table?.number,
      tableName: o.table?.name || undefined,
      // Kitchen state of the order (PENDING | PREPARING | READY | SERVED):
      // tells the cashier whether confirming will RELEASE a fresh ticket to
      // the kitchen or merely settle an order already being prepared.
      orderStatus: o.status,
      total: o.total,
      subtotal: o.subtotal,
      itemsCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
      itemsSummary: o.items
        .map((i) => `${i.productNameSnapshot} ×${i.quantity}`)
        .slice(0, 4)
        .join('، '),
      // Full item list so the cashier verifies the transfer against the actual
      // order without leaving the verification card (no second request).
      items: o.items.map((i) => ({
        productName: i.productNameSnapshot,
        quantity: i.quantity,
        unitPrice: i.priceSnapshot,
        totalPrice: i.totalPrice,
        selectedSize: i.selectedSize || undefined,
        selectedAddOns: i.selectedAddOns,
        removedIngredients: i.removedIngredients,
        specialInstructions: i.specialInstructions || undefined,
      })),
      customerName: o.customerName || undefined,
      customerPhone: o.customerPhone || undefined,
      transferChannel: o.transferChannel || undefined,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      hasPaymentProof: Boolean(o.paymentProofPath),
      // Gate state as the cashier's card must read it: WAITING_RECEIPT
      // (AWAITING_PAYMENT / PAYMENT_REJECTED → nothing to confirm yet) vs
      // WAITING_VERIFICATION (a receipt is attached → confirm or reject).
      fulfillmentState: normalizeFulfillmentState(o.fulfillmentState),
      state: isAwaitingVerification(o.paymentStatus)
        ? 'WAITING_VERIFICATION'
        : 'WAITING_RECEIPT',
      paymentRejected: Boolean(o.paymentRejectedAt),
      paymentRejectedReason: o.paymentRejectionReason || undefined,
      submittedAt: o.updatedAt.toISOString(),
      createdAt: o.createdAt.toISOString(),
    }));

    return res.json({ success: true, data, statusCode: 200 });
  } catch (err) {
    console.error('[Payment Verification Error]', {
      endpoint: 'GET /api/manager/payment-verifications',
      tenantId: getTenantId(req),
      message: (err as any)?.message || String(err),
    });
    return res.status(500).json({ success: false, error: 'تعذر استرجاع طلبات التحقق', statusCode: 500 });
  }
});

// GET /api/manager/orders/:orderId/payment-proof — the receipt image itself.
// Streams the bytes from the PRIVATE namespace after an authorization check, so
// no public URL exists and no signature/token needs to leak into a URL.
router.get(
  '/orders/:orderId/payment-proof',
  requireCashierOrManager(),
  paymentProofReadLimiter,
  async (req: Request, res: Response) => {
    try {
      const resolved = await resolveTenantOrder(req, String(req.params.orderId));
      if (resolved.error === 'forbidden') return deny(req, res);
      if (resolved.error === 'not_found') {
        return res.status(404).json({ success: false, error: 'الطلب غير موجود في هذا المطعم', statusCode: 404 });
      }
      const { order } = resolved;
      if (!order.paymentProofPath) {
        return res.status(404).json({ success: false, error: 'لا يوجد إشعار حوالة لهذا الطلب', statusCode: 404 });
      }
      // Structural second check: the key must live in THIS tenant's namespace.
      if (!proofBelongsToTenant(order.paymentProofPath, order.restaurantId)) {
        await logAuditEvent({
          restaurantId: order.restaurantId,
          userId: req.user!.id,
          actor: req.user!.name,
          actorRole: req.user!.role as TenantRole,
          action: 'PAYMENT_PROOF_ACCESS_DENIED',
          entity: 'Order',
          entityId: order.id,
          // Data minimization: the suspected key itself is NOT written to the
          // audit row (the order id already identifies the incident).
          details: 'مفتاح تخزين إشعار لا ينتمي لنطاق هذا المطعم',
          ipAddress: req.ip,
        }).catch(() => undefined);
        return res.status(403).json({ success: false, error: 'غير مصرح لك بالوصول لهذا الإشعار', statusCode: 403 });
      }

      const proof = await loadPaymentProof(order.paymentProofPath);
      if (!proof) {
        // The retention sweep may have removed it, or storage is unreachable.
        return res.status(404).json({
          success: false,
          error: 'انتهت صلاحية إشعار الحوالة أو تم حذفه وفق سياسة الاحتفاظ',
          statusCode: 404,
        });
      }

      res.setHeader('Content-Type', proof.mimeType);
      res.setHeader('Content-Length', String(proof.body.length));
      res.setHeader('Content-Disposition', 'inline; filename="payment-proof"');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(proof.body);
    } catch (err) {
      console.error('[Payment Proof Read Error]', {
        endpoint: 'GET /api/manager/orders/:orderId/payment-proof',
        orderId: req.params?.orderId,
        tenantId: getTenantId(req),
        message: (err as any)?.message || String(err),
      });
      return res.status(500).json({ success: false, error: 'تعذر تحميل صورة الإشعار', statusCode: 500 });
    }
  }
);

// POST /api/manager/orders/:orderId/payment/confirm — accept the transfer.
// Creates the SAME immutable ledger receipt the cash/table flows create, with
// method TRANSFER, and only within one atomic claim of the pending state, so
// two cashiers can never double-post a payment.
//
// Kitchen release: confirming a transfer is the moment the order becomes
// cookable. The order is deliberately NOT pushed to SERVED — an order still
// waiting in PENDING is released to the KDS as a fresh ticket ("ready to
// start"), and an order the kitchen already picked up keeps its current
// state (PREPARING/READY/SERVED) instead of being rewound.
router.post(
  '/orders/:orderId/payment/confirm',
  requireCashierOrManager(),
  paymentLimiter,
  validateBody(paymentConfirmSchema),
  async (req: Request, res: Response) => {
    try {
      const resolved = await resolveTenantOrder(req, String(req.params.orderId));
      if (resolved.error === 'forbidden') return deny(req, res);
      if (resolved.error === 'not_found') {
        return res.status(404).json({ success: false, error: 'الطلب غير موجود في هذا المطعم', statusCode: 404 });
      }
      const { order, restaurantId } = resolved;
      const { note } = req.body as { note?: string };

      if (order.status === 'CANCELLED') {
        return res.status(409).json({ success: false, error: 'هذا الطلب ملغى ولا يمكن تأكيد دفعه.', statusCode: 409 });
      }
      if (order.paymentStatus === PAYMENT_STATUS.PAID) {
        return res.status(409).json({
          success: false,
          error: 'تم تأكيد دفع هذا الطلب مسبقاً.',
          statusCode: 409,
        });
      }
      if (!isAwaitingVerification(order.paymentStatus)) {
        return res.status(409).json({
          success: false,
          error: 'لا يوجد إشعار حوالة بانتظار التحقق لهذا الطلب.',
          statusCode: 409,
        });
      }
      if (!order.paymentProofPath) {
        return res.status(409).json({
          success: false,
          error: 'إشعار الحوالة غير متوفر لهذا الطلب.',
          statusCode: 409,
        });
      }

      const now = new Date();
      const tableLabel = order.table?.number
        ? `طاولة ${order.table.number}`
        : `طلب ${order.id}`;

      // Kitchen state this confirmation releases to. PENDING = the guest
      // ordered and paid before cooking started, so the ticket enters the KDS
      // as new ("جاهز للبدء فوراً"); any later state is preserved as-is.
      const releasedStatus = order.status;
      const kitchenReleased = releasedStatus === 'PENDING';
      const channelLabel = transferChannelLabel(order.transferChannel);
      // Authorization boundary, before/after: the confirmation is exactly the
      // transition that opens the gate, and both values are audited.
      const previousFulfillmentState = normalizeFulfillmentState(order.fulfillmentState);

      let payment: Awaited<ReturnType<typeof prisma.payment.create>> | null = null;
      let receiptError: unknown = null;
      let settled = false;

      for (let attempt = 0; attempt < 5 && !settled; attempt += 1) {
        try {
          const receiptNumber = await generateNextReceiptNumber(restaurantId, now, attempt);
          payment = await prisma.$transaction(async (tx) => {
            // Conditional claim: only an order that is STILL awaiting
            // verification flips to PAID. A concurrent confirm/reject (or a
            // cash settlement that got there first) claims zero rows and gets
            // a 409 instead of a duplicate receipt.
            const claimed = await tx.order.updateMany({
              where: {
                id: order.id,
                restaurantId,
                status: { not: 'CANCELLED' },
                paymentStatus: PAYMENT_STATUS.PENDING_VERIFICATION,
              },
              data: {
                paymentStatus: 'PAID',
                paymentMethod: TRANSFER_PAYMENT_METHOD,
                // The order's kitchen status is intentionally NOT rewritten:
                // a paid-but-not-started order must stay PENDING so the KDS
                // shows it as a fresh, immediately cookable ticket.
                //
                // THE GATE OPENS IN THE SAME STATEMENT AS THE MONEY: there is
                // no reachable state where paymentStatus is PAID while the
                // order is still withheld from the kitchen (or the reverse).
                ...releaseFields(now),
                settledAt: now,
                cashierId: req.user!.id,
                paymentRejectedAt: null,
                paymentRejectionReason: null,
              },
            });
            if (claimed.count !== 1) {
              throw Object.assign(new Error('VERIFY_RACE'), { code: 'VERIFY_RACE' });
            }

            return tx.payment.create({
              data: {
                id: `pay-${randomUUID()}`,
                receiptNumber,
                restaurantId,
                branchId: order.table?.branchId || order.branchId || undefined,
                tableId: order.tableId,
                tableLabel,
                orderIds: [order.id],
                itemsSummary: undefined,
                method: TRANSFER_PAYMENT_METHOD,
                subtotal: order.subtotal,
                tax: order.tax,
                total: order.total,
                cashierId: req.user!.id,
                cashierName: req.user!.name,
                note: note || `تأكيد ${channelLabel} بعد التحقق من الإشعار`,
              },
            });
          });
          settled = true;
        } catch (txErr: unknown) {
          receiptError = txErr;
          const code = (txErr as { code?: string })?.code;
          if (code === 'VERIFY_RACE') {
            // Lost the claim. Two very different situations:
            //  (a) someone (this cashier on a second tab, the other cashier)
            //      already CONFIRMED it — that is an idempotent replay: read the
            //      authoritative row + its single ledger receipt and answer 200
            //      with `alreadyConfirmed`, never a second receipt;
            //  (b) the order moved to any other state (rejected, cancelled,
            //      settled in cash) — a genuine conflict, answered with 409.
            const current = await prisma.order.findUnique({ where: { id: order.id } });
            if (current?.paymentStatus === PAYMENT_STATUS.PAID) {
              const existingReceipt = await prisma.payment.findFirst({
                where: { restaurantId, orderIds: { has: order.id } },
                orderBy: { createdAt: 'desc' },
              });
              return res.status(200).json({
                success: true,
                data: {
                  payment: existingReceipt,
                  orderId: order.id,
                  orderStatus: current.status,
                  kitchenReleased: current.status === 'PENDING',
                  fulfillmentState: FULFILLMENT_STATE.RELEASED,
                  alreadyConfirmed: true,
                },
                statusCode: 200,
              });
            }
            return res.status(409).json({
              success: false,
              error: 'تمت معالجة هذا الإشعار للتو من جهاز آخر. حدّث القائمة وحاول مجدداً.',
              statusCode: 409,
            });
          }
          if (code !== 'P2002') throw txErr;
        }
      }

      if (!settled || !payment) {
        console.error('[Payment Verify Error] Receipt allocation exhausted:', {
          endpoint: 'POST /api/manager/orders/:orderId/payment/confirm',
          tenantId: restaurantId,
          orderId: order.id,
          message: (receiptError as any)?.message || 'Failed to allocate unique receipt number after retries',
          code: (receiptError as any)?.code,
          meta: (receiptError as any)?.meta,
        });
        return res.status(500).json({ success: false, error: 'تعذر تأكيد الدفع، حاول مجدداً', statusCode: 500 });
      }

      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role as TenantRole,
        action: 'PAYMENT_VERIFIED',
        entity: 'Order',
        entityId: order.id,
        details: `تم تأكيد ${channelLabel} للطلب ${order.id} (إيصال ${payment.receiptNumber}) بقيمة ${order.total}`,
        metadata: {
          paymentEvent: 'PAYMENT_CONFIRMED',
          method: TRANSFER_PAYMENT_METHOD,
          receiptNumber: payment.receiptNumber,
          kitchenReleased,
          orderId: order.id,
          paymentId: payment.id,
          previousFulfillmentState,
          fulfillmentState: FULFILLMENT_STATE.RELEASED,
        },
        ipAddress: req.ip,
      }).catch(() => undefined);

      // Explicit audit of the authorization boundary itself: "this order was
      // released to the KDS, by whom, on the strength of which receipt".
      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role as TenantRole,
        action: 'ORDER_RELEASED_TO_KDS',
        entity: 'Order',
        entityId: order.id,
        details: `تم الإفراج عن الطلب ${order.id} إلى المطبخ بعد التحقق من الدفع (إيصال ${payment.receiptNumber})`,
        metadata: {
          orderId: order.id,
          paymentId: payment.id,
          restaurantId,
          previousFulfillmentState,
          fulfillmentState: FULFILLMENT_STATE.RELEASED,
          releaseReason: RELEASE_REASON.TRANSFER_VERIFIED,
          receiptNumber: payment.receiptNumber,
        },
        ipAddress: req.ip,
      }).catch(() => undefined);

      // Existing event name: every client (guest tracker + staff screens)
      // already refreshes on PAYMENT_RECORDED — no second notification system.
      realtimeService.broadcastToTable(restaurantId, order.tableId, 'PAYMENT_RECORDED', {
        receiptNumber: payment.receiptNumber,
        tableId: order.tableId,
        orderId: order.id,
        total: payment.total,
      });
      // Kitchen release: when the paid order was still waiting (PENDING), the
      // KDS did not show it. This event is what makes it appear instantly as a
      // new ticket — the staff stream plays a chime for a PENDING status.
      realtimeService.broadcastToTable(restaurantId, order.tableId, 'ORDER_STATUS_UPDATED', {
        orderId: order.id,
        tableId: order.tableId,
        status: releasedStatus,
        kitchenReleased,
        paymentStatus: PAYMENT_STATUS.PAID,
      });
      realtimeService.broadcastToTable(restaurantId, order.tableId, 'PAYMENT_PROOF_VERIFIED', {
        orderId: order.id,
        tableId: order.tableId,
        receiptNumber: payment.receiptNumber,
        kitchenReleased,
      });
      // THE operational event: payment verified → the restaurant may work on
      // this order. KDS/floor screens act on THIS (and on the derived
      // `operational` flag), never on the submission event.
      realtimeService.broadcastToTable(restaurantId, order.tableId, 'ORDER_RELEASED_TO_KITCHEN', {
        orderId: order.id,
        tableId: order.tableId,
        numericId: order.numericId,
        total: order.total,
        orderStatus: releasedStatus,
        releasedAt: now.toISOString(),
        releaseReason: RELEASE_REASON.TRANSFER_VERIFIED,
      });

      return res.status(201).json({
        success: true,
        data: {
          payment,
          orderId: order.id,
          orderStatus: releasedStatus,
          kitchenReleased,
          fulfillmentState: FULFILLMENT_STATE.RELEASED,
        },
        statusCode: 201,
      });
    } catch (err: unknown) {
      console.error('[Payment Verify Error]', {
        endpoint: 'POST /api/manager/orders/:orderId/payment/confirm',
        orderId: req.params?.orderId,
        tenantId: getTenantId(req),
        message: (err as any)?.message || String(err),
        code: (err as any)?.code,
      });
      return res.status(500).json({ success: false, error: 'تعذر تأكيد الدفع', statusCode: 500 });
    }
  }
);

// POST /api/manager/orders/:orderId/payment/reject — refuse the receipt.
// The order returns to UNPAID (every existing collect path keeps working) and
// carries a rejection marker so the guest is told to pay at the till. The
// rejected receipt object is deleted: it serves no financial purpose.
router.post(
  '/orders/:orderId/payment/reject',
  requireCashierOrManager(),
  paymentLimiter,
  validateBody(paymentRejectSchema),
  async (req: Request, res: Response) => {
    try {
      const resolved = await resolveTenantOrder(req, String(req.params.orderId));
      if (resolved.error === 'forbidden') return deny(req, res);
      if (resolved.error === 'not_found') {
        return res.status(404).json({ success: false, error: 'الطلب غير موجود في هذا المطعم', statusCode: 404 });
      }
      const { order, restaurantId } = resolved;
      const { reason } = req.body as { reason?: string };

      if (order.paymentStatus === PAYMENT_STATUS.PAID) {
        return res.status(409).json({
          success: false,
          error: 'تم تأكيد دفع هذا الطلب مسبقاً — لا يمكن رفضه.',
          statusCode: 409,
        });
      }
      if (!isAwaitingVerification(order.paymentStatus)) {
        return res.status(409).json({
          success: false,
          error: 'لا يوجد إشعار حوالة بانتظار التحقق لهذا الطلب.',
          statusCode: 409,
        });
      }

      // Storage first: if the object cannot be removed we KEEP the pointer so
      // the retention sweep retries it, instead of losing track of the file.
      const proofDeleted = order.paymentProofPath
        ? await discardPaymentProof(order.paymentProofPath)
        : true;

      const now = new Date();
      const claimed = await prisma.order.updateMany({
        where: {
          id: order.id,
          restaurantId,
          status: { not: 'CANCELLED' },
          paymentStatus: PAYMENT_STATUS.PENDING_VERIFICATION,
        },
        data: {
          paymentStatus: PAYMENT_STATUS.UNPAID,
          // The gate stays CLOSED and now says why: the guest must act (send a
          // new receipt or pay in person). A rejected order never reaches the
          // kitchen, and the order itself is preserved (never deleted).
          fulfillmentState: FULFILLMENT_STATE.PAYMENT_REJECTED,
          paymentRejectedAt: now,
          paymentRejectionReason: reason || 'لم يتم التحقق من إشعار الحوالة',
          ...(proofDeleted ? { paymentProofPath: null } : {}),
        },
      });

      if (claimed.count !== 1) {
        return res.status(409).json({
          success: false,
          error: 'تمت معالجة هذا الإشعار للتو من جهاز آخر. حدّث القائمة وحاول مجدداً.',
          statusCode: 409,
        });
      }

      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role as TenantRole,
        action: 'PAYMENT_REJECTED',
        entity: 'Order',
        entityId: order.id,
        details: `تم رفض إشعار الحوالة للطلب ${order.id}${reason ? ` — ${reason}` : ''}`,
        metadata: {
          paymentEvent: 'PAYMENT_REJECTED',
          proofDeleted,
          orderId: order.id,
          restaurantId,
          previousFulfillmentState: normalizeFulfillmentState(order.fulfillmentState),
          fulfillmentState: FULFILLMENT_STATE.PAYMENT_REJECTED,
        },
        ipAddress: req.ip,
      }).catch(() => undefined);

      realtimeService.broadcastToTable(restaurantId, order.tableId, 'PAYMENT_PROOF_REJECTED', {
        orderId: order.id,
        tableId: order.tableId,
        reason: reason || undefined,
      });

      return res.json({
        success: true,
        data: {
          orderId: order.id,
          paymentStatus: PAYMENT_STATUS.UNPAID,
          fulfillmentState: FULFILLMENT_STATE.PAYMENT_REJECTED,
          proofDeleted,
        },
        statusCode: 200,
      });
    } catch (err: unknown) {
      console.error('[Payment Reject Error]', {
        endpoint: 'POST /api/manager/orders/:orderId/payment/reject',
        orderId: req.params?.orderId,
        tenantId: getTenantId(req),
        message: (err as any)?.message || String(err),
      });
      return res.status(500).json({ success: false, error: 'تعذر رفض الإشعار', statusCode: 500 });
    }
  }
);

export default router;
