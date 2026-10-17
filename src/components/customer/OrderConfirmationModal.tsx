import React, { useEffect, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice, formatTableNumber } from '../../utils/formatting';
import { getSavedGuestName, saveGuestName } from '../../utils/guestOrderOwnership';
import { X, Check, ShoppingBag, AlertCircle, Banknote, CreditCard, User } from 'lucide-react';

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
  const {
    cartItems,
    cartSubtotal,
    createOrder,
    activeTableId,
    activeTableNumber,
    activeTable,
    currentRestaurant,
  } = useRestaurant();
  const currency = currentRestaurant?.currency || '₪';
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customerName, setCustomerName] = useState<string>(() => getSavedGuestName());
  const [paymentMethod, setPaymentMethod] = useState<'CASHIER' | 'TRANSFER'>('CASHIER');

  useEffect(() => {
    if (isOpen) {
      const saved = getSavedGuestName();
      if (saved && !customerName) {
        setCustomerName(saved);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useDialog({ isOpen: isOpen, onClose: onClose });

  if (!isOpen) return null;

  const handleConfirmOrder = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const trimmedName = customerName.trim();
    if (trimmedName) {
      saveGuestName(trimmedName);
    }
    const result = await createOrder(orderNotes, {
      customerName: trimmedName || undefined,
      paymentMethod,
    });
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-confirmation-title"
        className="relative w-full max-w-lg bg-m-surface border border-m-hairline rounded-3xl p-6 z-10 shadow-2xl space-y-4 animate-fade-in text-right max-h-[92vh] overflow-y-auto"
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-m-hairline pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[rgb(var(--m-brand-on-surface-rgb)/0.1)] border border-[rgb(var(--m-brand-on-surface-rgb)/0.3)] flex items-center justify-center text-[var(--m-brand-on-surface)]">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h3 id="order-confirmation-title" className="text-base font-bold text-m-text font-serif">
                تأكيد الطلب
              </h3>
              <p className="text-xs text-m-text-muted">
                {currentRestaurant?.name} · طاولة رقم {activeTableNumber ?? activeTable?.tableNumber ?? (activeTableId ? formatTableNumber(activeTableId) || '—' : '—')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="p-2 rounded-xl text-m-text-muted hover:text-m-text hover:bg-m-surface-raised transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Order Items Preview */}
        <div className="space-y-2 max-h-44 overflow-y-auto p-1 custom-scrollbar">
          <label className="block text-xs font-bold text-m-text-muted mb-1">ملخص الأصناف:</label>
          <div className="space-y-2">
            {cartItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-m-bg border border-m-hairline/80 text-xs"
              >
                <div>
                  <span className="font-bold text-m-text">
                    {item.quantity} × {item.product?.name || item.productName}
                  </span>
                  {item.options.size && (
                    <span className="text-[rgb(var(--m-brand-on-surface-rgb)/0.9)] text-[11px] block">
                      الحجم: {typeof item.options.size === 'object' ? item.options.size.name : item.options.size}
                    </span>
                  )}
                  {item.options.selectedAddOns && item.options.selectedAddOns.length > 0 && (
                    <span className="text-m-text-muted text-[10px] block">
                      + {item.options.selectedAddOns.map((a: any) => typeof a === 'object' ? a.name : a).join(', ')}
                    </span>
                  )}
                </div>
                <span className="font-bold text-m-text font-mono">
                  {formatPrice(item.totalPrice || item.itemTotal || 0, currency)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Notes if any */}
        {orderNotes && (
          <div className="bg-m-bg/50 p-3 rounded-xl border border-m-hairline text-xs">
            <span className="font-bold text-m-text-muted block mb-1">ملاحظاتك للشيف:</span>
            <p className="text-m-text italic">"{orderNotes}"</p>
          </div>
        )}

        {/* Guest Name Attribution (for multi-guest table sessions) */}
        <div className="space-y-1.5">
          <label
            htmlFor="order-confirm-guest-name"
            className="flex items-center gap-1.5 text-xs font-bold text-m-text"
          >
            <User className="w-3.5 h-3.5 text-[var(--m-brand-on-surface)]" />
            <span>اسم صاحب الطلب (لتمييز طلبك على الطاولة)</span>
          </label>
          <input
            id="order-confirm-guest-name"
            type="text"
            maxLength={60}
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="مثال: أحمد، سارة (يظهر اسمك فقط لزملائك على الطاولة)"
            className="w-full bg-m-bg border border-m-hairline rounded-xl px-3.5 py-2.5 text-xs text-m-text placeholder:text-m-text-subtle focus:outline-none focus:border-[rgb(var(--m-brand-on-surface-rgb)/0.6)]"
          />
        </div>

        {/* Upfront Payment Method Selection */}
        <div className="space-y-2">
          <span className="block text-xs font-bold text-m-text">اختر طريقة الدفع:</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="طريقة الدفع">
            <button
              type="button"
              role="radio"
              aria-checked={paymentMethod === 'CASHIER'}
              onClick={() => setPaymentMethod('CASHIER')}
              className={`p-3 rounded-2xl border text-right transition-all cursor-pointer flex items-start gap-2.5 ${
                paymentMethod === 'CASHIER'
                  ? 'bg-[rgb(var(--m-brand-on-surface-rgb)/0.14)] border-[var(--m-brand-on-surface)] text-m-text shadow-sm'
                  : 'bg-m-bg border-m-hairline text-m-text-muted hover:border-[rgb(var(--m-brand-on-surface-rgb)/0.4)]'
              }`}
            >
              <Banknote className="w-4 h-4 mt-0.5 shrink-0 text-[var(--m-brand-on-surface)]" />
              <div>
                <div className="text-xs font-bold text-m-text">نقداً أو بطاقة عند الكاشير</div>
                <div className="text-[10px] text-m-text-muted mt-0.5 leading-relaxed">
                  ادفع مباشرة لدى الكاشير لتأكيد الطلب وإرساله للمطبخ
                </div>
              </div>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={paymentMethod === 'TRANSFER'}
              onClick={() => setPaymentMethod('TRANSFER')}
              className={`p-3 rounded-2xl border text-right transition-all cursor-pointer flex items-start gap-2.5 ${
                paymentMethod === 'TRANSFER'
                  ? 'bg-[rgb(var(--m-brand-on-surface-rgb)/0.14)] border-[var(--m-brand-on-surface)] text-m-text shadow-sm'
                  : 'bg-m-bg border-m-hairline text-m-text-muted hover:border-[rgb(var(--m-brand-on-surface-rgb)/0.4)]'
              }`}
            >
              <CreditCard className="w-4 h-4 mt-0.5 shrink-0 text-[var(--m-brand-on-surface)]" />
              <div>
                <div className="text-xs font-bold text-m-text">حوالة بنكية أو محفظة</div>
                <div className="text-[10px] text-m-text-muted mt-0.5 leading-relaxed">
                  حوّل المبلغ وأرفق صورة الإشعار في الخطوة التالية
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Total and Rules */}
        <div className="p-4 rounded-2xl bg-m-bg border border-m-hairline space-y-2">
          <div className="flex justify-between items-center text-sm font-bold">
            <span className="text-m-text">الإجمالي المستحق</span>
            <span className="text-[var(--m-brand-on-surface)] font-mono text-base">{formatPrice(cartSubtotal, currency)}</span>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-m-hairline text-[11px] text-amber-300/90">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>يتم تأكيد الطلب وبدء التحضير فور الدفع نقداً أو بالبطاقة لدى الكاشير، أو عبر التحويل.</span>
          </div>
        </div>

        {/* Submit CTA */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-1/3 py-3 rounded-xl bg-m-surface-raised hover:bg-m-surface-raised text-m-text-muted font-bold text-xs transition-colors cursor-pointer"
          >
            تعديل الطلب
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleConfirmOrder}
            className="flex-1 py-3 rounded-xl brand-cta font-bold text-xs shadow-[0_0_22px_-6px_var(--m-brand-glow)] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>
              {isSubmitting
                ? 'جاري التأكيد...'
                : paymentMethod === 'TRANSFER'
                  ? 'تأكيد والمتابعة لإرفاق الحوالة'
                  : 'تأكيد الطلب'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
