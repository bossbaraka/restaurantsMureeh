// Multi-Tenant SaaS Restaurant Platform Domain Model

export type TenantRole = 'PLATFORM_ADMIN' | 'SUPER_ADMIN' | 'RESTAURANT_MANAGER' | 'STAFF' | 'GUEST' | 'WAITER' | 'CASHIER' | 'KITCHEN';
export type RestaurantStatus = 'ACTIVE' | 'SUSPENDED' | 'ONBOARDING' | 'MAINTENANCE';
/** Kind of venue. Decides how the guest QR experience is composed. */
export type BusinessType = 'RESTAURANT' | 'CAFE' | 'BAKERY';
export type SubscriptionStatus = 'ACTIVE' | 'TRIAL' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED';
export type OrderStatus = 'PENDING' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'BILL_REQUESTED' | 'RESERVED' | 'MAINTENANCE';
export type TableZone = 'MAIN_HALL' | 'TERRACE' | 'VIP_LOUNGE' | 'GARDEN';
export type WaiterCallReason = 'ASSISTANCE' | 'WATER_REFILL' | 'CLEANING' | 'EXTRA_CUTLERY' | 'BILL' | 'WATER' | string;
export type WaiterRequestStatus = 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED' | 'CANCELLED';

// Plan Entitlement Matrix Keys
export type EntitlementKey =
  | 'CAN_USE_ANALYTICS'
  | 'CAN_CUSTOM_BRANDING'
  | 'CAN_CREATE_BRANCH'
  | 'CAN_USE_ADVANCED_FEATURES'
  | 'CAN_EXPORT_REPORTS'
  | 'CAN_PRIORITY_SUPPORT'
  | 'CAN_USE_CUSTOM_DOMAIN';

// Restaurant / Tenant Entity
export interface Restaurant {
  id: string;
  name: string;
  nameEn: string;
  slug: string;
  /** Renderable logo URL (resolved server-side from the stored reference). */
  logo: string;
  /**
   * Stable storage path persisted in PostgreSQL for the logo
   * (`restaurants/{tenant}/{folder}/{uuid}{ext}`) — the `{ storagePath, url }`
   * persistence pair; additive, absent on legacy payloads.
   */
  logoStoragePath?: string;
  /** Logo framing: 'cover' (crop-to-fill) or 'contain' (fit whole logo). */
  logoFit?: 'cover' | 'contain';
  /** Logo anchor inside its box, as a CSS object-position value (e.g. '50% 50%'). */
  logoPosition?: string;
  /** Renderable cover URL (resolved server-side from the stored reference). */
  coverImage?: string;
  /** Stable storage path persisted for the cover image (additive). */
  coverStoragePath?: string;
  description: string;
  phone: string;
  address: string;
  latitude?: number;
  longitude?: number;
  mapUrl?: string;
  mapImageUrl?: string;
  /** Stable storage path persisted for the map image (additive). */
  mapStoragePath?: string;
  currency: string;
  language: 'ar' | 'en';
  timezone: string;
  status: RestaurantStatus;
  /**
   * Kind of venue. Optional in the client type because cached/older API
   * payloads predate the column; the DB column itself is NOT NULL with a
   * RESTAURANT default, so consumers may rely on a value being present.
   */
  businessType?: BusinessType;
  primaryColor: string;
  accentColor: string;
  promoVideoUrl?: string;
  galleryImages?: string[];
  /** Stable storage paths persisted for each gallery image (additive). */
  galleryStoragePaths?: string[];
  planId: string;
  customDomain?: string;
  createdAt: string;
  updatedAt: string;
}

// User Profile & Authentication (Manager / Super Admin)
export interface RestaurantUser {
  id: string;
  restaurantId: string | null; // null if Super Admin / Platform Admin
  name: string;
  email: string;
  role: TenantRole;
  token?: string;
  avatar?: string;
  createdAt: string;
}

// SaaS Subscription Plan Definition
export interface Plan {
  id: string;
  name: string;
  nameEn: string;
  priceMonthly: number;
  priceYearly: number;
  maxTables: number;
  maxCategories: number;
  maxProducts: number;
  /** Hard ceiling on physical locations (branches) — bounded, never unlimited. */
  maxBranches: number;
  entitlements: EntitlementKey[];
  description: string;
  isPopular?: boolean;
  /** Free-trial length in days (0 for paid plans). Derived by the server. */
  trialDays?: number;
}

export interface Subscription {
  id: string;
  restaurantId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt?: string;
}

// Anonymous Customer Table Session
export interface TableSession {
  id: string;
  restaurantId: string;
  tableId: string;
  sessionToken: string;
  createdAt: string;
  expiresAt: string;
  status: 'ACTIVE' | 'CLOSED';
}

// Menu Category (Tenant Isolated)
export interface Category {
  id: string;
  restaurantId: string;
  name: string;
  nameEn?: string;
  icon?: string;
  sortOrder: number;
}

// Menu Product / Item (Tenant Isolated)
export interface ProductAddOn {
  id: string;
  name: string;
  nameEn?: string;
  price: number;
  isAvailable?: boolean;
}

export interface ProductSize {
  id: string;
  name: string;
  nameEn?: string;
  price?: number;
  priceModifier?: number;
}

export interface Product {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  nameEn: string;
  description: string;
  price: number;
  image: string;
  isAvailable: boolean;
  isFeatured?: boolean;
  badge?: string;
  sizes?: ProductSize[];
  addOns?: ProductAddOn[];
  ingredients?: string[];
  removableIngredients?: string[];
  allergens?: string[];
  calories?: number;
  preparationTimeMinutes?: number;
}

// Table in Restaurant (Tenant Isolated)
export interface RestaurantTable {
  id: string; // e.g. TABLE-01
  restaurantId: string;
  tableNumber: number;
  capacity: number;
  zone: TableZone;
  status: TableStatus;
  qrToken?: string;
  branchId?: string; // Multi-Branch: optional branch assignment
  activeOrderIds: string[];
  hasWaiterCall: boolean;
  lastActivityAt?: string;
}

// Customer Order Items & Customizations
export interface OrderItem {
  id: string;
  productId: string;
  name?: string;
  nameEn?: string;
  productName?: string;
  productNameEn?: string;
  productImage?: string;
  unitPrice: number;
  quantity: number;
  size?: ProductSize | string;
  selectedSize?: ProductSize | string;
  // Variant selectors trusted by the server: priced from the DB menu.
  selectedSizeId?: string;
  selectedAddOnIds?: string[];
  selectedAddOns?: any[];
  removedIngredients?: string[];
  itemNotes?: string;
  specialInstructions?: string;
  totalPrice: number;
}

export interface CartItemOption {
  size?: ProductSize | string;
  selectedSize?: ProductSize | string;
  selectedAddOns?: ProductAddOn[] | string[];
  removedIngredients?: string[];
  specialInstructions?: string;
  notes?: string;
}

export interface CartItem {
  id: string;
  product?: Product;
  productId?: string;
  productName?: string;
  productNameEn?: string;
  productImage?: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  options: CartItemOption;
  itemTotal?: number;
}

// Order Entity (Tenant Isolated)
export interface Order {
  id: string; // e.g. #1024
  numericId?: number;
  restaurantId: string;
  tableId: string;
  tableNumber?: number;
  tableName?: string;
  sessionId?: string;
  items: OrderItem[];
  subtotal: number;
  tax?: number;
  total: number;
  status: OrderStatus;
  paymentMethod: string; // e.g. 'PAY AT CASHIER' | PaymentMethod
  // POS payment lifecycle:
  //   UNPAID               → collectable at the cashier
  //   PENDING_VERIFICATION → guest uploaded a transfer receipt, cashier decides
  //   PAID                 → settled (settledAt / cashierId)
  paymentStatus?: PaymentStatus;
  settledAt?: string;
  // Transfer-receipt state (never the private storage path or the guest phone:
  // those stay server-side and are only exposed by the cashier queue).
  hasPaymentProof?: boolean;
  paymentRejected?: boolean;
  paymentRejectedReason?: string;
  paymentRejectedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  estimatedPrepMinutes?: number;
}

/**
 * Payment lifecycle of an order. Kept as a string union (the DB column is a
 * TEXT column) so older rows and older clients keep working unchanged.
 */
export type PaymentStatus = 'UNPAID' | 'PENDING_VERIFICATION' | 'PAID';

/**
 * Where the guest says the transfer was sent from. Display-only: it never
 * changes the ledger method (always TRANSFER) or the settlement path.
 */
export type TransferChannel = 'BANK' | 'WALLET';

/** One item of a transfer notice, as the cashier must verify it. */
export interface PaymentVerificationItemLine {
  productName: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  selectedSize?: string;
  selectedAddOns?: string[];
  removedIngredients?: string[];
  specialInstructions?: string;
}

/** One order waiting for a cashier decision on its transfer receipt. */
export interface PaymentVerificationItem {
  orderId: string;
  numericId?: number;
  restaurantId: string;
  branchId?: string;
  tableId: string;
  tableNumber?: number;
  tableName?: string;
  /** Kitchen state: whether confirming releases a fresh ticket or settles. */
  orderStatus?: OrderStatus;
  total: number;
  subtotal: number;
  itemsCount: number;
  itemsSummary?: string;
  /** Full item list so the cashier verifies without a second request. */
  items?: PaymentVerificationItemLine[];
  /** Guest identity on the notice (cashier queue only — never the KDS/POS). */
  customerName?: string;
  customerPhone?: string;
  transferChannel?: TransferChannel;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  hasPaymentProof: boolean;
  submittedAt: string;
  createdAt: string;
}

// ============================================
// 6.1. Cashier / POS Payment System
// ============================================
// TRANSFER is produced only by the cashier's transfer-verification flow (the
// POS input enum deliberately stays cash/card/wallet/split).
export type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE' | 'SPLIT' | 'TRANSFER' | 'PAY AT CASHIER';

// A settled cashier transaction (source of truth for collected revenue)
export interface PaymentRecord {
  id: string;
  receiptNumber: string; // human friendly e.g. RC-000123
  restaurantId: string;
  branchId?: string;
  tableId: string; // real table id or '__WALKIN__' for counter sales
  tableLabel: string; // display label snapshot
  orderIds: string[];
  itemsSummary?: string;
  method: PaymentMethod;
  subtotal: number;
  tax?: number;
  total: number;
  cashReceived?: number;
  changeDue?: number;
  tip?: number;
  cashierId?: string;
  cashierName: string;
  note?: string;
  createdAt: string;
}

// ============================================
// 6.2. Multi-Branch Management
// ============================================
export interface Branch {
  id: string;
  restaurantId: string;
  name: string;
  address?: string;
  phone?: string;
  color?: string;
  isActive: boolean;
  createdAt: string;
}


// Waiter Service Request (Tenant Isolated)
export interface WaiterRequest {
  id: string;
  restaurantId: string;
  tableId: string;
  sessionId?: string;
  reason: WaiterCallReason;
  reasonText?: string;
  createdAt: string;
  status: WaiterRequestStatus;
}

// Promotional Offer Banner
export interface Offer {
  id: string;
  restaurantId: string;
  title: string;
  titleEn?: string;
  subtitle?: string;
  description?: string;
  image?: string;
  originalPrice?: number;
  discountedPrice?: number;
  discountPercentage?: number;
  badge?: string;
  bgGradient?: string;
  isActive: boolean;
  code?: string;
}

// Toast Notification
export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message?: string;
}

// System Audit Logs (Tenant Scoped & Global)
export interface AuditLog {
  id: string;
  restaurantId?: string;
  actor: string;
  actorRole: TenantRole;
  action: string;
  details: string;
  timestamp: string;
}
