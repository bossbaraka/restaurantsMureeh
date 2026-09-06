import {
  Restaurant,
  Plan,
  Subscription,
  RestaurantUser,
  Category,
  Product,
  RestaurantTable,
  Order,
  WaiterRequest,
  Offer,
  AuditLog,
  PaymentRecord,
  Branch,
} from '../types/restaurant';
import { INITIAL_CATEGORIES, INITIAL_PRODUCTS, INITIAL_OFFERS } from './sampleMenu';
import { INITIAL_TABLES } from './sampleTables';
import { INITIAL_ORDERS, INITIAL_WAITER_REQUESTS } from './sampleOrders';

// ==========================================
// 1. SAAS SUBSCRIPTION PLANS
// ==========================================
export const SEED_PLANS: Plan[] = [
  {
    id: 'plan-starter',
    name: 'الباقة الأساسية',
    nameEn: 'Starter Plan',
    priceMonthly: 149,
    priceYearly: 1490,
    maxTables: 15,
    maxCategories: 6,
    maxProducts: 35,
    entitlements: ['CAN_USE_ADVANCED_FEATURES'],
    description: 'مثالية للمطاعم الصغيرة والكافيهات التي تبدأ رحلة المنيو الرقمي والطلب الذكي.',
  },
  {
    id: 'plan-pro',
    name: 'باقة المحترفين الفاخرة',
    nameEn: 'Professional Hospitality',
    priceMonthly: 349,
    priceYearly: 3490,
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
  },
];

// ==========================================
// 2. SEED RESTAURANTS / TENANTS
// ==========================================
export const SEED_RESTAURANTS: Restaurant[] = [
  {
    id: 'rest-merar',
    name: 'مطعم مِيرار الفاخر',
    nameEn: 'MÉRAR Luxury Dining & Lounge',
    slug: 'merar',
    logo: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=200&q=80',
    coverImage: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85',
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
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'rest-lumiere',
    name: 'بيسترو لوميير الفرنسي',
    nameEn: 'Bistro Lumière Haute Cuisine',
    slug: 'lumiere',
    logo: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=200&q=80',
    coverImage: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=85',
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
    createdAt: '2026-02-01T12:00:00.000Z',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'rest-alnakheel',
    name: 'قصر النخيل للمأكولات الشرقية',
    nameEn: 'Al Nakheel Palace',
    slug: 'alnakheel',
    logo: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=200&q=80',
    coverImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1600&q=85',
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
    createdAt: '2026-02-15T09:00:00.000Z',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'rest-demo-promo',
    name: 'مطعم ميرار التجريبي',
    nameEn: 'MÉRAR Promotional Demo Restaurant',
    slug: 'merar-demo',
    logo: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=200&q=80',
    coverImage: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=85',
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
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  },
];

// ==========================================
// 3. SEED SUBSCRIPTIONS
// ==========================================
export const SEED_SUBSCRIPTIONS: Subscription[] = [
  {
    id: 'sub-merar-01',
    restaurantId: 'rest-merar',
    planId: 'plan-enterprise',
    status: 'ACTIVE',
    currentPeriodStart: '2026-08-01T00:00:00.000Z',
    currentPeriodEnd: '2027-06-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
  },
  {
    id: 'sub-lumiere-01',
    restaurantId: 'rest-lumiere',
    planId: 'plan-enterprise',
    status: 'ACTIVE',
    currentPeriodStart: '2026-08-01T00:00:00.000Z',
    currentPeriodEnd: '2027-06-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
  },
  {
    id: 'sub-alnakheel-01',
    restaurantId: 'rest-alnakheel',
    planId: 'plan-starter',
    status: 'TRIAL',
    currentPeriodStart: '2026-08-20T00:00:00.000Z',
    currentPeriodEnd: '2026-09-03T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    trialEndsAt: '2026-09-03T00:00:00.000Z',
  },
  {
    id: 'sub-demo-promo',
    restaurantId: 'rest-demo-promo',
    planId: 'plan-enterprise',
    status: 'ACTIVE',
    currentPeriodStart: '2026-09-02T00:00:00.000Z',
    currentPeriodEnd: '2027-09-02T00:00:00.000Z',
    cancelAtPeriodEnd: false,
  },
];

// ==========================================
// 4. SEED USERS & ROLES
// ==========================================
export const SEED_USERS: RestaurantUser[] = [
  {
    id: 'user-superadmin',
    restaurantId: null,
    name: 'طارق عبد الله (مدير المنصة)',
    email: 'admin@merar-saas.com',
    role: 'SUPER_ADMIN',
    token: 'jwt-super-admin-token-xyz',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'user-manager-merar',
    restaurantId: 'rest-merar',
    name: 'عمر القاسم (مدير مطعم مِيرار)',
    email: 'manager@merar-dining.com',
    role: 'RESTAURANT_MANAGER',
    token: 'jwt-merar-manager-token-abc',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80',
    createdAt: '2026-01-10T10:00:00.000Z',
  },
  {
    id: 'user-manager-lumiere',
    restaurantId: 'rest-lumiere',
    name: 'سارة لوروا (مديرة بيسترو لوميير)',
    email: 'manager@bistro-lumiere.com',
    role: 'RESTAURANT_MANAGER',
    token: 'jwt-lumiere-manager-token-def',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=120&q=80',
    createdAt: '2026-02-01T12:00:00.000Z',
  },
  {
    id: 'user-manager-alnakheel',
    restaurantId: 'rest-alnakheel',
    name: 'مدير قصر النخيل',
    email: 'manager@alnakheel-palace.com',
    role: 'RESTAURANT_MANAGER',
    token: 'jwt-alnakheel-manager-token-ghi',
    createdAt: '2026-02-15T09:00:00.000Z',
  },
  {
    id: 'user-demo-manager',
    restaurantId: 'rest-demo-promo',
    name: 'مدير المطعم التجريبي',
    email: 'demo.manager@merar-promo.com',
    role: 'RESTAURANT_MANAGER',
    token: 'jwt-demo-manager-token',
    createdAt: '2026-09-02T00:00:00.000Z',
  },
];

// ==========================================
// 5. SEED CATEGORIES (Mapped with restaurantId)
// ==========================================
export const SEED_CATEGORIES: Category[] = [
  // MÉRAR Categories
  ...INITIAL_CATEGORIES.map((c) => ({
    ...c,
    restaurantId: 'rest-merar',
  })),

  // LUMIÈRE French Categories
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

  // AL NAKHEEL Eastern Categories
  {
    id: 'cat-nakheel-grills',
    restaurantId: 'rest-alnakheel',
    name: 'المشاوي الشرقية',
    nameEn: 'Eastern Grills',
    sortOrder: 1,
  },
  {
    id: 'cat-nakheel-mezze',
    restaurantId: 'rest-alnakheel',
    name: 'المقبلات والسلطات',
    nameEn: 'Mezze & Salads',
    sortOrder: 2,
  },
  {
    id: 'cat-nakheel-desserts',
    restaurantId: 'rest-alnakheel',
    name: 'الحلويات والمشروبات',
    nameEn: 'Desserts & Drinks',
    sortOrder: 3,
  },

  // Promotional demo menu mirrors the full MÉRAR catalog.
  ...INITIAL_CATEGORIES.map((category) => ({
    ...category,
    id: `demo-${category.id}`,
    restaurantId: 'rest-demo-promo',
  })),
];

// ==========================================
// 6. SEED PRODUCTS (Mapped with restaurantId)
// ==========================================
export const SEED_PRODUCTS: Product[] = [
  // MÉRAR Products (32+ existing luxury items)
  ...INITIAL_PRODUCTS.map((p) => ({
    ...p,
    restaurantId: 'rest-merar',
  })),

  // LUMIÈRE French Products
  {
    id: 'prod-lum-1',
    restaurantId: 'rest-lumiere',
    categoryId: 'cat-lum-entrees',
    name: 'حلزون بورغوني بالزبدة والثوم المعتق',
    nameEn: 'Escargots de Bourgogne',
    description: 'حلزون فرنسي بري مطهو ببطء في زبدة الأعشاب الطازجة، ثوم شالوت، وبقدونس فرنسي مع خبز الباغيت المحمص.',
    price: 65,
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
    isAvailable: true,
    isFeatured: true,
    badge: 'كلاسيك فرنسي',
    preparationTimeMinutes: 12,
    calories: 380,
  },
  {
    id: 'prod-lum-2',
    restaurantId: 'rest-lumiere',
    categoryId: 'cat-lum-plats',
    name: 'ستيك فريت أنتركوت بصلصة لوميير السرية',
    nameEn: 'Entrecôte Steak Frites',
    description: 'قطعة أنتركوت فرنسية مشوية لدرجة الكمال مع صوص الأعشاب والزبدة الخاص بمطعمنا، وبطاطا مقلية مقرمشة يدوية.',
    price: 130,
    image: 'https://images.unsplash.com/photo-1600891964092-4316c288032e?auto=format&fit=crop&w=800&q=80',
    isAvailable: true,
    isFeatured: true,
    badge: 'توقيع لوميير',
    preparationTimeMinutes: 20,
    calories: 820,
  },
  {
    id: 'prod-lum-3',
    restaurantId: 'rest-lumiere',
    categoryId: 'cat-lum-desserts',
    name: 'كريم بروليه بالفانيليا المدغشقرية الأصلية',
    nameEn: 'Classic Vanilla Bean Crème Brûlée',
    description: 'كاسترد مخملي ناعم مغطى بطبقة سكر مكرملة مقرمشة محروقة أمامك مباشرة.',
    price: 42,
    image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=800&q=80',
    isAvailable: true,
    isFeatured: false,
    preparationTimeMinutes: 8,
    calories: 390,
  },

  // AL NAKHEEL Eastern Products
  {
    id: 'prod-nakheel-1',
    restaurantId: 'rest-alnakheel',
    categoryId: 'cat-nakheel-grills',
    name: 'مشاوي مشكلة على الحطب',
    nameEn: 'Charcoal Mixed Grill',
    description: 'تشكيلة من الكباب والشيش طاووق والريش المشوية على الحطب مع الخبز الطازج.',
    price: 88,
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
    isAvailable: true,
    isFeatured: true,
    badge: 'اختيار الشيف',
    preparationTimeMinutes: 22,
    calories: 760,
  },
  {
    id: 'prod-nakheel-2',
    restaurantId: 'rest-alnakheel',
    categoryId: 'cat-nakheel-mezze',
    name: 'طبق مقبلات شرقية',
    nameEn: 'Eastern Mezze Platter',
    description: 'حمص ومتبل وتبولة وورق عنب يقدم مع خبز عربي ساخن.',
    price: 42,
    image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80',
    isAvailable: true,
    isFeatured: false,
    preparationTimeMinutes: 10,
    calories: 420,
  },
  {
    id: 'prod-nakheel-3',
    restaurantId: 'rest-alnakheel',
    categoryId: 'cat-nakheel-desserts',
    name: 'كنافة نابلسية بالقشطة',
    nameEn: 'Nabulsi Kunafa',
    description: 'كنافة ذهبية محشوة بالقشطة ومزينة بالفستق الحلبي والقطر.',
    price: 28,
    image: 'https://images.unsplash.com/photo-1571115177098-24ec42ed204d?auto=format&fit=crop&w=800&q=80',
    isAvailable: true,
    isFeatured: true,
    badge: 'حلوى شرقية',
    preparationTimeMinutes: 8,
    calories: 510,
  },

  // Promotional demo products mirror the full MÉRAR catalog.
  ...INITIAL_PRODUCTS.map((product) => ({
    ...product,
    id: `demo-${product.id}`,
    restaurantId: 'rest-demo-promo',
    categoryId: `demo-${product.categoryId}`,
  })),
];

// ==========================================
// 7. SEED TABLES (Mapped with restaurantId)
// ==========================================
// Demo branch assignment for MÉRAR's flagship location (multi-branch demo):
// hall -> main branch, terrace -> terrace branch, garden -> mall counter,
// VIP lounge stays unassigned so managers can try the assignment workflow.
function withMerarBranches(tables: RestaurantTable[]): RestaurantTable[] {
  return tables.map((t) => {
    let branchId: string | undefined;
    const n = t.tableNumber;
    if (n >= 1 && n <= 20) branchId = 'branch-main';
    else if (n >= 21 && n <= 32) branchId = 'branch-terrace';
    else if (n >= 43 && n <= 50) branchId = 'branch-mall';
    return { ...t, branchId };
  });
}

export const SEED_TABLES: RestaurantTable[] = [
  // MÉRAR Tables (50 tables)
  ...withMerarBranches(INITIAL_TABLES).map((t) => ({
    ...t,
    restaurantId: 'rest-merar',
  })),

  // LUMIÈRE Tables (15 tables)
  ...Array.from({ length: 15 }, (_, i) => {
    const num = i + 1;
    const numStr = num < 10 ? `0${num}` : `${num}`;
    return {
      id: `TABLE-${numStr}`,
      restaurantId: 'rest-lumiere',
      qrToken: `rest-lumiere-qr-${numStr}-demo-token`,
      tableNumber: num,
      capacity: num % 2 === 0 ? 4 : 2,
      zone: (num <= 8 ? 'MAIN_HALL' : 'TERRACE') as RestaurantTable['zone'],
      status: (num === 3 ? 'OCCUPIED' : 'AVAILABLE') as RestaurantTable['status'],
      activeOrderIds: num === 3 ? ['#2001'] : [],
      hasWaiterCall: false,
    };
  }),

  // AL NAKHEEL Tables (20 tables)
  ...Array.from({ length: 20 }, (_, i) => {
    const num = i + 1;
    const numStr = num < 10 ? `0${num}` : `${num}`;
    return {
      id: `TABLE-${numStr}`,
      restaurantId: 'rest-alnakheel',
      qrToken: `rest-alnakheel-qr-${numStr}-demo-token`,
      tableNumber: num,
      capacity: num % 2 === 0 ? 4 : 2,
      zone: (num <= 12 ? 'MAIN_HALL' : 'TERRACE') as RestaurantTable['zone'],
      status: 'AVAILABLE' as RestaurantTable['status'],
      activeOrderIds: [],
      hasWaiterCall: false,
    };
  }),

  // Promotional demo tables with working QR links.
  ...Array.from({ length: 20 }, (_, i) => {
    const num = i + 1;
    const numStr = num < 10 ? `0${num}` : `${num}`;
    return {
      id: `TABLE-${numStr}`,
      restaurantId: 'rest-demo-promo',
      qrToken: `demo-${numStr}-qr-token`,
      tableNumber: num,
      capacity: num % 2 === 0 ? 4 : 2,
      zone: (num <= 12 ? 'MAIN_HALL' : 'TERRACE') as RestaurantTable['zone'],
      status: (num === 4 ? 'OCCUPIED' : 'AVAILABLE') as RestaurantTable['status'],
      activeOrderIds: num === 4 ? ['#DEMO-1001'] : [],
      hasWaiterCall: false,
    };
  }),
];

// ==========================================
// 8. SEED ORDERS (Mapped with restaurantId)
// ==========================================
export const SEED_ORDERS: Order[] = [
  // MÉRAR Orders
  ...INITIAL_ORDERS.map((o) => ({
    ...o,
    restaurantId: 'rest-merar',
  })),

  ...INITIAL_ORDERS.slice(0, 3).map((o, index) => ({
    ...o,
    id: `#DEMO-${1001 + index}`,
    numericId: 1001 + index,
    restaurantId: 'rest-demo-promo',
    tableId: 'TABLE-04',
  })),

  // LUMIÈRE Orders
  {
    id: '#2001',
    numericId: 2001,
    restaurantId: 'rest-lumiere',
    tableId: 'TABLE-03',
    status: 'PREPARING',
    paymentMethod: 'PAY AT CASHIER',
    notes: 'الرجاء طهي الستيك ميديوم',
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    estimatedPrepMinutes: 18,
    subtotal: 172,
    total: 172,
    items: [
      {
        id: 'ord-lum-item-1',
        productId: 'prod-lum-2',
        productName: 'ستيك فريت أنتركوت بصلصة لوميير',
        quantity: 1,
        unitPrice: 130,
        totalPrice: 130,
      },
      {
        id: 'ord-lum-item-2',
        productId: 'prod-lum-3',
        productName: 'كريم بروليه بالفانيليا المدغشقرية',
        quantity: 1,
        unitPrice: 42,
        totalPrice: 42,
      },
    ],
  },
];

// ==========================================
// 9. SEED WAITER REQUESTS & OFFERS
// ==========================================
export const SEED_WAITER_REQUESTS: WaiterRequest[] = [
  ...INITIAL_WAITER_REQUESTS.map((w) => ({
    ...w,
    restaurantId: 'rest-merar',
  })),
  {
    id: 'demo-waiter-1',
    restaurantId: 'rest-demo-promo',
    tableId: 'TABLE-04',
    reason: 'ASSISTANCE',
    reasonText: 'طلب تجربة نداء النادل',
    createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    status: 'PENDING',
  },
];

export const SEED_OFFERS: Offer[] = [
  ...INITIAL_OFFERS.map((o) => ({
    ...o,
    restaurantId: 'rest-merar',
  })),
  ...INITIAL_OFFERS.map((o) => ({
    ...o,
    id: `demo-${o.id}`,
    restaurantId: 'rest-demo-promo',
  })),
];

// ==========================================
// 10. AUDIT LOGS
// ==========================================
export const SEED_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    restaurantId: 'rest-merar',
    actor: 'عمر القاسم (مدير المطعم)',
    actorRole: 'RESTAURANT_MANAGER',
    action: 'UPDATE_MENU_ITEM',
    details: 'تحديث سعر وسريان طبق ريب آي بلاك أنغوس المعتق',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'log-2',
    restaurantId: 'rest-merar',
    actor: 'طارق عبد الله (مدير المنصة)',
    actorRole: 'SUPER_ADMIN',
    action: 'SUBSCRIPTION_RENEWAL',
    details: 'تجديد الاشتراك الشهري لباقة المحترفين الفاخرة بنجاح',
    timestamp: new Date(Date.now() - 86400000).toISOString(),
  },
];

// ==========================================
// 11. CLOSED SALES HISTORY (Paid orders + POS receipts)
// Historical demo revenue so sales analytics / instant reports
// render meaningful multi-day charts on first launch.
// ==========================================

const isoDaysAgo = (days: number, hour: number, minute = 0): string => {
  const d = new Date(Date.now() - days * 24 * 3600 * 1000);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

export const SEED_PAID_ORDER_HISTORY: Order[] = [
  {
    id: '#1051',
    numericId: 1051,
    restaurantId: 'rest-merar',
    tableId: 'TABLE-03',
    status: 'SERVED',
    paymentMethod: 'CARD',
    paymentStatus: 'PAID',
    notes: 'عشاء رومانسي',
    createdAt: isoDaysAgo(6, 20, 14),
    updatedAt: isoDaysAgo(6, 21, 42),
    settledAt: isoDaysAgo(6, 21, 42),
    estimatedPrepMinutes: 18,
    subtotal: 270,
    total: 270,
    items: [
      { id: 'hist-1-a', productId: 'prod-sig-1', productName: 'تندرلوين بلاك أنغوس المعتق بالترفل', quantity: 1, unitPrice: 135, totalPrice: 135 },
      { id: 'hist-1-b', productId: 'prod-sig-2', productName: 'سلمون نرويجي مشوي بصوص البرتقال والزعفران', quantity: 1, unitPrice: 135, totalPrice: 135 },
    ],
  },
  {
    id: '#1052',
    numericId: 1052,
    restaurantId: 'rest-merar',
    tableId: 'TABLE-11',
    status: 'SERVED',
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    createdAt: isoDaysAgo(5, 19, 30),
    updatedAt: isoDaysAgo(5, 20, 55),
    settledAt: isoDaysAgo(5, 20, 55),
    estimatedPrepMinutes: 15,
    subtotal: 205,
    total: 205,
    items: [
      { id: 'hist-2-a', productId: 'prod-main-1', productName: 'لحم غنم مشوي بالتوابل الشرقية', quantity: 1, unitPrice: 98, totalPrice: 98 },
      { id: 'hist-2-b', productId: 'prod-app-2', productName: 'مشاوي مِيرار المختلطة', quantity: 1, unitPrice: 68, totalPrice: 68 },
      { id: 'hist-2-c', productId: 'prod-app-3', productName: 'حمص بالكمأة', quantity: 1, unitPrice: 39, totalPrice: 39 },
    ],
  },
  {
    id: '#1053',
    numericId: 1053,
    restaurantId: 'rest-merar',
    tableId: 'TABLE-09',
    status: 'SERVED',
    paymentMethod: 'CARD',
    paymentStatus: 'PAID',
    createdAt: isoDaysAgo(4, 13, 5),
    updatedAt: isoDaysAgo(4, 14, 20),
    settledAt: isoDaysAgo(4, 14, 20),
    estimatedPrepMinutes: 12,
    subtotal: 156,
    total: 156,
    items: [
      { id: 'hist-3-a', productId: 'prod-sig-3', productName: 'غراتان الكمأة الإيطالي', quantity: 1, unitPrice: 118, totalPrice: 118 },
      { id: 'hist-3-b', productId: 'prod-mock-1', productName: 'عصير رمان طازج', quantity: 2, unitPrice: 19, totalPrice: 38 },
    ],
  },
  {
    id: '#1054',
    numericId: 1054,
    restaurantId: 'rest-merar',
    tableId: 'TABLE-07',
    status: 'SERVED',
    paymentMethod: 'MOBILE',
    paymentStatus: 'PAID',
    createdAt: isoDaysAgo(3, 21, 10),
    updatedAt: isoDaysAgo(3, 22, 5),
    settledAt: isoDaysAgo(3, 22, 5),
    estimatedPrepMinutes: 20,
    subtotal: 342,
    total: 342,
    items: [
      { id: 'hist-4-a', productId: 'prod-sig-1', productName: 'تندرلوين بلاك أنغوس المعتق بالترفل', quantity: 2, unitPrice: 135, totalPrice: 270 },
      { id: 'hist-4-b', productId: 'prod-des-1', productName: 'كوكو لافا بالشوكولاتة البلجيكية', quantity: 2, unitPrice: 36, totalPrice: 72 },
    ],
  },
  {
    id: '#1055',
    numericId: 1055,
    restaurantId: 'rest-merar',
    tableId: 'TABLE-33',
    status: 'SERVED',
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    createdAt: isoDaysAgo(2, 18, 45),
    updatedAt: isoDaysAgo(2, 20, 10),
    settledAt: isoDaysAgo(2, 20, 10),
    estimatedPrepMinutes: 25,
    subtotal: 470,
    total: 470,
    items: [
      { id: 'hist-5-a', productId: 'prod-sig-1', productName: 'تندرلوين بلاك أنغوس المعتق بالترفل', quantity: 1, unitPrice: 135, totalPrice: 135 },
      { id: 'hist-5-b', productId: 'prod-main-2', productName: 'ستيك ريب آي بلاك أنغوس المعتق', quantity: 1, unitPrice: 148, totalPrice: 148 },
      { id: 'hist-5-c', productId: 'prod-soup-1', productName: 'سلطة الكينوا بالأفوكادو', quantity: 1, unitPrice: 62, totalPrice: 62 },
      { id: 'hist-5-d', productId: 'prod-mock-2', productName: 'قهوة مختصة V60', quantity: 1, unitPrice: 25, totalPrice: 25 },
    ],
  },
  {
    id: '#1056',
    numericId: 1056,
    restaurantId: 'rest-merar',
    tableId: 'TABLE-01',
    status: 'SERVED',
    paymentMethod: 'CARD',
    paymentStatus: 'PAID',
    createdAt: isoDaysAgo(1, 12, 30),
    updatedAt: isoDaysAgo(1, 13, 45),
    settledAt: isoDaysAgo(1, 13, 45),
    estimatedPrepMinutes: 15,
    subtotal: 121,
    total: 121,
    items: [
      { id: 'hist-6-a', productId: 'prod-app-1', productName: 'مقبلات مِيرار الملكية', quantity: 1, unitPrice: 85, totalPrice: 85 },
      { id: 'hist-6-b', productId: 'prod-mock-1', productName: 'عصير رمان طازج', quantity: 1, unitPrice: 19, totalPrice: 19 },
      { id: 'hist-6-c', productId: 'prod-mock-3', productName: 'موهيتو بالنعناع', quantity: 1, unitPrice: 17, totalPrice: 17 },
    ],
  },
];

// POS receipts matching the closed history above (tenant isolated ledger)
export const SEED_PAYMENTS: PaymentRecord[] = SEED_PAID_ORDER_HISTORY.map((order, index) => ({
  id: `pay-seed-${index + 1}`,
  receiptNumber: `RC-${new Date().getFullYear()}-${String(1051 + index).slice(-4)}`,
  restaurantId: order.restaurantId,
  tableId: order.tableId,
  tableLabel: `طاولة ${order.tableId.replace(/^(?:TABLE-|.*-T)/, '')}`,
  orderIds: [order.id],
  itemsSummary: order.items.map((i) => i.productName).slice(0, 3).join('، '),
  method: order.paymentMethod as PaymentRecord['method'],
  subtotal: order.subtotal,
  total: order.total,
  cashReceived: order.paymentMethod === 'CASH' ? order.total : undefined,
  changeDue: 0,
  cashierName: 'ليان حداد',
  createdAt: order.settledAt || order.updatedAt,
}));

// ==========================================
// 12. MULTI-BRANCH MANAGEMENT SEEDS
// ==========================================
export const SEED_BRANCHES: Branch[] = [
  {
    id: 'branch-main',
    restaurantId: 'rest-merar',
    name: 'الفرع الرئيسي — وسط المدينة',
    color: '#D4AF37',
    isActive: true,
    createdAt: isoDaysAgo(30, 9, 0),
  },
  {
    id: 'branch-terrace',
    restaurantId: 'rest-merar',
    name: 'فرع تراس النخيل (التراس الخارجي)',
    address: 'شارع النخيل — الواجهة البحرية',
    color: '#4ADE80',
    isActive: true,
    createdAt: isoDaysAgo(21, 9, 0),
  },
  {
    id: 'branch-mall',
    restaurantId: 'rest-merar',
    name: 'كاونتر المول — الطلبات الخارجية',
    address: 'الطابق الثالث — مركز التسوق',
    color: '#60A5FA',
    isActive: true,
    createdAt: isoDaysAgo(7, 9, 0),
  },
  {
    id: 'branch-lum-main',
    restaurantId: 'rest-lumiere',
    name: 'الفرع الرئيسي — لوميير',
    color: '#F87171',
    isActive: true,
    createdAt: isoDaysAgo(30, 9, 0),
  },
];
