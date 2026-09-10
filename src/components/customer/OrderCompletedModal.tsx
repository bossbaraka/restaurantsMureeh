import React, { useEffect, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Order } from '../../types/restaurant';
import { formatPrice, formatTableNumber } from '../../utils/formatting';
import { soundFX } from '../../utils/audio';
import { CustomerRatingModal } from './CustomerRatingModal';
import {
  Sparkles,
  CheckCircle2,
  ChefHat,
  Bell,
  Star,
  Share2,
  X,
} from 'lucide-react';

export const COMPLETED_ORDERS_STORAGE_KEY = 'merar_dismissed_completed_orders';

export function getDismissedCompletedOrderIds(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const saved = sessionStorage.getItem(COMPLETED_ORDERS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export const OrderCompletedModal: React.FC = () => {
  const {
    activeTableOrders,
    activeTableId,
    activeTableNumber,
    activeTable,
    currentRestaurant,
    isOrderTrackingOpen,
    setIsWaiterModalOpen,
    showToast,
  } = useRestaurant();
  const currency = currentRestaurant?.currency || '₪';

  const [dismissedOrderIds, setDismissedOrderIds] = useState<string[]>(() => getDismissedCompletedOrderIds());
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);

  // Find newly ready order that hasn't been dismissed yet
  const readyOrder = activeTableOrders.find(
    (o) => o.status === 'READY' && !dismissedOrderIds.includes(o.id)
  );

  useEffect(() => {
    if (readyOrder && !isOrderTrackingOpen) {
      soundFX.playBell();
    }
  }, [readyOrder?.id, isOrderTrackingOpen]);

  // Suppress modal if order tracking drawer is already open to avoid layout overlap
  if (!readyOrder || isOrderTrackingOpen) {
    return isRatingModalOpen ? <CustomerRatingModal isOpen={true} onClose={() => setIsRatingModalOpen(false)} /> : null;
  }

  const tableNumStr =
    activeTableNumber != null
      ? String(activeTableNumber)
      : activeTable?.tableNumber != null
      ? String(activeTable.tableNumber)
      : activeTableId
      ? formatTableNumber(activeTableId) || '—'
      : '—';

  const handleDismiss = () => {
    if (!readyOrder) return;
    setDismissedOrderIds((prev) => {
      const next = Array.from(new Set([...prev, readyOrder.id]));
      try {
        sessionStorage.setItem(COMPLETED_ORDERS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  };

  const handleShareWhatsApp = (order: Order) => {
    const restName = currentRestaurant?.name || '';
    const itemsList = order.items.map((i) => `• ${i.quantity}x ${i.productName || i.name} (${formatPrice(i.totalPrice, currency)})`).join('\n');
    const msg = `🧾 *فاتورة إلكترونية - ${restName}*\n📍 *طاولة رقم:* ${tableNumStr}\n🔢 *رقم الطلب:* ${order.id}\n\n*الأصناف:*\n${itemsList}\n\n💰 *الإجمالي:* ${formatPrice(order.total, currency)}\n💳 *طريقة الدفع:* الدفع عند الكاشير\n\n✨ شكراً لزيارتكم!`;

    const encoded = encodeURIComponent(msg);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
    showToast('success', 'تم فتح واتساب', 'تم تجهيز الفاتورة للمشاركة');
  };

  return (
    <>
      <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-4">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md transition-opacity" onClick={handleDismiss} />

        {/* Modal Dialog */}
        <div
          className="relative w-full max-w-md bg-luxury-900 border border-[rgb(var(--brand-primary-strong-rgb)/0.5)] rounded-3xl p-6 z-10 shadow-2xl space-y-5 animate-in zoom-in-95 duration-300 text-right"
          dir="rtl"
        >
          {/* Top Close Button */}
          <button
            onClick={handleDismiss}
            className="absolute top-4 left-4 p-2 rounded-xl text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800 transition-colors cursor-pointer"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Celebration Icon Header */}
          <div className="text-center space-y-3 pt-2">
            <div className="relative inline-flex">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-emerald-500/20 to-[rgb(var(--brand-primary-strong-rgb)/0.3)] border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-[0_0_22px_-6px_var(--brand-glow)] animate-bounce">
                <ChefHat className="w-10 h-10" />
              </div>
              <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 text-luxury-950 flex items-center justify-center text-xs font-bold shadow-lg">
                ✓
              </span>
            </div>

            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>إشعار المطبخ الحي</span>
              </div>
              <h3 className="text-xl font-bold text-luxury-50 font-serif">
                🎉 تم إنجاز طلبك بنجاح!
              </h3>
              <p className="text-xs text-luxury-300 mt-1 leading-relaxed">
                طلبك <strong className="text-[var(--brand-primary-strong)] font-mono">#{readyOrder.id}</strong> أصبح جاهزاً بالكامل الآن، وطاقم الخدمة في طريقه إلى <strong className="text-[var(--brand-primary-strong)]">طاولة رقم {tableNumStr}</strong>.
              </p>
            </div>
          </div>

          {/* Order Details Preview */}
          <div className="p-4 rounded-2xl bg-luxury-950/70 border border-luxury-800 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-luxury-800 pb-2">
              <span className="text-luxury-400">ملخص الأصناف المجهزة:</span>
              <span className="font-bold text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                جاهز للتقديم
              </span>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
              {readyOrder.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-luxury-100">
                  <span>
                    {item.quantity}× {item.productName || item.name}
                  </span>
                  <span className="font-mono text-luxury-300">{formatPrice(item.totalPrice, currency)}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-luxury-800 font-bold">
              <span className="text-luxury-300">الإجمالي النهائي:</span>
              <span className="text-[var(--brand-primary-strong)] font-mono text-sm">{formatPrice(readyOrder.total, currency)}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              onClick={() => {
                handleDismiss();
                setIsWaiterModalOpen(true);
              }}
              className="p-3 rounded-2xl bg-luxury-800 hover:bg-luxury-750 border border-luxury-700 text-luxury-100 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Bell className="w-4 h-4 text-[var(--brand-primary-strong)]" />
              <span>استدعاء النادل</span>
            </button>

            <button
              onClick={() => {
                handleDismiss();
                setIsRatingModalOpen(true);
              }}
              className="p-3 rounded-2xl brand-cta font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-[0_0_22px_-6px_var(--brand-glow)] cursor-pointer"
            >
              <Star className="w-4 h-4 fill-luxury-950" />
              <span>تقييم الوجبة</span>
            </button>
          </div>

          <button
            onClick={() => handleShareWhatsApp(readyOrder)}
            className="w-full p-2.5 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>مشاركة الفاتورة الإلكترونية عبر واتساب</span>
          </button>
        </div>
      </div>

      {isRatingModalOpen && <CustomerRatingModal isOpen={true} onClose={() => setIsRatingModalOpen(false)} />}
    </>
  );
};
