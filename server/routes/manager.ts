import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma';
import { requireAuth, requireTenantAccess } from '../middleware/auth';
import { realtimeService } from '../services/realtime';
import { logAuditEvent } from '../services/audit';
import { OrderStatus, TableZone, TableStatus } from '@prisma/client';

const router = Router();

// Middleware: Extract tenant ID for manager access verification
function getTenantId(req: Request): string | undefined {
  return (req.query.restaurantId as string) || req.body.restaurantId || req.user?.restaurantId || undefined;
}

router.use(requireAuth);

router.use((req: Request, res: Response, next) => {
  if (
    process.env.DEMO_MANAGER_EMAIL &&
    req.user?.email.toLowerCase() === process.env.DEMO_MANAGER_EMAIL.toLowerCase() &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
  ) {
    return res.status(403).json({
      success: false,
      error: 'الحساب التجريبي مخصص للعرض فقط ولا يملك صلاحية إجراء تغييرات حقيقية.',
      statusCode: 403,
    });
  }
  next();
});

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

    const num = Number(tableNumber);
    const numStr = num < 10 ? `0${num}` : `${num}`;
    const tableId = `TABLE-${numStr}`;

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
    const { restaurantId } = req.body;
    const targetRestId = restaurantId || req.user?.restaurantId;

    const table = await prisma.table.findUnique({ where: { id } });
    if (!table || (targetRestId && table.restaurantId !== targetRestId)) {
      return res.status(404).json({ success: false, error: 'الطاولة غير موجودة', statusCode: 404 });
    }

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

// DELETE /api/manager/menu/categories/:id
router.delete('/menu/categories/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  await prisma.category.delete({ where: { id } });
  return res.json({ success: true, message: 'تم حذف التصنيف', statusCode: 200 });
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
  const { id } = req.params;
  await prisma.product.delete({ where: { id } });
  return res.json({ success: true, message: 'تم حذف الطبق', statusCode: 200 });
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
  const { id } = req.params;
  const { status } = req.body;

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

export default router;
