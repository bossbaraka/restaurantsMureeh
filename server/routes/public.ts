import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma';
import { realtimeService } from '../services/realtime';
import { logAuditEvent } from '../services/audit';

const router = Router();

async function getQrSession(sessionToken: unknown, restaurantId: string, tableId: string) {
  if (typeof sessionToken !== 'string' || !sessionToken) return null;
  return prisma.tableSession.findFirst({
    where: {
      sessionToken,
      restaurantId,
      tableId,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
    },
  });
}

// GET /api/public/events (SSE Stream for Real-time Updates)
router.get('/events', async (req: Request, res: Response) => {
  const restaurantId = req.query.restaurantId as string;
  const tableId = req.query.tableId as string | undefined;
  const sessionToken = req.query.sessionToken as string | undefined;

  if (!restaurantId || !tableId || !sessionToken || !await getQrSession(sessionToken, restaurantId, tableId)) {
    return res.status(403).json({ success: false, error: 'جلسة QR مطلوبة للبث المباشر', statusCode: 403 });
  }

  if (!restaurantId) {
    return res.status(400).send('restaurantId is required');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = `sse-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  realtimeService.addClient({ id: clientId, restaurantId, tableId, res });

  // Send initial ping
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', clientId })}\n\n`);
});

// GET /api/public/restaurants/:slug
router.get('/restaurants/:slug', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug.toLowerCase();
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      include: {
        categories: {
          where: { status: 'ACTIVE' },
          orderBy: { sortOrder: 'asc' },
        },
        products: {
          where: { available: true },
          include: {
            options: true,
            addOns: { where: { isAvailable: true } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        offers: {
          where: { isActive: true },
        },
      },
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: 'المطعم غير موجود أو تم تغيير رابطه',
        statusCode: 404,
      });
    }

    const qrToken = req.query.qrToken;
    const qrTable = typeof qrToken === 'string'
      ? await prisma.table.findUnique({ where: { qrToken } })
      : null;
    if (!qrTable || qrTable.restaurantId !== restaurant.id) {
      return res.status(403).json({
        success: false,
        error: 'يجب فتح قائمة المطعم من رمز QR صالح',
        statusCode: 403,
      });
    }

    if (restaurant.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: 'هذا المطعم غير متاح للطلب حالياً',
        statusCode: 403,
      });
    }

    // Format products for frontend compatibility
    const formattedProducts = restaurant.products.map((p) => ({
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
          description: restaurant.description,
          phone: restaurant.phone,
          address: restaurant.address,
          currency: restaurant.currency,
          language: restaurant.language,
          timezone: restaurant.timezone,
          status: restaurant.status,
          primaryColor: restaurant.primaryColor,
          accentColor: restaurant.accentColor,
        },
        categories: restaurant.categories.map((c) => ({
          id: c.id,
          restaurantId: c.restaurantId,
          name: c.name,
          nameEn: c.nameEn || undefined,
          sortOrder: c.sortOrder,
        })),
        products: formattedProducts,
        offers: restaurant.offers.map((o) => ({
          id: o.id,
          restaurantId: o.restaurantId,
          title: o.title,
          titleEn: o.titleEn || undefined,
          subtitle: o.subtitle || undefined,
          description: o.description || undefined,
          image: o.image || undefined,
          discountedPrice: o.discountedPrice || undefined,
          originalPrice: o.originalPrice || undefined,
          badge: o.badge || undefined,
          isActive: o.isActive,
        })),
      },
      statusCode: 200,
    });
  } catch (err) {
    console.error('Fetch public menu error:', err);
    return res.status(500).json({ success: false, error: 'حدث خطأ في استرجاع قائمة الطعام', statusCode: 500 });
  }
});

// GET /api/public/tables/qr/:qrToken (Resolve Table from QR Token)
router.get('/tables/qr/:qrToken', async (req: Request, res: Response) => {
  try {
    const { qrToken } = req.params;
    const table = await prisma.table.findUnique({
      where: { qrToken },
      include: { restaurant: true },
    });

    if (!table || !table.restaurant) {
      return res.status(404).json({
        success: false,
        error: 'رمز QR غير صالح أو منتهي الصلاحية',
        statusCode: 404,
      });
    }

    if (table.restaurant.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: 'المطعم غير متاح حالياً',
        statusCode: 403,
      });
    }

    return res.json({
      success: true,
      data: {
        table: {
          id: table.id,
          number: table.number,
          name: table.name,
          capacity: table.capacity,
          zone: table.zone,
          status: table.status,
        },
        restaurant: {
          id: table.restaurant.id,
          slug: table.restaurant.slug,
          name: table.restaurant.name,
          nameEn: table.restaurant.nameEn,
          logo: table.restaurant.logoUrl,
        },
      },
      statusCode: 200,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر التحقق من رمز QR', statusCode: 500 });
  }
});

// POST /api/public/tables/qr/:qrToken/session
router.post('/tables/qr/:qrToken/session', async (req: Request, res: Response) => {
  try {
    const { qrToken } = req.params;
    const table = await prisma.table.findUnique({ where: { qrToken }, include: { restaurant: true } });

    if (!table || table.restaurant.status === 'SUSPENDED') {
      return res.status(403).json({ success: false, error: 'رمز QR غير صالح أو المطعم غير متاح', statusCode: 403 });
    }

    const restaurant = table.restaurant;

    // Check for existing active session
    let session = await prisma.tableSession.findFirst({
      where: {
        restaurantId: restaurant.id,
        tableId: table.id,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      session = await prisma.tableSession.create({
        data: {
          restaurantId: restaurant.id,
          tableId: table.id,
          sessionToken: `sess-${restaurant.id}-${table.id}-${Date.now()}-${randomUUID()}`,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 6 * 3600 * 1000), // 6 hours
        },
      });
    }

    return res.json({
      success: true,
      data: {
        sessionToken: session.sessionToken,
        sessionId: session.id,
        tableId: table.id,
        tableNumber: table.number,
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
        },
      },
      statusCode: 200,
    });
  } catch (err) {
    console.error('Create table session error:', err);
    return res.status(500).json({ success: false, error: 'تعذر إنشاء جلسة الطاولة', statusCode: 500 });
  }
});

// POST /api/public/orders (Submit Order from Table)
router.post('/orders', async (req: Request, res: Response) => {
  try {
    const { restaurantId, tableId, sessionToken, items, notes } = req.body;

    if (!restaurantId || !tableId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'بيانات الطلب غير مكتملة',
        statusCode: 400,
      });
    }

    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant || restaurant.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: 'المطعم غير متاح لقبول الطلبات حالياً',
        statusCode: 403,
      });
    }

    const table = await prisma.table.findUnique({ where: { id: tableId } });
    if (!table || table.restaurantId !== restaurantId) {
      return res.status(404).json({
        success: false,
        error: 'الطاولة غير موجودة في هذا المطعم',
        statusCode: 404,
      });
    }

    const session = await getQrSession(sessionToken, restaurantId, tableId);
    if (!session) {
      return res.status(403).json({ success: false, error: 'جلسة QR غير صالحة أو منتهية الصلاحية', statusCode: 403 });
    }
    const sessionId = session.id;

    // Calculate subtotal
    const productIds = items.map((item: any) => item.productId).filter(Boolean);
    const products = await prisma.product.findMany({
      where: { restaurantId, id: { in: productIds }, available: true },
      include: { options: true, addOns: { where: { isAvailable: true } } },
    });
    if (products.length !== new Set(productIds).size) {
      return res.status(400).json({ success: false, error: 'يحتوي الطلب على طبق غير صالح لهذا المطعم', statusCode: 400 });
    }

    const productMap = new Map(products.map((product) => [product.id, product]));
    const pricedItems = items.map((item: any) => {
      const product = productMap.get(item.productId);
      const quantity = Number(item.quantity);
      const unitPrice = product?.price || 0;
      return { ...item, quantity: Number.isInteger(quantity) && quantity > 0 && quantity <= 50 ? quantity : 1, unitPrice, totalPrice: unitPrice * (Number.isInteger(quantity) && quantity > 0 && quantity <= 50 ? quantity : 1) };
    });
    const subtotal = pricedItems.reduce((sum: number, item: any) => sum + item.totalPrice, 0);

    // Get next order number for restaurant
    const count = await prisma.order.count({ where: { restaurantId } });
    const nextNum = 1001 + count;
    const orderId = `#${nextNum}`;

    const newOrder = await prisma.order.create({
      data: {
        id: orderId,
        numericId: nextNum,
        restaurantId,
        tableId,
        sessionId,
        status: 'PENDING',
        paymentMethod: 'PAY AT CASHIER',
        subtotal,
        total: subtotal,
        notes: notes || undefined,
        estimatedPrepMinutes: 18,
        items: {
          create: pricedItems.map((i: any) => ({
            productId: i.productId,
            productNameSnapshot: i.productName || i.name || 'طبق',
            productNameEnSnapshot: i.productNameEn || i.nameEn || undefined,
            priceSnapshot: i.unitPrice,
            quantity: i.quantity,
            selectedSize: typeof i.selectedSize === 'object' ? i.selectedSize.name : i.selectedSize || undefined,
            selectedAddOns: i.selectedAddOns || [],
            removedIngredients: i.removedIngredients || [],
            specialInstructions: i.specialInstructions || i.notes || undefined,
            totalPrice: Number(i.totalPrice) || 0,
          })),
        },
      },
      include: { items: true },
    });

    // Update table status
    await prisma.table.update({
      where: { id: tableId },
      data: {
        status: 'OCCUPIED',
        lastActivityAt: new Date(),
      },
    });

    // Broadcast new order to Manager Dashboard via SSE
    realtimeService.broadcastToRestaurant(restaurantId, 'ORDER_CREATED', {
      orderId: newOrder.id,
      tableId,
      total: newOrder.total,
      status: newOrder.status,
      itemsCount: newOrder.items.length,
    });

    return res.status(201).json({
      success: true,
      data: { order: newOrder },
      statusCode: 201,
    });
  } catch (err: any) {
    console.error('Order creation error:', err);
    return res.status(500).json({ success: false, error: 'تعذر إرسال الطلب للمطبخ', statusCode: 500 });
  }
});

// POST /api/public/orders/:orderId/cancel (Customer Cancels Order)
router.post('/orders/:orderId/cancel', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const restaurantId = req.query.restaurantId as string || req.body.restaurantId;
    const sessionToken = req.query.sessionToken as string || req.body.sessionToken;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order || (restaurantId && order.restaurantId !== restaurantId)) {
      return res.status(404).json({ success: false, error: 'الطلب غير موجود', statusCode: 404 });
    }

    if (!restaurantId || !await getQrSession(sessionToken, order.restaurantId, order.tableId)) {
      return res.status(403).json({ success: false, error: 'جلسة QR غير صالحة أو منتهية الصلاحية', statusCode: 403 });
    }

    if (order.status !== 'PENDING') {
      return res.status(403).json({
        success: false,
        error: 'بدأ المطبخ بتحضير طلبك بالفعل، لذلك لم يعد بالإمكان تعديله أو إلغاؤه.',
        statusCode: 403,
      });
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });

    // Check if table has other active orders
    const remainingActive = await prisma.order.count({
      where: {
        tableId: order.tableId,
        restaurantId: order.restaurantId,
        status: { in: ['PENDING', 'PREPARING', 'READY'] },
      },
    });

    if (remainingActive === 0) {
      await prisma.table.update({
        where: { id: order.tableId },
        data: { status: 'AVAILABLE' },
      });
    }

    realtimeService.broadcastToRestaurant(order.restaurantId, 'ORDER_CANCELLED', {
      orderId,
      tableId: order.tableId,
    });

    return res.json({
      success: true,
      data: { order: updated, message: 'تم إلغاء الطلب بنجاح' },
      statusCode: 200,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر إلغاء الطلب', statusCode: 500 });
  }
});

// PUT /api/public/orders/:orderId/notes (Customer Edits Notes while PENDING)
router.put('/orders/:orderId/notes', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { notes, restaurantId } = req.body;
    const { sessionToken } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || (restaurantId && order.restaurantId !== restaurantId)) {
      return res.status(404).json({ success: false, error: 'الطلب غير موجود', statusCode: 404 });
    }

    if (!restaurantId || !await getQrSession(sessionToken, order.restaurantId, order.tableId)) {
      return res.status(403).json({ success: false, error: 'جلسة QR غير صالحة أو منتهية الصلاحية', statusCode: 403 });
    }

    if (order.status !== 'PENDING') {
      return res.status(403).json({
        success: false,
        error: 'بدأ المطبخ بتحضير طلبك، لذلك لم يعد بالإمكان تعديل الملاحظات.',
        statusCode: 403,
      });
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { notes: notes || null },
    });

    realtimeService.broadcastToRestaurant(order.restaurantId, 'ORDER_NOTES_UPDATED', {
      orderId,
      notes,
    });

    return res.json({ success: true, data: { order: updated }, statusCode: 200 });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر تعديل الملاحظات', statusCode: 500 });
  }
});

// POST /api/public/waiter-requests (Customer Calls Waiter with Debounce Protection)
router.post('/waiter-requests', async (req: Request, res: Response) => {
  try {
    const { restaurantId, tableId, reason, note, sessionToken } = req.body;

    if (!restaurantId || !tableId) {
      return res.status(400).json({ success: false, error: 'بيانات النداء غير مكتملة', statusCode: 400 });
    }

    const table = await prisma.table.findUnique({ where: { id: tableId } });
    if (!table || table.restaurantId !== restaurantId) {
      return res.status(404).json({ success: false, error: 'الطاولة غير موجودة في هذا المطعم', statusCode: 404 });
    }
    const session = await getQrSession(sessionToken, restaurantId, tableId);
    if (!session) {
      return res.status(403).json({ success: false, error: 'جلسة QR غير صالحة أو منتهية الصلاحية', statusCode: 403 });
    }

    // Debounce: Check for pending request for the same table within 45 seconds
    const recentPending = await prisma.waiterRequest.findFirst({
      where: {
        restaurantId,
        tableId,
        status: { in: ['PENDING', 'ACKNOWLEDGED'] },
        createdAt: { gte: new Date(Date.now() - 45 * 1000) },
      },
    });

    if (recentPending) {
      return res.status(429).json({
        success: false,
        error: 'تم إرسال نداء مؤخراً لطاقم الضيافة. يرجى الانتظار قليلاً وسيكونون بخدمتك.',
        statusCode: 429,
      });
    }

    const sessionId = session.id;

    const waiterReq = await prisma.waiterRequest.create({
      data: {
        restaurantId,
        tableId,
        sessionId,
        reason: reason || 'ASSISTANCE',
        reasonText: note || undefined,
        status: 'PENDING',
      },
    });

    // Update table flag
    await prisma.table.update({
      where: { id: tableId },
      data: {
        hasWaiterCall: true,
        status: reason === 'BILL' ? 'BILL_REQUESTED' : undefined,
      },
    });

    realtimeService.broadcastToRestaurant(restaurantId, 'WAITER_CALL', {
      requestId: waiterReq.id,
      tableId,
      reason: waiterReq.reason,
      reasonText: waiterReq.reasonText,
    });

    return res.status(201).json({
      success: true,
      data: { waiterRequest: waiterReq },
      statusCode: 201,
    });
  } catch (err) {
    console.error('Waiter call error:', err);
    return res.status(500).json({ success: false, error: 'تعذر استدعاء طاقم الضيافة', statusCode: 500 });
  }
});

export default router;
