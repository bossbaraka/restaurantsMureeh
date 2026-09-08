import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { seedShoqrahCafe } from './seed-shoqrah';

dotenv.config();
const { prisma } = await import('./prisma');

/**
 * Seeds ONLY platform-level system data into PostgreSQL:
 *   1. SaaS subscription plans (catalog of the platform)
 *   2. The Platform Super Admin account (from env credentials)
 *
 * Restaurants (tenants) are NEVER seeded here — each tenant is created
 * exclusively through the real onboarding flow (`POST /api/admin/onboard-restaurant`),
 * so there is no mock/demo tenant data anywhere in the system.
 */
export async function seedDatabase() {
  console.log('🌱 Seeding platform system data (plans + platform admin)...');

  const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL;
  const platformAdminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!platformAdminEmail || !platformAdminPassword) {
    throw new Error('PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must be configured before seeding');
  }

  // ------------------------------------------------------------------
  // 1. SaaS Subscription Plans (platform catalog)
  // ------------------------------------------------------------------
  const planIdByKey: Record<string, string> = {};
  for (const plan of [
    {
      id: 'plan-starter',
      name: 'الباقة الأساسية',
      nameEn: 'Starter Plan',
      priceMonthly: 149,
      priceYearly: 1490,
      billingPeriod: 'monthly',
      maxTables: 15,
      maxCategories: 6,
      maxProducts: 35,
      entitlements: ['CAN_USE_ADVANCED_FEATURES'],
      description: 'مثالية للمطاعم الصغيرة والكافيهات التي تبدأ رحلة المنيو الرقمي والطلب الذكي.',
      isPopular: false,
    },
    {
      id: 'plan-pro',
      name: 'باقة المحترفين الفاخرة',
      nameEn: 'Professional Hospitality',
      priceMonthly: 349,
      priceYearly: 3490,
      billingPeriod: 'monthly',
      maxTables: 50,
      maxCategories: 20,
      maxProducts: 150,
      entitlements: [
        'CAN_USE_ANALYTICS',
        'CAN_CUSTOM_BRANDING',
        'CAN_USE_ADVANCED_FEATURES',
        'CAN_EXPORT_REPORTS',
      ],
      description: 'الحل الأمثل للمطاعم الفاخرة التي تتطلب تحليلات مبيعات متقدمة وهوية مخصصة بالكامل.',
      isPopular: true,
    },
    {
      id: 'plan-enterprise',
      name: 'باقة المؤسسات وسلاسل المطاعم',
      nameEn: 'Enterprise & Multi-Branch',
      priceMonthly: 799,
      priceYearly: 7990,
      billingPeriod: 'monthly',
      maxTables: 999,
      maxCategories: 999,
      maxProducts: 999,
      entitlements: [
        'CAN_USE_ANALYTICS',
        'CAN_CUSTOM_BRANDING',
        'CAN_CREATE_BRANCH',
        'CAN_USE_ADVANCED_FEATURES',
        'CAN_EXPORT_REPORTS',
        'CAN_UNLIMITED_TABLES',
        'CAN_PRIORITY_SUPPORT',
        'CAN_USE_CUSTOM_DOMAIN',
      ],
      description: 'تغطية غير محدودة للفنادق والمنتجعات وسلاسل المطاعم الراقية مع نطاق مخصص ودعم فني مخصص 24/7.',
      isPopular: false,
    },
  ]) {
    const existing = await prisma.plan.findUnique({ where: { id: plan.id } });
    if (existing) {
      await prisma.plan.update({ where: { id: plan.id }, data: plan });
    } else {
      await prisma.plan.create({ data: { ...plan, status: 'ACTIVE' } });
    }
    planIdByKey[plan.id] = plan.id;
  }

  // ------------------------------------------------------------------
  // 2. Platform Super Admin
  // ------------------------------------------------------------------
  const existingAdmin = await prisma.restaurantUser.findUnique({
    where: { email: platformAdminEmail.toLowerCase() },
  });
  if (existingAdmin) {
    await prisma.restaurantUser.update({
      where: { id: existingAdmin.id },
      data: {
        name: 'مدير المنصة',
        passwordHash: bcrypt.hashSync(platformAdminPassword, 12),
        role: 'PLATFORM_ADMIN',
        status: 'ACTIVE',
      },
    });
  } else {
    await prisma.restaurantUser.create({
      data: {
        id: `user-platform-admin`,
        restaurantId: null,
        name: 'مدير المنصة',
        email: platformAdminEmail.toLowerCase(),
        passwordHash: bcrypt.hashSync(platformAdminPassword, 12),
        role: 'PLATFORM_ADMIN',
        status: 'ACTIVE',
      },
    });
  }

  console.log('✅ Platform system data ready (plans + platform admin).');
  await seedShoqrahCafe();
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seedDatabase()
    .catch((e) => {
      console.error('Seed error:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

