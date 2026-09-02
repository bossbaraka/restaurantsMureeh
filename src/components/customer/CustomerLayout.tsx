import React, { useState, useMemo } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Product } from '../../types/restaurant';
import { CustomerHeader } from './CustomerHeader';
import { CustomerHero } from './CustomerHero';
import { CategoryScrollNav } from './CategoryScrollNav';
import { ProductCard } from './ProductCard';
import { ProductDetailModal } from './ProductDetailModal';
import { CartDrawer } from './CartDrawer';
import { OrderTrackingDrawer } from './OrderTrackingDrawer';
import { WaiterCallModal } from './WaiterCallModal';
import { DirectTableEntryModal } from './DirectTableEntryModal';
import { ActiveOrdersFloatingBar } from './ActiveOrdersFloatingBar';
import { LuxuryWelcomeScreen } from './LuxuryWelcomeScreen';
import { UtensilsCrossed, AlertTriangle } from 'lucide-react';

export const CustomerLayout: React.FC = () => {
  const { products, categories, selectedCategoryId, searchQuery, addToCart, currentRestaurant, activeTableId } = useRestaurant();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    // Show welcome screen initially once per session
    if (typeof window !== 'undefined') {
      const seen = sessionStorage.getItem(`merar_welcome_seen_${currentRestaurant?.slug || 'demo'}`);
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

  // Filter products based on search query OR selected category
  const filteredProducts = useMemo(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.nameEn.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          (p.badge && p.badge.toLowerCase().includes(q))
      );
    }
    return products.filter((p) => p.categoryId === selectedCategoryId);
  }, [products, selectedCategoryId, searchQuery]);

  const activeCategoryObj = categories.find((c) => c.id === selectedCategoryId);

  const handleQuickAdd = (product: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    addToCart(product, 1, {
      size: product.sizes && product.sizes.length > 0 ? product.sizes[0] : undefined,
      selectedAddOns: [],
      removedIngredients: [],
    });
  };

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
    <div className="min-h-screen bg-[#0A0B0D] text-luxury-50 flex flex-col pb-24" dir="rtl">
      {/* Luxury Welcome Overlay for initial QR entry */}
      {showWelcome && <LuxuryWelcomeScreen onDismiss={handleDismissWelcome} />}

      {/* Sticky Luxury Customer Header */}
      <CustomerHeader />

      {/* Main Customer Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 w-full flex-1">
        {/* Editorial Hero & Search & Offers */}
        <CustomerHero />

        {/* Horizontal Category Nav */}
        <CategoryScrollNav />

        {/* Section Title when browsing by category */}
        {!searchQuery && activeCategoryObj && (
          <div className="flex items-center justify-between mb-4 px-1">
            <div className="text-right">
              <h3 className="text-lg font-bold text-luxury-100 font-serif">
                {activeCategoryObj.name}
              </h3>
              {activeCategoryObj.nameEn && (
                <p className="text-xs text-gold-400/80 font-serif italic">
                  {activeCategoryObj.nameEn}
                </p>
              )}
            </div>
            <span className="text-xs text-luxury-400">
              {filteredProducts.length} أطباق متوفرة
            </span>
          </div>
        )}

        {/* Products Grid */}
        {filteredProducts.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-luxury-900/50 border border-luxury-800/80 my-8">
            <div className="w-14 h-14 rounded-full bg-luxury-800 text-luxury-400 flex items-center justify-center mx-auto mb-3">
              <UtensilsCrossed className="w-6 h-6 stroke-1" />
            </div>
            <h4 className="text-base font-bold text-luxury-200">لا توجد أطباق مطابقة</h4>
            <p className="text-xs text-luxury-400 mt-1 max-w-xs mx-auto">
              جرب البحث بكلمات أخرى أو تصفح الفئات المختلفة في القائمة.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 sm:gap-5">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onSelect={(p) => setSelectedProduct(p)}
                onQuickAdd={handleQuickAdd}
              />
            ))}
          </div>
        )}
      </main>

      {/* Customer Footer */}
      <footer className="mt-16 border-t border-luxury-850 py-8 px-4 text-center text-xs text-luxury-500 bg-luxury-950">
        <div className="max-w-md mx-auto space-y-2">
          <div className="font-serif text-sm font-bold text-gold-400/90 tracking-widest uppercase">
            {currentRestaurant?.name} · {currentRestaurant?.nameEn}
          </div>
          <p className="text-[11px] text-luxury-400">
            جميع الأسعار تشمل ضريبة القيمة المضافة · المحاسبة عند الكاشير
          </p>
          <p className="text-[10px] text-luxury-600">
            Hospitality Digital Ordering Experience
          </p>
        </div>
      </footer>

      {/* Floating Active Orders Bar */}
      <ActiveOrdersFloatingBar />

      {/* Modals & Drawers */}
      <ProductDetailModal
        product={selectedProduct}
        isOpen={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
      />

      <CartDrawer />
      <OrderTrackingDrawer />
      <WaiterCallModal />
      <DirectTableEntryModal />
    </div>
  );
};
