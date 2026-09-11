import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma';
import { realtimeService } from '../services/realtime';
import { logAuditEvent } from '../services/audit';
import {
  config,
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_ALGORITHM,
} from '../config';
import { generateSessionToken, roundMoney } from '../utils/security';
import {
  publicOrderLimiter,
  waiterCallLimiter,
  qrSessionLimiter,
  customerOrdersLimiter,
  sseConnectionLimiter,
} from '../middleware/rateLimit';
import {
  validateBody,
  publicOrderSchema,
  orderCancelSchema,
  orderNotesSchema,
  waiterCallSchema,
  qrSessionSchema,
} from '../validation/schemas';

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
router.get('/events', sseConnectionLimiter, async (req: Request, res: Response) => {
  const restaurantId = req.query.restaurantId as string;
  const tableId = req.query.tableId as string | undefined;
  const sessionToken = req.query.sessionToken as string | undefined;
  const authToken = (req.query.token as string) || (req.headers.authorization?.split(' ')[1]);

  if (!restaurantId) {
    return res.status(400).send('restaurantId is required');
  }

  let isAllowed = false;
  // Per-session cap bucket: guests are keyed by their QR session token, staff
  // by their user id. Populated only once the corresponding credential has
  // been freshly verified below.
  let connectionSubject: string | undefined;

  if (authToken) {
    // Staff stream: the token is verified against the real secret with
    // algorithm/issuer/audience pinning AND a fresh account/restaurant check —
    // suspended users, suspended restaurants and logged-out (stale tv) staff
    // cannot hold a stream open.
    try {
      const decoded = jwt.verify(authToken, config.jwtSecret, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }) as {
        id: string;
        restaurantId: string | null;
        role: string;
        tv: number;
      };
      if (decoded && decoded.id) {
        const dbUser = await prisma.restaurantUser.findUnique({
          where: { id: decoded.id },
          select: {
            id: true,
            restaurantId: true,
            role: true,
            status: true,
            tokenVersion: true,
            restaurant: { select: { status: true } },
          },
        });
        const isPlatform =
          !!dbUser &&
          (dbUser.role === 'SUPER_ADMIN' || dbUser.role === 'PLATFORM_ADMIN');
        const fresh =
          !!dbUser &&
          dbUser.status === 'ACTIVE' &&
          (decoded.tv ?? 0) === dbUser.tokenVersion;
        // Tenant staff additionally require an ACTIVE restaurant; platform
        // staff are exempt so they can monitor suspended tenants.
        const restaurantOk =
          isPlatform ||
          (!!dbUser &&
            dbUser.restaurantId === restaurantId &&
            dbUser.restaurant?.status === 'ACTIVE');
        if (fresh && restaurantOk && dbUser) {
          isAllowed = true;
          connectionSubject = `staff:${dbUser.id}`;
        }
      }
    } catch {
      /* invalid token → fall through to session check */
    }
  }

  if (!isAllowed && tableId && sessionToken) {
    const session = await getQrSession(sessionToken, restaurantId, tableId);
    if (session) {
      isAllowed = true;
      connectionSubject = `qr:${session.sessionToken}`;
    }
  }

  if (!isAllowed) {
    return res.status(403).json({ success: false, error: 'جلسة QR أو تسجيل دخول مطلوب للبث المباشر', statusCode: 403 });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = `sse-${randomUUID()}`;
  const result = realtimeService.addClient({
    id: clientId,
    restaurantId,
    tableId,
    subject: connectionSubject,
    res,
  });
  if (!result.accepted) {
    const messageByReason = {
      global: 'خدمة البث المباشر مزدحمة حالياً، حاول لاحقاً',
      tenant: 'عدد اتصالات البث لهذا المطعم مرتفع حالياً، حاول لاحقاً',
      subject: 'لديك عدد كبير جداً من الاتصالات المباشرة لنفس الجلسة — أغلق التبويبات الزائدة وأعد المحاولة',
    } as const;
    return res
      .status(503)
      .json({ success: false, error: messageByReason[result.reason], statusCode: 503 });
  }

  // Heartbeat: keeps the stream alive through idle proxy timeouts and lets the
  // server notice half-open connections (write error → client removed). It is
  // cleared the moment the response closes, so disconnects never leak timers.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      realtimeService.removeClient(clientId);
    }
  }, 25_000);
  res.on('close', () => clearInterval(heartbeat));

  // Send initial ping
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', clientId })}\n\n`);
});

// GET /api/public/restaurants — public active restaurants directory for venue selection & staff login.
router.get('/restaurants', async (_req: Request, res: Response) => {
  try {
    const restaurants = await prisma.restaurant.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        nameEn: true,
        slug: true,
        logoUrl: true,
        coverImageUrl: true,
        primaryColor: true,
        accentColor: true,
        businessType: true,
      },
      orderBy: { name: 'asc' },
    });

    return res.json({
      success: true,
      data: {
        restaurants: restaurants.map((r) => ({
          id: r.id,
          name: r.name,
          nameEn: r.nameEn || r.name,
          slug: r.slug,
          logo: r.logoUrl,
          coverImage: r.coverImageUrl,
          primaryColor: r.primaryColor,
          accentColor: r.accentColor,
          businessType: r.businessType,
        })),
      },
      statusCode: 200,
    });
  } catch (err) {
    console.error('Fetch public restaurants error:', err);
    return res.status(500).json({
      success: false,
      error: 'حدث خطأ في استرجاع قائمة المطاعم',
      statusCode: 500,
    });
  }
});

// GET /api/public/restaurants/:slug — public menu catalog, exact slug only.
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
        tables: {
          orderBy: { number: 'asc' },
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

    if (restaurant.status !== 'ACTIVE') {
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
          businessType: restaurant.businessType,
          primaryColor: restaurant.primaryColor,
          accentColor: restaurant.accentColor,
          // Venue location + media drive the customer map, promo video and
          // interior gallery. Previously omitted here, so the guest-facing
          // screen fell back to platform defaults (wrong map pin, no video).
          latitude: restaurant.latitude,
          longitude: restaurant.longitude,
          mapUrl: restaurant.mapUrl,
          mapImageUrl: restaurant.mapImageUrl,
          logoFit: restaurant.logoFit,
          logoPosition: restaurant.logoPosition,
          promoVideoUrl: restaurant.promoVideoUrl,
          galleryImages: restaurant.galleryImages,
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
        // NOTE: qrToken is deliberately NOT returned here. A QR token is an
        // opaque capability; publishing every table's token on a public
        // endpoint would let any guest enumerate and "scan" any table without
        // the physical card. Guests only ever learn a token by scanning it.
        tables: (restaurant.tables || []).map((t) => ({
          id: t.id,
          restaurantId: t.restaurantId,
          number: t.number,
          tableNumber: t.number,
          name: t.name,
          capacity: t.capacity,
          zone: t.zone,
          status: t.status,
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
router.get('/tables/qr/:qrToken', qrSessionLimiter, async (req: Request, res: Response) => {
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

    if (table.restaurant.status !== 'ACTIVE') {
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
          // The guest splash frames the venue by kind. It renders before the
          // full catalog fetch resolves, so the kind must ride along here too —
          // otherwise a café or bakery shows restaurant copy in that window.
          businessType: table.restaurant.businessType,
        },
      },
      statusCode: 200,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر التحقق من رمز QR', statusCode: 500 });
  }
});

// POST /api/public/tables/qr/:qrToken/session — anonymous table session.
// The QR token is an opaque capability: it must match EXACTLY. Table IDs,
// table numbers and the word "default" are never accepted, and no tenant
// or table is ever silently substituted or created here.
router.post(
  '/tables/qr/:qrToken/session',
  qrSessionLimiter,
  validateBody(qrSessionSchema),
  async (req: Request, res: Response) => {
    try {
      const { qrToken } = req.params;
      const { slug, restaurantId } = req.body as {
        slug?: string;
        restaurantId?: string;
      };

      const table = await prisma.table.findUnique({
        where: { qrToken },
        include: { restaurant: true },
      });

      if (!table || !table.restaurant) {
        return res.status(404).json({
          success: false,
          error: 'رمز QR غير صالح أو منتهي الصلاحية. امسح الرمز الموجود على طاولتك.',
          statusCode: 404,
        });
      }

      const restaurant = table.restaurant;

      // Optional caller hints must agree with the resolved table.
      if (restaurantId && restaurantId !== restaurant.id) {
        return res.status(400).json({ success: false, error: 'رمز QR لا ينتمي لهذا المطعم', statusCode: 400 });
      }
      if (slug && slug.toLowerCase() !== (restaurant.slug || '').toLowerCase()) {
        return res.status(400).json({ success: false, error: 'رمز QR لا ينتمي لهذا المطعم', statusCode: 400 });
      }

      if (restaurant.status !== 'ACTIVE') {
        return res.status(403).json({ success: false, error: 'المطعم غير متاح للطلب حالياً', statusCode: 403 });
      }

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
            sessionToken: generateSessionToken(),
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
            // Same reason as the QR-verify payload: this object becomes
            // `currentRestaurant` before the catalog fetch overwrites it.
            businessType: restaurant.businessType,
          },
        },
        statusCode: 200,
      });
    } catch (err) {
      console.error('Create table session error:', err);
      return res.status(500).json({ success: false, error: 'تعذر إنشاء جلسة الطاولة', statusCode: 500 });
    }
  }
);

type MenuProduct = {
  id: string;
  name: string;
  nameEn: string | null;
  price: number;
  available: boolean;
  ingredients: string[];
  removableIngredients: string[];
  options: Array<{ id: string; name: string; priceModifier: number | null; price: number | null }>;
  addOns: Array<{ id: string; name: string; price: number; isAvailable: boolean }>;
};

function legacyAddOnName(entry: unknown): string | null {
  // Older clients send formatted display strings like "جبنة (+₪5)" —
  // strip the price suffix to recover the add-on name for DB matching.
  if (typeof entry === 'string') {
    return entry.replace(/\s*\(\+.*$/, '').trim() || null;
  }
  if (entry && typeof entry === 'object') {
    const obj = entry as { id?: unknown; name?: unknown };
    if (typeof obj.id === 'string' && obj.id) return `id:${obj.id}`;
    if (typeof obj.name === 'string' && obj.name) return obj.name;
  }
  return null;
}

// GET /api/public/tables/:tableId/orders — the active orders of the caller's
// own QR session. This is how a guest sees live order status: previously the
// public catalog never returned orders, so the guest's tracker stayed empty
// even while the kitchen was updating statuses over SSE.
router.get(
  '/tables/:tableId/orders',
  customerOrdersLimiter,
  async (req: Request, res: Response) => {
    try {
      const { tableId } = req.params;
      const restaurantId = req.query.restaurantId as string;
      const sessionToken = req.query.sessionToken as string;

      if (!restaurantId || !tableId) {
        return res.status(400).json({ success: false, error: 'restaurantId و tableId مطلوبان', statusCode: 400 });
      }

      const session = await getQrSession(sessionToken, restaurantId, tableId);
      if (!session) {
        return res.status(403).json({ success: false, error: 'جلسة QR غير صالحة أو منتهية الصلاحية', statusCode: 403 });
      }

      const orders = await prisma.order.findMany({
        where: {
          restaurantId,
          tableId,
          sessionId: session.id,
          status: { not: 'CANCELLED' },
        },
        include: { items: true },
        orderBy: { createdAt: 'asc' },
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
        paymentStatus: o.paymentStatus,
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
      }));

      return res.json({ success: true, data: formatted, statusCode: 200 });
    } catch (err) {
      console.error('Fetch customer orders error:', err);
      return res.status(500).json({ success: false, error: 'تعذر استرجاع حالة الطلبات', statusCode: 500 });
    }
  }
);

// POST /api/public/orders (Submit Order from Table)
// Every unit price, size modifier and add-on price comes from the DB
// menu. Client-supplied prices/names are display hints at best and
// are NEVER trusted for totals or snapshots.
router.post(
  '/orders',
  publicOrderLimiter,
  validateBody(publicOrderSchema),
  async (req: Request, res: Response) => {
    try {
      const { restaurantId, tableId, sessionToken, clientRequestId, items, notes } = req.body as {
        restaurantId: string;
        tableId: string;
        sessionToken: string;
        clientRequestId?: string;
        items: Array<{
          productId: string;
          quantity?: number;
          selectedSizeId?: string;
          selectedSize?: unknown;
          selectedAddOnIds?: string[];
          selectedAddOns?: unknown;
          removedIngredients?: string[];
          specialInstructions?: string;
          notes?: string;
        }>;
        notes?: string;
      };

      const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
      if (!restaurant || restaurant.status !== 'ACTIVE') {
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
      // Backward-compatible for already-open tabs from the prior frontend;
      // current clients always send their stable UUID.
      const effectiveClientRequestId = clientRequestId || randomUUID();

      // A retry after a lost response returns the authoritative original order
      // instead of opening a second kitchen ticket.
      const replayedOrder = await prisma.order.findUnique({
        where: { restaurantId_clientRequestId: { restaurantId, clientRequestId: effectiveClientRequestId } },
        include: { items: true },
      });
      if (replayedOrder) {
        if (
          replayedOrder.restaurantId !== restaurantId ||
          replayedOrder.tableId !== tableId ||
          replayedOrder.sessionId !== sessionId
        ) {
          return res.status(409).json({ success: false, error: 'تعارض معرّف إرسال الطلب', statusCode: 409 });
        }
        return res.status(200).json({
          success: true,
          data: { order: replayedOrder, replayed: true },
          statusCode: 200,
        });
      }

      const productIds = [...new Set(items.map((item) => item.productId))];
      const products = (await prisma.product.findMany({
        where: { restaurantId, id: { in: productIds } },
        include: { options: true, addOns: true },
      })) as MenuProduct[];

      if (products.length !== productIds.length) {
        return res.status(400).json({
          success: false,
          error: 'يحتوي الطلب على طبق غير متوفر في هذا المطعم',
          statusCode: 400,
        });
      }
      const productMap = new Map(products.map((product) => [product.id, product]));

      const pricedItems: Array<{
        productId: string;
        productNameSnapshot: string;
        productNameEnSnapshot?: string;
        priceSnapshot: number;
        quantity: number;
        selectedSize?: string;
        selectedAddOns: string[];
        removedIngredients: string[];
        specialInstructions?: string;
        totalPrice: number;
      }> = [];

      for (const item of items) {
        const product = productMap.get(item.productId)!;
        if (!product.available) {
          return res.status(400).json({
            success: false,
            error: `الطبق "${product.name}" غير متوفر حالياً`,
            statusCode: 400,
          });
        }
        const quantity =
          Number.isInteger(item.quantity) && (item.quantity as number) > 0
            ? Math.min(item.quantity as number, 50)
            : 1;

        // --- Size: explicit ID wins, exact legacy name match tolerated.
        let unitPrice = roundMoney(product.price);
        let sizeSnapshot: string | undefined;
        if (item.selectedSizeId) {
          const option = product.options.find((o) => o.id === item.selectedSizeId);
          if (!option) {
            return res.status(400).json({
              success: false,
              error: `الحجم المحدد للطبق "${product.name}" غير صالح`,
              statusCode: 400,
            });
          }
          unitPrice = roundMoney(unitPrice + (option.priceModifier ?? option.price ?? 0));
          sizeSnapshot = option.name;
        } else if (item.selectedSize) {
          const wanted =
            typeof item.selectedSize === 'string'
              ? item.selectedSize
              : (item.selectedSize as { id?: unknown; name?: unknown }).name;
          if (typeof wanted === 'string' && wanted) {
            const option = product.options.find((o) => o.name === wanted);
            if (option) {
              unitPrice = roundMoney(unitPrice + (option.priceModifier ?? option.price ?? 0));
              sizeSnapshot = option.name;
            }
          }
        }

        // --- Add-ons: explicit IDs validated strictly, legacy display
        // entries matched by exact DB name, unknown entries ignored.
        const addOnSnapshots: string[] = [];
        if (item.selectedAddOnIds && item.selectedAddOnIds.length > 0) {
          for (const addOnId of item.selectedAddOnIds) {
            const addOn = product.addOns.find((a) => a.id === addOnId);
            if (!addOn || !addOn.isAvailable) {
              return res.status(400).json({
                success: false,
                error: `إضافة غير صالحة للطبق "${product.name}"`,
                statusCode: 400,
              });
            }
            unitPrice = roundMoney(unitPrice + addOn.price);
            addOnSnapshots.push(addOn.name);
          }
        } else if (Array.isArray(item.selectedAddOns)) {
          for (const entry of item.selectedAddOns as unknown[]) {
            const parsed = legacyAddOnName(entry);
            if (!parsed) continue;
            const addOn = parsed.startsWith('id:')
              ? product.addOns.find((a) => a.id === parsed.slice(3))
              : product.addOns.find((a) => a.name === parsed);
            if (addOn && addOn.isAvailable) {
              unitPrice = roundMoney(unitPrice + addOn.price);
              addOnSnapshots.push(addOn.name);
            }
          }
        }

        // Removed ingredients are advisory; keep only known ones.
        const knownIngredients = new Set([
          ...(product.ingredients || []),
          ...(product.removableIngredients || []),
        ]);
        const removed = (item.removedIngredients || []).filter((name) =>
          knownIngredients.has(name)
        );

        pricedItems.push({
          productId: product.id,
          productNameSnapshot: product.name,
          productNameEnSnapshot: product.nameEn || undefined,
          priceSnapshot: roundMoney(unitPrice),
          quantity,
          selectedSize: sizeSnapshot,
          selectedAddOns: addOnSnapshots,
          removedIngredients: removed,
          specialInstructions: item.specialInstructions || item.notes || undefined,
          totalPrice: roundMoney(unitPrice * quantity),
        });
      }

      const subtotal = roundMoney(pricedItems.reduce((sum, item) => sum + item.totalPrice, 0));
      if (subtotal <= 0) {
        return res.status(400).json({ success: false, error: 'قيمة الطلب صفرية', statusCode: 400 });
      }

      // Order-number allocation retries on unique collisions.
      const existingOrders = await prisma.order.findMany({
        where: { restaurantId },
        select: { id: true, numericId: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const orderCount = await prisma.order.count({ where: { restaurantId } });

      // Allocation only trusts the app's own "#<n>" id shape: legacy/imported
      // rows (e.g. "order-A-<timestamp>") and out-of-range numericIds must
      // never push the sequence past the Int4 ceiling of Order.numericId —
      // that overflow used to 500 every order creation for the tenant.
      const MAX_ALLOCATABLE_NUM = 2_000_000_000;
      let maxNum = 1000;
      for (const ord of existingOrders) {
        if (ord.numericId && ord.numericId > maxNum) {
          maxNum = Math.min(ord.numericId, MAX_ALLOCATABLE_NUM);
        }
        const match = ord.id.match(/^#(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = Math.min(num, MAX_ALLOCATABLE_NUM);
          }
        }
      }

      const startNum = Math.max(
        1001,
        maxNum + 1,
        Math.min(orderCount + 1001, MAX_ALLOCATABLE_NUM)
      );

      let newOrder: Awaited<ReturnType<typeof prisma.order.create>> | null = null;
      let wasIdempotentReplay = false;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 25 && !newOrder; attempt += 1) {
        const nextNum = startNum + attempt;
        const orderId = `#${nextNum}`;
        try {
          newOrder = await prisma.$transaction(async (tx) => {
            const created = await tx.order.create({
            data: {
              id: orderId,
              numericId: nextNum,
              restaurantId,
              tableId,
              sessionId,
              clientRequestId: effectiveClientRequestId,
              status: 'PENDING',
              paymentMethod: 'PAY AT CASHIER',
              subtotal,
              total: subtotal,
              notes: notes || undefined,
              items: { create: pricedItems },
            },
            include: { items: true },
            });
            await tx.table.update({
              where: { id: tableId },
              data: { status: 'OCCUPIED', lastActivityAt: new Date() },
            });
            return created;
          });
        } catch (createErr: unknown) {
          lastError = createErr;
          if ((createErr as { code?: string })?.code !== 'P2002') throw createErr;
          const replay = await prisma.order.findUnique({
            where: { restaurantId_clientRequestId: { restaurantId, clientRequestId: effectiveClientRequestId } },
            include: { items: true },
          });
          if (replay) {
            newOrder = replay;
            wasIdempotentReplay = true;
          }
        }
      }

      if (!newOrder) {
        try {
          const fallbackNum = startNum + Math.floor(Math.random() * 90000) + 100;
          const fallbackOrderId = `#${fallbackNum}`;
          newOrder = await prisma.$transaction(async (tx) => {
            const created = await tx.order.create({
            data: {
              id: fallbackOrderId,
              numericId: fallbackNum,
              restaurantId,
              tableId,
              sessionId,
              clientRequestId: effectiveClientRequestId,
              status: 'PENDING',
              paymentMethod: 'PAY AT CASHIER',
              subtotal,
              total: subtotal,
              notes: notes || undefined,
              items: { create: pricedItems },
            },
            include: { items: true },
            });
            await tx.table.update({
              where: { id: tableId },
              data: { status: 'OCCUPIED', lastActivityAt: new Date() },
            });
            return created;
          });
        } catch (fallbackErr) {
          lastError = fallbackErr;
        }
      }

      if (!newOrder) {
        console.error('Public order id allocation failed:', lastError);
        return res.status(500).json({ success: false, error: 'تعذر إرسال الطلب للمطبخ، حاول مجدداً', statusCode: 500 });
      }

      if (wasIdempotentReplay) {
        return res.status(200).json({
          success: true,
          data: { order: newOrder, replayed: true },
          statusCode: 200,
        });
      }

      logAuditEvent({
        restaurantId,
        actor: 'QR Guest',
        actorRole: 'STAFF',
        action: 'CUSTOMER_ORDER_CREATED',
        entity: 'Order',
        entityId: newOrder.id,
        details: `طلب زبون ${newOrder.id} بقيمة ${subtotal} (طاولة ${tableId})`,
      }).catch(() => undefined);

      // Broadcast new order (table-scoped: only this table + staff see it)
      realtimeService.broadcastToTable(restaurantId, tableId, 'ORDER_CREATED', {
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
    } catch (err: unknown) {
      console.error('Order creation error:', err);
      return res.status(500).json({ success: false, error: 'تعذر إرسال الطلب للمطبخ', statusCode: 500 });
    }
  }
);

// POST /api/public/orders/:orderId/cancel (Customer Cancels Order)
// The order must belong to the caller's own table session —
// sessionToken travels in the POST body, never the URL.
router.post(
  '/orders/:orderId/cancel',
  publicOrderLimiter,
  validateBody(orderCancelSchema),
  async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      const { restaurantId, sessionToken } = req.body as {
        restaurantId?: string;
        sessionToken?: string;
      };

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order || (restaurantId && order.restaurantId !== restaurantId)) {
        return res.status(404).json({ success: false, error: 'الطلب غير موجود', statusCode: 404 });
      }

      if (!sessionToken) {
        return res.status(400).json({ success: false, error: 'جلسة الطاولة مطلوبة لإلغاء الطلب', statusCode: 400 });
      }
      const session = await getQrSession(sessionToken, order.restaurantId, order.tableId);
      // Strict binding: session must own this exact order.
      if (!session || !order.sessionId || order.sessionId !== session.id) {
        return res.status(403).json({ success: false, error: 'جلسة QR غير صالحة أو منتهية الصلاحية', statusCode: 403 });
      }

      if (order.status !== 'PENDING') {
        return res.status(403).json({
          success: false,
          error: 'بدأ المطبخ بتحضير طلبك بالفعل، لذلك لم يعد بالإمكان تعديله أو إلغاؤه.',
          statusCode: 403,
        });
      }

      const cancelled = await prisma.order.updateMany({
        where: { id: orderId, restaurantId: order.restaurantId, sessionId: session.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      if (cancelled.count !== 1) {
        return res.status(409).json({
          success: false,
          error: 'تغيرت حالة الطلب قبل تنفيذ الإلغاء. حدّث حالة الطلب وحاول مجدداً.',
          statusCode: 409,
        });
      }
      const updated = await prisma.order.findUnique({ where: { id: orderId } });

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

      realtimeService.broadcastToTable(order.restaurantId, order.tableId, 'ORDER_CANCELLED', {
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
  }
);

// PUT /api/public/orders/:orderId/notes (Customer Edits Notes while PENDING)
router.put(
  '/orders/:orderId/notes',
  publicOrderLimiter,
  validateBody(orderNotesSchema),
  async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      const { notes, restaurantId, sessionToken } = req.body as {
        notes?: string;
        restaurantId: string;
        sessionToken: string;
      };

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.restaurantId !== restaurantId) {
        return res.status(404).json({ success: false, error: 'الطلب غير موجود', statusCode: 404 });
      }

      const session = await getQrSession(sessionToken, order.restaurantId, order.tableId);
      if (!session || !order.sessionId || order.sessionId !== session.id) {
        return res.status(403).json({ success: false, error: 'جلسة QR غير صالحة أو منتهية الصلاحية', statusCode: 403 });
      }

      if (order.status !== 'PENDING') {
        return res.status(403).json({
          success: false,
          error: 'بدأ المطبخ بتحضير طلبك، لذلك لم يعد بالإمكان تعديل الملاحظات.',
          statusCode: 403,
        });
      }

      const changed = await prisma.order.updateMany({
        where: { id: orderId, restaurantId, sessionId: session.id, status: 'PENDING' },
        data: { notes: notes || null },
      });
      if (changed.count !== 1) {
        return res.status(409).json({
          success: false,
          error: 'بدأت معالجة الطلب قبل حفظ الملاحظات. حدّث حالة الطلب.',
          statusCode: 409,
        });
      }
      const updated = await prisma.order.findUnique({ where: { id: orderId } });

      realtimeService.broadcastToTable(order.restaurantId, order.tableId, 'ORDER_NOTES_UPDATED', {
        orderId,
        notes,
      });

      return res.json({ success: true, data: { order: updated }, statusCode: 200 });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'تعذر تعديل الملاحظات', statusCode: 500 });
    }
  }
);

// POST /api/public/waiter-requests (Customer Calls Waiter with Debounce Protection)
router.post(
  '/waiter-requests',
  waiterCallLimiter,
  validateBody(waiterCallSchema),
  async (req: Request, res: Response) => {
    try {
      const { restaurantId, tableId, reason, note, sessionToken } = req.body as {
        restaurantId: string;
        tableId: string;
        reason: string;
        note?: string;
        sessionToken: string;
      };

      const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
      if (!restaurant || restaurant.status !== 'ACTIVE') {
        return res.status(403).json({ success: false, error: 'المطعم غير متاح حالياً', statusCode: 403 });
      }

      const table = await prisma.table.findUnique({ where: { id: tableId } });
      if (!table || table.restaurantId !== restaurantId) {
        return res.status(404).json({ success: false, error: 'الطاولة غير موجودة في هذا المطعم', statusCode: 404 });
      }
      const session = await getQrSession(sessionToken, restaurantId, tableId);
      if (!session) {
        return res.status(403).json({ success: false, error: 'جلسة QR غير صالحة أو منتهية الصلاحية', statusCode: 403 });
      }

      // One active request per table, plus the existing 45-second cooldown.
      // SERIALIZABLE + retry closes the check-then-create race between two
      // devices/tabs while keeping request creation and the table flag atomic.
      let waiterReq: Awaited<ReturnType<typeof prisma.waiterRequest.create>> | null = null;
      for (let attempt = 0; attempt < 3 && !waiterReq; attempt += 1) {
        try {
          waiterReq = await prisma.$transaction(async (tx) => {
            const duplicate = await tx.waiterRequest.findFirst({
              where: {
                restaurantId,
                tableId,
                OR: [
                  { status: { in: ['PENDING', 'ACKNOWLEDGED'] } },
                  { createdAt: { gte: new Date(Date.now() - 45 * 1000) } },
                ],
              },
            });
            if (duplicate) return null;

            const created = await tx.waiterRequest.create({
              data: {
                restaurantId,
                tableId,
                sessionId: session.id,
                reason,
                reasonText: note || undefined,
                status: 'PENDING',
              },
            });
            await tx.table.update({
              where: { id: tableId },
              data: {
                hasWaiterCall: true,
                status: reason === 'BILL' ? 'BILL_REQUESTED' : undefined,
              },
            });
            return created;
          }, { isolationLevel: 'Serializable' });
        } catch (transactionError) {
          if ((transactionError as { code?: string })?.code === 'P2034' && attempt < 2) continue;
          throw transactionError;
        }
      }

      if (!waiterReq) {
        return res.status(429).json({
          success: false,
          error: 'يوجد نداء نشط أو تم إرسال نداء مؤخراً. يرجى الانتظار وسيكون الطاقم بخدمتك.',
          statusCode: 429,
        });
      }

      realtimeService.broadcastToTable(restaurantId, tableId, 'WAITER_CALL', {
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
  }
);

export default router;
