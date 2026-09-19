import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  MAX_PHONE_INPUT_LENGTH,
  normalizeCustomerPhone,
} from '../utils/phone';

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

const BLOCKED_WEAK_PASSWORDS = new Set([
  'password',
  'password123',
  'password123!',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  'qwerty',
  'qwertyuiop',
  'abc123',
  'letmein',
  'admin123',
  'admin1234',
  'password1234',
  'welcome',
  'welcome123',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  '123123',
  '111111',
  '000000',
  'demo',
  'demo123',
  'mureeh2026',
]);

export const safePasswordSchema = (label = 'كلمة المرور', min = 8) =>
  z
    .string()
    .trim()
    .min(min, `${label} يجب أن تكون ${min} أحرف على الأقل`)
    .max(128, `${label} طويلة جداً`)
    .refine((val) => !BLOCKED_WEAK_PASSWORDS.has(val.toLowerCase()), {
      message: `${label} ضعيفة جداً وشائعة، يرجى اختيار كلمة مرور أكثر أماناً`,
    });

const optionalText = (max: number) =>
  z.string().trim().max(max, 'النص طويل جداً').optional();

const httpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(4096, `${label} طويل جداً`)
    // Embedded base64 images are rejected outright: a single pasted data URL
    // can be megabytes, trips the 1MB JSON body limit (413), and bloats
    // every menu payload served to guests. Images must travel through
    // POST /api/uploads/image; only the returned /uploads/… path is stored.
    .refine((value) => !value.toLowerCase().startsWith('data:'), {
      message: `${label}: الصور المضمّنة كنص (base64) غير مسموحة — ارفع الصورة عبر زر الرفع من جهازك ثم احفظ`,
    })
    .refine(
      (value) => {
        if (!value) return true;
        // Same-origin path (e.g. /uploads/…). Protocol-relative `//host`
        // URLs are rejected — they inherit the scheme and can point anywhere.
        if (value.startsWith('/')) return !value.startsWith('//');
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

/**
 * Image asset reference (branding/theme fields: logo, cover, map image,
 * gallery entries).
 *
 * Accepts every form the persistence contract understands:
 *   - the stable storage path returned by POST /api/uploads/image —
 *     `restaurants/{tenant}/{folder}/{uuid}{ext}` — the canonical value
 *     the database persists;
 *   - same-origin paths (legacy `/uploads/…` rows);
 *   - absolute http(s) URLs (external CDN/Unsplash references);
 *   - empty string (explicit "remove this image").
 *
 * Rejects embedded base64 payloads (data:), blob:/script schemes and
 * protocol-relative URLs — the same rules as httpsUrl, extended with the
 * storage-path form. The ROUTE then applies the strict normalization
 * contract (normalizeAssetReference) before anything is persisted, so
 * this schema is the outer bound, not the single source of truth.
 */
const assetReference = (label: string) =>
  z
    .string()
    .trim()
    .max(4096, `${label} طويل جداً`)
    .refine((value) => !value.toLowerCase().startsWith('data:'), {
      message: `${label}: الصور المضمّنة كنص (base64) غير مسموحة — ارفع الصورة عبر زر الرفع من جهازك ثم احفظ`,
    })
    .refine(
      (value) => {
        if (!value) return true;
        // Stable storage path (canonical persisted form).
        if (value.startsWith('restaurants/')) {
          return (
            !value.includes('..') &&
            !value.includes('\\') &&
            !value.includes('://') &&
            !value.includes('//')
          );
        }
        // Same-origin path (e.g. /uploads/…). Protocol-relative `//host`
        // URLs are rejected — they inherit the scheme and can point anywhere.
        if (value.startsWith('/')) return !value.startsWith('//');
        if (/^(?:blob|file|javascript|vbscript):/i.test(value)) return false;
        try {
          const url = new URL(value);
          return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
          return false;
        }
      },
      { message: `${label} يجب أن يكون رابطاً صالحاً للصورة` }
    )
    .optional();

/**
 * Promo video URL (audit H-04).
 *
 * `promoVideoUrl` is rendered by the customer hero into an <iframe src> when
 * it looks like a YouTube link, and into a <video src> otherwise. Accepting
 * an arbitrary string there let a compromised/malicious manager point the
 * frame at attacker-controlled HTML, which renders inside the tenant's page
 * for every guest scanning a QR code (phishing for the table PIN, fake
 * payment prompts, clickjacking over the ordering UI). `javascript:` and
 * `data:text/html` values were likewise unfiltered.
 *
 * Fix: https-only, plus a host allowlist for the embeddable providers the
 * product actually supports. Direct video files are allowed only from the
 * same origin or the app's own upload path.
 */
const VIDEO_HOST_ALLOWLIST = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/**
 * Extract an 11-character YouTube video id from any supported YouTube shape:
 * `watch?v=`, `embed/`, `shorts/`, `live/`, `v/` and `youtu.be/<id>`.
 * Returns null when the URL is not a well-formed YouTube video link.
 */
export function extractYoutubeVideoId(value: string): string | null {
  const match = value.match(
    /(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})/
  );
  return match ? (match[1] || match[2]) : null;
}

export function isAllowedPromoVideoUrl(value: string): boolean {
  if (!value) return true;
  // Only YouTube links are accepted for the promo/ambience video. Anything
  // else — Vimeo, raw file paths, arbitrary HTML — is rejected so a
  // malicious/typo'd value can never be rendered as an active frame.
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // Blocks javascript:, data:, vbscript:, file: and plaintext http.
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (!VIDEO_HOST_ALLOWLIST.has(url.hostname.toLowerCase())) return false;
  // Require a valid 11-character YouTube video id so the link is playable.
  return extractYoutubeVideoId(value) !== null;
}

/**
 * A manager-supplied map link (e.g. `https://maps.app.goo.gl/…`). It is only
 * ever opened in a new tab / inside a Google Maps embed, never interpolated
 * raw into an <iframe src> of attacker-controllable HTML. https-only and
 * credential-free, but the host itself is unrestricted (Google Maps, Waze,
 * Apple Maps, …).
 */
export function isAllowedMapUrl(value: string): boolean {
  if (!value) return true;
  if (value.startsWith('/')) return !value.startsWith('//');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return true;
}

const promoVideoUrl = z
  .string()
  .trim()
  .max(1000, 'رابط الفيديو طويل جداً')
  .refine(isAllowedPromoVideoUrl, {
    message:
      'رابط الفيديو يجب أن يكون رابط يوتيوب صحيحاً (مثل https://www.youtube.com/watch?v=...)',
  });

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'اللون يجب أن يكون بصيغة HEX مثل #D4AF37')
  .optional();

export const strongPassword = (_minMsg?: string) =>
  safePasswordSchema('كلمة المرور', 8);

// ============================================================
// Employee authentication policy (2026-09 redesign)
//
// Shift staff (WAITER / KITCHEN / CASHIER / STAFF) authenticate with:
//     restaurant code (public slug) + username (per tenant) + 6-digit PIN.
// Managers / platform staff authenticate with email + strong password.
//
// The legacy 4-digit PIN and the derived `Staff-{PIN}!` passwords are gone.
// ============================================================

/** Employee PIN is EXACTLY six numeric digits. */
export const EMPLOYEE_PIN_LENGTH = 6;

/**
 * Weak-PIN policy (documented, deliberately small — do not over-restrict):
 *   1. all six digits identical            (000000, 111111, …)
 *   2. ascending / descending keyboard run (012345…567890, 987654…098765)
 *   3. two-digit block repeated 3×         (121212, 424242, …)
 *   4. three-digit block repeated 2×       (123123, 789789, …)
 *   5. a few famous patterns               (112233)
 */
export function isWeakEmployeePin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if ('0123456789'.includes(pin)) return true;
  if ('9876543210'.includes(pin)) return true;
  if (/^(\d{2})\1\1$/.test(pin)) return true;
  if (/^(\d{3})\1$/.test(pin)) return true;
  return pin === '112233';
}

/** Login-comparison shape: 6 digits, no weak check (stored PINs are vetted at creation). */
export const employeePinLoginSchema = z
  .string()
  .regex(/^\d{6}$/, 'رمز PIN يجب أن يكون 6 أرقام');

/** Creation/update shape: 6 digits AND not obviously predictable. */
export const employeePinSchema = z
  .string()
  .regex(/^\d{6}$/, 'رمز PIN يجب أن يكون 6 أرقام بالضبط')
  .refine((pin) => !isWeakEmployeePin(pin), {
    message: 'رمز PIN ضعيف ومتوقع (متسلسل أو مكرر) — اختر رقماً أصعب تخميناً',
  });

/**
 * Username identifiers (NOT secrets — typed in the open on shared devices).
 * Lowercase [a-z0-9._-], 2–32 chars, unique per restaurant, case-insensitive
 * by normalization to lowercase.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(2, 'اسم المستخدم قصير جداً')
  .max(32, 'اسم المستخدم طويل جداً')
  .regex(/^[a-zA-Z0-9._-]+$/, 'اسم المستخدم يقبل الأحرف والأرقام و . _ - فقط')
  .transform((value) => value.toLowerCase());

/** Restaurant code = the venue's public slug (identifier, not a secret). */
export const restaurantCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'رمز المطعم غير صالح')
  .max(64, 'رمز المطعم غير صالح')
  .regex(/^[a-z0-9-]+$/, 'رمز المطعم يقبل الأحرف والأرقام والشرطة فقط');

/**
 * Employee login: restaurant code + username + 6-digit PIN.
 * Tenant resolution is 100% server-side from the code — the client never
 * supplies a restaurantId to this route.
 */
export const employeeLoginSchema = z
  .object({
    restaurantCode: restaurantCodeSchema,
    username: usernameSchema,
    pin: employeePinLoginSchema,
  })
  .strict();

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
      .toLowerCase()
      .max(254)
      .email('صيغة البريد الإلكتروني غير صحيحة'),
    password: z
      .string()
      .min(1, 'كلمة المرور مطلوبة')
      .max(128, 'كلمة المرور طويلة جداً'),
  })
  .strict();

export const stepUpSchema = z
  .object({
    // Manager/platform: current password. Shift staff: current PIN.
    password: z.string().min(1).max(128).optional(),
    pin: employeePinLoginSchema.optional(),
  })
  .strict();

// ---------------- Staff ----------------

export const staffCreateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    name: safeName('اسم الموظف'),
    // Email: managers/platform only (password login). Shift staff get NO
    // email — synthetic emails minted as auth identifiers are gone (AUTH-01).
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .email('صيغة البريد الإلكتروني غير صحيحة')
      .optional(),
    // Username: required for shift staff (employee login identity).
    username: usernameSchema.optional(),
    // Strong password: REQUIRED for RESTAURANT_MANAGER. REJECTED for shift
    // roles — staff never carry passwords (killed Staff-{PIN}! at the API).
    password: safePasswordSchema('كلمة المرور', 8).optional(),
    // 6-digit non-weak PIN: required for shift roles, optional for managers.
    pin: employeePinSchema.optional(),
    role: z.enum(TENANT_ASSIGNABLE_ROLES, 'دور غير صالح'),
  })
  .strict();

export const staffUpdateSchema = z
  .object({
    restaurantId: idSchema.optional(),
    name: safeName('اسم الموظف').optional(),
    // Email can be set when a staff member is promoted to a manager role.
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .email('صيغة البريد الإلكتروني غير صحيحة')
      .optional(),
    username: usernameSchema.optional(),
    role: z.enum(TENANT_ASSIGNABLE_ROLES, 'دور غير صالح').optional(),
    status: z.enum(USER_STATUSES, 'حالة غير صالحة').optional(),
    password: safePasswordSchema('كلمة المرور', 8).optional(),
    // 6-digit non-weak PIN, or '' to clear (employee loses PIN login).
    pin: z
      .union([employeePinSchema, z.literal('')])
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
    // Dish photo: the value the client persists is the STABLE storage key
    // returned by POST /api/uploads/image (`pathUrl`), so the field must accept
    // the asset-reference form (key | managed URL | legacy /uploads/… |
    // external URL) — never a base64/blob payload. The route re-normalizes it
    // through normalizeAssetReference before anything is written.
    image: assetReference('صورة الطبق'),
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
    // Both aliases accept the persisted reference form (see productCreateSchema).
    image: assetReference('صورة الطبق'),
    imageUrl: assetReference('صورة الطبق'),
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
    // Optional when transitioning (ignored for flow transitions); for
    // CANCELLED it is recorded on the order and in the audit event.
    reason: optionalText(200),
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
    clientRequestId: z.string().uuid('معرّف إرسال الطلب غير صالح').optional(),
    items: z.array(orderItemSchema).min(1).max(50),
    notes: optionalText(1000),
  })
  .strict();

export const posOrderSchema = z
  .object({
    restaurantId: idSchema.optional(),
    tableId: idSchema,
    clientRequestId: z.string().uuid('معرّف إرسال طلب الكاشير غير صالح').optional(),
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
    // A device may present its already-issued session capability after a
    // reload. The server can then restore read-only order tracking without
    // reopening a CLOSED table session or exposing it to a fresh QR scan.
    resumeSessionToken: z.string().trim().min(8).max(200).optional(),
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
    // Offer photo: same reference contract as dish photos (the route folds a
    // managed URL into its storage key and refuses transient payloads).
    image: assetReference('صورة العرض'),
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

// ---------------------------------------------------------------------------
// Customer transfer payment details (Restaurant settings).
//
// The venue's RECEIVING side of a transfer payment: where the guest sends the
// money when he chooses «حوالة بنكية» or «محفظة إلكترونية» in the guest modal.
// These are display settings, never financial data — the settlement path, the
// fulfillment gate, the Payment ledger and the cashier's verify/reject decision
// read none of them (the cashier verifies the money against the guest's
// receipt, not against these strings).
//
// Contract, identical to every other branding field:
//   field omitted → UNCHANGED (Prisma `undefined`)
//   ''            → EXPLICIT clear (the route writes NULL)
//   value         → bounded, trimmed, character-restricted
//
// Every value ends up rendered as text inside the GUEST transfer modal, so the
// same character policy as `customerNameSchema` applies: control characters and
// angle brackets are refused by code point (no markup/layout smuggling), while
// React's own escaping stays the second line of defence.
// ---------------------------------------------------------------------------

/** Bounds for the free-text transfer fields (bank/wallet/holder names). */
export const MIN_TRANSFER_NAME_LENGTH = 2;
export const MAX_TRANSFER_NAME_LENGTH = 80;
/** IBAN / bank account number: letters, digits and the grouping spaces. */
export const MIN_TRANSFER_ACCOUNT_LENGTH = 6;
export const MAX_TRANSFER_ACCOUNT_LENGTH = 40;
/** Wallet phone number OR wallet account identifier (not always a phone). */
export const MIN_TRANSFER_WALLET_DIGITS = 6;
export const MAX_TRANSFER_WALLET_DIGITS = 32;
export const MAX_TRANSFER_INSTRUCTIONS_LENGTH = 500;

/** True when every code point is printable text (no control chars, no `<`/`>`). */
const isPrintableText = (value: string, allowNewline = false) =>
  [...value].every((char) => {
    const code = char.codePointAt(0) ?? 0;
    if (char === '<' || char === '>' || code === 0x7f) return false;
    if (allowNewline && char === '\n') return true;
    return code >= 0x20;
  });

/**
 * A transfer name/label field (bank name, wallet name, account holder name).
 * `''` is the explicit clear signal, so it bypasses the minimum length.
 */
const transferNameField = (label: string) =>
  z
    .string()
    .trim()
    .max(MAX_TRANSFER_NAME_LENGTH, `${label} طويل جداً — بحد أقصى ${MAX_TRANSFER_NAME_LENGTH} حرفاً`)
    .refine((value) => value === '' || [...value].length >= MIN_TRANSFER_NAME_LENGTH, {
      message: `${label} قصير جداً — حرفان على الأقل`,
    })
    .refine((value) => isPrintableText(value), {
      message: `${label} يحتوي محارف غير صالحة`,
    })
    .optional();

/**
 * IBAN / bank account number. Letters, digits and grouping spaces only: an
 * account number is copied by a guest into his banking app, so punctuation
 * that no bank accepts (and markup that could be rendered) is refused here
 * instead of being stored. Stored exactly as entered (spaces preserved).
 */
const transferAccountField = (label: string) =>
  z
    .string()
    .trim()
    .max(MAX_TRANSFER_ACCOUNT_LENGTH, `${label} طويل جداً — بحد أقصى ${MAX_TRANSFER_ACCOUNT_LENGTH} خانة`)
    .refine((value) => value === '' || /^[A-Za-z0-9][A-Za-z0-9 ]*[A-Za-z0-9]$/.test(value), {
      message: `${label} يجب أن يتكون من أرقام وحروف إنجليزية فقط`,
    })
    .refine(
      (value) =>
        value === '' ||
        value.replace(/ /g, '').length >= MIN_TRANSFER_ACCOUNT_LENGTH,
      { message: `${label} قصير جداً — ${MIN_TRANSFER_ACCOUNT_LENGTH} خانات على الأقل` }
    )
    .optional();

/**
 * Wallet number: the wallet's PHONE number or its account identifier.
 * Deliberately NOT normalized through `normalizeCustomerPhone` — wallet
 * identifiers are not always phone numbers — but still bounded to digits with
 * the separators people actually type (`+`, space, dash).
 */
const transferWalletNumberField = (label: string) =>
  z
    .string()
    .trim()
    .max(MAX_TRANSFER_ACCOUNT_LENGTH, `${label} طويل جداً — بحد أقصى ${MAX_TRANSFER_ACCOUNT_LENGTH} خانة`)
    .refine((value) => value === '' || /^\+?[0-9][-0-9 ]*[0-9]$/.test(value), {
      message: `${label} يجب أن يتكون من أرقام فقط (يمكن البدء بـ +)`,
    })
    .refine((value) => {
      if (value === '') return true;
      const digits = value.replace(/\D/g, '');
      return (
        digits.length >= MIN_TRANSFER_WALLET_DIGITS &&
        digits.length <= MAX_TRANSFER_WALLET_DIGITS
      );
    }, {
      message: `${label} غير صالح — بين ${MIN_TRANSFER_WALLET_DIGITS} و${MAX_TRANSFER_WALLET_DIGITS} خانة`,
    })
    .optional();

/**
 * Optional guest-facing instructions. Newlines are allowed (a venue writes
 * "اكتب رقم الطاولة في ملاحظة التحويل" on its own line); every other control
 * character and both angle brackets are refused.
 */
const transferInstructionsField = (label: string) =>
  z
    .string()
    .trim()
    .max(
      MAX_TRANSFER_INSTRUCTIONS_LENGTH,
      `${label} طويلة جداً — بحد أقصى ${MAX_TRANSFER_INSTRUCTIONS_LENGTH} حرفاً`
    )
    .refine((value) => isPrintableText(value, true), {
      message: `${label} تحتوي محارف غير صالحة`,
    })
    .optional();

/**
 * The seven transfer-detail fields, declared once and spread into
 * `brandingSchema` (which is `.strict()`: an undeclared key would 400 the whole
 * branding save). NOT part of any paid entitlement — a venue must be able to
 * publish its own account on the free plan.
 */
export const transferDetailsShape = {
  transferBankName: transferNameField('اسم البنك'),
  transferBankAccount: transferAccountField('رقم الحساب / IBAN'),
  transferBankAccountHolder: transferNameField('اسم صاحب الحساب البنكي'),
  transferWalletName: transferNameField('اسم المحفظة'),
  transferWalletNumber: transferWalletNumberField('رقم المحفظة'),
  transferWalletAccountHolder: transferNameField('اسم صاحب المحفظة'),
  transferInstructions: transferInstructionsField('تعليمات التحويل'),
} as const;

export const brandingSchema = z
  .object({
    restaurantId: idSchema.optional(),
    name: safeName('اسم المطعم').optional(),
    nameEn: optionalText(120),
    description: optionalText(2000),
    phone: optionalText(60),
    address: optionalText(300),
    logo: assetReference('رابط الشعار'),
    coverImage: assetReference('رابط الغلاف'),
    currency: z.string().trim().max(8).optional(),
    language: z.enum(['ar', 'en']).optional(),
    timezone: z.string().trim().max(60).optional(),
    primaryColor: hexColor,
    accentColor: hexColor,
    // Logo framing: how the uploaded logo sits inside its fixed box. `logoFit`
    // is crop-to-fill vs fit-whole; `logoPosition` is a CSS object-position
    // anchor (9-point grid). Both default to the legacy "cover + centered".
    logoFit: z.enum(['cover', 'contain']).optional(),
    logoPosition: z
      .enum([
        '0% 0%', '50% 0%', '100% 0%',
        '0% 50%', '50% 50%', '100% 50%',
        '0% 100%', '50% 100%', '100% 100%',
      ])
      .optional(),
    // Map location: lat/lng pin the customer map to the venue's real position;
    // mapUrl is an optional Google Maps share link the guest can open for
    // turn-by-turn directions. Both are optional so existing tenants are
    // unaffected until they fill them in.
    latitude: z
      .number()
      .min(-90, 'خط العرض غير صالح')
      .max(90, 'خط العرض غير صالح')
      .optional(),
    longitude: z
      .number()
      .min(-180, 'خط الطول غير صالح')
      .max(180, 'خط الطول غير صالح')
      .optional(),
    mapUrl: z
      .string()
      .trim()
      .max(1000, 'رابط الخريطة طويل جداً')
      .refine(isAllowedMapUrl, {
        message: 'رابط الخريطة يجب أن يكون رابط HTTPS صالحاً',
      })
      .optional()
      .or(z.literal('')),
    // Static map/location image (uploaded via POST /api/uploads/image). Shows
    // guests the venue's location without an external map embed.
    mapImage: assetReference('رابط صورة الخريطة'),
    // Venue kind: drives how the guest QR experience is composed. Kept in the
    // branding payload because that is the screen where a tenant describes
    // itself, and `.strict()` would otherwise reject the new field.
    businessType: z.enum(['RESTAURANT', 'CAFE', 'BAKERY']).optional(),
    promoVideoUrl: promoVideoUrl.optional().or(z.literal('')),
    // Gallery entries are rendered as <img src>; constrain them to the same
    // asset-reference rules used for logo and cover (audit H-04).
    galleryImages: z
      .array(assetReference('رابط صورة المعرض').unwrap())
      .max(30)
      .optional(),
    // Customer transfer payment details (bank / wallet receiving account shown
    // to the guest). Same write contract as every field above: omitted =
    // unchanged, '' = explicit clear. Declared here because `.strict()` would
    // otherwise 400 the entire branding save. Deliberately OUTSIDE the paid
    // `CAN_CUSTOM_BRANDING` entitlement check in the route.
    ...transferDetailsShape,
  })
  .strict();

/**
 * Table settlement (audit H-05).
 *
 * `POST /tables/:id/settle` previously read `paymentMethod` and `note`
 * straight off `req.body` with no `validateBody`, so a cashier could write
 * an arbitrary-length, arbitrary-content string into the payment ledger
 * (receipt forgery, log/CSV injection into finance exports) and free-text
 * values silently bypassed cash-vs-card reconciliation reporting.
 */
export const tableSettleSchema = z
  .object({
    // Every manager call in `src/services/api.ts` carries the tenant id in its
    // body. It is DECLARED-OPTIONAL here (never rejected) and IGNORED by the
    // route: the tenant of a settlement is the table's own `restaurantId`
    // checked against the JWT (`ownTenant`), so this key can neither widen nor
    // redirect the operation. Leaving it out of a `.strict()` body instead makes
    // the whole endpoint unusable — which is how «تصفية الطاولة» broke.
    restaurantId: idSchema.optional(),
    // Reuse the canonical ledger enum so settlement and the payments
    // endpoint can never drift apart in reconciliation reports.
    paymentMethod: z
      .enum(PAYMENT_METHODS, { message: 'طريقة الدفع غير صالحة' })
      .default('CASH'),
    // Tendered cash for CASH settlements. Optional for backwards
    // compatibility (legacy clients simply close the table with exact cash);
    // when supplied it MUST cover the bill and the change is computed
    // server-side. The route rejects short payments.
    cashReceived: moneySchema.optional(),
    tip: moneySchema.optional(),
    note: z.string().trim().max(500, 'الملاحظة طويلة جداً').optional(),
  })
  .strict();

export const planChangeSchema = z
  .object({
    restaurantId: idSchema.optional(),
    planId: idSchema,
  })
  .strict();

// Platform admin granting the free 7-day limited trial to a tenant.
export const trialActivationSchema = z
  .object({
    restaurantId: idSchema.optional(),
    note: optionalText(300),
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

// Void (reverse) an existing ledger receipt — the covered orders return to
// UNPAID and become cancellable/collectable again. The receipt row itself is
// never deleted or rewritten (immutable ledger); the void is a marker.
export const paymentVoidSchema = z
  .object({
    restaurantId: idSchema.optional(),
    reason: optionalText(200),
  })
  .strict();

// ---------------------------------------------------------------------------
// Transfer payment proof (customer) + cashier verification
// ---------------------------------------------------------------------------

/**
 * Guest phone. Normalized through the SAME function that the storage layer
 * uses (server/utils/phone.ts), so a value can never be persisted in a shape
 * the retention/validation contract would reject. REQUIRED for a transfer
 * notice: the cashier must be able to reach the guest about the transfer
 * (a receipt the cashier cannot match is not verifiable).
 */
export const customerPhoneSchema = z
  .string()
  .trim()
  .min(1, 'رقم الهاتف المحمول مطلوب')
  .max(
    MAX_PHONE_INPUT_LENGTH,
    'رقم الهاتف طويل جداً — أدخل رقماً صحيحاً بحد أقصى 15 خانة'
  )
  .refine(
    (value) => normalizeCustomerPhone(value) !== null,
    { message: 'رقم الهاتف غير صالح — أدخل رقماً حقيقياً (مثال: 0599123456)' }
  );

/**
 * Guest name as typed on the transfer notice. Free text, but bounded: it is
 * stored (operational PII, purged by retention) and shown to the cashier, so
 * control characters / markup / absurd lengths are refused instead of stored.
 */
export const MAX_CUSTOMER_NAME_LENGTH = 60;

export const customerNameSchema = z
  .string()
  .trim()
  .min(2, 'اسم العميل مطلوب (حرفان على الأقل)')
  .max(MAX_CUSTOMER_NAME_LENGTH, 'الاسم طويل جداً — بحد أقصى 60 حرفاً')
  // Control characters (newlines/tabs/NUL) and angle brackets are refused by
  // code point instead of a regex: the value is stored and later rendered in
  // the cashier's screen, so it must not be able to smuggle markup or layout.
  .refine(
    (value) =>
      [...value].every((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code >= 0x20 && code !== 0x7f && char !== '<' && char !== '>';
      }),
    { message: 'اسم العميل يحتوي محارف غير صالحة' }
  );

/** How the guest says the money was moved. Never a financial value. */
export const TRANSFER_CHANNELS = ['BANK', 'WALLET'] as const;

export const transferChannelSchema = z
  .enum(TRANSFER_CHANNELS, 'قناة التحويل غير صالحة')
  .optional()
  .default('BANK');

/**
 * Multipart body of POST /api/public/orders/:orderId/payment-proof.
 * The receipt image travels as the `proof` file part (validated by magic
 * bytes); these fields are the text parts. Every field is a hint the server
 * re-resolves against the QR session and the order — none of them is trusted
 * for authorization, tenancy or money.
 *
 * `customerName` + `customerPhone` are REQUIRED: a transfer notice the cashier
 * cannot attribute to a person/phone is not verifiable. `transferChannel`
 * (BANK | WALLET) is a display hint for the cashier and defaults to BANK.
 */
export const paymentProofSchema = z
  .object({
    restaurantId: idSchema,
    tableId: idSchema,
    sessionToken: z.string().trim().min(1, 'جلسة الطاولة مطلوبة').max(200),
    customerName: customerNameSchema,
    customerPhone: customerPhoneSchema,
    transferChannel: transferChannelSchema,
  })
  .strict();

/**
 * Cashier confirmation of a transfer receipt.
 *
 * `restaurantId` is part of this schema for ONE reason: the shared API client
 * (`src/services/api.ts`) appends the tenant id to every manager body, and a
 * `.strict()` object rejects unknown keys — not declaring it here turned every
 * «تأكيد الدفع» click at the till into an HTTP 400 that the panel surfaced as
 * «تعذر تأكيد الدفع», with the guest notification left neither confirmed nor
 * rejected. The value is accepted and IGNORED: the route resolves the order
 * through `getTenantId(req)` + `ownTenant(...)`, so a body can never choose or
 * widen a tenant. Same convention as every other manager schema.
 */
export const paymentConfirmSchema = z
  .object({
    restaurantId: idSchema.optional(),
    note: optionalText(300),
  })
  .strict();

/**
 * Cashier rejection of a transfer receipt. `restaurantId` is accepted for the
 * same reason as above (client convention) and never read by the route — its
 * absence made «رفض الإشعار» fail with «تعذر رفض الإشعار» and left the order
 * held by the payment gate forever.
 */
export const paymentRejectSchema = z
  .object({
    restaurantId: idSchema.optional(),
    reason: optionalText(300),
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
    managerPassword: safePasswordSchema('كلمة مرور المدير', 8).optional(),
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
