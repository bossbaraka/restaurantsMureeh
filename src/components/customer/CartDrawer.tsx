import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
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
  CreditCard,
  CheckCircle2,
} from 'lucide-react';

export const CartDrawer: React.FC = () => {
  const {
    isCartOpen,
    setIsCartOpen,
    cartItems,
    cartSubtotal,
    cartTotalCount,
    updateCartItemQuantity,
    removeFromCart,
    clearCart,
    activeTableId,
    setIsTableSelectorOpen,
    currentRestaurant,
  } = useRestaurant();

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');

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
        <div className="w-screen max-w-md bg-luxury-900 border-r border-luxury-750 shadow-2xl flex flex-col text-right">
          {/* Header */}
          <div className="p-5 border-b border-luxury-800 flex items-center justify-between bg-luxury-950">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-400">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-luxury-50 font-serif">سلة الطلبات</h3>
                <p className="text-xs text-luxury-400">
                  {currentRestaurant?.name} · {cartTotalCount} أطباق مختارة
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsCartOpen(false)}
              className="p-2 rounded-xl text-luxury-400 hover:text-luxury-200 hover:bg-luxury-850 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Table Indicator Warning if not chosen */}
          <div className="bg-luxury-950/80 px-5 py-2.5 border-b border-luxury-800/80 flex items-center justify-between text-xs">
            <span className="text-luxury-400">طاولة الطلب:</span>
            {activeTableId ? (
              <span className="font-bold text-gold-400 font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                طاولة رقم {activeTableId.replace('TABLE-', '')}
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
                <div className="w-16 h-16 rounded-3xl bg-luxury-850 text-luxury-500 flex items-center justify-center mx-auto border border-luxury-800">
                  <Utensils className="w-8 h-8 stroke-1" />
                </div>
                <h4 className="text-base font-bold text-luxury-200">سلتك فارغة حالياً</h4>
                <p className="text-xs text-luxury-400 max-w-xs mx-auto">
                  تصفح قائمة الأطباق الفاخرة وأضف خياراتك المفضلة لتجربة عشاء استثنائية.
                </p>
              </div>
            ) : (
              cartItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-luxury-950/60 border border-luxury-800 rounded-2xl p-4 space-y-3 relative group transition-all hover:border-gold-500/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {(item.product?.image || item.productImage) && (
                        <img
                          src={item.product?.image || item.productImage}
                          alt={item.product?.name || item.productName}
                          className="w-14 h-14 rounded-xl object-cover border border-luxury-800 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-luxury-100 line-clamp-1">
                          {item.product?.name || item.productName}
                        </h4>
                        {item.options.size && (
                          <p className="text-[11px] text-gold-400/90 font-medium">
                            الحجم: {typeof item.options.size === 'object' ? item.options.size.name : item.options.size}
                          </p>
                        )}
                        {item.options.selectedAddOns && item.options.selectedAddOns.length > 0 && (
                          <p className="text-[11px] text-luxury-400 line-clamp-1">
                            إضافات: {item.options.selectedAddOns.map((a: any) => typeof a === 'object' ? a.name : a).join('، ')}
                          </p>
                        )}
                        {item.options.removedIngredients && item.options.removedIngredients.length > 0 && (
                          <p className="text-[11px] text-red-400/80 line-clamp-1">
                            استبعاد: {item.options.removedIngredients.join('، ')}
                          </p>
                        )}
                        {item.options.specialInstructions && (
                          <p className="text-[11px] text-luxury-400 italic line-clamp-1">
                            "{item.options.specialInstructions}"
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-left shrink-0">
                      <span className="text-sm font-bold text-gold-400">
                        {formatPrice(item.totalPrice || item.itemTotal || 0)}
                      </span>
                    </div>
                  </div>

                  {/* Quantity row */}
                  <div className="flex items-center justify-between pt-2 border-t border-luxury-800/60">
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-luxury-400 hover:text-red-400 p-1 rounded-md transition-colors text-xs flex items-center gap-1"
                      title="حذف"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>

                    <div className="flex items-center gap-2 bg-luxury-900 border border-luxury-800 rounded-xl p-0.5">
                      <button
                        onClick={() => updateCartItemQuantity(item.id, item.quantity - 1)}
                        className="w-6 h-6 rounded-lg bg-luxury-800 hover:bg-luxury-750 text-luxury-300 flex items-center justify-center transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center font-bold text-xs font-mono text-luxury-100">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateCartItemQuantity(item.id, item.quantity + 1)}
                        className="w-6 h-6 rounded-lg bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold flex items-center justify-center transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer & Checkout */}
          {cartItems.length > 0 && (
            <div className="p-5 bg-luxury-950 border-t border-luxury-800 space-y-4 shrink-0">
              {/* Order Notes Input */}
              <div>
                <label className="block text-[11px] font-bold text-luxury-300 mb-1">
                  ملاحظات عامة للطلب (اختياري)
                </label>
                <input
                  type="text"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="مثال: تقديم المقبلات أولاً، أطباق وملاعق إضافية..."
                  className="w-full bg-luxury-900 border border-luxury-800 rounded-xl px-3 py-2 text-xs text-luxury-100 placeholder-luxury-500 focus:outline-none focus:border-gold-500/60"
                />
              </div>

              {/* Subtotal & Payment Notice */}
              <div className="space-y-1.5 pt-2 border-t border-luxury-800/80">
                <div className="flex justify-between text-xs text-luxury-400">
                  <span>المجموع الفرعي</span>
                  <span className="font-mono">{formatPrice(cartSubtotal)}</span>
                </div>
                <div className="flex justify-between text-xs text-luxury-400">
                  <span>الضريبة والخدمة</span>
                  <span className="text-gold-400/90 font-medium">مشمولة</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-luxury-100 pt-1">
                  <span>الإجمالي النهائي</span>
                  <span className="text-gold-400 font-mono text-base">{formatPrice(cartSubtotal)}</span>
                </div>
              </div>

              {/* Payment Method Notice */}
              <div className="bg-luxury-900/90 border border-luxury-800 p-2.5 rounded-xl flex items-center gap-2.5 text-[11px] text-luxury-300">
                <Receipt className="w-4 h-4 text-gold-400 shrink-0" />
                <span>طريقة المحاسبة: الدفع نقداً أو بالبطاقة عند الكاشير بعد الانتهاء</span>
              </div>

              {/* Confirm CTA */}
              <button
                onClick={handleOpenConfirm}
                className="w-full py-3.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-sm shadow-gold-glow flex items-center justify-center gap-2 transition-all cursor-pointer"
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
