import { prisma } from './prisma';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { INITIAL_CATEGORIES, INITIAL_PRODUCTS, INITIAL_OFFERS } from '../../src/data/sampleMenu';

export async function seedDatabase() {
  console.log('🌱 Seeding PostgreSQL Database with Production Data...');

  // 1. Clean existing data in reverse dependency order
  await prisma.auditLog.deleteMany({});
  await prisma.waiterRequest.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.tableSession.deleteMany({});
  await prisma.table.deleteMany({});
  await prisma.addOn.deleteMany({});
  await prisma.productOption.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.offer.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.restaurantUser.deleteMany({});
  await prisma.restaurant.deleteMany({});
  await prisma.plan.deleteMany({});

  const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL;
  const platformAdminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
  const demoManagerEmail = process.env.DEMO_MANAGER_EMAIL;
  const demoManagerPassword = process.env.DEMO_MANAGER_PASSWORD;
  if (!platformAdminEmail || !platformAdminPassword || !demoManagerEmail || !demoManagerPassword) {
    throw new Error('Platform and demo manager credentials must be configured before seeding');
  }

  // 2. Plans
  await prisma.plan.createMany({
    data: [
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
        status: 'ACTIVE',
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
        status: 'ACTIVE',
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
        description: 'تغطية غير محدودة للفنادق والمنتجعات وسلاسل المطاعم الراقية مع دعم فني مخصص 24/7.',
        status: 'ACTIVE',
        isPopular: false,
      },
    ],
  });

  await prisma.restaurantUser.create({
    data: {
      id: 'user-platform-admin',
      restaurantId: null,
      name: 'مدير المنصة',
      email: platformAdminEmail.toLowerCase(),
      passwordHash: bcrypt.hashSync(platformAdminPassword, 12),
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    },
  });

  const demoRestaurant = await prisma.restaurant.create({
    data: {
      id: 'rest-demo-promo',
      name: 'مطعم ميرار التجريبي',
      nameEn: 'MÉRAR Promotional Demo Restaurant',
      slug: 'merar-demo',
      logoUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=200&q=80',
      coverImageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=85',
      description: 'نسخة تجريبية كاملة لاستعراض تجربة المطعم والمنيو والطلب الذكي.',
      phone: '+970 599 000 999',
      address: 'موقع العرض التجريبي',
      currency: '₪',
      language: 'ar',
      timezone: 'Asia/Jerusalem',
      status: 'ACTIVE',
      primaryColor: '#D4AF37',
      accentColor: '#C5A880',
      planId: 'plan-enterprise',
    },
  });

  await prisma.subscription.create({
    data: {
      id: 'sub-demo-promo',
      restaurantId: demoRestaurant.id,
      planId: 'plan-enterprise',
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 86400 * 1000),
      cancelAtPeriodEnd: false,
    },
  });

  await prisma.restaurantUser.create({
    data: {
      id: 'user-demo-manager',
      restaurantId: demoRestaurant.id,
      name: 'مدير المطعم التجريبي',
      email: demoManagerEmail.toLowerCase(),
      passwordHash: bcrypt.hashSync(demoManagerPassword, 12),
      role: 'RESTAURANT_MANAGER',
      status: 'ACTIVE',
    },
  });

  await prisma.table.createMany({
    data: Array.from({ length: 20 }, (_, index) => {
      const number = index + 1;
      return {
        id: `DEMO-TABLE-${String(number).padStart(2, '0')}`,
        restaurantId: demoRestaurant.id,
        number,
        name: `طاولة ${String(number).padStart(2, '0')}`,
        capacity: number % 2 === 0 ? 4 : 2,
        zone: (number <= 12 ? 'MAIN_HALL' : 'TERRACE') as 'MAIN_HALL' | 'TERRACE',
        status: 'AVAILABLE' as const,
        qrToken: `demo-${randomUUID()}`,
        hasWaiterCall: false,
      };
    }),
  });

  const demoCategoryIds = new Map(INITIAL_CATEGORIES.map((category) => [category.id, `demo-${category.id}`]));
  await prisma.category.createMany({
    data: INITIAL_CATEGORIES.map((category) => ({
      id: demoCategoryIds.get(category.id)!,
      restaurantId: demoRestaurant.id,
      name: category.name,
      nameEn: category.nameEn,
      sortOrder: category.sortOrder,
      status: 'ACTIVE',
    })),
  });

  for (const product of INITIAL_PRODUCTS) {
    const demoProductId = `demo-${product.id}`;
    await prisma.product.create({
      data: {
        id: demoProductId,
        restaurantId: demoRestaurant.id,
        categoryId: demoCategoryIds.get(product.categoryId)!,
        name: product.name,
        nameEn: product.nameEn,
        description: product.description,
        price: product.price,
        imageUrl: product.image,
        available: product.isAvailable,
        isFeatured: product.isFeatured || false,
        badge: product.badge,
        preparationTimeMinutes: product.preparationTimeMinutes || 15,
        calories: product.calories,
        allergens: product.allergens || [],
        ingredients: product.ingredients || [],
        removableIngredients: product.removableIngredients || [],
        options: { create: (product.sizes || []).map((size) => ({ name: size.name, nameEn: size.name, priceModifier: size.priceModifier, price: size.price || size.priceModifier })) },
        addOns: { create: (product.addOns || []).map((addOn) => ({ name: addOn.name, nameEn: addOn.name, price: addOn.price, isAvailable: true })) },
      },
    });
  }

  await prisma.offer.createMany({
    data: INITIAL_OFFERS.map((offer) => ({
      id: `demo-${offer.id}`,
      restaurantId: demoRestaurant.id,
      title: offer.title,
      titleEn: offer.titleEn,
      subtitle: offer.subtitle,
      description: offer.description,
      image: offer.image,
      originalPrice: offer.originalPrice,
      discountedPrice: offer.discountedPrice,
      discountPercentage: offer.discountPercentage,
      badge: offer.badge,
      bgGradient: offer.bgGradient,
      isActive: offer.isActive,
      code: offer.code,
    })),
  });

  // Demo data is intentionally limited to this isolated promotional tenant.
  return;

  // 3. Restaurants (Tenants)
  const merar = await prisma.restaurant.create({
    data: {
      id: 'rest-merar',
      name: 'مطعم مِيرار الفاخر',
      nameEn: 'MÉRAR Luxury Dining & Lounge',
      slug: 'merar',
      logoUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=200&q=80',
      coverImageUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85',
      description: 'تجربة ضيافة استثنائية تجمع بين فن الطهي المعاصر وأرقى المكونات العضوية والمعتقة.',
      phone: '+970 599 000 111',
      address: 'شارع البوليفارد الملكي، حي السفارات',
      currency: '₪',
      language: 'ar',
      timezone: 'Asia/Jerusalem',
      status: 'ACTIVE',
      primaryColor: '#D4AF37',
      accentColor: '#C5A880',
      planId: 'plan-pro',
    },
  });

  const lumiere = await prisma.restaurant.create({
    data: {
      id: 'rest-lumiere',
      name: 'بيسترو لوميير الفرنسي',
      nameEn: 'Bistro Lumière Haute Cuisine',
      slug: 'lumiere',
      logoUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=200&q=80',
      coverImageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=85',
      description: 'المطبخ الفرنسي الكلاسيكي بلمسة عصرية معتقة وتشكيلة استثنائية من المعجنات الباريسية.',
      phone: '+970 599 222 333',
      address: 'برج الأوركيد، الطابق 18، الكورنيش الشمالي',
      currency: '₪',
      language: 'ar',
      timezone: 'Asia/Jerusalem',
      status: 'ACTIVE',
      primaryColor: '#E2B874',
      accentColor: '#9C7A4A',
      planId: 'plan-enterprise',
    },
  });

  const alnakheel = await prisma.restaurant.create({
    data: {
      id: 'rest-alnakheel',
      name: 'قصر النخيل للمأكولات الشرقية',
      nameEn: 'Al Nakheel Palace',
      slug: 'alnakheel',
      logoUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=200&q=80',
      coverImageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1600&q=85',
      description: 'أصالة المذاق الشرقي والشواء على الحطب في أجواء أندلسية ساحرة.',
      phone: '+970 599 444 555',
      address: 'طريق التلال، حي الياسمين',
      currency: '₪',
      language: 'ar',
      timezone: 'Asia/Jerusalem',
      status: 'ACTIVE',
      primaryColor: '#059669',
      accentColor: '#10B981',
      planId: 'plan-starter',
    },
  });

  // 4. Subscriptions
  await prisma.subscription.createMany({
    data: [
      {
        id: 'sub-merar-01',
        restaurantId: 'rest-merar',
        planId: 'plan-pro',
        status: 'ACTIVE',
        currentPeriodStart: new Date('2026-08-01'),
        currentPeriodEnd: new Date('2026-09-01'),
        cancelAtPeriodEnd: false,
      },
      {
        id: 'sub-lumiere-01',
        restaurantId: 'rest-lumiere',
        planId: 'plan-enterprise',
        status: 'ACTIVE',
        currentPeriodStart: new Date('2026-08-01'),
        currentPeriodEnd: new Date('2026-09-01'),
        cancelAtPeriodEnd: false,
      },
      {
        id: 'sub-alnakheel-01',
        restaurantId: 'rest-alnakheel',
        planId: 'plan-starter',
        status: 'TRIAL',
        currentPeriodStart: new Date('2026-08-20'),
        currentPeriodEnd: new Date('2026-09-03'),
        trialEndsAt: new Date('2026-09-03'),
        cancelAtPeriodEnd: false,
      },
    ],
  });

  // 5. Users with Bcrypt Hashes
  const superAdminHash = bcrypt.hashSync('Admin@123456', 10);
  const merarManagerHash = bcrypt.hashSync('Merar@123456', 10);
  const lumiereManagerHash = bcrypt.hashSync('Lumiere@123456', 10);
  const alnakheelManagerHash = bcrypt.hashSync('Nakheel@123456', 10);

  await prisma.restaurantUser.createMany({
    data: [
      {
        id: 'user-superadmin',
        restaurantId: null,
        name: 'طارق عبد الله (مدير المنصة)',
        email: 'admin@merar-saas.com',
        passwordHash: superAdminHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
      {
        id: 'user-manager-merar',
        restaurantId: 'rest-merar',
        name: 'عمر القاسم (مدير مطعم مِيرار)',
        email: 'manager@merar-dining.com',
        passwordHash: merarManagerHash,
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
      },
      {
        id: 'user-manager-lumiere',
        restaurantId: 'rest-lumiere',
        name: 'سارة لوروا (مديرة بيسترو لوميير)',
        email: 'manager@bistro-lumiere.com',
        passwordHash: lumiereManagerHash,
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
      },
      {
        id: 'user-manager-alnakheel',
        restaurantId: 'rest-alnakheel',
        name: 'محمود الصادق (مدير قصر النخيل)',
        email: 'manager@alnakheel.com',
        passwordHash: alnakheelManagerHash,
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
      },
    ],
  });

  // 6. 50 Tables for MÉRAR with unique secure QR tokens
  const merarTablesData = Array.from({ length: 50 }, (_, i) => {
    const num = i + 1;
    let zone: 'MAIN_HALL' | 'TERRACE' | 'VIP_LOUNGE' | 'GARDEN' = 'MAIN_HALL';
    if (num > 20 && num <= 32) zone = 'TERRACE';
    else if (num > 32 && num <= 42) zone = 'VIP_LOUNGE';
    else if (num > 42) zone = 'GARDEN';

    let capacity = 4;
    if (zone === 'VIP_LOUNGE') capacity = 6;
    else if (zone === 'TERRACE' && num % 2 === 0) capacity = 2;
    else if (zone === 'GARDEN') capacity = 8;

    const numStr = num < 10 ? `0${num}` : `${num}`;

    return {
      id: `TABLE-${numStr}`,
      restaurantId: 'rest-merar',
      number: num,
      name: `طاولة ${numStr}`,
      capacity,
      zone,
      status: (num === 12 ? 'OCCUPIED' : num === 8 ? 'OCCUPIED' : 'AVAILABLE') as any,
      qrToken: `merar-qr-token-table-${numStr}-${Math.random().toString(36).substr(2, 8)}`,
      hasWaiterCall: false,
    };
  });

  await prisma.table.createMany({ data: merarTablesData });

  // 15 Tables for Lumière
  const lumiereTablesData = Array.from({ length: 15 }, (_, i) => {
    const num = i + 1;
    const numStr = num < 10 ? `0${num}` : `${num}`;
    return {
      id: `LUM-TABLE-${numStr}`,
      restaurantId: 'rest-lumiere',
      number: num,
      name: `Table ${numStr}`,
      capacity: num % 2 === 0 ? 4 : 2,
      zone: (num <= 8 ? 'MAIN_HALL' : 'TERRACE') as any,
      status: (num === 3 ? 'OCCUPIED' : 'AVAILABLE') as any,
      qrToken: `lumiere-qr-token-table-${numStr}-${Math.random().toString(36).substr(2, 8)}`,
      hasWaiterCall: false,
    };
  });

  await prisma.table.createMany({ data: lumiereTablesData });

  // 7. Categories for MÉRAR
  for (const cat of INITIAL_CATEGORIES) {
    await prisma.category.create({
      data: {
        id: cat.id,
        restaurantId: 'rest-merar',
        name: cat.name,
        nameEn: cat.nameEn,
        sortOrder: cat.sortOrder,
        status: 'ACTIVE',
      },
    });
  }

  // Categories for Lumière
  await prisma.category.createMany({
    data: [
      {
        id: 'cat-lum-entrees',
        restaurantId: 'rest-lumiere',
        name: 'المقبلات الفرنسية (Entrées)',
        nameEn: 'French Entrées',
        sortOrder: 1,
      },
      {
        id: 'cat-lum-plats',
        restaurantId: 'rest-lumiere',
        name: 'الأطباق الباريسية الكلاسيكية',
        nameEn: 'Plats Principaux',
        sortOrder: 2,
      },
      {
        id: 'cat-lum-desserts',
        restaurantId: 'rest-lumiere',
        name: 'معجنات وحلويات لوميير',
        nameEn: 'Pâtisserie & Desserts',
        sortOrder: 3,
      },
    ],
  });

  // 8. Products for MÉRAR (32+ items)
  for (const p of INITIAL_PRODUCTS) {
    const createdProduct = await prisma.product.create({
      data: {
        id: p.id,
        restaurantId: 'rest-merar',
        categoryId: p.categoryId,
        name: p.name,
        nameEn: p.nameEn,
        description: p.description,
        price: p.price,
        imageUrl: p.image,
        available: p.isAvailable,
        isFeatured: p.isFeatured || false,
        badge: p.badge,
        preparationTimeMinutes: p.preparationTimeMinutes || 15,
        calories: p.calories || 450,
        allergens: p.allergens || [],
        ingredients: p.ingredients || [],
        removableIngredients: p.removableIngredients || p.ingredients || [],
      },
    });

    if (p.sizes && p.sizes.length > 0) {
      await prisma.productOption.createMany({
        data: p.sizes.map((s) => ({
          productId: createdProduct.id,
          name: s.name,
          nameEn: s.nameEn,
          priceModifier: s.priceModifier || s.price || 0,
          price: s.price || s.priceModifier || 0,
        })),
      });
    }

    if (p.addOns && p.addOns.length > 0) {
      await prisma.addOn.createMany({
        data: p.addOns.map((a) => ({
          productId: createdProduct.id,
          name: a.name,
          nameEn: a.nameEn,
          price: a.price,
          isAvailable: true,
        })),
      });
    }
  }

  // Products for Lumière
  const lumP1 = await prisma.product.create({
    data: {
      id: 'prod-lum-1',
      restaurantId: 'rest-lumiere',
      categoryId: 'cat-lum-entrees',
      name: 'حلزون بورغوني بالزبدة والثوم المعتق',
      nameEn: 'Escargots de Bourgogne',
      description: 'حلزون فرنسي بري مطهو ببطء في زبدة الأعشاب الطازجة، ثوم شالوت، وبقدونس فرنسي مع خبز الباغيت المحمص.',
      price: 65,
      imageUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
      available: true,
      isFeatured: true,
      badge: 'كلاسيك فرنسي',
      preparationTimeMinutes: 12,
      calories: 380,
    },
  });

  const lumP2 = await prisma.product.create({
    data: {
      id: 'prod-lum-2',
      restaurantId: 'rest-lumiere',
      categoryId: 'cat-lum-plats',
      name: 'ستيك فريت أنتركوت بصلصة لوميير السرية',
      nameEn: 'Entrecôte Steak Frites',
      description: 'قطعة أنتركوت فرنسية مشوية لدرجة الكمال مع صوص الأعشاب والزبدة الخاص بمطعمنا، وبطاطا مقلية مقرمشة يدوية.',
      price: 130,
      imageUrl: 'https://images.unsplash.com/photo-1600891964092-4316c288032e?auto=format&fit=crop&w=800&q=80',
      available: true,
      isFeatured: true,
      badge: 'توقيع لوميير',
      preparationTimeMinutes: 20,
      calories: 820,
    },
  });

  const lumP3 = await prisma.product.create({
    data: {
      id: 'prod-lum-3',
      restaurantId: 'rest-lumiere',
      categoryId: 'cat-lum-desserts',
      name: 'كريم بروليه بالفانيليا المدغشقرية الأصلية',
      nameEn: 'Classic Vanilla Bean Crème Brûlée',
      description: 'كاسترد مخملي ناعم مغطى بطبقة سكر مكرملة مقرمشة محروقة أمامك مباشرة.',
      price: 42,
      imageUrl: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=800&q=80',
      available: true,
      isFeatured: false,
      preparationTimeMinutes: 8,
      calories: 390,
    },
  });

  // 9. Offers
  for (const o of INITIAL_OFFERS) {
    await prisma.offer.create({
      data: {
        id: o.id,
        restaurantId: 'rest-merar',
        title: o.title,
        titleEn: o.titleEn,
        subtitle: o.subtitle,
        description: o.description || o.subtitle || o.title,
        image: o.image,
        discountedPrice: o.discountedPrice,
        originalPrice: o.originalPrice,
        badge: o.badge || 'عرض خاص',
        isActive: o.isActive,
      },
    });
  }

  // 10. Seed Orders for MÉRAR
  const order1 = await prisma.order.create({
    data: {
      id: '#1025',
      restaurantId: 'rest-merar',
      tableId: 'TABLE-12',
      status: 'PENDING',
      paymentMethod: 'PAY AT CASHIER',
      notes: 'الرجاء تقديم البيتزا ساخنة جداً مع الفلفل الإضافي',
      subtotal: 102,
      total: 102,
      estimatedPrepMinutes: 15,
      items: {
        create: [
          {
            productId: 'prod-piz-1',
            productNameSnapshot: 'بيتزا الكمأة السوداء وبوراتا كابري',
            productNameEnSnapshot: 'Black Truffle & Burrata Pizza',
            priceSnapshot: 74,
            quantity: 1,
            totalPrice: 74,
            selectedAddOns: ['جبنة بوراتا طازجة إضافية (+₪18)'],
          },
          {
            productId: 'prod-mock-1',
            productNameSnapshot: 'موكتيل اللافندر والليمون المعتق',
            productNameEnSnapshot: 'Lavender Fizz',
            priceSnapshot: 28,
            quantity: 1,
            totalPrice: 28,
          },
        ],
      },
    },
  });

  const order2 = await prisma.order.create({
    data: {
      id: '#1024',
      restaurantId: 'rest-merar',
      tableId: 'TABLE-12',
      status: 'PREPARING',
      paymentMethod: 'PAY AT CASHIER',
      notes: 'درجة استواء الستيك ميديوم-ويل (Medium-Well)',
      subtotal: 193,
      total: 193,
      estimatedPrepMinutes: 20,
      items: {
        create: [
          {
            productId: 'prod-sig-1',
            productNameSnapshot: 'تندرلوين بلاك أنغوس المعتق بالترفل',
            productNameEnSnapshot: 'Aged Black Angus Tenderloin',
            priceSnapshot: 135,
            quantity: 1,
            totalPrice: 135,
            selectedSize: '250 غرام',
          },
          {
            productId: 'prod-app-1',
            productNameSnapshot: 'سلطة البوراتا الإيطالية مع التين المكرمل',
            productNameEnSnapshot: 'Italian Burrata Salad',
            priceSnapshot: 58,
            quantity: 1,
            totalPrice: 58,
          },
        ],
      },
    },
  });

  // Seed Order for Lumière
  await prisma.order.create({
    data: {
      id: '#2001',
      restaurantId: 'rest-lumiere',
      tableId: 'LUM-TABLE-03',
      status: 'PREPARING',
      paymentMethod: 'PAY AT CASHIER',
      notes: 'الرجاء طهي الستيك ميديوم',
      subtotal: 172,
      total: 172,
      estimatedPrepMinutes: 18,
      items: {
        create: [
          {
            productId: 'prod-lum-2',
            productNameSnapshot: 'ستيك فريت أنتركوت بصلصة لوميير',
            productNameEnSnapshot: 'Entrecôte Steak Frites',
            priceSnapshot: 130,
            quantity: 1,
            totalPrice: 130,
          },
          {
            productId: 'prod-lum-3',
            productNameSnapshot: 'كريم بروليه بالفانيليا المدغشقرية',
            productNameEnSnapshot: 'Crème Brûlée',
            priceSnapshot: 42,
            quantity: 1,
            totalPrice: 42,
          },
        ],
      },
    },
  });

  // 11. Initial Audit Logs
  await prisma.auditLog.create({
    data: {
      restaurantId: 'rest-merar',
      actor: 'عمر القاسم (مدير المطعم)',
      actorRole: 'RESTAURANT_MANAGER',
      action: 'INITIAL_SYSTEM_BOOT',
      details: 'تمت تهيئة وتشغيل نظام إدارة مطعم مِيرار الفاخر وقاعدة بيانات PostgreSQL بنجاح',
    },
  });

  console.log('✅ PostgreSQL Database successfully seeded with 3 tenants, 65 tables, 35+ products, orders, and plans!');
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
