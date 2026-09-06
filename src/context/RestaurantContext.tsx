import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Restaurant,
  Category,
  Product,
  RestaurantTable,
  Order,
  OrderStatus,
  OrderItem,
  WaiterRequest,
  Offer,
  CartItem,
  CartItemOption,
  ToastMessage,
  RestaurantUser,
  TableSession,
  EntitlementKey,
  PaymentRecord,
  Branch,
  Plan,
  Subscription,
} from '../types/restaurant';
import { api } from '../services/api';
import { useAuth } from './AuthContext';
import { soundFX } from '../utils/audio';

export type AppViewMode = 'CUSTOMER' | 'MANAGER' | 'ADMIN' | 'ONBOARDING' | 'PLATFORM_ADMIN' | 'SPLIT_PREVIEW' | 'KITCHEN_KDS' | 'SAAS_LANDING' | 'LIVE_SCREEN';

interface RestaurantContextType {
  // Current Tenant Info
  currentRestaurant: Restaurant | null;
  setCurrentRestaurant: (rest: Restaurant | null) => void;
  availableRestaurants: Restaurant[];
  tenantsList: Restaurant[];
  currentUser: RestaurantUser | null;
  setCurrentUser: (user: RestaurantUser | null) => void;

  // Tenant Entitlements Checker
  checkEntitlement: (key: EntitlementKey) => boolean;
  hasEntitlement: (key: EntitlementKey) => boolean;

  // View & UI Navigation
  viewMode: AppViewMode;
  setViewMode: (mode: AppViewMode) => void;
  selectedCategoryId: string;
  setSelectedCategoryId: (id: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isOnboardingOpen: boolean;
  setIsOnboardingOpen: (open: boolean) => void;

  // Sound
  soundEnabled: boolean;
  toggleSound: () => void;
  refreshTenantData: () => void;

  // Active Customer Table Session
  activeTableId: string | null;
  setActiveTableId: (tableId: string | null) => void;
  currentTableSession: TableSession | null;
  setTableByNumber: (num: number) => { success: boolean; tableId?: string; error?: string };
  validateAndSetTable: (num: number) => { success: boolean; tableId?: string; error?: string };

  // Tenant Catalog Data
  categories: Category[];
  products: Product[];
  offers: Offer[];
  tables: RestaurantTable[];
  orders: Order[];
  waiterRequests: WaiterRequest[];
  payments: PaymentRecord[];
  branches: Branch[];

  // Customer Cart Management
  cartItems: CartItem[];
  addToCart: (product: Product, quantity: number, options: CartItemOption) => void;
  updateCartItemQuantity: (cartItemId: string, quantity: number) => void;
  removeFromCart: (cartItemId: string) => void;
  clearCart: () => void;
  cartSubtotal: number;
  cartTotalCount: number;

  // Modal & Drawer States
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  isOrderTrackingOpen: boolean;
  setIsOrderTrackingOpen: (open: boolean) => void;
  isWaiterModalOpen: boolean;
  setIsWaiterModalOpen: (open: boolean) => void;
  isTableSelectorOpen: boolean;
  setIsTableSelectorOpen: (open: boolean) => void;

  // Customer Ordering Lifecycle
  createOrder: (notes?: string) => Promise<{ success: boolean; order?: Order; error?: string }>;
  cancelCustomerOrder: (orderId: string) => Promise<{ success: boolean; message: string }>;
  editCustomerOrderNotes: (orderId: string, notes: string) => Promise<{ success: boolean; message: string }>;
  callWaiter: (reasonOrTableId: WaiterRequest['reason'] | string, maybeReason?: WaiterRequest['reason'] | string, customText?: string) => void;
  activeTableOrders: Order[];

  // Manager Actions
  updateOrderStatus: (orderId: string, status: OrderStatus) => boolean;
  updateTableStatus: (tableId: string, status: RestaurantTable['status']) => void;
  settleTableAndFree: (tableId: string) => void;
  resolveWaiterRequest: (requestId: string) => void;
  acknowledgeWaiterRequest: (requestId: string) => void;
  toggleProductStock: (productId: string) => void;
  toggleProductAvailability: (productId: string) => void;
  addProduct: (product: Omit<Product, 'id' | 'restaurantId'>) => void;
  updateProduct: (product: Product) => void;
  deleteProduct: (productId: string) => void;
  addCategory: (name: string, nameEn?: string) => void;
  updateCategory: (category: Category) => void;
  deleteCategory: (categoryId: string) => void;
  addOffer: (offer: Omit<Offer, 'id' | 'restaurantId'>) => void;
  deleteOffer: (offerId: string) => void;

  // Platform Admin Super Controls
  switchTenantBySlug: (slug: string) => void;
  setCurrentTenantBySlug: (slug: string) => void;
  logout: () => void;

  // Toast System
  toasts: ToastMessage[];
  showToast: (type: ToastMessage['type'], title: string, message?: string) => void;
  dismissToast: (id: string) => void;
  removeToast: (id: string) => void;
}

const RestaurantContext = createContext<RestaurantContextType | undefined>(undefined);

const OPEN_ORDER_STATUSES: OrderStatus[] = ['PENDING', 'PREPARING', 'READY', 'SERVED'];

export const RestaurantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const { currentUser, currentManagerRestaurant, setCurrentUser: authSetCurrentUser, logout: authLogout } = auth;

  const [currentRestaurant, setCurrentRestaurant] = useState<Restaurant | null>(null);
  const [viewMode, setViewModeState] = useState<AppViewMode>(() => {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      const hasQr = new URLSearchParams(window.location.search).has('qr');
      const isPublicRestaurantLink = pathname.startsWith('/r/') || hasQr;
      if (isPublicRestaurantLink) return 'CUSTOMER';

      const isRootPath = pathname === '/' || pathname === '';
      if (isRootPath) return 'SAAS_LANDING';

      const savedView = localStorage.getItem('merar_view_mode') as AppViewMode;
      if (savedView) return savedView;
    }
    return 'SAAS_LANDING';
  });

  const setViewMode = useCallback((mode: AppViewMode) => {
    setViewModeState(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('merar_view_mode', mode);
    }
  }, []);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [currentTableSession, setCurrentTableSession] = useState<TableSession | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isOrderTrackingOpen, setIsOrderTrackingOpen] = useState(false);
  const [isWaiterModalOpen, setIsWaiterModalOpen] = useState(false);
  const [isTableSelectorOpen, setIsTableSelectorOpen] = useState(false);

  // Real tenant catalog data (fetched from the API only)
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [waiterRequests, setWaiterRequests] = useState<WaiterRequest[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [availableRestaurants, setAvailableRestaurants] = useState<Restaurant[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [urlHandledRef] = useState<{ done: boolean }>({ done: false });
  const isFetchingRef = useRef(false);

  const showToast = useCallback((type: ToastMessage['type'], title: string, message?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const removeToast = dismissToast;

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      soundFX.setSoundEnabled(next);
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Real tenant data loading — guarded against duplicate parallel requests
  // -------------------------------------------------------------------------
  const refreshTenantData = useCallback(async () => {
    if (!currentRestaurant?.id || isFetchingRef.current) return;
    isFetchingRef.current = true;
    const tenantId = currentRestaurant.id;

    try {
      if (currentUser) {
        const [menuRes, ordersRes, tablesRes, waitersRes, offersRes, paymentsRes, branchesRes, subRes] = await Promise.all([
          api.getManagerMenu(tenantId),
          api.getManagerOrders(tenantId),
          api.getManagerTables(tenantId),
          api.getManagerWaiterRequests(tenantId),
          api.getManagerOffers(tenantId),
          api.getPayments(currentUser, tenantId),
          api.getManagerBranches(currentUser, tenantId),
          api.getManagerSubscription(tenantId),
        ]);

        if (menuRes.success && menuRes.data) {
          setCategories(menuRes.data.categories);
          setProducts(menuRes.data.products);
        }
        let nextOrders: Order[] = [];
        if (ordersRes.success && ordersRes.data) {
          nextOrders = ordersRes.data;
          setOrders(nextOrders);
        }
        if (tablesRes.success && tablesRes.data) {
          const openOrderIdsByTable = new Map<string, string[]>();
          nextOrders.forEach((o) => {
            if (
              o.tableId &&
              o.status !== 'CANCELLED' &&
              o.paymentStatus !== 'PAID' &&
              OPEN_ORDER_STATUSES.includes(o.status)
            ) {
              const list = openOrderIdsByTable.get(o.tableId) || [];
              list.push(o.id);
              openOrderIdsByTable.set(o.tableId, list);
            }
          });
          setTables(
            tablesRes.data.map((t) => ({
              ...t,
              activeOrderIds: openOrderIdsByTable.get(t.id) || [],
            }))
          );
        }
        if (waitersRes.success && waitersRes.data) setWaiterRequests(waitersRes.data);
        if (offersRes.success && offersRes.data) setOffers(offersRes.data);
        if (paymentsRes.success && paymentsRes.data) setPayments(paymentsRes.data);
        if (branchesRes.success && branchesRes.data) setBranches(branchesRes.data);
        if (subRes.success && subRes.data) {
          setSubscription(subRes.data.subscription);
          setPlans(subRes.data.plans);
        }
      } else if (currentRestaurant?.slug && currentTableSession?.sessionToken) {
        const catalogRes = await api.getPublicRestaurantBySlug(currentRestaurant.slug, currentTableSession.sessionToken);
        if (catalogRes.success && catalogRes.data) {
          setCategories(catalogRes.data.categories);
          setProducts(catalogRes.data.products);
          setOffers(catalogRes.data.offers);
        }
      }
    } catch {
      /* ignore transient background errors */
    } finally {
      isFetchingRef.current = false;
    }
  }, [currentRestaurant?.id, currentRestaurant?.slug, currentUser?.id, currentTableSession?.sessionToken]);

  // Load the platform tenant directory for platform admins (used by the
  // tenant switcher, admin portal and manager header).
  const loadTenantsList = useCallback(async () => {
    if (!currentUser) {
      setAvailableRestaurants([]);
      return;
    }
    if (!currentUser.restaurantId) {
      // Platform admin: real list of every tenant on the platform.
      const res = await api.getPlatformOverview(currentUser);
      if (res.success && res.data) {
        setAvailableRestaurants(res.data.restaurants);
      }
    } else {
      // Restaurant staff/manager: only their own tenant.
      if (currentManagerRestaurant) {
        setAvailableRestaurants([currentManagerRestaurant]);
      }
    }
  }, [currentUser, currentManagerRestaurant]);

  useEffect(() => {
    void loadTenantsList();
  }, [loadTenantsList]);

  // Keep the manager workspace synced after login/tenant-switch.
  useEffect(() => {
    if (!currentUser) return;
    if (viewMode === 'CUSTOMER' && currentTableSession) return; // keep QR session
    if (currentManagerRestaurant) {
      setCurrentRestaurant((prev) =>
        prev?.id === currentManagerRestaurant.id ? prev : currentManagerRestaurant
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentManagerRestaurant?.id]);

  // Fast 1.5-second background polling with in-flight lock (no duplicate concurrent requests)
  useEffect(() => {
    if (!currentRestaurant?.id) return;
    
    // Initial fetch on tenant load/switch
    void refreshTenantData();

    const interval = window.setInterval(() => {
      void refreshTenantData();
    }, 1500);

    return () => window.clearInterval(interval);
  }, [currentRestaurant?.id, refreshTenantData]);

  // -------------------------------------------------------------------------
  // URL / QR handling: customer opens /r/:slug?qr=<real-table-qr> which
  // creates an anonymous, expiring, table-scoped session on the server.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined' || urlHandledRef.done) return;

    const params = new URLSearchParams(window.location.search);
    const pathMatch = window.location.pathname.match(/\/r\/([a-zA-Z0-9_-]+)/);
    let rawSlug = (pathMatch?.[1] || params.get('r') || params.get('restaurant') || params.get('slug') || '').toLowerCase();
    if (rawSlug === 'marer' || rawSlug === 'merar') {
      rawSlug = 'mureeh';
    }
    const slug = rawSlug || 'mureeh';
    const qrToken = params.get('qr') || params.get('table') || params.get('t') || params.get('tableId') || '';

    if (slug) {
      urlHandledRef.done = true;
      const targetToken = qrToken || 'default';

      api.createTableSession(targetToken).then((sessionRes) => {
        if (sessionRes.success && sessionRes.data) {
          setCurrentRestaurant(sessionRes.data.restaurant);
          setActiveTableId(sessionRes.data.table.id);
          setCurrentTableSession(sessionRes.data.session);
          setViewMode('CUSTOMER');

          api.getPublicRestaurantBySlug(slug, sessionRes.data.table.qrToken || targetToken).then((catalogRes) => {
            if (catalogRes.success && catalogRes.data) {
              setCategories(catalogRes.data.categories);
              setProducts(catalogRes.data.products);
              setOffers(catalogRes.data.offers);
              setCurrentRestaurant(catalogRes.data.restaurant);
              setSelectedCategoryId(catalogRes.data.categories[0]?.id || '');
            }
          });
        } else {
          // If session by token failed, load public menu directly by slug
          api.getPublicRestaurantBySlug(slug).then((catalogRes) => {
            if (catalogRes.success && catalogRes.data) {
              setCategories(catalogRes.data.categories);
              setProducts(catalogRes.data.products);
              setOffers(catalogRes.data.offers);
              setCurrentRestaurant(catalogRes.data.restaurant);
              setSelectedCategoryId(catalogRes.data.categories[0]?.id || '');
              setViewMode('CUSTOMER');
            } else {
              showToast('error', 'تعذر تحميل قائمة المطعم', catalogRes.error || 'رمز QR غير صالح');
              setViewMode('SAAS_LANDING');
            }
          });
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the active QR token in the public URL without exposing table numbers.
  useEffect(() => {
    if (typeof window === 'undefined' || !currentRestaurant || viewMode !== 'CUSTOMER') return;
    if (activeTableId && currentTableSession) {
      const table = tables.find((t) => t.id === activeTableId);
      const qrToken = table?.qrToken;
      if (!qrToken) return;
      const newUrl = `/r/${currentRestaurant.slug}?qr=${encodeURIComponent(qrToken)}`;
      if (window.location.pathname + window.location.search !== newUrl) {
        window.history.replaceState({ tableId: activeTableId, slug: currentRestaurant.slug }, '', newUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRestaurant?.slug, activeTableId, viewMode]);

  // SSE real-time listener for customers with an active table session.
  useEffect(() => {
    if (!currentRestaurant || typeof window === 'undefined') return;
    if (viewMode !== 'CUSTOMER' || !activeTableId || !currentTableSession?.sessionToken) return;

    let eventSource: EventSource | null = null;
    try {
      const authToken = typeof window !== 'undefined' ? localStorage.getItem('merar_auth_token') || '' : '';
      eventSource = new EventSource(
        `/api/public/events?restaurantId=${currentRestaurant.id}&tableId=${activeTableId}&sessionToken=${encodeURIComponent(currentTableSession.sessionToken)}&token=${encodeURIComponent(authToken)}`
      );
      eventSource.addEventListener('ORDER_STATUS_UPDATED', (e: any) => {
        refreshTenantData();
        try {
          const data = JSON.parse(e.data);
          if (data.status === 'READY') soundFX.playBell();
          else soundFX.playTap();
        } catch {
          /* noop */
        }
      });
      eventSource.addEventListener('ORDER_CREATED', () => refreshTenantData());
      eventSource.addEventListener('ORDER_CANCELLED', () => refreshTenantData());
      eventSource.addEventListener('TABLE_SETTLED', () => refreshTenantData());
    } catch {
      /* polling fallback */
    }
    return () => {
      if (eventSource) eventSource.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRestaurant?.id, activeTableId, currentTableSession?.sessionToken, viewMode]);

  // Entitlement checker — 100% full feature access enabled for manager presentation & marketing
  const checkEntitlement = useCallback(
    (key: EntitlementKey): boolean => {
      if (!currentRestaurant) return false;
      return true; // All features unlocked for stakeholder demonstration
    },
    [currentRestaurant]
  );

  const hasEntitlement = checkEntitlement;

  // Switch the active tenant by slug (from the real platform directory).
  const switchTenantBySlug = useCallback(
    (slug: string) => {
      const target = availableRestaurants.find((r) => r.slug.toLowerCase() === slug.toLowerCase());
      if (!target) return;
      setCurrentRestaurant(target);
      setCartItems([]);
      setSelectedCategoryId('');
      setCurrentTableSession(null);
      setActiveTableId(null);
      showToast('info', 'تم التبديل إلى مطعم', target.name);
    },
    [availableRestaurants, showToast]
  );

  const setCurrentTenantBySlug = switchTenantBySlug;

  const logout = useCallback(() => {
    authLogout();
    setCartItems([]);
    setActiveTableId(null);
    setCurrentTableSession(null);
    setViewMode('SAAS_LANDING');
    showToast('info', 'تم تسجيل الخروج');
  }, [authLogout, showToast]);

  // Set table by number — only possible through a real QR token (from the
  // tenant's own table registry; used by managers previewing their venue).
  const setTableByNumber = useCallback(
    (num: number): { success: boolean; tableId?: string; error?: string } => {
      if (isNaN(num) || num < 1) {
        return { success: false, error: 'رقم الطاولة غير صالح' };
      }
      const table = tables.find((item) => item.tableNumber === num);
      if (!table?.qrToken) {
        return {
          success: false,
          error: 'لا يمكن تفعيل الطاولة إلا عبر رمز QR المطبوع عليها',
        };
      }
      setActiveTableId(table.id);
      api.createTableSession(table.qrToken).then((res) => {
        if (res.success && res.data) {
          setCurrentTableSession(res.data.session);
        } else {
          showToast('error', 'تعذر تفعيل الجلسة', res.error);
        }
      });
      showToast('success', `تم تفعيل الطاولة ${num}`, `مرحباً بك في ${currentRestaurant?.name || 'المطعم'}. يمكنك الآن الطلب مباشرة.`);
      soundFX.playChime();
      return { success: true, tableId: table.id };
    },
    [tables, currentRestaurant, showToast]
  );

  const validateAndSetTable = setTableByNumber;

  // Cart Calculations
  const cartSubtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + (item.totalPrice || item.itemTotal || 0), 0),
    [cartItems]
  );
  const cartTotalCount = useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems]);

  const addToCart = useCallback(
    (product: Product, quantity: number, options: CartItemOption) => {
      if (!product.isAvailable) {
        showToast('error', 'الصنف غير متوفر', 'هذا الطبق غير متاح حالياً للطلب.');
        return;
      }
      const sizeMod =
        (typeof options.size === 'object' ? options.size.priceModifier || options.size.price : 0) || 0;
      const addOnsTotal = (options.selectedAddOns || []).reduce(
        (sum: number, a: any) => sum + (typeof a === 'object' ? a.price : 0),
        0
      );
      const unitPrice = product.price + sizeMod + addOnsTotal;
      const totalPrice = unitPrice * quantity;

      const cartItemId = `cart-item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const newItem: CartItem = {
        id: cartItemId,
        productId: product.id,
        productName: product.name,
        productNameEn: product.nameEn,
        productImage: product.image,
        product,
        quantity,
        options,
        unitPrice,
        totalPrice,
        itemTotal: totalPrice,
      };
      setCartItems((prev) => [...prev, newItem]);
      soundFX.playTap();
      showToast('success', `تمت الإضافة للسلة`, `${product.name} (${quantity}×)`);
    },
    [showToast]
  );

  const updateCartItemQuantity = useCallback(
    (cartItemId: string, quantity: number) => {
      if (quantity <= 0) {
        setCartItems((prev) => prev.filter((item) => item.id !== cartItemId));
        showToast('info', 'تم حذف الصنف من السلة');
        return;
      }
      setCartItems((prev) =>
        prev.map((item) => {
          if (item.id === cartItemId) {
            const uPrice = item.unitPrice || item.product?.price || 0;
            return { ...item, quantity, totalPrice: uPrice * quantity, itemTotal: uPrice * quantity };
          }
          return item;
        })
      );
    },
    [showToast]
  );

  const removeFromCart = useCallback(
    (cartItemId: string) => {
      setCartItems((prev) => prev.filter((item) => item.id !== cartItemId));
      soundFX.playTap();
      showToast('info', 'تمت إزالة الصنف من السلة');
    },
    [showToast]
  );

  const clearCart = useCallback(() => setCartItems([]), []);

  // The customer only ever sees orders that belong to their own session —
  // never orders from another table or another customer at the same table.
  const activeTableOrders = useMemo(() => {
    if (!activeTableId || !currentTableSession?.id) return [];
    return orders.filter(
      (o) =>
        o.tableId === activeTableId &&
        o.sessionId === currentTableSession.id &&
        o.status !== 'CANCELLED'
    );
  }, [orders, activeTableId, currentTableSession]);

  // Create order: POST to the public API bound to the QR session; the server
  // re-prices every item from the tenant's DB menu.
  const createOrder = useCallback(
    async (notes?: string): Promise<{ success: boolean; order?: Order; error?: string }> => {
      if (!currentRestaurant) return { success: false, error: 'المطعم غير محدد' };
      if (!activeTableId || !currentTableSession?.sessionToken) {
        setIsTableSelectorOpen(true);
        return { success: false, error: 'لإتمام الطلب يجب مسح رمز QR الموجود على طاولتك' };
      }
      if (cartItems.length === 0) {
        showToast('warning', 'السلة فارغة');
        return { success: false, error: 'السلة فارغة' };
      }

      const orderItems: OrderItem[] = cartItems.map((c) => ({
        id: '',
        productId: c.productId || c.product?.id || '',
        productName: c.product?.name || c.productName || '',
        productNameEn: c.product?.nameEn || c.productNameEn || undefined,
        productImage: c.product?.image || c.productImage || undefined,
        quantity: c.quantity,
        unitPrice: c.unitPrice || c.product?.price || 0,
        totalPrice: c.totalPrice || c.itemTotal || 0,
        selectedSize: typeof c.options.size === 'object' ? c.options.size.name : c.options.size,
        selectedAddOns: (c.options.selectedAddOns || []).map((a: any) =>
          typeof a === 'object' ? `${a.name} (+${currentRestaurant.currency}${a.price})` : String(a)
        ),
        removedIngredients: c.options.removedIngredients,
        specialInstructions: c.options.specialInstructions || c.options.notes,
      }));

      const res = await api.submitOrder({
        restaurantId: currentRestaurant.id,
        tableId: activeTableId,
        sessionToken: currentTableSession.sessionToken,
        items: orderItems,
        notes,
      });

      if (res.success && res.data) {
        clearCart();
        refreshTenantData();
        soundFX.playChime();
        setIsCartOpen(false);
        setIsOrderTrackingOpen(true);
        return { success: true, order: res.data.order };
      }

      showToast('error', 'تعذر إرسال الطلب', res.error || 'حدث خطأ في الخادم');
      return { success: false, error: res.error || 'تعذر إرسال الطلب' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, activeTableId, currentTableSession, cartItems, cartSubtotal, clearCart, refreshTenantData, showToast]
  );

  const updateOrderStatus = useCallback(
    (orderId: string, nextStatus: OrderStatus): boolean => {
      if (!currentRestaurant || !currentUser) return false;
      const order = orders.find((o) => o.id === orderId);
      if (!order) return false;
      if (order.status === 'SERVED' && nextStatus !== 'SERVED') return false;

      void api.updateOrderStatus(currentUser, currentRestaurant.id, orderId, nextStatus).then((res) => {
        if (res.success) {
          refreshTenantData();
        } else {
          showToast('error', 'تعذر تحديث الحالة', res.error);
        }
      });
      soundFX.playTap();
      if (nextStatus === 'READY') soundFX.playBell();
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentUser, orders, refreshTenantData, showToast]
  );

  const cancelCustomerOrder = useCallback(
    async (orderId: string): Promise<{ success: boolean; message: string }> => {
      if (!currentRestaurant) return { success: false, message: 'المطعم غير محدد' };
      const res = await api.cancelOrder(currentRestaurant.id, orderId, currentTableSession?.sessionToken);
      if (res.success) {
        refreshTenantData();
        showToast('info', 'تم إلغاء الطلب', `تم إلغاء الطلب ${orderId} بنجاح.`);
        return { success: true, message: 'تم إلغاء الطلب بنجاح.' };
      }
      showToast('error', 'تعذر إلغاء الطلب', res.error);
      return { success: false, message: res.error || 'تعذر إلغاء الطلب' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentTableSession, refreshTenantData, showToast]
  );

  const editCustomerOrderNotes = useCallback(
    async (orderId: string, notes: string): Promise<{ success: boolean; message: string }> => {
      if (!currentRestaurant) return { success: false, message: 'المطعم غير محدد' };
      const res = await api.updateOrderNotes(currentRestaurant.id, orderId, notes, currentTableSession?.sessionToken);
      if (res.success) {
        refreshTenantData();
        showToast('success', 'تم حفظ التعديلات');
        return { success: true, message: 'تم تحديث الملاحظات بنجاح.' };
      }
      showToast('error', 'تعذر تعديل الطلب', res.error);
      return { success: false, message: res.error || 'تعذر تعديل الطلب' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentTableSession, refreshTenantData, showToast]
  );

  const updateTableStatus = useCallback(
    (tableId: string, status: RestaurantTable['status']) => {
      if (!currentRestaurant || !currentUser) return;
      const table = tables.find((t) => t.id === tableId);
      if (!table) return;
      void api.updateTable(currentRestaurant.id, { ...table, status }).then((res) => {
        if (res.success) refreshTenantData();
        else showToast('error', 'تعذر تحديث الطاولة', res.error);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentUser, tables, refreshTenantData, showToast]
  );

  const settleTableAndFree = useCallback(
    (tableId: string) => {
      if (!currentRestaurant || !currentUser) return;
      void api.settleTableBill(currentUser, currentRestaurant.id, tableId).then((res) => {
        if (res.success) {
          refreshTenantData();
          soundFX.playChime();
          showToast('success', `تمت تصفية ${tableId}`, 'تم دفع الحساب وإعادة الطاولة إلى حالة المتاحة.');
        } else {
          showToast('error', 'تعذر تصفية الطاولة', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentUser, refreshTenantData, showToast]
  );

  const callWaiter = useCallback(
    (reasonOrTableId: WaiterRequest['reason'] | string, maybeReason?: WaiterRequest['reason'] | string, customText?: string) => {
      if (!currentRestaurant) return;
      let targetTableId = activeTableId;
      let targetReason: WaiterRequest['reason'] = 'ASSISTANCE';
      let targetText = customText;

      if (typeof reasonOrTableId === 'string' && reasonOrTableId.startsWith('TABLE-')) {
        targetTableId = reasonOrTableId;
        if (maybeReason) targetReason = maybeReason as WaiterRequest['reason'];
      } else {
        targetReason = (reasonOrTableId as WaiterRequest['reason']) || 'ASSISTANCE';
        if (typeof maybeReason === 'string') targetText = maybeReason;
      }

      if (!targetTableId) return;

      api
        .callWaiter(
          currentRestaurant.id,
          targetTableId,
          targetReason,
          targetText,
          currentTableSession?.sessionToken
        )
        .then((res) => {
          if (res.success) {
            refreshTenantData();
            soundFX.playBell();
            showToast('success', 'تم استدعاء طاقم الضيافة', `طاقم ${currentRestaurant.name} في طريقه إلى الطاولة لخدمتك.`);
          } else {
            showToast('error', 'تعذر إرسال النداء', res.error);
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, activeTableId, currentTableSession, refreshTenantData, showToast]
  );

  const resolveWaiterRequest = useCallback(
    (requestId: string) => {
      if (!currentRestaurant || !currentUser) return;
      void api
        .updateWaiterRequestStatus(currentUser, currentRestaurant.id, requestId, 'RESOLVED')
        .then((res) => {
          if (res.success) {
            refreshTenantData();
            showToast('info', 'تم إنجاز طلب النادل');
          } else {
            showToast('error', 'تعذر تحديث النداء', res.error);
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentUser, refreshTenantData, showToast]
  );

  const acknowledgeWaiterRequest = useCallback(
    (requestId: string) => {
      if (!currentRestaurant || !currentUser) return;
      void api
        .updateWaiterRequestStatus(currentUser, currentRestaurant.id, requestId, 'ACKNOWLEDGED')
        .then((res) => {
          if (res.success) {
            refreshTenantData();
            showToast('info', 'تم استلام النداء وجاري التوجه للطاولة');
          } else {
            showToast('error', 'تعذر تحديث النداء', res.error);
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentUser, refreshTenantData, showToast]
  );

  const toggleProductStock = useCallback(
    (productId: string) => {
      if (!currentRestaurant) return;
      void api.toggleProductStock(currentRestaurant.id, productId).then((res) => {
        if (res.success) {
          refreshTenantData();
          const p = products.find((item) => item.id === productId);
          const nowAvailable = res.data?.product.isAvailable;
          showToast(
            nowAvailable === false ? 'warning' : 'success',
            nowAvailable === false ? 'تم تحويل الطبق إلى غير متوفر (نفد المخزون)' : 'الطبق متوفر الآن',
            p?.name
          );
        } else {
          showToast('error', 'تعذر تحديث حالة المخزون', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, products, refreshTenantData, showToast]
  );

  const toggleProductAvailability = toggleProductStock;

  const addProduct = useCallback(
    (product: Omit<Product, 'id' | 'restaurantId'>) => {
      if (!currentRestaurant || !currentUser) return;
      const tempId = `prod-${Date.now()}`;
      const newProduct: Product = {
        ...product,
        id: tempId,
        restaurantId: currentRestaurant.id,
      };
      void api.saveProduct(currentUser, currentRestaurant.id, newProduct).then((res) => {
        if (res.success) {
          refreshTenantData();
          showToast('success', 'تمت إضافة طبق جديد للقائمة', newProduct.name);
        } else {
          showToast('error', 'تعذر إضافة الطبق', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentUser, refreshTenantData, showToast]
  );

  const updateProduct = useCallback(
    (product: Product) => {
      if (!currentRestaurant || !currentUser) return;
      const updatedProd: Product = { ...product, restaurantId: currentRestaurant.id };
      void api.saveProduct(currentUser, currentRestaurant.id, updatedProd).then((res) => {
        if (res.success) {
          refreshTenantData();
          showToast('success', 'تم تعديل بيانات الطبق', product.name);
        } else {
          showToast('error', 'تعذر تعديل الطبق', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentUser, refreshTenantData, showToast]
  );

  const deleteProduct = useCallback(
    (productId: string) => {
      if (!currentRestaurant || !currentUser) return;
      void api.deleteManagerProduct(currentUser, currentRestaurant.id, productId).then((res) => {
        if (res.success) {
          refreshTenantData();
          showToast('info', 'تم حذف الطبق من القائمة');
        } else {
          showToast('error', 'تعذر حذف الطبق', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentUser, refreshTenantData, showToast]
  );

  const addCategory = useCallback(
    (name: string, nameEn?: string) => {
      if (!currentRestaurant || !currentUser) return;
      const newCat: Category = {
        id: `cat-${Date.now()}`,
        restaurantId: currentRestaurant.id,
        name,
        nameEn,
        sortOrder: categories.length + 1,
      };
      void api.saveCategory(currentUser, currentRestaurant.id, newCat).then((res) => {
        if (res.success) {
          refreshTenantData();
          showToast('success', 'تمت إضافة تصنيف جديد', name);
        } else {
          showToast('error', 'تعذر إضافة التصنيف', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentUser, categories, refreshTenantData, showToast]
  );

  const updateCategory = useCallback(
    (category: Category) => {
      if (!currentRestaurant) return;
      const updatedCat = { ...category, restaurantId: currentRestaurant.id };
      void api.updateCategory(currentRestaurant.id, updatedCat).then((res) => {
        if (res.success) {
          refreshTenantData();
          showToast('success', 'تم تعديل التصنيف', category.name);
        } else {
          showToast('error', 'تعذر تعديل التصنيف', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, refreshTenantData, showToast]
  );

  const deleteCategory = useCallback(
    (categoryId: string) => {
      if (!currentRestaurant) return;
      void api.deleteCategory(currentRestaurant.id, categoryId).then((res) => {
        if (res.success) {
          refreshTenantData();
          showToast('info', 'تم حذف التصنيف');
        } else {
          showToast('error', 'تعذر حذف التصنيف', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, refreshTenantData, showToast]
  );

  const addOffer = useCallback(
    (offer: Omit<Offer, 'id' | 'restaurantId'>) => {
      if (!currentRestaurant) return;
      void api.saveOffer(currentRestaurant.id, offer).then((res) => {
        if (res.success) {
          refreshTenantData();
          showToast('success', 'تم نشر العرض الترويجي', offer.title);
        } else {
          showToast('error', 'تعذر نشر العرض', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, refreshTenantData, showToast]
  );

  const deleteOffer = useCallback(
    (offerId: string) => {
      if (!currentRestaurant) return;
      void api.deleteOffer(currentRestaurant.id, offerId).then((res) => {
        if (res.success) {
          refreshTenantData();
          showToast('info', 'تم حذف العرض الترويجي');
        } else {
          showToast('error', 'تعذر حذف العرض', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, refreshTenantData, showToast]
  );

  return (
    <RestaurantContext.Provider
      value={{
        currentRestaurant,
        setCurrentRestaurant,
        availableRestaurants,
        tenantsList: availableRestaurants,
        currentUser,
        setCurrentUser: authSetCurrentUser,
        checkEntitlement,
        hasEntitlement,
        viewMode,
        setViewMode,
        selectedCategoryId,
        setSelectedCategoryId,
        searchQuery,
        setSearchQuery,
        isOnboardingOpen,
        setIsOnboardingOpen,
        soundEnabled,
        toggleSound,
        refreshTenantData,
        activeTableId,
        setActiveTableId,
        currentTableSession,
        setTableByNumber,
        validateAndSetTable,
        categories,
        products,
        offers,
        tables,
        orders,
        waiterRequests,
        payments,
        branches,
        cartItems,
        addToCart,
        updateCartItemQuantity,
        removeFromCart,
        clearCart,
        cartSubtotal,
        cartTotalCount,
        isCartOpen,
        setIsCartOpen,
        isOrderTrackingOpen,
        setIsOrderTrackingOpen,
        isWaiterModalOpen,
        setIsWaiterModalOpen,
        isTableSelectorOpen,
        setIsTableSelectorOpen,
        createOrder,
        cancelCustomerOrder,
        editCustomerOrderNotes,
        callWaiter,
        activeTableOrders,
        updateOrderStatus,
        updateTableStatus,
        settleTableAndFree,
        resolveWaiterRequest,
        acknowledgeWaiterRequest,
        toggleProductStock,
        toggleProductAvailability,
        addProduct,
        updateProduct,
        deleteProduct,
        addCategory,
        updateCategory,
        deleteCategory,
        addOffer,
        deleteOffer,
        switchTenantBySlug,
        setCurrentTenantBySlug,
        logout,
        toasts,
        showToast,
        dismissToast,
        removeToast,
      }}
    >
      {children}
    </RestaurantContext.Provider>
  );
};

export const useRestaurant = (): RestaurantContextType => {
  const context = useContext(RestaurantContext);
  if (!context) {
    throw new Error('useRestaurant must be used within a RestaurantProvider');
  }
  return context;
};
