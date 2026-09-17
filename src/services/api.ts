import {
  Restaurant,
  Plan,
  Subscription,
  RestaurantUser,
  Category,
  Product,
  RestaurantTable,
  Order,
  OrderStatus,
  WaiterRequest,
  Offer,
  TableSession,
  AuditLog,
  PaymentRecord,
  PaymentVerificationItem,
  PaymentStatus,
  FulfillmentState,
  TransferChannel,
  Branch,
  EntitlementKey,
} from '../types/restaurant';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}

/** Pagination/scope metadata returned by GET /api/manager/orders (H-03). */
export interface ManagerOrdersMeta {
  scope?: string;
  liveCount?: number;
  liveTotal?: number;
  liveHasMore?: boolean;
  historyCount?: number;
  historyTotal?: number;
  historyHasMore?: boolean;
  closedWindowHours?: number;
}

const configuredApiUrl = import.meta.env.VITE_API_URL
  ?.replace(/\/+$/, '')
  .replace(/\/api$/, '');
const API_BASE = typeof window !== 'undefined'
  ? `${configuredApiUrl || ''}/api`
  : 'http://localhost:3001/api';

// Origin of the REST backend (used to absolutize stored asset URLs such as /uploads/…).
const API_ORIGIN = (configuredApiUrl || '').replace(/\/+$/, '')
  || (typeof window !== 'undefined' ? window.location.origin : '');

/** Resolve browser-managed connections (notably EventSource) against the
 * configured API origin. A relative SSE URL would otherwise hit the static
 * frontend host in split Render/Vercel deployments. */
export function apiConnectionUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${configuredApiUrl || ''}${normalized}`;
}

/**
 * True when `value` is a stable storage path (object key) as persisted in
 * PostgreSQL — `restaurants/{tenant}/{folder}/{uuid}{ext}`. A key is NOT
 * renderable by itself: the server resolves it to a URL in every response,
 * and this guard makes sure a stray key is never mangled into a bogus
 * origin-relative URL by absoluteAssetUrl().
 */
export function isStorageKeyRef(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim().startsWith('restaurants/') &&
    !value.includes('://') &&
    !value.includes('//') &&
    !value.includes('..')
  );
}

/**
 * Central client-side normalization of a server-provided asset value into a
 * renderable src (the single client resolver — no component builds asset
 * URLs on its own):
 *   - absolute http(s) / data: / blob: values pass through untouched;
 *   - relative paths (legacy `/uploads/…`) are resolved against the API
 *     origin (split frontend/API deployments);
 *   - bare storage keys are returned as '' (they are never renderable
 *     client-side; the server always ships the resolved URL alongside).
 */
export function absoluteAssetUrl(url: string | null | undefined): string {
  if (!url) return '';
  const v = String(url).trim();
  if (isStorageKeyRef(v)) return '';
  if (/^(https?:\/\/|data:|blob:)/i.test(v)) return v;
  return `${API_ORIGIN}${v.startsWith('/') ? v : `/${v}`}`;
}

export const AUTH_TOKEN_KEY = 'merar_auth_token';

export function newClientRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // RFC 4122 v4 fallback for older embedded browsers; this is an idempotency
  // identifier, not an authentication secret.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

// A pasted/legacy base64 data URL (megabytes of text) must never be sent
// back inside a JSON save payload — it trips the server's 1MB body limit
// (413) and bloats every guest menu response. The canonical flow is:
// upload the file via uploadImage(), then persist the returned /uploads/… path.
export const EMBEDDED_IMAGE_ERROR =
  'تم اكتشاف صورة مضمّنة كنص ثقيل (base64) — أعد رفع الصورة عبر زر الرفع من جهازك ثم احفظ مجدداً';

export function isEmbeddedImage(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim().toLowerCase().startsWith('data:')
  );
}

// ============================================================================
// Helpers — server rows (Prisma/PostgreSQL) -> typed client domain models
// ============================================================================

function toISO(value: unknown): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export function mapRestaurantRow(raw: any): Restaurant {
  return {
    id: raw.id,
    name: raw.name,
    nameEn: raw.nameEn || raw.name,
    slug: raw.slug,
    logo: absoluteAssetUrl(raw.logoUrl || raw.logo || ''),
    // The persistence pair: the stable path PostgreSQL holds (additive —
    // absent on legacy payloads). Never rendered directly; present so the
    // client can tell a resolved URL from a raw row and round-trips stay
    // byte-identical to what the server stores.
    logoStoragePath: typeof raw.logoStoragePath === 'string' && raw.logoStoragePath ? raw.logoStoragePath : undefined,
    logoFit: raw.logoFit === 'contain' ? 'contain' : 'cover',
    logoPosition: typeof raw.logoPosition === 'string' && raw.logoPosition.trim() ? raw.logoPosition : '50% 50%',
    coverImage: absoluteAssetUrl(raw.coverImageUrl || raw.coverImage || '') || undefined,
    coverStoragePath: typeof raw.coverStoragePath === 'string' && raw.coverStoragePath ? raw.coverStoragePath : undefined,
    description: raw.description || '',
    phone: raw.phone || '',
    address: raw.address || '',
    // Keep geo fields undefined when unset so the map can fall back to the
    // venue's address instead of silently pinning a platform default.
    latitude: raw.latitude != null ? Number(raw.latitude) : undefined,
    longitude: raw.longitude != null ? Number(raw.longitude) : undefined,
    mapUrl: raw.mapUrl || undefined,
    mapImageUrl: raw.mapImageUrl ? absoluteAssetUrl(raw.mapImageUrl) : undefined,
    mapStoragePath: typeof raw.mapStoragePath === 'string' && raw.mapStoragePath ? raw.mapStoragePath : undefined,
    currency: raw.currency || '₪',
    language: (raw.language || 'ar') === 'en' ? 'en' : 'ar',
    timezone: raw.timezone || 'Asia/Jerusalem',
    status: raw.status,
    // Older cached rows predate the column; fall back to the venue default
    // rather than leaving the guest experience without a defined kind.
    businessType:
      raw.businessType === 'CAFE' || raw.businessType === 'BAKERY'
        ? raw.businessType
        : 'RESTAURANT',
    primaryColor: raw.primaryColor || '#D4AF37',
    accentColor: raw.accentColor || '#C5A880',
    promoVideoUrl: raw.promoVideoUrl || undefined,
    galleryImages: Array.isArray(raw.galleryImages) ? raw.galleryImages.map(absoluteAssetUrl) : [],
    // Stable paths for the gallery images (same order as galleryImages).
    galleryStoragePaths: Array.isArray(raw.galleryStoragePaths)
      ? raw.galleryStoragePaths.filter((p: unknown) => typeof p === 'string' && p)
      : undefined,
    planId: raw.planId || '',
    customDomain: raw.customDomain || undefined,
    createdAt: toISO(raw.createdAt),
    updatedAt: toISO(raw.updatedAt),
  };
}

export function mapUserRow(raw: any): RestaurantUser {
  return {
    id: raw.id,
    restaurantId: raw.restaurantId ?? null,
    name: raw.name,
    email: raw.email,
    role: raw.role,
    avatar: raw.avatar || undefined,
    createdAt: toISO(raw.createdAt),
  };
}

export function mapPlanRow(raw: any): Plan {
  return {
    id: raw.id,
    name: raw.name,
    nameEn: raw.nameEn || raw.name,
    priceMonthly: Number(raw.priceMonthly) || 0,
    priceYearly: Number(raw.priceYearly) || 0,
    maxTables: raw.maxTables ?? 50,
    maxCategories: raw.maxCategories ?? 20,
    maxProducts: raw.maxProducts ?? 150,
    maxBranches: raw.maxBranches ?? 3,
    entitlements: (raw.entitlements as EntitlementKey[]) || [],
    description: raw.description || '',
    isPopular: raw.isPopular || false,
    trialDays: Number(raw.trialDays) || 0,
  };
}

export function mapSubscriptionRow(raw: any): Subscription {
  return {
    id: raw.id,
    restaurantId: raw.restaurantId,
    planId: raw.planId,
    status: raw.status,
    currentPeriodStart: toISO(raw.currentPeriodStart),
    currentPeriodEnd: toISO(raw.currentPeriodEnd),
    cancelAtPeriodEnd: raw.cancelAtPeriodEnd || false,
    trialEndsAt: raw.trialEndsAt ? toISO(raw.trialEndsAt) : undefined,
  };
}

export function mapCategoryRow(raw: any): Category {
  return {
    id: raw.id,
    restaurantId: raw.restaurantId,
    name: raw.name,
    nameEn: raw.nameEn || undefined,
    icon: raw.icon || undefined,
    sortOrder: raw.sortOrder ?? 0,
  };
}

export function mapProductRow(raw: any): Product {
  const options = Array.isArray(raw.options) ? raw.options : Array.isArray(raw.sizes) ? raw.sizes : [];
  const addOns = Array.isArray(raw.addOns) ? raw.addOns : [];
  return {
    id: raw.id,
    restaurantId: raw.restaurantId,
    categoryId: raw.categoryId,
    name: raw.name,
    nameEn: raw.nameEn || raw.name,
    description: raw.description || '',
    price: Number(raw.price) || 0,
    image: raw.imageUrl || raw.image || '',
    isAvailable: raw.isAvailable ?? raw.available ?? true,
    isFeatured: raw.isFeatured || false,
    badge: raw.badge || undefined,
    sizes: options.map((o: any) => ({
      id: o.id,
      name: o.name,
      nameEn: o.nameEn || undefined,
      price: Number(o.price ?? o.priceModifier) || 0,
      priceModifier: Number(o.priceModifier ?? o.price) || 0,
    })),
    addOns: addOns.map((a: any) => ({
      id: a.id,
      name: a.name,
      nameEn: a.nameEn || undefined,
      price: Number(a.price) || 0,
      isAvailable: a.isAvailable ?? true,
    })),
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients : undefined,
    removableIngredients: Array.isArray(raw.removableIngredients) ? raw.removableIngredients : undefined,
    allergens: Array.isArray(raw.allergens) ? raw.allergens : undefined,
    calories: raw.calories ?? undefined,
    preparationTimeMinutes: raw.preparationTimeMinutes ?? 15,
  };
}

export function mapTableRow(raw: any): RestaurantTable {
  return {
    id: raw.id,
    restaurantId: raw.restaurantId,
    tableNumber: Number(raw.number ?? raw.tableNumber) || 0,
    capacity: raw.capacity ?? 4,
    zone: raw.zone || 'MAIN_HALL',
    status: raw.status || 'AVAILABLE',
    qrToken: raw.qrToken || undefined,
    branchId: raw.branchId || undefined,
    activeOrderIds: Array.isArray(raw.activeOrderIds) ? raw.activeOrderIds : [],
    hasWaiterCall: raw.hasWaiterCall || false,
    lastActivityAt: raw.lastActivityAt ? toISO(raw.lastActivityAt) : undefined,
  };
}

export function mapOrderItemRow(i: any): Order['items'][number] {
  return {
    id: i.id || `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: i.productId || i.product?.id || '',
    name: i.productNameSnapshot || i.productName || i.name || undefined,
    nameEn: i.productNameEnSnapshot || i.productNameEn || i.nameEn || undefined,
    productName: i.productNameSnapshot || i.productName || i.name || '',
    productNameEn: i.productNameEnSnapshot || i.productNameEn || i.nameEn || undefined,
    productImage: i.productImage || undefined,
    unitPrice: Number(i.priceSnapshot ?? i.unitPrice) || 0,
    quantity: i.quantity ?? 1,
    selectedSize: i.selectedSize || undefined,
    selectedAddOns: Array.isArray(i.selectedAddOns) ? i.selectedAddOns : [],
    removedIngredients: Array.isArray(i.removedIngredients) ? i.removedIngredients : [],
    specialInstructions: i.specialInstructions || i.notes || i.itemNotes || undefined,
    totalPrice: Number(i.totalPrice) || 0,
  };
}

export function mapOrderRow(raw: any): Order {
  const items = Array.isArray(raw.items) ? raw.items.map(mapOrderItemRow) : [];
  return {
    id: raw.id,
    numericId: raw.numericId,
    restaurantId: raw.restaurantId,
    tableId: raw.tableId,
    tableNumber: raw.tableNumber !== undefined ? Number(raw.tableNumber) : undefined,
    tableName: raw.tableName || undefined,
    sessionId: raw.sessionId || undefined,
    items,
    subtotal: Number(raw.subtotal) || 0,
    tax: raw.tax !== undefined ? Number(raw.tax) : undefined,
    total: Number(raw.total) || 0,
    status: raw.status,
    paymentMethod: raw.paymentMethod || 'PAY AT CASHIER',
    paymentStatus: raw.paymentStatus || 'UNPAID',
    // Payment authorization boundary. `operational` is computed server-side;
    // a payload without it is a legacy payload (see utils/orderLifecycle.ts).
    fulfillmentState: raw.fulfillmentState || undefined,
    operational: typeof raw.operational === 'boolean' ? raw.operational : undefined,
    releasedAt: raw.releasedAt ? toISO(raw.releasedAt) : undefined,
    settledAt: raw.settledAt ? toISO(raw.settledAt) : undefined,
    // Proof state only — the private storage path and the guest phone never
    // travel to the browser (the receipt image is fetched through an
    // authenticated API call by the cashier screen).
    hasPaymentProof: Boolean(raw.hasPaymentProof),
    paymentRejected: Boolean(raw.paymentRejected),
    paymentRejectedReason: raw.paymentRejectedReason || undefined,
    paymentRejectedAt: raw.paymentRejectedAt ? toISO(raw.paymentRejectedAt) : undefined,
    cancelledAt: raw.cancelledAt ? toISO(raw.cancelledAt) : undefined,
    cancelReason: raw.cancelReason || undefined,
    notes: raw.notes || undefined,
    createdAt: toISO(raw.createdAt),
    updatedAt: toISO(raw.updatedAt),
    estimatedPrepMinutes: raw.estimatedPrepMinutes ?? undefined,
  };
}

export function mapWaiterRequestRow(raw: any): WaiterRequest {
  return {
    id: raw.id,
    restaurantId: raw.restaurantId,
    tableId: raw.tableId,
    sessionId: raw.sessionId || undefined,
    reason: raw.reason || 'ASSISTANCE',
    reasonText: raw.reasonText || undefined,
    createdAt: toISO(raw.createdAt),
    status: raw.status,
  };
}

export function mapOfferRow(raw: any): Offer {
  return {
    id: raw.id,
    restaurantId: raw.restaurantId,
    title: raw.title,
    titleEn: raw.titleEn || undefined,
    subtitle: raw.subtitle || undefined,
    description: raw.description || undefined,
    image: raw.image || undefined,
    originalPrice: raw.originalPrice !== null && raw.originalPrice !== undefined ? Number(raw.originalPrice) : undefined,
    discountedPrice: raw.discountedPrice !== null && raw.discountedPrice !== undefined ? Number(raw.discountedPrice) : undefined,
    discountPercentage: raw.discountPercentage !== null && raw.discountPercentage !== undefined ? Number(raw.discountPercentage) : undefined,
    badge: raw.badge || undefined,
    bgGradient: raw.bgGradient || undefined,
    isActive: raw.isActive ?? true,
    code: raw.code || undefined,
  };
}

export function mapPaymentRow(raw: any): PaymentRecord {
  return {
    id: raw.id,
    receiptNumber: raw.receiptNumber,
    restaurantId: raw.restaurantId,
    branchId: raw.branchId || undefined,
    tableId: raw.tableId,
    tableLabel: raw.tableLabel,
    orderIds: Array.isArray(raw.orderIds) ? raw.orderIds : [],
    itemsSummary: raw.itemsSummary || undefined,
    method: raw.method || 'CASH',
    subtotal: Number(raw.subtotal) || 0,
    tax: raw.tax !== undefined ? Number(raw.tax) : undefined,
    total: Number(raw.total) || 0,
    cashReceived: raw.cashReceived ?? undefined,
    changeDue: raw.changeDue ?? undefined,
    tip: raw.tip ?? undefined,
    cashierId: raw.cashierId || undefined,
    cashierName: raw.cashierName || '',
    note: raw.note || undefined,
    voidedAt: raw.voidedAt ? toISO(raw.voidedAt) : undefined,
    voidReason: raw.voidReason || undefined,
    createdAt: toISO(raw.createdAt),
  };
}

export function mapPaymentVerificationRow(raw: any): PaymentVerificationItem {
  return {
    orderId: raw.orderId || raw.id,
    numericId: raw.numericId !== undefined ? Number(raw.numericId) : undefined,
    restaurantId: raw.restaurantId,
    branchId: raw.branchId || undefined,
    tableId: raw.tableId,
    tableNumber: raw.tableNumber !== undefined ? Number(raw.tableNumber) : undefined,
    tableName: raw.tableName || undefined,
    orderStatus: raw.orderStatus || undefined,
    total: Number(raw.total) || 0,
    subtotal: Number(raw.subtotal) || 0,
    itemsCount: Number(raw.itemsCount) || 0,
    itemsSummary: raw.itemsSummary || undefined,
    items: Array.isArray(raw.items)
      ? raw.items.map((i: any) => ({
          productName: i.productName || i.name || '',
          quantity: Number(i.quantity) || 1,
          unitPrice: i.unitPrice !== undefined ? Number(i.unitPrice) : undefined,
          totalPrice: i.totalPrice !== undefined ? Number(i.totalPrice) : undefined,
          selectedSize: i.selectedSize || undefined,
          selectedAddOns: Array.isArray(i.selectedAddOns) ? i.selectedAddOns : [],
          removedIngredients: Array.isArray(i.removedIngredients) ? i.removedIngredients : [],
          specialInstructions: i.specialInstructions || undefined,
        }))
      : undefined,
    customerName: raw.customerName || undefined,
    customerPhone: raw.customerPhone || undefined,
    transferChannel: raw.transferChannel === 'WALLET' ? 'WALLET' : raw.transferChannel === 'BANK' ? 'BANK' : undefined,
    paymentMethod: raw.paymentMethod || 'TRANSFER',
    paymentStatus: raw.paymentStatus || 'PENDING_VERIFICATION',
    state: raw.state === 'WAITING_RECEIPT' ? 'WAITING_RECEIPT' : 'WAITING_VERIFICATION',
    fulfillmentState: raw.fulfillmentState || undefined,
    paymentRejected: Boolean(raw.paymentRejected),
    paymentRejectedReason: raw.paymentRejectedReason || undefined,
    hasPaymentProof: Boolean(raw.hasPaymentProof),
    submittedAt: toISO(raw.submittedAt || raw.updatedAt),
    createdAt: toISO(raw.createdAt),
  };
}

export function mapBranchRow(raw: any): Branch {
  return {
    id: raw.id,
    restaurantId: raw.restaurantId,
    name: raw.name,
    address: raw.address || undefined,
    phone: raw.phone || undefined,
    color: raw.color || undefined,
    isActive: raw.isActive ?? true,
    createdAt: toISO(raw.createdAt),
  };
}

export function mapAuditLogRow(raw: any): AuditLog {
  return {
    id: raw.id,
    restaurantId: raw.restaurantId || undefined,
    actor: raw.actor,
    actorRole: raw.actorRole,
    action: raw.action,
    details: raw.details,
    timestamp: toISO(raw.createdAt),
  };
}

function mapSessionRow(raw: any, restaurantId: string, tableId: string): TableSession {
  return {
    id: raw.sessionId || raw.id,
    restaurantId,
    tableId,
    sessionToken: raw.sessionToken,
    createdAt: toISO(raw.createdAt || new Date().toISOString()),
    expiresAt: toISO(raw.expiresAt || new Date(Date.now() + 6 * 3600 * 1000).toISOString()),
    status: raw.status || 'ACTIVE',
  };
}

// ============================================================================
// Live API client — the ONLY data source of the application.
// There is intentionally NO offline/mock/localStorage fallback anywhere here:
// every method talks to the Express + Prisma/PostgreSQL backend.
// ============================================================================

class RestaurantApiService {
  private getAuthToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(AUTH_TOKEN_KEY);
    }
    return null;
  }

  private getAuthHeader(): Record<string, string> {
    const token = this.getAuthToken();
    if (token) return { Authorization: `Bearer ${token}` };
    return {};
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    options: { body?: unknown; auth?: boolean; raw?: boolean } = {}
  ): Promise<ApiResponse<T>> {
    if (typeof window === 'undefined') {
      return { success: false, error: 'البيانات تُحمّل من الخادم فقط داخل المتصفح', statusCode: 503 };
    }
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        signal: AbortSignal.timeout(30_000),
        headers: {
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(options.auth === false ? {} : this.getAuthHeader()),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      const json = await res.json().catch(() => null);
      if (options.raw) return json as ApiResponse<T>;
      if (res.ok && json?.success) return json as ApiResponse<T>;
      if (json && typeof json === 'object' && 'error' in json) {
        return json as ApiResponse<T>;
      }
      return { success: false, error: 'تعذر الاتصال بالخادم', statusCode: res.status };
    } catch {
      return {
        success: false,
        error: 'تعذر الاتصال بقاعدة البيانات. تأكد من تشغيل الخادم والاتصال بالشبكة.',
        statusCode: 503,
      };
    }
  }

  // =========================================================================
  // AUTHENTICATION (real DB accounts only — no demo users)
  // =========================================================================

  public async onboardRestaurant(payload: Record<string, unknown>): Promise<ApiResponse<{ restaurant: Restaurant }>> {
    const res = await this.request<{ restaurant: Restaurant }>('POST', '/admin/onboard-restaurant', {
      body: payload,
    });
    if (res.success && res.data?.restaurant) {
      res.data.restaurant = mapRestaurantRow(res.data.restaurant);
    }
    return res;
  }

  public async login(email: string, password: string, pin?: string): Promise<ApiResponse<{ user: RestaurantUser; restaurant: Restaurant | null; token?: string }>> {
    const res = await this.request<{ user: any; restaurant: any | null; token?: string }>('POST', '/auth/login', {
      auth: false,
      body: { email: email.trim().toLowerCase(), password, pin: pin ? pin.trim() : undefined },
    });
    if (res.success && res.data) {
      if (res.data.token && typeof window !== 'undefined') {
        localStorage.setItem(AUTH_TOKEN_KEY, res.data.token);
      }
      res.data.user = mapUserRow(res.data.user);
      res.data.restaurant = res.data.restaurant ? mapRestaurantRow(res.data.restaurant) : null;
    }
    return res as ApiResponse<{ user: RestaurantUser; restaurant: Restaurant | null; token?: string }>;
  }

  public async pinLogin(pin: string, restaurantId?: string): Promise<ApiResponse<{ user: RestaurantUser; restaurant: Restaurant | null; token?: string }>> {
    const res = await this.request<{ user: any; restaurant: any | null; token?: string }>('POST', '/auth/pin', {
      auth: false,
      body: { pin, restaurantId },
    });
    if (res.success && res.data) {
      if (res.data.token && typeof window !== 'undefined') {
        localStorage.setItem(AUTH_TOKEN_KEY, res.data.token);
      }
      res.data.user = mapUserRow(res.data.user);
      res.data.restaurant = res.data.restaurant ? mapRestaurantRow(res.data.restaurant) : null;
    }
    return res as ApiResponse<{ user: RestaurantUser; restaurant: Restaurant | null; token?: string }>;
  }

  public async getCurrentUser(): Promise<ApiResponse<{ user: RestaurantUser; restaurant: Restaurant | null }>> {
    if (!this.getAuthToken()) {
      return { success: false, error: 'جلسة الدخول غير صالحة', statusCode: 401 };
    }
    const res = await this.request<{ user: any; restaurant: any | null }>('GET', '/auth/me');
    if (res.success && res.data) {
      res.data.user = mapUserRow(res.data.user);
      res.data.restaurant = res.data.restaurant ? mapRestaurantRow(res.data.restaurant) : null;
    }
    return res as ApiResponse<{ user: RestaurantUser; restaurant: Restaurant | null }>;
  }

  public async logout(): Promise<ApiResponse<null>> {
    // Revoke server-side FIRST (the request needs the token), then always
    // drop the local copy — even if the network call fails.
    try {
      return await this.request<null>('POST', '/auth/logout');
    } finally {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    }
  }

  // Uploads an image (logo / cover / dish) to the real server storage and
  // returns its permanent URL, ready to persist through saveBranding /
  // saveProduct. The persisted value is ALWAYS the small storage URL — a
  // base64 data URL is never stored (it would blow up every later save past
  // the server's 1MB JSON body limit). `kind` only organizes the object key
  // server-side (logo/cover/gallery/product); it does not change the API.
  public async uploadImage(
    file: File | Blob,
    fileName = 'image.png',
    kind?: 'logo' | 'cover' | 'gallery' | 'product' | 'category' | 'offer' | 'map',
    restaurantId?: string
  ): Promise<ApiResponse<{ url: string; pathUrl?: string; key?: string }>> {
    try {
      const form = new FormData();
      form.append('image', file, fileName);
      if (kind) form.append('kind', kind);
      // Platform staff (SUPER_ADMIN / PLATFORM_ADMIN) have no JWT tenant, so
      // the upload route must be told which restaurant the file belongs to.
      // Tenant users are unaffected: the server always resolves their upload
      // to their own JWT restaurantId and ignores this hint.
      const tenantQuery = restaurantId
        ? `?restaurantId=${encodeURIComponent(restaurantId)}`
        : '';
      const token = this.getAuthToken();
      const res = await fetch(`${API_BASE}/uploads/image${tenantQuery}`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.success && (json.data?.url || json.data?.pathUrl)) {
        const rawUrl: string = json.data.url || '';
        const pathUrl: string | undefined = json.data.pathUrl;
        // Defensive: if a server ever echoes the file bytes back as base64
        // (legacy shape), prefer the on-disk path instead of the megabytes.
        const chosen =
          rawUrl && !isEmbeddedImage(rawUrl) ? rawUrl : pathUrl || rawUrl;
        return { success: true, data: { url: absoluteAssetUrl(chosen), pathUrl, key: json.data.key }, statusCode: 200 };
      }
      if (json && typeof json === 'object' && 'error' in json) {
        return json as ApiResponse<never>;
      }
      return { success: false, error: 'تعذر رفع الصورة إلى الخادم', statusCode: res.status };
    } catch {
      return { success: false, error: 'تعذر الاتصال بالخادم لرفع الصورة', statusCode: 503 };
    }
  }

  // Best-effort delete of a previously uploaded image (used to clean up a
  // replaced logo/cover/dish). The server re-validates tenant ownership, so
  // a caller can never delete another restaurant's file. Failures are
  // returned but must be treated as non-fatal by callers.
  public async deleteImage(url: string, restaurantId?: string): Promise<ApiResponse<{ deleted: boolean; key: string | null }>> {
    try {
      const token = this.getAuthToken();
      const res = await fetch(`${API_BASE}/uploads/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url, ...(restaurantId ? { restaurantId } : {}) }),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        return { success: true, data: json.data, statusCode: res.status };
      }
      return {
        success: false,
        error: (json && typeof json === 'object' && 'error' in json)
          ? json.error
          : 'تعذر حذف الصورة القديمة',
        statusCode: res.status,
      };
    } catch {
      return { success: false, error: 'تعذر الاتصال بالخادم لحذف الصورة', statusCode: 503 };
    }
  }

  // =========================================================================
  // PUBLIC / CUSTOMER ANONYMOUS ENDPOINTS (QR-gated, tenant-scoped)
  // =========================================================================

  // Fetch all public active restaurants (for staff login venue selector and directory)
  public async getPublicRestaurants(): Promise<ApiResponse<{ restaurants: Restaurant[] }>> {
    const res = await this.request<any>('GET', '/public/restaurants', { auth: false });
    if (res.success && res.data) {
      return {
        success: true,
        data: {
          restaurants: (res.data.restaurants || []).map(mapRestaurantRow),
        },
        statusCode: 200,
      };
    }
    return res as ApiResponse<never>;
  }

  public async getPublicRestaurantBySlug(slug: string, qrToken?: string): Promise<ApiResponse<{
    restaurant: Restaurant;
    categories: Category[];
    products: Product[];
    offers: Offer[];
    tables?: RestaurantTable[];
  }>> {
    const cleanQr = (qrToken && qrToken.toLowerCase() !== 'default') ? qrToken : '';
    const query = cleanQr ? `?qrToken=${encodeURIComponent(cleanQr)}` : '';
    const res = await this.request<any>(
      'GET',
      `/public/restaurants/${encodeURIComponent(slug)}${query}`,
      { auth: false }
    );
    if (res.success && res.data) {
      return {
        success: true,
        data: {
          restaurant: mapRestaurantRow(res.data.restaurant),
          categories: (res.data.categories || []).map(mapCategoryRow),
          products: (res.data.products || []).map(mapProductRow),
          offers: (res.data.offers || []).map(mapOfferRow),
          tables: (res.data.tables || []).map(mapTableRow),
        },
        statusCode: 200,
      };
    }
    return res as ApiResponse<never>;
  }

  // Resolve QR -> real Table (used to display table info on the customer screen)
  public async resolveQrTable(qrToken: string): Promise<ApiResponse<{ table: RestaurantTable; restaurant: Restaurant }>> {
    const res = await this.request<any>('GET', `/public/tables/qr/${encodeURIComponent(qrToken)}`, { auth: false });
    if (res.success && res.data) {
      return {
        success: true,
        data: {
          table: mapTableRow({ ...res.data.table, restaurantId: res.data.restaurant.id, qrToken }),
          restaurant: mapRestaurantRow(res.data.restaurant),
        },
        statusCode: 200,
      };
    }
    return res as ApiResponse<never>;
  }

  // Create anonymous table session from a valid physical QR code.
  public async createTableSession(
    qrToken: string,
    slug?: string,
    restaurantId?: string,
    resumeSessionToken?: string
  ): Promise<ApiResponse<{ session: TableSession; table: RestaurantTable; restaurant: Restaurant }>> {
    const res = await this.request<any>('POST', `/public/tables/qr/${encodeURIComponent(qrToken)}/session`, {
      auth: false,
      body: { slug, restaurantId, resumeSessionToken },
    });
    if (res.success && res.data) {
      // The session payload carries the complete visual identity (theme
      // colors, cover, logo framing). Map it through the same row mapper as
      // every other restaurant payload so customer entry never downgrades
      // an already-known theme to the platform defaults.
      const raw = res.data.restaurant;
      const restaurant = mapRestaurantRow({
        ...raw,
        logoUrl: raw.logoUrl || raw.logo,
        coverImageUrl: raw.coverImageUrl || raw.coverImage,
        nameEn: raw.nameEn,
      });
      const table = mapTableRow({ id: res.data.tableId, restaurantId: restaurant.id, number: res.data.tableNumber });
      const session = mapSessionRow(
        {
          ...res.data,
          status: res.data.sessionStatus || 'ACTIVE',
          createdAt: res.data.sessionCreatedAt,
          expiresAt: res.data.sessionExpiresAt,
        },
        restaurant.id,
        res.data.tableId
      );
      return { success: true, data: { session, table, restaurant }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  // Place order from the customer device. All prices are re-priced server-side
  // from the DB menu of the restaurant bound to the QR session.
  public async submitOrder(params: {
    restaurantId: string;
    tableId: string;
    sessionToken?: string;
    clientRequestId: string;
    items: Order['items'];
    notes?: string;
  }): Promise<ApiResponse<{ order: Order }>> {
    const res = await this.request<any>('POST', '/public/orders', {
      auth: false,
      body: { ...params },
    });
    if (res.success && res.data?.order) {
      return { success: true, data: { order: mapOrderRow(res.data.order) }, statusCode: 201 };
    }
    return res as ApiResponse<never>;
  }

  // Alias kept for call-site compatibility.
  public async createOrder(
    restaurantId: string,
    tableId: string,
    items: Order['items'],
    notes?: string,
    sessionToken?: string
  ): Promise<ApiResponse<Order>> {
    const res = await this.submitOrder({ restaurantId, tableId, sessionToken, clientRequestId: newClientRequestId(), items, notes });
    if (res.success && res.data) return { success: true, data: res.data.order, statusCode: 201 };
    return { success: false, error: res.error, statusCode: res.statusCode };
  }

  // Fetch the live orders of the caller's own QR table session — the source
  // of truth behind the customer's "المطبخ الحي" order-status tracker.
  public async getTableSessionOrders(
    restaurantId: string,
    tableId: string,
    sessionToken: string
  ): Promise<ApiResponse<Order[]>> {
    const query = new URLSearchParams({ restaurantId, sessionToken });
    const res = await this.request<any>(
      'GET',
      `/public/tables/${encodeURIComponent(tableId)}/orders?${query.toString()}`,
      { auth: false }
    );
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapOrderRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  // Customer cancels own order — only while PENDING and bound to their QR session.
  public async cancelOrder(
    restaurantId: string,
    orderId: string,
    sessionToken?: string
  ): Promise<ApiResponse<{ message: string; order: Order }>> {
    // The session capability travels in the POST body — never in the URL —
    // so it is not written to logs, history or referrer headers.
    const res = await this.request<any>(
      'POST',
      `/public/orders/${encodeURIComponent(orderId)}/cancel`,
      { auth: false, body: { restaurantId, sessionToken } }
    );
    if (res.success && res.data) {
      return { success: true, data: { message: res.data.message || 'تم إلغاء الطلب بنجاح', order: mapOrderRow(res.data.order) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async updateOrderNotes(restaurantId: string, orderId: string, notes: string, sessionToken?: string): Promise<ApiResponse<Order>> {
    const res = await this.request<any>('PUT', `/public/orders/${encodeURIComponent(orderId)}/notes`, {
      auth: false,
      body: { notes, restaurantId, sessionToken },
    });
    if (res.success && res.data?.order) {
      return { success: true, data: mapOrderRow(res.data.order), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async callWaiter(
    paramsOrRestaurantId:
      | string
      | {
          restaurantId: string;
          tableId: string;
          reason: WaiterRequest['reason'];
          note?: string;
          sessionToken?: string;
        },
    tableId?: string,
    reason?: WaiterRequest['reason'],
    customText?: string,
    sessionToken?: string
  ): Promise<ApiResponse<{ waiterRequest: WaiterRequest }>> {
    let payload: { restaurantId: string; tableId: string; reason: string; note?: string; sessionToken?: string };
    if (typeof paramsOrRestaurantId === 'object') {
      payload = {
        restaurantId: paramsOrRestaurantId.restaurantId,
        tableId: paramsOrRestaurantId.tableId,
        reason: paramsOrRestaurantId.reason,
        note: paramsOrRestaurantId.note,
        sessionToken: paramsOrRestaurantId.sessionToken,
      };
    } else {
      payload = { restaurantId: paramsOrRestaurantId, tableId: tableId!, reason: reason || 'ASSISTANCE', note: customText, sessionToken };
    }
    const res = await this.request<any>('POST', '/public/waiter-requests', { auth: false, body: payload });
    if (res.success && res.data) {
      return { success: true, data: { waiterRequest: mapWaiterRequestRow(res.data.waiterRequest || res.data) }, statusCode: 201 };
    }
    return res as ApiResponse<never>;
  }

  public async requestBill(restaurantId: string, tableId: string, sessionToken?: string): Promise<ApiResponse<{ message: string }>> {
    const res = await this.callWaiter({ restaurantId, tableId, reason: 'BILL', sessionToken });
    if (res.success) {
      return { success: true, data: { message: 'تم إرسال طلب الحساب للكاشير' }, statusCode: 200 };
    }
    return { success: false, error: res.error, statusCode: res.statusCode };
  }

  // =========================================================================
  // MANAGER AUTHENTICATED ENDPOINTS (strict tenant isolation on the server)
  // =========================================================================

  public async getManagerDashboardStats(
    user: RestaurantUser,
    restaurantId: string
  ): Promise<ApiResponse<{
    restaurant: Restaurant;
    subscription: Subscription | null;
    plan: Plan | null;
    totalRevenue: number;
    /** Revenue for the tenant-local current day, aggregated in SQL (never the capped in-memory list). */
    todayRevenue: number;
    todayOrdersCount: number;
    activeTablesCount: number;
    totalTablesCount: number;
    pendingOrdersCount: number;
    preparingOrdersCount: number;
    readyOrdersCount: number;
    /**
     * Orders the payment gate is holding (awaiting payment / awaiting cashier
     * verification / rejected receipt). Deliberately NOT part of the three
     * kitchen counters above: those count released work only, exactly like the
     * KDS board.
     */
    heldForPaymentCount: number;
    pendingWaitersCount: number;
    averageOrderValue: number;
    popularProducts: { name: string; count: number; revenue: number }[];
  }>> {
    const res = await this.request<any>('GET', `/manager/dashboard/stats?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (res.success && res.data) {
      return {
        success: true,
        data: {
          restaurant: mapRestaurantRow(res.data.restaurant),
          subscription: res.data.subscription ? mapSubscriptionRow(res.data.subscription) : null,
          plan: res.data.plan ? mapPlanRow(res.data.plan) : null,
          totalRevenue: Number(res.data.totalRevenue) || 0,
          todayRevenue: Number(res.data.todayRevenue) || 0,
          todayOrdersCount: Number(res.data.todayOrdersCount) || 0,
          activeTablesCount: Number(res.data.activeTablesCount) || 0,
          totalTablesCount: Number(res.data.totalTablesCount) || 0,
          pendingOrdersCount: Number(res.data.pendingOrdersCount) || 0,
          preparingOrdersCount: Number(res.data.preparingOrdersCount) || 0,
          readyOrdersCount: Number(res.data.readyOrdersCount) || 0,
          heldForPaymentCount: Number(res.data.heldForPaymentCount) || 0,
          pendingWaitersCount: Number(res.data.pendingWaitersCount) || 0,
          averageOrderValue: Number(res.data.averageOrderValue) || 0,
          popularProducts: res.data.popularProducts || [],
        },
        statusCode: 200,
      };
    }
    return res as ApiResponse<never>;
  }

  public async getManagerMenu(restaurantId: string): Promise<ApiResponse<{ categories: Category[]; products: Product[] }>> {
    const res = await this.request<any>('GET', `/manager/menu/categories?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (!res.success) return res as ApiResponse<never>;
    const productsRes = await this.request<any>('GET', `/manager/menu/products?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (!productsRes.success) return productsRes as ApiResponse<never>;
    return {
      success: true,
      data: {
        categories: (res.data || []).map((c: any) => mapCategoryRow({ ...c, restaurantId })),
        products: (productsRes.data || []).map(mapProductRow),
      },
      statusCode: 200,
    };
  }

  /**
   * Tenant orders. `opts.operational` asks the SERVER to scope the result to
   * the operational set (payment verified → the kitchen may work on it) or to
   * exactly the held set; omitting it returns every order (history/admin).
   */
  public async getManagerOrders(
    restaurantId: string,
    opts?: { operational?: boolean; scope?: 'operations'; closedHours?: number }
  ): Promise<ApiResponse<Order[]> & { meta?: ManagerOrdersMeta }> {
    const query = new URLSearchParams({ restaurantId });
    if (typeof opts?.operational === 'boolean') {
      query.set('operational', opts.operational ? 'true' : 'false');
    }
    // H-03: `scope=operations` asks the server for the domain sets (live
    // orders of ANY age + a bounded recent-history window) instead of the
    // default "N newest" page that could hide an old still-active ticket.
    if (opts?.scope === 'operations') {
      query.set('scope', 'operations');
      if (opts.closedHours !== undefined) query.set('closedHours', String(opts.closedHours));
    }
    const res = (await this.request<any>('GET', `/manager/orders?${query.toString()}`)) as ApiResponse<any> & {
      meta?: ManagerOrdersMeta;
    };
    if (res.success && Array.isArray(res.data)) {
      return {
        success: true,
        data: res.data.map(mapOrderRow),
        statusCode: 200,
        meta: res.meta,
      };
    }
    return res as ApiResponse<never>;
  }


  // POS / counter order placed by tenant staff (no QR session needed).
  public async createManagerOrder(
    user: RestaurantUser,
    restaurantId: string,
    tableId: string,
    items: Order['items'],
    clientRequestId: string,
    notes?: string
  ): Promise<ApiResponse<{ order: Order }>> {
    const res = await this.request<any>('POST', '/manager/orders', {
      body: { restaurantId, tableId, items, clientRequestId, notes },
    });
    if (res.success && res.data?.order) {
      return { success: true, data: { order: mapOrderRow(res.data.order) }, statusCode: 201 };
    }
    return res as ApiResponse<never>;
  }

  public async updateOrderStatus(
    user: RestaurantUser,
    restaurantId: string,
    orderId: string,
    nextStatus: OrderStatus,
    opts?: { reason?: string }
  ): Promise<ApiResponse<Order>> {
    const res = await this.request<any>('PUT', `/manager/orders/${encodeURIComponent(orderId)}/status`, {
      body: { status: nextStatus, restaurantId, ...(opts?.reason ? { reason: opts.reason } : {}) },
    });
    if (res.success && res.data?.order) {
      return { success: true, data: mapOrderRow(res.data.order), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async getManagerWaiterRequests(restaurantId: string): Promise<ApiResponse<WaiterRequest[]>> {
    const res = await this.request<any>('GET', `/manager/waiter-requests?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapWaiterRequestRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async updateWaiterRequestStatus(
    user: RestaurantUser,
    restaurantId: string,
    requestId: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED'
  ): Promise<ApiResponse<{ request: WaiterRequest }>> {
    const res = await this.request<any>('PUT', `/manager/waiter-requests/${encodeURIComponent(requestId)}/status`, {
      body: { status, restaurantId },
    });
    if (res.success && res.data) {
      return { success: true, data: { request: mapWaiterRequestRow(res.data.request || res.data) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async saveCategory(
    user: RestaurantUser,
    restaurantId: string,
    category: Category
  ): Promise<ApiResponse<{ category: Category }>> {
    const res = await this.request<any>('POST', '/manager/menu/categories', {
      body: { restaurantId, name: category.name, nameEn: category.nameEn },
    });
    if (res.success && res.data) {
      return { success: true, data: { category: mapCategoryRow({ ...res.data, restaurantId }) }, statusCode: 201 };
    }
    return res as ApiResponse<never>;
  }

  public async updateCategory(restaurantId: string, category: Category): Promise<ApiResponse<{ category: Category }>> {
    const res = await this.request<any>('PUT', `/manager/menu/categories/${encodeURIComponent(category.id)}`, {
      body: { restaurantId, name: category.name, nameEn: category.nameEn, sortOrder: category.sortOrder },
    });
    if (res.success && res.data) {
      return { success: true, data: { category: mapCategoryRow({ ...res.data.category || res.data, restaurantId }) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async deleteCategory(restaurantId: string, categoryId: string): Promise<ApiResponse<null>> {
    return this.request<null>('DELETE', `/manager/menu/categories/${encodeURIComponent(categoryId)}`, { body: { restaurantId } });
  }

  public async saveProduct(
    user: RestaurantUser,
    restaurantId: string,
    product: Product
  ): Promise<ApiResponse<{ product: Product }>> {
    // Fail fast before the network: a base64 dish image would 413 the save
    // and the toast below tells the manager exactly how to fix it.
    if (isEmbeddedImage(product.image)) {
      return { success: false, error: EMBEDDED_IMAGE_ERROR, statusCode: 413 };
    }
    const isNew = product.id.startsWith('prod-') || !product.id || product.id.includes('Date.now');
    const body: Record<string, unknown> = {
      restaurantId,
      categoryId: product.categoryId,
      name: product.name,
      nameEn: product.nameEn,
      description: product.description,
      price: Number(product.price) || 0,
      image: product.image,
      badge: product.badge,
      preparationTimeMinutes: product.preparationTimeMinutes,
      calories: product.calories,
      isAvailable: product.isAvailable,
      isFeatured: product.isFeatured,
      sizes: product.sizes || [],
      addOns: product.addOns || [],
      allergens: product.allergens || [],
      ingredients: product.ingredients || [],
      removableIngredients: product.removableIngredients || [],
    };
    const res = isNew
      ? await this.request<any>('POST', '/manager/menu/products', { body })
      : await this.request<any>('PUT', `/manager/menu/products/${encodeURIComponent(product.id)}`, { body });
    if (res.success && res.data) {
      const raw = res.data.product || res.data;
      return { success: true, data: { product: mapProductRow({ ...raw, restaurantId }) }, statusCode: res.statusCode || 200 };
    }
    return res as ApiResponse<never>;
  }

  public async deleteManagerProduct(
    user: RestaurantUser,
    restaurantId: string,
    productId: string
  ): Promise<ApiResponse<null>> {
    return this.request<null>('DELETE', `/manager/menu/products/${encodeURIComponent(productId)}`, { body: { restaurantId } });
  }

  public async toggleProductStock(restaurantId: string, productId: string): Promise<ApiResponse<{ product: Product }>> {
    const res = await this.request<any>('PUT', `/manager/menu/products/${encodeURIComponent(productId)}/stock`, {
      body: { restaurantId },
    });
    if (res.success && res.data?.product) {
      return { success: true, data: { product: mapProductRow({ ...res.data.product, restaurantId }) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async getManagerTables(restaurantId: string): Promise<ApiResponse<RestaurantTable[]>> {
    const res = await this.request<any>('GET', `/manager/tables?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapTableRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async createTable(
    restaurantId: string,
    input: { tableNumber: number; capacity: number; zone: string; name?: string }
  ): Promise<ApiResponse<{ table: RestaurantTable }>> {
    const res = await this.request<any>('POST', '/manager/tables', {
      body: { restaurantId, tableNumber: input.tableNumber, capacity: input.capacity, zone: input.zone, name: input.name },
    });
    if (res.success && res.data?.table) {
      return { success: true, data: { table: mapTableRow({ ...res.data.table, restaurantId }) }, statusCode: 201 };
    }
    return res as ApiResponse<never>;
  }

  public async updateTable(restaurantId: string, table: RestaurantTable): Promise<ApiResponse<{ table: RestaurantTable }>> {
    const res = await this.request<any>('PUT', `/manager/tables/${encodeURIComponent(table.id)}`, {
      body: {
        restaurantId,
        tableNumber: table.tableNumber,
        capacity: table.capacity,
        zone: table.zone,
        status: table.status,
        branchId: table.branchId,
      },
    });
    if (res.success && res.data?.table) {
      return { success: true, data: { table: mapTableRow({ ...res.data.table, restaurantId }) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  // Availability-only update used by floor staff (cashier/waiter). Sends just
  // { restaurantId, status } — the server rejects structural table edits from
  // non-manager roles, which the full updateTable payload would always contain.
  public async updateTableStatus(
    restaurantId: string,
    tableId: string,
    status: RestaurantTable['status']
  ): Promise<ApiResponse<{ table: RestaurantTable }>> {
    const res = await this.request<any>('PUT', `/manager/tables/${encodeURIComponent(tableId)}`, {
      body: { restaurantId, status },
    });
    if (res.success && res.data?.table) {
      return { success: true, data: { table: mapTableRow({ ...res.data.table, restaurantId }) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async regenerateTableQR(restaurantId: string, tableId: string): Promise<ApiResponse<{ table: RestaurantTable }>> {
    const res = await this.request<any>('POST', `/manager/tables/${encodeURIComponent(tableId)}/regenerate-qr`, {
      body: { restaurantId },
    });
    if (res.success && res.data?.table) {
      return { success: true, data: { table: mapTableRow({ ...res.data.table, restaurantId }) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async settleTableBill(
    user: RestaurantUser,
    restaurantId: string,
    tableId: string,
    // Quick settle is cash-at-counter. Must stay inside the server ledger
    // enum (CASH|CARD|MOBILE|SPLIT) — the legacy 'PAY AT CASHIER' placeholder
    // is an order paymentMethod, not a ledger method, and was rejected.
    paymentMethod: string = 'CASH'
  ): Promise<ApiResponse<{ message: string; orderIds: string[] }>> {
    const res = await this.request<any>('POST', `/manager/tables/${encodeURIComponent(tableId)}/settle`, {
      body: { restaurantId, paymentMethod },
    });
    if (res.success && res.data) {
      return {
        success: true,
        data: { message: res.data.message || 'تمت تصفية الطاولة', orderIds: res.data.orderIds || [] },
        statusCode: 200,
      };
    }
    return res as ApiResponse<never>;
  }

  public async getPayments(user: RestaurantUser, restaurantId: string): Promise<ApiResponse<PaymentRecord[]>> {
    const res = await this.request<any>('GET', `/manager/payments?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapPaymentRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async processPayment(
    user: RestaurantUser,
    restaurantId: string,
    payload: {
      tableId: string;
      orderIds: string[];
      method: string;
      cashReceived?: number;
      tip?: number;
      note?: string;
    }
  ): Promise<ApiResponse<{ payment: PaymentRecord; message?: string }>> {
    const res = await this.request<any>('POST', '/manager/payments', {
      body: { restaurantId, ...payload },
    });
    if (res.success && res.data?.payment) {
      return {
        success: true,
        data: { payment: mapPaymentRow({ ...res.data.payment, restaurantId }), message: res.data.message },
        statusCode: 201,
      };
    }
    return res as ApiResponse<never>;
  }

  /**
   * Void (reverse) a ledger receipt (audit H-02). The server marks the
   * immutable receipt voided and reverts its covered orders to
   * UNPAID — an idempotent replay returns `alreadyVoided: true`.
   */
  public async voidPayment(
    user: RestaurantUser,
    restaurantId: string,
    paymentId: string,
    reason?: string
  ): Promise<
    ApiResponse<{
      paymentId: string;
      alreadyVoided: boolean;
      voidedAt: string;
      revertedOrders?: number;
    }>
  > {
    const res = await this.request<any>(
      'POST',
      `/manager/payments/${encodeURIComponent(paymentId)}/void`,
      { body: { restaurantId, ...(reason ? { reason } : {}) } }
    );
    if (res.success && res.data?.paymentId) {
      return { success: true, data: res.data, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  // =========================================================================
  // TRANSFER PAYMENT PROOF (guest upload + cashier verification)
  // =========================================================================

  /**
   * Guest announces a bank transfer: uploads the receipt image (multipart)
   * together with an OPTIONAL phone number.
   *
   * Uses XMLHttpRequest instead of fetch for one reason: only XHR exposes
   * upload progress, which the UI needs to show a real progress bar (a failed
   * or interrupted upload must be visible, not a frozen button). Everything
   * else — auth header, error mapping — mirrors `request()`.
   */
  public submitPaymentProof(
    params: {
      restaurantId: string;
      tableId: string;
      sessionToken: string;
      orderId: string;
      /** Required by the server: a notice must be attributable to a person. */
      customerName: string;
      phone: string;
      /** BANK | WALLET — a display hint for the cashier. */
      channel?: TransferChannel;
      file: File | Blob;
      fileName?: string;
    },
    onProgress?: (percent: number) => void
  ): Promise<ApiResponse<{ orderId: string; paymentStatus: PaymentStatus }>> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || typeof XMLHttpRequest === 'undefined') {
        resolve({ success: false, error: 'الرفع متاح من المتصفح فقط', statusCode: 503 });
        return;
      }
      try {
        const form = new FormData();
        // The server derives the stored type from the magic bytes and ignores
        // this name entirely; it is normalized anyway so a hostile filename
        // (path separators, control characters, absurd length) never travels.
        const safeName =
          (params.fileName || 'receipt.jpg')
            .replace(/[^A-Za-z0-9._-]/g, '_')
            .slice(0, 80) || 'receipt.jpg';
        form.append('proof', params.file, safeName);
        form.append('restaurantId', params.restaurantId);
        form.append('tableId', params.tableId);
        form.append('sessionToken', params.sessionToken);
        form.append('customerName', params.customerName);
        form.append('customerPhone', params.phone);
        form.append('transferChannel', params.channel || 'BANK');

        const xhr = new XMLHttpRequest();
        xhr.open(
          'POST',
          `${API_BASE}/public/orders/${encodeURIComponent(params.orderId)}/payment-proof`,
          true
        );
        // Guests are anonymous: no manager JWT is ever attached to this call.
        xhr.timeout = 60_000;

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            onProgress(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
          }
        };

        const finish = (status: number, body: any) => {
          if (body && typeof body === 'object' && body.success) {
            resolve({
              success: true,
              data: {
                orderId: body.data?.order?.id || params.orderId,
                paymentStatus: body.data?.order?.paymentStatus || 'PENDING_VERIFICATION',
              },
              statusCode: status || 200,
            });
            return;
          }
          if (body && typeof body === 'object' && 'error' in body) {
            resolve(body as ApiResponse<never>);
            return;
          }
          resolve({ success: false, error: 'تعذر إرسال إشعار الحوالة', statusCode: status || 500 });
        };

        xhr.onload = () => {
          let body: any = null;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            body = null;
          }
          finish(xhr.status, body);
        };
        xhr.onerror = () =>
          resolve({ success: false, error: 'تعذر الاتصال بالخادم، تحقق من الشبكة', statusCode: 503 });
        xhr.ontimeout = () =>
          resolve({ success: false, error: 'انتهت مهلة الرفع — حاول مجدداً', statusCode: 408 });
        xhr.onabort = () => resolve({ success: false, error: 'تم إلغاء الرفع', statusCode: 499 });

        xhr.send(form);
      } catch {
        resolve({ success: false, error: 'تعذر رفع الصورة', statusCode: 500 });
      }
    });
  }

  /** Cashier queue: orders whose transfer receipt waits for a decision. */
  public async getPaymentVerifications(
    user: RestaurantUser,
    restaurantId: string,
    opts?: { includeAwaiting?: boolean }
  ): Promise<ApiResponse<PaymentVerificationItem[]>> {
    const query = new URLSearchParams({ restaurantId });
    // `include=awaiting` adds the orders whose guest has not completed the
    // payment step yet (no receipt to verify, `state: 'WAITING_RECEIPT'`).
    if (opts?.includeAwaiting) query.set('include', 'awaiting');
    const res = await this.request<any>(
      'GET',
      `/manager/payment-verifications?${query.toString()}`
    );
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapPaymentVerificationRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  /** Fetch the PRIVATE receipt image as an object URL (Bearer-authenticated). */
  public async fetchPaymentProofObjectUrl(
    restaurantId: string,
    orderId: string
  ): Promise<ApiResponse<{ objectUrl: string }>> {
    if (typeof window === 'undefined') {
      return { success: false, error: 'غير متاح خارج المتصفح', statusCode: 503 };
    }
    try {
      const res = await fetch(
        `${API_BASE}/manager/orders/${encodeURIComponent(orderId)}/payment-proof?restaurantId=${encodeURIComponent(restaurantId)}`,
        { headers: this.getAuthHeader(), signal: AbortSignal.timeout(30_000) }
      );
      if (!res.ok) {
        const json: any = await res.json().catch(() => null);
        return (
          (json && typeof json === 'object' && 'error' in json
            ? (json as ApiResponse<never>)
            : { success: false, error: 'تعذر تحميل صورة الإشعار', statusCode: res.status }) as ApiResponse<never>
        );
      }
      const blob = await res.blob();
      return { success: true, data: { objectUrl: URL.createObjectURL(blob) }, statusCode: 200 };
    } catch {
      return { success: false, error: 'تعذر تحميل صورة الإشعار', statusCode: 503 };
    }
  }

  /**
   * Confirm a verified transfer: the order becomes PAID + a receipt is issued.
   * The response also reports the kitchen release — `kitchenReleased` is true
   * when this confirmation is what pushed the order into the KDS as a fresh
   * "ready to start" ticket.
   */
  public async confirmTransferPayment(
    user: RestaurantUser,
    restaurantId: string,
    orderId: string,
    note?: string
  ): Promise<
    ApiResponse<{
      orderId?: string;
      /**
       * The ledger receipt. `null` ONLY on the idempotent replay of a
       * confirmation whose receipt row the server did not resend — the money IS
       * settled then, so the caller must never read a missing receipt as a
       * failure (that mistake reported «تعذر تأكيد الدفع» over a paid order).
       */
      payment: PaymentRecord | null;
      orderStatus?: OrderStatus;
      kitchenReleased?: boolean;
      /** Fulfillment gate after this call (always RELEASED on success). */
      fulfillmentState?: FulfillmentState;
      /** True when this call was an idempotent replay of an earlier confirmation. */
      alreadyConfirmed?: boolean;
    }>
  > {
    const res = await this.request<any>(
      'POST',
      `/manager/orders/${encodeURIComponent(orderId)}/payment/confirm`,
      { body: { restaurantId, ...(note ? { note } : {}) } }
    );
    // Success is the SERVER's verdict alone. Requiring a payment row in the
    // payload used to turn `200 {success:true, alreadyConfirmed:true}` into the
    // caller's generic «تعذر تأكيد الدفع» branch — a confirmed payment reported
    // as failed, inviting a duplicate settlement attempt.
    if (res.success) {
      const row = res.data?.payment;
      return {
        success: true,
        data: {
          orderId: res.data?.orderId || orderId,
          payment: row ? mapPaymentRow({ ...row, restaurantId }) : null,
          orderStatus: res.data?.orderStatus || undefined,
          kitchenReleased: Boolean(res.data?.kitchenReleased),
          fulfillmentState: res.data?.fulfillmentState || undefined,
          alreadyConfirmed: Boolean(res.data?.alreadyConfirmed),
        },
        statusCode: res.statusCode || 201,
      };
    }
    return res as ApiResponse<never>;
  }

  /** Reject a transfer receipt: the order returns to UNPAID (cash at till). */
  public async rejectTransferPayment(
    user: RestaurantUser,
    restaurantId: string,
    orderId: string,
    reason?: string
  ): Promise<
    ApiResponse<{ orderId: string; paymentStatus: PaymentStatus; fulfillmentState?: FulfillmentState }>
  > {
    const res = await this.request<any>(
      'POST',
      `/manager/orders/${encodeURIComponent(orderId)}/payment/reject`,
      { body: { restaurantId, ...(reason ? { reason } : {}) } }
    );
    if (res.success && res.data) {
      return {
        success: true,
        data: {
          orderId: res.data.orderId || orderId,
          paymentStatus: res.data.paymentStatus || 'UNPAID',
          fulfillmentState: res.data.fulfillmentState || undefined,
        },
        statusCode: 200,
      };
    }
    return res as ApiResponse<never>;
  }

  public async getManagerOffers(restaurantId: string): Promise<ApiResponse<Offer[]>> {
    const res = await this.request<any>('GET', `/manager/offers?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapOfferRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async saveOffer(restaurantId: string, offer: Omit<Offer, 'id' | 'restaurantId'>): Promise<ApiResponse<{ offer: Offer }>> {
    if (isEmbeddedImage(offer.image)) {
      return { success: false, error: EMBEDDED_IMAGE_ERROR, statusCode: 413 };
    }
    const res = await this.request<any>('POST', '/manager/offers', { body: { restaurantId, ...offer } });
    if (res.success && res.data?.offer) {
      return { success: true, data: { offer: mapOfferRow({ ...res.data.offer, restaurantId }) }, statusCode: 201 };
    }
    return res as ApiResponse<never>;
  }

  public async updateOffer(restaurantId: string, offer: Offer): Promise<ApiResponse<{ offer: Offer }>> {
    if (isEmbeddedImage(offer.image)) {
      return { success: false, error: EMBEDDED_IMAGE_ERROR, statusCode: 413 };
    }
    const res = await this.request<any>('PUT', `/manager/offers/${encodeURIComponent(offer.id)}`, {
      body: { restaurantId, ...offer },
    });
    if (res.success && res.data?.offer) {
      return { success: true, data: { offer: mapOfferRow({ ...res.data.offer, restaurantId }) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async deleteOffer(restaurantId: string, offerId: string): Promise<ApiResponse<null>> {
    return this.request<null>('DELETE', `/manager/offers/${encodeURIComponent(offerId)}`, { body: { restaurantId } });
  }

  // ---- Staff (tenant users) ----
  public async getStaff(restaurantId: string): Promise<ApiResponse<RestaurantUser[]>> {
    const res = await this.request<any>('GET', `/manager/staff?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapUserRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async createStaff(
    restaurantId: string,
    input: { name: string; email: string; password: string; pin?: string; role: RestaurantUser['role'] }
  ): Promise<ApiResponse<{ user: RestaurantUser }>> {
    const res = await this.request<any>('POST', '/manager/staff', { body: { restaurantId, ...input } });
    if (res.success && res.data?.user) {
      return { success: true, data: { user: mapUserRow({ ...res.data.user, restaurantId }) }, statusCode: 201 };
    }
    return res as ApiResponse<never>;
  }

  public async updateStaff(
    restaurantId: string,
    userId: string,
    input: Partial<{ name: string; role: RestaurantUser['role']; status: string; password: string; pin: string }>
  ): Promise<ApiResponse<{ user: RestaurantUser }>> {
    const res = await this.request<any>('PUT', `/manager/staff/${encodeURIComponent(userId)}`, {
      body: { restaurantId, ...input },
    });
    if (res.success && res.data?.user) {
      return { success: true, data: { user: mapUserRow({ ...res.data.user, restaurantId }) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async deleteStaff(restaurantId: string, userId: string): Promise<ApiResponse<null>> {
    return this.request<null>('DELETE', `/manager/staff/${encodeURIComponent(userId)}`, { body: { restaurantId } });
  }

  // ---- Subscription / Plans / Branding ----
  public async getManagerSubscription(restaurantId: string): Promise<ApiResponse<{ subscription: Subscription | null; plans: Plan[] }>> {
    const res = await this.request<any>('GET', `/manager/subscription?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (res.success && res.data) {
      return {
        success: true,
        data: {
          subscription: res.data.subscription ? mapSubscriptionRow(res.data.subscription) : null,
          plans: (res.data.plans || []).map(mapPlanRow),
        },
        statusCode: 200,
      };
    }
    return res as ApiResponse<never>;
  }

  public async changeSubscriptionPlan(
    restaurantId: string,
    planId: string
  ): Promise<ApiResponse<{ subscription: Subscription }> & { pending?: boolean }> {
    const res = await this.request<any>('PUT', '/manager/subscription/plan', { body: { restaurantId, planId } });
    // 202 Accepted: paid upgrades are never self-granted — the request is
    // queued for platform-admin approval after out-of-band payment. No
    // subscription row exists in the response (nothing was changed).
    if ((res.statusCode === 202 || res.data?.pending) && res.data?.pending) {
      return {
        success: true,
        pending: true,
        data: undefined as unknown as { subscription: Subscription },
        error: res.error,
        statusCode: 202,
      };
    }
    if (res.success && res.data?.subscription) {
      return { success: true, data: { subscription: mapSubscriptionRow(res.data.subscription) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async saveBranding(restaurantId: string, patch: Partial<Restaurant>): Promise<ApiResponse<{ restaurant: Restaurant }>> {
    // Fail fast: logo / cover / gallery values that are still base64 data
    // URLs (uploaded with the old server response, or pasted by hand) would
    // 413 the save — surface the fix instead of a cryptic server error.
    const galleryHasEmbedded =
      Array.isArray(patch.galleryImages) &&
      patch.galleryImages.some((u) => isEmbeddedImage(u));
    if (
      isEmbeddedImage(patch.logo) ||
      isEmbeddedImage(patch.coverImage) ||
      galleryHasEmbedded
    ) {
      return { success: false, error: EMBEDDED_IMAGE_ERROR, statusCode: 413 };
    }
    const res = await this.request<any>('PUT', '/manager/branding', {
      body: {
        restaurantId,
        name: patch.name,
        nameEn: patch.nameEn,
        description: patch.description,
        phone: patch.phone,
        address: patch.address,
        logo: patch.logo,
        coverImage: patch.coverImage,
        currency: patch.currency,
        language: patch.language,
        timezone: patch.timezone,
        primaryColor: patch.primaryColor,
        accentColor: patch.accentColor,
        logoFit: patch.logoFit,
        logoPosition: patch.logoPosition,
        businessType: patch.businessType,
        promoVideoUrl: patch.promoVideoUrl,
        galleryImages: patch.galleryImages,
        latitude: patch.latitude,
        longitude: patch.longitude,
        mapUrl: patch.mapUrl,
        mapImage: patch.mapImageUrl,
      },
    });
    if (res.success && res.data?.restaurant) {
      return { success: true, data: { restaurant: mapRestaurantRow(res.data.restaurant) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  // ---- Branches ----
  public async getManagerBranches(user: RestaurantUser, restaurantId: string): Promise<ApiResponse<Branch[]>> {
    const res = await this.request<any>('GET', `/manager/branches?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapBranchRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async saveBranch(user: RestaurantUser, restaurantId: string, branch: Branch): Promise<ApiResponse<{ branch: Branch }>> {
    const res = await this.request<any>('POST', '/manager/branches', {
      body: { restaurantId, name: branch.name, address: branch.address, phone: branch.phone, color: branch.color, isActive: branch.isActive },
    });
    if (res.success && res.data?.branch) {
      return { success: true, data: { branch: mapBranchRow({ ...res.data.branch, restaurantId }) }, statusCode: 201 };
    }
    return res as ApiResponse<never>;
  }

  public async updateBranch(restaurantId: string, branch: Branch): Promise<ApiResponse<{ branch: Branch }>> {
    const res = await this.request<any>('PUT', `/manager/branches/${encodeURIComponent(branch.id)}`, {
      body: { restaurantId, name: branch.name, address: branch.address, phone: branch.phone, color: branch.color, isActive: branch.isActive },
    });
    if (res.success && res.data?.branch) {
      return { success: true, data: { branch: mapBranchRow({ ...res.data.branch, restaurantId }) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async deleteBranch(user: RestaurantUser, restaurantId: string, branchId: string): Promise<ApiResponse<null>> {
    return this.request<null>('DELETE', `/manager/branches/${encodeURIComponent(branchId)}`, { body: { restaurantId } });
  }

  public async assignTablesToBranch(
    user: RestaurantUser,
    restaurantId: string,
    branchId: string | null,
    tableIds: string[]
  ): Promise<ApiResponse<{ message: string }>> {
    const res = await this.request<any>('POST', '/manager/branches/assign-tables', {
      body: { restaurantId, branchId, tableIds },
    });
    if (res.success) return { success: true, data: { message: res.data?.message || 'تم تحديث توزيع الطاولات' }, statusCode: 200 };
    return res as ApiResponse<never>;
  }

  public async checkEntitlement(restaurantId: string, entitlement: EntitlementKey): Promise<boolean> {
    const res = await this.getManagerSubscription(restaurantId);
    if (!res.success || !res.data) return false;
    const sub = res.data.subscription;
    if (!sub || sub.status === 'SUSPENDED' || sub.status === 'CANCELLED') return false;
    const plan = res.data.plans.find((p) => p.id === sub.planId);
    if (!plan) return false;
    return plan.entitlements.includes(entitlement);
  }

  // =========================================================================
  // PLATFORM ADMIN ENDPOINTS
  // =========================================================================

  public async getPlatformOverview(user: RestaurantUser): Promise<ApiResponse<{
    totalRestaurants: number;
    activeRestaurants: number;
    totalRevenue: number;
    activeSubscriptions: number;
    restaurants: Restaurant[];
    subscriptions: Subscription[];
    plans: Plan[];
    auditLogs: AuditLog[];
  }>> {
    const res = await this.request<any>('GET', '/admin/overview');
    if (res.success && res.data) {
      return {
        success: true,
        data: {
          totalRestaurants: Number(res.data.totalRestaurants) || 0,
          activeRestaurants: Number(res.data.activeRestaurants) || 0,
          totalRevenue: Number(res.data.totalRevenue) || 0,
          activeSubscriptions: Number(res.data.activeSubscriptions) || 0,
          restaurants: (res.data.restaurants || []).map(mapRestaurantRow),
          subscriptions: (res.data.subscriptions || []).map(mapSubscriptionRow),
          plans: (res.data.plans || []).map(mapPlanRow),
          auditLogs: (res.data.auditLogs || []).map(mapAuditLogRow),
        },
        statusCode: 200,
      };
    }
    return res as ApiResponse<never>;
  }

  public async getPlatformAuditLogs(): Promise<ApiResponse<AuditLog[]>> {
    const res = await this.request<any>('GET', '/admin/audit-logs');
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapAuditLogRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  /**
   * Platform admin granting the free 7-day limited-entitlement trial to a
   * tenant. The server enforces "one trial per tenant, ever".
   */
  public async activateTenantTrial(
    user: RestaurantUser,
    restaurantId: string,
    note?: string
  ): Promise<
    ApiResponse<{
      subscription: Subscription;
      restaurant: Restaurant;
      trialEndsAt: string;
      daysRemaining: number;
    }>
  > {
    const res = await this.request<any>(
      'POST',
      `/admin/restaurants/${encodeURIComponent(restaurantId)}/activate-trial`,
      { body: note ? { note } : {} }
    );
    if (res.success && res.data) {
      return {
        success: true,
        data: {
          subscription: mapSubscriptionRow({
            ...res.data.subscription,
            restaurantId: res.data.subscription.restaurantId || restaurantId,
          }),
          restaurant: mapRestaurantRow(res.data.restaurant),
          trialEndsAt: res.data.trialEndsAt,
          daysRemaining: Number(res.data.daysRemaining) || 0,
        },
        statusCode: 200,
      };
    }
    return res as ApiResponse<never>;
  }

  public async setTenantStatus(
    user: RestaurantUser,
    restaurantId: string,
    status: 'ACTIVE' | 'SUSPENDED'
  ): Promise<ApiResponse<Restaurant>> {
    const res = await this.request<any>('POST', `/admin/restaurants/${encodeURIComponent(restaurantId)}/status`, {
      body: { status },
    });
    if (res.success && (res.data?.restaurant || res.data)) {
      return { success: true, data: mapRestaurantRow(res.data.restaurant || res.data), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async toggleRestaurantStatus(
    user: RestaurantUser,
    restaurantId: string,
    status: 'ACTIVE' | 'SUSPENDED'
  ): Promise<ApiResponse<{ restaurant: Restaurant }>> {
    const res = await this.setTenantStatus(user, restaurantId, status);
    if (res.success && res.data) {
      return { success: true, data: { restaurant: res.data }, statusCode: 200 };
    }
    return { success: false, error: res.error || 'تعذر تحديث حالة المطعم', statusCode: res.statusCode };
  }
}

export const api = new RestaurantApiService();
