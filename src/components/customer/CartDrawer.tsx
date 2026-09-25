import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice, formatTableNumber } from '../../utils/formatting';
import { OrderConfirmationModal } from './OrderConfirmationModal';
import {
  ShoppingBag,
  X,
  Plus,
  Minus,
  Trash2,
  Receipt,
  ArrowLeft,
  Utensils,
} from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';

export const CartDrawer: React.FC = () => {
  const {
    isCartOpen,
    setIsCartOpen,
    cartItems,
    cartSubtotal,
    cartTotalCount,
    updateCartItemQuantity,
    removeFromCart,
    activeTableId,
    activeTableNumber,
    activeTable,
    setIsTableSelectorOpen,
    currentRestaurant,
  } = useRestaurant();
  const currency = currentRestaurant?.currency || '₪';

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');

  // UX-001: Escape-to-close + body scroll lock (see hooks/useDialog).
  useDialog({ isOpen: isCartOpen, onClose: () => setIsCartOpen(false) });

  if (!isCartOpen) return null;

  const handleOpenConfirm = () => {
    if (!activeTableId) {
      setIsTableSelectorOpen(true);
      return;
    }
    setIsConfirmModalOpen(true);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" dir="rtl">
      {/* Dark luxury backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={() => setIsCartOpen(false)}
      />

      <div className="fixed inset-y-0 left-0 max-w-full flex">
        <div role="dialog" aria-modal="true" aria-labelledby="cart-title" className="w-screen max-w-md border-r border-m-hairline flex flex-col text-right" style={{ backgroundColor: 'var(--m-surface)', boxShadow: 'var(--m-shadow-lg)' }}>
          {/* Header */}
          <div className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4 border-b border-m-hairline flex items-center justify-between bg-m-bg" data-guide="cart-panel">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[rgb(var(--m-brand-on-surface-rgb)/0.1)] border border-m-hairline flex items-center justify-center text-[var(--m-brand-on-surface)]">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h3 id="cart-title" className="text-base font-bold text-m-text font-serif">سلة الطلبات</h3>
                <p className="text-xs text-m-text-muted">
                  {currentRestaurant?.name} · {cartTotalCount} أطباق مختارة
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsCartOpen(false)}
              aria-label="إغلاق سلة الطلبات"
              className="w-10 h-10 rounded-full flex items-center justify-center text-m-text-muted hover:text-m-text hover:bg-m-surface-raised transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Table Indicator Warning if not chosen */}
          <div className="bg-m-bg/80 px-5 py-2.5 border-b border-m-hairline/80 flex items-center justify-between text-xs">
            <span className="text-m-text-muted">طاولة الطلب:</span>
            {activeTableId ? (
              <span className="font-bold text-[var(--m-brand-on-surface)] font-mono flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--m-success)' }} />
                طاولة رقم {activeTableNumber ?? activeTable?.tableNumber ?? (formatTableNumber(activeTableId) || '—')}
              </span>
            ) : (
              <button
                onClick={() => setIsTableSelectorOpen(true)}
                className="text-amber-400 underline font-bold"
              >
                انقر لتحديد رقم طاولتك
              </button>
            )}
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
            {cartItems.length === 0 ? (
              <div className="py-20 text-center space-y-3">
                <div className="w-16 h-16 rounded-3xl bg-m-surface-raised text-m-text-subtle flex items-center justify-center mx-auto border border-m-hairline">
                  <Utensils className="w-8 h-8 stroke-1" />
                </div>
                <h4 className="text-base font-bold text-m-text">سلتك فارغة حالياً</h4>
                <p className="text-xs text-m-text-muted max-w-xs mx-auto">
                  أضف ما تحب من القائمة، ثم أكّد الطلب لطاولتك.
                </p>
              </div>
            ) : (
              cartItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-m-bg/60 border border-m-hairline rounded-2xl p-4 space-y-3 relative group transition-all hover:border-[rgb(var(--m-brand-on-surface-rgb)/0.3)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {(item.product?.image || item.productImage) && (
                        <img
                          src={item.product?.image || item.productImage}
                          alt={item.product?.name || item.productName}
                          className="w-14 h-14 rounded-xl object-cover border border-m-hairline shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-m-text line-clamp-1">
                          {item.product?.name || item.productName}
                        </h4>
                        {item.options.size && (
                          <p className="text-[11px] text-[rgb(var(--m-brand-on-surface-rgb)/0.9)] font-medium">
                            الحجم: {typeof item.options.size === 'object' ? item.options.size.name : item.options.size}
                          </p>
                        )}
                        {item.options.selectedAddOns && item.options.selectedAddOns.length > 0 && (
                          <p className="text-[11px] text-m-text-muted line-clamp-1">
                            إضافات: {item.options.selectedAddOns.map((a: any) => typeof a === 'object' ? a.name : a).join('، ')}
                          </p>
                        )}
                        {item.options.removedIngredients && item.options.removedIngredients.length > 0 && (
                          <p className="text-[11px] text-red-400/80 line-clamp-1">
                            استبعاد: {item.options.removedIngredients.join('، ')}
                          </p>
                        )}
                        {item.options.specialInstructions && (
                          <p className="text-[11px] text-m-text-muted italic line-clamp-1">
                            "{item.options.specialInstructions}"
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-left shrink-0">
                      <span className="text-sm font-bold text-m-text">
                        {formatPrice(item.totalPrice || item.itemTotal || 0, currency)}
                      </span>
                    </div>
                  </div>

                  {/* Quantity row */}
                  <div className="flex items-center justify-between pt-2 border-t border-m-hairline/60">
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-m-text-muted hover:text-red-400 p-1 rounded-md transition-colors text-xs flex items-center gap-1"
                      title="حذف"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>

                    <div className="flex items-center gap-2 bg-m-surface border border-m-hairline rounded-full p-0.5">
                      <button
                        onClick={() => updateCartItemQuantity(item.id, item.quantity - 1)}
                        aria-label={`إنقاص كمية ${item.product?.name || item.productName}`}
                        className="touch-target w-7 h-7 rounded-full bg-m-surface-raised hover:bg-m-surface-raised text-m-text-muted flex items-center justify-center transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-6 text-center font-bold text-xs font-mono text-m-text" aria-live="polite">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateCartItemQuantity(item.id, item.quantity + 1)}
                        aria-label={`زيادة كمية ${item.product?.name || item.productName}`}
                        className="touch-target w-7 h-7 rounded-full brand-cta font-bold flex items-center justify-center transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer & Checkout */}
          {cartItems.length > 0 && (
            <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-m-bg border-t border-m-hairline space-y-4 shrink-0">
              {/* Order Notes Input */}
              <div>
                <label className="block text-[11px] font-bold text-m-text-muted mb-1" htmlFor="cartdrawer-f1">
                  ملاحظات عامة للطلب (اختياري)
                </label>
                <input id="cartdrawer-f1"
                  type="text"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="مثال: تقديم المقبلات أولاً، أطباق وملاعق إضافية..."
                  className="w-full bg-m-surface border border-m-hairline rounded-full px-4 py-2.5 text-xs text-m-text placeholder-m-text-subtle focus:outline-none focus:border-[rgb(var(--m-brand-on-surface-rgb)/0.6)]"
                />
              </div>

              {/* Subtotal & Payment Notice */}
              <div className="space-y-1.5 pt-2 border-t border-m-hairline/80">
                <div className="flex justify-between text-xs text-m-text-muted">
                  <span>المجموع الفرعي</span>
                  <span className="font-mono">{formatPrice(cartSubtotal, currency)}</span>
                </div>
                <div className="flex justify-between text-xs text-m-text-muted">
                  <span>الضريبة والخدمة</span>
                  <span className="text-[rgb(var(--m-brand-on-surface-rgb)/0.9)] font-medium">مشمولة</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-m-text pt-1">
                  <span>الإجمالي النهائي</span>
                  <span className="text-m-text font-mono text-base">{formatPrice(cartSubtotal, currency)}</span>
                </div>
              </div>

              {/* Payment Method Notice */}
              <div className="bg-m-surface/90 border border-m-hairline p-2.5 rounded-xl flex items-center gap-2.5 text-[11px] text-m-text-muted">
                <Receipt className="w-4 h-4 text-[var(--m-brand-on-surface)] shrink-0" />
                <span>طريقة المحاسبة: الدفع نقداً أو بالبطاقة لدى الكاشير، أو عبر التحويل</span>
              </div>

              {/* Confirm CTA */}
              <button
                onClick={handleOpenConfirm}
                className="w-full py-3.5 rounded-xl brand-cta font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <span>مراجعة وتأكيد الطلب</span>
                <ArrowLeft className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Order Confirmation Summary Modal */}
      <OrderConfirmationModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        orderNotes={orderNotes}
      />
    </div>
  );
};
