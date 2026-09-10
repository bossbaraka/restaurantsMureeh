import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma';
import {
  requireAuth,
  requireTenantAccess,
  requireManager,
  requireCashierOrManager,
  requireServiceStaff,
  isPlatformUser,
} from '../middleware/auth';
import { realtimeService } from '../services/realtime';
import {
  FREE_TRIAL_DAYS,
  isTrialPlan,
  withTrialMeta,
  evaluatePlanChange,
} from '../services/plans';
import { logAuditEvent } from '../services/audit';
import { getStorage, deleteManagedAssets } from '../services/storage';
import { generateQrToken, csvField, roundMoney, parsePagination } from '../utils/security';
import { paymentLimiter, orderStatusLimiter, staffMutationLimiter } from '../middleware/rateLimit';
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
  branchCreateSchema,
  branchUpdateSchema,
  assignTablesSchema,
  paymentCreateSchema,
} from '../validation/schemas';
import bcrypt from 'bcryptjs';
import { OrderStatus, TableZone, TableStatus } from '@prisma/client';

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
  if (
    !subscription ||
    (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIAL') ||
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
  return (
    !!subscription &&
    (subscription.status === 'ACTIVE' || subscription.status === 'TRIAL') &&
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

    // Aggregate orders stats from PostgreSQL
    const validOrders = await prisma.order.findMany({
      where: {
        restaurantId,
        status: { not: 'CANCELLED' },
      },
      include: { items: true },
    });

    const totalRevenue = validOrders.reduce((sum, o) => sum + o.total, 0);
    const todayOrdersCount = validOrders.length;
    const averageOrderValue = todayOrdersCount > 0 ? Math.round(totalRevenue / todayOrdersCount) : 0;

    const pendingOrdersCount = await prisma.order.count({ where: { restaurantId, status: 'PENDING' } });
    const preparingOrdersCount = await prisma.order.count({ where: { restaurantId, status: 'PREPARING' } });
    const readyOrdersCount = await prisma.order.count({ where: { restaurantId, status: 'READY' } });

    const totalTablesCount = await prisma.table.count({ where: { restaurantId } });
    const activeTablesCount = await prisma.table.count({
      where: {
        restaurantId,
        status: { in: ['OCCUPIED', 'BILL_REQUESTED'] },
      },
    });

    const pendingWaitersCount = await prisma.waiterRequest.count({
      where: { restaurantId, status: 'PENDING' },
    });

    // Compute popular products from OrderItem snapshots
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: { restaurantId, status: { not: 'CANCELLED' } },
      },
    });

    const productMap = new Map<string, { name: string; count: number; revenue: number }>();
    orderItems.forEach((item) => {
      const name = item.productNameSnapshot;
      const curr = productMap.get(name) || { name, count: 0, revenue: 0 };
      curr.count += item.quantity;
      curr.revenue += item.totalPrice;
      productMap.set(name, curr);
    });

    const popularProducts = Array.from(productMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return res.json({
      success: true,
      data: {
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          nameEn: restaurant.nameEn,
          slug: restaurant.slug,
          logo: restaurant.logoUrl,
          coverImage: restaurant.coverImageUrl,
          currency: restaurant.currency,
          primaryColor: restaurant.primaryColor,
          accentColor: restaurant.accentColor,
        },
        subscription: restaurant.subscription,
        plan: restaurant.subscription?.plan,
        totalRevenue,
        todayOrdersCount,
        activeTablesCount,
        totalTablesCount,
        pendingOrdersCount,
        preparingOrdersCount,
        readyOrdersCount,
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
router.get('/orders', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

    if (!ownTenant(req, restaurantId)) return deny(req, res);

    const { take, skip } = parsePagination(req.query as Record<string, unknown>);
    const orders = await prisma.order.findMany({
      where: { restaurantId },
      include: {
        items: true,
        table: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    const formatted = orders.map((o) => ({
      id: o.id,
      numericId: o.numericId,
      restaurantId: o.restaurantId,
      tableId: o.tableId,
      tableNumber: o.table?.number,
      tableName: o.table?.name || undefined,
      sessionId: o.sessionId || undefined,
      subtotal: o.subtotal,
      total: o.total,
      status: o.status,
      paymentMethod: o.paymentMethod,
      notes: o.notes || undefined,
      estimatedPrepMinutes: o.estimatedPrepMinutes || 18,
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
    }));

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

      const { tableId, items, notes } = req.body as {
        tableId: string;
        items: Array<{
          productId: string;
          quantity?: number;
          removedIngredients?: string[];
          specialInstructions?: string;
          notes?: string;
        }>;
        notes?: string;
      };

      const isWalkIn = tableId === '__WALKIN__';
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

      // Order-number allocation retries on unique collisions (concurrent POS).
      const existingOrders = await prisma.order.findMany({
        where: { restaurantId },
        select: { id: true, numericId: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const orderCount = await prisma.order.count({ where: { restaurantId } });

      let maxNum = 1000;
      for (const ord of existingOrders) {
        if (ord.numericId && ord.numericId > maxNum) {
          maxNum = ord.numericId;
        }
        const match = ord.id.match(/\d+/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }

      const startNum = Math.max(1001, maxNum + 1, orderCount + 1001);

      let newOrder: Awaited<ReturnType<typeof prisma.order.create>> | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 25 && !newOrder; attempt += 1) {
        const nextNum = startNum + attempt;
        const orderId = `#${nextNum}`;
        try {
          newOrder = await prisma.order.create({
            data: {
              id: orderId,
              numericId: nextNum,
              restaurantId,
              tableId,
              sessionId: null,
              status: 'PENDING',
              paymentMethod: 'PAY AT CASHIER',
              subtotal,
              total: subtotal,
              notes: notes || undefined,
              estimatedPrepMinutes: 15,
              items: { create: pricedItems },
            },
            include: { items: true },
          });
        } catch (createErr: unknown) {
          lastError = createErr;
          if ((createErr as { code?: string })?.code !== 'P2002') throw createErr;
        }
      }

      if (!newOrder) {
        try {
          const fallbackNum = startNum + Math.floor(Math.random() * 90000) + 100;
          const fallbackOrderId = `#${fallbackNum}`;
          newOrder = await prisma.order.create({
            data: {
              id: fallbackOrderId,
              numericId: fallbackNum,
              restaurantId,
              tableId,
              sessionId: null,
              status: 'PENDING',
              paymentMethod: 'PAY AT CASHIER',
              subtotal,
              total: subtotal,
              notes: notes || undefined,
              estimatedPrepMinutes: 15,
              items: { create: pricedItems },
            },
            include: { items: true },
          });
        } catch (fallbackErr) {
          lastError = fallbackErr;
        }
      }

      if (!newOrder) {
        console.error('POS order id allocation failed:', lastError);
        return res.status(500).json({ success: false, error: 'تعذر إنشاء فاتورة الكاشير، حاول مجدداً', statusCode: 500 });
      }

      if (!isWalkIn) {
        await prisma.table.update({
          where: { id: tableId },
          data: { status: 'OCCUPIED', lastActivityAt: new Date() },
        });
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
      });

      realtimeService.broadcastToTable(restaurantId, tableId, 'ORDER_CREATED', {
        orderId: newOrder.id,
        tableId,
        total: newOrder.total,
        status: newOrder.status,
        itemsCount: newOrder.items.length,
      });

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
      const { status, restaurantId } = req.body as {
        status: OrderStatus;
        restaurantId?: string;
      };
      const targetRestId = restaurantId || req.user?.restaurantId;

      if (!targetRestId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

      if (!ownTenant(req, targetRestId)) return deny(req, res);

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.restaurantId !== targetRestId) {
        return res.status(404).json({ success: false, error: 'الطلب غير موجود في هذا المطعم', statusCode: 404 });
      }

      // State machine rule: cannot revert SERVED
      if (order.status === 'SERVED' && status !== 'SERVED') {
        return res.status(400).json({ success: false, error: 'لا يمكن إرجاع طلب تم تقديمه بالفعل', statusCode: 400 });
      }

      const updated = await prisma.order.update({
        where: { id: orderId },
        data: { status },
      });

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
      realtimeService.broadcastToTable(targetRestId, order.tableId, 'ORDER_STATUS_UPDATED', {
        orderId,
        status,
        tableId: order.tableId,
      });

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

    const formatted = tables.map((t) => ({
      id: t.id,
      restaurantId: t.restaurantId,
      tableNumber: t.number,
      capacity: t.capacity,
      zone: t.zone,
      status: t.status,
      qrToken: t.qrToken,
      hasWaiterCall: t.hasWaiterCall,
      activeOrderIds: t.orders.map((o) => o.id),
      lastActivityAt: t.lastActivityAt?.toISOString(),
    }));

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

// POST /api/manager/tables/:id/settle (Settle Table Bill)
router.post(
  '/tables/:id/settle',
  requireCashierOrManager(),
  validateBody(tableSettleSchema),
  async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const table = await prisma.table.findUnique({ where: { id } });
    if (!table) return res.status(404).json({ success: false, error: 'الطاولة غير موجودة', statusCode: 404 });
    // Strict ownership: only the tenant that owns the table (or a platform admin) can settle it.
    if (!ownTenant(req, table.restaurantId)) return deny(req, res);

    const now = new Date();
    const { paymentMethod, note } = req.body as { paymentMethod?: string; note?: string };
    const paidMethod = paymentMethod || 'CASH';

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

    let paymentRecord: Awaited<ReturnType<typeof prisma.payment.create>> | null = null;

    if (unpaidOrders.length > 0) {
      const total = roundMoney(unpaidOrders.reduce((sum, o) => sum + o.total, 0));
      const subtotal = roundMoney(unpaidOrders.reduce((sum, o) => sum + o.subtotal, 0));

      const seq = (await prisma.payment.count({ where: { restaurantId: table.restaurantId } })) + 1;
      const receiptNumber = `RC-${now.getFullYear()}-${String(seq).padStart(4, '0')}`;

      // Mark orders as PAID, SERVED and record official Payment receipt in ledger
      paymentRecord = await prisma.$transaction(async (tx) => {
        await tx.order.updateMany({
          where: {
            id: { in: unpaidOrders.map((o) => o.id) },
            restaurantId: table.restaurantId,
          },
          data: {
            status: 'SERVED',
            paymentStatus: 'PAID',
            paymentMethod: paidMethod,
            settledAt: now,
            cashierId: req.user!.id,
          },
        });

        return tx.payment.create({
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
            cashReceived: paidMethod === 'CASH' ? total : undefined,
            changeDue: 0,
            cashierId: req.user!.id,
            cashierName: req.user!.name,
            note: note || 'تسوية إغلاق الطاولة وإثبات الدفع',
          },
        });
      });
    }

    // Mark remaining non-cancelled active orders as SERVED and PAID
    await prisma.order.updateMany({
      where: {
        tableId: id,
        restaurantId: table.restaurantId,
        status: { in: ['PENDING', 'PREPARING', 'READY'] },
      },
      data: {
        status: 'SERVED',
        paymentStatus: 'PAID',
        settledAt: now,
        cashierId: req.user!.id,
      },
    });

    // Reset table status and resolve waiter calls
    await prisma.table.update({
      where: { id },
      data: {
        status: 'AVAILABLE',
        hasWaiterCall: false,
        lastActivityAt: now,
      },
    });

    // Close the active anonymous table session
    await prisma.tableSession.updateMany({
      where: {
        tableId: id,
        restaurantId: table.restaurantId,
        status: 'ACTIVE',
      },
      data: {
        status: 'CLOSED',
        endedAt: now,
      },
    });

    await prisma.waiterRequest.updateMany({
      where: {
        tableId: id,
        restaurantId: table.restaurantId,
        status: 'PENDING',
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: now,
      },
    });

    await logAuditEvent({
      restaurantId: table.restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'TABLE_SETTLED',
      entity: 'Table',
      entityId: id,
      details: `تمت تسوية ودفع طلبات الطاولة ${table.number} ${paymentRecord ? `(إيصال ${paymentRecord.receiptNumber})` : ''}`,
    });

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
    console.error('Table settle error:', err);
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
    image: p.imageUrl,
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

      const newProd = await prisma.product.create({
        data: {
          restaurantId: targetRestId,
          categoryId,
          name,
          nameEn: nameEn || name,
          description: description || '',
          price,
          imageUrl: image || '',
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

      return res.status(201).json({ success: true, data: newProd, statusCode: 201 });
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
      const updated = await prisma.product.update({
        where: { id },
        data: {
          name: data.name !== undefined ? data.name : undefined,
          nameEn: data.nameEn !== undefined ? data.nameEn : undefined,
          description: data.description !== undefined ? data.description : undefined,
          price: data.price !== undefined ? data.price : undefined,
          imageUrl: data.image !== undefined || data.imageUrl !== undefined ? (data.image ?? data.imageUrl) : undefined,
          categoryId: data.categoryId !== undefined ? data.categoryId : undefined,
          available: data.isAvailable !== undefined ? data.isAvailable : undefined,
          isFeatured: data.isFeatured !== undefined ? data.isFeatured : undefined,
          badge: data.badge !== undefined ? data.badge : undefined,
          preparationTimeMinutes: data.preparationTimeMinutes !== undefined ? data.preparationTimeMinutes : undefined,
          calories: data.calories !== undefined ? data.calories : undefined,
        },
      });

      // Best-effort cleanup of a replaced dish image — AFTER the DB commit.
      const newImage = data.image ?? data.imageUrl;
      if (
        newImage !== undefined &&
        existingProduct.imageUrl &&
        newImage !== existingProduct.imageUrl
      ) {
        void deleteManagedAssets(getStorage(), existingProduct.restaurantId, [
          existingProduct.imageUrl,
        ]);
      }

      return res.json({ success: true, data: updated, statusCode: 200 });
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

      const reqObj = await prisma.waiterRequest.update({
        where: { id },
        data: {
          status,
          resolvedAt: status === 'RESOLVED' ? new Date() : null,
        },
      });

      if (status === 'RESOLVED') {
        const remainingPending = await prisma.waiterRequest.count({
          where: {
            tableId: reqObj.tableId,
            restaurantId: reqObj.restaurantId,
            status: 'PENDING',
          },
        });
        if (remainingPending === 0) {
          await prisma.table.update({
            where: { id: reqObj.tableId },
            data: { hasWaiterCall: false },
          });
        }
      }

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

    const orders = await prisma.order.findMany({
      where: { restaurantId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
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
  role: true,
  status: true,
  avatar: true,
  createdAt: true,
} as const;

const PLATFORM_ROLE_SET = new Set(['PLATFORM_ADMIN', 'SUPER_ADMIN']);

router.get('/staff', requireManager(), async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(req, res);

    const staff = await prisma.restaurantUser.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'asc' },
      select: STAFF_SAFE_SELECT,
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

      const { name, email, password, pin, role } = req.body as {
        name: string;
        email: string;
        password: string;
        pin?: string;
        role: 'RESTAURANT_MANAGER' | 'WAITER' | 'KITCHEN' | 'CASHIER' | 'STAFF';
      };

      const normalizedEmail = email.toLowerCase();
      const existing = await prisma.restaurantUser.findUnique({ where: { email: normalizedEmail } });
      if (existing) return res.status(409).json({ success: false, error: 'هذا البريد مستخدم مسبقًا', statusCode: 409 });

      const user = await prisma.restaurantUser.create({
        data: {
          id: `user-${randomUUID()}`,
          restaurantId,
          name,
          email: normalizedEmail,
          passwordHash: await bcrypt.hash(password, 12),
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
        details: `تمت إضافة موظف ${name} بدور ${role}`,
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
      const { id } = req.params;
      const target = await prisma.restaurantUser.findUnique({ where: { id } });
      if (!target) return res.status(404).json({ success: false, error: 'الموظف غير موجود', statusCode: 404 });
      if (!target.restaurantId || !ownTenant(req, target.restaurantId)) return deny(req, res);

      // Tenant managers can never touch platform accounts through this route.
      if (PLATFORM_ROLE_SET.has(target.role) && !isPlatformUser(req)) {
        return deny(req, res, 'غير مصرح لك بتعديل حسابات إدارة المنصة');
      }

      const { name, role, status, password, pin } = req.body as {
        name?: string;
        role?: 'RESTAURANT_MANAGER' | 'WAITER' | 'KITCHEN' | 'CASHIER' | 'STAFF';
        status?: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
        password?: string;
        pin?: string;
      };

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

      const credentialsChanged =
        password !== undefined ||
        (pin !== undefined && pin !== '') ||
        (role !== undefined && role !== target.role) ||
        (status !== undefined && status !== target.status);

      const updated = await prisma.restaurantUser.update({
        where: { id },
        data: {
          name: name !== undefined ? name : undefined,
          role: role !== undefined ? role : undefined,
          status: status !== undefined ? status : undefined,
          passwordHash: password ? await bcrypt.hash(password, 12) : undefined,
          pinHash:
            pin !== undefined && pin !== ''
              ? await bcrypt.hash(pin, 10)
              : pin === ''
                ? null
                : undefined,
          // Revoke the target's sessions when their authority changes.
          tokenVersion: credentialsChanged ? { increment: 1 } : undefined,
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
        details: `تم تحديث بيانات الموظف ${target.name}`,
      });
      return res.json({ success: true, data: { user: updated }, statusCode: 200 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر تحديث الموظف', statusCode: 500 });
    }
  }
);

router.delete('/staff/:id', requireManager(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
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
    return res.json({ success: true, data: offers, statusCode: 200 });
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
      const offer = await prisma.offer.create({
        data: {
          id: `offer-${randomUUID()}`,
          restaurantId,
          title: b.title,
          titleEn: b.titleEn || undefined,
          subtitle: b.subtitle || undefined,
          description: b.description || undefined,
          image: b.image || undefined,
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
      return res.status(201).json({ success: true, data: { offer }, statusCode: 201 });
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
      const updated = await prisma.offer.update({
        where: { id },
        data: {
          title: b.title !== undefined ? b.title : undefined,
          titleEn: b.titleEn !== undefined ? b.titleEn : undefined,
          subtitle: b.subtitle !== undefined ? b.subtitle : undefined,
          description: b.description !== undefined ? b.description : undefined,
          image: b.image !== undefined ? b.image : undefined,
          originalPrice: b.originalPrice !== undefined ? b.originalPrice : undefined,
          discountedPrice: b.discountedPrice !== undefined ? b.discountedPrice : undefined,
          discountPercentage: b.discountPercentage !== undefined ? b.discountPercentage : undefined,
          badge: b.badge !== undefined ? b.badge : undefined,
          bgGradient: b.bgGradient !== undefined ? b.bgGradient : undefined,
          isActive: b.isActive !== undefined ? b.isActive : undefined,
          code: b.code !== undefined ? b.code : undefined,
        },
      });
      return res.json({ success: true, data: { offer: updated }, statusCode: 200 });
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
    // trialDays is derived server-side so no client hardcodes the trial length.
    return res.json({ success: true, data: { subscription, plans: plans.map(withTrialMeta) }, statusCode: 200 });
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
        await logAuditEvent({
          restaurantId,
          userId: req.user!.id,
          actor: req.user!.name,
          actorRole: req.user!.role,
          action: 'PLAN_CHANGE_DENIED',
          entity: 'Subscription',
          entityId: restaurantId,
          details: `محاولة تغيير الباقة إلى ${plan.name} رُفضت: ${verdict.reason}`,
        });
        return res.status(verdict.statusCode).json({
          success: false,
          error: verdict.reason,
          statusCode: verdict.statusCode,
        });
      }
      // Guard against exceeding plan limits with existing data
      const [tablesCount, categoriesCount, productsCount, branchesCount] = await Promise.all([
        prisma.table.count({ where: { restaurantId } }),
        prisma.category.count({ where: { restaurantId } }),
        prisma.product.count({ where: { restaurantId } }),
        prisma.branch.count({ where: { restaurantId } }),
      ]);
      if (
        tablesCount > plan.maxTables ||
        categoriesCount > plan.maxCategories ||
        productsCount > plan.maxProducts ||
        branchesCount > plan.maxBranches
      ) {
        return res.status(400).json({
          success: false,
          error: `لا يمكن الترقية: بياناتك الحالية تتجاوز حدود الباقة (طاولات ${plan.maxTables} / تصنيفات ${plan.maxCategories} / أطباق ${plan.maxProducts} / فروع ${plan.maxBranches})`,
          statusCode: 400,
        });
      }
      const subscription = await prisma.subscription.upsert({
        where: { restaurantId },
        create: {
          restaurantId,
          planId,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000),
        },
        update: { planId },
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
        details: `تم تغيير باقة الاشتراك إلى ${plan.name}`,
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

      // Capture the pre-update asset URLs so replaced images can be cleaned up
      // AFTER the database commit succeeds (never before — see rule 7).
      const existing = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { logoUrl: true, coverImageUrl: true, galleryImages: true },
      });

      const updated = await prisma.restaurant.update({
        where: { id: restaurantId },
        data: {
          name: b.name !== undefined ? b.name : undefined,
          nameEn: b.nameEn !== undefined ? b.nameEn : undefined,
          description: b.description !== undefined ? b.description : undefined,
          phone: b.phone !== undefined ? b.phone : undefined,
          address: b.address !== undefined ? b.address : undefined,
          logoUrl: b.logo !== undefined ? b.logo : undefined,
          coverImageUrl: b.coverImage !== undefined ? b.coverImage : undefined,
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
          galleryImages: b.galleryImages !== undefined ? b.galleryImages : undefined,
          latitude: b.latitude !== undefined ? b.latitude : undefined,
          longitude: b.longitude !== undefined ? b.longitude : undefined,
          mapUrl:
            b.mapUrl !== undefined
              ? b.mapUrl === ''
                ? null
                : b.mapUrl
              : undefined,
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

      // Best-effort cleanup of replaced assets — AFTER the DB commit. Only
      // URLs owned by this tenant are touched; failures are logged, never
      // thrown, so a storage hiccup cannot roll back the committed branding.
      if (existing) {
        const replaced: Array<string | null | undefined> = [];
        if (b.logo !== undefined && existing.logoUrl && b.logo !== existing.logoUrl) {
          replaced.push(existing.logoUrl);
        }
        if (
          b.coverImage !== undefined &&
          existing.coverImageUrl &&
          b.coverImage !== existing.coverImageUrl
        ) {
          replaced.push(existing.coverImageUrl);
        }
        if (b.galleryImages !== undefined) {
          const next = new Set(b.galleryImages);
          for (const old of existing.galleryImages) {
            if (!next.has(old)) replaced.push(old);
          }
        }
        if (replaced.length > 0) {
          void deleteManagedAssets(getStorage(), restaurantId, replaced);
        }
      }

      return res.json({ success: true, data: { restaurant: updated }, statusCode: 200 });
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
      createdAt: p.createdAt.toISOString(),
    }));
    return res.json({ success: true, data: formatted, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع سجل الدفعات', statusCode: 500 });
  }
});

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
      // Every billed order must belong to the billed table (no mixed-table bills).
      const foreignOrder = ordersToPay.find((o) => o.tableId !== tableId);
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
      const tipValue = roundMoney(Math.max(0, tip ?? 0));
      // Cash payments must record sufficient tendered cash — a CASH payment
      // with missing or short cash is rejected, never silently marked PAID.
      if (paidMethod === 'CASH') {
        if (cashReceived === undefined || !Number.isFinite(cashReceived)) {
          return res.status(400).json({ success: false, error: 'مبلغ المقبوض النقدي مطلوب للدفع النقدي', statusCode: 400 });
        }
        if (cashReceived < total + tipValue) {
          return res.status(400).json({ success: false, error: 'المبلغ المقبوض أقل من قيمة الفاتورة', statusCode: 400 });
        }
      }
      const cashValue = paidMethod === 'CASH' ? roundMoney(cashReceived as number) : 0;
      const changeValue =
        paidMethod === 'CASH' ? roundMoney(cashValue - total - tipValue) : 0;

      const now = new Date();

      // Receipt allocation retries on unique collisions (concurrent POS).
      let payment: Awaited<ReturnType<typeof prisma.payment.create>> | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 5 && !payment; attempt += 1) {
        const seq = (await prisma.payment.count({ where: { restaurantId } })) + 1 + attempt;
        const receiptNumber = `RC-${now.getFullYear()}-${String(seq).padStart(4, '0')}`;
        try {
          payment = await prisma.$transaction(async (tx) => {
            // Conditional claim: only still-UNPAID rows flip; the count
            // check below turns a lost double-submit race into a 409.
            const claimed = await tx.order.updateMany({
              where: {
                id: { in: ordersToPay.map((o) => o.id) },
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
            if (claimed.count !== ordersToPay.length) {
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
        console.error('Payment receipt allocation failed:', lastError);
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
      });

      realtimeService.broadcastToTable(restaurantId, tableId, 'PAYMENT_RECORDED', {
        receiptNumber: payment.receiptNumber,
        tableId,
        total,
      });

      return res.status(201).json({ success: true, data: { payment }, statusCode: 201 });
    } catch (err) {
      console.error('Payment error:', err);
      return res.status(500).json({ success: false, error: 'تعذر إتمام الدفع', statusCode: 500 });
    }
  }
);

export default router;
