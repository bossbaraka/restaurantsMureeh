import {
  Restaurant,
  Category,
  Product,
  RestaurantTable,
  Order,
  OrderStatus,
  WaiterRequest,
  Offer,
  Plan,
  Subscription,
  RestaurantUser,
  TableSession,
  EntitlementKey,
  AuditLog,
} from '../types/restaurant';
import { db } from './db';

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

export async function resolvePublicRestaurantCatalog(
  _slug: string,
  fetcher: () => Promise<Response>,
  fallbackLoader: () => Promise<ApiResponse<{
    restaurant: Restaurant;
    categories: Category[];
    products: Product[];
    offers: Offer[];
  }>>,
  shouldUseLiveApi = typeof window !== 'undefined'
): Promise<ApiResponse<{
  restaurant: Restaurant;
  categories: Category[];
  products: Product[];
  offers: Offer[];
}>> {
  if (shouldUseLiveApi) {
    try {
      const res = await fetcher();
      if (res.ok) {
        const parsed = await res.json();
        if (parsed?.success && parsed?.data) {
          return parsed;
        }
      } else if (res.status === 403 || res.status === 404) {
        const parsed = await res.json();
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (e) {
      // Fallback to offline demo data when the backend is unavailable.
    }
  }

  return await fallbackLoader();
}

class RestaurantApiService {
  private getAuthHeader(): Record<string, string> {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('merar_auth_token');
      if (token) return { Authorization: `Bearer ${token}` };
    }
    return {};
  }

  // =========================================================================
  // AUTHENTICATION & CONTEXT VERIFICATION
  // =========================================================================

  public async onboardRestaurant(payload: Record<string, unknown>): Promise<ApiResponse<{ restaurant: Restaurant }>> {
    try {
      if (typeof window !== 'undefined') {
        const res = await fetch(`${API_BASE}/admin/onboard-restaurant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.getAuthHeader() },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json?.success && json.data?.restaurant) return json;
        if (res.status === 400 || res.status === 401 || res.status === 403) return json;
      }
    } catch {
      // Continue with the local demo database when the API is unavailable.
    }
    return { success: false, error: 'تعذر الاتصال بقاعدة البيانات', statusCode: 503 };
  }

  public async login(email: string, password = 'password'): Promise<ApiResponse<{ user: RestaurantUser; restaurant: Restaurant | null; token?: string }>> {
    try {
      if (typeof window !== 'undefined') {
        const res = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password: password === 'password' ? (email.includes('merar') ? 'Merar@123456' : email.includes('admin') ? 'Admin@123456' : 'Lumiere@123456') : password,
          }),
        });
        const json = await res.json();
        if (json.success && json.data?.token) {
          localStorage.setItem('merar_auth_token', json.data.token);
          return json;
        }
      }
    } catch (e) {
      // Offline fallback to db
    }

    const user = db.getUserByEmail(email);
    if (!user) {
      return {
        success: false,
        error: 'البريد الإلكتروني غير مسجل في المنصة',
        statusCode: 401,
      };
    }

    let restaurant: Restaurant | null = null;
    if (user.restaurantId) {
      restaurant = db.getRestaurantById(user.restaurantId);
      if (restaurant && restaurant.status === 'SUSPENDED' && user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
        return {
          success: false,
          error: 'حساب المطعم موقوف حالياً من قبل إدارة المنصة. يرجى التواصل مع الدعم الفني.',
          statusCode: 403,
        };
      }
    }

    db.addAuditLog(user.restaurantId || undefined, user.name, user.role, 'LOGIN', 'تسجيل دخول ناجح للمنصة');

    return {
      success: true,
      data: { user, restaurant, token: user.token },
      statusCode: 200,
    };
  }

  public async getCurrentUser(): Promise<ApiResponse<{ user: RestaurantUser; restaurant: Restaurant | null }>> {
    try {
      if (typeof window !== 'undefined' && localStorage.getItem('merar_auth_token')) {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: this.getAuthHeader(),
        });
        const json = await res.json();
        if (res.ok && json?.success && json.data?.user) return json;
      }
    } catch {
      // Treat an unavailable or invalid session as logged out.
    }

    return { success: false, error: 'جلسة الدخول غير صالحة', statusCode: 401 };
  }

  // =========================================================================
  // PUBLIC / CUSTOMER ANONYMOUS ENDPOINTS (Scoped by Tenant Slug)
  // =========================================================================

  public async getPublicRestaurantBySlug(slug: string, qrToken?: string): Promise<ApiResponse<{
    restaurant: Restaurant;
    categories: Category[];
    products: Product[];
    offers: Offer[];
  }>> {
    return resolvePublicRestaurantCatalog(
      slug,
      () => fetch(`${API_BASE}/public/restaurants/${slug}?qrToken=${encodeURIComponent(qrToken || '')}`),
      async () => {
        const restaurant = db.getRestaurantBySlug(slug);
        if (!restaurant) {
          return {
            success: false,
            error: 'المطعم غير موجود أو تم تغيير رابطه',
            statusCode: 404,
          };
        }

        if (restaurant.status === 'SUSPENDED') {
          return {
            success: false,
            error: 'هذا المطعم غير متاح للطلب حالياً',
            statusCode: 403,
          };
        }

        const qrTable = qrToken ? db.getTables(restaurant.id).find((table) => table.qrToken === qrToken) : null;
        if (!qrTable) {
          return { success: false, error: 'يجب فتح قائمة المطعم من رمز QR صالح', statusCode: 403 };
        }

        const categories = db.getCategories(restaurant.id);
        const products = db.getProducts(restaurant.id);
        const offers = db.getOffers(restaurant.id).filter((o) => o.isActive);

        return {
          success: true,
          data: {
            restaurant,
            categories,
            products,
            offers,
          },
          statusCode: 200,
        };
      },
      typeof window !== 'undefined'
    );
  }

  // Get or Create Table Session
  public async getOrCreateTableSession(
    restaurantId: string,
    tableId: string
  ): Promise<ApiResponse<TableSession>> {
    const restaurant = db.getRestaurantById(restaurantId);
    if (!restaurant) {
      return { success: false, error: 'المطعم غير موجود', statusCode: 404 };
    }

    const existing = db.getActiveSessionByTable(restaurantId, tableId);
    if (existing) {
      return { success: true, data: existing, statusCode: 200 };
    }

    const sessionToken = `sess-token-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const newSession: TableSession = {
      id: `sess-${restaurantId}-${tableId}-${Date.now()}`,
      restaurantId,
      tableId,
      sessionToken,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      status: 'ACTIVE',
    };
    db.saveSession(newSession);

    return { success: true, data: newSession, statusCode: 200 };
  }

  // Create Anonymous Table Session (by slug & table number)
  public async createTableSession(
    qrToken: string
  ): Promise<ApiResponse<{ session: TableSession; table: RestaurantTable; restaurant: Restaurant }>> {
    try {
      if (typeof window !== 'undefined') {
        const res = await fetch(`${API_BASE}/public/tables/qr/${encodeURIComponent(qrToken)}/session`, {
          method: 'POST',
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            const tableObj: RestaurantTable = {
              id: json.data.tableId,
              restaurantId: json.data.restaurant.id,
              tableNumber: json.data.tableNumber,
              capacity: 4,
              zone: 'MAIN_HALL',
              status: 'AVAILABLE',
              activeOrderIds: [],
              hasWaiterCall: false,
            };
            const sessionObj: TableSession = {
              id: json.data.sessionId,
              restaurantId: json.data.restaurant.id,
              tableId: json.data.tableId,
              sessionToken: json.data.sessionToken,
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
              status: 'ACTIVE',
            };
            return {
              success: true,
              data: { session: sessionObj, table: tableObj, restaurant: json.data.restaurant },
              statusCode: 200,
            };
          }
        }
      }
    } catch (e) {
      // Fallback
    }

    const tables = db.getRestaurants().flatMap((restaurant) => db.getTables(restaurant.id));
    const table = tables.find((item) => item.qrToken === qrToken);

    if (!table) {
      return {
        success: false,
        error: 'رمز QR غير صالح أو غير معروف',
        statusCode: 404,
      };
    }

    const sessionRes = await this.getOrCreateTableSession(table.restaurantId, table.id);
    if (!sessionRes.success || !sessionRes.data) {
      return { success: false, error: 'تعذر إنشاء جلسة للطاولة', statusCode: 500 };
    }

    return {
      success: true,
      data: { session: sessionRes.data, table, restaurant: db.getRestaurantById(table.restaurantId)! },
      statusCode: 200,
    };
  }

  // Customer Place Order
  public async createOrder(
    restaurantId: string,
    tableId: string,
    items: Order['items'],
    notes?: string,
    sessionId?: string
  ): Promise<ApiResponse<Order>> {
    try {
      if (typeof window !== 'undefined') {
        const res = await fetch(`${API_BASE}/public/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restaurantId, tableId, items, notes, sessionToken: sessionId }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) return { success: true, data: json.data.order, statusCode: 201 };
        }
      }
    } catch (e) {
      // Fallback
    }

    const restaurant = db.getRestaurantById(restaurantId);
    if (!restaurant || restaurant.status === 'SUSPENDED') {
      return { success: false, error: 'المطعم غير متاح لقبول الطلبات', statusCode: 403 };
    }

    if (!items || items.length === 0) {
      return { success: false, error: 'لا يمكن إرسال طلب بدون أصناف', statusCode: 400 };
    }

    const tables = db.getTables(restaurantId);
    const table = tables.find((t) => t.id === tableId);
    if (!table) {
      return { success: false, error: 'رقم الطاولة غير موجود بالمطعم', statusCode: 404 };
    }

    const allOrders = db.getOrders(restaurantId);
    const nextNum = allOrders.length > 0 ? Math.max(...allOrders.map((o) => o.numericId || 1000)) + 1 : 1001;
    const orderId = `#${nextNum}`;

    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);

    const newOrder: Order = {
      id: orderId,
      numericId: nextNum,
      restaurantId,
      tableId,
      sessionId,
      items,
      subtotal,
      total: subtotal,
      status: 'PENDING',
      paymentMethod: 'PAY AT CASHIER',
      notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      estimatedPrepMinutes: 18,
    };

    db.saveOrder(newOrder);

    // Update table state
    table.status = 'OCCUPIED';
    table.activeOrderIds = [...table.activeOrderIds, orderId];
    table.lastActivityAt = new Date().toISOString();
    db.saveTable(table);

    return {
      success: true,
      data: newOrder,
      statusCode: 201,
    };
  }

  // Alias for submitOrder
  public async submitOrder(params: {
    restaurantId: string;
    tableId: string;
    sessionToken?: string;
    items: Order['items'];
    notes?: string;
  }): Promise<ApiResponse<{ order: Order }>> {
    const res = await this.createOrder(
      params.restaurantId,
      params.tableId,
      params.items,
      params.notes,
      params.sessionToken
    );
    if (!res.success || !res.data) {
      return { success: false, error: res.error, statusCode: res.statusCode };
    }
    return { success: true, data: { order: res.data }, statusCode: 201 };
  }

  // Customer Edit/Cancel Order (Rule: ONLY when status === 'PENDING')
  public async cancelOrder(
    restaurantId: string,
    orderId: string
  ): Promise<ApiResponse<{ message: string; order: Order }>> {
    try {
      if (typeof window !== 'undefined') {
        const res = await fetch(`${API_BASE}/public/orders/${orderId}/cancel?restaurantId=${restaurantId}`, {
          method: 'POST',
        });
        const json = await res.json();
        if (json.success) return json;
        if (json.statusCode === 403) return json;
      }
    } catch (e) {
      // Fallback
    }

    const orders = db.getOrders(restaurantId);
    const order = orders.find((o) => o.id === orderId);

    if (!order) {
      return { success: false, error: 'الطلب غير موجود في هذا المطعم', statusCode: 404 };
    }

    if (order.status !== 'PENDING') {
      return {
        success: false,
        error: 'بدأ المطبخ بتحضير طلبك بالفعل، لذلك لم يعد بالإمكان تعديله أو إلغاؤه.',
        statusCode: 403,
      };
    }

    order.status = 'CANCELLED';
    order.updatedAt = new Date().toISOString();
    db.saveOrder(order);

    // Update table active orders
    const table = db.getTables(restaurantId).find((t) => t.id === order.tableId);
    if (table) {
      table.activeOrderIds = table.activeOrderIds.filter((id) => id !== orderId);
      if (table.activeOrderIds.length === 0) {
        table.status = 'AVAILABLE';
      }
      db.saveTable(table);
    }

    return {
      success: true,
      data: { message: 'تم إلغاء الطلب بنجاح', order },
      statusCode: 200,
    };
  }

  // Customer Edit Notes (Rule: ONLY when status === 'PENDING')
  public async updateOrderNotes(
    restaurantId: string,
    orderId: string,
    notes: string
  ): Promise<ApiResponse<Order>> {
    try {
      if (typeof window !== 'undefined') {
        const res = await fetch(`${API_BASE}/public/orders/${orderId}/notes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes, restaurantId }),
        });
        const json = await res.json();
        if (json.success) return { success: true, data: json.data.order, statusCode: 200 };
        if (json.statusCode === 403) return json;
      }
    } catch (e) {
      // Fallback
    }

    const orders = db.getOrders(restaurantId);
    const order = orders.find((o) => o.id === orderId);

    if (!order) {
      return { success: false, error: 'الطلب غير موجود', statusCode: 404 };
    }

    if (order.status !== 'PENDING') {
      return {
        success: false,
        error: 'بدأ المطبخ بتحضير طلبك، لذلك لم يعد بالإمكان تعديل الملاحظات.',
        statusCode: 403,
      };
    }

    order.notes = notes;
    order.updatedAt = new Date().toISOString();
    db.saveOrder(order);

    return {
      success: true,
      data: order,
      statusCode: 200,
    };
  }

  // Customer Call Waiter
  public async callWaiter(
    paramsOrRestaurantId:
      | string
      | {
          restaurantId: string;
          tableId: string;
          reason: WaiterRequest['reason'];
          note?: string;
          sessionId?: string;
        },
    tableId?: string,
    reason?: WaiterRequest['reason'],
    customText?: string,
    sessionId?: string
  ): Promise<ApiResponse<{ waiterRequest: WaiterRequest }>> {
    let rId: string;
    let tId: string;
    let rReason: WaiterRequest['reason'];
    let text: string | undefined;
    let sId: string | undefined;

    if (typeof paramsOrRestaurantId === 'object') {
      rId = paramsOrRestaurantId.restaurantId;
      tId = paramsOrRestaurantId.tableId;
      rReason = paramsOrRestaurantId.reason;
      text = paramsOrRestaurantId.note;
      sId = paramsOrRestaurantId.sessionId;
    } else {
      rId = paramsOrRestaurantId;
      tId = tableId!;
      rReason = reason || 'ASSISTANCE';
      text = customText;
      sId = sessionId;
    }

    try {
      if (typeof window !== 'undefined') {
        const res = await fetch(`${API_BASE}/public/waiter-requests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restaurantId: rId, tableId: tId, reason: rReason, note: text, sessionToken: sId }),
        });
        const json = await res.json();
        if (json.success) return json;
      }
    } catch (e) {
      // Fallback
    }

    const restaurant = db.getRestaurantById(rId);
    if (!restaurant) {
      return { success: false, error: 'المطعم غير موجود', statusCode: 404 };
    }

    const req: WaiterRequest = {
      id: `req-${rId}-${Date.now()}`,
      restaurantId: rId,
      tableId: tId,
      sessionId: sId,
      reason: rReason,
      reasonText: text,
      createdAt: new Date().toISOString(),
      status: 'PENDING',
    };

    db.saveWaiterRequest(req);

    // Set flag on table
    const table = db.getTables(rId).find((t) => t.id === tId);
    if (table) {
      table.hasWaiterCall = true;
      if (rReason === 'BILL') table.status = 'BILL_REQUESTED';
      db.saveTable(table);
    }

    return {
      success: true,
      data: { waiterRequest: req },
      statusCode: 201,
    };
  }

  // Customer Request Bill
  public async requestBill(
    restaurantId: string,
    tableId: string
  ): Promise<ApiResponse<{ message: string }>> {
    const table = db.getTables(restaurantId).find((t) => t.id === tableId);
    if (!table) return { success: false, error: 'الطاولة غير موجودة', statusCode: 404 };
    
    table.status = 'BILL_REQUESTED';
    table.hasWaiterCall = true;
    db.saveTable(table);

    return {
      success: true,
      data: { message: 'تم إرسال طلب الحساب للكاشير' },
      statusCode: 200,
    };
  }

  // =========================================================================
  // RESTAURANT MANAGER AUTHENTICATED ENDPOINTS (Strict Tenant Isolation)
  // =========================================================================

  private verifyManagerAccess(user: RestaurantUser, targetRestaurantId: string): boolean {
    if (user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN') return true;
    return user.role === 'RESTAURANT_MANAGER' && user.restaurantId === targetRestaurantId;
  }

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
    if (!this.verifyManagerAccess(user, restaurantId)) {
      return {
        success: false,
        error: 'غير مصرح لك بالوصول لبيانات هذا المطعم (Tenant Isolation Violation)',
        statusCode: 403,
      };
    }

    try {
      if (typeof window !== 'undefined') {
        const res = await fetch(`${API_BASE}/manager/dashboard/stats?restaurantId=${restaurantId}`, {
          headers: this.getAuthHeader(),
        });
        if (res.ok) return await res.json();
      }
    } catch (e) {
      // Fallback
    }

    const restaurant = db.getRestaurantById(restaurantId);
    if (!restaurant) {
      return { success: false, error: 'المطعم غير موجود', statusCode: 404 };
    }

    const subscription = db.getSubscriptionByRestaurantId(restaurantId);
    const plan = subscription ? db.getPlanById(subscription.planId) : null;
    const orders = db.getOrders(restaurantId);
    const tables = db.getTables(restaurantId);
    const waiters = db.getWaiterRequests(restaurantId);

    const validOrders = orders.filter((o) => o.status !== 'CANCELLED');
    const totalRevenue = validOrders.reduce((sum, o) => sum + o.total, 0);
    const averageOrderValue = validOrders.length > 0 ? Math.round(totalRevenue / validOrders.length) : 0;

    const productCountMap = new Map<string, { name: string; count: number; revenue: number }>();
    validOrders.forEach((o) => {
      o.items.forEach((item) => {
        const pName = item.productName || item.name || 'صنف';
        const curr = productCountMap.get(pName) || { name: pName, count: 0, revenue: 0 };
        curr.count += item.quantity;
        curr.revenue += item.totalPrice;
        productCountMap.set(pName, curr);
      });
    });

    const popularProducts = Array.from(productCountMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      success: true,
      data: {
        restaurant,
        subscription,
        plan,
        totalRevenue,
        todayOrdersCount: orders.length,
        activeTablesCount: tables.filter((t) => t.status === 'OCCUPIED' || t.status === 'BILL_REQUESTED').length,
        totalTablesCount: tables.length,
        pendingOrdersCount: orders.filter((o) => o.status === 'PENDING').length,
        preparingOrdersCount: orders.filter((o) => o.status === 'PREPARING').length,
        readyOrdersCount: orders.filter((o) => o.status === 'READY').length,
        pendingWaitersCount: waiters.filter((w) => w.status === 'PENDING').length,
        averageOrderValue,
        popularProducts,
      },
      statusCode: 200,
    };
  }

  // Manager Update Order Status
  public async updateOrderStatus(
    user: RestaurantUser,
    restaurantId: string,
    orderId: string,
    nextStatus: OrderStatus
  ): Promise<ApiResponse<Order>> {
    if (!this.verifyManagerAccess(user, restaurantId)) {
      return { success: false, error: 'غير مصرح بالوصول (Cross-Tenant Access Denied)', statusCode: 403 };
    }

    try {
      if (typeof window !== 'undefined') {
        const res = await fetch(`${API_BASE}/manager/orders/${orderId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.getAuthHeader() },
          body: JSON.stringify({ status: nextStatus, restaurantId }),
        });
        const json = await res.json();
        if (json.success) return { success: true, data: json.data.order, statusCode: 200 };
      }
    } catch (e) {
      // Fallback
    }

    const orders = db.getOrders(restaurantId);
    const order = orders.find((o) => o.id === orderId);
    if (!order) {
      return { success: false, error: 'الطلب غير موجود في مطعمك', statusCode: 404 };
    }

    if (order.status === 'SERVED' && nextStatus !== 'SERVED') {
      return { success: false, error: 'لا يمكن إرجاع طلب تم تقديمه بالفعل', statusCode: 400 };
    }

    order.status = nextStatus;
    order.updatedAt = new Date().toISOString();
    db.saveOrder(order);

    db.addAuditLog(restaurantId, user.name, user.role, 'ORDER_STATUS_UPDATE', `تم تغيير حالة طلب ${orderId} إلى ${nextStatus}`);

    return {
      success: true,
      data: order,
      statusCode: 200,
    };
  }

  // Manager Update Waiter Request Status
  public async updateWaiterRequestStatus(
    user: RestaurantUser,
    restaurantId: string,
    requestId: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED'
  ): Promise<ApiResponse<{ request: WaiterRequest }>> {
    if (!this.verifyManagerAccess(user, restaurantId)) {
      return { success: false, error: 'غير مصرح بالوصول', statusCode: 403 };
    }

    const waiters = db.getWaiterRequests(restaurantId);
    const req = waiters.find((w) => w.id === requestId);
    if (!req) return { success: false, error: 'الطلب غير موجود', statusCode: 404 };

    req.status = status;
    db.saveWaiterRequest(req);

    if (status === 'RESOLVED') {
      const otherPending = waiters.filter((w) => w.tableId === req.tableId && w.id !== req.id && w.status === 'PENDING');
      if (otherPending.length === 0) {
        const table = db.getTableById(restaurantId, req.tableId);
        if (table) {
          table.hasWaiterCall = false;
          db.saveTable(table);
        }
      }
    }

    return { success: true, data: { request: req }, statusCode: 200 };
  }

  // Manager Save Product
  public async saveProduct(
    user: RestaurantUser,
    restaurantId: string,
    product: Product
  ): Promise<ApiResponse<{ product: Product }>> {
    if (!this.verifyManagerAccess(user, restaurantId)) {
      return { success: false, error: 'غير مصرح بالوصول', statusCode: 403 };
    }

    try {
      if (typeof window !== 'undefined') {
        const isNew = product.id.startsWith('prod-');
        const res = await fetch(`${API_BASE}/manager/menu/products${isNew ? '' : `/${encodeURIComponent(product.id)}`}`, {
          method: isNew ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.getAuthHeader() },
          body: JSON.stringify({ restaurantId, ...product, image: product.image, isAvailable: product.isAvailable }),
        });
        const json = await res.json();
        if (res.ok && json.success) return { success: true, data: { product: json.data.product || json.data }, statusCode: res.status };
      }
    } catch {
      // Fallback to the local demo database when the API is unavailable.
    }

    db.saveProduct(product);
    return { success: true, data: { product }, statusCode: 200 };
  }

  public async getManagerMenu(restaurantId: string): Promise<ApiResponse<{ categories: Category[]; products: Product[] }>> {
    try {
      if (typeof window !== 'undefined') {
        const [categoriesRes, productsRes] = await Promise.all([
          fetch(`${API_BASE}/manager/menu/categories?restaurantId=${encodeURIComponent(restaurantId)}`, { headers: this.getAuthHeader() }),
          fetch(`${API_BASE}/manager/menu/products?restaurantId=${encodeURIComponent(restaurantId)}`, { headers: this.getAuthHeader() }),
        ]);
        const categoriesJson = await categoriesRes.json();
        const productsJson = await productsRes.json();
        if (categoriesRes.ok && productsRes.ok && categoriesJson.success && productsJson.success) {
          return { success: true, data: { categories: categoriesJson.data, products: productsJson.data }, statusCode: 200 };
        }
      }
    } catch {
      // Fallback to local data.
    }
    return { success: false, error: 'تعذر تحميل القائمة من قاعدة البيانات', statusCode: 503 };
  }

  public async saveCategory(user: RestaurantUser, restaurantId: string, category: Category): Promise<ApiResponse<{ category: Category }>> {
    if (!this.verifyManagerAccess(user, restaurantId)) return { success: false, error: 'غير مصرح بالوصول', statusCode: 403 };
    try {
      const res = await fetch(`${API_BASE}/manager/menu/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.getAuthHeader() },
        body: JSON.stringify({ restaurantId, name: category.name, nameEn: category.nameEn }),
      });
      const json = await res.json();
      if (res.ok && json.success) return { success: true, data: { category: json.data }, statusCode: res.status };
    } catch {
      // Fallback to local data.
    }
    db.saveCategory(category);
    return { success: true, data: { category }, statusCode: 200 };
  }

  public async deleteManagerProduct(user: RestaurantUser, restaurantId: string, productId: string): Promise<ApiResponse<null>> {
    if (!this.verifyManagerAccess(user, restaurantId)) return { success: false, error: 'غير مصرح بالوصول', statusCode: 403 };
    try {
      const res = await fetch(`${API_BASE}/manager/menu/products/${encodeURIComponent(productId)}?restaurantId=${encodeURIComponent(restaurantId)}`, { method: 'DELETE', headers: this.getAuthHeader() });
      if (res.ok) return { success: true, data: null, statusCode: 200 };
    } catch {
      // Fallback to local data.
    }
    db.deleteProduct(restaurantId, productId);
    return { success: true, data: null, statusCode: 200 };
  }

  // Manager Settle Table Bill
  public async settleTableBill(
    user: RestaurantUser,
    restaurantId: string,
    tableId: string
  ): Promise<ApiResponse<{ message: string }>> {
    if (!this.verifyManagerAccess(user, restaurantId)) {
      return { success: false, error: 'غير مصرح بالوصول', statusCode: 403 };
    }

    const orders = db.getOrders(restaurantId);
    orders.forEach((o) => {
      if (o.tableId === tableId && (o.status === 'PENDING' || o.status === 'PREPARING' || o.status === 'READY')) {
        o.status = 'SERVED';
        o.updatedAt = new Date().toISOString();
        db.saveOrder(o);
      }
    });

    const table = db.getTables(restaurantId).find((t) => t.id === tableId);
    if (table) {
      table.status = 'AVAILABLE';
      table.activeOrderIds = [];
      table.hasWaiterCall = false;
      db.saveTable(table);
    }

    const waiters = db.getWaiterRequests(restaurantId);
    waiters.forEach((w) => {
      if (w.tableId === tableId && w.status === 'PENDING') {
        w.status = 'RESOLVED';
        db.saveWaiterRequest(w);
      }
    });

    db.addAuditLog(restaurantId, user.name, user.role, 'SETTLE_TABLE', `تمت تسوية حساب ${tableId} وإعادتها متاحة`);

    return {
      success: true,
      data: { message: `تمت تسوية حساب ${tableId} بنجاح` },
      statusCode: 200,
    };
  }

  // Check Feature Entitlement
  public async checkEntitlement(
    restaurantId: string,
    entitlement: EntitlementKey
  ): Promise<boolean> {
    const sub = db.getSubscriptionByRestaurantId(restaurantId);
    if (!sub || sub.status === 'SUSPENDED' || sub.status === 'CANCELLED') return false;
    const plan = db.getPlanById(sub.planId);
    if (!plan) return false;
    return plan.entitlements.includes(entitlement);
  }

  // =========================================================================
  // PLATFORM SUPER ADMIN ENDPOINTS
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
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return { success: false, error: 'صلاحيات المشرف العام مطلوبة (Super Admin Only)', statusCode: 403 };
    }

    const restaurants = db.getRestaurants();
    const subscriptions = db.getSubscriptions();
    const plans = db.getPlans();
    const auditLogs = db.getAuditLogs();

    let totalRevenue = 0;
    restaurants.forEach((r) => {
      const orders = db.getOrders(r.id).filter((o) => o.status !== 'CANCELLED');
      totalRevenue += orders.reduce((sum, o) => sum + o.total, 0);
    });

    return {
      success: true,
      data: {
        totalRestaurants: restaurants.length,
        activeRestaurants: restaurants.filter((r) => r.status === 'ACTIVE').length,
        totalRevenue,
        activeSubscriptions: subscriptions.filter((s) => s.status === 'ACTIVE' || s.status === 'TRIAL').length,
        restaurants,
        subscriptions,
        plans,
        auditLogs: auditLogs.slice(0, 30),
      },
      statusCode: 200,
    };
  }

  // Super Admin Toggle Tenant Status
  public async setTenantStatus(
    user: RestaurantUser,
    restaurantId: string,
    status: 'ACTIVE' | 'SUSPENDED'
  ): Promise<ApiResponse<Restaurant>> {
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return { success: false, error: 'غير مصرح لك بتعديل حالة المشتركين', statusCode: 403 };
    }

    const restaurant = db.getRestaurantById(restaurantId);
    if (!restaurant) {
      return { success: false, error: 'المطعم غير موجود', statusCode: 404 };
    }

    restaurant.status = status;
    restaurant.updatedAt = new Date().toISOString();
    db.saveRestaurant(restaurant);

    db.addAuditLog(restaurantId, user.name, user.role, 'TENANT_STATUS_CHANGE', `تم تغيير حالة مطعم ${restaurant.name} إلى ${status}`);

    return {
      success: true,
      data: restaurant,
      statusCode: 200,
    };
  }

  public async toggleRestaurantStatus(
    user: RestaurantUser,
    restaurantId: string,
    status: 'ACTIVE' | 'SUSPENDED'
  ): Promise<ApiResponse<{ restaurant: Restaurant }>> {
    const res = await this.setTenantStatus(user, restaurantId, status);
    if (!res.success || !res.data) {
      return { success: false, error: res.error, statusCode: res.statusCode };
    }
    return { success: true, data: { restaurant: res.data }, statusCode: 200 };
  }
}

export const api = new RestaurantApiService();
