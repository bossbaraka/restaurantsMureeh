import { Router, Request, Response } from 'express';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';
import { config } from '../config';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';
import { getStorage } from '../services/storage';
import { validateBody, tenantStatusSchema, onboardSchema, trialActivationSchema } from '../validation/schemas';
import {
  FREE_TRIAL_DAYS,
  FREE_TRIAL_PLAN_ID,
  evaluateTrialActivation,
  isTrialPlan,
  trialWindow,
  withTrialMeta,
} from '../services/plans';
import { onboardLimiter } from '../middleware/rateLimit';
import { generateQrToken, parsePagination } from '../utils/security';

const router = Router();

router.use(requireAuth);
router.use(requirePlatformAdmin);

// GET /api/admin/overview
router.get('/overview', async (req: Request, res: Response) => {
  try {
    const restaurants = await prisma.restaurant.findMany({
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { orders: true, tables: true, products: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalRestaurants = restaurants.length;
    const activeRestaurants = restaurants.filter((r) => r.status === 'ACTIVE').length;

    const subscriptions = await prisma.subscription.findMany({
      include: { plan: true, restaurant: true },
    });

    const plans = await prisma.plan.findMany({});
    const auditLogs = await prisma.auditLog.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: { restaurant: true },
    });

    // Total gross platform sales
    const allValidOrders = await prisma.order.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: { total: true },
    });
    const totalRevenue = allValidOrders.reduce((sum, o) => sum + o.total, 0);

    return res.json({
      success: true,
      data: {
        totalRestaurants,
        activeRestaurants,
        totalRevenue,
        activeSubscriptions: subscriptions.filter((s) => s.status === 'ACTIVE' || s.status === 'TRIAL').length,
        restaurants: restaurants.map((r) => ({
          id: r.id,
          name: r.name,
          nameEn: r.nameEn,
          slug: r.slug,
          logo: r.logoUrl,
          coverImage: r.coverImageUrl,
          status: r.status,
          currency: r.currency,
          planId: r.planId,
          planName: r.subscription?.plan?.name || 'بدون باقة',
          tablesCount: r._count.tables,
          productsCount: r._count.products,
          ordersCount: r._count.orders,
          createdAt: r.createdAt.toISOString(),
        })),
        subscriptions,
        plans: plans.map(withTrialMeta),
        auditLogs: auditLogs.map((l) => ({
          id: l.id,
          restaurantId: l.restaurantId || undefined,
          restaurantName: l.restaurant?.name || 'عام',
          actor: l.actor,
          actorRole: l.actorRole,
          action: l.action,
          details: l.details,
          timestamp: l.createdAt.toISOString(),
        })),
      },
      statusCode: 200,
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    return res.status(500).json({ success: false, error: 'تعذر استرجاع بيانات المشرف العام', statusCode: 500 });
  }
});

// POST /api/admin/restaurants/:id/status (Toggle Activate / Suspend)
router.post('/restaurants/:id/status', validateBody(tenantStatusSchema), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: 'ACTIVE' | 'SUSPENDED' | 'ONBOARDING' | 'MAINTENANCE' };

    const updated = await prisma.restaurant.update({
      where: { id },
      data: { status },
    });

    await logAuditEvent({
      restaurantId: id,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'TENANT_STATUS_CHANGED',
      entity: 'Restaurant',
      entityId: id,
      details: `تم تغيير حالة مطعم ${updated.name} إلى ${status}`,
    });

    return res.json({ success: true, data: { restaurant: updated }, statusCode: 200 });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'المطعم غير موجود', statusCode: 404 });
    }
    return res.status(500).json({ success: false, error: 'تعذر تغيير حالة المطعم', statusCode: 500 });
  }
});

// POST /api/admin/restaurants/:id/activate-trial
// Grants the FREE 7-day limited-entitlement plan. This is the ONLY way a tenant
// can obtain it: the router above already enforces platform-admin auth, and the
// manager self-service plan change explicitly rejects the trial plan.
router.post(
  '/restaurants/:id/activate-trial',
  validateBody(trialActivationSchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { note } = req.body as { note?: string };

      const restaurant = await prisma.restaurant.findUnique({
        where: { id },
        include: { subscription: true },
      });
      if (!restaurant) {
        return res.status(404).json({ success: false, error: 'المطعم غير موجود', statusCode: 404 });
      }

      const trialPlan = await prisma.plan.findUnique({ where: { id: FREE_TRIAL_PLAN_ID } });
      if (!trialPlan || trialPlan.status !== 'ACTIVE') {
        return res.status(503).json({
          success: false,
          error: 'الباقة التجريبية غير موجودة في كتالوج الباقات — نفّذ أمر البذر (npm run db:seed) أولاً',
          statusCode: 503,
        });
      }

      // One free trial per tenant, ever.
      const verdict = evaluateTrialActivation(restaurant.subscription);
      if (!verdict.allowed) {
        return res
          .status(verdict.statusCode)
          .json({ success: false, error: verdict.reason, statusCode: verdict.statusCode });
      }

      const { start, end } = trialWindow();

      const subscription = await prisma.$transaction(async (tx) => {
        const sub = await tx.subscription.upsert({
          where: { restaurantId: restaurant.id },
          create: {
            restaurantId: restaurant.id,
            planId: trialPlan.id,
            status: 'TRIAL',
            currentPeriodStart: start,
            currentPeriodEnd: end,
            trialEndsAt: end,
          },
          update: {
            planId: trialPlan.id,
            status: 'TRIAL',
            currentPeriodStart: start,
            currentPeriodEnd: end,
            trialEndsAt: end,
            cancelAtPeriodEnd: false,
          },
        });
        await tx.restaurant.update({
          where: { id: restaurant.id },
          data: { planId: trialPlan.id },
        });
        return sub;
      });

      await logAuditEvent({
        restaurantId: restaurant.id,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'TRIAL_ACTIVATED',
        entity: 'Subscription',
        entityId: subscription.id,
        details: `تم تنشيط الباقة التجريبية المجانية (${FREE_TRIAL_DAYS} أيام، صلاحيات محدودة) لمطعم ${restaurant.name}${note ? ` — ملاحظة: ${note}` : ''}`,
      });

      return res.json({
        success: true,
        data: {
          subscription,
          restaurant,
          planId: trialPlan.id,
          planName: trialPlan.name,
          trialEndsAt: end.toISOString(),
          daysRemaining: FREE_TRIAL_DAYS,
        },
        statusCode: 200,
      });
    } catch (err) {
      console.error('Activate trial error:', err);
      return res
        .status(500)
        .json({ success: false, error: 'تعذر تنشيط الباقة التجريبية', statusCode: 500 });
    }
  }
);

// POST /api/admin/onboard-restaurant (Onboarding Wizard)
router.post('/onboard-restaurant', onboardLimiter, validateBody(onboardSchema), async (req: Request, res: Response) => {
  try {
    const {
      name,
      nameEn,
      slug,
      description,
      phone,
      address,
      currency,
      primaryColor,
      accentColor,
      logoUrl,
      coverImageUrl,
      planId,
      managerName,
      managerEmail,
      managerPassword,
      tablesCount,
      categories,
      products,
    } = req.body as {
      name: string;
      nameEn?: string;
      slug: string;
      description?: string;
      phone?: string;
      address?: string;
      currency?: string;
      primaryColor?: string;
      accentColor?: string;
      logoUrl?: string;
      coverImageUrl?: string;
      planId?: string;
      managerName?: string;
      managerEmail?: string;
      managerPassword?: string;
      tablesCount?: number;
      categories?: Array<{ name: string; nameEn?: string; id?: string }>;
      products?: Array<{
        name: string;
        nameEn?: string;
        description?: string;
        price?: number;
        imageUrl?: string;
        categoryName?: string;
        categoryId?: string;
      }>;
    };

    const normalizedSlug = slug.toLowerCase();
    const existingSlug = await prisma.restaurant.findUnique({ where: { slug: normalizedSlug } });
    if (existingSlug) {
      return res.status(400).json({ success: false, error: 'رابط المطعم (Slug) مستخدم بالفعل', statusCode: 400 });
    }

    const targetPlanId = planId || 'plan-pro';
    const plan = await prisma.plan.findUnique({ where: { id: targetPlanId } });
    if (!plan || plan.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, error: 'الباقة المحددة غير متاحة', statusCode: 400 });
    }

    if (managerEmail) {
      const emailTaken = await prisma.restaurantUser.findUnique({
        where: { email: managerEmail.toLowerCase() },
      });
      if (emailTaken) {
        return res.status(409).json({ success: false, error: 'بريد المدير مستخدم مسبقاً', statusCode: 409 });
      }
      if (!managerPassword) {
        return res.status(400).json({ success: false, error: 'كلمة مرور المدير مطلوبة مع بريده', statusCode: 400 });
      }
    }

    const restId = `rest-${normalizedSlug}`;
    const totalTables = tablesCount ?? 20;

    // All-or-nothing provisioning: a partial tenant must never exist.
    const newRest = await prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.create({
        data: {
          id: restId,
          name,
          nameEn: nameEn || name,
          slug: normalizedSlug,
          description: description || 'مطعم فاخر يقدم أرقى المأكولات',
          phone: phone || '+970 599 000 000',
          address: address || 'الشارع الرئيسي',
          currency: currency || '₪',
          primaryColor: primaryColor || '#D4AF37',
          accentColor: accentColor || '#C5A880',
          logoUrl: logoUrl || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=200&q=80',
          coverImageUrl: coverImageUrl || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85',
          status: 'ACTIVE',
          planId: targetPlanId,
        },
      });

      // Create Subscription — the free trial is booked as a 7-day TRIAL window,
      // every paid plan starts a normal 30-day ACTIVE period.
      const startsAsTrial = isTrialPlan(plan);
      const period = startsAsTrial
        ? trialWindow()
        : { start: new Date(), end: new Date(Date.now() + 30 * 86400 * 1000) };

      await tx.subscription.create({
        data: {
          restaurantId: restaurant.id,
          planId: targetPlanId,
          status: startsAsTrial ? 'TRIAL' : 'ACTIVE',
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          ...(startsAsTrial ? { trialEndsAt: period.end } : {}),
        },
      });

      // Create Manager User
      if (managerEmail && managerPassword) {
        await tx.restaurantUser.create({
          data: {
            restaurantId: restaurant.id,
            name: managerName || 'مدير المطعم',
            email: managerEmail.toLowerCase(),
            passwordHash: await bcrypt.hash(managerPassword, 12),
            role: 'RESTAURANT_MANAGER',
            status: 'ACTIVE',
          },
        });
      }

      // Provision Tables
      const tablesData = Array.from({ length: totalTables }, (_, i) => {
        const num = i + 1;
        const numStr = num < 10 ? `0${num}` : `${num}`;
        return {
          id: `${restaurant.id}-T${numStr}`,
          restaurantId: restaurant.id,
          number: num,
          name: `طاولة ${numStr}`,
          capacity: 4,
          zone: 'MAIN_HALL' as const,
          status: 'AVAILABLE' as const,
          qrToken: generateQrToken(),
        };
      });

      await tx.table.createMany({ data: tablesData });

      // Seed Initial Category & Products if provided
      if (categories && Array.isArray(categories)) {
        for (let i = 0; i < categories.length; i++) {
          const c = categories[i];
          const cat = await tx.category.create({
            data: {
              restaurantId: restaurant.id,
              name: c.name,
              nameEn: c.nameEn,
              sortOrder: i + 1,
            },
          });

          if (products && Array.isArray(products)) {
            const catProducts = products.filter((p) => p.categoryName === c.name || (c.id && p.categoryId === c.id));
            for (const p of catProducts) {
              await tx.product.create({
                data: {
                  restaurantId: restaurant.id,
                  categoryId: cat.id,
                  name: p.name,
                  nameEn: p.nameEn || p.name,
                  description: p.description || '',
                  price: p.price ?? 50,
                  imageUrl: p.imageUrl || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
                  available: true,
                },
              });
            }
          }
        }
      }

      return restaurant;
    });

    await logAuditEvent({
      restaurantId: newRest.id,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'RESTAURANT_ONBOARDED',
      entity: 'Restaurant',
      entityId: newRest.id,
      details: `تم تسجيل وتهيئة مطعم جديد: ${newRest.name} (${newRest.slug}) مع ${totalTables} طاولة`,
    });

    return res.status(201).json({ success: true, data: { restaurant: newRest }, statusCode: 201 });
  } catch (err) {
    console.error('Onboarding error:', err);
    return res.status(500).json({ success: false, error: 'تعذر إنشاء المطعم', statusCode: 500 });
  }
});

// GET /api/admin/audit-logs — paginated (capped)
router.get('/audit-logs', async (req: Request, res: Response) => {
  const { take, skip } = parsePagination(req.query as Record<string, unknown>);
  const logs = await prisma.auditLog.findMany({
    take: Math.min(take, 100),
    skip,
    orderBy: { createdAt: 'desc' },
    include: { restaurant: true },
  });
  return res.json({ success: true, data: logs, statusCode: 200 });
});

// GET /api/admin/storage-status — safe diagnostics (platform admins only).
// Reports storage configuration reachability WITHOUT exposing any secret or
// credential value. Never returns keys/tokens — only booleans and names.
router.get('/storage-status', async (_req: Request, res: Response) => {
  let storageReachable = false;
  let storageError: string | null = null;
  try {
    const storage = getStorage();
    // Lightweight probe: local → base dir exists; object storage → list the
    // bucket root. No secret is ever included in the response.
    if (storage.driver === 'local') {
      storageReachable = fs.existsSync(config.uploadDir);
    } else {
      await storage.exists('__probe__/health');
      storageReachable = true;
    }
  } catch {
    storageError = 'storage unreachable';
  }

  let dbReachable = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }

  return res.json({
    success: true,
    data: {
      storage: {
        driver: config.storageDriver,
        persistent: config.storageDriver === 'supabase',
        bucket: config.storageDriver === 'supabase' ? config.supabaseBucket : null,
        configured:
          config.storageDriver === 'local' ||
          !!(config.supabaseUrl && config.supabaseServiceRoleKey),
        reachable: storageReachable,
        error: storageError,
      },
      database: { reachable: dbReachable },
    },
    statusCode: 200,
  });
});

export default router;
