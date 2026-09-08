/**
 * مطعم تسويقي كامل — يجعل الذكاء الاصطناعي يراه مطعماً حقيقياً
 * Seed a complete, production-realistic restaurant with full menu for marketing / AI indexing.
 *
 * الاستخدام:
 *   npx tsx server/db/seed-marketing-restaurant.ts
 *   # أو مع متغيرات مخصصة:
 *   RESTAURANT_SLUG=qasr-al-mazaq RESTAURANT_NAME="قصر المذاق" npx tsx server/db/seed-marketing-restaurant.ts
 *
 * المتطلبات:
 *   - DATABASE_URL في .env
 *   - جدول Plan موجود (شغّل npx tsx server/db/seed.ts أولاً إن لم يكن)
 *
 * النتيجة:
 *   مطعم ACTIVE كامل: 6 تصنيفات + 34 صنف + 22 طاولة (4 مناطق) + عروض + اشتراك PRO + مدير
 *   — يظهر في /r/qasr-al-mazaq وللذكاء الاصطناعي كـ مطعم حقيقي 100%
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
dotenv.config();

import { prisma } from './prisma';
import { generateQrToken } from '../utils/security';

// ── قابل للتخصيص عبر ENV ──────────────────────────────────────────
const SLUG = (process.env.RESTAURANT_SLUG || 'qasr-al-mazaq').toLowerCase().trim();
const REST_ID = `rest-${SLUG}`;
const MANAGER_EMAIL = (process.env.MARKETING_MANAGER_EMAIL || `manager@${SLUG}.com`).toLowerCase();
const MANAGER_PASSWORD = process.env.MARKETING_MANAGER_PASSWORD || 'Qasr taste 2026@Secure!'; // يجتاز COMMON_PASSWORDS + 12 حرف
const MANAGER_NAME = process.env.MARKETING_MANAGER_NAME || 'مدير قصر المذاق';

// بيانات المطعم — مُحسّنة للـ SEO والذكاء الاصطناعي
const RESTAURANT = {
  id: REST_ID,
  name: process.env.RESTAURANT_NAME || 'مطعم قصر المذاق الفاخر',
  nameEn: process.env.RESTAURANT_NAME_EN || 'Qasr Al-Mazaq Luxury Restaurant',
  slug: SLUG,
  description:
    'مطعم قصر المذاق في رام الله — تجربة ضيافة فلسطينية فاخرة منذ 2015. مشاوي على الفحم، مقبلات شرقية، بيتزا حطب، وحلويات نابلسية أصيلة. طاولة احجز عبر QR المطبوع، اطلب من الجوال بدون تطبيق، والدفع عند الكاشير. مفتوح يومياً 11ص–1ص. توصيل غير متاح — تجربة مطعمية فقط.',
  phone: '+970 599 123 456',
  address: 'شارع الإرسال، رام الله، فلسطين — بجانب مسجد جمال عبد الناصر',
  currency: '₪',
  language: 'ar',
  timezone: 'Asia/Jerusalem',
  primaryColor: '#C9A86A',
  accentColor: '#1A3A4A',
  logoUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=300&q=80',
  coverImageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1600&q=85',
  status: 'ACTIVE' as const,
  planId: 'plan-pro',
};

// ── 6 تصنيفات ─────────────────────────────────────────────────────
const CATEGORIES = [
  { name: 'المقبلات', nameEn: 'Appetizers', sortOrder: 1 },
  { name: 'المشاوي واللحوم', nameEn: 'Grills & Meats', sortOrder: 2 },
  { name: 'الشاورما والبرجر', nameEn: 'Shawarma & Burgers', sortOrder: 3 },
  { name: 'البيتزا والمعجنات', nameEn: 'Pizza & Pastries', sortOrder: 4 },
  { name: 'الحلويات الشرقية', nameEn: 'Oriental Desserts', sortOrder: 5 },
  { name: 'المشروبات', nameEn: 'Beverages', sortOrder: 6 },
] as const;

// ── 34 صنف — كل صنف له وصف SEO + سعر + صورة حقيقية + سعرات ─────
type SeedProduct = {
  categoryName: string;
  name: string; nameEn: string; description: string;
  price: number; imageUrl: string; calories?: number;
  preparationTimeMinutes?: number; isFeatured?: boolean; badge?: string;
  ingredients?: string[]; allergens?: string[];
};

const PRODUCTS: SeedProduct[] = [
  // المقبلات 6
  { categoryName: 'المقبلات', name: 'حمص قصر المذاق', nameEn: 'House Hummus', description: 'حمص حبّ بلدي مطحون يومياً بطحينة نابلسية وزيت زيتون بكر فلسطيني، يقدم مع خبز طابون ساخن.', price: 22, imageUrl: 'https://images.unsplash.com/photo-1574484284002-952d92456975?auto=format&fit=crop&w=800&q=80', calories: 320, preparationTimeMinutes: 8, isFeatured: true, ingredients: ['حمص','طحينة','ليمون','زيت زيتون'], allergens: ['سمسم'] },
  { categoryName: 'المقبلات', name: 'متبل باذنجان مشوي', nameEn: 'Smoky Mutabbal', description: 'باذنجان مشوي على الفحم مع لبن وطحينة ورمان.', price: 24, imageUrl: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80', calories: 280, preparationTimeMinutes: 10 },
  { categoryName: 'المقبلات', name: 'تبولة لبنانية', nameEn: 'Lebanese Tabbouleh', description: 'بقدونس وبرغل ناعم وطماطم ونعناع بدبس رمان.', price: 20, imageUrl: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=800&q=80', calories: 180, preparationTimeMinutes: 7 },
  { categoryName: 'المقبلات', name: 'كبة مقلية (4 قطع)', nameEn: 'Fried Kibbeh (4 pcs)', description: 'كبة برغل محشوة لحم وصنوبر مقلية ذهبية.', price: 28, imageUrl: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=800&q=80', calories: 520, preparationTimeMinutes: 12, badge: 'الأكثر طلباً' },
  { categoryName: 'المقبلات', name: 'ورق عنب بزيت الزيتون', nameEn: 'Vine Leaves', description: 'ورق عنب محشي أرز وخضار بزيت زيتون عصرة أولى.', price: 26, imageUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&q=80', calories: 260, preparationTimeMinutes: 9 },
  { categoryName: 'المقبلات', name: 'سلة خبز طابون', nameEn: 'Taboon Bread Basket', description: 'خبز طابون فلسطيني مخبوز في الفرن الحجري.', price: 12, imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80', calories: 380, preparationTimeMinutes: 5 },
  // مشاوي 7
  { categoryName: 'المشاوي واللحوم', name: 'مشاوي مشكلة لشخصين', nameEn: 'Mixed Grill for Two', description: 'كباب، شقف، شيش طاووق، ريش غنم على الفحم مع أرز بسمتي ومقبلات.', price: 145, imageUrl: 'https://images.unsplash.com/photo-1558030006-450066393d65?auto=format&fit=crop&w=800&q=80', calories: 1450, preparationTimeMinutes: 22, isFeatured: true, badge: 'سيجنتشر' },
  { categoryName: 'المشاوي واللحوم', name: 'ريش غنم (500غ)', nameEn: 'Lamb Chops 500g', description: 'ريش غنم بلدي متبل 12 ساعة مشوي على الجمر.', price: 165, imageUrl: 'https://images.unsplash.com/photo-1546964053-d2934a19706e?auto=format&fit=crop&w=800&q=80', calories: 980, preparationTimeMinutes: 25 },
  { categoryName: 'المشاوي واللحوم', name: 'كباب خشخاش حار', nameEn: 'Spicy Khashkhash Kebab', description: 'كباب لحم مع فلفل حار ودبس فليفلة حلبية.', price: 58, imageUrl: 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?auto=format&fit=crop&w=800&q=80', calories: 720, preparationTimeMinutes: 18 },
  { categoryName: 'المشاوي واللحوم', name: 'شيش طاووق', nameEn: 'Shish Tawook', description: 'صدور دجاج متبلة بلبن وثوم وليمون.', price: 52, imageUrl: 'https://images.unsplash.com/photo-1532634922-8fe0b757fb13?auto=format&fit=crop&w=800&q=80', calories: 640, preparationTimeMinutes: 16 },
  { categoryName: 'المشاوي واللحوم', name: 'مسخن فلسطيني', nameEn: 'Palestinian Musakhan', description: 'دجاج محمر مع بصل وسماق وزيت زيتون على خبز طابون.', price: 68, imageUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&q=80', calories: 850, preparationTimeMinutes: 20, badge: 'تراثي' },
  { categoryName: 'المشاوي واللحوم', name: 'منسف لحم', nameEn: 'Mansaf', description: 'لحم ضأن مع جميد كركي وأرز وشوربة لبن.', price: 78, imageUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=80', calories: 1100, preparationTimeMinutes: 28 },
  { categoryName: 'المشاوي واللحوم', name: 'أوزي لحم', nameEn: 'Ouzi Lamb', description: 'أرز أوزي بالمكسرات وفخذ لحم محمر.', price: 82, imageUrl: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=800&q=80', calories: 1020, preparationTimeMinutes: 26 },
  // شاورما وبرجر 6
  { categoryName: 'الشاورما والبرجر', name: 'شاورما دجاج عربي', nameEn: 'Chicken Shawarma Arabi', description: 'شاورما دجاج بخبز عربي مع ثوم ومخلل وبطاطا.', price: 32, imageUrl: 'https://images.unsplash.com/photo-1561654791-00316c79efa8?auto=format&fit=crop&w=800&q=80', calories: 680, preparationTimeMinutes: 10 },
  { categoryName: 'الشاورما والبرجر', name: 'شاورما لحم', nameEn: 'Beef Shawarma', description: 'شاورما لحم عجل مع طحينة وبقدونس.', price: 36, imageUrl: 'https://images.unsplash.com/photo-1525183995014-b329225b9407?auto=format&fit=crop&w=800&q=80', calories: 740, preparationTimeMinutes: 10 },
  { categoryName: 'الشاورما والبرجر', name: 'برجر قصر المذاق', nameEn: 'Qasr Signature Burger', description: 'برجر لحم أنجوس 200غ مع جبنة شيدر وصوص الكمأة.', price: 48, imageUrl: 'https://images.unsplash.com/photo-1568909344668-6f14a07b56a0?auto=format&fit=crop&w=800&q=80', calories: 820, preparationTimeMinutes: 14, isFeatured: true },
  { categoryName: 'الشاورما والبرجر', name: 'برجر دجاج مقرمش', nameEn: 'Crispy Chicken Burger', description: 'صدر دجاج مقلي مقرمش مع كولسلو.', price: 38, imageUrl: 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?auto=format&fit=crop&w=800&q=80', calories: 760, preparationTimeMinutes: 12 },
  { categoryName: 'الشاورما والبرجر', name: 'فاهيتا دجاج', nameEn: 'Chicken Fajita', description: 'فاهيتا دجاج مع فلفل ألوان وبصل وصوص.', price: 42, imageUrl: 'https://images.unsplash.com/photo-1534352956036-cd81e27dd615?auto=format&fit=crop&w=800&q=80', calories: 620, preparationTimeMinutes: 13 },
  { categoryName: 'الشاورما والبرجر', name: 'زنقر برجر حار', nameEn: 'Zinger Spicy Burger', description: 'برجر زنقر حار مع هالابينو.', price: 40, imageUrl: 'https://images.unsplash.com/photo-1551782450-a2132b4ba21d?auto=format&fit=crop&w=800&q=80', calories: 780, preparationTimeMinutes: 11 },
  // بيتزا ومعجنات 7
  { categoryName: 'البيتزا والمعجنات', name: 'بيتزا مارجريتا حطب', nameEn: 'Wood-fired Margherita', description: 'عجينة حطب 48 ساعة، صوص طماطم إيطالي، موزاريلا.', price: 38, imageUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=80', calories: 860, preparationTimeMinutes: 12 },
  { categoryName: 'البيتزا والمعجنات', name: 'بيتزا بيبروني', nameEn: 'Pepperoni Pizza', description: 'بيبروني بقري مع موزاريلا إضافية.', price: 46, imageUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=80', calories: 980, preparationTimeMinutes: 13 },
  { categoryName: 'البيتزا والمعجنات', name: 'بيتزا قصر المذاق الخاصة', nameEn: 'Qasr Special Pizza', description: 'لحم مفروم، فطر، زيتون، فلفل، جبنة نابلسية.', price: 52, imageUrl: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=800&q=80', calories: 1050, preparationTimeMinutes: 14, badge: 'جديد' },
  { categoryName: 'البيتزا والمعجنات', name: 'منقوشة زعتر', nameEn: 'Zaatar Manakish', description: 'منقوشة زعتر بلدي بزيت زيتون.', price: 14, imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80', calories: 420, preparationTimeMinutes: 7 },
  { categoryName: 'البيتزا والمعجنات', name: 'منقوشة جبنة نابلسية', nameEn: 'Nabulsi Cheese Manakish', description: 'جبنة نابلسية وحبة البركة.', price: 16, imageUrl: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=800&q=80', calories: 480, preparationTimeMinutes: 7 },
  { categoryName: 'البيتزا والمعجنات', name: 'صفيحة لحم (3 قطع)', nameEn: 'Sfiha (3 pcs)', description: 'صفيحة لحم بالصنوبر بدبس رمان.', price: 28, imageUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=80', calories: 620, preparationTimeMinutes: 10 },
  { categoryName: 'البيتزا والمعجنات', name: 'فطائر سبانخ', nameEn: 'Spinach Fatayer', description: 'فطائر سبانخ وسماق وبصل.', price: 24, imageUrl: 'https://images.unsplash.com/photo-1608198093002-ad4e005484ec?auto=format&fit=crop&w=800&q=80', calories: 380, preparationTimeMinutes: 9 },
  // حلويات 4
  { categoryName: 'الحلويات الشرقية', name: 'كنافة نابلسية', nameEn: 'Nabulsi Knafeh', description: 'كنافة خشنة بجبنة نابلسية وقطر فستق حلبي.', price: 22, imageUrl: 'https://images.unsplash.com/photo-1571115177098-8ed21de65d6a?auto=format&fit=crop&w=800&q=80', calories: 520, preparationTimeMinutes: 10, isFeatured: true, badge: 'حلويات' },
  { categoryName: 'الحلويات الشرقية', name: 'بقلاوة مشكلة (6 قطع)', nameEn: 'Mixed Baklava (6 pcs)', description: 'بقلاوة فستق وكاجو وجوز بقطر خفيف.', price: 32, imageUrl: 'https://images.unsplash.com/photo-1519869325930-281384150729?auto=format&fit=crop&w=800&q=80', calories: 680, preparationTimeMinutes: 5 },
  { categoryName: 'الحلويات الشرقية', name: 'مهلبية قمر الدين', nameEn: 'Qamardeen Muhalabia', description: 'مهلبية حليب بصوص مشمش مجفف.', price: 18, imageUrl: 'https://images.unsplash.com/photo-1488477181946-64290103bb53?auto=format&fit=crop&w=800&q=80', calories: 310, preparationTimeMinutes: 6 },
  { categoryName: 'الحلويات الشرقية', name: 'أم علي بالمكسرات', nameEn: 'Umm Ali', description: 'أم علي دافئة برقائق البف باستري ومكسرات.', price: 24, imageUrl: 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=800&q=80', calories: 480, preparationTimeMinutes: 8 },
  // مشروبات 4
  { categoryName: 'المشروبات', name: 'ليموناضة نعناع', nameEn: 'Mint Lemonade', description: 'ليمون طازج ونعناع بلدي.', price: 14, imageUrl: 'https://images.unsplash.com/photo-1523371683775-8d941d48a2f5?auto=format&fit=crop&w=800&q=80', calories: 110, preparationTimeMinutes: 4 },
  { categoryName: 'المشروبات', name: 'عصير رمان طازج', nameEn: 'Fresh Pomegranate Juice', description: 'رمان معصور طازج بدون سكر مضاف.', price: 18, imageUrl: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?auto=format&fit=crop&w=800&q=80', calories: 140, preparationTimeMinutes: 4 },
  { categoryName: 'المشروبات', name: 'شاي بالنعناع', nameEn: 'Mint Tea', description: 'شاي أسود بنعناع وسكر حسب الطلب.', price: 10, imageUrl: 'https://images.unsplash.com/photo-1564890369478-c89ca64c94ea?auto=format&fit=crop&w=800&q=80', calories: 30, preparationTimeMinutes: 3 },
  { categoryName: 'المشروبات', name: 'قهوة عربية', nameEn: 'Arabic Coffee', description: 'قهوة عربية بهيل تقدم مع تمر.', price: 12, imageUrl: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=800&q=80', calories: 20, preparationTimeMinutes: 3 },
];

const OFFERS = [
  { title: 'عرض العائلة', titleEn: 'Family Feast', description: 'مشاوي مشكلة لشخصين + 2 مقبلات + كنافة مجاناً', image: 'https://images.unsplash.com/photo-1558030006-450066393d65?auto=format&fit=crop&w=800&q=80', originalPrice: 195, discountedPrice: 149, discountPercentage: 24, badge: 'الأكثر مبيعاً' },
  { title: 'غداء العمل', titleEn: 'Business Lunch', description: 'شاورما أو برجر + بطاطا + مشروب بـ 42₪ فقط (12ظ–4ع)', image: 'https://images.unsplash.com/photo-1568909344668-6f14a07b56a0?auto=format&fit=crop&w=800&q=80', originalPrice: 58, discountedPrice: 42, discountPercentage: 28, badge: 'عرض يومي' },
];

async function main() {
  console.log(`\n🍽️  Seeding marketing restaurant: ${RESTAURANT.name} (${SLUG}) ...\n`);

  // 1. تأكد من الخطط
  const plan = await prisma.plan.findUnique({ where: { id: RESTAURANT.planId } });
  if (!plan) {
    console.error(`❌ Plan ${RESTAURANT.planId} غير موجود. شغّل أولاً: npx tsx server/db/seed.ts`);
    process.exit(1);
  }

  // 2. تحقق إن كان المطعم موجوداً — حدّثه بدل إنشاء مكرر
  const existing = await prisma.restaurant.findUnique({ where: { slug: SLUG } });
  if (existing) {
    console.log(`⚠️  المطعم ${SLUG} موجود مسبقاً (id=${existing.id}) — سيتم تحديثه وإعادة تعبئة المنيو.`);
    // احذف بياناته لإعادة التعبئة النظيفة (داخل transaction لاحقاً)
  }

  // 3. كلمة مرور قوية (تجتاز COMMON_PASSWORDS)
  if (MANAGER_PASSWORD.length < 12) {
    console.warn('⚠️  كلمة المرور أقل من 12 حرفاً — استخدم واحدة أقوى لتجتاز التحقق.');
  }

  const passwordHash = await bcrypt.hash(MANAGER_PASSWORD, 12);

  // 4. Transaction كاملة — إما الكل أو لا شيء
  const restaurant = await prisma.$transaction(async (tx) => {
    // حذف سابق إن وجد (cascade يحذف كل شيء لكن نفعله صراحة لنظافة الـ ids)
    if (existing) {
      await tx.restaurant.delete({ where: { id: existing.id } });
    }

    const r = await tx.restaurant.create({ data: RESTAURANT });

    await tx.subscription.create({
      data: {
        restaurantId: r.id,
        planId: RESTAURANT.planId!,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000),
      },
    });

    await tx.restaurantUser.create({
      data: {
        restaurantId: r.id,
        name: MANAGER_NAME,
        email: MANAGER_EMAIL,
        passwordHash,
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
      },
    });

    // طاولات 22 موزعة على 4 مناطق
    const zones: Array<'MAIN_HALL' | 'TERRACE' | 'VIP_LOUNGE' | 'GARDEN'> = ['MAIN_HALL','TERRACE','VIP_LOUNGE','GARDEN'];
    const tablesData = Array.from({ length: 22 }, (_, i) => {
      const num = i + 1;
      return {
        id: `${r.id}-T${String(num).padStart(2,'0')}`,
        restaurantId: r.id,
        number: num,
        name: `طاولة ${String(num).padStart(2,'0')}`,
        capacity: num <= 4 ? 2 : num <= 16 ? 4 : 6,
        zone: zones[i % zones.length]!,
        status: 'AVAILABLE' as const,
        qrToken: generateQrToken(),
      };
    });
    await tx.table.createMany({ data: tablesData });

    // تصنيفات + منتجات
    const catIdByName = new Map<string,string>();
    for (const c of CATEGORIES) {
      const cat = await tx.category.create({
        data: { restaurantId: r.id, name: c.name, nameEn: c.nameEn, sortOrder: (c as any).sortOrder },
      });
      catIdByName.set(c.name, cat.id);
    }
    for (const [idx, p] of PRODUCTS.entries()) {
      const catId = catIdByName.get(p.categoryName);
      if (!catId) throw new Error(`Category not found: ${p.categoryName}`);
      await tx.product.create({
        data: {
          restaurantId: r.id,
          categoryId: catId,
          name: p.name,
          nameEn: p.nameEn,
          description: p.description,
          price: p.price,
          imageUrl: p.imageUrl,
          available: true,
          isFeatured: p.isFeatured ?? false,
          badge: p.badge ?? null,
          preparationTimeMinutes: p.preparationTimeMinutes ?? 15,
          calories: p.calories ?? null,
          allergens: (p.allergens as any) ?? [],
          ingredients: (p.ingredients as any) ?? [],
          sortOrder: idx,
        },
      });
    }

    for (const o of OFFERS) {
      await tx.offer.create({
        data: {
          restaurantId: r.id,
          title: o.title,
          titleEn: o.titleEn,
          description: o.description,
          image: o.image,
          originalPrice: o.originalPrice,
          discountedPrice: o.discountedPrice,
          discountPercentage: o.discountPercentage,
          badge: o.badge,
          isActive: true,
        },
      });
    }

    return r;
  });

  console.log(`\n✅ تم إنشاء المطعم بنجاح!`);
  console.log(`   الاسم: ${restaurant.name} (${restaurant.nameEn})`);
  console.log(`   الرابط: /r/${restaurant.slug}  →  https://yourdomain.com/r/${restaurant.slug}`);
  console.log(`   الـ ID: ${restaurant.id}`);
  console.log(`   المدير: ${MANAGER_NAME} <${MANAGER_EMAIL}>  كلمة المرور: ${MANAGER_PASSWORD}`);
  console.log(`   المنيو: ${CATEGORIES.length} تصنيفات + ${PRODUCTS.length} صنف + ${OFFERS.length} عروض`);
  console.log(`   الطاولات: 22 طاولة (QR جاهزة للطباعة)`);
  console.log(`\n🔑 تسجيل دخول المدير:`);
  console.log(`   POST /api/auth/login  { \"email\": \"${MANAGER_EMAIL}\", \"password\": \"${MANAGER_PASSWORD}\" }`);
  console.log(`\n📱 رابط العميل (QR): https://yourdomain.com/r/${restaurant.slug}?qr=<qrToken من جدول Table>`);
  console.log(`\n🤖 للذكاء الاصطناعي / SEO: المطعم الآن ACTIVE وقابل للفهرسة — كل الأصناف لها وصف عربي+إنجليزي وصور https وأسعار.`);
  console.log(`   بدّل الدومين في APP_URL و CORS_ORIGIN ثم أعد النشر.\n`);
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
