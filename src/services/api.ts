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
  Branch,
  EntitlementKey,
} from '../types/restaurant';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
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

export function absoluteAssetUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:\/\/|data:|blob:)/i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;
}

export const AUTH_TOKEN_KEY = 'merar_auth_token';

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
    coverImage: absoluteAssetUrl(raw.coverImageUrl || raw.coverImage || '') || undefined,
    description: raw.description || '',
    phone: raw.phone || '',
    address: raw.address || '',
    latitude: raw.latitude ? Number(raw.latitude) : 31.9029,
    longitude: raw.longitude ? Number(raw.longitude) : 35.2062,
    mapUrl: raw.mapUrl || undefined,
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
    settledAt: raw.settledAt ? toISO(raw.settledAt) : undefined,
    notes: raw.notes || undefined,
    createdAt: toISO(raw.createdAt),
    updatedAt: toISO(raw.updatedAt),
    estimatedPrepMinutes: raw.estimatedPrepMinutes ?? 18,
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

  // Uploads an image (logo / cover) to the real server storage and returns its
  // absolute URL, ready to persist through saveBranding.
  public async uploadImage(file: File | Blob, fileName = 'image.png'): Promise<ApiResponse<{ url: string }>> {
    try {
      const form = new FormData();
      form.append('image', file, fileName);
      const token = this.getAuthToken();
      const res = await fetch(`${API_BASE}/uploads/image`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.success && json.data?.url) {
        return { success: true, data: { url: absoluteAssetUrl(json.data.url) }, statusCode: 200 };
      }
      if (json && typeof json === 'object' && 'error' in json) {
        return json as ApiResponse<never>;
      }
      return { success: false, error: 'تعذر رفع الصورة إلى الخادم', statusCode: res.status };
    } catch {
      return { success: false, error: 'تعذر الاتصال بالخادم لرفع الصورة', statusCode: 503 };
    }
  }

  // =========================================================================
  // PUBLIC / CUSTOMER ANONYMOUS ENDPOINTS (QR-gated, tenant-scoped)
  // =========================================================================

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
    restaurantId?: string
  ): Promise<ApiResponse<{ session: TableSession; table: RestaurantTable; restaurant: Restaurant }>> {
    const res = await this.request<any>('POST', `/public/tables/qr/${encodeURIComponent(qrToken)}/session`, {
      auth: false,
      body: { slug, restaurantId },
    });
    if (res.success && res.data) {
      const restaurant = mapRestaurantRow({ ...res.data.restaurant, logoUrl: res.data.restaurant.logo, nameEn: res.data.restaurant.nameEn });
      const table = mapTableRow({ id: res.data.tableId, restaurantId: restaurant.id, number: res.data.tableNumber });
      const session = mapSessionRow({ ...res.data, status: 'ACTIVE' }, restaurant.id, res.data.tableId);
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
    const res = await this.submitOrder({ restaurantId, tableId, sessionToken, items, notes });
    if (res.success && res.data) return { success: true, data: res.data.order, statusCode: 201 };
    return { success: false, error: res.error, statusCode: res.statusCode };
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
    todayOrdersCount: number;
    activeTablesCount: number;
    totalTablesCount: number;
    pendingOrdersCount: number;
    preparingOrdersCount: number;
    readyOrdersCount: number;
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
          todayOrdersCount: Number(res.data.todayOrdersCount) || 0,
          activeTablesCount: Number(res.data.activeTablesCount) || 0,
          totalTablesCount: Number(res.data.totalTablesCount) || 0,
          pendingOrdersCount: Number(res.data.pendingOrdersCount) || 0,
          preparingOrdersCount: Number(res.data.preparingOrdersCount) || 0,
          readyOrdersCount: Number(res.data.readyOrdersCount) || 0,
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

  public async getManagerOrders(restaurantId: string): Promise<ApiResponse<Order[]>> {
    const res = await this.request<any>('GET', `/manager/orders?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapOrderRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }


  // POS / counter order placed by tenant staff (no QR session needed).
  public async createManagerOrder(
    user: RestaurantUser,
    restaurantId: string,
    tableId: string,
    items: Order['items'],
    notes?: string
  ): Promise<ApiResponse<{ order: Order }>> {
    const res = await this.request<any>('POST', '/manager/orders', {
      body: { restaurantId, tableId, items, notes },
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
    nextStatus: OrderStatus
  ): Promise<ApiResponse<Order>> {
    const res = await this.request<any>('PUT', `/manager/orders/${encodeURIComponent(orderId)}/status`, {
      body: { status: nextStatus, restaurantId },
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
    paymentMethod: string = 'PAY AT CASHIER'
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

  public async getManagerOffers(restaurantId: string): Promise<ApiResponse<Offer[]>> {
    const res = await this.request<any>('GET', `/manager/offers?restaurantId=${encodeURIComponent(restaurantId)}`);
    if (res.success && Array.isArray(res.data)) {
      return { success: true, data: res.data.map(mapOfferRow), statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async saveOffer(restaurantId: string, offer: Omit<Offer, 'id' | 'restaurantId'>): Promise<ApiResponse<{ offer: Offer }>> {
    const res = await this.request<any>('POST', '/manager/offers', { body: { restaurantId, ...offer } });
    if (res.success && res.data?.offer) {
      return { success: true, data: { offer: mapOfferRow({ ...res.data.offer, restaurantId }) }, statusCode: 201 };
    }
    return res as ApiResponse<never>;
  }

  public async updateOffer(restaurantId: string, offer: Offer): Promise<ApiResponse<{ offer: Offer }>> {
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

  public async changeSubscriptionPlan(restaurantId: string, planId: string): Promise<ApiResponse<{ subscription: Subscription }>> {
    const res = await this.request<any>('PUT', '/manager/subscription/plan', { body: { restaurantId, planId } });
    if (res.success && res.data?.subscription) {
      return { success: true, data: { subscription: mapSubscriptionRow(res.data.subscription) }, statusCode: 200 };
    }
    return res as ApiResponse<never>;
  }

  public async saveBranding(restaurantId: string, patch: Partial<Restaurant>): Promise<ApiResponse<{ restaurant: Restaurant }>> {
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
        businessType: patch.businessType,
        promoVideoUrl: patch.promoVideoUrl,
        galleryImages: patch.galleryImages,
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
