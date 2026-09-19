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
  ProductAddOn,
  ToastMessage,
  RestaurantUser,
  TableSession,
  EntitlementKey,
  PaymentRecord,
  TransferChannel,
  Branch,
  Plan,
  Subscription,
} from '../types/restaurant';
import { api, apiConnectionUrl, newClientRequestId } from '../services/api';
import {
  mergeRestaurantIdentity,
  parseCustomerEntryUrl,
  runCustomerEntry,
  type EntryApiResponse,
  type EntryCatalogData,
  type EntryInvalidReason,
  type EntryPhase,
  type EntrySessionData,
} from '../services/customerEntry';
import { useAuth } from './AuthContext';
import { soundFX } from '../utils/audio';
import { applyBrandTheme } from '../theme/brandTheme';
import { resolveTableDisplayNumber } from '../utils/formatting';
import { openEventSourceWithBackoff } from '../utils/sse';
import { isOrderOperational } from '../utils/orderLifecycle';

export type AppViewMode = 'CUSTOMER' | 'MANAGER' | 'ADMIN' | 'ONBOARDING' | 'PLATFORM_ADMIN' | 'SPLIT_PREVIEW' | 'KITCHEN_KDS' | 'SAAS_LANDING' | 'LIVE_SCREEN';

/**
 * True when the URL asks for the read-only menu board
 * (`/r/:slug?view=display`) used on TVs and for social-media recording.
 * Display mode never opens a table session, so it can never place an order.
 */
export function isDisplayModeUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const view = (params.get('view') || params.get('mode') || '').toLowerCase();
  return view === 'display' || view === 'tv';
}

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
  /** True on the read-only display board (`?view=display`). */
  displayMode: boolean;
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
  /**
   * Lifecycle of the current tenant's first data load for the authenticated
   * workspace ('idle' before any fetch, 'loading' until the first request
   * settles, 'ready' afterwards). Lets staff screens render structural
   * skeletons instead of flashing misleading empty states.
   */
  tenantDataStatus: 'idle' | 'loading' | 'ready';

  // Active Customer Table Session
  activeTableId: string | null;
  setActiveTableId: (tableId: string | null) => void;
  activeTableNumber: number | null;
  setActiveTableNumber: (tableNumber: number | null) => void;
  activeTable: RestaurantTable | null;
  currentTableSession: TableSession | null;
  /**
   * Customer QR entry lifecycle (see services/customerEntry.ts). READY is
   * only reached after session + restaurant + catalog ALL confirmed success.
   * Non-guest starts (staff/landing) begin READY.
   */
  entryPhase: EntryPhase;
  /** Why entry is INVALID: bad table QR ('qr') or unavailable venue ('restaurant'). */
  entryInvalidReason: EntryInvalidReason | null;
  /** Customer-safe retry after bounded recovery is exhausted (RECOVERY). */
  retryEntry: () => void;
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
  callWaiter: (reasonOrTableId: WaiterRequest['reason'] | string, maybeReason?: WaiterRequest['reason'] | string, customText?: string) => Promise<{ success: boolean; error?: string }>;
  activeTableOrders: Order[];
  /**
   * MANDATORY PAYMENT STEP: the order the guest must settle right after
   * submitting it (the payment authorization boundary). Non-null while the
   * guest still owes the payment step for a freshly placed order; the customer
   * layout renders the transfer/receipt screen for it.
   */
  orderAwaitingPayment: Order | null;
  /** Close the payment step (the guest may reopen it from the order tracker). */
  dismissPaymentStep: () => void;
  /**
   * Announce a bank/wallet transfer: uploads the receipt together with the
   * guest's name + mobile number for one of the guest's own orders and moves it
   * to PENDING_VERIFICATION. Prices and tenant are resolved server-side; the
   * client only supplies the file and the identity the cashier must verify.
   */
  submitTransferPaymentProof: (
    orderId: string,
    details: { customerName: string; phone: string; channel?: TransferChannel },
    file: File | Blob,
    onProgress?: (percent: number) => void,
    fileName?: string
  ) => Promise<{ success: boolean; error?: string }>;

  // Manager Actions
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<boolean>;
  /** Staff cancellation (audit H-02): cashier/manager transition to CANCELLED with an optional reason. */
  cancelStaffOrder: (orderId: string, reason?: string) => Promise<boolean>;
  /** Payment void (audit H-02): reverse a ledger receipt; covered orders return to UNPAID. */
  voidStaffPayment: (
    paymentId: string,
    reason?: string,
    stepUpToken?: string
  ) => Promise<boolean>;
  updateTableStatus: (tableId: string, status: RestaurantTable['status']) => Promise<boolean>;
  isMutationPending: (key: string) => boolean;
  settleTableAndFree: (tableId: string) => void;
  resolveWaiterRequest: (requestId: string) => Promise<boolean>;
  acknowledgeWaiterRequest: (requestId: string) => Promise<boolean>;
  toggleProductStock: (productId: string) => Promise<boolean>;
  toggleProductAvailability: (productId: string) => Promise<boolean>;
  addProduct: (product: Omit<Product, 'id' | 'restaurantId'>) => Promise<boolean>;
  updateProduct: (product: Product) => Promise<boolean>;
  deleteProduct: (productId: string) => Promise<boolean>;
  addCategory: (name: string, nameEn?: string) => Promise<boolean>;
  updateCategory: (category: Category) => void;
  deleteCategory: (categoryId: string) => void;
  addOffer: (offer: Omit<Offer, 'id' | 'restaurantId'>) => Promise<boolean>;
  deleteOffer: (offerId: string) => Promise<boolean>;

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

/**
 * One-table-per-device binding.
 *
 * The customer experience is QR-only: a device that scans a table QR is bound
 * to THAT table for the lifetime of the tab. The binding is persisted in
 * sessionStorage (so a refresh does not unbind it) and is re-checked whenever
 * the URL handling effect runs — a second, different QR token is rejected
 * instead of silently switching tables.
 */
const TABLE_BINDING_KEY = 'merar_table_binding';

interface TableBinding {
  restaurantId: string;
  tableId: string;
  tableNumber: number;
  qrToken: string;
  // The opaque capability is persisted only for this browser tab. It lets a
  // reload restore this guest's own order tracker after the business session
  // closes; the QR token alone can never recover an earlier guest's orders.
  sessionId?: string;
  sessionToken?: string;
}

function readTableBinding(): TableBinding | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(TABLE_BINDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TableBinding>;
    if (
      typeof parsed.restaurantId === 'string' &&
      typeof parsed.tableId === 'string' &&
      typeof parsed.qrToken === 'string' &&
      parsed.qrToken
    ) {
      return {
        restaurantId: parsed.restaurantId,
        tableId: parsed.tableId,
        tableNumber: Number(parsed.tableNumber) || 0,
        qrToken: parsed.qrToken,
        sessionId:
          typeof parsed.sessionId === 'string' && parsed.sessionId
            ? parsed.sessionId
            : undefined,
        sessionToken:
          typeof parsed.sessionToken === 'string' && parsed.sessionToken
            ? parsed.sessionToken
            : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeTableBinding(binding: TableBinding): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(TABLE_BINDING_KEY, JSON.stringify(binding));
  } catch {
    /* storage unavailable — binding enforcement degrades to URL-only */
  }
}

function clearTableBinding(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(TABLE_BINDING_KEY);
  } catch {
    /* noop */
  }
}

export function resolveBestInitialCategory(cats: Category[], prods: Product[]): string {
  if (!cats || cats.length === 0) return 'all';
  const withAvailable = cats.find((c) =>
    prods.some((p) => p.categoryId === c.id && p.isAvailable !== false)
  );
  if (withAvailable) return withAvailable.id;
  const withAny = cats.find((c) => prods.some((p) => p.categoryId === c.id));
  if (withAny) return withAny.id;
  return cats[0]?.id || 'all';
}

export const RestaurantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const { currentUser, currentManagerRestaurant, setCurrentManagerRestaurant, setCurrentUser: authSetCurrentUser, logout: authLogout } = auth;

  const [currentRestaurant, setCurrentRestaurant] = useState<Restaurant | null>(null);

  const updateCurrentRestaurant = useCallback((action: React.SetStateAction<Restaurant | null>) => {
    setCurrentRestaurant((prev) => {
      const next = typeof action === 'function' ? (action as (p: Restaurant | null) => Restaurant | null)(prev) : action;
      if (next && (currentUser?.restaurantId === next.id || currentManagerRestaurant?.id === next.id)) {
        setCurrentManagerRestaurant?.(next);
      }
      return next;
    });
  }, [currentUser?.restaurantId, currentManagerRestaurant?.id, setCurrentManagerRestaurant]);
  // Read-only menu board (TV / social media). Fixed for the session: it comes
  // from the URL and never flips while the board is open.
  const [displayMode] = useState<boolean>(isDisplayModeUrl);
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
  const [activeTableNumber, setActiveTableNumber] = useState<number | null>(null);
  const [currentTableSession, setCurrentTableSession] = useState<TableSession | null>(null);

  // Customer QR entry state machine. Each entry run carries a unique
  // identity (entryRunRef); async steps consult it before committing, so a
  // stale response from an older QR scan can never overwrite newer state.
  const entryRunRef = useRef(0);
  const [entryPhase, setEntryPhase] = useState<EntryPhase>(() => {
    if (typeof window === 'undefined') return 'READY';
    const pathname = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const isGuestEntry =
      pathname.startsWith('/r/') ||
      params.has('qr') ||
      params.has('table') ||
      params.has('t') ||
      params.has('tableId');
    return isGuestEntry ? 'INITIALIZING' : 'READY';
  });
  const [entryInvalidReason, setEntryInvalidReason] = useState<EntryInvalidReason | null>(null);

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

  const activeTable = useMemo<RestaurantTable | null>(() => {
    if (activeTableId) {
      const found = tables.find((t) => t.id === activeTableId);
      if (found) return found;
    }
    if (activeTableNumber) {
      const found = tables.find((t) => t.tableNumber === activeTableNumber);
      if (found) return found;
    }
    return null;
  }, [tables, activeTableId, activeTableNumber]);

  useEffect(() => {
    if (activeTableId && tables.length > 0) {
      const match = tables.find((t) => t.id === activeTableId);
      if (match && match.tableNumber !== activeTableNumber) {
        setActiveTableNumber(match.tableNumber);
      }
    }
  }, [activeTableId, tables, activeTableNumber]);
  const [orders, setOrders] = useState<Order[]>([]);
  // The order whose mandatory payment step is on screen. Re-resolved against
  // `orders` on every render so the screen always shows server state, and it
  // disappears by itself the moment the order is released (paid/verified).
  const [paymentStepOrder, setPaymentStepOrder] = useState<Order | null>(null);
  const [waiterRequests, setWaiterRequests] = useState<WaiterRequest[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tenantDataStatus, setTenantDataStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [availableRestaurants, setAvailableRestaurants] = useState<Restaurant[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const pendingMutationKeysRef = useRef(new Set<string>());
  const [, setPendingMutationVersion] = useState(0);
  const isMutationPending = useCallback((key: string) => pendingMutationKeysRef.current.has(key), []);
  const beginMutation = useCallback((key: string): boolean => {
    if (pendingMutationKeysRef.current.has(key)) return false;
    pendingMutationKeysRef.current.add(key);
    setPendingMutationVersion((version) => version + 1);
    return true;
  }, []);
  const endMutation = useCallback((key: string) => {
    pendingMutationKeysRef.current.delete(key);
    setPendingMutationVersion((version) => version + 1);
  }, []);
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
    setTenantDataStatus('loading');

    try {
      if (currentUser) {
        const [menuRes, ordersRes, tablesRes, waitersRes, offersRes, paymentsRes, branchesRes, subRes] = await Promise.all([
          api.getManagerMenu(tenantId),
          // H-03: the operational scope — every LIVE order (any age) plus a
          // bounded recent-history window. The default "50 newest" page could
          // silently drop an old still-active ticket from the KDS/floor/POS.
          api.getManagerOrders(tenantId, { scope: 'operations' }),
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
          setSelectedCategoryId((prev) =>
            prev && (prev === 'all' || menuRes.data!.categories.some((c) => c.id === prev))
              ? prev
              : resolveBestInitialCategory(menuRes.data!.categories, menuRes.data!.products)
          );
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
            tablesRes.data
              .slice()
              .sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0))
              .map((t) => ({
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
        // Fetch the menu AND the live orders of this QR session in parallel.
        // Orders are what power the guest's "المطبخ الحي" status tracker.
        const ordersPromise = activeTableId
          ? api.getTableSessionOrders(currentRestaurant.id, activeTableId, currentTableSession.sessionToken)
          : Promise.resolve(null);
        const [catalogRes, ordersRes] = await Promise.all([
          api.getPublicRestaurantBySlug(currentRestaurant.slug, currentTableSession.sessionToken),
          ordersPromise,
        ]);

        if (ordersRes && ordersRes.success && ordersRes.data) {
          setOrders(ordersRes.data);
        }

        if (catalogRes.success && catalogRes.data) {
          setCategories(catalogRes.data.categories);
          setProducts(catalogRes.data.products);
          setOffers(catalogRes.data.offers);
          if (catalogRes.data.tables && catalogRes.data.tables.length > 0) {
            setTables(catalogRes.data.tables.slice().sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0)));
          }
          setSelectedCategoryId((prev) =>
            prev && (prev === 'all' || catalogRes.data!.categories.some((c) => c.id === prev))
              ? prev
              : resolveBestInitialCategory(catalogRes.data!.categories, catalogRes.data!.products)
          );
        }
      } else if (displayMode && currentRestaurant?.slug) {
        // Display board: same public catalog, no table token, no session.
        const boardRes = await api.getPublicRestaurantBySlug(currentRestaurant.slug);
        if (boardRes.success && boardRes.data) {
          setCategories(boardRes.data.categories);
          setProducts(boardRes.data.products);
          setOffers(boardRes.data.offers);
          setSelectedCategoryId((prev) =>
            prev && (prev === 'all' || boardRes.data!.categories.some((c) => c.id === prev))
              ? prev
              : resolveBestInitialCategory(boardRes.data!.categories, boardRes.data!.products)
          );
        }
      }
    } catch {
      /* ignore transient background errors — human-readable retry surfaces
         live in the individual views; the poll/SSE retries the data. */
    } finally {
      isFetchingRef.current = false;
      setTenantDataStatus('ready');
    }
  }, [currentRestaurant?.id, currentRestaurant?.slug, currentUser?.id, currentTableSession?.sessionToken, activeTableId, displayMode]);

  // Load the platform tenant directory for platform admins (used by the
  // tenant switcher, admin portal and manager header) or public active restaurants for staff login.
  const loadTenantsList = useCallback(async () => {
    if (!currentUser) {
      // Unauthenticated: fetch active public restaurants so staff can select their restaurant and login with PIN
      const res = await api.getPublicRestaurants();
      if (res.success && res.data) {
        setAvailableRestaurants(res.data.restaurants);
      }
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
      setCurrentRestaurant((prev) => {
        if (!prev || prev.id !== currentManagerRestaurant.id) {
          return currentManagerRestaurant;
        }
        return {
          ...prev,
          ...currentManagerRestaurant,
        };
      });
    }
  }, [currentUser?.id, currentManagerRestaurant, viewMode, currentTableSession]);

  // Keep brand theme synchronized and persistently cached when current restaurant changes
  useEffect(() => {
    if (currentRestaurant?.primaryColor || currentRestaurant?.accentColor) {
      applyBrandTheme(currentRestaurant.primaryColor, currentRestaurant.accentColor, null, {
        restaurantId: currentRestaurant.id,
        slug: currentRestaurant.slug,
      });
    }
  }, [currentRestaurant?.primaryColor, currentRestaurant?.accentColor, currentRestaurant?.id, currentRestaurant?.slug]);

  // 10-second background polling with in-flight lock — mitigates DoS/vector (M-04).
  // Previous 1.5s × 8 endpoints = 320 req/min per tab exceeded global rate-limit
  // (300/min) and hit Render pool limits. 10s → ~48 req/min; SSE covers live updates.
  useEffect(() => {
    if (!currentRestaurant?.id) return;

    // Initial fetch on tenant load/switch
    void refreshTenantData();

    const interval = window.setInterval(() => {
      void refreshTenantData();
    }, 10000);

    return () => window.clearInterval(interval);
  }, [currentRestaurant?.id, refreshTenantData]);

  // -------------------------------------------------------------------------
  // Customer QR entry — one explicit state machine (services/customerEntry):
  //
  //   INITIALIZING → VALIDATING_QR → LOADING_CATALOG → READY
  //   transient failure → RETRYING (bounded backoff) → READY / RECOVERY
  //   permanently invalid QR / venue → INVALID
  //
  // Invariants enforced here:
  //   - READY only after session AND catalog requests genuinely succeeded —
  //     never inferred from empty arrays, so no empty-menu flash is possible;
  //   - every run has a unique identity (entryRunRef) — a stale response from
  //     an older QR scan can never overwrite newer customer state;
  //   - a newly scanned VALID QR supersedes stale table context; an INVALID
  //     new QR can never destroy the existing bound session;
  //   - guests never see technical errors — only the premium loader, the
  //     safe recovery card or the minimal invalid state.
  // -------------------------------------------------------------------------
  const parseEntryUrl = useCallback(
    (): { slug: string; qrToken: string } =>
      parseCustomerEntryUrl(
        typeof window === 'undefined' ? null : window.location
      ),
    []
  );

  const startCustomerEntry = useCallback(
    async (runId: number, slug: string, qrTokenRaw: string) => {
      const isStale = () => entryRunRef.current !== runId;
      const setPhaseSafe = (phase: EntryPhase) => {
        if (!isStale()) setEntryPhase(phase);
      };

      const storedBinding = readTableBinding();

      // The entry orchestrator works on minimal structural shapes; the real
      // API client returns rich domain types — bridge them once here. A reload
      // presents the tab's saved session capability so the server can restore
      // the same tracker without reopening a CLOSED business session. If that
      // capability has naturally expired, explicitly retry as a fresh QR scan;
      // the rejected capability itself never grants access.
      const entryApi = {
        createTableSession: async (token: string, s?: string) => {
          const isBoundQr = storedBinding?.qrToken === token;
          const resumeSessionToken = isBoundQr ? storedBinding.sessionToken : undefined;
          let response = await api.createTableSession(
            token,
            s,
            isBoundQr ? storedBinding?.restaurantId : undefined,
            resumeSessionToken
          );
          if (!response.success && response.statusCode === 403 && resumeSessionToken) {
            response = await api.createTableSession(token, s, storedBinding?.restaurantId);
          }
          return response as unknown as EntryApiResponse<EntrySessionData>;
        },
        getCatalog: (s: string, q?: string) =>
          api.getPublicRestaurantBySlug(s, q) as unknown as Promise<EntryApiResponse<EntryCatalogData>>,
      };
      const hooksFor = (): {
        isStale: () => boolean;
        wait: (ms: number) => Promise<void>;
        onPhase: (phase: EntryPhase) => void;
        onIdentity: (restaurant: EntrySessionData['restaurant']) => void;
      } => ({
        isStale,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        onPhase: setPhaseSafe,
        onIdentity: (restaurant) => {
          if (isStale()) return;
          // Merge, never replace: the identity payload may be partial, and a
          // missing field must not erase branding that is already known
          // (theme colors, cover, logo framing, gallery, map).
          setCurrentRestaurant((prev) =>
            mergeRestaurantIdentity(prev, restaurant as unknown as Partial<Restaurant>)
          );
        },
      });

      if (!isStale()) setEntryInvalidReason(null);

      const urlToken = qrTokenRaw && qrTokenRaw !== 'default' ? qrTokenRaw : '';
      // A fresh scan takes precedence over stale table context: the new token
      // is validated SERVER-SIDE before anything is adopted. Only when the
      // URL carries no token at all (refresh / relaunch) do we reuse the
      // bound table's token.
      const targetToken = urlToken || storedBinding?.qrToken || '';

      // Commit a successful run — the ONLY place customer state changes.
      const commitReady = (
        session: EntrySessionData | null,
        catalog: EntryCatalogData,
        adoptedToken: string | null
      ) => {
        if (isStale()) return;
        if (session) {
          setActiveTableId(session.table.id);
          setActiveTableNumber(session.table.tableNumber);
          setCurrentTableSession(session.session as unknown as TableSession);
          setViewMode('CUSTOMER');

          // Keep the session's table in the local registry so every view can
          // render the real table number printed on its QR card.
          const sessionTable = session.table as unknown as RestaurantTable;
          if (sessionTable?.id) {
            setTables((prev) => (prev.some((t) => t.id === sessionTable.id) ? prev : [...prev, sessionTable]));
          }

          // Persist the binding: a refresh restores THIS table, and an
          // invalid foreign QR can never move this device elsewhere.
          if (adoptedToken && session.restaurant?.id) {
            writeTableBinding({
              restaurantId: String(session.restaurant.id),
              tableId: session.table.id,
              tableNumber: session.table.tableNumber,
              qrToken: adoptedToken,
              sessionId: session.session.id,
              sessionToken: session.session.sessionToken,
            });
          }
        }

        setCategories(catalog.categories as Category[]);
        setProducts(catalog.products as Product[]);
        setOffers(catalog.offers as Offer[]);
        const catalogTables = catalog.tables as RestaurantTable[] | undefined;
        if (catalogTables && catalogTables.length > 0) {
          setTables(catalogTables.slice().sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0)));
        }
        setCurrentRestaurant(catalog.restaurant as unknown as Restaurant);
        setSelectedCategoryId(
          resolveBestInitialCategory(catalog.categories as Category[], catalog.products as Product[])
        );
        setEntryPhase('READY');
        // Kick off the guest's live order-status stream.
        void refreshTenantData();
      };

      const outcome = await runCustomerEntry({ slug, qrToken: targetToken || undefined }, entryApi, hooksFor());
      if (outcome.outcome === 'STALE' || isStale()) return;

      if (outcome.outcome === 'READY') {
        commitReady(outcome.session, outcome.catalog, outcome.qrToken);
        return;
      }

      // A DIFFERENT new QR that turned out invalid must not strand a guest
      // who already has a live bound session: fall back to the bound table
      // exactly once. (This is also the one case the guest is told about,
      // in plain non-technical language.)
      if (
        outcome.outcome === 'INVALID' &&
        outcome.reason === 'qr' &&
        storedBinding?.qrToken &&
        targetToken !== storedBinding.qrToken
      ) {
        if (!isStale()) {
          showToast(
            'error',
            'لا يمكن تغيير الطاولة',
            `الرمز الجديد غير صالح — بقيت مرتبطاً بطاولة ${storedBinding.tableNumber || '—'}.`
          );
        }
        const fallback = await runCustomerEntry({ slug, qrToken: storedBinding.qrToken }, entryApi, hooksFor());
        if (fallback.outcome === 'STALE' || isStale()) return;
        if (fallback.outcome === 'READY') {
          commitReady(fallback.session, fallback.catalog, storedBinding.qrToken);
          return;
        }
        if (fallback.outcome === 'INVALID') {
          setEntryInvalidReason(fallback.reason);
          setPhaseSafe('INVALID');
          return;
        }
        setPhaseSafe('RECOVERY');
        return;
      }

      if (outcome.outcome === 'INVALID') {
        setEntryInvalidReason(outcome.reason);
        setPhaseSafe('INVALID');
        return;
      }
      // Bounded recovery exhausted (or unexpected orchestration fault):
      // customer-safe retry card — never a technical error screen.
      setPhaseSafe('RECOVERY');
    },
    [refreshTenantData, showToast, setViewMode]
  );

  /** Manual retry from the RECOVERY card: starts a brand-new entry run. */
  const retryEntry = useCallback(() => {
    const { slug, qrToken } = parseEntryUrl();
    const runId = ++entryRunRef.current;
    setEntryPhase('INITIALIZING');
    setEntryInvalidReason(null);
    void startCustomerEntry(runId, slug, qrToken);
  }, [parseEntryUrl, startCustomerEntry]);

  useEffect(() => {
    if (typeof window === 'undefined' || urlHandledRef.done) return;

    const { slug, qrToken } = parseEntryUrl();

    if (slug && displayMode) {
      // Read-only board: load the catalog by slug only — no table session is
      // created, so there is nothing to order against and no cart to fill.
      urlHandledRef.done = true;
      const runId = ++entryRunRef.current;
      api.getPublicRestaurantBySlug(slug).then((catalogRes) => {
        if (entryRunRef.current !== runId) return; // superseded by a newer run
        if (catalogRes.success && catalogRes.data) {
          setCategories(catalogRes.data.categories);
          setProducts(catalogRes.data.products);
          setOffers(catalogRes.data.offers);
          setCurrentRestaurant(catalogRes.data.restaurant);
          setSelectedCategoryId(resolveBestInitialCategory(catalogRes.data.categories, catalogRes.data.products));
          setViewMode('CUSTOMER');
        } else {
          showToast('error', 'تعذر تحميل قائمة العرض', catalogRes.error || 'الرابط غير صالح');
          setViewMode('SAAS_LANDING');
        }
      });
      return;
    }

    // A customer entry run starts ONLY for a real venue link (`/r/{slug}`,
    // `?r=`) or a QR token. A bare `/` visit is the platform landing page and
    // must never fire a fake QR/customer initialization request.
    if (slug || qrToken) {
      urlHandledRef.done = true;
      const runId = ++entryRunRef.current;
      void startCustomerEntry(runId, slug, qrToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the active QR token in the public URL without exposing table numbers.
  useEffect(() => {
    if (typeof window === 'undefined' || !currentRestaurant || viewMode !== 'CUSTOMER') return;
    if (displayMode) return; // never rewrite the shareable display link
    if (activeTableId && currentTableSession) {
      const table = tables.find((t) => t.id === activeTableId);
      const qrToken = table?.qrToken || readTableBinding()?.qrToken;
      if (!qrToken) return;
      const newUrl = `/r/${currentRestaurant.slug}?qr=${encodeURIComponent(qrToken)}`;
      if (window.location.pathname + window.location.search !== newUrl) {
        window.history.replaceState({ tableId: activeTableId, slug: currentRestaurant.slug }, '', newUrl);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRestaurant?.slug, activeTableId, viewMode]);

  // Ref to track previous status of customer orders for instant live notifications
  const prevOrderStatusMapRef = useRef<Record<string, string>>({});
  const orderSubmissionRef = useRef<{ fingerprint: string; clientRequestId: string } | null>(null);

  // SSE real-time listener for customers with an active table session.
  useEffect(() => {
    if (!currentRestaurant || typeof window === 'undefined') return;
    if (
      viewMode !== 'CUSTOMER' ||
      !activeTableId ||
      !currentTableSession?.sessionToken ||
      currentTableSession.status !== 'ACTIVE'
    ) return;

    let conn: { close: () => void } | null = null;
    try {
      // Customer streams authenticate with the QR session capability only —
      // the staff JWT must never travel in a URL (logs/history/referrer).
      conn = openEventSourceWithBackoff(
        apiConnectionUrl(`/api/public/events?restaurantId=${currentRestaurant.id}&tableId=${activeTableId}&sessionToken=${encodeURIComponent(currentTableSession.sessionToken)}`),
        {
          ORDER_STATUS_UPDATED: (e: MessageEvent) => {
            refreshTenantData();
            try {
              const data = JSON.parse((e as MessageEvent).data as string);
              if (data.status === 'READY') soundFX.playBell();
              else soundFX.playTap();
            } catch {
              /* noop */
            }
          },
          ORDER_CREATED: () => refreshTenantData(),
          // The guest's own submission: the order exists but is NOT a kitchen
          // ticket yet — the payment step is what releases it.
          ORDER_AWAITING_PAYMENT: () => refreshTenantData(),
          ORDER_CANCELLED: () => refreshTenantData(),
          WAITER_STATUS_UPDATED: (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data as string) as { id?: string; status?: WaiterRequest['status'] };
              if (!data.id || !data.status) return;
              setWaiterRequests((current) => current.map((request) => {
                if (request.id !== data.id) return request;
                const allowed =
                  (request.status === 'PENDING' && data.status === 'ACKNOWLEDGED') ||
                  (request.status === 'ACKNOWLEDGED' && data.status === 'RESOLVED') ||
                  request.status === data.status;
                return allowed ? { ...request, status: data.status! } : request;
              }));
              if (data.status === 'ACKNOWLEDGED') showToast('info', 'تم استلام ندائك', 'النادل في طريقه إلى طاولتك.');
              if (data.status === 'RESOLVED') showToast('success', 'تم إنجاز طلب المساعدة');
            } catch {
              /* ignore malformed real-time payloads */
            }
          },
          TABLE_SETTLED: () => refreshTenantData(),
          PAYMENT_PROOF_VERIFIED: (event: MessageEvent) => {
            refreshTenantData();
            // The guest must learn that the cashier accepted the transfer AND
            // that preparation started — a silent status change reads as a
            // stuck order.
            try {
              const data = JSON.parse(event.data as string) as { kitchenReleased?: boolean };
              showToast(
                'success',
                'تم تأكيد الدفع',
                data.kitchenReleased
                  ? 'أُرسل طلبك إلى المطبخ فوراً بعد التحقق من إشعار التحويل.'
                  : 'تم التحقق من إشعار التحويل وتأكيد دفع طلبك.'
              );
              soundFX.playBell();
            } catch {
              showToast('success', 'تم تأكيد الدفع', 'تم التحقق من إشعار التحويل.');
            }
          },
          PAYMENT_PROOF_REJECTED: (event: MessageEvent) => {
            refreshTenantData();
            try {
              const data = JSON.parse(event.data as string) as { reason?: string };
              showToast(
                'warning',
                'لم يتم التحقق من إشعار الحوالة',
                data.reason || 'يرجى الدفع عند الكاشير أو إرسال إشعار جديد.'
              );
            } catch {
              showToast('warning', 'لم يتم التحقق من إشعار الحوالة');
            }
          },
          // THE release event: payment verified → the restaurant may start.
          ORDER_RELEASED_TO_KITCHEN: () => {
            refreshTenantData();
            showToast(
              'success',
              'تم تأكيد الدفع، وجارٍ تجهيز طلبك.',
              'انتقل طلبك إلى المطبخ بعد التحقق من الدفع.'
            );
            soundFX.playBell();
          },
        }
      );
    } catch {
      /* polling fallback */
    }
    return () => {
      conn?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRestaurant?.id, activeTableId, currentTableSession?.sessionToken, currentTableSession?.status, viewMode]);

  // SSE real-time listener for staff (Manager / Kitchen KDS / Cashier / Waiter)
  useEffect(() => {
    if (!currentRestaurant?.id || !currentUser || typeof window === 'undefined') return;
    const token = localStorage.getItem('merar_auth_token');
    if (!token) return;

    let conn: { close: () => void } | null = null;
    try {
      conn = openEventSourceWithBackoff(
        apiConnectionUrl(`/api/public/events?restaurantId=${currentRestaurant.id}&token=${encodeURIComponent(token)}`),
        {
          ORDER_CREATED: () => {
            refreshTenantData();
            soundFX.playChime();
          },
          // A guest order arrived but is NOT operational yet: cashier surfaces
          // need to know (it sits in their payment queue), the kitchen must NOT
          // be alerted — it is not a ticket until the payment is verified.
          ORDER_AWAITING_PAYMENT: (event: MessageEvent) => {
            refreshTenantData();
            if (currentUser?.role !== 'CASHIER' && currentUser?.role !== 'RESTAURANT_MANAGER') return;
            try {
              const data = JSON.parse(event.data as string) as {
                numericId?: number;
                total?: number;
              };
              showToast(
                'info',
                'طلب جديد بانتظار دفع الزبون',
                `الطلب ${data.numericId ? `#${data.numericId}` : ''} — ${data.total ?? ''} ${
                  currentRestaurant?.currency || '₪'
                }`.trim() + ' · لن يظهر في المطبخ قبل تأكيد الدفع.'
              );
            } catch {
              showToast('info', 'طلب جديد بانتظار دفع الزبون');
            }
          },
          // Payment verified → the order is released to the restaurant. This is
          // the event that makes a newly authorized ticket appear (and chime on
          // the kitchen board); the submission event above never does.
          ORDER_RELEASED_TO_KITCHEN: (event: MessageEvent) => {
            refreshTenantData();
            try {
              const data = JSON.parse(event.data as string) as { orderStatus?: string };
              const watchingKitchen =
                viewMode === 'KITCHEN_KDS' ||
                viewMode === 'LIVE_SCREEN' ||
                currentUser?.role === 'KITCHEN';
              if (watchingKitchen && (data.orderStatus === undefined || data.orderStatus === 'PENDING')) {
                soundFX.playChime();
              }
            } catch {
              /* ignore malformed real-time payloads */
            }
          },
          ORDER_STATUS_UPDATED: (event: MessageEvent) => {
            refreshTenantData();
            // A paid transfer order is RELEASED to the kitchen with a PENDING
            // status: the KDS (and the cashier's own screen) must react to it
            // like a brand-new ticket so it never sits unnoticed.
            try {
              const data = JSON.parse(event.data as string) as {
                status?: string;
                kitchenReleased?: boolean;
              };
              if (data.status !== 'PENDING' || !data.kitchenReleased) return;
              const watchingKitchen = viewMode === 'KITCHEN_KDS' || currentUser?.role === 'KITCHEN';
              if (watchingKitchen) soundFX.playChime();
            } catch {
              /* ignore malformed real-time payloads */
            }
          },
          ORDER_CANCELLED: () => refreshTenantData(),
          TABLE_SETTLED: () => refreshTenantData(),
          PAYMENT_RECORDED: () => refreshTenantData(),
          PAYMENT_VOIDED: () => refreshTenantData(),
          // A transfer notice needs a cashier decision: cashier/manager only
          // (waiters and kitchen have no verification screen or permission).
          PAYMENT_PROOF_SUBMITTED: (event: MessageEvent) => {
            refreshTenantData();
            if (currentUser?.role !== 'CASHIER' && currentUser?.role !== 'RESTAURANT_MANAGER') return;
            try {
              const data = JSON.parse(event.data as string) as {
                numericId?: number;
                total?: number;
                channel?: string;
              };
              const channelLabel = data.channel === 'WALLET' ? 'محفظة إلكترونية' : 'حوالة بنكية';
              showToast(
                'info',
                `إشعار ${channelLabel} بانتظار التأكيد`,
                `الطلب ${data.numericId ? `#${data.numericId}` : ''} — ${data.total ?? ''} ${currentRestaurant?.currency || '₪'}`.trim()
              );
            } catch {
              showToast('info', 'إشعار تحويل بانتظار التحقق');
            }
            soundFX.playChime();
          },
          PAYMENT_PROOF_VERIFIED: () => refreshTenantData(),
          PAYMENT_PROOF_REJECTED: () => refreshTenantData(),
        }
      );
    } catch {
      /* fallback to background polling */
    }
    return () => {
      conn?.close();
    };
  }, [currentRestaurant?.id, currentUser?.id, viewMode, refreshTenantData]);

  // Entitlement checker — resolved from the tenant's live subscription.
  // This is a UI hint only: the server re-verifies every gated action.
  const checkEntitlement = useCallback(
    (key: EntitlementKey): boolean => {
      if (!currentRestaurant) return false;
      if (!subscription) return true; // not loaded yet — server enforces
      if (subscription.status === 'SUSPENDED' || subscription.status === 'CANCELLED') return false;
      // A free trial that ran out grants nothing until a paid plan is assigned.
      if (subscription.status === 'TRIAL' && subscription.trialEndsAt) {
        const endsAt = new Date(subscription.trialEndsAt).getTime();
        if (Number.isFinite(endsAt) && Date.now() > endsAt) return false;
      }
      const plan = plans.find((p) => p.id === subscription.planId);
      if (!plan) return false;
      return plan.entitlements.includes(key);
    },
    [currentRestaurant, subscription, plans]
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
      setActiveTableNumber(null);
      clearTableBinding();
      showToast('info', 'تم التبديل إلى مطعم', target.name);
    },
    [availableRestaurants, showToast]
  );

  const setCurrentTenantBySlug = switchTenantBySlug;

  const logout = useCallback(() => {
    authLogout();
    setCartItems([]);
    setActiveTableId(null);
    setActiveTableNumber(null);
    setCurrentTableSession(null);
    clearTableBinding();
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
      setActiveTableNumber(table.tableNumber);
      // Staff/manager preview picks a table explicitly — it is not a guest QR
      // scan, so drop any stale one-table binding before switching.
      clearTableBinding();
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

  /**
   * The payment step is shown ONLY while the order is still held by the payment
   * gate (awaiting payment / awaiting cashier): once it is RELEASED there is
   * nothing left to confirm, so the screen closes on its own.
   */
  const orderAwaitingPayment = useMemo(() => {
    if (!paymentStepOrder) return null;
    const fresh = orders.find((o) => o.id === paymentStepOrder.id) || paymentStepOrder;
    return isOrderOperational(fresh) ? null : fresh;
  }, [orders, paymentStepOrder]);

  const dismissPaymentStep = useCallback(() => setPaymentStepOrder(null), []);

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

  // Real-time status tracker for customer orders (visual notifications handled by CustomerOrderLiveNotifier and OrderCompletedModal)
  useEffect(() => {
    if (viewMode !== 'CUSTOMER' || activeTableOrders.length === 0) return;

    activeTableOrders.forEach((order) => {
      prevOrderStatusMapRef.current[order.id] = order.status;
    });
  }, [activeTableOrders, viewMode]);

  /**
   * Silent one-shot recovery for an expired QR session: the device binding
   * still carries the physical table token, so the server can issue a fresh
   * session without any guest interaction. Used AT MOST once per action —
   * never a refresh loop.
   */
  const recoverExpiredSession = useCallback(async (): Promise<TableSession | null> => {
    const binding = readTableBinding();
    if (!binding?.qrToken || !currentRestaurant?.slug) return null;
    const res = await api.createTableSession(binding.qrToken, currentRestaurant.slug);
    if (res.success && res.data) {
      setCurrentTableSession(res.data.session);
      setActiveTableId(res.data.table.id);
      setActiveTableNumber(res.data.table.tableNumber);
      writeTableBinding({
        restaurantId: res.data.restaurant.id,
        tableId: res.data.table.id,
        tableNumber: res.data.table.tableNumber,
        qrToken: binding.qrToken,
        sessionId: res.data.session.id,
        sessionToken: res.data.session.sessionToken,
      });
      return res.data.session;
    }
    return null;
  }, [currentRestaurant?.slug]);

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

      const orderItems: OrderItem[] = cartItems.map((c) => {
        const sizeOption =
          typeof c.options.size === 'object'
            ? c.options.size
            : typeof c.options.selectedSize === 'object'
              ? c.options.selectedSize
              : undefined;
        const addOnOptions = (c.options.selectedAddOns || []).filter(
          (a): a is ProductAddOn => typeof a === 'object' && !!a
        );
        return {
          id: '',
          productId: c.productId || c.product?.id || '',
          productName: c.product?.name || c.productName || '',
          productNameEn: c.product?.nameEn || c.productNameEn || undefined,
          productImage: c.product?.image || c.productImage || undefined,
          quantity: c.quantity,
          unitPrice: c.unitPrice || c.product?.price || 0,
          totalPrice: c.totalPrice || c.itemTotal || 0,
          selectedSize: typeof c.options.size === 'object' ? c.options.size.name : c.options.size,
          // Variant IDs for server-side pricing (names are display-only).
          selectedSizeId: sizeOption?.id || undefined,
          selectedAddOnIds: addOnOptions.map((a) => a.id).filter(Boolean),
          selectedAddOns: (c.options.selectedAddOns || []).map((a: any) =>
            typeof a === 'object' ? `${a.name} (+${currentRestaurant.currency}${a.price})` : String(a)
          ),
          removedIngredients: c.options.removedIngredients,
          specialInstructions: c.options.specialInstructions || c.options.notes,
        };
      });

      const fingerprint = JSON.stringify({
        restaurantId: currentRestaurant.id,
        tableId: activeTableId,
        sessionId: currentTableSession.id,
        items: orderItems,
        notes: notes || '',
      });
      if (orderSubmissionRef.current?.fingerprint !== fingerprint) {
        orderSubmissionRef.current = { fingerprint, clientRequestId: newClientRequestId() };
      }

      let res = await api.submitOrder({
        restaurantId: currentRestaurant.id,
        tableId: activeTableId,
        sessionToken: currentTableSession.sessionToken,
        clientRequestId: orderSubmissionRef.current.clientRequestId,
        items: orderItems,
        notes,
      });

      // Session expired while the guest was browsing? Recover silently once.
      if (!res.success && res.statusCode === 403) {
        const fresh = await recoverExpiredSession();
        if (fresh?.sessionToken) {
          res = await api.submitOrder({
            restaurantId: currentRestaurant.id,
            tableId: activeTableId,
            sessionToken: fresh.sessionToken,
            clientRequestId: orderSubmissionRef.current!.clientRequestId,
            items: orderItems,
            notes,
          });
        }
      }

      if (res.success && res.data) {
        orderSubmissionRef.current = null;
        clearCart();
        refreshTenantData();
        soundFX.playChime();
        setIsCartOpen(false);
        setIsOrderTrackingOpen(true);
        // F-03 (UX-Audit): Open OrderTrackingDrawer only. Do NOT auto-open TransferPaymentModal.
        // The transfer form is opened on demand from inside the tracking drawer.
        // setPaymentStepOrder(res.data.order);
        showToast(
          'info',
          'تم إرسال طلبك، يرجى تأكيد عملية الدفع لإتمام الطلب.',
          'طلبك بانتظار تأكيد الدفع لبدء التحضير. هل ستدفع بتحويل بنكي أو محفظة؟ يمكنك إرسال إشعار التحويل من شاشة التتبع، أو الدفع نقداً لدى الكاشير.'
        );
        return { success: true, order: res.data.order };
      }

      showToast('error', 'تعذر إرسال الطلب', res.error || 'حدث خطأ في الخادم');
      return { success: false, error: res.error || 'تعذر إرسال الطلب' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, activeTableId, currentTableSession, cartItems, cartSubtotal, clearCart, refreshTenantData, showToast, recoverExpiredSession]
  );

  // Transfer payment proof: the guest's own device uploads the receipt for one
  // of its orders. The server re-derives tenant/table/session and the amount —
  // this call only carries the file, the guest identity (name + mobile, both
  // required so the cashier can attribute the transfer) and the QR session.
  const submitTransferPaymentProof = useCallback(
    async (
      orderId: string,
      details: { customerName: string; phone: string; channel?: TransferChannel },
      file: File | Blob,
      onProgress?: (percent: number) => void,
      fileName?: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!currentRestaurant) return { success: false, error: 'المطعم غير محدد' };
      if (!activeTableId || !currentTableSession?.sessionToken) {
        return { success: false, error: 'لإرسال إشعار الحوالة يرجى مسح رمز QR الموجود على طاولتك' };
      }
      const res = await api.submitPaymentProof(
        {
          restaurantId: currentRestaurant.id,
          tableId: activeTableId,
          sessionToken: currentTableSession.sessionToken,
          orderId,
          customerName: details.customerName.trim(),
          phone: details.phone.trim(),
          channel: details.channel,
          file,
          fileName,
        },
        onProgress
      );
      if (res.success) {
        showToast(
          'success',
          'تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع.',
          'بانتظار تأكيد الكاشير — سيبدأ المطبخ بتحضير طلبك فور التأكيد.'
        );
        refreshTenantData();
        return { success: true };
      }
      showToast('error', 'تعذر إرسال إشعار التحويل', res.error || 'حاول مجدداً');
      return { success: false, error: res.error };
    },
    [currentRestaurant, activeTableId, currentTableSession, refreshTenantData, showToast]
  );

  const updateOrderStatus = useCallback(
    async (orderId: string, nextStatus: OrderStatus): Promise<boolean> => {
      if (!currentRestaurant || !currentUser) return false;
      const order = orders.find((item) => item.id === orderId);
      if (!order) return false;
      if (order.status === 'SERVED' && nextStatus !== 'SERVED') {
        // A SERVED bill is not editable — EXCEPT cancellation of an unpaid
        // one (audit H-02): a settled-then-voided or never-paid SERVED order
        // must remain correctable. PAID orders stay non-cancellable client-
        // side exactly as they do server-side.
        const servedCancellation = nextStatus === 'CANCELLED' && order.paymentStatus !== 'PAID';
        if (!servedCancellation) return false;
      }
      const key = `order:${orderId}`;
      if (!beginMutation(key)) return false;
      try {
        const res = await api.updateOrderStatus(currentUser, currentRestaurant.id, orderId, nextStatus);
        if (!res.success) {
          showToast('error', 'تعذر تحديث حالة الطلب', `${res.error || 'لم يقبل الخادم التغيير'}. بقيت الحالة كما كانت ويمكنك المحاولة مجدداً.`);
          return false;
        }
        await refreshTenantData();
        soundFX.playTap();
        if (nextStatus === 'READY') soundFX.playBell();
        showToast('success', 'تم تحديث حالة الطلب', `تم تأكيد الحالة الجديدة للطلب ${orderId}.`);
        return true;
      } finally {
        endMutation(key);
      }
    },
    [currentRestaurant, currentUser, orders, refreshTenantData, showToast, beginMutation, endMutation]
  );

  // Staff cancellation (audit H-02): distinct wrapper so the caller passes an
  // optional reason and the toast copy says "إلغاء" — the actual server call
  // is the same guarded status transition the server authorizes.
  const cancelStaffOrder = useCallback(
    async (orderId: string, reason?: string): Promise<boolean> => {
      if (!currentRestaurant || !currentUser) return false;
      const order = orders.find((item) => item.id === orderId);
      if (!order || order.status === 'CANCELLED') return false;
      const key = `order:${orderId}`;
      if (!beginMutation(key)) return false;
      try {
        const res = await api.updateOrderStatus(currentUser, currentRestaurant.id, orderId, 'CANCELLED', {
          reason,
        });
        if (!res.success) {
          showToast('error', 'تعذر إلغاء الطلب', res.error || 'لم يقبل الخادم الإلغاء.');
          return false;
        }
        await refreshTenantData();
        soundFX.playTap();
        showToast('success', 'تم إلغاء الطلب', `تم إلغاء الطلب ${orderId} بنجاح — لا يُحتسب ضمن الإيراد.`);
        return true;
      } finally {
        endMutation(key);
      }
    },
    [currentRestaurant, currentUser, orders, refreshTenantData, showToast, beginMutation, endMutation]
  );

  // Payment void (audit H-02): reverse a ledger receipt; the covered orders
  // return to UNPAID (collectable again, or cancellable afterwards).
  const voidStaffPayment = useCallback(
    async (
      paymentId: string,
      reason?: string,
      stepUpToken?: string
    ): Promise<boolean> => {
      if (!currentRestaurant || !currentUser) return false;
      const key = `payment:${paymentId}`;
      if (!beginMutation(key)) return false;
      try {
        const res = await api.voidPayment(
          currentUser,
          currentRestaurant.id,
          paymentId,
          reason,
          stepUpToken
        );
        if (!res.success) {
          showToast(
            'error',
            res.statusCode === 403 ? 'يلزم تأكيد الهوية' : 'تعذر إلغاء الإيصال',
            res.statusCode === 403
              ? 'أدخل كلمة المرور أو رمز PIN لتأكيد إلغاء الإيصال.'
              : res.error || 'لم يقبل الخادم الإلغاء.'
          );
          return false;
        }
        await refreshTenantData();
        soundFX.playTap();
        const reverted = res.data?.revertedOrders ?? 0;
        showToast(
          'success',
          res.data?.alreadyVoided ? 'الإيصال ملغٍ مسبقاً' : 'تم إلغاء الإيصال',
          res.data?.alreadyVoided
            ? 'كان هذا الإيصال ملغى من قبل — لم يتغير شيء.'
            : `عاد ${reverted} طلبًا إلى غير مدفوع — يمكن تحصيلها مجددًا أو إلغاؤها.`
        );
        return true;
      } finally {
        endMutation(key);
      }
    },
    [currentRestaurant, currentUser, refreshTenantData, showToast, beginMutation, endMutation]
  );

  const cancelCustomerOrder = useCallback(
    async (orderId: string): Promise<{ success: boolean; message: string }> => {
      if (!currentRestaurant) return { success: false, message: 'المطعم غير محدد' };
      let res = await api.cancelOrder(currentRestaurant.id, orderId, currentTableSession?.sessionToken);
      if (!res.success && res.statusCode === 403) {
        const fresh = await recoverExpiredSession();
        if (fresh?.sessionToken) {
          res = await api.cancelOrder(currentRestaurant.id, orderId, fresh.sessionToken);
        }
      }
      if (res.success) {
        refreshTenantData();
        showToast('info', 'تم إلغاء الطلب', `تم إلغاء الطلب ${orderId} بنجاح.`);
        return { success: true, message: 'تم إلغاء الطلب بنجاح.' };
      }
      showToast('error', 'تعذر إلغاء الطلب', res.error);
      return { success: false, message: res.error || 'تعذر إلغاء الطلب' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentTableSession, refreshTenantData, showToast, recoverExpiredSession]
  );

  const editCustomerOrderNotes = useCallback(
    async (orderId: string, notes: string): Promise<{ success: boolean; message: string }> => {
      if (!currentRestaurant) return { success: false, message: 'المطعم غير محدد' };
      let res = await api.updateOrderNotes(currentRestaurant.id, orderId, notes, currentTableSession?.sessionToken);
      if (!res.success && res.statusCode === 403) {
        const fresh = await recoverExpiredSession();
        if (fresh?.sessionToken) {
          res = await api.updateOrderNotes(currentRestaurant.id, orderId, notes, fresh.sessionToken);
        }
      }
      if (res.success) {
        refreshTenantData();
        showToast('success', 'تم حفظ التعديلات');
        return { success: true, message: 'تم تحديث الملاحظات بنجاح.' };
      }
      showToast('error', 'تعذر تعديل الطلب', res.error);
      return { success: false, message: res.error || 'تعذر تعديل الطلب' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentTableSession, refreshTenantData, showToast, recoverExpiredSession]
  );

  const updateTableStatus = useCallback(
    async (tableId: string, status: RestaurantTable['status']): Promise<boolean> => {
      if (!currentRestaurant || !currentUser || !tables.some((table) => table.id === tableId)) return false;
      const key = `table:${tableId}`;
      if (!beginMutation(key)) return false;
      try {
        const res = await api.updateTableStatus(currentRestaurant.id, tableId, status);
        if (!res.success) {
          showToast('error', 'تعذر تحديث الطاولة', `${res.error || 'لم يقبل الخادم التغيير'}. بقيت الحالة كما كانت.`);
          return false;
        }
        await refreshTenantData();
        showToast('success', 'تم تحديث حالة الطاولة');
        return true;
      } finally {
        endMutation(key);
      }
    },
    [currentRestaurant, currentUser, tables, refreshTenantData, showToast, beginMutation, endMutation]
  );

  const settleTableAndFree = useCallback(
    (tableId: string) => {
      if (!currentRestaurant || !currentUser) return;
      void api.settleTableBill(currentUser, currentRestaurant.id, tableId).then((res) => {
        if (res.success) {
          refreshTenantData();
          soundFX.playChime();
          // Show the table number printed on the QR card, never the raw ID.
          const tableLabel = resolveTableDisplayNumber(tables, tableId) || tableId;
          showToast('success', `تمت تصفية طاولة ${tableLabel}`, 'تم دفع الحساب وإعادة الطاولة إلى حالة المتاحة.');
        } else {
          showToast('error', 'تعذر تصفية الطاولة', res.error);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, currentUser, tables, refreshTenantData, showToast]
  );

  const callWaiter = useCallback(
    async (reasonOrTableId: WaiterRequest['reason'] | string, maybeReason?: WaiterRequest['reason'] | string, customText?: string): Promise<{ success: boolean; error?: string }> => {
      if (!currentRestaurant) return { success: false, error: 'المطعم غير محدد' };
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

      if (!targetTableId) return { success: false, error: 'لا توجد طاولة نشطة' };

      let res = await api.callWaiter(
        currentRestaurant.id,
        targetTableId,
        targetReason,
        targetText,
        currentTableSession?.sessionToken
      );
      if (!res.success && res.statusCode === 403) {
        const fresh = await recoverExpiredSession();
        if (fresh?.sessionToken) {
          res = await api.callWaiter(currentRestaurant.id, targetTableId, targetReason, targetText, fresh.sessionToken);
        }
      }
      if (res.success && res.data?.waiterRequest) {
        // Public catalog refreshes do not include waiter requests. Keep the
        // accepted request locally so the guest immediately sees a persistent
        // pending/acknowledged state and cannot accidentally submit it twice.
        setWaiterRequests((prev) => [
          res.data!.waiterRequest,
          ...prev.filter((request) => request.id !== res.data!.waiterRequest.id),
        ]);
        refreshTenantData();
        soundFX.playBell();
        showToast('success', 'تم استدعاء طاقم الضيافة', `تم إرسال طلبك إلى طاقم ${currentRestaurant.name}. يمكنك متابعة حالته من نافذة النداء.`);
        return { success: true };
      }

      const error = res.error || 'تعذر إرسال النداء';
      showToast('error', 'تعذر إرسال النداء', `${error} لم يتم تسجيل طلب جديد؛ يمكنك المحاولة مرة أخرى.`);
      return { success: false, error };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRestaurant, activeTableId, currentTableSession, refreshTenantData, showToast, recoverExpiredSession]
  );

  const updateWaiterRequest = useCallback(
    async (requestId: string, status: 'ACKNOWLEDGED' | 'RESOLVED'): Promise<boolean> => {
      if (!currentRestaurant || !currentUser) return false;
      const key = `waiter:${requestId}`;
      if (!beginMutation(key)) return false;
      try {
        const res = await api.updateWaiterRequestStatus(currentUser, currentRestaurant.id, requestId, status);
        if (!res.success) {
          showToast('error', 'تعذر تحديث النداء', `${res.error || 'لم يقبل الخادم التغيير'}. بقي النداء في حالته السابقة.`);
          return false;
        }
        await refreshTenantData();
        showToast('success', status === 'ACKNOWLEDGED' ? 'تم استلام النداء' : 'تم إنجاز طلب الضيف');
        return true;
      } finally {
        endMutation(key);
      }
    },
    [currentRestaurant, currentUser, refreshTenantData, showToast, beginMutation, endMutation]
  );

  const resolveWaiterRequest = useCallback(
    (requestId: string) => updateWaiterRequest(requestId, 'RESOLVED'),
    [updateWaiterRequest]
  );
  const acknowledgeWaiterRequest = useCallback(
    (requestId: string) => updateWaiterRequest(requestId, 'ACKNOWLEDGED'),
    [updateWaiterRequest]
  );

  const toggleProductStock = useCallback(
    async (productId: string): Promise<boolean> => {
      if (!currentRestaurant) return false;
      const key = `product:${productId}`;
      if (!beginMutation(key)) return false;
      try {
        const res = await api.toggleProductStock(currentRestaurant.id, productId);
        if (!res.success) {
          showToast('error', 'تعذر تحديث حالة المخزون', `${res.error || 'لم يقبل الخادم التغيير'}. بقيت حالة الطبق كما كانت.`);
          return false;
        }
        await refreshTenantData();
        const product = products.find((item) => item.id === productId);
        const nowAvailable = res.data?.product.isAvailable;
        showToast(
          nowAvailable === false ? 'warning' : 'success',
          nowAvailable === false ? 'تم تحويل الطبق إلى غير متوفر (نفد المخزون)' : 'الطبق متوفر الآن',
          product?.name
        );
        return true;
      } finally { endMutation(key); }
    },
    [currentRestaurant, products, refreshTenantData, showToast, beginMutation, endMutation]
  );

  const toggleProductAvailability = toggleProductStock;

  const addProduct = useCallback(
    async (product: Omit<Product, 'id' | 'restaurantId'>): Promise<boolean> => {
      if (!currentRestaurant || !currentUser) return false;
      const key = 'product:new';
      if (!beginMutation(key)) return false;
      const newProduct: Product = { ...product, id: `prod-${Date.now()}`, restaurantId: currentRestaurant.id };
      try {
        const res = await api.saveProduct(currentUser, currentRestaurant.id, newProduct);
        if (!res.success) {
          showToast('error', 'تعذر إضافة الطبق', `${res.error || 'لم يتم الحفظ'}. بقيت بياناتك في النموذج.`);
          return false;
        }
        await refreshTenantData();
        showToast('success', 'تمت إضافة طبق جديد للقائمة', newProduct.name);
        return true;
      } finally { endMutation(key); }
    },
    [currentRestaurant, currentUser, refreshTenantData, showToast, beginMutation, endMutation]
  );

  const updateProduct = useCallback(
    async (product: Product): Promise<boolean> => {
      if (!currentRestaurant || !currentUser) return false;
      const key = `product:${product.id}`;
      if (!beginMutation(key)) return false;
      try {
        const res = await api.saveProduct(currentUser, currentRestaurant.id, { ...product, restaurantId: currentRestaurant.id });
        if (!res.success) {
          showToast('error', 'تعذر تعديل الطبق', `${res.error || 'لم يتم الحفظ'}. بقيت بياناتك في النموذج.`);
          return false;
        }
        await refreshTenantData();
        showToast('success', 'تم تعديل بيانات الطبق', product.name);
        return true;
      } finally { endMutation(key); }
    },
    [currentRestaurant, currentUser, refreshTenantData, showToast, beginMutation, endMutation]
  );

  const deleteProduct = useCallback(
    async (productId: string): Promise<boolean> => {
      if (!currentRestaurant || !currentUser) return false;
      const key = `product:${productId}`;
      if (!beginMutation(key)) return false;
      try {
        const res = await api.deleteManagerProduct(currentUser, currentRestaurant.id, productId);
        if (!res.success) {
          showToast('error', 'تعذر حذف الطبق', `${res.error || 'لم يتم الحذف'}. بقي الطبق في القائمة.`);
          return false;
        }
        await refreshTenantData();
        showToast('info', 'تم حذف الطبق من القائمة');
        return true;
      } finally { endMutation(key); }
    },
    [currentRestaurant, currentUser, refreshTenantData, showToast, beginMutation, endMutation]
  );

  const addCategory = useCallback(
    async (name: string, nameEn?: string): Promise<boolean> => {
      if (!currentRestaurant || !currentUser) return false;
      const key = 'category:new';
      if (!beginMutation(key)) return false;
      const newCat: Category = {
        id: `cat-${Date.now()}`,
        restaurantId: currentRestaurant.id,
        name,
        nameEn,
        sortOrder: categories.length + 1,
      };
      try {
        const res = await api.saveCategory(currentUser, currentRestaurant.id, newCat);
        if (!res.success) {
          showToast('error', 'تعذر إضافة التصنيف', `${res.error || 'لم يتم الحفظ'}. بقي الاسم في النموذج.`);
          return false;
        }
        await refreshTenantData();
        showToast('success', 'تمت إضافة تصنيف جديد', name);
        return true;
      } finally { endMutation(key); }
    },
    [currentRestaurant, currentUser, categories, refreshTenantData, showToast, beginMutation, endMutation]
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
    async (offer: Omit<Offer, 'id' | 'restaurantId'>): Promise<boolean> => {
      if (!currentRestaurant) return false;
      const key = 'offer:new';
      if (!beginMutation(key)) return false;
      try {
        const res = await api.saveOffer(currentRestaurant.id, offer);
        if (!res.success) {
          showToast('error', 'تعذر نشر العرض', `${res.error || 'لم يتم الحفظ'}. بقيت بياناتك في النموذج.`);
          return false;
        }
        await refreshTenantData();
        showToast('success', 'تم نشر العرض الترويجي', offer.title);
        return true;
      } finally { endMutation(key); }
    },
    [currentRestaurant, refreshTenantData, showToast, beginMutation, endMutation]
  );

  const deleteOffer = useCallback(
    async (offerId: string): Promise<boolean> => {
      if (!currentRestaurant) return false;
      const key = `offer:${offerId}`;
      if (!beginMutation(key)) return false;
      try {
        const res = await api.deleteOffer(currentRestaurant.id, offerId);
        if (!res.success) {
          showToast('error', 'تعذر حذف العرض', res.error);
          return false;
        }
        await refreshTenantData();
        showToast('info', 'تم حذف العرض الترويجي');
        return true;
      } finally { endMutation(key); }
    },
    [currentRestaurant, refreshTenantData, showToast, beginMutation, endMutation]
  );

  return (
    <RestaurantContext.Provider
      value={{
        currentRestaurant,
        setCurrentRestaurant: updateCurrentRestaurant,
        availableRestaurants,
        tenantsList: availableRestaurants,
        currentUser,
        setCurrentUser: authSetCurrentUser,
        checkEntitlement,
        hasEntitlement,
        viewMode,
        setViewMode,
        displayMode,
        selectedCategoryId,
        setSelectedCategoryId,
        searchQuery,
        setSearchQuery,
        isOnboardingOpen,
        setIsOnboardingOpen,
        soundEnabled,
        toggleSound,
        refreshTenantData,
        tenantDataStatus,
        activeTableId,
        setActiveTableId,
        activeTableNumber,
        setActiveTableNumber,
        activeTable,
        currentTableSession,
        entryPhase,
        entryInvalidReason,
        retryEntry,
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
        orderAwaitingPayment,
        dismissPaymentStep,
        submitTransferPaymentProof,
        cancelCustomerOrder,
        editCustomerOrderNotes,
        callWaiter,
        activeTableOrders,
        updateOrderStatus,
        cancelStaffOrder,
        voidStaffPayment,
        updateTableStatus,
        isMutationPending,
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
