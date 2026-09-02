import React from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
import { ShoppingBag, Bell, QrCode, Sparkles, Store } from 'lucide-react';

export const CustomerHeader: React.FC = () => {
  const {
    currentRestaurant,
    activeTableId,
    cartTotalCount,
    cartSubtotal,
    setIsCartOpen,
    setIsWaiterModalOpen,
    setIsTableSelectorOpen,
    activeTableOrders,
    setIsOrderTrackingOpen,
  } = useRestaurant();

  const tableNumberStr = activeTableId ? activeTableId.replace('TABLE-', '') : '—';
  const hasActiveOrders = activeTableOrders.length > 0;

  const restName = currentRestaurant?.name || 'مطعم مِيرار';
  const restNameEn = currentRestaurant?.nameEn || 'MÉRAR';
  const initialLetter = restNameEn.charAt(0) || 'M';

  return (
    <header className="sticky top-14 z-30 bg-luxury-950/90 backdrop-blur-md border-b border-luxury-850 px-4 sm:px-6 py-3.5 transition-all">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
        {/* Restaurant Identity & Table Badge */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-luxury-950 font-serif font-bold text-xl shadow-gold-glow"
            style={{
              background: `linear-gradient(135deg, ${currentRestaurant?.primaryColor || '#D4AF37'}, ${currentRestaurant?.accentColor || '#C5A880'})`,
            }}
          >
            {initialLetter}
          </div>
          <div className="text-right">
            <h1 className="text-base font-bold text-luxury-50 font-serif tracking-wide flex items-center gap-1.5">
              <span>{restName}</span>
              <span className="text-gold-400 text-xs font-serif italic">{restNameEn}</span>
            </h1>

            {/* Table Indicator Pill */}
            <button
              onClick={() => setIsTableSelectorOpen(true)}
              className="flex items-center gap-1.5 text-xs text-gold-300/90 hover:text-gold-200 mt-0.5 group cursor-pointer"
            >
              <span className={`w-2 h-2 rounded-full ${activeTableId ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
              <span className="font-semibold underline decoration-gold-500/40 underline-offset-2">
                {activeTableId ? `طاولة ${tableNumberStr}` : 'اختر رقم الطاولة'}
              </span>
              <span className="text-[10px] text-luxury-400 group-hover:text-luxury-300">
                ({activeTableId ? 'تغيير' : 'تحديد'})
              </span>
            </button>
          </div>
        </div>

        {/* Action Buttons: Waiter Call + Active Orders Tracker + Cart */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Waiter Call Button */}
          <button
            onClick={() => setIsWaiterModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-luxury-900 hover:bg-luxury-850 text-luxury-200 hover:text-gold-300 border border-luxury-800 transition-all active:scale-95 text-xs font-medium"
            title="استدعاء طاقم الضيافة"
          >
            <Bell className="w-4 h-4 text-gold-400" />
            <span className="hidden xs:inline">استدعاء النادل</span>
          </button>

          {/* Active Orders Tracker Pill */}
          {hasActiveOrders && (
            <button
              onClick={() => setIsOrderTrackingOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gold-500/10 hover:bg-gold-500/20 text-gold-300 border border-gold-500/30 transition-all active:scale-95 text-xs font-medium"
              title="متابعة حالة الطلبات"
            >
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>طلباتك ({activeTableOrders.length})</span>
            </button>
          )}

          {/* Cart Button */}
          <button
            onClick={() => setIsCartOpen(true)}
            className="relative flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-luxury-950 font-bold hover:from-gold-400 hover:to-gold-500 transition-all shadow-gold-glow active:scale-95 text-xs"
            aria-label="عرض سلة الطلبات"
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="hidden sm:inline">السلة</span>
            {cartTotalCount > 0 ? (
              <span className="bg-luxury-950 text-gold-400 text-xs px-1.5 py-0.2 rounded-md font-bold">
                {cartTotalCount}
              </span>
            ) : null}
            {cartSubtotal > 0 && (
              <span className="border-r border-luxury-950/20 pr-1.5 mr-0.5 text-xs hidden xs:inline">
                {formatPrice(cartSubtotal)}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
