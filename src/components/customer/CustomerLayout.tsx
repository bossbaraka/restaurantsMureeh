import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { CartItem, Product } from '../../types/restaurant';
import { useBrandTheme } from '../../theme/brandTheme';
import { useMenuPreferences } from '../../hooks/useMenuPreferences';
import { CustomerHeader } from './CustomerHeader';
import { CustomerHero } from './CustomerHero';
import { CategoryScrollNav } from './CategoryScrollNav';
import { MenuToolbar, type MenuLayout, type MenuSortKey } from './MenuToolbar';
import { ProductCard } from './ProductCard';
import { ProductDetailModal } from './ProductDetailModal';
import { CartDrawer } from './CartDrawer';
import { OrderTrackingDrawer } from './OrderTrackingDrawer';
import { WaiterCallModal } from './WaiterCallModal';
import { DirectTableEntryModal } from './DirectTableEntryModal';
import { ActiveOrdersFloatingBar } from './ActiveOrdersFloatingBar';
import { CustomerOrderLiveNotifier } from './CustomerOrderLiveNotifier';
import { CustomerGuideOverlay } from './CustomerGuideOverlay';
import { OrderCompletedModal } from './OrderCompletedModal';
import { LuxuryWelcomeScreen } from './LuxuryWelcomeScreen';
import { DisplayMenu } from './DisplayMenu';
import { UtensilsCrossed, AlertTriangle } from 'lucide-react';

/** Cards rendered above the fold get eager loading + network priority. */
const PRIORITY_CARDS = 4;

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
  } = useRestaurant();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Tenant palette -> CSS custom properties consumed by the whole menu.
  useBrandTheme(currentRestaurant?.primaryColor, currentRestaurant?.accentColor);

  const [preferences, updatePreferences] = useMenuPreferences(currentRestaurant?.slug || 'default');
  const { sort, layout, availableOnly } = preferences;

  // Typing in the search box must never block the frame that paints the input.
  const deferredSearch = useDeferredValue(searchQuery);

  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    // Show welcome screen initially once per session
    if (typeof window !== 'undefined') {
      const seen = sessionStorage.getItem(`merar_welcome_seen_${currentRestaurant?.slug || 'restaurant'}`);
      return !seen;
    }
    return true;
  });

  const handleDismissWelcome = () => {
    setShowWelcome(false);
    if (typeof window !== 'undefined' && currentRestaurant) {
      sessionStorage.setItem(`merar_welcome_seen_${currentRestaurant.slug}`, 'true');
    }
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

  // Fixed-viewport menu (explicit product decision): while the customer menu
  // is mounted it must stay app-like — no pinch zoom and no double-tap zoom.
  // Scoped to this screen only: the original viewport meta is restored on
  // unmount so every other view keeps the accessible (WCAG 2.1 SC 1.4.4)
  // zoom behaviour documented in index.html. Text inputs still use >=16px
  // fonts, so iOS never auto-zooms on focus either.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    const originalContent = viewportMeta?.getAttribute('content') || '';
    viewportMeta?.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
    );
    // iOS Safari ignores `user-scalable=no` for pinch — block the gestures too.
    // Taps/double-taps are covered by `touch-manipulation` on the root below.
    const preventGestureZoom = (event: Event) => event.preventDefault();
    document.addEventListener('gesturestart', preventGestureZoom);
    document.addEventListener('gesturechange', preventGestureZoom);
    return () => {
      if (originalContent) viewportMeta?.setAttribute('content', originalContent);
      document.removeEventListener('gesturestart', preventGestureZoom);
      document.removeEventListener('gesturechange', preventGestureZoom);
    };
  }, []);

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

  // Read-only board (TV / social media): rendered before any gate so it never
  // asks for a table and never mounts a cart or an ordering drawer.
  if (displayMode) {
    return <DisplayMenu />;
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

  return (
    <div className="customer-shell min-h-screen bg-[#0A0B0D] text-luxury-50 flex flex-col pb-24 touch-manipulation" dir="rtl">
      {/* Luxury Welcome Overlay for initial QR entry */}
      {showWelcome && <LuxuryWelcomeScreen onDismiss={handleDismissWelcome} />}

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
      </main>

      {/* Customer Footer */}
      <footer className="mt-16 border-t border-luxury-850 py-8 px-4 text-center text-xs text-luxury-500 bg-luxury-950">
        <div className="max-w-md mx-auto space-y-3">
          <div className="font-serif text-sm font-bold brand-text tracking-widest uppercase">
            {currentRestaurant?.name} · {currentRestaurant?.nameEn}
          </div>
          <p className="text-[11px] text-luxury-400">
            جميع الأسعار تشمل ضريبة القيمة المضافة · المحاسبة عند الكاشير
          </p>

          {/* Platform Branding & WhatsApp Support */}
          <div className="pt-3 border-t border-luxury-850/80 space-y-2">
            <p className="text-xs font-semibold text-luxury-300">
              الخدمة تعمل بوساطة <strong className="text-[#38BDF8]">منصة مريح MUREEH</strong>
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
              <button
                onClick={() => setViewMode('SAAS_LANDING')}
                className="text-[11px] text-[#38BDF8]/90 hover:text-[#38BDF8] hover:underline font-semibold transition-colors cursor-pointer"
                title="التعرف على خدمات المنصة واشتراكات المطاعم"
              >
                هل تملك مطعماً؟ احصل على نظام مريح الذكي ⚡
              </button>
              <a
                href="https://t.me/Mureeh_tech_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0072BC]/20 border border-[#0072BC]/40 text-[#38BDF8] text-[11px] font-bold hover:bg-[#0072BC]/30 transition-colors"
              >
                <span>تليجرام الدعم الفني:</span>
                <span className="font-mono text-[#38BDF8] font-bold direction-ltr">@Mureeh_tech_bot</span>
              </a>
            </div>
          </div>

          <p className="text-[10px] text-luxury-600">
            MUREEH Digital Dining & Smart Hospitality Platform © 2026
          </p>
        </div>
      </footer>

      {/* Floating Active Orders Bar & Real-time Live Order Notifier */}
      <CustomerOrderLiveNotifier />
      <ActiveOrdersFloatingBar />

      {/* Interactive customer onboarding tour (coach-marks with arrows) */}
      <CustomerGuideOverlay />

      {/* Modals & Drawers */}
      <ProductDetailModal product={selectedProduct} isOpen={!!selectedProduct} onClose={handleCloseDetail} />

      <CartDrawer />
      <OrderTrackingDrawer />
      <WaiterCallModal />
      <DirectTableEntryModal />
      <OrderCompletedModal />
    </div>
  );
};
