import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
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
import {
  getStorage,
  assetNormalizerFor,
  assetUrlResolverFor,
  resolveRestaurantAssets,
  resolveAssetReference,
} from '../services/storage';
import {
  discardPaymentProof,
  customerPaymentProofView,
  storePaymentProof,
  MAX_PAYMENT_PROOF_BYTES,
  PAYMENT_STATUS,
  normalizeTransferChannel,
} from '../services/paymentProofs';
import {
  FULFILLMENT_STATE,
  isHeldForPayment,
  normalizeFulfillmentState,
} from '../services/orderLifecycle';
import { generateSessionToken, roundMoney } from '../utils/security';
import { normalizeCustomerPhone } from '../utils/phone';
import {
  GUEST_SESSION_PURPOSE,
  guestSessionCapabilityWhere,
  type GuestSessionPurpose,
} from '../services/guestSessionAuthorization';
import {
  publicOrderLimiter,
  waiterCallLimiter,
  qrSessionLimiter,
  customerOrdersLimiter,
  paymentProofLimiter,
  sseConnectionLimiter,
} from '../middleware/rateLimit';
import {
  validateBody,
  publicOrderSchema,
  orderCancelSchema,
  orderNotesSchema,
  waiterCallSchema,
  qrSessionSchema,
  paymentProofSchema,
} from '../validation/schemas';

const router = Router();

// Transfer-receipt upload: memory storage so the bytes are inspected before
// anything is persisted, with the SAME 5 MB cap and image-only prefilter as the
// tenant upload route. Magic-byte validation happens in the handler.
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PAYMENT_PROOF_BYTES,
    files: 1,
    fields: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('إشعار الحوالة يجب أن يكون صورة بصيغة JPG أو PNG أو WEBP'));
    }
  },
});

// One shared instance of the asset-reference contract for every public
// response: stable stored reference -> renderable URL (and back).
// Lazy: the storage singleton is constructed on first use, never at import
// time (keeps the module side-effect-free for tests and boot ordering).
let assetContract: {
  normalizer: ReturnType<typeof assetNormalizerFor>;
  toUrl: (key: string) => string;
} | null = null;
function assetContractFor() {
  if (!assetContract) {
    const storage = getStorage();
    assetContract = {
      normalizer: assetNormalizerFor(storage),
      toUrl: assetUrlResolverFor(storage, config.appUrl),
    };
  }
  return assetContract;
}
const resolveRow = (row: {
  logoUrl: string;
  coverImageUrl: string | null;
  mapImageUrl: string | null;
  galleryImages: string[];
}) => {
  const { normalizer, toUrl } = assetContractFor();
  return resolveRestaurantAssets(row, normalizer, toUrl);
};
const resolveAssetUrl = (value: string | null | undefined): string | null => {
  const { normalizer, toUrl } = assetContractFor();
  return resolveAssetReference(value, normalizer, toUrl).url;
};

async function getQrSession(
  sessionToken: unknown,
  restaurantId: string,
  tableId: string,
  purpose: GuestSessionPurpose = GUEST_SESSION_PURPOSE.INTERACTION
) {
  const where = guestSessionCapabilityWhere({
    sessionToken,
    restaurantId,
    tableId,
    purpose,
  });
  if (!where) return null;
  return prisma.tableSession.findFirst({ where });
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
        // The full image-field set so the single asset contract can resolve
        // every reference (mapImageUrl/galleryImages included).
        logoUrl: true,
        coverImageUrl: true,
        mapImageUrl: true,
        galleryImages: true,
        primaryColor: true,
        accentColor: true,
        businessType: true,
      },
      orderBy: { name: 'asc' },
    });

    return res.json({
      success: true,
      data: {
        restaurants: restaurants.map((r) => {
          const assets = resolveRow(r);
          return {
            id: r.id,
            name: r.name,
            nameEn: r.nameEn || r.name,
            slug: r.slug,
            logo: assets.logoUrl,
            coverImage: assets.coverImageUrl,
            logoStoragePath: assets.logoStoragePath,
            coverStoragePath: assets.coverStoragePath,
            primaryColor: r.primaryColor,
            accentColor: r.accentColor,
            businessType: r.businessType,
          };
        }),
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

    // Theme images are returned through the single asset contract:
    // renderable URL in the existing fields + the stable storage path in
    // the additive `*StoragePath` fields (the persistence pair).
    const catalogRestaurant = resolveRow(restaurant);
    return res.json({
      success: true,
      data: {
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          nameEn: restaurant.nameEn,
          slug: restaurant.slug,
          logo: catalogRestaurant.logoUrl,
          coverImage: catalogRestaurant.coverImageUrl,
          logoStoragePath: catalogRestaurant.logoStoragePath,
          coverStoragePath: catalogRestaurant.coverStoragePath,
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
          mapImageUrl: catalogRestaurant.mapImageUrl,
          mapStoragePath: catalogRestaurant.mapStoragePath,
          logoFit: restaurant.logoFit,
          logoPosition: restaurant.logoPosition,
          promoVideoUrl: restaurant.promoVideoUrl,
          galleryImages: catalogRestaurant.galleryImages,
          galleryStoragePaths: catalogRestaurant.galleryStoragePaths,
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
          logo: resolveAssetUrl(table.restaurant.logoUrl),
          // The guest splash frames the venue by kind. It renders before the
          // full catalog fetch resolves, so the kind must ride along here too —
          // otherwise a café or bakery shows restaurant copy in that window.
          businessType: table.restaurant.businessType,
          // Complete visual identity: this object may become
          // `currentRestaurant` before the catalog arrives, and a partial
          // payload here used to reset the venue's theme to the defaults.
          coverImage: resolveAssetUrl(table.restaurant.coverImageUrl),
          logoFit: table.restaurant.logoFit,
          logoPosition: table.restaurant.logoPosition,
          primaryColor: table.restaurant.primaryColor,
          accentColor: table.restaurant.accentColor,
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
      const { slug, restaurantId, resumeSessionToken } = req.body as {
        slug?: string;
        restaurantId?: string;
        resumeSessionToken?: string;
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

      // A reload may present the exact capability issued to this device. It
      // can resume a CLOSED session for read-only tracking, but is never
      // reactivated. Without that proof, a fresh scan can only receive the
      // current ACTIVE session (or create a new one), so a later guest cannot
      // see an earlier guest's orders at the same physical table.
      let session = resumeSessionToken
        ? await getQrSession(
            resumeSessionToken,
            restaurant.id,
            table.id,
            GUEST_SESSION_PURPOSE.ORDER_TRACKING
          )
        : null;

      if (resumeSessionToken && !session) {
        return res.status(403).json({
          success: false,
          error: 'جلسة QR غير صالحة أو منتهية الصلاحية',
          statusCode: 403,
        });
      }

      if (!session) {
        session = await prisma.tableSession.findFirst({
          where: {
            restaurantId: restaurant.id,
            tableId: table.id,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
          },
        });
      }

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
          sessionStatus: session.status,
          sessionCreatedAt: session.createdAt,
          sessionExpiresAt: session.expiresAt,
          tableId: table.id,
          tableNumber: table.number,
          restaurant: {
            id: restaurant.id,
            name: restaurant.name,
            slug: restaurant.slug,
            // Same reason as the QR-verify payload: this object becomes
            // `currentRestaurant` before the catalog fetch overwrites it.
            // The logo rides along resolved so the guest splash never
            // flashes an empty brand between session creation and catalog.
            logo: resolveAssetUrl(restaurant.logoUrl),
            businessType: restaurant.businessType,
            nameEn: restaurant.nameEn,
            coverImage: resolveAssetUrl(restaurant.coverImageUrl),
            logoFit: restaurant.logoFit,
            logoPosition: restaurant.logoPosition,
            primaryColor: restaurant.primaryColor,
            accentColor: restaurant.accentColor,
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

// GET /api/public/tables/:tableId/orders — orders owned by the caller's exact
// QR-session capability. This is intentionally a read-only authorization
// boundary: CLOSED sessions remain valid here until normal capability expiry,
// while all order/table mutations continue to require an ACTIVE session.
router.get(
  '/tables/:tableId/orders',
  customerOrdersLimiter,
  async (req: Request, res: Response) => {
    try {
      const tableId = String(req.params.tableId);
      const restaurantId = req.query.restaurantId as string;
      const sessionToken = req.query.sessionToken as string;

      if (!restaurantId || !tableId) {
        return res.status(400).json({ success: false, error: 'restaurantId و tableId مطلوبان', statusCode: 400 });
      }

      const session = await getQrSession(
        sessionToken,
        restaurantId,
        tableId,
        GUEST_SESSION_PURPOSE.ORDER_TRACKING
      );
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
        // Proof state for the guest's own tracker. The storage key and the
        // phone are deliberately NOT part of this payload: the guest device
        // needs a state, not a path into private storage.
        hasPaymentProof: Boolean(o.paymentProofPath),
        paymentRejected: Boolean(o.paymentRejectedAt),
        paymentRejectedReason: o.paymentRejectionReason || undefined,
        // Fulfillment gate: the guest's tracker renders the payment step from
        // this state (waiting for payment / waiting for the cashier / released
        // to the kitchen). Released orders carry when the gate opened.
        fulfillmentState: normalizeFulfillmentState(o.fulfillmentState),
        releasedAt: o.releasedAt?.toISOString(),
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
              // THE AUTHORIZATION BOUNDARY: a guest order is created OUTSIDE
              // the restaurant's operational workflow. It only becomes a
              // kitchen ticket when a cashier verifies the payment (see
              // services/orderLifecycle.ts). Nothing here trusts the client.
              fulfillmentState: FULFILLMENT_STATE.AWAITING_PAYMENT,
              releasedAt: null,
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
              // THE AUTHORIZATION BOUNDARY: a guest order is created OUTSIDE
              // the restaurant's operational workflow. It only becomes a
              // kitchen ticket when a cashier verifies the payment (see
              // services/orderLifecycle.ts). Nothing here trusts the client.
              fulfillmentState: FULFILLMENT_STATE.AWAITING_PAYMENT,
              releasedAt: null,
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
        metadata: {
          fulfillmentState: FULFILLMENT_STATE.AWAITING_PAYMENT,
          previousFulfillmentState: null,
        },
      }).catch(() => undefined);

      // NOT `ORDER_CREATED`: a guest submission is not a kitchen ticket. This
      // event tells the guest device and the cashier surfaces that an order is
      // waiting for its payment step; the KDS/floor screens deliberately do not
      // subscribe to it. The order reaches the kitchen only through
      // `ORDER_RELEASED_TO_KITCHEN` after a cashier verifies the payment.
      realtimeService.broadcastToTable(restaurantId, tableId, 'ORDER_AWAITING_PAYMENT', {
        orderId: newOrder.id,
        tableId,
        numericId: newOrder.numericId,
        total: newOrder.total,
        status: newOrder.status,
        fulfillmentState: FULFILLMENT_STATE.AWAITING_PAYMENT,
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

      // Money already committed (or under verification) freezes cancellation:
      // a guest must not be able to delete an order the cashier just verified
      // or is currently reviewing. Unpaid orders stay cancellable.
      if (
        order.paymentStatus === PAYMENT_STATUS.PAID ||
        order.paymentStatus === PAYMENT_STATUS.PENDING_VERIFICATION
      ) {
        return res.status(409).json({
          success: false,
          error:
            order.paymentStatus === PAYMENT_STATUS.PAID
              ? 'تم تأكيد دفع هذا الطلب — يرجى التواصل مع طاقم المطعم للإلغاء.'
              : 'إشعار الحوالة قيد التحقق من قبل الكاشير، لذلك لا يمكن إلغاء الطلب حالياً.',
          statusCode: 409,
        });
      }

      if (order.status !== 'PENDING') {
        return res.status(403).json({
          success: false,
          error: 'بدأ المطبخ بتحضير طلبك بالفعل، لذلك لم يعد بالإمكان تعديله أو إلغاؤه.',
          statusCode: 403,
        });
      }

      // Compare-and-set: the money state is part of the condition, so a cashier
      // confirming the transfer in the same instant wins the race (this update
      // matches zero rows → 409) instead of the order being cancelled after
      // payment.
      const cancelled = await prisma.order.updateMany({
        where: {
          id: orderId,
          restaurantId: order.restaurantId,
          sessionId: session.id,
          status: 'PENDING',
          paymentStatus: PAYMENT_STATUS.UNPAID,
        },
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

// POST /api/public/orders/:orderId/payment-proof
// The guest announces a bank/wallet transfer by uploading the receipt image
// together with the REQUIRED name + mobile number (and the BANK|WALLET hint).
// Authorization is the same QR-session capability used by cancel/notes: the
// order must belong to the caller's own table session.
//
// The submission is what puts a transfer order on hold in the kitchen: while
// paymentStatus is PENDING_VERIFICATION the KDS does not show the order, and
// the cashier's confirmation releases it as a fresh "ready to start" ticket.
//
// Security properties (see docs/PAYMENT-PROOF-ARCHITECTURE-ANALYSIS.md):
//  - restaurantId / tableId / sessionToken are treated as untrusted hints and
//    re-resolved against the DB; the tenant is taken from the order row.
//  - the image is validated by magic bytes (never the client MIME/filename),
//    size-capped, and stored in the PRIVATE namespace (no public URL exists).
//  - the amount is NEVER supplied by the client: the cashier sees the order's
//    own total. A proof only ever moves the order into PENDING_VERIFICATION.
router.post(
  '/orders/:orderId/payment-proof',
  paymentProofLimiter,
  proofUpload.single('proof'),
  validateBody(paymentProofSchema),
  async (req: Request, res: Response) => {
    let uploadedKey: string | null = null;
    try {
      // Express 5 types all route params as `string | string[]`; bind once.
      const orderId = String(req.params.orderId);
      const { restaurantId, tableId, sessionToken, customerName, customerPhone, transferChannel } =
        req.body as {
          restaurantId: string;
          tableId: string;
          sessionToken: string;
          customerName: string;
          customerPhone: string;
          transferChannel?: string;
        };

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: 'يرجى إرفاق صورة إشعار الحوالة',
          statusCode: 400,
        });
      }

      const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
      if (!restaurant || restaurant.status !== 'ACTIVE') {
        return res.status(403).json({
          success: false,
          error: 'المطعم غير متاح حالياً',
          statusCode: 403,
        });
      }

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      // One indistinguishable response for "unknown order" and "someone else's
      // order": never confirm the existence of another tenant's data.
      if (
        !order ||
        order.restaurantId !== restaurantId ||
        order.tableId !== tableId
      ) {
        return res.status(404).json({ success: false, error: 'الطلب غير موجود', statusCode: 404 });
      }

      const session = await getQrSession(sessionToken, order.restaurantId, order.tableId);
      if (!session || !order.sessionId || order.sessionId !== session.id) {
        return res.status(403).json({
          success: false,
          error: 'جلسة QR غير صالحة أو منتهية الصلاحية',
          statusCode: 403,
        });
      }

      if (order.status === 'CANCELLED') {
        return res.status(409).json({
          success: false,
          error: 'تم إلغاء هذا الطلب، لا يمكن إرفاق إشعار حوالة له.',
          statusCode: 409,
        });
      }
      if (order.paymentStatus === PAYMENT_STATUS.PAID) {
        return res.status(409).json({
          success: false,
          error: 'هذا الطلب مدفوع بالفعل — لا حاجة لإرسال إشعار الحوالة.',
          statusCode: 409,
        });
      }

      // Validate + store FIRST (nothing is written to the DB yet), so a
      // rejected file never leaves a half-updated order behind.
      const stored = await storePaymentProof({
        restaurantId: order.restaurantId,
        orderId: order.id,
        buffer: req.file.buffer,
        size: req.file.size,
      });
      if (!stored.ok) {
        const messageByReason: Record<typeof stored.reason, string> = {
          too_large: `حجم الصورة يتجاوز الحد المسموح (${Math.round(
            MAX_PAYMENT_PROOF_BYTES / 1024 / 1024
          )}MB)`,
          not_an_image: 'الملف ليس صورة حقيقية بصيغة JPG أو PNG أو WEBP أو GIF',
          storage_unavailable: 'تعذر رفع صورة الإشعار حالياً، حاول مجدداً',
        };
        // HTTP status and body statusCode MUST agree: the UI branches on the
        // body value when it renders the retry/validation message.
        const failureStatus = stored.reason === 'storage_unavailable' ? 503 : 400;
        return res
          .status(failureStatus)
          .json({ success: false, error: messageByReason[stored.reason], statusCode: failureStatus });
      }
      uploadedKey = stored.key;

      const phone = normalizeCustomerPhone(customerPhone);
      // The name is stored as typed (bounded/sanitized by the schema) because
      // the cashier reads it against the transfer notice; the phone is stored
      // normalized so every surface shows the same canonical number.
      const name = customerName.trim();
      const channel = normalizeTransferChannel(transferChannel);
      const previousPath = order.paymentProofPath;
      const previousGate = normalizeFulfillmentState(order.fulfillmentState);
      const now = new Date();

      // The gate moves only while the order is still PRE-authorization. An
      // already-released order (a legacy row, or a receipt sent while the
      // kitchen is cooking) keeps its RELEASED gate: verifying the money must
      // never pull a live ticket back out of the operational screens.
      const gateUpdate = isHeldForPayment(order.fulfillmentState)
        ? { fulfillmentState: FULFILLMENT_STATE.PAYMENT_VERIFICATION_PENDING }
        : {};

      // Conditional claim: only an unpaid or already-pending order can move to
      // PENDING_VERIFICATION. A concurrent cashier confirmation wins and this
      // update matches zero rows instead of overwriting a settled order.
      const claimed = await prisma.order.updateMany({
        where: {
          id: order.id,
          restaurantId: order.restaurantId,
          status: { not: 'CANCELLED' },
          paymentStatus: { in: [PAYMENT_STATUS.UNPAID, PAYMENT_STATUS.PENDING_VERIFICATION] },
        },
        data: {
          paymentProofPath: stored.key,
          paymentStatus: PAYMENT_STATUS.PENDING_VERIFICATION,
          ...gateUpdate,
          // A fresh upload clears a previous rejection: the guest has
          // responded to the cashier's request for a new receipt.
          paymentRejectedAt: null,
          paymentRejectionReason: null,
          customerName: name,
          transferChannel: channel,
          ...(phone ? { customerPhone: phone } : {}),
        },
      });

      if (claimed.count !== 1) {
        // Roll back the object we just stored — never leave an orphan receipt
        // (or a receipt attached to an order that is no longer awaiting one).
        await discardPaymentProof(stored.key);
        uploadedKey = null;
        return res.status(409).json({
          success: false,
          error: 'تغيرت حالة الطلب قبل استلام الإشعار. حدّث الصفحة وحاول مجدداً.',
          statusCode: 409,
        });
      }

      // Best-effort: drop the replaced receipt so only one object per order
      // ever exists. A failure here is logged and harmless (the DB points at
      // the new object).
      if (previousPath && previousPath !== stored.key) {
        await discardPaymentProof(previousPath);
      }

      await logAuditEvent({
        restaurantId: order.restaurantId,
        actor: 'QR Guest',
        actorRole: 'STAFF',
        action: 'PAYMENT_PROOF_SUBMITTED',
        entity: 'Order',
        entityId: order.id,
        details: `إشعار تحويل للطلب ${order.id} (طاولة ${order.tableId})`,
        metadata: {
          // Canonical payment-lifecycle event name (this repo's audit action
          // taxonomy keeps the established PAYMENT_PROOF_* actions).
          paymentEvent: 'PAYMENT_SUBMITTED',
          hasPhone: Boolean(phone),
          hasName: Boolean(name),
          channel,
          previousFulfillmentState: previousGate,
          fulfillmentState: gateUpdate.fulfillmentState || previousGate,
        },
        ipAddress: req.ip,
      }).catch(() => undefined);

      // Staff streams (no tableId) see every table event; the guest's own
      // stream sees its table. The payload carries NO personal data: the
      // cashier screen reads the name/phone from its authenticated queue.
      realtimeService.broadcastToTable(order.restaurantId, order.tableId, 'PAYMENT_PROOF_SUBMITTED', {
        orderId: order.id,
        tableId: order.tableId,
        numericId: order.numericId,
        total: order.total,
        channel,
        at: now.toISOString(),
      });

      const updated = await prisma.order.findUnique({ where: { id: order.id } });
      return res.status(201).json({
        success: true,
        data: {
          order: updated
            ? {
                id: updated.id,
                numericId: updated.numericId,
                total: updated.total,
                ...customerPaymentProofView(updated),
              }
            : null,
          message: 'تم إرسال إشعار التحويل — سيتحقق منه الكاشير وينتقل طلبك للمطبخ فور التأكيد',
        },
        statusCode: 201,
      });
    } catch (err) {
      console.error('Payment proof submission error:', err);
      // Never leave an upload without a DB reference.
      if (uploadedKey) await discardPaymentProof(uploadedKey);
      return res.status(500).json({
        success: false,
        error: 'تعذر إرسال إشعار الحوالة، حاول مجدداً',
        statusCode: 500,
      });
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
