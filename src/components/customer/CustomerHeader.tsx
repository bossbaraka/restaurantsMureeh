import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
import { ShoppingBag, Bell, QrCode, Sparkles, Store, Menu, X, ChefHat, MessageCircle, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

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

  const { setIsLoginModalOpen, currentUser } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const tableNumberStr = activeTableId ? activeTableId.replace(/^(?:TABLE-|.*-T)/, '') : '—';
  const hasActiveOrders = activeTableOrders.length > 0;

  const restName = currentRestaurant?.name || '';
  const restNameEn = currentRestaurant?.nameEn || '';
  const initialLetter = restNameEn.charAt(0) || 'M';

  const whatsappUrl = `https://wa.me/970593498909?text=${encodeURIComponent(`السلام عليكم، أتواصل معكم عبر قائمة الطعام في ${restName}`)}`;

  return (
    <>
      <header className="sticky top-14 z-30 bg-luxury-950/95 backdrop-blur-md border-b border-luxury-850 px-4 sm:px-6 py-3.5 transition-all">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          {/* Restaurant Identity & Table Badge */}
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden text-luxury-950 font-serif font-bold text-xl shadow-gold-glow shrink-0 border border-luxury-700/60"
              style={{
                background: currentRestaurant?.logo
                  ? 'transparent'
                  : `linear-gradient(135deg, ${currentRestaurant?.primaryColor || '#D4AF37'}, ${currentRestaurant?.accentColor || '#C5A880'})`,
              }}
            >
              {currentRestaurant?.logo ? (
                <img src={currentRestaurant.logo} alt={restName} className="w-full h-full object-cover" />
              ) : (
                initialLetter
              )}
            </div>
            <div className="text-right min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-luxury-50 font-serif tracking-wide flex items-center gap-1.5 truncate">
                <span className="truncate">{restName}</span>
                <span className="text-gold-400 text-xs font-serif italic hidden xs:inline">{restNameEn}</span>
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

          {/* Desktop & Tablet Action Buttons */}
          <div className="hidden sm:flex items-center gap-2 sm:gap-3">
            {/* Waiter Call Button */}
            <button
              onClick={() => setIsWaiterModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-luxury-900 hover:bg-luxury-850 text-luxury-200 hover:text-gold-300 border border-luxury-800 transition-all active:scale-95 text-xs font-medium cursor-pointer"
              title="استدعاء طاقم الضيافة"
            >
              <Bell className="w-4 h-4 text-gold-400" />
              <span>استدعاء النادل</span>
            </button>

            {/* Active Orders Tracker Pill */}
            {hasActiveOrders && (
              <button
                onClick={() => setIsOrderTrackingOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gold-500/15 hover:bg-gold-500/25 text-gold-300 border border-gold-500/40 transition-all active:scale-95 text-xs font-bold shadow-gold-glow animate-pulse cursor-pointer"
                title="متابعة حالة الطلب المباشرة"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>متابعة الطلب ({activeTableOrders.length})</span>
              </button>
            )}

            {/* Cart Button */}
            <button
              onClick={() => setIsCartOpen(true)}
              className="relative flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-luxury-950 font-bold hover:from-gold-400 hover:to-gold-500 transition-all shadow-gold-glow active:scale-95 text-xs cursor-pointer"
              aria-label="عرض سلة الطلبات"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>السلة</span>
              {cartTotalCount > 0 ? (
                <span className="bg-luxury-950 text-gold-400 text-xs px-1.5 py-0.2 rounded-md font-bold">
                  {cartTotalCount}
                </span>
              ) : null}
              {cartSubtotal > 0 && (
                <span className="border-r border-luxury-950/20 pr-1.5 mr-0.5 text-xs">
                  {formatPrice(cartSubtotal)}
                </span>
              )}
            </button>
          </div>

          {/* Mobile Right Controls: Cart Button + Hamburger Menu Button */}
          <div className="flex sm:hidden items-center gap-2">
            {/* Quick Cart Button for Mobile */}
            <button
              onClick={() => setIsCartOpen(true)}
              className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-luxury-950 font-bold text-xs shadow-gold-glow active:scale-95 cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4" />
              {cartTotalCount > 0 && (
                <span className="bg-luxury-950 text-gold-400 text-[11px] px-1.5 py-0.2 rounded-md font-bold">
                  {cartTotalCount}
                </span>
              )}
            </button>

            {/* Mobile Hamburger Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 rounded-xl bg-luxury-900 border border-luxury-800 text-luxury-200 hover:text-gold-400 transition-all cursor-pointer"
              aria-label="قائمة الخيارات"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Drawer Modal */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 sm:hidden flex flex-col justify-end">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />

          <div
            className="relative bg-luxury-900 border-t border-luxury-800 rounded-t-3xl p-5 space-y-4 text-right text-luxury-50 shadow-2xl z-10 animate-in slide-in-from-bottom duration-300"
            dir="rtl"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-3 border-b border-luxury-800">
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-gold-400" />
                <span className="font-serif font-bold text-sm text-luxury-100">{restName}</span>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1.5 rounded-lg bg-luxury-850 text-luxury-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Table Badge Info */}
            <div className="p-3 rounded-2xl bg-luxury-950 border border-luxury-800 flex items-center justify-between text-xs">
              <span className="text-luxury-400">الطاولة الحالية:</span>
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsTableSelectorOpen(true);
                }}
                className="text-gold-400 font-bold underline flex items-center gap-1"
              >
                <span>طاولة {tableNumberStr}</span>
                <span className="text-[10px] text-luxury-400">(تغيير)</span>
              </button>
            </div>

            {/* Menu Options List */}
            <div className="space-y-2 pt-1">
              {/* Order Tracking */}
              {hasActiveOrders && (
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setIsOrderTrackingOpen(true);
                  }}
                  className="w-full p-3 rounded-xl bg-gold-500/15 border border-gold-500/40 text-gold-300 text-xs font-bold flex items-center justify-between transition-all"
                >
                  <div className="flex items-center gap-2">
                    <ChefHat className="w-4 h-4 text-gold-400" />
                    <span>متابعة حالة الطلب</span>
                  </div>
                  <span className="text-[10px] bg-gold-500 text-luxury-950 px-2 py-0.5 rounded-full font-bold">
                    {activeTableOrders.length} طلبات
                  </span>
                </button>
              )}

              {/* Waiter Call */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsWaiterModalOpen(true);
                }}
                className="w-full p-3 rounded-xl bg-luxury-850 border border-luxury-800 hover:border-gold-500/30 text-luxury-100 text-xs font-semibold flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-gold-400" />
                  <span>استدعاء طاقم الضيافة (النادل)</span>
                </div>
              </button>

              {/* Cart Drawer */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsCartOpen(true);
                }}
                className="w-full p-3 rounded-xl bg-luxury-850 border border-luxury-800 hover:border-gold-500/30 text-luxury-100 text-xs font-semibold flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-gold-400" />
                  <span>سلة الطلبات</span>
                </div>
                {cartSubtotal > 0 && (
                  <span className="text-gold-400 font-bold font-mono">
                    {formatPrice(cartSubtotal)}
                  </span>
                )}
              </button>

              {/* WhatsApp Direct Support */}
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-full p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-emerald-400" />
                  <span>تواصل عبر واتساب المنصة</span>
                </div>
                <span className="font-mono text-[11px] text-emerald-300 direction-ltr">00970593498909</span>
              </a>

              {/* Admin Login */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsLoginModalOpen(true);
                }}
                className="w-full p-3 rounded-xl bg-luxury-950 border border-luxury-800 text-luxury-300 text-xs font-medium flex items-center justify-between transition-all mt-2"
              >
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gold-400" />
                  <span>{currentUser ? `حساب: ${currentUser.name}` : 'دخول الإدارة والعمال'}</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

