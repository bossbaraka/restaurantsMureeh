import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useStickyBand } from '../../theme/StickyStack';
import { formatPrice, formatTableNumber } from '../../utils/formatting';
import { ShoppingBag, Bell, Store, Menu, X, ChefHat, MessageCircle, User, MapPin, HelpCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { RestaurantMapModal } from '../common/RestaurantMapModal';
import { openCustomerGuide } from './guideBus';
import { optimizeImageUrl } from './ProductImage';
import { useDialog } from '../../hooks/useDialog';

export const CustomerHeader: React.FC = () => {
  const {
    currentRestaurant,
    activeTableId,
    activeTableNumber,
    activeTable,
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
  const [isMapOpen, setIsMapOpen] = useState(false);

  // Mobile options sheet: Escape-to-close, scroll lock, focus management.
  useDialog({ isOpen: isMobileMenuOpen, onClose: () => setIsMobileMenuOpen(false) });

  // -------------------------------------------------------------------------
  // Sticky stack registration.
  // This header no longer publishes a CSS variable of its own. It used to
  // write --customer-header-h, which made the rail's offset a formula
  // assembled from two independently owned numbers in two files (the other
  // being a hardcoded 57px for the toolbar). It now simply REGISTERS with the
  // single StickyStack owner, which measures every present band and publishes
  // one composed --m-stack-h.
  // -------------------------------------------------------------------------
  const stickyBandRef = useStickyBand('header');

  const tableNumberStr =
    activeTableNumber != null
      ? String(activeTableNumber)
      : activeTable?.tableNumber != null
      ? String(activeTable.tableNumber)
      : activeTableId
      ? formatTableNumber(activeTableId) || '—'
      : '—';
  const hasActiveOrders = activeTableOrders.length > 0;

  const restName = currentRestaurant?.name || '';
  const restNameEn = currentRestaurant?.nameEn || '';
  const initialLetter = restNameEn.charAt(0) || 'M';

  const whatsappUrl = `https://wa.me/970593498909?text=${encodeURIComponent(`السلام عليكم، أتواصل معكم عبر قائمة الطعام في ${restName}`)}`;

  return (
    <>
      <header
        ref={stickyBandRef}
        className="sticky z-30 bg-m-bg/90 backdrop-blur-lg border-b border-m-hairline px-4 sm:px-6 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 transition-all"
        style={{
          // Parks directly below the bands above it. --m-stack-above-header is
          // published by the same StickyStack owner as --m-stack-h, so the
          // header and the rail can never disagree about the stack, and the
          // toolbar's safe-area padding is counted exactly once (it is part of
          // the toolbar's MEASURED height).
          top: 'var(--m-stack-above-header, 0px)',
        }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          {/* Restaurant Identity & Table Badge */}
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden text-m-bg font-serif font-bold text-xl shrink-0 border border-m-hairline"
              style={{
                // Identity comes from the resolved theme (theme-first, legacy
                // fallback) via the --brand-* tokens — never the legacy
                // columns directly, which drift once a Theme row exists.
                background: currentRestaurant?.logo ? 'transparent' : 'var(--m-brand-fill)',
              }}
            >
              {currentRestaurant?.logo ? (
                <img
                  src={optimizeImageUrl(currentRestaurant.logo, 120, 75)}
                  alt={restName}
                  className="w-full h-full"
                  style={{
                    objectFit: currentRestaurant.logoFit === 'contain' ? 'contain' : 'cover',
                    objectPosition: currentRestaurant.logoPosition || '50% 50%',
                  }}
                  loading="eager"
                  decoding="async"
                />
              ) : (
                initialLetter
              )}
            </div>
            <div className="text-right min-w-0">
              <h1 className="text-[15px] sm:text-lg font-bold text-m-text font-serif tracking-wide flex items-baseline gap-2 truncate">
                <span className="truncate">{restName}</span>
                <span className="text-m-text-subtle text-xs font-serif italic hidden xs:inline truncate">{restNameEn}</span>
              </h1>

              {/* Table Indicator Pill — guests are locked to their scanned
                  table (one barcode); staff/managers may switch for preview. */}
              {currentUser ? (
                <button
                  onClick={() => setIsTableSelectorOpen(true)}
                  className="flex items-center gap-1.5 text-xs text-[rgb(var(--m-brand-on-surface-rgb)/0.9)] hover:text-[var(--m-brand-on-surface)] mt-0.5 group cursor-pointer"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${activeTableId ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="font-semibold underline decoration-[rgb(var(--m-brand-on-surface-rgb)/0.4)] underline-offset-2">
                    {activeTableId ? `طاولة ${tableNumberStr}` : 'اختر رقم الطاولة'}
                  </span>
                  <span className="text-[10px] text-m-text-muted group-hover:text-m-text-muted">
                    ({activeTableId ? 'تغيير' : 'تحديد'})
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-[rgb(var(--m-brand-on-surface-rgb)/0.9)] mt-0.5" data-guide="table">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeTableId ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="font-semibold">
                    {activeTableId ? `طاولة ${tableNumberStr}` : 'امسح رمز QR للطاولة'}
                  </span>
                  {activeTableId && (
                    <span className="text-[10px] text-m-text-subtle">مقفلة 🔒</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Desktop & Tablet Action Buttons */}
          <div className="hidden sm:flex items-center gap-2 sm:gap-3">
            {/* Usage Guide Button */}
            <button
              onClick={() => openCustomerGuide()}
              className="customer-header__action"
              title="دليل استخدام القائمة خطوة بخطوة"
              aria-label="دليل الاستخدام"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            {/* Restaurant Map Button */}
            <button
              onClick={() => setIsMapOpen(true)}
              data-guide="map"
              className="customer-header__action"
              title="عرض خريطة وموقع المطعم"
              aria-label="الخريطة والموقع"
            >
              <MapPin className="w-4 h-4" />
            </button>

            {/* Waiter Call Button */}
            <button
              onClick={() => setIsWaiterModalOpen(true)}
              data-guide="waiter"
              className="customer-header__action"
              title="استدعاء طاقم الضيافة"
              aria-label="استدعاء النادل"
            >
              <Bell className="w-4 h-4" />
            </button>

            {/* Live Kitchen & Active Orders Tracker Pill */}
            {hasActiveOrders && (
              <button
                onClick={() => setIsOrderTrackingOpen(true)}
                data-guide="kitchen"
                className="flex items-center gap-1.5 px-3 h-10 rounded-full bg-m-surface text-m-text border border-m-hairline text-xs font-bold cursor-pointer"
                title="متابعة حالة الطلب والمطبخ الحي"
              >
                <ChefHat className="w-4 h-4" />
                <span>المطبخ ({activeTableOrders.length})</span>
              </button>
            )}

            {/* Cart Button */}
            <button
              onClick={() => setIsCartOpen(true)}
              data-guide="cart"
              className="relative flex items-center gap-2 px-3.5 h-10 rounded-full brand-cta font-bold transition-all active:scale-95 text-xs cursor-pointer"
              aria-label="عرض سلة الطلبات"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>السلة</span>
              {cartTotalCount > 0 ? (
                <span className="bg-m-bg text-[var(--m-brand-on-surface)] text-xs px-1.5 py-0.5 rounded-md font-bold">
                  {cartTotalCount}
                </span>
              ) : null}
              {cartSubtotal > 0 && (
                <span className="border-r border-m-hairline/20 pr-1.5 mr-0.5 text-xs">
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
              data-guide="cart"
              aria-label={cartTotalCount > 0 ? `عرض السلة — ${cartTotalCount} صنف` : 'عرض السلة'}
              className="relative flex items-center gap-1.5 px-3 py-2 rounded-full brand-cta font-bold text-xs active:scale-95 cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4" />
              {cartTotalCount > 0 && (
                <>
                  <span className="bg-m-bg text-[var(--m-brand-on-surface)] text-[11px] px-1.5 py-0.5 rounded-md font-bold">
                    {cartTotalCount}
                  </span>
                  <span className="text-[11px] font-bold whitespace-nowrap" dir="ltr">
                    {formatPrice(cartSubtotal, currentRestaurant?.currency)}
                  </span>
                </>
              )}
            </button>

            {/* Mobile Hamburger Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-m-surface border border-m-hairline text-m-text hover:text-[var(--m-brand-on-surface)] transition-all cursor-pointer"
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
            aria-hidden="true"
            tabIndex={-1}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label={`خيارات ${restName}`}
            className="relative bg-m-surface border-t border-m-hairline rounded-t-3xl p-5 space-y-4 text-right text-m-text shadow-2xl z-10 animate-in slide-in-from-bottom duration-300"
            dir="rtl"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-3 border-b border-m-hairline">
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-[var(--m-brand-on-surface)]" />
                <span className="font-serif font-bold text-sm text-m-text">{restName}</span>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center bg-m-surface-raised text-m-text-muted hover:text-m-text"
                aria-label="إغلاق القائمة"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Table Badge Info */}
            <div className="p-3 rounded-2xl bg-m-bg border border-m-hairline flex items-center justify-between text-xs">
              <span className="text-m-text-muted">الطاولة الحالية:</span>
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsTableSelectorOpen(true);
                }}
                className="text-[var(--m-brand-on-surface)] font-bold underline flex items-center gap-1"
              >
                <span>طاولة {tableNumberStr}</span>
                <span className="text-[10px] text-m-text-muted">(تغيير)</span>
              </button>
            </div>

            {/* Menu Options List */}
            <div className="space-y-2 pt-1">
              {/* Usage Guide */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  openCustomerGuide();
                }}
                className="w-full p-3 rounded-xl bg-[rgb(var(--m-brand-on-surface-rgb)/0.12)] border border-[rgb(var(--m-brand-on-surface-rgb)/0.3)] text-[var(--m-brand-on-surface)] text-xs font-bold flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  <span>دليل الاستخدام خطوة بخطوة</span>
                </div>
              </button>

              {/* Order Tracking */}
              {hasActiveOrders && (
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setIsOrderTrackingOpen(true);
                  }}
                  className="w-full p-3 rounded-xl bg-[rgb(var(--m-brand-on-surface-rgb)/0.15)] border border-[rgb(var(--m-brand-on-surface-rgb)/0.4)] text-[var(--m-brand-on-surface)] text-xs font-bold flex items-center justify-between transition-all"
                >
                  <div className="flex items-center gap-2">
                    <ChefHat className="w-4 h-4 text-[var(--m-brand-on-surface)]" />
                    <span>متابعة حالة الطلب</span>
                  </div>
                  <span className="text-[10px] brand-fill px-2 py-0.5 rounded-full font-bold">
                    {activeTableOrders.length} طلبات
                  </span>
                </button>
              )}

              {/* Restaurant Map Button */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsMapOpen(true);
                }}
                className="w-full p-3 rounded-xl bg-m-surface-raised border border-m-hairline hover:border-m-brand/30 text-m-text text-xs font-semibold flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-m-brand-strong" />
                  <span>خريطة وموقع المطعم</span>
                </div>
              </button>

              {/* Waiter Call */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsWaiterModalOpen(true);
                }}
                className="w-full p-3 rounded-xl bg-m-surface-raised border border-m-hairline hover:border-[rgb(var(--m-brand-on-surface-rgb)/0.3)] text-m-text text-xs font-semibold flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-[var(--m-brand-on-surface)]" />
                  <span>استدعاء طاقم الضيافة (النادل)</span>
                </div>
              </button>

              {/* Cart Drawer */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsCartOpen(true);
                }}
                className="w-full p-3 rounded-xl bg-m-surface-raised border border-m-hairline hover:border-[rgb(var(--m-brand-on-surface-rgb)/0.3)] text-m-text text-xs font-semibold flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-[var(--m-brand-on-surface)]" />
                  <span>سلة الطلبات</span>
                </div>
                {cartSubtotal > 0 && (
                  <span className="text-[var(--m-brand-on-surface)] font-bold font-mono">
                    {formatPrice(cartSubtotal)}
                  </span>
                )}
              </button>

              {/* Telegram Bot Direct Support */}
              <a
                href="https://t.me/Mureeh_tech_bot"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-full p-3 rounded-xl bg-sky-950/80 border border-sky-500/40 text-sky-300 text-xs font-bold flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-sky-400" />
                  <span>تواصل عبر بوت تليجرام المنصة</span>
                </div>
                <span className="font-mono text-[11px] text-sky-300 direction-ltr">@Mureeh_tech_bot</span>
              </a>

              {/* Admin Login */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsLoginModalOpen(true);
                }}
                className="w-full p-3 rounded-xl bg-m-bg border border-m-hairline text-m-text-muted text-xs font-medium flex items-center justify-between transition-all mt-2"
              >
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[var(--m-brand-on-surface)]" />
                  <span>{currentUser ? `حساب: ${currentUser.name}` : 'دخول الإدارة والعمال'}</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restaurant Interactive Map Modal */}
      <RestaurantMapModal
        restaurant={currentRestaurant}
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
      />
    </>
  );
};


