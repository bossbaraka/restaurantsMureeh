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
  TableSession,
  AuditLog,
} from '../types/restaurant';
import {
  SEED_RESTAURANTS,
  SEED_PLANS,
  SEED_SUBSCRIPTIONS,
  SEED_USERS,
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_TABLES,
  SEED_ORDERS,
  SEED_WAITER_REQUESTS,
  SEED_OFFERS,
  SEED_AUDIT_LOGS,
} from '../data/seedData';

const DB_KEYS = {
  RESTAURANTS: 'saas_db_restaurants_v2',
  PLANS: 'saas_db_plans_v2',
  SUBSCRIPTIONS: 'saas_db_subscriptions_v2',
  USERS: 'saas_db_users_v2',
  CATEGORIES: 'saas_db_categories_v2',
  PRODUCTS: 'saas_db_products_v2',
  TABLES: 'saas_db_tables_v2',
  ORDERS: 'saas_db_orders_v2',
  WAITER_REQUESTS: 'saas_db_waiter_reqs_v2',
  OFFERS: 'saas_db_offers_v2',
  SESSIONS: 'saas_db_sessions_v2',
  AUDIT_LOGS: 'saas_db_audit_logs_v2',
};

class MultiTenantDatabase {
  private inMemoryStore: Record<string, any> = {};

  private getItem<T>(key: string, seedFallback: T): T {
    if (typeof window === 'undefined') {
      if (!this.inMemoryStore[key]) {
        this.inMemoryStore[key] = JSON.parse(JSON.stringify(seedFallback));
      }
      return this.inMemoryStore[key];
    }
    try {
      const data = localStorage.getItem(key);
      if (!data) {
        localStorage.setItem(key, JSON.stringify(seedFallback));
        return JSON.parse(JSON.stringify(seedFallback));
      }
      const parsed = JSON.parse(data) as T;
      if (Array.isArray(parsed) && Array.isArray(seedFallback)) {
        const existingIds = new Set(parsed.map((item: any) => item?.id));
        const missingDemoRecords = (seedFallback as any[]).filter(
          (item) => (item?.restaurantId === 'rest-demo-promo' || item?.id === 'rest-demo-promo' || item?.id === 'user-demo-manager') && !existingIds.has(item.id)
        );
        if (missingDemoRecords.length > 0) {
          const merged = [...parsed, ...JSON.parse(JSON.stringify(missingDemoRecords))] as T;
          localStorage.setItem(key, JSON.stringify(merged));
          return merged;
        }
      }
      return parsed;
    } catch {
      return JSON.parse(JSON.stringify(seedFallback));
    }
  }

  private setItem<T>(key: string, data: T): void {
    if (typeof window === 'undefined') {
      this.inMemoryStore[key] = JSON.parse(JSON.stringify(data));
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error(`Database write failed for key ${key}:`, e);
    }
  }

  // --- RESTAURANTS ---
  public getRestaurants(): Restaurant[] {
    return this.getItem(DB_KEYS.RESTAURANTS, SEED_RESTAURANTS);
  }

  public getRestaurantById(id: string): Restaurant | null {
    const list = this.getRestaurants();
    return list.find((r) => r.id === id) || null;
  }

  public getRestaurantBySlug(slug: string): Restaurant | null {
    const list = this.getRestaurants();
    return list.find((r) => r.slug.toLowerCase() === slug.toLowerCase()) || null;
  }

  public saveRestaurant(restaurant: Restaurant): void {
    const list = this.getRestaurants();
    const idx = list.findIndex((r) => r.id === restaurant.id);
    if (idx >= 0) {
      list[idx] = { ...restaurant, updatedAt: new Date().toISOString() };
    } else {
      list.push(restaurant);
    }
    this.setItem(DB_KEYS.RESTAURANTS, list);
    this.addAuditLog(restaurant.id, 'System', 'RESTAURANT_MANAGER', 'SAVE_RESTAURANT', `تم حفظ بيانات مطعم ${restaurant.name}`);
  }

  // --- PLANS & SUBSCRIPTIONS ---
  public getPlans(): Plan[] {
    return this.getItem(DB_KEYS.PLANS, SEED_PLANS);
  }

  public getPlanById(planId: string): Plan | null {
    return this.getPlans().find((p) => p.id === planId) || null;
  }

  public getSubscriptions(): Subscription[] {
    return this.getItem(DB_KEYS.SUBSCRIPTIONS, SEED_SUBSCRIPTIONS);
  }

  public getSubscriptionByRestaurantId(restaurantId: string): Subscription | null {
    return this.getSubscriptions().find((s) => s.restaurantId === restaurantId) || null;
  }

  public saveSubscription(sub: Subscription): void {
    const list = this.getSubscriptions();
    const idx = list.findIndex((s) => s.id === sub.id || s.restaurantId === sub.restaurantId);
    if (idx >= 0) {
      list[idx] = sub;
    } else {
      list.push(sub);
    }
    this.setItem(DB_KEYS.SUBSCRIPTIONS, list);
  }

  // --- USERS ---
  public getUsers(): RestaurantUser[] {
    return this.getItem(DB_KEYS.USERS, SEED_USERS);
  }

  public getUserByEmail(email: string): RestaurantUser | null {
    return this.getUsers().find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
  }

  public saveUser(user: RestaurantUser): void {
    const list = this.getUsers();
    const idx = list.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      list[idx] = user;
    } else {
      list.push(user);
    }
    this.setItem(DB_KEYS.USERS, list);
  }

  public deleteUser(restaurantId: string, userId: string): void {
    const users = this.getUsers();
    this.setItem(DB_KEYS.USERS, users.filter((user) => !(user.restaurantId === restaurantId && user.id === userId)));
  }

  // --- CATEGORIES (Tenant-Scoped) ---
  public getCategories(restaurantId: string): Category[] {
    const all = this.getItem(DB_KEYS.CATEGORIES, SEED_CATEGORIES);
    return all.filter((c) => c.restaurantId === restaurantId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  public saveCategory(category: Category): void {
    const all = this.getItem(DB_KEYS.CATEGORIES, SEED_CATEGORIES);
    const idx = all.findIndex((c) => c.id === category.id);
    if (idx >= 0) {
      all[idx] = category;
    } else {
      all.push(category);
    }
    this.setItem(DB_KEYS.CATEGORIES, all);
  }

  public deleteCategory(restaurantId: string, categoryId: string): void {
    const all = this.getItem(DB_KEYS.CATEGORIES, SEED_CATEGORIES);
    const filtered = all.filter((c) => !(c.id === categoryId && c.restaurantId === restaurantId));
    this.setItem(DB_KEYS.CATEGORIES, filtered);
  }

  // --- PRODUCTS (Tenant-Scoped) ---
  public getProducts(restaurantId: string): Product[] {
    const all = this.getItem(DB_KEYS.PRODUCTS, SEED_PRODUCTS);
    return all.filter((p) => p.restaurantId === restaurantId);
  }

  public getProductById(restaurantId: string, productId: string): Product | null {
    const products = this.getProducts(restaurantId);
    return products.find((p) => p.id === productId) || null;
  }

  public saveProduct(product: Product): void {
    const all = this.getItem(DB_KEYS.PRODUCTS, SEED_PRODUCTS);
    const idx = all.findIndex((p) => p.id === product.id && p.restaurantId === product.restaurantId);
    if (idx >= 0) {
      all[idx] = product;
    } else {
      all.push(product);
    }
    this.setItem(DB_KEYS.PRODUCTS, all);
  }

  public deleteProduct(restaurantId: string, productId: string): void {
    const all = this.getItem(DB_KEYS.PRODUCTS, SEED_PRODUCTS);
    const filtered = all.filter((p) => !(p.id === productId && p.restaurantId === restaurantId));
    this.setItem(DB_KEYS.PRODUCTS, filtered);
  }

  // --- TABLES (Tenant-Scoped) ---
  public getTables(restaurantId: string): RestaurantTable[] {
    const all = this.getItem(DB_KEYS.TABLES, SEED_TABLES);
    let changed = false;
    const migrated = all.map((table) => {
      if (table.qrToken) return table;
      changed = true;
      const randomToken = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
      return { ...table, qrToken: `qr-${table.restaurantId}-${randomToken}` };
    });

    if (changed) this.setItem(DB_KEYS.TABLES, migrated);
    return migrated.filter((t) => t.restaurantId === restaurantId).sort((a, b) => a.tableNumber - b.tableNumber);
  }

  public getTableById(restaurantId: string, tableId: string): RestaurantTable | null {
    const tables = this.getTables(restaurantId);
    return tables.find((t) => t.id === tableId) || null;
  }

  public saveTable(table: RestaurantTable): void {
    const all = this.getItem(DB_KEYS.TABLES, SEED_TABLES);
    const idx = all.findIndex((t) => t.id === table.id && t.restaurantId === table.restaurantId);
    if (idx >= 0) {
      all[idx] = table;
    } else {
      all.push(table);
    }
    this.setItem(DB_KEYS.TABLES, all);
  }

  public saveTablesBatch(tables: RestaurantTable[]): void {
    const all = this.getItem(DB_KEYS.TABLES, SEED_TABLES);
    const incomingMap = new Map(tables.map((t) => [`${t.restaurantId}_${t.id}`, t]));
    const updated = all.map((t) => incomingMap.get(`${t.restaurantId}_${t.id}`) || t);

    tables.forEach((t) => {
      if (!all.some((existing) => existing.restaurantId === t.restaurantId && existing.id === t.id)) {
        updated.push(t);
      }
    });
    this.setItem(DB_KEYS.TABLES, updated);
  }

  // --- ORDERS (Tenant-Scoped) ---
  public getOrders(restaurantId: string): Order[] {
    const all = this.getItem(DB_KEYS.ORDERS, SEED_ORDERS);
    return all.filter((o) => o.restaurantId === restaurantId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public getOrderById(restaurantId: string, orderId: string): Order | null {
    const orders = this.getOrders(restaurantId);
    return orders.find((o) => o.id === orderId) || null;
  }

  public saveOrder(order: Order): void {
    const all = this.getItem(DB_KEYS.ORDERS, SEED_ORDERS);
    const idx = all.findIndex((o) => o.id === order.id && o.restaurantId === order.restaurantId);
    if (idx >= 0) {
      all[idx] = { ...order, updatedAt: new Date().toISOString() };
    } else {
      all.unshift(order);
    }
    this.setItem(DB_KEYS.ORDERS, all);
  }

  // --- WAITER REQUESTS (Tenant-Scoped) ---
  public getWaiterRequests(restaurantId: string): WaiterRequest[] {
    const all = this.getItem(DB_KEYS.WAITER_REQUESTS, SEED_WAITER_REQUESTS);
    return all.filter((w) => w.restaurantId === restaurantId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public saveWaiterRequest(req: WaiterRequest): void {
    const all = this.getItem(DB_KEYS.WAITER_REQUESTS, SEED_WAITER_REQUESTS);
    const idx = all.findIndex((w) => w.id === req.id && w.restaurantId === req.restaurantId);
    if (idx >= 0) {
      all[idx] = req;
    } else {
      all.unshift(req);
    }
    this.setItem(DB_KEYS.WAITER_REQUESTS, all);
  }

  // --- OFFERS (Tenant-Scoped) ---
  public getOffers(restaurantId: string): Offer[] {
    const all = this.getItem(DB_KEYS.OFFERS, SEED_OFFERS);
    return all.filter((o) => o.restaurantId === restaurantId);
  }

  public saveOffer(offer: Offer): void {
    const all = this.getItem(DB_KEYS.OFFERS, SEED_OFFERS);
    const idx = all.findIndex((o) => o.id === offer.id && o.restaurantId === offer.restaurantId);
    if (idx >= 0) {
      all[idx] = offer;
    } else {
      all.push(offer);
    }
    this.setItem(DB_KEYS.OFFERS, all);
  }

  public deleteOffer(restaurantId: string, offerId: string): void {
    const all = this.getItem(DB_KEYS.OFFERS, SEED_OFFERS);
    const filtered = all.filter((o) => !(o.id === offerId && o.restaurantId === restaurantId));
    this.setItem(DB_KEYS.OFFERS, filtered);
  }

  // --- SESSIONS ---
  public getSessions(): TableSession[] {
    return this.getItem(DB_KEYS.SESSIONS, []);
  }

  public getActiveSessionByTable(restaurantId: string, tableId: string): TableSession | null {
    const sessions = this.getSessions();
    return sessions.find((s) => s.restaurantId === restaurantId && s.tableId === tableId && s.status === 'ACTIVE') || null;
  }

  public saveSession(session: TableSession): void {
    const all = this.getSessions();
    const idx = all.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      all[idx] = session;
    } else {
      all.push(session);
    }
    this.setItem(DB_KEYS.SESSIONS, all);
  }

  // --- AUDIT LOGS ---
  public getAuditLogs(restaurantId?: string): AuditLog[] {
    const all = this.getItem(DB_KEYS.AUDIT_LOGS, SEED_AUDIT_LOGS);
    if (!restaurantId) return all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return all.filter((l) => l.restaurantId === restaurantId || !l.restaurantId).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  public addAuditLog(
    restaurantId: string | undefined,
    actor: string,
    actorRole: AuditLog['actorRole'],
    action: string,
    details: string
  ): void {
    const all = this.getAuditLogs();
    const log: AuditLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      restaurantId,
      actor,
      actorRole,
      action,
      details,
      timestamp: new Date().toISOString(),
    };
    all.unshift(log);
    this.setItem(DB_KEYS.AUDIT_LOGS, all.slice(0, 100));
  }

  // Reset demo database to initial state
  public resetToSeed(): void {
    this.inMemoryStore = {};
    if (typeof window !== 'undefined') {
      localStorage.removeItem(DB_KEYS.RESTAURANTS);
      localStorage.removeItem(DB_KEYS.PLANS);
      localStorage.removeItem(DB_KEYS.SUBSCRIPTIONS);
      localStorage.removeItem(DB_KEYS.USERS);
      localStorage.removeItem(DB_KEYS.CATEGORIES);
      localStorage.removeItem(DB_KEYS.PRODUCTS);
      localStorage.removeItem(DB_KEYS.TABLES);
      localStorage.removeItem(DB_KEYS.ORDERS);
      localStorage.removeItem(DB_KEYS.WAITER_REQUESTS);
      localStorage.removeItem(DB_KEYS.OFFERS);
      localStorage.removeItem(DB_KEYS.SESSIONS);
      localStorage.removeItem(DB_KEYS.AUDIT_LOGS);
    }
  }
}

export const db = new MultiTenantDatabase();
