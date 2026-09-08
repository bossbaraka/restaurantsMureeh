import { prisma } from './prisma';
import bcrypt from 'bcryptjs';

export async function seedShoqrahCafe() {
  console.log('🌱 Seeding الشقرة كافيه | SHOQRAH CAFÉ...');

  const shoqrahData = {
    name: 'الشقرة كافيه | SHOQRAH CAFÉ',
    nameEn: 'SHOQRAH CAFÉ',
    slug: 'shoqrah',
    description: 'أفخم المشروبات والقهوة المختصة والحلويات الفريدة',
    phone: '+972 599 891 559',
    address: 'الشقرة كافيه - فلسطين',
    currency: '₪',
    primaryColor: '#9A3412',
    accentColor: '#D4AF37',
    logoUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=400&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=1200&q=80',
    categories: [
      {
        name: 'القهوة',
        nameEn: 'Coffee',
        sortOrder: 1,
        items: [
          { name: 'قهوة تركي', nameEn: 'Turkish Coffee', price: 4, desc: 'قهوة تركية أصيلة متقنة' },
          { name: 'اسبريسو', nameEn: 'Espresso', price: 6, desc: 'جرعة اسبريسو غنية ومكثفة' },
          { name: 'ماكياتو', nameEn: 'Macchiato', price: 8, desc: 'اسبريسو مع لمسة رغوة الحليب' },
          { name: 'كافي لاتيه', nameEn: 'Caffè Latte', price: 10, desc: 'اسبريسو مع حليب مبخر ورغوة' },
          { name: 'كابتشينو', nameEn: 'Cappuccino', price: 10, desc: 'توازن مثالي بين الاسبريسو والحليب' },
          { name: 'أمريكانو', nameEn: 'Americano', price: 8, desc: 'اسبريسو ممدد بالماء الساخن' },
          { name: 'كراميل ماكياتو', nameEn: 'Caramel Macchiato', price: 12, desc: 'اسبريسو مع الحليب ونكهة الكراميل الفاخرة' },
        ],
      },
      {
        name: 'مشروبات ساخنة',
        nameEn: 'Hot Drinks',
        sortOrder: 2,
        items: [
          { name: 'شاي', nameEn: 'Tea', price: 3, desc: 'شاي أحمر فاخر طازج' },
          { name: 'هوت شوكليت', nameEn: 'Hot Chocolate', price: 10, desc: 'شوكولاتة ساخنة غنية ولذيذة' },
          { name: 'هوت بيستاشيو', nameEn: 'Hot Pistachio', price: 14, desc: 'مشروب الفستق الحلبي الساخن الفاخر' },
          { name: 'هوت لوتس', nameEn: 'Hot Lotus', price: 12, desc: 'مشروب زبدة اللوتس الساخن' },
          { name: 'كافي نوتيلا', nameEn: 'Café Nutella', price: 12, desc: 'قهوة ساخنة بنكهة شوكولاتة نوتيلا' },
          { name: 'نسكافيه', nameEn: 'Nescafé', price: 6, desc: 'نسكافيه كلاسيكي ساخن' },
          { name: 'نسكافيه بالحليب', nameEn: 'Nescafé with Milk', price: 8, desc: 'نسكافيه غني بالحليب الطازج' },
          { name: 'أعشاب بالعسل', nameEn: 'Herbal Tea with Honey', price: 5, desc: 'مزيج أعشاب طبيعية مهدئة مع العسل' },
        ],
      },
      {
        name: 'عصائر طبيعية',
        nameEn: 'Fresh Juices',
        sortOrder: 3,
        items: [
          { name: 'مانجا', nameEn: 'Mango Juice', price: 10, desc: 'عصير مانجو طبيعي منعش' },
          { name: 'فراولة', nameEn: 'Strawberry Juice', price: 10, desc: 'عصير فراولة طبيعي طازج' },
          { name: 'برتقال', nameEn: 'Orange Juice', price: 8, desc: 'عصير برتقال طبيعي معصور طازج' },
          { name: 'ليمون بالنعنع', nameEn: 'Lemon Mint', price: 8, desc: 'عصير ليمون منعش بالنعناع الأخضر' },
          { name: 'أناناس', nameEn: 'Pineapple Juice', price: 10, desc: 'عصير أناناس طبيعي بارد' },
          { name: 'كوكتيل', nameEn: 'Fruit Cocktail', price: 12, desc: 'كوكتيل فواكه طبيعية مشكلة' },
        ],
      },
      {
        name: 'مشروبات باردة',
        nameEn: 'Cold Beverages',
        sortOrder: 4,
        items: [
          { name: 'موهيتو', nameEn: 'Mojito', price: 10, desc: 'موهيتو بارد ومنعش مع الليمون والنعناع' },
          { name: 'مياه معدنية', nameEn: 'Mineral Water', price: 2, desc: 'مياه معدنية نقية' },
          { name: 'مشروبات غازية', nameEn: 'Soft Drinks', price: 3, desc: 'تشكيلة مشروبات غازية باردة' },
        ],
      },
      {
        name: 'ميلك شيك',
        nameEn: 'Milkshakes',
        sortOrder: 5,
        items: [
          { name: 'نوتيلا', nameEn: 'Nutella Shake', price: 14, desc: 'ميلك شيك شوكولاتة نوتيلا غني' },
          { name: 'لوتس', nameEn: 'Lotus Shake', price: 14, desc: 'ميلك شيك زبدة وبسكويت اللوتس' },
          { name: 'بيستاشيو', nameEn: 'Pistachio Shake', price: 16, desc: 'ميلك شيك الفستق الحلبي الفاخر' },
          { name: 'فانيلا', nameEn: 'Vanilla Shake', price: 12, desc: 'ميلك شيك فانيلا كلاسيكي كريمي' },
          { name: 'كراميل', nameEn: 'Caramel Shake', price: 12, desc: 'ميلك شيك نكهة الكراميل الغنية' },
        ],
      },
      {
        name: 'آيس',
        nameEn: 'Iced Coffee & Drinks',
        sortOrder: 6,
        items: [
          { name: 'آيس كوفي', nameEn: 'Iced Coffee', price: 10, desc: 'قهوة باردة منعشة مع الثلج' },
          { name: 'آيس كوفي نوتيلا', nameEn: 'Iced Nutella Coffee', price: 14, desc: 'قهوة مثلجة بشوكولاتة النوتيلا' },
          { name: 'آيس أمريكانو', nameEn: 'Iced Americano', price: 8, desc: 'أمريكانو مثلج نقي ومنعش' },
          { name: 'آيس كراميل', nameEn: 'Iced Caramel', price: 12, desc: 'قهوة مثلجة بنكهة الكراميل' },
          { name: 'آيس موكا', nameEn: 'Iced Mocha', price: 12, desc: 'موكا مثلجة مع شوكولاتة واسبريسو' },
        ],
      },
      {
        name: 'حلويات',
        nameEn: 'Desserts & Sweets',
        sortOrder: 7,
        items: [
          { name: 'كريب كلاسيك', nameEn: 'Classic Crepe', price: 14, desc: 'كريب طازج مع الشوكولاتة الكلاسيكية' },
          { name: 'كريب اسبيشل', nameEn: 'Special Crepe', price: 18, desc: 'كريب مميز محشو بالفواكه والصوصات' },
          { name: 'فوتوشيني كريب', nameEn: 'Fettuccine Crepe', price: 18, desc: 'شرائح كريب الفوتوشيني مع الشوكولاتة والآيس كريم' },
          { name: 'تشيز كيك', nameEn: 'Cheesecake', price: 14, desc: 'تشيز كيك كريمي غني' },
          { name: 'تشيز بلاك فورست', nameEn: 'Black Forest Cheesecake', price: 16, desc: 'تشيز كيك بلاك فورست بالشوكولاتة والكرز' },
          { name: 'موس نوتيلا', nameEn: 'Nutella Mousse', price: 12, desc: 'موس شوكولاتة نوتيلا خفيف ولذيذ' },
          { name: 'ليزي كيك', nameEn: 'Lazy Cake', price: 10, desc: 'كيكة بسكويت الشوكولاتة الكلاسيكية' },
          { name: 'دازلرز نوتيلا', nameEn: 'Nutella Dazzlers', price: 14, desc: 'دازلرز مقرمش بشوكولاتة النوتيلا' },
          { name: 'دولسي لوتس', nameEn: 'Dulce Lotus', price: 14, desc: 'حلوى دولسي الفاخرة بصوص اللوتس' },
          { name: 'دولسي بيستاشيو', nameEn: 'Dulce Pistachio', price: 16, desc: 'حلوى دولسي الفاخرة بزبدة الفستق الحلبي' },
        ],
      },
    ],
  };

  let restaurant = await prisma.restaurant.findUnique({ where: { slug: shoqrahData.slug } });
  if (!restaurant) {
    restaurant = await prisma.restaurant.create({
      data: {
        name: shoqrahData.name,
        nameEn: shoqrahData.nameEn,
        slug: shoqrahData.slug,
        description: shoqrahData.description,
        phone: shoqrahData.phone,
        address: shoqrahData.address,
        currency: shoqrahData.currency,
        primaryColor: shoqrahData.primaryColor,
        accentColor: shoqrahData.accentColor,
        logoUrl: shoqrahData.logoUrl,
        coverImageUrl: shoqrahData.coverImageUrl,
        status: 'ACTIVE',
        planId: 'plan-pro',
      },
    });
    console.log('✅ Created Restaurant:', restaurant.name);
  }

  // Ensure Pro Subscription
  await prisma.subscription.upsert({
    where: { restaurantId: restaurant.id },
    update: { planId: 'plan-pro', status: 'ACTIVE' },
    create: {
      restaurantId: restaurant.id,
      planId: 'plan-pro',
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    },
  });

  // Manager Account
  const managerEmail = 'manager@shoqrah.com';
  await prisma.restaurantUser.upsert({
    where: { email: managerEmail },
    update: {
      restaurantId: restaurant.id,
      name: 'مدير الشقرة كافيه',
      passwordHash: bcrypt.hashSync('Password123!', 12),
      role: 'RESTAURANT_MANAGER',
      status: 'ACTIVE',
    },
    create: {
      restaurantId: restaurant.id,
      name: 'مدير الشقرة كافيه',
      email: managerEmail,
      passwordHash: bcrypt.hashSync('Password123!', 12),
      role: 'RESTAURANT_MANAGER',
      status: 'ACTIVE',
    },
  });

  // Tables
  const existingTables = await prisma.table.count({ where: { restaurantId: restaurant.id } });
  if (existingTables === 0) {
    for (let i = 1; i <= 20; i++) {
      await prisma.table.create({
        data: {
          restaurantId: restaurant.id,
          number: i,
          name: `طاولة ${i}`,
          capacity: i <= 5 ? 2 : i <= 15 ? 4 : 6,
          zone: i <= 12 ? 'MAIN_HALL' : 'VIP_LOUNGE',
        },
      });
    }
  }

  // Categories & Products
  for (const catData of shoqrahData.categories) {
    let category = await prisma.category.findFirst({
      where: { restaurantId: restaurant.id, name: catData.name },
    });
    if (!category) {
      category = await prisma.category.create({
        data: {
          restaurantId: restaurant.id,
          name: catData.name,
          nameEn: catData.nameEn,
          sortOrder: catData.sortOrder,
        },
      });
    }

    for (let idx = 0; idx < catData.items.length; idx++) {
      const item = catData.items[idx];
      const existing = await prisma.product.findFirst({
        where: { restaurantId: restaurant.id, categoryId: category.id, name: item.name },
      });
      if (!existing) {
        await prisma.product.create({
          data: {
            restaurantId: restaurant.id,
            categoryId: category.id,
            name: item.name,
            nameEn: item.nameEn,
            description: item.desc,
            price: item.price,
            imageUrl: '',
            available: true,
            sortOrder: idx + 1,
          },
        });
      }
    }
  }

  console.log('✅ Shoqrah Cafe fully seeded!');
}
