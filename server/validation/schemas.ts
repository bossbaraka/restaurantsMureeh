import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// ============================================================
// Central input validation (OWASP API3/API4, CWE-20).
//
// Every schema is strict about shape and bounded in size.
// Unknown privileged fields are rejected, never silently passed
// to Prisma (mass-assignment protection).
// ============================================================

const finiteNumber = (min: number, max: number, message: string) =>
  z
    .number({ error: message })
    .refine((value) => Number.isFinite(value), { message })
    .min(min, { message })
    .max(max, { message });

export const moneySchema = finiteNumber(
  0,
  1_000_000,
  'المبلغ يجب أن يكون رقماً موجباً محدوداً'
);

export const idSchema = z
  .string()
  .trim()
  .min(1, 'المعرف مطلوب')
  .max(120, 'المعرف طويل جداً');

const safeName = (label: string, max = 120) =>
  z
    .string()
    .trim()
    .min(1, `${label} مطلوب`)
    .max(max, `${label} طويل جداً`);

const optionalText = (max: number) =>
  z.string().trim().max(max, 'النص طويل جداً').optional();

const httpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(4096, `${label} طويل جداً`)
    .refine(
      (value) => {
        if (!value) return true;
        if (value.startsWith('/') || value.startsWith('data:image/')) return true;
        try {
          const url = new URL(value);
          return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
          return false;
        }
      },
      { message: `${label} يجب أن يكون رابطاً أو مساراً صالحاً للصورة` }
    )
    .optional();

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'اللون يجب أن يكون بصيغة HEX مثل #D4AF37')
  .optional();

// Roles a tenant (non-platform) actor may ever assign. Platform roles
// can never be granted through tenant routes.
export const TENANT_ASSIGNABLE_ROLES = [
  'RESTAURANT_MANAGER',
  'WAITER',
  'KITCHEN',
  'CASHIER',
  'STAFF',
] as const;

export const ORDER_STATUSES = [
  'PENDING',
  'PREPARING',
  'READY',
  'SERVED',
  'CANCELLED',
] as const;

export const TABLE_STATUSES = [
  'AVAILABLE',
  'OCCUPIED',
  'BILL_REQUESTED',
  'RESERVED',
  'MAINTENANCE',
] as const;

export const TABLE_ZONES = [
  'MAIN_HALL',
  'TERRACE',
  'VIP_LOUNGE',
  'GARDEN',
] as const;

export const WAITER_REQUEST_STATUSES = [
  'PENDING',
  'ACKNOWLEDGED',
  'RESOLVED',
  'CANCELLED',
] as const;

export const WAITER_REASONS = [
  'ASSISTANCE',
  'WATER_REFILL',
  'CLEANING',
  'EXTRA_CUTLERY',
  'BILL',
  'WATER',
] as const;

export const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE', 'SPLIT'] as const;

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'INACTIVE'] as const;

export const RESTAURANT_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'ONBOARDING',
  'MAINTENANCE',
] as const;

// ---------------- Auth ----------------

export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(254)
      .email('صيغة البريد الإلكتروني غير صحيحة'),
    password: z
      .string()
      .min(1, 'كلمة المرور مطلوبة')
      .max(128, 'كلمة المرور طويلة جداً'),
  })
  .strict();

export const pinLoginSchema = z
  .object({
    pin: z
      .string()
      .regex(/^\d{4,10}$/, 'رمز PIN يجب أن يكون من 4 إلى 10 أرقام'),
    restaurantId: idSchema,
  })
  .strict();

// ---------------- Staff ----------------

export const staffCreateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    name: safeName('اسم الموظف'),
    email: z
      .string()
      .trim()
      .max(254)
      .email('صيغة البريد الإلكتروني غير صحيحة'),
    password: z
      .string()
      .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      .max(128, 'كلمة المرور طويلة جداً'),
    pin: z
      .string()
      .regex(/^\d{4,10}$/, 'رمز PIN يجب أن يكون من 4 إلى 10 أرقام')
      .optional(),
    role: z.enum(TENANT_ASSIGNABLE_ROLES, 'دور غير صالح'),
  })
  .strict();

export const staffUpdateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    name: safeName('اسم الموظف').optional(),
    role: z.enum(TENANT_ASSIGNABLE_ROLES, 'دور غير صالح').optional(),
    status: z.enum(USER_STATUSES, 'حالة غير صالحة').optional(),
    password: z
      .string()
      .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      .max(128, 'كلمة المرور طويلة جداً')
      .optional(),
    pin: z
      .union([
        z.string().regex(/^\d{4,10}$/, 'رمز PIN غير صالح'),
        z.literal(''),
      ])
      .optional(),
  })
  .strict();

// ---------------- Menu ----------------

export const categoryCreateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    name: safeName('اسم التصنيف'),
    nameEn: optionalText(120),
  })
  .strict();

export const categoryUpdateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    name: safeName('اسم التصنيف').optional(),
    nameEn: optionalText(120),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

const sizeInputSchema = z
  .object({
    name: safeName('اسم الحجم', 80),
    nameEn: optionalText(80),
    price: moneySchema.optional(),
    priceModifier: finiteNumber(-100000, 1000000, 'معدل السعر غير صالح')
      .optional(),
  })
  .strict();

const addOnInputSchema = z
  .object({
    name: safeName('اسم الإضافة', 80),
    nameEn: optionalText(80),
    price: moneySchema.optional(),
  })
  .strict();

export const productCreateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    categoryId: idSchema,
    name: safeName('اسم الطبق'),
    nameEn: optionalText(120),
    description: z.string().trim().max(2000, 'الوصف طويل جداً').optional(),
    price: moneySchema,
    image: httpsUrl('رابط الصورة'),
    badge: optionalText(60),
    preparationTimeMinutes: z.number().int().min(0).max(600).optional(),
    calories: z.number().int().min(0).max(20000).optional(),
    isAvailable: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    allergens: z.array(z.string().trim().max(60)).max(50).optional(),
    ingredients: z.array(z.string().trim().max(80)).max(100).optional(),
    removableIngredients: z
      .array(z.string().trim().max(80))
      .max(100)
      .optional(),
    sizes: z.array(sizeInputSchema).max(30).optional(),
    addOns: z.array(addOnInputSchema).max(50).optional(),
  })
  .strict();

export const productUpdateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    categoryId: idSchema.optional(),
    name: safeName('اسم الطبق').optional(),
    nameEn: optionalText(120),
    description: z.string().trim().max(2000, 'الوصف طويل جداً').optional(),
    price: moneySchema.optional(),
    image: httpsUrl('رابط الصورة'),
    imageUrl: httpsUrl('رابط الصورة'),
    badge: z.string().trim().max(60).nullable().optional(),
    preparationTimeMinutes: z.number().int().min(0).max(600).optional(),
    calories: z.number().int().min(0).max(20000).optional(),
    isAvailable: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
  })
  .strict();

// ---------------- Tables ----------------

export const tableCreateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    tableNumber: z.number().int().min(1).max(5000),
    capacity: z.number().int().min(1).max(100).optional(),
    zone: z.enum(TABLE_ZONES).optional(),
    name: optionalText(80),
  })
  .strict();

export const tableUpdateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    tableNumber: z.number().int().min(1).max(5000).optional(),
    capacity: z.number().int().min(1).max(100).optional(),
    zone: z.enum(TABLE_ZONES).optional(),
    status: z.enum(TABLE_STATUSES).optional(),
    branchId: z.union([idSchema, z.literal(''), z.null()]).optional(),
    name: optionalText(80),
  })
  .strict();

export const orderStatusSchema = z
  .object({
    restaurantId: idSchema.optional(),
    status: z.enum(ORDER_STATUSES, 'حالة الطلب غير صالحة'),
  })
  .strict();

export const waiterStatusSchema = z
  .object({
    restaurantId: idSchema.optional(),
    status: z.enum(WAITER_REQUEST_STATUSES, 'حالة النداء غير صالحة'),
  })
  .strict();

// ---------------- Orders (public + POS share item shape) ----------------

const orderItemSchema = z
  .object({
    productId: idSchema,
    quantity: z.number().int().min(1).max(50).optional().default(1),
    // Optional variant selectors — priced ONLY from the DB menu.
    selectedSizeId: idSchema.optional(),
    selectedSize: z.unknown().optional(),
    selectedAddOnIds: z.array(idSchema).max(50).optional(),
    selectedAddOns: z.unknown().optional(),
    removedIngredients: z
      .array(z.string().trim().max(80))
      .max(50)
      .optional(),
    specialInstructions: optionalText(1000),
    notes: optionalText(1000),
    // Legacy display fields from older clients: accepted, never trusted.
    productName: z.unknown().optional(),
    name: z.unknown().optional(),
    productNameEn: z.unknown().optional(),
    nameEn: z.unknown().optional(),
    productImage: z.unknown().optional(),
    unitPrice: z.unknown().optional(),
    price: z.unknown().optional(),
    totalPrice: z.unknown().optional(),
    id: z.unknown().optional(),
  })
  .strict();

export const publicOrderSchema = z
  .object({
    restaurantId: idSchema,
    tableId: idSchema,
    sessionToken: z.string().trim().min(8).max(200),
    items: z.array(orderItemSchema).min(1).max(50),
    notes: optionalText(1000),
  })
  .strict();

export const posOrderSchema = z
  .object({
    restaurantId: idSchema.optional(),
    tableId: idSchema,
    items: z
      .array(
        z
          .object({
            productId: idSchema,
            quantity: z.number().int().min(1).max(50).optional().default(1),
            selectedAddOns: z.unknown().optional(),
            removedIngredients: z
              .array(z.string().trim().max(80))
              .max(50)
              .optional(),
            specialInstructions: optionalText(1000),
            notes: optionalText(1000),
            productName: z.unknown().optional(),
            name: z.unknown().optional(),
            productNameEn: z.unknown().optional(),
            nameEn: z.unknown().optional(),
            unitPrice: z.unknown().optional(),
            totalPrice: z.unknown().optional(),
            id: z.unknown().optional(),
          })
          .strict()
      )
      .min(1)
      .max(100),
    notes: optionalText(1000),
  })
  .strict();

export const orderCancelSchema = z
  .object({
    restaurantId: idSchema.optional(),
    sessionToken: z.string().trim().min(8).max(200).optional(),
  })
  .strict();

export const orderNotesSchema = z
  .object({
    restaurantId: idSchema,
    sessionToken: z.string().trim().min(8).max(200),
    notes: z.string().trim().max(1000, 'الملاحظات طويلة جداً').optional(),
  })
  .strict();

export const waiterCallSchema = z
  .object({
    restaurantId: idSchema,
    tableId: idSchema,
    sessionToken: z.string().trim().min(8).max(200),
    reason: z.enum(WAITER_REASONS).optional().default('ASSISTANCE'),
    note: optionalText(500),
  })
  .strict();

export const qrSessionSchema = z
  .object({
    slug: z.string().trim().max(120).optional(),
    restaurantId: idSchema.optional(),
  })
  .strict();

// ---------------- Offers / branches / branding / payments ----------------

export const offerCreateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    title: safeName('عنوان العرض'),
    titleEn: optionalText(120),
    subtitle: optionalText(200),
    description: optionalText(2000),
    image: httpsUrl('رابط الصورة'),
    originalPrice: moneySchema.optional(),
    discountedPrice: moneySchema.optional(),
    discountPercentage: finiteNumber(0, 100, 'نسبة الخصم غير صالحة').optional(),
    badge: optionalText(60),
    bgGradient: optionalText(200),
    isActive: z.boolean().optional(),
    code: optionalText(40),
    id: z.unknown().optional(),
  })
  .strict();

export const offerUpdateSchema = offerCreateSchema.partial().strict();

export const branchCreateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    id: z.string().trim().max(120).optional(),
    name: safeName('اسم الفرع'),
    address: optionalText(300),
    phone: optionalText(60),
    color: hexColor,
    isActive: z.boolean().optional(),
  })
  .strict();

export const branchUpdateSchema = branchCreateSchema.partial().strict();

export const assignTablesSchema = z
  .object({
    restaurantId: idSchema.optional(),
    branchId: z.union([idSchema, z.literal(''), z.null()]).optional(),
    tableIds: z.array(idSchema).min(1).max(500),
  })
  .strict();

export const brandingSchema = z
  .object({
    restaurantId: idSchema.optional(),
    name: safeName('اسم المطعم').optional(),
    nameEn: optionalText(120),
    description: optionalText(2000),
    phone: optionalText(60),
    address: optionalText(300),
    logo: httpsUrl('رابط الشعار'),
    coverImage: httpsUrl('رابط الغلاف'),
    currency: z.string().trim().max(8).optional(),
    language: z.enum(['ar', 'en']).optional(),
    timezone: z.string().trim().max(60).optional(),
    primaryColor: hexColor,
    accentColor: hexColor,
    promoVideoUrl: z.string().trim().max(1000).optional().or(z.literal('')),
    galleryImages: z.array(z.string().trim().max(1000)).max(30).optional(),
  })
  .strict();

export const planChangeSchema = z
  .object({
    restaurantId: idSchema.optional(),
    planId: idSchema,
  })
  .strict();

export const paymentCreateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    tableId: idSchema,
    orderIds: z.array(idSchema).min(1).max(100),
    method: z.enum(PAYMENT_METHODS).optional().default('CASH'),
    cashReceived: moneySchema.optional(),
    tip: moneySchema.optional(),
    note: optionalText(500),
  })
  .strict();

// ---------------- Platform admin ----------------

export const tenantStatusSchema = z
  .object({
    status: z.enum(RESTAURANT_STATUSES, 'حالة المطعم غير صالحة'),
  })
  .strict();

export const onboardSchema = z
  .object({
    name: safeName('اسم المطعم'),
    nameEn: optionalText(120),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(
        /^[a-z0-9-]+$/,
        'الرابط يجب أن يحوي حروفاً إنجليزية صغيرة وأرقاماً وشرطات فقط'
      ),
    description: optionalText(2000),
    phone: optionalText(60),
    address: optionalText(300),
    currency: z.string().trim().max(8).optional(),
    primaryColor: hexColor,
    accentColor: hexColor,
    logoUrl: httpsUrl('رابط الشعار'),
    coverImageUrl: httpsUrl('رابط الغلاف'),
    planId: idSchema.optional(),
    managerName: optionalText(120),
    managerEmail: z
      .string()
      .trim()
      .max(254)
      .email('صيغة بريد المدير غير صحيحة')
      .optional(),
    managerPassword: z
      .string()
      .min(8, 'كلمة مرور المدير يجب أن تكون 8 أحرف على الأقل')
      .max(128)
      .optional(),
    tablesCount: z.number().int().min(1).max(500).optional(),
    categories: z
      .array(
        z
          .object({
            name: safeName('اسم التصنيف'),
            nameEn: optionalText(120),
            id: z.string().trim().max(120).optional(),
          })
          .strict()
      )
      .max(100)
      .optional(),
    products: z
      .array(
        z
          .object({
            name: safeName('اسم الطبق'),
            nameEn: optionalText(120),
            description: optionalText(2000),
            price: moneySchema.optional(),
            imageUrl: httpsUrl('رابط الصورة'),
            categoryName: optionalText(120),
            categoryId: z.string().trim().max(120).optional(),
          })
          .strict()
      )
      .max(500)
      .optional(),
  })
  .strict();

// ============================================================
// Express helpers
// ============================================================

type SchemaLike = z.ZodTypeAny;

function formatFirstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'بيانات غير صالحة';
  const where =
    issue.path.length > 0 ? ` (${issue.path.join('.')})` : '';
  return `${issue.message}${where}`;
}

/** Validate req.body against a schema; parsed data replaces req.body. */
export function validateBody(schema: SchemaLike) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: formatFirstIssue(parsed.error),
        statusCode: 400,
      });
    }
    req.body = parsed.data;
    next();
  };
}
