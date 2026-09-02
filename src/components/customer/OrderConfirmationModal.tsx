import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
import { X, Check, ShoppingBag, Receipt, AlertCircle, Clock } from 'lucide-react';

interface OrderConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderNotes?: string;
}

export const OrderConfirmationModal: React.FC<OrderConfirmationModalProps> = ({
  isOpen,
  onClose,
  orderNotes,
}) => {
  const { cartItems, cartSubtotal, createOrder, activeTableId, currentRestaurant } = useRestaurant();
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleConfirmOrder = () => {
    setIsSubmitting(true);
    const result = createOrder(orderNotes);
    setIsSubmitting(false);

    if (result.success) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Confirmation Card */}
      <div
        className="relative w-full max-w-lg bg-luxury-900 border border-luxury-700 rounded-3xl p-6 z-10 shadow-2xl space-y-5 animate-fade-in text-right"
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-luxury-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-400">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-luxury-50 font-serif">
                تأكيد إرسال الطلب إلى المطبخ
              </h3>
              <p className="text-xs text-luxury-400">
                {currentRestaurant?.name} · طاولة رقم {activeTableId?.replace('TABLE-', '')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-luxury-400 hover:text-luxury-200 hover:bg-luxury-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Order Items Preview */}
        <div className="space-y-3 max-h-56 overflow-y-auto p-1 custom-scrollbar">
          <label className="block text-xs font-bold text-luxury-300 mb-1">ملخص الأصناف:</label>
          <div className="space-y-2">
            {cartItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-luxury-950 border border-luxury-800/80 text-xs"
              >
                <div>
                  <span className="font-bold text-luxury-100">
                    {item.quantity} × {item.product?.name || item.productName}
                  </span>
                  {item.options.size && (
                    <span className="text-gold-400/90 text-[11px] block">
                      الحجم: {typeof item.options.size === 'object' ? item.options.size.name : item.options.size}
                    </span>
                  )}
                  {item.options.selectedAddOns && item.options.selectedAddOns.length > 0 && (
                    <span className="text-luxury-400 text-[10px] block">
                      + {item.options.selectedAddOns.map((a: any) => typeof a === 'object' ? a.name : a).join(', ')}
                    </span>
                  )}
                </div>
                <span className="font-bold text-luxury-200 font-mono">
                  {formatPrice(item.totalPrice || item.itemTotal || 0)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Notes if any */}
        {orderNotes && (
          <div className="bg-luxury-950/50 p-3 rounded-xl border border-luxury-800 text-xs">
            <span className="font-bold text-luxury-400 block mb-1">ملاحظاتك للشيف:</span>
            <p className="text-luxury-200 italic">"{orderNotes}"</p>
          </div>
        )}

        {/* Total and Rules */}
        <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-2">
          <div className="flex justify-between items-center text-sm font-bold">
            <span className="text-luxury-200">الإجمالي المستحق</span>
            <span className="text-gold-400 font-mono text-base">{formatPrice(cartSubtotal)}</span>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-luxury-850 text-[11px] text-amber-300/90">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>المحاسبة تتم نقداً أو بالبطاقة عند الكاشير بعد الانتهاء من وجبتك.</span>
          </div>
        </div>

        {/* Submit CTA */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-1/3 py-3 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-luxury-300 font-bold text-xs transition-colors"
          >
            تعديل الطلب
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleConfirmOrder}
            className="flex-1 py-3 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs shadow-gold-glow flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>{isSubmitting ? 'جاري الإرسال...' : 'تأكيد وإرسال الطلب للمطبخ'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
