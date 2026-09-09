import { prisma } from './prisma';
import bcrypt from 'bcryptjs';

export async function seedGhosnCafe() {
  console.log('🌱 Seeding غصن كافيه | Ghosn Cafe...');

  const ghosnData = {
    name: 'غصن كافيه | Ghosn Cafe',
    nameEn: 'Ghosn Cafe',
    slug: 'ghosn-cafe',
    description: 'غصن كافيه - أرقى القهوة المختصة والمشروبات الساخنة والباردة والحلويات الفاخرة والأراجيل المميزة',
    phone: '+972 599 891 559',
    address: 'غصن كافيه - فلسطين',
    currency: '₪',
    primaryColor: '#15803D',
    accentColor: '#D4AF37',
    logoUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=400&q=80',
    coverImageUrl: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=1200&q=80',
    categories: [
      {
        name: 'مشروبات ساخنة مع القهوة',
        nameEn: 'Hot Coffee Beverages',
        sortOrder: 1,
        image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'اسبريسو (وسط M)', nameEn: 'Espresso (M)', price: 5, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?auto=format&fit=crop&w=800&q=80' },
          { name: 'اسبريسو (كبير L)', nameEn: 'Espresso (L)', price: 8, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?auto=format&fit=crop&w=800&q=80' },
          { name: 'أمريكانو (وسط M)', nameEn: 'Americano (M)', price: 6, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1551033406-611cf9a28f67?auto=format&fit=crop&w=800&q=80' },
          { name: 'أمريكانو (كبير L)', nameEn: 'Americano (L)', price: 9, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1551033406-611cf9a28f67?auto=format&fit=crop&w=800&q=80' },
          { name: 'نيسكافيه (وسط M)', nameEn: 'Nescafe (M)', price: 7, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
          { name: 'نيسكافيه (كبير L)', nameEn: 'Nescafe (L)', price: 12, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
          { name: 'اسبريسو ميكياتو (وسط M)', nameEn: 'Espresso Macchiato (M)', price: 7, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1485808191679-5f86510681a2?auto=format&fit=crop&w=800&q=80' },
          { name: 'اسبريسو ميكياتو (كبير L)', nameEn: 'Espresso Macchiato (L)', price: 10, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1485808191679-5f86510681a2?auto=format&fit=crop&w=800&q=80' },
          { name: 'فلات وايت (وسط M)', nameEn: 'Flat White (M)', price: 7, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1577968897966-3d4325b36b61?auto=format&fit=crop&w=800&q=80' },
          { name: 'فلات وايت (كبير L)', nameEn: 'Flat White (L)', price: 10, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1577968897966-3d4325b36b61?auto=format&fit=crop&w=800&q=80' },
          { name: 'كورتادو (وسط M)', nameEn: 'Cortado (M)', price: 7, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=800&q=80' },
          { name: 'كورتادو (كبير L)', nameEn: 'Cortado (L)', price: 10, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=800&q=80' },
          { name: 'كابتشينو (وسط M)', nameEn: 'Cappuccino (M)', price: 8, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?auto=format&fit=crop&w=800&q=80' },
          { name: 'كابتشينو (كبير L)', nameEn: 'Cappuccino (L)', price: 14, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?auto=format&fit=crop&w=800&q=80' },
          { name: 'كافيه لاتيه (وسط M)', nameEn: 'Cafe Latte (M)', price: 8, desc: 'حجم وسط (M) - إضافة نكهة +2', img: 'https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=800&q=80' },
          { name: 'كافيه لاتيه (كبير L)', nameEn: 'Cafe Latte (L)', price: 14, desc: 'حجم كبير (L) - إضافة نكهة +2', img: 'https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=800&q=80' },
          { name: 'اسبريسو أفوكاتو (وسط M)', nameEn: 'Espresso Affogato (M)', price: 8, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1592663527359-cf6642f54cff?auto=format&fit=crop&w=800&q=80' },
          { name: 'اسبريسو أفوكاتو (كبير L)', nameEn: 'Espresso Affogato (L)', price: 12, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1592663527359-cf6642f54cff?auto=format&fit=crop&w=800&q=80' },
          { name: 'موكا (وسط M)', nameEn: 'Mocha (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1578314675249-a6910f80cc4e?auto=format&fit=crop&w=800&q=80' },
          { name: 'موكا (كبير L)', nameEn: 'Mocha (L)', price: 14, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1578314675249-a6910f80cc4e?auto=format&fit=crop&w=800&q=80' },
          { name: 'سبانش لاتيه (وسط M)', nameEn: 'Spanish Latte (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=800&q=80' },
          { name: 'سبانش لاتيه (كبير L)', nameEn: 'Spanish Latte (L)', price: 16, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'مشروبات ساخنة',
        nameEn: 'Hot Beverages',
        sortOrder: 2,
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'أعشاب (وسط M)', nameEn: 'Herbal Tea (M)', price: 5, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1597481499750-3e6b22637e12?auto=format&fit=crop&w=800&q=80' },
          { name: 'أعشاب (كبير L)', nameEn: 'Herbal Tea (L)', price: 7, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1597481499750-3e6b22637e12?auto=format&fit=crop&w=800&q=80' },
          { name: 'شاي بأطعمة (وسط M)', nameEn: 'Flavored Tea (M)', price: 5, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80' },
          { name: 'شاي بأطعمة (كبير L)', nameEn: 'Flavored Tea (L)', price: 7, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرنش فانيلا (وسط M)', nameEn: 'French Vanilla (M)', price: 8, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرنش فانيلا (كبير L)', nameEn: 'French Vanilla (L)', price: 12, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرنش بندق (وسط M)', nameEn: 'French Hazelnut (M)', price: 8, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرنش بندق (كبير L)', nameEn: 'French Hazelnut (L)', price: 12, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت كراميل (وسط M)', nameEn: 'Hot Caramel (M)', price: 8, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت كراميل (كبير L)', nameEn: 'Hot Caramel (L)', price: 12, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80' },
          { name: 'شاي لاتيه (وسط M)', nameEn: 'Tea Latte (M)', price: 8, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80' },
          { name: 'شاي لاتيه (كبير L)', nameEn: 'Tea Latte (L)', price: 12, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت كندر (وسط M)', nameEn: 'Hot Kinder (M)', price: 9, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت كندر (كبير L)', nameEn: 'Hot Kinder (L)', price: 12, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?auto=format&fit=crop&w=800&q=80' },
          { name: 'سولتيد كراميل ساخن (وسط M)', nameEn: 'Hot Salted Caramel (M)', price: 9, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80' },
          { name: 'سولتيد كراميل ساخن (كبير L)', nameEn: 'Hot Salted Caramel (L)', price: 12, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت لوتس (وسط M)', nameEn: 'Hot Lotus (M)', price: 9, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت لوتس (كبير L)', nameEn: 'Hot Lotus (L)', price: 14, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت بستاشيو (وسط M)', nameEn: 'Hot Pistachio (M)', price: 9, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت بستاشيو (كبير L)', nameEn: 'Hot Pistachio (L)', price: 14, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=800&q=80' },
          { name: 'سحلب (وسط M)', nameEn: 'Sahlab (M)', price: 9, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=800&q=80' },
          { name: 'سحلب (كبير L)', nameEn: 'Sahlab (L)', price: 14, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت شوكلت (وسط M)', nameEn: 'Hot Chocolate (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?auto=format&fit=crop&w=800&q=80' },
          { name: 'هوت شوكلت (كبير L)', nameEn: 'Hot Chocolate (L)', price: 14, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'مشروبات باردة',
        nameEn: 'Cold Beverages',
        sortOrder: 3,
        image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'ايس أمريكانو (وسط M)', nameEn: 'Iced Americano (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس أمريكانو (كبير L)', nameEn: 'Iced Americano (L)', price: 14, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس كوفي (وسط M)', nameEn: 'Iced Coffee (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس كوفي (كبير L)', nameEn: 'Iced Coffee (L)', price: 16, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس لاتيه (وسط M)', nameEn: 'Iced Latte (M)', price: 10, desc: 'حجم وسط (M) - إضافة نكهة +2', img: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس لاتيه (كبير L)', nameEn: 'Iced Latte (L)', price: 14, desc: 'حجم كبير (L) - إضافة نكهة +2', img: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس مسفلورا (وسط M)', nameEn: 'Iced Passiflora (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس مسفلورا (كبير L)', nameEn: 'Iced Passiflora (L)', price: 16, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس تي خوخ (وسط M)', nameEn: 'Peach Iced Tea (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس تي خوخ (كبير L)', nameEn: 'Peach Iced Tea (L)', price: 16, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=800&q=80' },
          { name: 'موهيتو بعدة أطعمة (وسط M)', nameEn: 'Mojito Flavors (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80' },
          { name: 'موهيتو بعدة أطعمة (كبير L)', nameEn: 'Mojito Flavors (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80' },
          { name: 'موهيتو بعدة أطعمة (جامبو XL)', nameEn: 'Mojito Flavors (XL)', price: 18, desc: 'حجم جامبو (XL)', img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80' },
          { name: 'بينا كولادا (وسط M)', nameEn: 'Pina Colada (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'بينا كولادا (كبير L)', nameEn: 'Pina Colada (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'سبانيش ايس لاتيه (وسط M)', nameEn: 'Spanish Iced Latte (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=800&q=80' },
          { name: 'سبانيش ايس لاتيه (كبير L)', nameEn: 'Spanish Iced Latte (L)', price: 16, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=800&q=80' },
          { name: 'ماتشا ايس لاتيه (وسط M)', nameEn: 'Matcha Iced Latte (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?auto=format&fit=crop&w=800&q=80' },
          { name: 'ماتشا ايس لاتيه (كبير L)', nameEn: 'Matcha Iced Latte (L)', price: 16, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس موكا (وسط M)', nameEn: 'Iced Mocha (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1578314675249-a6910f80cc4e?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس موكا (كبير L)', nameEn: 'Iced Mocha (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1578314675249-a6910f80cc4e?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس مانجا (وسط M)', nameEn: 'Iced Mango (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'ايس مانجا (كبير L)', nameEn: 'Iced Mango (L)', price: 16, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'بيستاشيو ايس لاتيه (وسط M)', nameEn: 'Pistachio Iced Latte (M)', price: 14, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80' },
          { name: 'بيستاشيو ايس لاتيه (كبير L)', nameEn: 'Pistachio Iced Latte (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرابيه فانيلا (وسط M)', nameEn: 'Vanilla Frappe (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرابيه فانيلا (كبير L)', nameEn: 'Vanilla Frappe (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرابيه كراميل (وسط M)', nameEn: 'Caramel Frappe (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرابيه كراميل (كبير L)', nameEn: 'Caramel Frappe (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرابيه سولتيد كراميل (وسط M)', nameEn: 'Salted Caramel Frappe (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرابيه سولتيد كراميل (كبير L)', nameEn: 'Salted Caramel Frappe (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرابيه بندق (وسط M)', nameEn: 'Hazelnut Frappe (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'فرابيه بندق (كبير L)', nameEn: 'Hazelnut Frappe (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'مشروبات البابلز',
        nameEn: 'Bubble Beverages',
        sortOrder: 4,
        image: 'https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'بابلز تي (وسط M)', nameEn: 'Bubbles Tea (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=800&q=80' },
          { name: 'بابلز تي (كبير L)', nameEn: 'Bubbles Tea (L)', price: 16, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=800&q=80' },
          { name: 'بابلز أيس لاتيه (وسط M)', nameEn: 'Bubbles Iced Latte (M)', price: 14, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=800&q=80' },
          { name: 'بابلز أيس لاتيه (كبير L)', nameEn: 'Bubbles Iced Latte (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=800&q=80' },
          { name: 'بابلز موهيتو (وسط M)', nameEn: 'Bubbles Mojito (M)', price: 14, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80' },
          { name: 'بابلز موهيتو (كبير L)', nameEn: 'Bubbles Mojito (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80' },
          { name: 'بابلز أيس كوفي (وسط M)', nameEn: 'Bubbles Iced Coffee (M)', price: 14, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
          { name: 'بابلز أيس كوفي (كبير L)', nameEn: 'Bubbles Iced Coffee (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
          { name: 'بابلز فانيلا (وسط M)', nameEn: 'Bubbles Vanilla (M)', price: 14, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=800&q=80' },
          { name: 'بابلز فانيلا (كبير L)', nameEn: 'Bubbles Vanilla (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'إضافات',
        nameEn: 'Add-ons & Extras',
        sortOrder: 5,
        image: 'https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'إضافة بابلز (حجم صغير M)', nameEn: 'Extra Bubbles (M)', price: 4, desc: 'إضافة اختيارية - حجم صغير', img: 'https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=800&q=80' },
          { name: 'إضافة بابلز (حجم كبير L)', nameEn: 'Extra Bubbles (L)', price: 6, desc: 'إضافة اختيارية - حجم كبير', img: 'https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'ميلك شيك',
        nameEn: 'Milkshakes',
        sortOrder: 6,
        image: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'ميلك شيك شوكولاته (وسط M)', nameEn: 'Chocolate Milkshake (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك شوكولاته (كبير L)', nameEn: 'Chocolate Milkshake (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك لوتس (وسط M)', nameEn: 'Lotus Milkshake (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1586985289688-ca3cf47d3e6e?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك لوتس (كبير L)', nameEn: 'Lotus Milkshake (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1586985289688-ca3cf47d3e6e?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك اوريو (وسط M)', nameEn: 'Oreo Milkshake (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك اوريو (كبير L)', nameEn: 'Oreo Milkshake (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك فانيلا (وسط M)', nameEn: 'Vanilla Milkshake (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك فانيلا (كبير L)', nameEn: 'Vanilla Milkshake (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك بلوبري (وسط M)', nameEn: 'Blueberry Milkshake (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك بلوبري (كبير L)', nameEn: 'Blueberry Milkshake (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك فراولة (وسط M)', nameEn: 'Strawberry Milkshake (M)', price: 12, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك فراولة (كبير L)', nameEn: 'Strawberry Milkshake (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك سنكرز (وسط M)', nameEn: 'Snickers Milkshake (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك سنكرز (كبير L)', nameEn: 'Snickers Milkshake (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك كورنيتو (وسط M)', nameEn: 'Cornetto Milkshake (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك كورنيتو (كبير L)', nameEn: 'Cornetto Milkshake (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك كندر بوينو (وسط M)', nameEn: 'Kinder Bueno Milkshake (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك كندر بوينو (كبير L)', nameEn: 'Kinder Bueno Milkshake (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك فريرو (وسط M)', nameEn: 'Ferrero Milkshake (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك فريرو (كبير L)', nameEn: 'Ferrero Milkshake (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك بيستاشو (وسط M)', nameEn: 'Pistachio Milkshake (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك بيستاشو (كبير L)', nameEn: 'Pistachio Milkshake (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك شيري بيري (وسط M)', nameEn: 'Cherry Berry Milkshake (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك شيري بيري (كبير L)', nameEn: 'Cherry Berry Milkshake (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك سيريلاك (وسط M)', nameEn: 'Cerelac Milkshake (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك سيريلاك (كبير L)', nameEn: 'Cerelac Milkshake (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك بلو انجل (وسط M)', nameEn: 'Blue Angel Milkshake (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك بلو انجل (كبير L)', nameEn: 'Blue Angel Milkshake (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك ببل جم (وسط M)', nameEn: 'Bubble Gum Milkshake (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
          { name: 'ميلك شيك ببل جم (كبير L)', nameEn: 'Bubble Gum Milkshake (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'سموذي',
        nameEn: 'Smoothies',
        sortOrder: 7,
        image: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'سموذي باين بيري (وسط M)', nameEn: 'Pine Berry Smoothie (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي باين بيري (كبير L)', nameEn: 'Pine Berry Smoothie (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي مكس بيري (وسط M)', nameEn: 'Mix Berry Smoothie (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي مكس بيري (كبير L)', nameEn: 'Mix Berry Smoothie (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي مكس جولان (وسط M)', nameEn: 'Mix Golan Smoothie (M)', price: 15, desc: 'أناناس، مانجا، باشن فروت - حجم وسط (M)', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي مكس جولان (كبير L)', nameEn: 'Mix Golan Smoothie (L)', price: 18, desc: 'أناناس، مانجا، باشن فروت - حجم كبير (L)', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي بلوبري & افوكادو (وسط M)', nameEn: 'Blueberry & Avocado (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي بلوبري & افوكادو (كبير L)', nameEn: 'Blueberry & Avocado (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي افوكادو (وسط M)', nameEn: 'Avocado Smoothie (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1528498033373-3c6c08e93d79?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي افوكادو (كبير L)', nameEn: 'Avocado Smoothie (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1528498033373-3c6c08e93d79?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي بلوبيري (وسط M)', nameEn: 'Blueberry Smoothie (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي بلوبيري (كبير L)', nameEn: 'Blueberry Smoothie (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي فراولة (وسط M)', nameEn: 'Strawberry Smoothie (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي فراولة (كبير L)', nameEn: 'Strawberry Smoothie (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي مانجا (وسط M)', nameEn: 'Mango Smoothie (M)', price: 15, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي مانجا (كبير L)', nameEn: 'Mango Smoothie (L)', price: 18, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي بروتين (وسط M)', nameEn: 'Protein Smoothie (M)', price: 15, desc: 'بعدة نكهات - حجم وسط (M)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
          { name: 'سموذي بروتين (كبير L)', nameEn: 'Protein Smoothie (L)', price: 20, desc: 'بعدة نكهات - حجم كبير (L)', img: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'عصائر طبيعية',
        nameEn: 'Fresh Juices',
        sortOrder: 8,
        image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'عصير ليمون ونعنع (وسط M)', nameEn: 'Lemon & Mint Juice (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير ليمون ونعنع (كبير L)', nameEn: 'Lemon & Mint Juice (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير ليمونادا (وسط M)', nameEn: 'Lemonade (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير ليمونادا (كبير L)', nameEn: 'Lemonade (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير برتقال (وسط M)', nameEn: 'Orange Juice (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير برتقال (كبير L)', nameEn: 'Orange Juice (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير رمان (وسط M)', nameEn: 'Pomegranate Juice (M)', price: 10, desc: 'موسمي - حجم وسط (M)', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير رمان (كبير L)', nameEn: 'Pomegranate Juice (L)', price: 15, desc: 'موسمي - حجم كبير (L)', img: 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير تفاح (وسط M)', nameEn: 'Apple Juice (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير تفاح (كبير L)', nameEn: 'Apple Juice (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير جزر (وسط M)', nameEn: 'Carrot Juice (M)', price: 10, desc: 'حجم وسط (M)', img: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=800&q=80' },
          { name: 'عصير جزر (كبير L)', nameEn: 'Carrot Juice (L)', price: 15, desc: 'حجم كبير (L)', img: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'حلويات',
        nameEn: 'Desserts',
        sortOrder: 9,
        image: 'https://images.unsplash.com/photo-1587314168485-3236d6710814?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'سوفليه', nameEn: 'Souffle', price: 17, desc: 'إمكانية إضافة بوظة', img: 'https://images.unsplash.com/photo-1541781774459-bb29b565090c?auto=format&fit=crop&w=800&q=80' },
          { name: 'ريد فيلفت', nameEn: 'Red Velvet', price: 18, desc: 'كيك الريد فيلفت الفاخر', img: 'https://images.unsplash.com/photo-1586788680434-30d324b2d46f?auto=format&fit=crop&w=800&q=80' },
          { name: 'ترامسيو', nameEn: 'Tiramisu', price: 18, desc: 'حلوى التيراميسو الإيطالية الكلاسيكية', img: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=800&q=80' },
          { name: 'سان سبستيان', nameEn: 'San Sebastian', price: 20, desc: 'تشيز كيك سان سباستيان المخبوزة', img: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'حلويات ساخنة',
        nameEn: 'Hot Desserts',
        sortOrder: 10,
        image: 'https://images.unsplash.com/photo-1519676867240-f03562e64548?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'كريب', nameEn: 'Crepe', price: 18, desc: 'كريب طازج مع الشوكولاتة', img: 'https://images.unsplash.com/photo-1519676867240-f03562e64548?auto=format&fit=crop&w=800&q=80' },
          { name: 'كريب فوتوتشيني', nameEn: 'Fettuccine Crepe', price: 18, desc: 'شرائح كريب الفوتوشيني المميزة', img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=800&q=80' },
          { name: 'وافل', nameEn: 'Waffle', price: 18, desc: 'وافل مقرمش مع الصوصات والشوكلاتة', img: 'https://images.unsplash.com/photo-1562376552-0d160a2f238d?auto=format&fit=crop&w=800&q=80' },
          { name: 'مني بانكيك (10 قطع)', nameEn: 'Mini Pancake (10 Pcs)', price: 18, desc: '10 قطع بانكيك صغيرة طازجة', img: 'https://images.unsplash.com/photo-1528207776546-365bb710ee93?auto=format&fit=crop&w=800&q=80' },
        ],
      },
      {
        name: 'أراجيل',
        nameEn: 'Hookah / Shisha',
        sortOrder: 11,
        image: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=600&q=80',
        items: [
          { name: 'أرجيلة تفاحتين', nameEn: 'Double Apple Hookah', price: 20, desc: 'نكهة تفاحتين فاخرة', img: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=800&q=80' },
          { name: 'أرجيلة بطيخ ونعنع', nameEn: 'Watermelon Mint Hookah', price: 20, desc: 'نكهة بطيخ ونعناع منعشة', img: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=800&q=80' },
          { name: 'أرجيلة ليمون ونعنع', nameEn: 'Lemon Mint Hookah', price: 20, desc: 'نكهة ليمون ونعناع', img: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=800&q=80' },
          { name: 'أرجيلة بلوبري', nameEn: 'Blueberry Hookah', price: 20, desc: 'نكهة التوت الأزرق', img: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=800&q=80' },
          { name: 'أرجيلة تفاحتين نخلة', nameEn: 'Nakhla Double Apple Hookah', price: 25, desc: 'أرجيلة نخلة تفاحتين أصيلة', img: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=800&q=80' },
        ],
      },
    ],
  };

  let restaurant = await prisma.restaurant.findUnique({ where: { slug: ghosnData.slug } });
  if (!restaurant) {
    restaurant = await prisma.restaurant.create({
      data: {
        name: ghosnData.name,
        nameEn: ghosnData.nameEn,
        slug: ghosnData.slug,
        description: ghosnData.description,
        phone: ghosnData.phone,
        address: ghosnData.address,
        currency: ghosnData.currency,
        primaryColor: ghosnData.primaryColor,
        accentColor: ghosnData.accentColor,
        logoUrl: ghosnData.logoUrl,
        coverImageUrl: ghosnData.coverImageUrl,
        status: 'ACTIVE',
        planId: 'plan-pro',
      },
    });
    console.log('✅ Created Restaurant:', restaurant.name);
  } else {
    await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: {
        name: ghosnData.name,
        logoUrl: ghosnData.logoUrl,
        coverImageUrl: ghosnData.coverImageUrl,
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
  const managerEmail = 'manager@ghosncafe.com';
  await prisma.restaurantUser.upsert({
    where: { email: managerEmail },
    update: {
      restaurantId: restaurant.id,
      name: 'مدير غصن كافيه',
      passwordHash: bcrypt.hashSync('Password123!', 12),
      role: 'RESTAURANT_MANAGER',
      status: 'ACTIVE',
    },
    create: {
      restaurantId: restaurant.id,
      name: 'مدير غصن كافيه',
      email: managerEmail,
      passwordHash: bcrypt.hashSync('Password123!', 12),
      role: 'RESTAURANT_MANAGER',
      status: 'ACTIVE',
    },
  });

  // Tables (1 to 20)
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
  for (const catData of ghosnData.categories) {
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
          data: {
            price: item.price,
            description: item.desc,
            imageUrl: item.img,
          },
        });
      }
    }
  }

  console.log('✅ Ghosn Cafe fully seeded!');
}
