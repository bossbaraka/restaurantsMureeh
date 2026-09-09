import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { FREE_TRIAL_PLAN } from '../services/plans';
import { seedShoqrahCafe } from './seed-shoqrah';
import { seedGhosnCafe } from './seed-ghosn';
import { assertStrongSeedPassword, isDemoSeedAllowed } from './seed-utils';

dotenv.config();
const { prisma } = await import('./prisma');

/**
 * Seeds platform-level system data into PostgreSQL:
 *   1. SaaS subscription plans (catalog of the platform)
 *   2. The Platform Super Admin account (from env credentials)
 *
 * PRODUCTION vs DEVELOPMENT (audit C-02)
 * --------------------------------------
 * Tenant restaurants are NOT part of the production seed. Real tenants are
 * created exclusively through the onboarding flow
 * (`POST /api/admin/onboard-restaurant`).
 *
 * The demo tenants (Shoqrah / Ghosn) are development fixtures. They run only
 * when `isDemoSeedAllowed()` returns true, which requires BOTH
 * `ALLOW_DEMO_SEED=1` AND `NODE_ENV !== 'production'`. Their manager accounts
 * are provisioned from environment variables and never from literals.
 */
export async function seedDatabase() {
  console.log('🌱 Seeding platform system data (plans + platform admin)...');

  const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const platformAdminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!platformAdminEmail || !platformAdminPassword) {
    throw new Error('PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must be configured before seeding');
  }
  // Reject weak/previously-leaked secrets for the highest-privilege account.
  assertStrongSeedPassword(platformAdminPassword, 'PLATFORM_ADMIN_PASSWORD');

  // ------------------------------------------------------------------
  // 1. SaaS Subscription Plans (platform catalog)
  // ------------------------------------------------------------------
  const planIdByKey: Record<string, string> = {};
  for (const plan of [
    // Free 7-day trial — limited entitlements, activated by platform admins only.
    FREE_TRIAL_PLAN,
    {
      id: 'plan-starter',
      name: 'الباقة الأساسية',
      nameEn: 'Starter Plan',
      priceMonthly: 300,
      priceYearly: 3000,
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
      priceMonthly: 550,
      priceYearly: 5500,
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
      priceMonthly: 850,
      priceYearly: 8500,
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
    // Do NOT rewrite passwordHash / role / status for an existing platform
    // admin (audit C-02). Re-running the seed must never resurrect an old
    // password or silently re-activate a suspended admin account.
    // Deliberate credential rotation has its own tool: `npm run db:provision-admins`.
    console.log(
      '↩️  Platform admin already exists — credentials left unchanged. ' +
        'Use `npm run db:provision-admins` to rotate deliberately.'
    );
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

  // ------------------------------------------------------------------
  // 3. Demo tenants — DEVELOPMENT ONLY (audit C-02)
  // ------------------------------------------------------------------
  // Requires ALLOW_DEMO_SEED=1 *and* NODE_ENV !== 'production'. A staging
  // env file copied into production therefore cannot seed demo tenants.
  if (isDemoSeedAllowed()) {
    console.log('🧪 ALLOW_DEMO_SEED=1 (non-production) — seeding demo tenants...');
    await seedShoqrahCafe();
    await seedGhosnCafe();
  } else {
    console.log(
      'ℹ️  Demo tenants skipped (production seed). ' +
        'Real tenants are created via POST /api/admin/onboard-restaurant.'
    );
  }
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

