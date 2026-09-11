import React, { useEffect, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { soundFX } from '../../utils/audio';
import { ChefHat, ChevronLeft, X } from 'lucide-react';

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

/** A ready-state announcement, not a modal: it never blocks browsing or cart
 * work, while the persistent active-order bar remains the long-term anchor. */
export const OrderCompletedModal: React.FC = () => {
  const { activeTableOrders, activeTableNumber, activeTable, isOrderTrackingOpen, setIsOrderTrackingOpen } = useRestaurant();
  const [dismissedOrderIds, setDismissedOrderIds] = useState<string[]>(getDismissedCompletedOrderIds);

  const readyOrders = activeTableOrders.filter(
    (order) => order.status === 'READY' && !dismissedOrderIds.includes(order.id)
  );
  const readyKey = readyOrders.map((order) => order.id).join('|');

  useEffect(() => {
    if (readyKey && !isOrderTrackingOpen) soundFX.playBell();
  }, [readyKey, isOrderTrackingOpen]);

  if (readyOrders.length === 0 || isOrderTrackingOpen) return null;

  const latestOrder = readyOrders[0];
  const dismissReadyOrders = () => {
    const ids = readyOrders.map((order) => order.id);
    setDismissedOrderIds((previous) => {
      const next = Array.from(new Set([...previous, ...ids]));
      try {
        sessionStorage.setItem(COMPLETED_ORDERS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* session storage unavailable; in-memory dismissal still works */
      }
      return next;
    });
  };

  return (
    <div className="fixed top-20 left-3 right-3 z-40 max-w-md mx-auto pointer-events-none" dir="rtl">
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="pointer-events-auto bg-luxury-900/95 border border-emerald-500/50 backdrop-blur-md rounded-2xl p-3.5 shadow-2xl flex items-center gap-3 text-right animate-in slide-in-from-top duration-300"
      >
        <span className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0" aria-hidden="true">
          <ChefHat className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-luxury-50">
            طلبك {latestOrder.id} · طاولة رقم {activeTableNumber ?? activeTable?.tableNumber ?? '—'} جاهز للتقديم
          </p>
          <p className="text-[11px] text-luxury-300 mt-0.5">
            {readyOrders.length > 1
              ? `${readyOrders.length} طلبات جاهزة الآن. تابع تفاصيلها في حالة الطلب.`
              : 'أكمل تصفحك أو افتح حالة الطلب لمتابعة التقديم.'}
          </p>
          <button
            type="button"
            onClick={() => {
              dismissReadyOrders();
              setIsOrderTrackingOpen(true);
            }}
            className="mt-2 text-xs font-bold text-emerald-400 inline-flex items-center gap-1 min-h-8"
          >
            عرض حالة الطلب <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={dismissReadyOrders}
          className="self-start p-2 rounded-xl text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800"
          aria-label="إخفاء إشعار الطلب الجاهز"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
