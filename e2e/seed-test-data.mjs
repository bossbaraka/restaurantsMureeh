/**
 * TEST DATA SEEDER — Employee Functional & Permission Test
 * -------------------------------------------------------------------------
 * Creates two isolated test tenants (Restaurant A / Restaurant B) with one
 * account per employee role. Used only against a disposable test database
 * (DATABASE_URL must point at the sandbox test DB).
 *
 * This file lives in `e2e/` — it is throwaway harness
 * code, never part of the shipped app.
 */
import { createRequire } from 'module';
import bcrypt from 'bcryptjs';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('/home/user/restaurantsMureeh/node_modules/.prisma/client/index.js');

const prisma = new PrismaClient({ log: ['error'] });

export const PASSWORD = 'Mureeh#Test2026';
export const PINS = { waiter: '1111', staff: '2222', cashier: '3333', kitchen: '4444' };

const hash = (v) => bcrypt.hashSync(v, 10);

async function reset() {
  // Order matters: children first (FK constraints).
  await prisma.payment.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.waiterRequest.deleteMany({});
  await prisma.tableSession.deleteMany({});
  await prisma.table.deleteMany({});
  await prisma.addOn.deleteMany({});
  await prisma.productOption.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.offer.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.restaurantUser.deleteMany({});
  await prisma.restaurant.deleteMany({});
  await prisma.plan.deleteMany({});
}

export async function seed() {
  await reset();

  // The platform free-trial plan is required by POST /api/admin/onboard-restaurant.
  await prisma.plan.create({
    data: {
      id: 'plan-trial-7d', name: 'الباقة التجريبية المجانية', nameEn: 'Free 7-Day Trial',
      priceMonthly: 0, priceYearly: 0, billingPeriod: 'trial',
      maxTables: 8, maxCategories: 3, maxProducts: 15, maxBranches: 1,
      entitlements: ['CAN_USE_ADVANCED_FEATURES'], description: 'trial', status: 'ACTIVE',
    },
  });
  const plan = await prisma.plan.create({
    data: {
      id: 'plan-test-pro',
      name: 'باقة الاختبار',
      nameEn: 'Test Plan',
      priceMonthly: 550,
      priceYearly: 5500,
      maxTables: 500,
      maxCategories: 300,
      maxProducts: 800,
      maxBranches: 50,
      entitlements: ['CAN_USE_ANALYTICS', 'CAN_CUSTOM_BRANDING', 'CAN_EXPORT_REPORTS', 'CAN_CREATE_BRANCH'],
      description: 'Test plan',
      status: 'ACTIVE',
    },
  });

  // Platform plan catalog for onboarding (mirrors server/db/seed.ts).
  for (const extra of [
    { id: 'plan-starter', name: 'الباقة الأساسية', nameEn: 'Starter Plan', priceMonthly: 300, priceYearly: 3000,
      maxTables: 20, maxCategories: 6, maxProducts: 35, maxBranches: 1,
      entitlements: ['CAN_USE_ADVANCED_FEATURES'], description: 'starter', status: 'ACTIVE' },
    { id: 'plan-pro', name: 'باقة المحترفين', nameEn: 'Professional', priceMonthly: 550, priceYearly: 5500,
      maxTables: 50, maxCategories: 20, maxProducts: 150, maxBranches: 3,
      entitlements: ['CAN_USE_ANALYTICS', 'CAN_CUSTOM_BRANDING', 'CAN_USE_ADVANCED_FEATURES', 'CAN_EXPORT_REPORTS'],
      description: 'pro', status: 'ACTIVE' },
  ]) {
    await prisma.plan.create({ data: extra });
  }

  const restaurantA = await prisma.restaurant.create({
    data: {
      name: 'مطعم الاختبار A',
      nameEn: 'Test Restaurant A',
      slug: 'test-tenant-a',
      logoUrl: '/uploads/test-a-logo.png',
      description: 'Tenant A (employee test fixture)',
      phone: '+970000000001',
      address: 'Test Address A',
      status: 'ACTIVE',
      subscription: {
        create: {
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodEnd: new Date(Date.now() + 30 * 864e5),
        },
      },
    },
  });

  const restaurantB = await prisma.restaurant.create({
    data: {
      name: 'مطعم الاختبار B',
      nameEn: 'Test Restaurant B',
      slug: 'test-tenant-b',
      logoUrl: '/uploads/test-b-logo.png',
      description: 'Tenant B (employee test fixture)',
      phone: '+970000000002',
      address: 'Test Address B',
      status: 'ACTIVE',
      subscription: {
        create: {
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodEnd: new Date(Date.now() + 30 * 864e5),
        },
      },
    },
  });

  const restaurantC = await prisma.restaurant.create({
    data: {
      name: 'مطعم الاختبار C', nameEn: 'Test Restaurant C', slug: 'test-tenant-c',
      logoUrl: '/uploads/test-c-logo.png', description: 'Tenant C (plan-gate fixture)',
      phone: '+970000000003', address: 'Test Address C', status: 'ACTIVE',
      subscription: { create: { planId: 'plan-trial-7d', status: 'TRIAL', currentPeriodEnd: new Date(Date.now() + 7 * 864e5) } },
    },
  });

  const mkUser = (data) =>
    prisma.restaurantUser.create({
      data: { passwordHash: hash(PASSWORD), status: 'ACTIVE', ...data },
    });

  const users = {
    managerA: await mkUser({
      restaurantId: restaurantA.id, name: 'Manager A', email: 'manager.a@test.local',
      role: 'RESTAURANT_MANAGER', pinHash: hash('9999'),
    }),
    waiterA: await mkUser({
      restaurantId: restaurantA.id, name: 'Waiter A', email: 'waiter.a@test.local',
      role: 'WAITER', pinHash: hash(PINS.waiter),
    }),
    staffA: await mkUser({
      restaurantId: restaurantA.id, name: 'Staff A', email: 'staff.a@test.local',
      role: 'STAFF', pinHash: hash(PINS.staff),
    }),
    cashierA: await mkUser({
      restaurantId: restaurantA.id, name: 'Cashier A', email: 'cashier.a@test.local',
      role: 'CASHIER', pinHash: hash(PINS.cashier),
    }),
    kitchenA: await mkUser({
      restaurantId: restaurantA.id, name: 'Kitchen A', email: 'kitchen.a@test.local',
      role: 'KITCHEN', pinHash: hash(PINS.kitchen),
    }),
    suspendedA: await mkUser({
      restaurantId: restaurantA.id, name: 'Suspended A', email: 'suspended.a@test.local',
      role: 'STAFF', status: 'SUSPENDED',
    }),
    managerB: await mkUser({
      restaurantId: restaurantB.id, name: 'Manager B', email: 'manager.b@test.local',
      role: 'RESTAURANT_MANAGER', pinHash: hash('8888'),
    }),
    waiterB: await mkUser({
      restaurantId: restaurantB.id, name: 'Waiter B', email: 'waiter.b@test.local',
      role: 'WAITER', pinHash: hash('7777'),
    }),
    managerC: await mkUser({
      restaurantId: restaurantC.id, name: 'Manager C', email: 'manager.c@test.local',
      role: 'RESTAURANT_MANAGER', pinHash: hash('6666'),
    }),
    platformAdmin: await mkUser({
      restaurantId: null, name: 'Platform Admin', email: 'platform.admin@test.local',
      role: 'PLATFORM_ADMIN', pinHash: null,
    }),
  };

  // ---- Tenant A menu / floor / activity -----------------------------------
  const catA1 = await prisma.category.create({
    data: { restaurantId: restaurantA.id, name: 'مقبلات A', nameEn: 'Starters A', sortOrder: 1 },
  });
  const catA2 = await prisma.category.create({
    data: { restaurantId: restaurantA.id, name: 'مشروبات A', nameEn: 'Drinks A', sortOrder: 2 },
  });
  const prodA1 = await prisma.product.create({
    data: {
      restaurantId: restaurantA.id, categoryId: catA1.id, name: 'حمص A', nameEn: 'Hummus A',
      description: 'test', price: 20, imageUrl: '/uploads/p1.png', available: true,
    },
  });
  const prodA2 = await prisma.product.create({
    data: {
      restaurantId: restaurantA.id, categoryId: catA2.id, name: 'عصير A', nameEn: 'Juice A',
      description: 'test', price: 12, imageUrl: '/uploads/p2.png', available: true,
    },
  });

  const tablesA = [];
  for (let n = 1; n <= 4; n += 1) {
    tablesA.push(
      await prisma.table.create({
        data: { restaurantId: restaurantA.id, number: n, capacity: 4, zone: 'MAIN_HALL' },
      })
    );
  }

  const sessionA = await prisma.tableSession.create({
    data: {
      restaurantId: restaurantA.id,
      tableId: tablesA[0].id,
      expiresAt: new Date(Date.now() + 6 * 3600e3),
      status: 'ACTIVE',
    },
  });

  const orderA = await prisma.order.create({
    data: {
      id: `#900001`, numericId: 900001,
      restaurantId: restaurantA.id,
      tableId: tablesA[0].id,
      sessionId: sessionA.id,
      status: 'PENDING',
      subtotal: 20,
      total: 20,
      items: {
        create: [{
          productId: prodA1.id, productNameSnapshot: 'حمص A', priceSnapshot: 20,
          quantity: 1, totalPrice: 20,
        }],
      },
    },
  });

  const waiterReqA = await prisma.waiterRequest.create({
    data: {
      restaurantId: restaurantA.id, tableId: tablesA[1].id, sessionId: null,
      reason: 'ASSISTANCE', status: 'PENDING',
    },
  });

  const offerA = await prisma.offer.create({
    data: {
      restaurantId: restaurantA.id, title: 'عرض A', subtitle: 'test',
      originalPrice: 50, discountedPrice: 40, isActive: true,
    },
  });

  // ---- Tenant B menu / floor / activity -----------------------------------
  const catB1 = await prisma.category.create({
    data: { restaurantId: restaurantB.id, name: 'تصنيف B', nameEn: 'Category B', sortOrder: 1 },
  });
  const prodB1 = await prisma.product.create({
    data: {
      restaurantId: restaurantB.id, categoryId: catB1.id, name: 'منتج B', nameEn: 'Product B',
      description: 'test', price: 33, imageUrl: '/uploads/pb.png', available: true,
    },
  });
  const tableB = await prisma.table.create({
    data: { restaurantId: restaurantB.id, number: 1, capacity: 2, zone: 'TERRACE' },
  });
  const orderB = await prisma.order.create({
    data: {
      id: `#900002`, numericId: 900002,
      restaurantId: restaurantB.id,
      tableId: tableB.id,
      status: 'PENDING',
      subtotal: 33,
      total: 33,
      items: {
        create: [{
          productId: prodB1.id, productNameSnapshot: 'منتج B', priceSnapshot: 33,
          quantity: 1, totalPrice: 33,
        }],
      },
    },
  });
  const waiterReqB = await prisma.waiterRequest.create({
    data: { restaurantId: restaurantB.id, tableId: tableB.id, reason: 'BILL', status: 'PENDING' },
  });
  const offerB = await prisma.offer.create({
    data: { restaurantId: restaurantB.id, title: 'عرض B', originalPrice: 20, discountedPrice: 15, isActive: true },
  });
  const paymentB = await prisma.payment.create({
    data: {
      id: `pay-B-fixture`, receiptNumber: `RCPT-B-${Date.now()}`,
      restaurantId: restaurantB.id, tableId: tableB.id, tableLabel: 'Table 1',
      orderIds: [orderB.id], subtotal: 33, total: 33, method: 'CASH', cashierName: 'Manager B',
    },
  });

  return {
    plan, restaurantA, restaurantB, restaurantC, users,
    ids: {
      catA1: catA1.id, catA2: catA2.id, prodA1: prodA1.id, prodA2: prodA2.id,
      tablesA: tablesA.map((t) => t.id), orderA: orderA.id, orderA2: orderA.id,
      waiterReqA: waiterReqA.id, offerA: offerA.id, sessionA: sessionA.id,
      catB1: catB1.id, prodB1: prodB1.id, tableB: tableB.id, orderB: orderB.id,
      restaurantC: restaurantC.id,
      waiterReqB: waiterReqB.id, offerB: offerB.id, paymentB: paymentB.id,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then((ctx) => {
      console.log(JSON.stringify({
        restaurantA: ctx.restaurantA.id,
        restaurantB: ctx.restaurantB.id,
        users: Object.fromEntries(Object.entries(ctx.users).map(([k, v]) => [k, v.email])),
        ids: ctx.ids,
      }, null, 2));
      return prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error('SEED FAILED', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
