import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

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
        plans,
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
router.post('/restaurants/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'ACTIVE' | 'SUSPENDED'

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
  } catch (err) {
    return res.status(500).json({ success: false, error: 'تعذر تغيير حالة المطعم', statusCode: 500 });
  }
});

// POST /api/admin/onboard-restaurant (Onboarding Wizard)
router.post('/onboard-restaurant', async (req: Request, res: Response) => {
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
    } = req.body;

    const existingSlug = await prisma.restaurant.findUnique({ where: { slug: slug.toLowerCase() } });
    if (existingSlug) {
      return res.status(400).json({ success: false, error: 'رابط المطعم (Slug) مستخدم بالفعل', statusCode: 400 });
    }

    const restId = `rest-${slug.toLowerCase()}`;
    const newRest = await prisma.restaurant.create({
      data: {
        id: restId,
        name,
        nameEn: nameEn || name,
        slug: slug.toLowerCase(),
        description: description || 'مطعم فاخر يقدم أرقى المأكولات',
        phone: phone || '+970 599 000 000',
        address: address || 'الشارع الرئيسي',
        currency: currency || '₪',
        primaryColor: primaryColor || '#D4AF37',
        accentColor: accentColor || '#C5A880',
        logoUrl: logoUrl || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=200&q=80',
        coverImageUrl: coverImageUrl || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85',
        status: 'ACTIVE',
        planId: planId || 'plan-pro',
      },
    });

    // Create Subscription
    await prisma.subscription.create({
      data: {
        restaurantId: newRest.id,
        planId: planId || 'plan-pro',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000),
      },
    });

    // Create Manager User
    if (managerEmail && managerPassword) {
      const passwordHash = bcrypt.hashSync(managerPassword, 10);
      await prisma.restaurantUser.create({
        data: {
          restaurantId: newRest.id,
          name: managerName || 'مدير المطعم',
          email: managerEmail.toLowerCase(),
          passwordHash,
          role: 'RESTAURANT_MANAGER',
          status: 'ACTIVE',
        },
      });
    }

    // Provision Tables
    const totalTables = Number(tablesCount) || 20;
    const tablesData = Array.from({ length: totalTables }, (_, i) => {
      const num = i + 1;
      const numStr = num < 10 ? `0${num}` : `${num}`;
      return {
        id: `TABLE-${numStr}`,
        restaurantId: newRest.id,
        number: num,
        name: `طاولة ${numStr}`,
        capacity: 4,
        zone: 'MAIN_HALL' as const,
        status: 'AVAILABLE' as const,
        qrToken: randomUUID(),
      };
    });

    await prisma.table.createMany({ data: tablesData });

    // Seed Initial Category & Products if provided
    if (categories && Array.isArray(categories)) {
      for (let i = 0; i < categories.length; i++) {
        const c = categories[i];
        const cat = await prisma.category.create({
          data: {
            restaurantId: newRest.id,
            name: c.name,
            nameEn: c.nameEn,
            sortOrder: i + 1,
          },
        });

        if (products && Array.isArray(products)) {
          const catProducts = products.filter((p: any) => p.categoryName === c.name || p.categoryId === c.id);
          for (const p of catProducts) {
            await prisma.product.create({
              data: {
                restaurantId: newRest.id,
                categoryId: cat.id,
                name: p.name,
                nameEn: p.nameEn || p.name,
                description: p.description || '',
                price: Number(p.price) || 50,
                imageUrl: p.imageUrl || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
                available: true,
              },
            });
          }
        }
      }
    }

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

// GET /api/admin/audit-logs
router.get('/audit-logs', async (req: Request, res: Response) => {
  const logs = await prisma.auditLog.findMany({
    take: 100,
    orderBy: { createdAt: 'desc' },
    include: { restaurant: true },
  });
  return res.json({ success: true, data: logs, statusCode: 200 });
});

export default router;
