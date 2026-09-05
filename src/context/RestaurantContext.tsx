import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
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
} from '../types/restaurant';
import { db } from '../services/db';
import { api } from '../services/api';
import { soundFX } from '../utils/audio';

export type AppViewMode = 'CUSTOMER' | 'MANAGER' | 'ADMIN' | 'ONBOARDING' | 'PLATFORM_ADMIN' | 'SPLIT_PREVIEW' | 'KITCHEN_KDS' | 'SAAS_LANDING';

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

  // Sound & Auto-Kitchen
  soundEnabled: boolean;
  toggleSound: () => void;
  isAutoKitchenEnabled: boolean;
  toggleAutoKitchen: () => void;
  resetAllDemoData: () => void;

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
  createOrder: (notes?: string) => { success: boolean; order?: Order; error?: string };
  cancelCustomerOrder: (orderId: string) => { success: boolean; message: string };
  editCustomerOrderNotes: (orderId: string, notes: string) => { success: boolean; message: string };
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
  loginAsUser: (email: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshTenantData: () => void;

  // Toast System
  toasts: ToastMessage[];
  showToast: (type: ToastMessage['type'], title: string, message?: string) => void;
  dismissToast: (id: string) => void;
  removeToast: (id: string) => void;
}

const RestaurantContext = createContext<RestaurantContextType | undefined>(undefined);

export const RestaurantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Initialize Current Restaurant dynamically from URL
  const [currentRestaurant, setCurrentRestaurant] = useState<Restaurant | null>(() => {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      const search = window.location.search;
      const params = new URLSearchParams(search);
      const pathMatch = pathname.match(/\/r\/([a-zA-Z0-9_-]+)/);
      const slug = pathMatch ? pathMatch[1] : (params.get('r') || params.get('restaurant') || params.get('slug'));
      if (slug) {
        const found = db.getRestaurantBySlug(slug.toLowerCase());
        if (found) return found;
      }
    }
    return db.getRestaurantById('rest-merar') || db.getRestaurants()[0] || null;
  });

  const [currentUser, setCurrentUser] = useState<RestaurantUser | null>(() => {
    return db.getUserByEmail('manager@merar-dining.com') || null;
  });

  const [viewMode, setViewMode] = useState<AppViewMode>(() => {
    if (typeof window !== 'undefined') {
      const isPublicRestaurantLink = window.location.pathname.startsWith('/r/') || new URLSearchParams(window.location.search).has('qr');
      return isPublicRestaurantLink ? 'CUSTOMER' : 'SAAS_LANDING';
    }
    return 'SAAS_LANDING';
  });
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('cat-signatures');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 2. Initialize Active Table ID from the QR token only.
  const [activeTableId, setActiveTableId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const search = window.location.search;
      const params = new URLSearchParams(search);
      const qrToken = params.get('qr');
      if (qrToken) {
        const pathMatch = window.location.pathname.match(/\/r\/([a-zA-Z0-9_-]+)/);
        const restaurant = db.getRestaurantBySlug(pathMatch?.[1] || '');
        const table = restaurant && db.getTables(restaurant.id).find((item) => item.qrToken === qrToken);
        if (table) return table.id;
      }
    }
    return null; // No hardcoded 12! Starts as null if not specified in URL
  });

  const [currentTableSession, setCurrentTableSession] = useState<TableSession | null>(null);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  // Sound & Auto Kitchen
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isAutoKitchenEnabled, setIsAutoKitchenEnabled] = useState(false);

  // Cart & Drawers
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isOrderTrackingOpen, setIsOrderTrackingOpen] = useState(false);
  const [isWaiterModalOpen, setIsWaiterModalOpen] = useState(false);
  const [isTableSelectorOpen, setIsTableSelectorOpen] = useState(false);

  // Dynamic Tenant Data Collections
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [waiterRequests, setWaiterRequests] = useState<WaiterRequest[]>([]);
  const [availableRestaurants, setAvailableRestaurants] = useState<Restaurant[]>([]);

  // Toast state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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

  const toggleAutoKitchen = useCallback(() => {
    setIsAutoKitchenEnabled((prev) => !prev);
    showToast('info', 'المطبخ الآلي التفاعلي', 'تم تغيير إعداد المحاكاة التلقائية للطلبات');
  }, [showToast]);

  const resetAllDemoData = useCallback(() => {
    db.resetToSeed();
    const defaultRest = db.getRestaurantById('rest-merar') || db.getRestaurants()[0];
    setCurrentRestaurant(defaultRest);
    setCartItems([]);
    refreshTenantData();
    showToast('info', 'تمت استعادة البيانات التجريبية للمنصة بالكامل');
  }, [showToast]);

  // Fetch / Sync Tenant Isolated Data
  const refreshTenantData = useCallback(() => {
    setAvailableRestaurants(db.getRestaurants());
    if (!currentRestaurant) return;

    const tenantId = currentRestaurant.id;
    const currentCats = db.getCategories(tenantId);
    const currentProds = db.getProducts(tenantId);
    const currentOffs = db.getOffers(tenantId);
    const currentTabs = db.getTables(tenantId);
    const currentOrds = db.getOrders(tenantId);
    const currentWaits = db.getWaiterRequests(tenantId);

    setCategories(currentCats);
    setProducts(currentProds);
    setOffers(currentOffs);
    setTables(currentTabs);
    setOrders(currentOrds);
    setWaiterRequests(currentWaits);

    if (typeof window !== 'undefined' && localStorage.getItem('merar_auth_token')) {
      api.getManagerMenu(tenantId).then((menuRes) => {
        if (!menuRes.success || !menuRes.data) return;
        setCategories(menuRes.data.categories);
        setProducts(menuRes.data.products);
      });
      api.getManagerTables(tenantId).then((tablesRes) => {
        if (tablesRes.success && tablesRes.data) setTables(tablesRes.data);
      });
    }

    if (currentCats.length > 0 && !currentCats.some((c) => c.id === selectedCategoryId)) {
      setSelectedCategoryId(currentCats[0].id);
    }
  }, [currentRestaurant, selectedCategoryId]);

  // Advanced Multi-Tenant & Table QR URL Detection
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const parseUrlAndSetContext = () => {
      const pathname = window.location.pathname;
      const search = window.location.search;
      const hash = window.location.hash;
      const params = new URLSearchParams(search);
      const hashParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');

      // 1. Detect Tenant Slug from Path (/r/:slug) or Query (?r=slug or ?restaurant=slug)
      let detectedSlug: string | null = null;
      const pathMatch = pathname.match(/\/r\/([a-zA-Z0-9_-]+)/);
      if (pathMatch && pathMatch[1]) {
        detectedSlug = pathMatch[1].toLowerCase();
      } else {
        detectedSlug = params.get('r') || params.get('restaurant') || params.get('slug') || hashParams.get('r');
      }

      if (detectedSlug) {
        const matched = db.getRestaurantBySlug(detectedSlug);
        if (matched) {
          setCurrentRestaurant(matched);
        }
      }

      // Public restaurant and QR links always open in the customer experience.
      if (detectedSlug || params.has('qr') || hashParams.has('qr')) {
        setViewMode('CUSTOMER');
      }

      const qrToken = params.get('qr') || hashParams.get('qr');
      if (qrToken) {
        api.createTableSession(qrToken).then((res) => {
          if (res.success && res.data) {
            setCurrentRestaurant(res.data.restaurant);
            setActiveTableId(res.data.table.id);
            setCurrentTableSession(res.data.session);

            api.getPublicRestaurantBySlug(res.data.restaurant.slug, qrToken).then((catalogRes) => {
              if (!catalogRes.success || !catalogRes.data) return;
              setCategories(catalogRes.data.categories);
              setProducts(catalogRes.data.products);
              setOffers(catalogRes.data.offers);
              setCurrentRestaurant(catalogRes.data.restaurant);
              setSelectedCategoryId((currentId) =>
                catalogRes.data!.categories.some((category) => category.id === currentId)
                  ? currentId
                  : catalogRes.data!.categories[0]?.id || ''
              );
            });
          }
        });
      }
    };

    parseUrlAndSetContext();
    window.addEventListener('popstate', parseUrlAndSetContext);
    return () => window.removeEventListener('popstate', parseUrlAndSetContext);
  }, []);

  // Automatically refresh tenant isolated catalog data on tenant switch
  useEffect(() => {
    if (currentRestaurant?.id) {
      refreshTenantData();
    }
  }, [currentRestaurant?.id, refreshTenantData]);

  // Keep the active QR token in the public URL without exposing table numbers.
  useEffect(() => {
    if (typeof window === 'undefined' || !currentRestaurant) return;
    if (viewMode === 'CUSTOMER' && activeTableId && currentTableSession?.sessionToken) {
      const table = db.getTableById(currentRestaurant.id, activeTableId);
      const qrToken = table?.qrToken;
      if (!qrToken) return;
      const newUrl = `/r/${currentRestaurant.slug}?qr=${encodeURIComponent(qrToken)}`;
      if (window.location.pathname + window.location.search !== newUrl) {
        window.history.replaceState({ tableId: activeTableId, slug: currentRestaurant.slug }, '', newUrl);
      }
    }
  }, [currentRestaurant?.slug, activeTableId, viewMode]);

  // SSE Real-time Updates Listener for Live Order Status & Waiter Calls
  useEffect(() => {
    if (!currentRestaurant || typeof window === 'undefined') return;

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`/api/public/events?restaurantId=${currentRestaurant.id}&tableId=${activeTableId || ''}&sessionToken=${encodeURIComponent(currentTableSession?.sessionToken || '')}`);

      eventSource.addEventListener('ORDER_CREATED', () => {
        refreshTenantData();
      });

      eventSource.addEventListener('ORDER_STATUS_UPDATED', (e: any) => {
        refreshTenantData();
        try {
          const data = JSON.parse(e.data);
          if (data.status === 'READY') soundFX.playBell();
          else soundFX.playTap();
        } catch {}
      });

      eventSource.addEventListener('WAITER_CALL', () => {
        refreshTenantData();
        soundFX.playBell();
      });

      eventSource.addEventListener('TABLE_SETTLED', () => {
        refreshTenantData();
      });
    } catch (e) {
      // SSE fallback
    }

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [currentRestaurant?.id, activeTableId, currentTableSession?.sessionToken, refreshTenantData]);

  // Entitlement Checker
  const checkEntitlement = useCallback(
    (key: EntitlementKey): boolean => {
      if (!currentRestaurant) return false;
      const sub = db.getSubscriptionByRestaurantId(currentRestaurant.id);
      if (!sub || sub.status === 'SUSPENDED' || sub.status === 'CANCELLED') return false;
      const plan = db.getPlanById(sub.planId);
      if (!plan) return false;
      return plan.entitlements.includes(key);
    },
    [currentRestaurant]
  );

  const hasEntitlement = checkEntitlement;

  // Switch Active Tenant by Slug
  const switchTenantBySlug = useCallback((slug: string) => {
    const target = db.getRestaurantBySlug(slug);
    if (target) {
      setCurrentRestaurant(target);
      setCartItems([]);
      setSelectedCategoryId('');
      showToast('info', 'تم التبديل إلى مطعم', target.name);
    }
  }, [showToast]);

  const setCurrentTenantBySlug = switchTenantBySlug;

  // Login as User
  const loginAsUser = useCallback(async (email: string) => {
    const res = await api.login(email);
    if (res.success && res.data) {
      setCurrentUser(res.data.user);
      if (res.data.restaurant) {
        setCurrentRestaurant(res.data.restaurant);
      }
      showToast('success', 'تم تسجيل الدخول بنجاح', `مرحباً بك ${res.data.user.name}`);
      return { success: true };
    }
    showToast('error', 'فشل تسجيل الدخول', res.error || 'البيانات غير صحيحة');
    return { success: false, error: res.error };
  }, [showToast]);

  const logout = useCallback(() => {
    setCurrentUser(null);
    setViewMode('CUSTOMER');
    showToast('info', 'تم تسجيل الخروج');
  }, [showToast]);

  // Set Table By Number with boundary protection
  const setTableByNumber = useCallback((num: number) => {
    if (isNaN(num) || num < 1 || num > 50) {
      return { success: false, error: 'رقم الطاولة يجب أن يكون بين 1 و 50' };
    }

    const table = currentRestaurant && db.getTables(currentRestaurant.id).find((item) => item.tableNumber === num);
    if (!table?.qrToken) {
      return { success: false, error: 'لا يمكن تفعيل الطاولة إلا عبر رمز QR صالح' };
    }
    const tableId = table.id;
    setActiveTableId(tableId);

    // Even internal table selection must resolve through the table QR token.
    if (currentRestaurant) {
      api.createTableSession(table.qrToken).then((res) => {
        if (res.success && res.data) {
          setCurrentTableSession(res.data.session);
        }
      });
    }

    showToast('success', `تم تفعيل الطاولة ${num}`, `مرحباً بك في ${currentRestaurant?.name || 'المطعم'}. يمكنك الآن الطلب مباشرة.`);
    soundFX.playChime();
    return { success: true, tableId };
  }, [currentRestaurant, showToast]);

  const validateAndSetTable = setTableByNumber;

  // Cart Calculations
  const cartSubtotal = useMemo(() => cartItems.reduce((sum, item) => sum + (item.totalPrice || item.itemTotal || 0), 0), [cartItems]);
  const cartTotalCount = useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems]);

  const addToCart = useCallback((product: Product, quantity: number, options: CartItemOption) => {
    if (!product.isAvailable) {
      showToast('error', 'الصنف غير متوفر', 'هذا الطبق غير متاح حالياً للطلب.');
      return;
    }

    const sizeMod = (typeof options.size === 'object' ? (options.size.priceModifier || options.size.price) : 0) || 0;
    const addOnsTotal = (options.selectedAddOns || []).reduce((sum: number, a: any) => sum + (typeof a === 'object' ? a.price : 0), 0);
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
  }, [showToast]);

  const updateCartItemQuantity = useCallback((cartItemId: string, quantity: number) => {
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
  }, [showToast]);

  const removeFromCart = useCallback((cartItemId: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== cartItemId));
    soundFX.playTap();
    showToast('info', 'تمت إزالة الصنف من السلة');
  }, [showToast]);

  const clearCart = useCallback(() => setCartItems([]), []);

  const activeTableOrders = useMemo(() => {
    if (!activeTableId) return [];
    return orders.filter((o) => o.tableId === activeTableId && o.status !== 'CANCELLED');
  }, [orders, activeTableId]);

  // Create Order from Cart
  const createOrder = useCallback((notes?: string): { success: boolean; order?: Order; error?: string } => {
    if (!currentRestaurant) return { success: false, error: 'المطعم غير محدد' };
    if (!activeTableId) {
      showToast('error', 'يرجى تحديد الطاولة أولاً');
      setIsTableSelectorOpen(true);
      return { success: false, error: 'لم يتم تحديد رقم الطاولة' };
    }
    if (cartItems.length === 0) {
      showToast('warning', 'السلة فارغة');
      return { success: false, error: 'السلة فارغة' };
    }

    // Check if table is occupied/locked by another session
    const currentTableObj = db.getTableById(currentRestaurant.id, activeTableId);
    if (currentTableObj && (currentTableObj.status === 'OCCUPIED' || currentTableObj.status === 'RESERVED' || currentTableObj.status === 'BILL_REQUESTED')) {
      const activeSession = db.getActiveSessionByTable(currentRestaurant.id, activeTableId);
      if (activeSession && currentTableSession && activeSession.sessionToken !== currentTableSession.sessionToken) {
        const msg = 'عفواً، هذه الطاولة محجوزة ومشغولة حالياً لعميل آخر. لا يمكن إجراء طلب جديد حتى تسوية الطاولة لدى الكاشير.';
        showToast('error', 'الطاولة محجوزة ومشغولة', msg);
        return { success: false, error: msg };
      }
    }

    const orderItems: OrderItem[] = cartItems.map((c) => ({
      id: `ord-item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      productId: c.productId || c.product?.id || '',
      productName: c.product?.name || c.productName || '',
      productNameEn: c.product?.nameEn || c.productNameEn || '',
      productImage: c.product?.image || c.productImage || '',
      quantity: c.quantity,
      unitPrice: c.unitPrice || c.product?.price || 0,
      totalPrice: c.totalPrice || c.itemTotal || 0,
      selectedSize: typeof c.options.size === 'object' ? c.options.size.name : c.options.size,
      selectedAddOns: (c.options.selectedAddOns || []).map((a: any) => (typeof a === 'object' ? `${a.name} (+₪${a.price})` : String(a))),
      removedIngredients: c.options.removedIngredients,
      specialInstructions: c.options.specialInstructions || c.options.notes,
    }));

    const tId = currentRestaurant.id;
    const allOrders = db.getOrders(tId);
    const nextNum = allOrders.length > 0 ? Math.max(...allOrders.map((o) => o.numericId || 1000)) + 1 : 1001;
    const orderId = `#${nextNum}`;

    const newOrder: Order = {
      id: orderId,
      numericId: nextNum,
      restaurantId: tId,
      tableId: activeTableId,
      sessionId: currentTableSession?.id,
      items: orderItems,
      subtotal: cartSubtotal,
      total: cartSubtotal,
      status: 'PENDING',
      paymentMethod: 'PAY AT CASHIER',
      notes: notes || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      estimatedPrepMinutes: 18,
    };

    db.saveOrder(newOrder);

    // Update table status
    const table = db.getTables(tId).find((t) => t.id === activeTableId);
    if (table) {
      table.status = 'OCCUPIED';
      table.activeOrderIds = [...table.activeOrderIds, orderId];
      table.lastActivityAt = new Date().toISOString();
      db.saveTable(table);
    }

    refreshTenantData();
    clearCart();
    soundFX.playChime();
    showToast('success', `تم إرسال طلبك للمطبخ بنجاح (${orderId})`, 'طلبك ظهر الآن في شاشة المطبخ (KDS) وسيبدأ التحضير.');

    setIsCartOpen(false);
    setIsOrderTrackingOpen(true);

    return { success: true, order: newOrder };
  }, [currentRestaurant, activeTableId, cartItems, cartSubtotal, currentTableSession, clearCart, refreshTenantData, showToast]);

  const updateOrderStatus = useCallback((orderId: string, nextStatus: OrderStatus): boolean => {
    if (!currentRestaurant) return false;
    const orders = db.getOrders(currentRestaurant.id);
    const ord = orders.find((o) => o.id === orderId);
    if (!ord) return false;

    if (ord.status === 'SERVED' && nextStatus !== 'SERVED') return false;

    ord.status = nextStatus;
    ord.updatedAt = new Date().toISOString();
    db.saveOrder(ord);

    refreshTenantData();
    soundFX.playTap();
    if (nextStatus === 'READY') soundFX.playBell();
    return true;
  }, [currentRestaurant, refreshTenantData]);

  const cancelCustomerOrder = useCallback((orderId: string): { success: boolean; message: string } => {
    if (!currentRestaurant) return { success: false, message: 'المطعم غير محدد' };
    const orders = db.getOrders(currentRestaurant.id);
    const ord = orders.find((o) => o.id === orderId);
    if (!ord) return { success: false, message: 'الطلب غير موجود' };

    if (ord.status !== 'PENDING') {
      const msg = 'بدأ المطبخ بتحضير طلبك بالفعل، لذلك لم يعد بالإمكان تعديله أو إلغاؤه.';
      showToast('error', 'تعذر إلغاء الطلب', msg);
      return { success: false, message: msg };
    }

    ord.status = 'CANCELLED';
    ord.updatedAt = new Date().toISOString();
    db.saveOrder(ord);

    const table = db.getTables(currentRestaurant.id).find((t) => t.id === ord.tableId);
    if (table) {
      table.activeOrderIds = table.activeOrderIds.filter((id) => id !== orderId);
      if (table.activeOrderIds.length === 0) table.status = 'AVAILABLE';
      db.saveTable(table);
    }

    refreshTenantData();
    showToast('info', 'تم إلغاء الطلب', `تم إلغاء الطلب ${orderId} بنجاح.`);
    return { success: true, message: 'تم إلغاء الطلب بنجاح.' };
  }, [currentRestaurant, refreshTenantData, showToast]);

  const editCustomerOrderNotes = useCallback((orderId: string, notes: string): { success: boolean; message: string } => {
    if (!currentRestaurant) return { success: false, message: 'المطعم غير محدد' };
    const orders = db.getOrders(currentRestaurant.id);
    const ord = orders.find((o) => o.id === orderId);
    if (!ord) return { success: false, message: 'الطلب غير موجود' };

    if (ord.status !== 'PENDING') {
      const msg = 'بدأ المطبخ بتحضير طلبك، لذلك لم يعد بالإمكان تعديل الملاحظات.';
      showToast('error', 'تعذر تعديل الطلب', msg);
      return { success: false, message: msg };
    }

    ord.notes = notes;
    ord.updatedAt = new Date().toISOString();
    db.saveOrder(ord);

    refreshTenantData();
    showToast('success', 'تم حفظ التعديلات');
    return { success: true, message: 'تم تحديث الملاحظات بنجاح.' };
  }, [currentRestaurant, refreshTenantData, showToast]);

  const updateTableStatus = useCallback((tableId: string, status: RestaurantTable['status']) => {
    if (!currentRestaurant) return;
    const table = db.getTables(currentRestaurant.id).find((t) => t.id === tableId);
    if (table) {
      table.status = status;
      db.saveTable(table);
      refreshTenantData();
    }
  }, [currentRestaurant, refreshTenantData]);

  const settleTableAndFree = useCallback((tableId: string) => {
    if (!currentRestaurant) return;
    const orders = db.getOrders(currentRestaurant.id);
    orders.forEach((o) => {
      if (o.tableId === tableId && o.status !== 'CANCELLED' && o.status !== 'SERVED') {
        o.status = 'SERVED';
        o.updatedAt = new Date().toISOString();
        db.saveOrder(o);
      }
    });

    const table = db.getTables(currentRestaurant.id).find((t) => t.id === tableId);
    if (table) {
      table.status = 'AVAILABLE';
      table.activeOrderIds = [];
      table.hasWaiterCall = false;
      db.saveTable(table);
    }

    db.closeActiveSessionsByTable(currentRestaurant.id, tableId);

    const waiters = db.getWaiterRequests(currentRestaurant.id);
    waiters.forEach((w) => {
      if (w.tableId === tableId && w.status === 'PENDING') {
        w.status = 'RESOLVED';
        db.saveWaiterRequest(w);
      }
    });

    refreshTenantData();
    soundFX.playChime();
    showToast('success', `تمت تصفية ${tableId}`, 'تم دفع الحساب وإعادة الطاولة إلى حالة المتاحة وتفريغ الجلسات.');
  }, [currentRestaurant, refreshTenantData, showToast]);

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

      api.callWaiter(currentRestaurant.id, targetTableId, targetReason, targetText, currentTableSession?.sessionToken).then((res) => {
        if (res.success) {
          refreshTenantData();
          soundFX.playBell();
          showToast('success', 'تم استدعاء طاقم الضيافة', `طاقم ${currentRestaurant.name} في طريقه إلى ${targetTableId} لخدمتك.`);
        }
      });
    },
    [currentRestaurant, activeTableId, currentTableSession, refreshTenantData, showToast]
  );

  const resolveWaiterRequest = useCallback((requestId: string) => {
    if (!currentRestaurant) return;
    const waiters = db.getWaiterRequests(currentRestaurant.id);
    const req = waiters.find((w) => w.id === requestId);
    if (req) {
      req.status = 'RESOLVED';
      db.saveWaiterRequest(req);
      const otherPending = waiters.filter((w) => w.tableId === req.tableId && w.id !== req.id && w.status === 'PENDING');
      if (otherPending.length === 0) {
        const table = db.getTableById(currentRestaurant.id, req.tableId);
        if (table) {
          table.hasWaiterCall = false;
          db.saveTable(table);
        }
      }
      refreshTenantData();
      showToast('info', 'تم إنجاز طلب النادل');
    }
  }, [currentRestaurant, refreshTenantData, showToast]);

  const acknowledgeWaiterRequest = useCallback((requestId: string) => {
    if (!currentRestaurant) return;
    const req = db.getWaiterRequests(currentRestaurant.id).find((w) => w.id === requestId);
    if (req) {
      req.status = 'ACKNOWLEDGED';
      db.saveWaiterRequest(req);
      refreshTenantData();
      showToast('info', 'تم استلام النداء وجاري التوجه للطاولة');
    }
  }, [currentRestaurant, refreshTenantData, showToast]);

  const toggleProductStock = useCallback((productId: string) => {
    if (!currentRestaurant) return;
    const prods = db.getProducts(currentRestaurant.id);
    const p = prods.find((item) => item.id === productId);
    if (p) {
      p.isAvailable = !p.isAvailable;
      db.saveProduct(p);
      refreshTenantData();
      showToast(p.isAvailable ? 'success' : 'warning', p.isAvailable ? 'الطبق متوفر الآن' : 'تم تحويل الطبق إلى غير متوفر (نفد المخزون)');
    }
  }, [currentRestaurant, refreshTenantData, showToast]);

  const toggleProductAvailability = toggleProductStock;

  const addProduct = useCallback((product: Omit<Product, 'id' | 'restaurantId'>) => {
    if (!currentRestaurant) return;
    const newProduct: Product = {
      ...product,
      id: `prod-${currentRestaurant.id}-${Date.now()}`,
      restaurantId: currentRestaurant.id,
    };
    db.saveProduct(newProduct);
    refreshTenantData();
    showToast('success', 'تمت إضافة طبق جديد للقائمة', newProduct.name);
    void api.saveProduct(currentUser || { id: '', restaurantId: currentRestaurant.id, name: '', email: '', role: 'RESTAURANT_MANAGER', createdAt: '' }, currentRestaurant.id, newProduct);
  }, [currentRestaurant, currentUser, refreshTenantData, showToast]);

  const updateProduct = useCallback((product: Product) => {
    if (!currentRestaurant) return;
    const updatedProd: Product = { ...product, restaurantId: currentRestaurant.id };
    db.saveProduct(updatedProd);
    refreshTenantData();
    showToast('success', 'تم تعديل بيانات الطبق', product.name);
    void api.saveProduct(currentUser || { id: '', restaurantId: currentRestaurant.id, name: '', email: '', role: 'RESTAURANT_MANAGER', createdAt: '' }, currentRestaurant.id, updatedProd);
  }, [currentRestaurant, currentUser, refreshTenantData, showToast]);

  const deleteProduct = useCallback((productId: string) => {
    if (!currentRestaurant) return;
    db.deleteProduct(currentRestaurant.id, productId);
    refreshTenantData();
    showToast('info', 'تم حذف الطبق من القائمة');
    void api.deleteManagerProduct(currentUser || { id: '', restaurantId: currentRestaurant.id, name: '', email: '', role: 'RESTAURANT_MANAGER', createdAt: '' }, currentRestaurant.id, productId);
  }, [currentRestaurant, currentUser, refreshTenantData, showToast]);

  const addCategory = useCallback((name: string, nameEn?: string) => {
    if (!currentRestaurant) return;
    const currentCats = db.getCategories(currentRestaurant.id);
    const newCat: Category = {
      id: `cat-${currentRestaurant.id}-${Date.now()}`,
      restaurantId: currentRestaurant.id,
      name,
      nameEn,
      sortOrder: currentCats.length + 1,
    };
    db.saveCategory(newCat);
    refreshTenantData();
    showToast('success', 'تمت إضافة تصنيف جديد', name);
    void api.saveCategory(currentUser || { id: '', restaurantId: currentRestaurant.id, name: '', email: '', role: 'RESTAURANT_MANAGER', createdAt: '' }, currentRestaurant.id, newCat);
  }, [currentRestaurant, currentUser, refreshTenantData, showToast]);

  const updateCategory = useCallback((category: Category) => {
    if (!currentRestaurant) return;
    const updatedCat = { ...category, restaurantId: currentRestaurant.id };
    db.saveCategory(updatedCat);
    refreshTenantData();
    showToast('success', 'تم تعديل التصنيف', category.name);
  }, [currentRestaurant, refreshTenantData, showToast]);

  const deleteCategory = useCallback((categoryId: string) => {
    if (!currentRestaurant) return;
    db.deleteCategory(currentRestaurant.id, categoryId);
    refreshTenantData();
    showToast('info', 'تم حذف التصنيف');
  }, [currentRestaurant, refreshTenantData, showToast]);

  const addOffer = useCallback((offer: Omit<Offer, 'id' | 'restaurantId'>) => {
    if (!currentRestaurant) return;
    const newOffer: Offer = {
      ...offer,
      id: `offer-${Date.now()}`,
      restaurantId: currentRestaurant.id,
    };
    db.saveOffer(newOffer);
    refreshTenantData();
    showToast('success', 'تم نشر العرض الترويجي', newOffer.title);
  }, [currentRestaurant, refreshTenantData, showToast]);

  const deleteOffer = useCallback((offerId: string) => {
    if (!currentRestaurant) return;
    db.deleteOffer(currentRestaurant.id, offerId);
    refreshTenantData();
    showToast('info', 'تم حذف العرض الترويجي');
  }, [currentRestaurant, refreshTenantData, showToast]);

  return (
    <RestaurantContext.Provider
      value={{
        currentRestaurant,
        setCurrentRestaurant,
        availableRestaurants,
        tenantsList: availableRestaurants,
        currentUser,
        setCurrentUser,
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
        isAutoKitchenEnabled,
        toggleAutoKitchen,
        resetAllDemoData,
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
        loginAsUser,
        logout,
        refreshTenantData,
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
