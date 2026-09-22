// Multi-Tenant SaaS Restaurant Platform Domain Model

export type TenantRole = 'PLATFORM_ADMIN' | 'SUPER_ADMIN' | 'RESTAURANT_MANAGER' | 'STAFF' | 'GUEST' | 'WAITER' | 'CASHIER' | 'KITCHEN';
export type RestaurantStatus = 'ACTIVE' | 'SUSPENDED' | 'ONBOARDING' | 'MAINTENANCE';
/** Kind of venue. Decides how the guest QR experience is composed. */
export type BusinessType = 'RESTAURANT' | 'CAFE' | 'BAKERY';
export type SubscriptionStatus = 'ACTIVE' | 'TRIAL' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED';
export type OrderStatus = 'PENDING' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';

/**
 * Fulfillment gate — the payment authorization boundary of an order.
 *
 *   AWAITING_PAYMENT             guest submitted the order, no payment info yet
 *   PAYMENT_VERIFICATION_PENDING a receipt is waiting for the cashier
 *   PAYMENT_REJECTED             the cashier refused the receipt (guest must act)
 *   RELEASED                     payment verified → the restaurant may execute it
 *
 * Only RELEASED orders appear on the operational screens (KDS / live floor) and
 * only they may be advanced by the service API.
 */
export type FulfillmentState =
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_VERIFICATION_PENDING'
  | 'PAYMENT_REJECTED'
  | 'RELEASED';
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

/**
 * Customer transfer payment details — the venue's RECEIVING account, configured
 * in Restaurant Settings and shown to the guest inside the transfer modal.
 *
 * This is the mirror image of the guest's transfer proof (`PaymentProof*`):
 * the proof says "I paid", these details say "pay HERE". Per channel, matching
 * `TransferChannel`:
 *   BANK   → bankName + bankAccount (IBAN / account number) + bankAccountHolder
 *   WALLET → walletName + walletNumber (wallet phone OR account id) + walletAccountHolder
 *   both   → instructions (optional)
 *
 * Every field is optional and every value is DISPLAY-ONLY: none of them is sent
 * back to the server, none of them is read by the settlement path, the
 * fulfillment gate, the Payment ledger or the cashier's verify/reject decision.
 * A missing field means "this venue did not fill it in" — the UI must show a
 * safe fallback, never an empty card, "undefined" or an invented number.
 */
export interface RestaurantTransferDetails {
  bankName?: string;
  bankAccount?: string;
  bankAccountHolder?: string;
  walletName?: string;
  walletNumber?: string;
  walletAccountHolder?: string;
  instructions?: string;
}

/**
 * The venue's own public contact channels, configured in
 * «الإعدادات ← التواصل والحجز» and read from a single source (the Restaurant
 * row). Every field is optional: `undefined` means "this venue did not publish
 * it", and the UI hides the channel entirely — no empty icon, no dead link.
 *
 * Values are validated server-side (HTTPS only, credential-free, and a
 * per-platform host allowlist — see server/utils/contactChannels.ts), so the
 * client may render them as an `href` after its own light re-check.
 */
export interface RestaurantSocials {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  youtube?: string;
  website?: string;
}

// ============================================
// Central Theme Management — Branding & Menu Appearance
// ============================================
export type ThemeMode = 'light' | 'dark' | 'auto';
export type BackgroundType = 'solid' | 'gradient' | 'image' | 'image+overlay';
export type BackgroundSize = 'cover' | 'contain' | 'auto';
export type BackgroundPosition = 'center' | 'top' | 'bottom' | 'left' | 'right';
/**
 * Exactly the faces the server contract persists (`THEME_FONT_KEYS`). The
 * picker must not offer anything outside this set: the fonts are only ever
 * loaded for these families, and an unsupported key would be rejected by the
 * strict `themeConfigSchema` on save.
 *
 * Curated set (Arabic typography system):
 *   auto/tajawal/cairo/amiri/cormorant  — the original five;
 *   alexandria                          — variable (100–900) Arabic-first body face;
 *   kufi                                — Noto Kufi Arabic display face.
 */
export type ThemeFontKey = 'auto' | 'tajawal' | 'cairo' | 'amiri' | 'cormorant' | 'alexandria' | 'kufi';

export interface BackgroundImageRef {
  storagePath: string;
  aiGenerated?: boolean;
}

export interface BackgroundConfig {
  type: BackgroundType;
  color?: string;
  gradient?: string;
  image?: BackgroundImageRef;
  overlayColor?: string;
  overlayOpacity?: number;
  blur?: number;
  position?: BackgroundPosition;
  size?: BackgroundSize;
  readabilityBoost?: boolean;
}

/**
 * Per-component colour groups — the optional `colors.button/card/badge/category`
 * sub-objects of the server contract (validated by `themeColorsSchema`). They
 * are explicit overrides layered on top of the derived `--brand-*` palette and
 * must survive the API → frontend mapping untouched.
 */
export interface ThemeButtonColors {
  primaryBg?: string;
  primaryText?: string;
  secondaryBg?: string;
  secondaryText?: string;
}

export interface ThemeCardColors {
  bg?: string;
  border?: string;
  shadow?: string;
  radius?: string;
}

export interface ThemeBadgeColors {
  bg?: string;
  text?: string;
}

export interface ThemeCategoryColors {
  bg?: string;
  text?: string;
  activeBg?: string;
  activeText?: string;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  button?: ThemeButtonColors;
  card?: ThemeCardColors;
  badge?: ThemeBadgeColors;
  category?: ThemeCategoryColors;
}

export interface ThemeRadius {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  full: string;
}

export interface ThemeShadows {
  sm: string;
  md: string;
  lg: string;
}

export interface ThemeTypography {
  fontFamily: ThemeFontKey;
  /**
   * Optional heading face ("خط العناوين"). Absent (or 'auto') means
   * "same as body" — the derivation resolves it to the `fontFamily` stack,
   * so stored themes need no migration.
   */
  headingFont?: ThemeFontKey;
  headingWeight: string;
  bodyWeight: string;
}

/**
 * Card-specific overrides (server: `colors.card.radius` / `colors.card.shadow`).
 * Both fields are OPTIONAL — when absent the runtime derives the card radius
 * from `radius.lg` and the card shadow from `shadows.md`. `shadow` accepts a
 * shadow-scale key (`sm` | `md` | `lg`) or a raw CSS shadow string; it is
 * always resolved to a real CSS value before it reaches `--card-shadow`.
 */
export interface ThemeCardStyle {
  radius?: string;
  shadow?: string;
}

export interface ThemeConfig {
  mode?: ThemeMode;
  colors?: ThemeColors;
  radius?: ThemeRadius;
  shadows?: ThemeShadows;
  typography?: ThemeTypography;
  cards?: ThemeCardStyle;
  background?: {
    light?: BackgroundConfig;
    dark?: BackgroundConfig;
  };
}

export interface ResolvedBackground {
  type: BackgroundType;
  color?: string;
  gradient?: string;
  url?: string | null;
  storagePath?: string | null;
  aiGenerated?: boolean;
  overlayColor?: string;
  overlayOpacity?: number;
  blur?: number;
  position?: BackgroundPosition;
  size?: BackgroundSize;
  readabilityBoost?: boolean;
}

export interface EffectiveTheme {
  mode: ThemeMode;
  colors: ThemeColors;
  radius: ThemeRadius;
  shadows: ThemeShadows;
  typography: ThemeTypography;
  cards: ThemeCardStyle;
  background: {
    light: ResolvedBackground;
    dark: ResolvedBackground;
  };
  source: 'branch' | 'restaurant' | 'platform' | 'fallback';
  rawConfig: ThemeConfig;
}

export interface ThemeRow {
  id: string;
  restaurantId?: string | null;
  branchId?: string | null;
  config: ThemeConfig;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================
// Display screen (شاشة العرض — read-only signage board)
// ============================================
/**
 * What sits behind the menu on the read-only board:
 *   theme → the venue's own brand canvas (the ambient brand field), the default;
 *   image → a photograph the venue uploaded ("خلفية صورة").
 * A venue that picked `image` but uploaded nothing falls back to `theme`.
 */
export type DisplayBackgroundMode = 'theme' | 'image';

/**
 * The display face of the board. `auto` keeps the derived identity (the
 * `resolveLiveProfile()` choice from the venue's own colours/photography);
 * every other key is an explicit font the venue picked in
 * «الإعدادات ← شاشة العرض».
 */
export type DisplayFontKey = 'auto' | 'tajawal' | 'cairo' | 'amiri' | 'cormorant';

/**
 * The venue's display-screen settings — edited once in the manager's
 * «شاشة العرض» section and applied on every screen that opens the board
 * (`/r/{slug}?view=display`), on the TV as well as on the phone/tablet static
 * preview. Additive and optional: absent on tenants that configured nothing
 * and on legacy/cached payloads, where the board keeps its existing look.
 */
export interface RestaurantDisplaySettings {
  backgroundMode: DisplayBackgroundMode;
  /** Renderable URL of the backdrop photo (resolved server-side). */
  backgroundImage?: string;
  /** Stable storage path persisted for the backdrop (additive). */
  backgroundStoragePath?: string;
  font: DisplayFontKey;
}

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
  /**
   * Customer transfer payment details (bank / wallet receiving account shown in
   * the guest transfer modal). Additive and optional: absent on tenants that
   * configured nothing and on legacy/cached payloads.
   */
  transfer?: RestaurantTransferDetails;
  /**
   * Public social profiles published by the venue (guest menu
   * «تواصل معنا»). Additive and optional: `undefined` when the venue published
   * nothing and on legacy/cached payloads.
   */
  socials?: RestaurantSocials;
  /**
   * The venue's WhatsApp number in canonical E.164 (`+` + digits). Powers the
   * ONE interaction the read-only Live Menu offers — «احجز طاولتك» composes a
   * reservation request and opens WhatsApp with it. `undefined` means the
   * venue has no reservation channel, so the CTA is not rendered at all.
   */
  whatsappNumber?: string;
  /**
   * شاشة العرض (read-only board) settings: the background source and the
   * display face. Additive and optional: `undefined` means "nothing was
   * configured", so the board renders exactly as it did before this setting
   * existed (themed brand canvas + derived identity font).
   */
  display?: RestaurantDisplaySettings;
  theme?: EffectiveTheme;
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
  // Email: managers/platform only (nullable for shift staff — they use
  // restaurant code + username + 6-digit PIN, no synthetic emails).
  email: string | null;
  // Shift-staff login identifier, unique per restaurant (nullable for managers).
  username?: string | null;
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
  /**
   * Payment gate. Absent only on legacy payloads — the shared helper
   * `isOrderOperational()` treats a missing value as RELEASED (pre-gate
   * behaviour), never as held.
   */
  fulfillmentState?: FulfillmentState;
  /** Server-derived predicate for `fulfillmentState === 'RELEASED'`. */
  operational?: boolean;
  /** When the gate opened (payment verified / collected). */
  releasedAt?: string;
  // Transfer-receipt state (never the private storage path or the guest phone:
  // those stay server-side and are only exposed by the cashier queue).
  hasPaymentProof?: boolean;
  paymentRejected?: boolean;
  paymentRejectedReason?: string;
  paymentRejectedAt?: string;
  /** Staff cancellation markers (audit H-02): when/why a cashier or manager cancelled the order. */
  cancelledAt?: string;
  cancelReason?: string;
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
  /** WAITING_RECEIPT = nothing to confirm yet; WAITING_VERIFICATION = receipt attached. */
  state?: 'WAITING_RECEIPT' | 'WAITING_VERIFICATION';
  fulfillmentState?: FulfillmentState;
  paymentRejected?: boolean;
  paymentRejectedReason?: string;
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
  /** Void marker (audit H-02): a voided receipt stays in the ledger — it is flagged, never deleted. */
  voidedAt?: string;
  voidReason?: string;
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
