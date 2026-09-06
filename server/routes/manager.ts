import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma';
import { requireAuth, requireTenantAccess } from '../middleware/auth';
import { realtimeService } from '../services/realtime';
import { logAuditEvent } from '../services/audit';
import bcrypt from 'bcryptjs';
import { OrderStatus, TableZone, TableStatus } from '@prisma/client';

const router = Router();

// Middleware: Extract tenant ID for manager access verification
function getTenantId(req: Request): string | undefined {
  return (req.query.restaurantId as string) || req.body.restaurantId || req.user?.restaurantId || undefined;
}

router.use(requireAuth);

// Menu operations must remain tenant-scoped, including read requests.
router.use('/menu', requireTenantAccess((req) => getTenantId(req)));

// Strict tenant ownership helpers -------------------------------------------
function isPlatformUser(req: Request): boolean {
  const role = req.user!.role;
  return role === 'SUPER_ADMIN' || role === 'PLATFORM_ADMIN';
}

function ownTenant(req: Request, restaurantId: string | null | undefined): boolean {
  return !!restaurantId && (isPlatformUser(req) || req.user!.restaurantId === restaurantId);
}

function deny(res: Response, msg = 'غير مصرح لك بالوصول لبيانات هذا المطعم (Tenant Isolation Violation)') {
  return res.status(403).json({ success: false, error: msg, statusCode: 403 });
}
// ----------------------------------------------------------------------------

// GET /api/manager/dashboard/stats
router.get('/dashboard/stats', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: 'restaurantId is required', statusCode: 400 });
    }

    // Verify tenant access
    if (req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'PLATFORM_ADMIN' && req.user!.restaurantId !== restaurantId) {
      return res.status(403).json({
        success: false,
        error: 'غير مصرح لك بالوصول لبيانات هذا المطعم (Tenant Isolation Violation)',
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

// GET /api/manager/orders
router.get('/orders', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

    if (req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'PLATFORM_ADMIN' && req.user!.restaurantId !== restaurantId) {
      return res.status(403).json({ success: false, error: 'Cross-Tenant Access Denied', statusCode: 403 });
    }

    const orders = await prisma.order.findMany({
      where: { restaurantId },
      include: {
        items: true,
        table: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = orders.map((o) => ({
      id: o.id,
      numericId: o.numericId,
      restaurantId: o.restaurantId,
      tableId: o.tableId,
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

// PUT /api/manager/orders/:orderId/status

// POST /api/manager/orders — POS / counter order placed by tenant staff
// (manager/cashier). Server re-prices every item from the tenant's own menu.
router.post('/orders', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);

    const { tableId, items, notes } = req.body;
    if (!tableId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'بيانات الطلب غير مكتملة', statusCode: 400 });
    }

    const isWalkIn = tableId === '__WALKIN__';
    if (!isWalkIn) {
      const table = await prisma.table.findUnique({ where: { id: tableId } });
      if (!table || table.restaurantId !== restaurantId) {
        return res.status(404).json({ success: false, error: 'الطاولة غير موجودة في هذا المطعم', statusCode: 404 });
      }
    }

    const productIds = items.map((item: any) => item.productId).filter(Boolean);
    const products = await prisma.product.findMany({
      where: { restaurantId, id: { in: productIds } },
    });
    if (products.length !== new Set(productIds).size) {
      return res.status(400).json({ success: false, error: 'يحتوي الطلب على طبق غير صالح لهذا المطعم', statusCode: 400 });
    }
    const productMap = new Map(products.map((product) => [product.id, product]));

    const pricedItems = items.map((item: any) => {
      const product = productMap.get(item.productId);
      const quantity = Number(item.quantity);
      const safeQty = Number.isInteger(quantity) && quantity > 0 && quantity <= 50 ? quantity : 1;
      const unitPrice = product?.price || 0;
      return { ...item, quantity: safeQty, unitPrice, totalPrice: unitPrice * safeQty };
    });
    const subtotal = pricedItems.reduce((sum: number, item: any) => sum + item.totalPrice, 0);

    const count = await prisma.order.count({ where: { restaurantId } });
    const nextNum = 1001 + count;
    const orderId = `#${nextNum}`;

    const newOrder = await prisma.order.create({
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
        items: {
          create: pricedItems.map((i: any) => ({
            productId: i.productId,
            productNameSnapshot: i.productName || i.name || 'صنف',
            productNameEnSnapshot: i.productNameEn || i.nameEn || undefined,
            priceSnapshot: i.unitPrice,
            quantity: i.quantity,
            selectedAddOns: i.selectedAddOns || [],
            removedIngredients: i.removedIngredients || [],
            specialInstructions: i.specialInstructions || i.notes || undefined,
            totalPrice: Number(i.totalPrice) || 0,
          })),
        },
      },
      include: { items: true },
    });

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
      entityId: orderId,
      details: `فاتورة كاشير ${orderId} بقيمة ${subtotal} (${isWalkIn ? 'عميل مباشر' : 'طاولة ' + tableId})`,
    });

    realtimeService.broadcastToRestaurant(restaurantId, 'ORDER_CREATED', {
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
});

router.put('/orders/:orderId/status', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { status, restaurantId } = req.body;
    const targetRestId = restaurantId || req.user?.restaurantId;

    if (!targetRestId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

    if (req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'PLATFORM_ADMIN' && req.user!.restaurantId !== targetRestId) {
      return res.status(403).json({ success: false, error: 'Cross-Tenant Access Denied', statusCode: 403 });
    }

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
      data: { status: status as OrderStatus },
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

    // Broadcast update via SSE
    realtimeService.broadcastToRestaurant(targetRestId, 'ORDER_STATUS_UPDATED', {
      orderId,
      status,
      tableId: order.tableId,
    });

    return res.json({ success: true, data: { order: updated }, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر تحديث حالة الطلب', statusCode: 500 });
  }
});

// GET /api/manager/tables
router.get('/tables', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

    if (req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'PLATFORM_ADMIN' && req.user!.restaurantId !== restaurantId) {
      return res.status(403).json({ success: false, error: 'Cross-Tenant Access Denied', statusCode: 403 });
    }

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
router.post('/tables', async (req: Request, res: Response) => {
  try {
    const { restaurantId, tableNumber, capacity, zone } = req.body;
    const targetRestId = restaurantId || req.user?.restaurantId;

    if (!targetRestId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

    if (!ownTenant(req, targetRestId)) return deny(res);

    const num = Number(tableNumber);
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
        name: `طاولة ${numStr}`,
        capacity: Number(capacity) || 4,
        zone: (zone as TableZone) || 'MAIN_HALL',
        status: 'AVAILABLE',
        qrToken: randomUUID(),
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
});

// POST /api/manager/tables/:id/settle (Settle Table Bill)
router.post('/tables/:id/settle', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const table = await prisma.table.findUnique({ where: { id } });
    if (!table) return res.status(404).json({ success: false, error: 'الطاولة غير موجودة', statusCode: 404 });
    // Strict ownership: only the tenant that owns the table (or a platform admin) can settle it.
    if (!ownTenant(req, table.restaurantId)) return deny(res);
    const targetRestId = table.restaurantId;

    // Mark active orders as SERVED
    await prisma.order.updateMany({
      where: {
        tableId: id,
        restaurantId: table.restaurantId,
        status: { in: ['PENDING', 'PREPARING', 'READY'] },
      },
      data: { status: 'SERVED' },
    });

    // Reset table status and resolve waiter calls
    await prisma.table.update({
      where: { id },
      data: {
        status: 'AVAILABLE',
        hasWaiterCall: false,
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
        endedAt: new Date(),
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
        resolvedAt: new Date(),
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
      details: `تمت تسوية حساب الطاولة ${id} وإعادتها متاحة`,
    });

    realtimeService.broadcastToRestaurant(table.restaurantId, 'TABLE_SETTLED', { tableId: id });

    return res.json({ success: true, message: `تمت تسوية حساب ${id} بنجاح`, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر تصفية حساب الطاولة', statusCode: 500 });
  }
});

// POST /api/manager/tables/:id/regenerate-qr (Regenerate Secure QR Token)
router.post('/tables/:id/regenerate-qr', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const table = await prisma.table.findUnique({ where: { id } });
    if (!table) return res.status(404).json({ success: false, error: 'الطاولة غير موجودة', statusCode: 404 });
    if (!ownTenant(req, table.restaurantId)) return deny(res);

    const newToken = `qr-${table.restaurantId}-${table.number}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const updated = await prisma.table.update({
      where: { id },
      data: { qrToken: newToken },
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
router.post('/menu/categories', async (req: Request, res: Response) => {
  const { restaurantId, name, nameEn } = req.body;
  const targetRestId = restaurantId || req.user?.restaurantId;
  const count = await prisma.category.count({ where: { restaurantId: targetRestId } });

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
});

// PUT /api/manager/menu/categories/:id
router.put('/menu/categories/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: 'التصنيف غير موجود', statusCode: 404 });
    if (!ownTenant(req, existing.restaurantId)) return deny(res);

    const { name, nameEn, sortOrder } = req.body;
    const updated = await prisma.category.update({
      where: { id },
      data: {
        name: name !== undefined ? name : undefined,
        nameEn: nameEn !== undefined ? nameEn : undefined,
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : undefined,
      },
    });
    return res.json({ success: true, data: { category: updated }, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر تعديل التصنيف', statusCode: 500 });
  }
});

// DELETE /api/manager/menu/categories/:id
router.delete('/menu/categories/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) return res.status(404).json({ success: false, error: 'التصنيف غير موجود', statusCode: 404 });
    if (!ownTenant(req, category.restaurantId)) return deny(res);
    await prisma.category.delete({ where: { id } });
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
router.post('/menu/products', async (req: Request, res: Response) => {
  try {
    const {
      restaurantId,
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
    } = req.body;

    const targetRestId = restaurantId || req.user?.restaurantId;

    const newProd = await prisma.product.create({
      data: {
        restaurantId: targetRestId,
        categoryId,
        name,
        nameEn: nameEn || name,
        description,
        price: Number(price),
        imageUrl: image,
        badge: badge || undefined,
        preparationTimeMinutes: Number(preparationTimeMinutes) || 15,
        calories: Number(calories) || 450,
        available: isAvailable !== false,
        isFeatured: isFeatured || false,
        allergens: allergens || [],
        ingredients: ingredients || [],
        removableIngredients: removableIngredients || ingredients || [],
        options: {
          create: (sizes || []).map((s: any) => ({
            name: s.name,
            nameEn: s.nameEn || undefined,
            priceModifier: Number(s.priceModifier || s.price || 0),
            price: Number(s.price || s.priceModifier || 0),
          })),
        },
        addOns: {
          create: (addOns || []).map((a: any) => ({
            name: a.name,
            nameEn: a.nameEn || undefined,
            price: Number(a.price || 0),
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
});

// PUT /api/manager/menu/products/:id/stock (Instant Stock Toggle)
router.put('/menu/products/:id/stock', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return res.status(404).json({ success: false, error: 'الطبق غير موجود', statusCode: 404 });
    if (!ownTenant(req, product.restaurantId)) return deny(res);

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
router.put('/menu/products/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) return res.status(404).json({ success: false, error: 'الطبق غير موجود', statusCode: 404 });
    if (!ownTenant(req, existingProduct.restaurantId)) return deny(res);
    if (data.categoryId) {
      const targetCategory = await prisma.category.findUnique({ where: { id: data.categoryId } });
      if (!targetCategory || targetCategory.restaurantId !== existingProduct.restaurantId) {
        return res.status(400).json({ success: false, error: 'التصنيف المحدد لا ينتمي لمطعمك', statusCode: 400 });
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: data.name,
        nameEn: data.nameEn,
        description: data.description,
        price: Number(data.price),
        imageUrl: data.image || data.imageUrl,
        categoryId: data.categoryId,
        available: data.isAvailable !== false,
        isFeatured: data.isFeatured || false,
        badge: data.badge || null,
        preparationTimeMinutes: Number(data.preparationTimeMinutes) || 15,
        calories: Number(data.calories) || 450,
      },
    });

    return res.json({ success: true, data: updated, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر تعديل الطبق', statusCode: 500 });
  }
});

// DELETE /api/manager/menu/products/:id
router.delete('/menu/products/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return res.status(404).json({ success: false, error: 'الطبق غير موجود', statusCode: 404 });
    if (!ownTenant(req, product.restaurantId)) return deny(res);
    await prisma.product.delete({ where: { id } });
    return res.json({ success: true, message: 'تم حذف الطبق', statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر حذف الطبق', statusCode: 500 });
  }
});

// GET /api/manager/waiter-requests
router.get('/waiter-requests', async (req: Request, res: Response) => {
  const restaurantId = getTenantId(req);
  if (!restaurantId) return res.status(400).json({ success: false, error: 'restaurantId required', statusCode: 400 });

  const reqs = await prisma.waiterRequest.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ success: true, data: reqs, statusCode: 200 });
});

// PUT /api/manager/waiter-requests/:id/status
router.put('/waiter-requests/:id/status', async (req: Request, res: Response) => {
  try {
  const { id } = req.params;
  const { status } = req.body;

  const existing = await prisma.waiterRequest.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ success: false, error: 'النداء غير موجود', statusCode: 404 });
  if (!ownTenant(req, existing.restaurantId)) return deny(res);

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

  return res.json({ success: true, data: reqObj, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر تحديث حالة النداء', statusCode: 500 });
  }
});

// GET /api/manager/export/orders (CSV Export Architecture)
router.get('/export/orders', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) return res.status(400).send('restaurantId required');

    const orders = await prisma.order.findMany({
      where: { restaurantId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    let csv = 'Order ID,Table,Date,Status,Total,Items Count,Notes\n';
    orders.forEach((o) => {
      const itemsCount = o.items.reduce((s, i) => s + i.quantity, 0);
      csv += `"${o.id}","${o.tableId}","${o.createdAt.toISOString()}","${o.status}",${o.total},${itemsCount},"${(o.notes || '').replace(/"/g, '""')}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-export-${restaurantId}-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).send('CSV Export Failed');
  }
});

// ============================================================================
// REAL FEATURE SURFACE — Staff, Offers, Subscription, Branding, Branches,
// Payments (POS). Every handler re-verifies ownership of the target row
// against the JWT tenant (platform admins excepted).
// ============================================================================

// ---------- Table update (capacity/zone/status/branch) ----------
router.put('/tables/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const table = await prisma.table.findUnique({ where: { id } });
    if (!table) return res.status(404).json({ success: false, error: 'الطاولة غير موجودة', statusCode: 404 });
    if (!ownTenant(req, table.restaurantId)) return deny(res);

    const { tableNumber, capacity, zone, status, branchId, name } = req.body;

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
        number: tableNumber !== undefined ? Number(tableNumber) : undefined,
        name: name !== undefined ? name : undefined,
        capacity: capacity !== undefined ? Number(capacity) : undefined,
        zone: zone !== undefined ? (zone as TableZone) : undefined,
        status: status !== undefined ? (status as TableStatus) : undefined,
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
});

// ---------- Staff management (tenant users) ----------
router.get('/staff', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);

    const staff = await prisma.restaurantUser.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        restaurantId: true,
        name: true,
        email: true,
        role: true,
        status: true,
        avatar: true,
        createdAt: true,
      },
    });
    return res.json({ success: true, data: staff, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع الموظفين', statusCode: 500 });
  }
});

router.post('/staff', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
    const { name, email, password, pin, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, error: 'الاسم والبريد وكلمة المرور والدور مطلوبة', statusCode: 400 });
    }
    if (pin !== undefined && pin !== null && pin !== '' && (typeof pin !== 'string' || pin.length < 4)) {
      return res.status(400).json({ success: false, error: 'رمز PIN يجب أن يكون 4 أرقام على الأقل', statusCode: 400 });
    }
    const allowedRoles = ['RESTAURANT_MANAGER', 'WAITER', 'KITCHEN', 'CASHIER', 'STAFF'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, error: 'دور غير صالح', statusCode: 400 });
    }
    const existing = await prisma.restaurantUser.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ success: false, error: 'هذا البريد مستخدم مسبقًا', statusCode: 409 });

    const user = await prisma.restaurantUser.create({
      data: {
        id: `user-${randomUUID()}`,
        restaurantId,
        name,
        email: email.toLowerCase(),
        passwordHash: bcrypt.hashSync(password, 12),
        pinHash: pin ? bcrypt.hashSync(String(pin), 12) : undefined,
        role,
        status: 'ACTIVE',
      },
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
});

router.put('/staff/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const target = await prisma.restaurantUser.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ success: false, error: 'الموظف غير موجود', statusCode: 404 });
    if (!target.restaurantId || !ownTenant(req, target.restaurantId)) return deny(res);

    const { name, role, status, password, pin } = req.body;
    const updated = await prisma.restaurantUser.update({
      where: { id },
      data: {
        name: name !== undefined ? name : undefined,
        role: role !== undefined ? role : undefined,
        status: status !== undefined ? status : undefined,
        passwordHash: password ? bcrypt.hashSync(password, 12) : undefined,
        pinHash: pin !== undefined && pin !== null && pin !== '' ? bcrypt.hashSync(String(pin), 12) : pin === '' ? null : undefined,
      },
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
});

router.delete('/staff/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const target = await prisma.restaurantUser.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ success: false, error: 'الموظف غير موجود', statusCode: 404 });
    if (!target.restaurantId || !ownTenant(req, target.restaurantId)) return deny(res);
    if (req.user!.id === id) return res.status(400).json({ success: false, error: 'لا يمكنك حذف حسابك الحالي', statusCode: 400 });
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
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
    const offers = await prisma.offer.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ success: true, data: offers, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع العروض', statusCode: 500 });
  }
});

router.post('/offers', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
    const offer = await prisma.offer.create({
      data: {
        id: `offer-${randomUUID()}`,
        restaurantId,
        title: req.body.title,
        titleEn: req.body.titleEn || undefined,
        subtitle: req.body.subtitle || undefined,
        description: req.body.description || undefined,
        image: req.body.image || undefined,
        originalPrice: req.body.originalPrice !== undefined ? Number(req.body.originalPrice) : undefined,
        discountedPrice: req.body.discountedPrice !== undefined ? Number(req.body.discountedPrice) : undefined,
        discountPercentage: req.body.discountPercentage !== undefined ? Number(req.body.discountPercentage) : undefined,
        badge: req.body.badge || undefined,
        bgGradient: req.body.bgGradient || undefined,
        isActive: req.body.isActive !== false,
        code: req.body.code || undefined,
      },
    });
    return res.status(201).json({ success: true, data: { offer }, statusCode: 201 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر إنشاء العرض', statusCode: 500 });
  }
});

router.put('/offers/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.offer.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: 'العرض غير موجود', statusCode: 404 });
    if (!ownTenant(req, existing.restaurantId)) return deny(res);
    const b = req.body;
    const updated = await prisma.offer.update({
      where: { id },
      data: {
        title: b.title !== undefined ? b.title : undefined,
        titleEn: b.titleEn !== undefined ? b.titleEn : undefined,
        subtitle: b.subtitle !== undefined ? b.subtitle : undefined,
        description: b.description !== undefined ? b.description : undefined,
        image: b.image !== undefined ? b.image : undefined,
        originalPrice: b.originalPrice !== undefined ? Number(b.originalPrice) : undefined,
        discountedPrice: b.discountedPrice !== undefined ? Number(b.discountedPrice) : undefined,
        discountPercentage: b.discountPercentage !== undefined ? Number(b.discountPercentage) : undefined,
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
});

router.delete('/offers/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.offer.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: 'العرض غير موجود', statusCode: 404 });
    if (!ownTenant(req, existing.restaurantId)) return deny(res);
    await prisma.offer.delete({ where: { id } });
    return res.json({ success: true, message: 'تم حذف العرض', statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر حذف العرض', statusCode: 500 });
  }
});

// ---------- Subscription (current + plan catalog + change plan) ----------
router.get('/subscription', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
    const subscription = await prisma.subscription.findUnique({
      where: { restaurantId },
      include: { plan: true },
    });
    const plans = await prisma.plan.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { priceMonthly: 'asc' },
    });
    return res.json({ success: true, data: { subscription, plans }, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر استرجاع الاشتراك', statusCode: 500 });
  }
});

router.put('/subscription/plan', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
    const { planId } = req.body;
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || plan.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, error: 'الباقة المحددة غير متاحة', statusCode: 400 });
    }
    // Guard against exceeding plan limits with existing data
    const [tablesCount, productsCount] = await Promise.all([
      prisma.table.count({ where: { restaurantId } }),
      prisma.product.count({ where: { restaurantId } }),
    ]);
    if (tablesCount > plan.maxTables || productsCount > plan.maxProducts) {
      return res.status(400).json({
        success: false,
        error: `لا يمكن الترقية: بياناتك الحالية تتجاوز حدود الباقة (طاولات ${plan.maxTables} / أطباق ${plan.maxProducts})`,
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
});

// ---------- Branding ----------
router.put('/branding', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
    const b = req.body;
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
    return res.json({ success: true, data: { restaurant: updated }, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر تحديث الهوية البصرية', statusCode: 500 });
  }
});

// ---------- Multi-branch management ----------
router.get('/branches', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
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

router.post('/branches', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
    const b = req.body;
    if (!b.name) return res.status(400).json({ success: false, error: 'اسم الفرع مطلوب', statusCode: 400 });
    const branch = await prisma.branch.create({
      data: {
        id: b.id || `branch-${randomUUID()}`,
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
});

router.put('/branches/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.branch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: 'الفرع غير موجود', statusCode: 404 });
    if (!ownTenant(req, existing.restaurantId)) return deny(res);
    const b = req.body;
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
});

router.delete('/branches/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.branch.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: 'الفرع غير موجود', statusCode: 404 });
    if (!ownTenant(req, existing.restaurantId)) return deny(res);
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

router.post('/branches/assign-tables', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
    const { branchId, tableIds } = req.body;
    if (!Array.isArray(tableIds) || tableIds.length === 0) {
      return res.status(400).json({ success: false, error: 'اختر طاولة واحدة على الأقل', statusCode: 400 });
    }
    if (branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: branchId } });
      if (!branch || branch.restaurantId !== restaurantId) {
        return res.status(400).json({ success: false, error: 'الفرع لا ينتمي لمطعمك', statusCode: 400 });
      }
    }
    const owned = await prisma.table.count({
      where: { id: { in: tableIds }, restaurantId },
    });
    if (owned !== tableIds.length) {
      return res.status(403).json({ success: false, error: 'بعض الطاولات لا تنتمي لمطعمك', statusCode: 403 });
    }
    await prisma.table.updateMany({
      where: { id: { in: tableIds }, restaurantId },
      data: { branchId: branchId || null },
    });
    await logAuditEvent({
      restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'TABLES_BRANCH_ASSIGNED',
      details: `تم توزيع ${tableIds.length} طاولات على فرع ${branchId || 'غير مصنف'}`,
    });
    return res.json({ success: true, message: 'تم تحديث توزيع الطاولات', statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر توزيع الطاولات', statusCode: 500 });
  }
});

// ---------- Payments (POS ledger) ----------
router.get('/payments', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
    const payments = await prisma.payment.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      take: 500,
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

router.post('/payments', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId || !ownTenant(req, restaurantId)) return deny(res);
    const { orderIds, method, cashReceived, tip, note } = req.body;
    const tableId: string = req.body.tableId || '';
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ success: false, error: 'لا توجد فواتير مفتوحة لإتمام الدفع', statusCode: 400 });
    }
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

    const total = Math.round(ordersToPay.reduce((sum, o) => sum + o.total, 0) * 100) / 100;
    const subtotal = Math.round(ordersToPay.reduce((sum, o) => sum + o.subtotal, 0) * 100) / 100;
    if (total <= 0) return res.status(400).json({ success: false, error: 'قيمة الفاتورة صفرية', statusCode: 400 });

    const paidMethod = method || 'CASH';
    const tipValue = Math.round(Math.max(0, Number(tip) || 0) * 100) / 100;
    const cashValue = paidMethod === 'CASH' && cashReceived !== undefined ? Number(cashReceived) || 0 : 0;
    const changeValue =
      paidMethod === 'CASH' && cashValue >= total + tipValue
        ? Math.round((cashValue - total - tipValue) * 100) / 100
        : 0;

    const seq = (await prisma.payment.count({ where: { restaurantId } })) + 1;
    const receiptNumber = `RC-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
    const now = new Date();

    const payment = await prisma.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { id: { in: ordersToPay.map((o) => o.id) }, restaurantId },
        data: {
          status: 'SERVED',
          paymentStatus: 'PAID',
          paymentMethod: paidMethod,
          settledAt: now,
          cashierId: req.user!.id,
        },
      });

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

    await logAuditEvent({
      restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'PROCESS_PAYMENT',
      entity: 'Payment',
      entityId: payment.id,
      details: `إيصال ${receiptNumber} — ${payment.tableLabel} — ${total} (${paidMethod})`,
    });

    realtimeService.broadcastToRestaurant(restaurantId, 'PAYMENT_RECORDED', {
      receiptNumber,
      tableId,
      total,
    });

    return res.status(201).json({ success: true, data: { payment }, statusCode: 201 });
  } catch (err) {
    console.error('Payment error:', err);
    return res.status(500).json({ success: false, error: 'تعذر إتمام الدفع', statusCode: 500 });
  }
});

export default router;
