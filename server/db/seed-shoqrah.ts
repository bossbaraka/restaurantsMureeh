import { prisma } from './prisma';
import bcrypt from 'bcryptjs';

export async function seedShoqrahCafe() {
  console.log('🌱 Seeding الشقرة كافيه | SHOQRAH CAFÉ with High-Res Image URLs...');

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
        image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'قهوة تركي', nameEn: 'Turkish Coffee', price: 4, desc: 'قهوة تركية أصيلة متقنة', img: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80' },
          { name: 'اسبريسو', nameEn: 'Espresso', price: 6, desc: 'جرعة اسبريسو غنية ومكثفة', img: 'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?auto=format&fit=crop&w=800&q=80' },
          { name: 'ماكياتو', nameEn: 'Macchiato', price: 8, desc: 'اسبريسو مع لمسة رغوة الحليب', img: 'https://images.unsplash.com/photo-1485808191679-5f86510681a2?auto=format&fit=crop&w=800&q=80' },
          { name: 'كافي لاتيه', nameEn: 'Caffè Latte', price: 10, desc: 'اسبريسو مع حليب مبخر ورغوة', img: 'https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=800&q=80' },
          { name: 'كابتشينو', nameEn: 'Cappuccino', price: 10, desc: 'توازن مثالي بين الاسبريسو والحليب', img: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?auto=format&fit=crop&w=800&q=80' },
          { name: 'أمريكانو', nameEn: 'Americano', price: 8, desc: 'اسبريسو ممدد بالماء الساخن', img: 'https://images.unsplash.com/photo-1551033406-611cf9a28f67?auto=format&fit=crop&w=800&q=80' },
          { name: 'كراميل ماكياتو', nameEn: 'Caramel Macchiato', price: 12, desc: 'اسبريسو مع الحليب ونكهة الكراميل الفاخرة', img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'مشروبات ساخنة',
        nameEn: 'Hot Drinks',
        sortOrder: 2,
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'شاي', nameEn: 'Tea', price: 3, desc: 'شاي أحمر فاخر طازج', img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت شوكليت', nameEn: 'Hot Chocolate', price: 10, desc: 'شوكولاتة ساخنة غنية ولذيذة', img: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت بيستاشيو', nameEn: 'Hot Pistachio', price: 14, desc: 'مشروب الفستق الحلبي الساخن الفاخر', img: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت لوتس', nameEn: 'Hot Lotus', price: 12, desc: 'مشروب زبدة اللوتس الساخن', img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=800&q=80' },
          { name: 'كافي نوتيلا', nameEn: 'Café Nutella', price: 12, desc: 'قهوة ساخنة بنكهة شوكولاتة نوتيلا', img: 'https://images.unsplash.com/photo-1589396575653-c09c794ff6a6?auto=format&fit=crop&w=800&q=80' },
          { name: 'نسكافيه', nameEn: 'Nescafé', price: 6, desc: 'نسكافيه كلاسيكي ساخن', img: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
          { name: 'نسكافيه بالحليب', nameEn: 'Nescafé with Milk', price: 8, desc: 'نسكافيه غني بالحليب الطازج', img: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=800&q=80' },
          { name: 'أعشاب بالعسل', nameEn: 'Herbal Tea with Honey', price: 5, desc: 'مزيج أعشاب طبيعية مهدئة مع العسل', img: 'https://images.unsplash.com/photo-1597481499750-3e6b22637e12?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'عصائر طبيعية',
        nameEn: 'Fresh Juices',
        sortOrder: 3,
        image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'مانجا', nameEn: 'Mango Juice', price: 10, desc: 'عصير مانجو طبيعي منعش', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'فراولة', nameEn: 'Strawberry Juice', price: 10, desc: 'عصير فراولة طبيعي طازج', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'برتقال', nameEn: 'Orange Juice', price: 8, desc: 'عصير برتقال طبيعي معصور طازج', img: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=800&q=80' },
          { name: 'ليمون بالنعنع', nameEn: 'Lemon Mint', price: 8, desc: 'عصير ليمون منعش بالنعناع الأخضر', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80' },
          { name: 'أناناس', nameEn: 'Pineapple Juice', price: 10, desc: 'عصير أناناس طبيعي بارد', img: 'https://images.unsplash.com/photo-1589733955941-5eeaf752f6dd?auto=format&fit=crop&w=800&q=80' },
          { name: 'كوكتيل', nameEn: 'Fruit Cocktail', price: 12, desc: 'كوكتيل فواكه طبيعية مشكلة', img: 'https://images.unsplash.com/photo-1505252585461-04db1eb84625?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'مشروبات باردة',
        nameEn: 'Cold Beverages',
        sortOrder: 4,
        image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'موهيتو', nameEn: 'Mojito', price: 10, desc: 'موهيتو بارد ومنعش مع الليمون والنعناع', img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80' },
          { name: 'مياه معدنية', nameEn: 'Mineral Water', price: 2, desc: 'مياه معدنية نقية', img: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&w=800&q=80' },
          { name: 'مشروبات غازية', nameEn: 'Soft Drinks', price: 3, desc: 'تشكيلة مشروبات غازية باردة', img: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'ميلك شيك',
        nameEn: 'Milkshakes',
        sortOrder: 5,
        image: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'نوتيلا', nameEn: 'Nutella Shake', price: 14, desc: 'ميلك شيك شوكولاتة نوتيلا غني', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'لوتس', nameEn: 'Lotus Shake', price: 14, desc: 'ميلك شيك زبدة وبسكويت اللوتس', img: 'https://images.unsplash.com/photo-1586985289688-ca3cf47d3e6e?auto=format&fit=crop&w=800&q=80' },
          { name: 'بيستاشيو', nameEn: 'Pistachio Shake', price: 16, desc: 'ميلك شيك الفستق الحلبي الفاخر', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80' },
          { name: 'فانيلا', nameEn: 'Vanilla Shake', price: 12, desc: 'ميلك شيك فانيلا كلاسيكي كريمي', img: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=800&q=80' },
          { name: 'كراميل', nameEn: 'Caramel Shake', price: 12, desc: 'ميلك شيك نكهة الكراميل الغنية', img: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'آيس',
        nameEn: 'Iced Coffee & Drinks',
        sortOrder: 6,
        image: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'آيس كوفي', nameEn: 'Iced Coffee', price: 10, desc: 'قهوة باردة منعشة مع الثلج', img: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
          { name: 'آيس كوفي نوتيلا', nameEn: 'Iced Nutella Coffee', price: 14, desc: 'قهوة مثلجة بشوكولاتة النوتيلا', img: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=800&q=80' },
          { name: 'آيس أمريكانو', nameEn: 'Iced Americano', price: 8, desc: 'أمريكانو مثلج نقي ومنعش', img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=800&q=80' },
          { name: 'آيس كراميل', nameEn: 'Iced Caramel', price: 12, desc: 'قهوة مثلجة بنكهة الكراميل', img: 'https://images.unsplash.com/photo-1553909489-cd47e0907980?auto=format&fit=crop&w=800&q=80' },
          { name: 'آيس موكا', nameEn: 'Iced Mocha', price: 12, desc: 'موكا مثلجة مع شوكولاتة واسبريسو', img: 'https://images.unsplash.com/photo-1578314675249-a6910f80cc4e?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'حلويات',
        nameEn: 'Desserts & Sweets',
        sortOrder: 7,
        image: 'https://images.unsplash.com/photo-1587314168485-3236d6710814?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'كريب كلاسيك', nameEn: 'Classic Crepe', price: 14, desc: 'كريب طازج مع الشوكولاتة الكلاسيكية', img: 'https://images.unsplash.com/photo-1519676867240-f03562e64548?auto=format&fit=crop&w=800&q=80' },
          { name: 'كريب اسبيشل', nameEn: 'Special Crepe', price: 18, desc: 'كريب مميز محشو بالفواكه والصوصات', img: 'https://images.unsplash.com/photo-1587314168485-3236d6710814?auto=format&fit=crop&w=800&q=80' },
          { name: 'فوتوشيني كريب', nameEn: 'Fettuccine Crepe', price: 18, desc: 'شرائح كريب الفوتوشيني مع الشوكولاتة والآيس كريم', img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=800&q=80' },
          { name: 'تشيز كيك', nameEn: 'Cheesecake', price: 14, desc: 'تشيز كيك كريمي غني', img: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=800&q=80' },
          { name: 'تشيز بلاك فورست', nameEn: 'Black Forest Cheesecake', price: 16, desc: 'تشيز كيك بلاك فورست بالشوكولاتة والكرز', img: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=800&q=80' },
          { name: 'موس نوتيلا', nameEn: 'Nutella Mousse', price: 12, desc: 'موس شوكولاتة نوتيلا خفيف ولذيذ', img: 'https://images.unsplash.com/photo-1541781774459-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
          { name: 'ليزي كيك', nameEn: 'Lazy Cake', price: 10, desc: 'كيكة بسكويت الشوكولاتة الكلاسيكية', img: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=800&q=80' },
          { name: 'دازلرز نوتيلا', nameEn: 'Nutella Dazzlers', price: 14, desc: 'دازلرز مقرمش بشوكولاتة النوتيلا', img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80' },
          { name: 'دولسي لوتس', nameEn: 'Dulce Lotus', price: 14, desc: 'حلوى دولسي الفاخرة بصوص اللوتس', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=800&q=80' },
          { name: 'دولسي بيستاشيو', nameEn: 'Dulce Pistachio', price: 16, desc: 'حلوى دولسي الفاخرة بزبدة الفستق الحلبي', img: 'https://images.unsplash.com/photo-1565958011703-44f9829ba187?auto=format&fit=crop&w=800&q=80' },
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
  } else {
    await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: {
        logoUrl: shoqrahData.logoUrl,
        coverImageUrl: shoqrahData.coverImageUrl,
      },
    });
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
          image: catData.image,
        },
      });
    } else {
      await prisma.category.update({
        where: { id: category.id },
        data: { image: catData.image },
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
            imageUrl: item.img,
            available: true,
            sortOrder: idx + 1,
          },
        });
      } else {
        await prisma.product.update({
          where: { id: existing.id },
          data: { imageUrl: item.img },
        });
      }
    }
  }

  console.log('✅ Shoqrah Cafe images fully updated!');
}
