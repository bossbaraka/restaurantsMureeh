import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { CartItem, Product } from '../../types/restaurant';
import { useBrandTheme, useEffectiveTheme } from '../../theme/brandTheme';
import { useMenuPreferences } from '../../hooks/useMenuPreferences';
import { CustomerHeader } from './CustomerHeader';
import { CustomerHero } from './CustomerHero';
import { CategoryScrollNav } from './CategoryScrollNav';
import { MenuToolbar, type MenuLayout, type MenuSortKey } from './MenuToolbar';
import { ProductCard } from './ProductCard';
import { ProductDetailModal } from './ProductDetailModal';
import { CartDrawer } from './CartDrawer';
import { OrderTrackingDrawer } from './OrderTrackingDrawer';
import { TransferPaymentModal } from './TransferPaymentModal';
import { WaiterCallModal } from './WaiterCallModal';
import { DirectTableEntryModal } from './DirectTableEntryModal';
import { ActiveOrdersFloatingBar } from './ActiveOrdersFloatingBar';
import { CustomerOrderLiveNotifier } from './CustomerOrderLiveNotifier';
import { CustomerGuideOverlay } from './CustomerGuideOverlay';
import { OrderCompletedModal } from './OrderCompletedModal';
import { CustomerLoadingExperience } from './CustomerLoadingExperience';
import { RestaurantEntryExperience } from './RestaurantEntryExperience';
import { DisplayMenu } from './DisplayMenu';
import { CustomerSocialSection } from './CustomerSocialSection';
import { UtensilsCrossed, AlertTriangle } from 'lucide-react';

/** Cards rendered above the fold get eager loading + network priority. */
const PRIORITY_CARDS = 4;

/**
 * F-04 — "the guest already saw the entry layer in this tab" flag.
 *
 * The flag MUST NOT be keyed by the tenant slug: on the first render after a
 * reload the entry state machine is still running and `currentRestaurant` is
 * `null` (the tenant is only known once the session/catalog request resolves),
 * so a slug-scoped key would be read under the fallback key while the
 * dismissal wrote the real slug — the two could never match and the entry
 * layer replayed on every reload.
 *
 * One stable key gives exactly what the entry layer promises: once per
 * browser tab. Read and write both go through these helpers so the two keys
 * can never drift apart again.
 */
export const WELCOME_SEEN_KEY = 'merar_welcome_seen';

export function hasSeenWelcome(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(WELCOME_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markWelcomeSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(WELCOME_SEEN_KEY, 'true');
  } catch {
    /* storage unavailable — the entry layer simply shows again next reload */
  }
}

interface CartIndexEntry {
  quantity: number;
  lastItem: CartItem;
  /** True when the last line carries no customization, so it can be re-used. */
  lastItemIsPlain: boolean;
}

function isPlainCartLine(item: CartItem, product?: Product): boolean {
  const options = item.options || {};
  const size = (options.size ?? options.selectedSize) as { priceModifier?: number; price?: number } | string | undefined;
  const sizeModifier =
    size && typeof size === 'object' ? Number(size.priceModifier || size.price) || 0 : 0;
  const addOns = Array.isArray(options.selectedAddOns) ? options.selectedAddOns : [];
  const removed = Array.isArray(options.removedIngredients) ? options.removedIngredients : [];
  const basePrice = product?.price ?? item.unitPrice ?? 0;
  return (
    sizeModifier === 0 &&
    addOns.length === 0 &&
    removed.length === 0 &&
    !options.specialInstructions &&
    !options.notes &&
    Math.abs((item.unitPrice || 0) - basePrice) < 0.001
  );
}

const sortProducts = (list: Product[], sort: MenuSortKey): Product[] => {
  if (sort === 'menu') return list;
  const copy = [...list];
  switch (sort) {
    case 'featured':
      // Array#sort is stable: equal keys keep the kitchen's own ordering.
      return copy.sort((a, b) => Number(!!b.isFeatured) - Number(!!a.isFeatured));
    case 'price-asc':
      return copy.sort((a, b) => a.price - b.price);
    case 'price-desc':
      return copy.sort((a, b) => b.price - a.price);
    case 'fastest':
      return copy.sort(
        (a, b) => (a.preparationTimeMinutes ?? 999) - (b.preparationTimeMinutes ?? 999)
      );
    default:
      return copy;
  }
};

export const CustomerLayout: React.FC = () => {
  const {
    products,
    categories,
    selectedCategoryId,
    setSelectedCategoryId,
    searchQuery,
    setSearchQuery,
    cartItems,
    addToCart,
    updateCartItemQuantity,
    currentRestaurant,
    activeTableId,
    setViewMode,
    displayMode,
    entryPhase,
    entryInvalidReason,
    retryEntry,
    orderAwaitingPayment,
    dismissPaymentStep,
  } = useRestaurant();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Tenant palette -> CSS custom properties consumed by the whole menu.
  // Legacy brand tokens for backward compat
  useBrandTheme(currentRestaurant?.primaryColor, currentRestaurant?.accentColor);
  // Central effective theme (Platform→Restaurant→Branch) — applies full vars including background
  useEffectiveTheme(currentRestaurant?.theme);

  const [preferences, updatePreferences] = useMenuPreferences(currentRestaurant?.slug || 'default');
  const { sort, layout, availableOnly } = preferences;

  // Typing in the search box must never block the frame that paints the input.
  const deferredSearch = useDeferredValue(searchQuery);

  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    // Show the entry layer initially once per browser tab — the flag is
    // slug-independent on purpose (see hasSeenWelcome).
    return !hasSeenWelcome();
  });

  // One-shot flag: when the entry experience hands the guest over, the menu
  // below arrives with a single soft fade-up (a pure motion hand-off — the
  // menu's own design is untouched).
  const [menuReveal, setMenuReveal] = useState(false);

  const handleDismissWelcome = () => {
    setShowWelcome(false);
    setMenuReveal(true);
    markWelcomeSeen();
  };

  // Ensure we always have an effective category that contains actual dishes
  const effectiveCategoryId = useMemo(() => {
    if (selectedCategoryId === 'all') return 'all';
    if (selectedCategoryId) {
      const catExists = categories.some((c) => c.id === selectedCategoryId);
      const hasProducts = products.some((p) => p.categoryId === selectedCategoryId);
      if (catExists && hasProducts) {
        return selectedCategoryId;
      }
    }
    // Fallback: pick the first category that actually has dishes
    const firstWithAvailable = categories.find((c) =>
      products.some((p) => p.categoryId === c.id && p.isAvailable !== false)
    );
    if (firstWithAvailable) return firstWithAvailable.id;

    const firstWithAny = categories.find((c) =>
      products.some((p) => p.categoryId === c.id)
    );
    if (firstWithAny) return firstWithAny.id;

    return categories[0]?.id || 'all';
  }, [selectedCategoryId, categories, products]);

  // Keep selectedCategoryId synchronized if it was empty or pointing to an empty category
  useEffect(() => {
    if (categories.length > 0 && products.length > 0) {
      if (!selectedCategoryId || (selectedCategoryId !== 'all' && !products.some((p) => p.categoryId === selectedCategoryId))) {
        if (effectiveCategoryId && effectiveCategoryId !== selectedCategoryId) {
          setSelectedCategoryId(effectiveCategoryId);
        }
      }
    }
  }, [categories, products, selectedCategoryId, effectiveCategoryId, setSelectedCategoryId]);

  // Filter by search query or category, then apply the guest's ordering.
  const scopedProducts = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (query) {
      return products.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.nameEn.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          (p.badge && p.badge.toLowerCase().includes(query))
      );
    }
    if (effectiveCategoryId === 'all' || !effectiveCategoryId) {
      return products;
    }
    return products.filter((p) => p.categoryId === effectiveCategoryId);
  }, [products, effectiveCategoryId, deferredSearch]);

  // If "availableOnly" is active but results in 0 items for this category while dishes exist,
  // automatically relax it so the customer is not greeted with a dead-end screen on opening.
  useEffect(() => {
    if (availableOnly && scopedProducts.length > 0 && scopedProducts.every((p) => p.isAvailable === false)) {
      updatePreferences({ availableOnly: false });
    }
  }, [availableOnly, scopedProducts, updatePreferences]);

  const visibleProducts = useMemo(() => {
    const filtered = availableOnly
      ? scopedProducts.filter((p) => p.isAvailable !== false)
      : scopedProducts;
    return sortProducts(filtered, sort);
  }, [scopedProducts, availableOnly, sort]);

  // One pass over the cart -> per-dish quantity + the line the stepper drives.
  const cartIndex = useMemo(() => {
    const index = new Map<string, CartIndexEntry>();
    for (const item of cartItems) {
      const productId = item.productId || item.product?.id;
      if (!productId) continue;
      const entry = index.get(productId);
      const plain = isPlainCartLine(item, item.product);
      if (entry) {
        entry.quantity += item.quantity;
        entry.lastItem = item;
        entry.lastItemIsPlain = plain;
      } else {
        index.set(productId, {
          quantity: item.quantity,
          lastItem: item,
          lastItemIsPlain: plain,
        });
      }
    }
    return index;
  }, [cartItems]);

  const activeCategoryObj = useMemo(() => {
    if (effectiveCategoryId === 'all') {
      return { id: 'all', name: 'كافة الأطباق والمشروبات', nameEn: 'All Dishes & Drinks', sortOrder: 0 };
    }
    return categories.find((c) => c.id === effectiveCategoryId);
  }, [categories, effectiveCategoryId]);
  const isSearching = deferredSearch.trim().length > 0;

  // The signature dish anchors the grid — only when a grid can give it room.
  const featuredProductId = useMemo(() => {
    if (layout !== 'grid') return undefined;
    return visibleProducts.find((p) => p.isFeatured && p.isAvailable !== false)?.id;
  }, [layout, visibleProducts]);

  const handleSelect = useCallback((product: Product) => {
    setSelectedProduct(product);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedProduct(null);
  }, []);

  const handleQuickAdd = useCallback(
    (product: Product) => {
      addToCart(product, 1, {
        size: product.sizes && product.sizes.length > 0 ? product.sizes[0] : undefined,
        selectedAddOns: [],
        removedIngredients: [],
      });
    },
    [addToCart]
  );

  const handleQuantityChange = useCallback(
    (product: Product, nextQuantity: number) => {
      const entry = cartIndex.get(product.id);
      if (!entry) return;

      if (nextQuantity <= 0) {
        updateCartItemQuantity(entry.lastItem.id, 0);
        return;
      }

      if (nextQuantity > entry.quantity) {
        if (entry.lastItemIsPlain) {
          updateCartItemQuantity(entry.lastItem.id, entry.lastItem.quantity + 1);
        } else {
          // A customized line can't absorb another unit — start a clean line.
          handleQuickAdd(product);
        }
        return;
      }

      updateCartItemQuantity(entry.lastItem.id, Math.max(0, entry.lastItem.quantity - 1));
    },
    [cartIndex, handleQuickAdd, updateCartItemQuantity]
  );

  const handleSortChange = useCallback(
    (value: MenuSortKey) => updatePreferences({ sort: value }),
    [updatePreferences]
  );
  const handleAvailableOnlyChange = useCallback(
    (value: boolean) => updatePreferences({ availableOnly: value }),
    [updatePreferences]
  );
  const handleLayoutChange = useCallback(
    (value: MenuLayout) => updatePreferences({ layout: value }),
    [updatePreferences]
  );

  const currency = currentRestaurant?.currency || '₪';

  // Visual loading completion gate: ensures minimum visual duration and smooth 100% progress hand-off.
  // (Declared BEFORE the displayMode early return below: hooks must run in the
  // same order on every render — the previous conditional placement was the
  // rules-of-hooks lint error F-01. Behavior is unchanged.)
  const [visualLoadingComplete, setVisualLoadingComplete] = useState<boolean>(() => {
    return (entryPhase ?? 'READY') === 'READY';
  });

  useEffect(() => {
    if ((entryPhase ?? 'READY') !== 'READY') {
      setVisualLoadingComplete(false);
    }
  }, [entryPhase]);

  // Read-only board (TV / social media): rendered before any gate so it never
  // asks for a table and never mounts a cart or an ordering drawer.
  if (displayMode) {
    return <DisplayMenu />;
  }

  // Guest entry in flight: the premium loader / recovery / invalid state owns
  // the whole screen until the entry machine reaches READY and visual hand-off finishes.
  if ((entryPhase ?? 'READY') !== 'READY' || !visualLoadingComplete) {
    return (
      <CustomerLoadingExperience
        phase={entryPhase}
        restaurant={currentRestaurant}
        invalidReason={entryInvalidReason}
        onRetry={retryEntry}
        onComplete={() => setVisualLoadingComplete(true)}
      />
    );
  }

  const isPublicRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/r/');
  if (isPublicRoute && !activeTableId) {
    return (
      <div className="min-h-screen bg-[#0A0B0D] text-luxury-50 flex items-center justify-center p-6 text-center" dir="rtl">
        <div className="max-w-md p-8 rounded-3xl bg-luxury-900 border border-amber-500/40 space-y-4">
          <div className="text-4xl">QR</div>
          <h2 className="text-xl font-bold font-serif text-luxury-50">افتح القائمة عبر رمز QR</h2>
          <p className="text-xs text-luxury-400 leading-relaxed">هذا الرابط غير صالح للدخول المباشر. امسح رمز QR الموجود على طاولة المطعم.</p>
        </div>
      </div>
    );
  }

  if (currentRestaurant?.status === 'SUSPENDED') {
    return (
      <div className="min-h-screen bg-[#0A0B0D] text-luxury-50 flex items-center justify-center p-6 text-center" dir="rtl">
        <div className="max-w-md p-8 rounded-3xl bg-luxury-900 border border-red-500/40 space-y-4">
          <div className="w-14 h-14 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold font-serif text-luxury-50">هذا المطعم غير متاح للطلب حالياً</h2>
          <p className="text-xs text-luxury-400 leading-relaxed">
            تم إيقاف الخدمة مؤقتاً لهذا المطعم. يرجى مراجعة إدارة المطعم أو الكاشير.
          </p>
        </div>
      </div>
    );
  }

  const theme = currentRestaurant?.theme;
  const bg = theme?.background
    ? (theme.mode === 'dark' || (theme.mode === 'auto' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? theme.background.dark
        : theme.background.light)
    : null;

  return (
    <div
      className={`customer-shell ${menuReveal ? 'customer-shell--reveal' : ''} min-h-screen text-luxury-50 flex flex-col pb-24 touch-manipulation relative`}
      dir="rtl"
      style={{
        backgroundColor: theme?.colors.background || '#0A0B0D',
        color: theme?.colors.textPrimary || undefined,
        fontFamily: 'var(--font-family)',
      }}
    >
      {/* Central Theme Background Layer — professional menu background */}
      {bg && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
          style={{
            backgroundColor: bg.type === 'solid' ? bg.color || theme?.colors.background : undefined,
            backgroundImage:
              bg.type === 'gradient'
                ? bg.gradient || undefined
                : bg.type === 'image' && bg.url
                  ? `url("${bg.url}")`
                  : bg.type === 'image+overlay' && bg.url
                    ? `${bg.overlayColor ? `linear-gradient(${bg.overlayColor}, ${bg.overlayColor}), ` : ''}url("${bg.url}")`
                    : undefined,
            backgroundPosition: bg.position || 'center',
            backgroundSize: bg.size || 'cover',
            backgroundRepeat: 'no-repeat',
            filter: bg.blur ? `blur(${bg.blur}px)` : undefined,
            opacity: bg.type === 'image+overlay' ? bg.overlayOpacity ?? 0.85 : 1,
          }}
        >
          {/* Readability boost overlay */}
          {bg.readabilityBoost && (
            <div
              className="absolute inset-0"
              style={{
                background:
                  theme?.mode === 'light' || theme?.colors.background === '#FFFFFF'
                    ? 'rgba(255,255,255,0.65)'
                    : 'rgba(0,0,0,0.55)',
              }}
            />
          )}
        </div>
      )}
      {/* Entry experience shown right after a QR scan. Dismissing it hands the
          guest straight to the menu below, unchanged. */}
      {showWelcome && <RestaurantEntryExperience onEnter={handleDismissWelcome} />}

      {/* Sticky Luxury Customer Header */}
      <CustomerHeader />

      {/* Main Customer Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 w-full flex-1">
        {/* Editorial Hero & Search & Offers */}
        <CustomerHero />

        {/* Sticky rail: categories + menu controls */}
        <div className="menu-rail mb-5">
          <CategoryScrollNav />
          <MenuToolbar
            shownCount={visibleProducts.length}
            totalCount={scopedProducts.length}
            sort={sort}
            onSortChange={handleSortChange}
            availableOnly={availableOnly}
            onAvailableOnlyChange={handleAvailableOnlyChange}
            layout={layout}
            onLayoutChange={handleLayoutChange}
          />
        </div>

        {/* Section Title when browsing by category */}
        {!isSearching && activeCategoryObj && (
          <div className="menu-section-head">
            <div>
              <h3 className="menu-section-head__title">{activeCategoryObj.name}</h3>
              {activeCategoryObj.nameEn && (
                <p className="menu-section-head__sub">{activeCategoryObj.nameEn}</p>
              )}
            </div>
            <span className="menu-section-head__rule" aria-hidden="true" />
            <span className="text-[11px] font-semibold text-luxury-500 whitespace-nowrap pb-1">
              {visibleProducts.length} أطباق
            </span>
          </div>
        )}

        {/* Products Grid */}
        {visibleProducts.length === 0 ? (
          <div className="menu-empty my-8 p-6 sm:p-8 text-center rounded-2xl bg-luxury-900/60 border border-luxury-800">
            <div className="menu-empty__icon mx-auto mb-3 w-12 h-12 rounded-full bg-luxury-800/80 flex items-center justify-center text-luxury-400">
              <UtensilsCrossed className="w-6 h-6 stroke-1" />
            </div>
            <h4 className="text-base font-bold text-luxury-200">
              {isSearching ? `لا توجد نتائج بحث عن "${deferredSearch}"` : 'لا توجد أطباق في هذا القسم حالياً'}
            </h4>
            <p className="text-xs text-luxury-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
              {isSearching
                ? 'جرّب البحث بكلمات أخرى أو تصفح الأقسام المختلفة في القائمة.'
                : 'يمكنك استعراض كامل قائمة الطعام أو تصفح الأقسام المتوفرة الأخرى.'}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {isSearching && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-luxury-800 hover:bg-luxury-750 text-luxury-100 transition-colors cursor-pointer"
                >
                  مسح البحث
                </button>
              )}
              {availableOnly && (
                <button
                  type="button"
                  onClick={() => updatePreferences({ availableOnly: false })}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-luxury-800 hover:bg-luxury-750 text-luxury-100 transition-colors cursor-pointer"
                >
                  إلغاء فلتر المتوفر فقط
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedCategoryId('all')}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--brand-primary)] text-luxury-950 hover:brightness-110 transition-all shadow-md cursor-pointer"
              >
                تصفح كامل القائمة
              </button>
            </div>
          </div>
        ) : (
          <div className="menu-grid" data-layout={layout}>
            {visibleProducts.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                currency={currency}
                cartQuantity={cartIndex.get(product.id)?.quantity || 0}
                priority={index < PRIORITY_CARDS}
                featured={product.id === featuredProductId}
                onSelect={handleSelect}
                onQuickAdd={handleQuickAdd}
                onQuantityChange={handleQuantityChange}
              />
            ))}
          </div>
        )}

        {/* The venue's own channels. Renders nothing at all when the restaurant
            published no link — never an empty heading or dead icons. */}
        <CustomerSocialSection />
      </main>

      {/* Customer Footer — White-label: only venue identity */}
      <footer
        className="mt-16 border-t py-8 px-4 text-center text-xs bg-transparent"
        style={{
          borderColor: theme?.colors.border || 'rgba(255,255,255,0.08)',
          color: theme?.colors.textSecondary || undefined,
        }}
      >
        <div className="max-w-md mx-auto space-y-3">
          <div className="font-serif text-sm font-bold tracking-widest uppercase" style={{ color: theme?.colors.textPrimary }}>
            {currentRestaurant?.name} {currentRestaurant?.nameEn ? `· ${currentRestaurant?.nameEn}` : ''}
          </div>
          <p className="text-[11px]" style={{ color: theme?.colors.textSecondary }}>
            جميع الأسعار تشمل ضريبة القيمة المضافة · المحاسبة عند الكاشير
          </p>
        </div>
      </footer>

      {/* Floating Active Orders Bar & Real-time Live Order Notifier */}
      <CustomerOrderLiveNotifier />
      <ActiveOrdersFloatingBar />

      {/* Modals & Drawers */}
      <ProductDetailModal product={selectedProduct} isOpen={!!selectedProduct} onClose={handleCloseDetail} />

      <CartDrawer />
      <OrderTrackingDrawer />

      {/* MANDATORY PAYMENT STEP: right after submitting an order the guest
          lands on the payment confirmation screen (phone + transfer receipt).
          The order stays out of the restaurant's operational workflow until
          the cashier verifies the payment, so this screen is part of the
          ordering flow, not an optional add-on. It closes by itself once the
          order is released. */}
      {orderAwaitingPayment && (
        <TransferPaymentModal
          isOpen
          onClose={dismissPaymentStep}
          order={orderAwaitingPayment}
        />
      )}
      <WaiterCallModal />
      <DirectTableEntryModal />
      <OrderCompletedModal />

      {/* Interactive customer onboarding tour. It belongs to the MENU only:
          it is not mounted while the entry layer is on screen, never opens by
          itself, and starts solely from the guest's confirmed request (header
          "دليل الاستخدام" → confirmation → start). Rendered last so its
          dialog surface wins focus/Escape management over the drawers it opens. */}
      {!showWelcome && <CustomerGuideOverlay />}
    </div>
  );
};
