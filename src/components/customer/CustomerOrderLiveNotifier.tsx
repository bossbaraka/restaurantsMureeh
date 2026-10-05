import React, { useState, useEffect, useRef } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { OrderStatus } from '../../types/restaurant';
import { formatPrice, getOrderStatusConfig, formatTableNumber } from '../../utils/formatting';
import { soundFX } from '../../utils/audio';
import { getDismissedCompletedOrderIds } from './OrderCompletedModal';
import {
  ChefHat,
  Bell,
  Utensils,
  X,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';

interface NotificationState {
  orderId: string;
  status: OrderStatus;
  orderNumber: string;
  itemCount: number;
  total: number;
  updatedAt: string;
}

export const CustomerOrderLiveNotifier: React.FC = () => {
  const {
    activeTableOrders,
    activeTableId,
    activeTableNumber,
    activeTable,
    viewMode,
    currentRestaurant,
    setIsOrderTrackingOpen,
    setIsWaiterModalOpen,
    isCartOpen,
    isOrderTrackingOpen,
    isWaiterModalOpen,
    isTableSelectorOpen,
  } = useRestaurant();

  const [activeNotification, setActiveNotification] = useState<NotificationState | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const prevStatusMapRef = useRef<Record<string, OrderStatus>>({});
  const currency = currentRestaurant?.currency || '₪';

  useEffect(() => {
    if (viewMode !== 'CUSTOMER' || activeTableOrders.length === 0) return;

    activeTableOrders.forEach((order) => {
      const prevStatus = prevStatusMapRef.current[order.id];
      if (prevStatus && prevStatus !== order.status) {
        // Trigger live notification popover for customer
        const orderNum = order.id.slice(-6).toUpperCase();
        setActiveNotification({
          orderId: order.id,
          status: order.status,
          orderNumber: orderNum,
          itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0),
          total: order.total,
          updatedAt: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
        });
        setIsDismissed(false);

        // Sound cues
        if (order.status === 'READY') soundFX.playBell();
        else if (order.status === 'PREPARING' || order.status === 'SERVED') soundFX.playChime();
      }
      prevStatusMapRef.current[order.id] = order.status;
    });
  }, [activeTableOrders, viewMode]);

  // Auto-dismiss notification after 6 seconds to prevent blocking menu browsing
  useEffect(() => {
    if (!activeNotification || isDismissed) return;
    const timer = setTimeout(() => {
      setIsDismissed(true);
    }, 6000);
    return () => clearTimeout(timer);
  }, [activeNotification, isDismissed]);

  // Prevent overlapping with active drawers, modals, or the completed order modal
  const isCompletedModalActive = activeTableOrders.some(
    (o) => o.status === 'READY' && !getDismissedCompletedOrderIds().includes(o.id)
  );

  if (
    viewMode !== 'CUSTOMER' ||
    !activeNotification ||
    isDismissed ||
    isCartOpen ||
    isOrderTrackingOpen ||
    isWaiterModalOpen ||
    isTableSelectorOpen ||
    isCompletedModalActive
  ) {
    return null;
  }

  const statusCfg = getOrderStatusConfig(activeNotification.status);
  const tableNum =
    activeTableNumber != null
      ? String(activeTableNumber)
      : activeTable?.tableNumber != null
      ? String(activeTable.tableNumber)
      : activeTableId
      ? formatTableNumber(activeTableId) || '—'
      : '—';

  // The step index comes from `getOrderStatusConfig`, the ONE owner of the
  // order-lifecycle model. This component used to carry a private copy of the
  // same switch, and the copy drifted in the one place that matters: its
  // `default` returned 1, so a CANCELLED order lit up step 1 («received»)
  // instead of showing no progress at all. The canonical map returns 0 for
  // every non-progressing status, which is what the timeline below expects.
  const currentStep = statusCfg.stepIndex;

  return (
    <div className="fixed top-28 sm:top-24 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-40 animate-in fade-in slide-in-from-top-3 duration-300 select-none">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label="تحديث حالة الطلب"
        className="bg-m-surface/95 border border-[rgb(var(--m-brand-on-surface-rgb)/0.5)] backdrop-blur-xl rounded-2xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.8)] space-y-3.5 text-right text-m-text relative overflow-hidden"
      >
        {/* Top glowing ambient line */}
        <div
          className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[var(--m-brand-on-surface)] to-transparent"
        />

        {/* Header with close button */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsDismissed(true)}
            className="touch-target p-1.5 rounded-lg text-m-text-muted hover:text-white hover:bg-m-surface-raised transition-colors"
            title="إغلاق التنبيه"
            aria-label="إغلاق التنبيه"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-m-text-muted">{activeNotification.updatedAt}</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgb(var(--m-success-rgb,16_185_129)/0.2)] text-[rgb(var(--m-success-strong-rgb,52_211_153))] text-[10px] font-bold border border-[rgb(var(--m-success-rgb,16_185_129)/0.3)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--m-success-strong-rgb,52_211_153))] animate-ping" />
              تحديث حي
            </span>
          </div>
        </div>

        {/* Main Status Banner */}
        <div className="flex items-start gap-3">
          {/* The status tile is painted from `statusCfg` — the same canonical
              config the order tracker and the hero stepper render from.
              It used to carry a THIRD, independent palette here, and that
              palette was shifted one step relative to canonical (PREPARING
              painted amber, which is PENDING's colour; SERVED painted sky,
              which is PREPARING's), so a guest could read two different
              colours for the same order on the same screen. It was also
              theme-blind — those -400 shades are dark-surface inks and fall
              to ~1.9:1 on the light canvas, which is this menu's default. */}
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border shadow-lg ${statusCfg.badgeBg} ${statusCfg.badgeText}${
              activeNotification.status === 'READY' ? ' animate-bounce' : ''
            }`}
          >
            {activeNotification.status === 'PREPARING' ? (
              <ChefHat className="w-6 h-6 animate-pulse" />
            ) : activeNotification.status === 'READY' ? (
              <Bell className="w-6 h-6" />
            ) : activeNotification.status === 'SERVED' ? (
              <Utensils className="w-6 h-6" />
            ) : (
              <Sparkles className="w-6 h-6" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <h4 className="text-sm font-bold text-m-text flex items-center gap-1.5">
                <span>{statusCfg.label}</span>
              </h4>
              <span className="text-xs font-mono font-bold text-[var(--m-brand-on-surface)]">
                طاولة {tableNum}
              </span>
            </div>

            <p className="text-xs text-m-text-muted mt-0.5 leading-relaxed">
              {activeNotification.status === 'PREPARING' && '👨‍🍳 بدأ الشيف بتحضير طلبك بخصائصه الفاخرة.'}
              {activeNotification.status === 'READY' && '🎉 اكتمل تحضير أطباقك والنادل في طريقه لطاولتك!'}
              {activeNotification.status === 'SERVED' && '🍽️ تم تقديم الطلب على طاولتك. بالهناء والشفاء!'}
              {activeNotification.status === 'PENDING' && '📋 تم تسجيل الطلب وفي انتظار التجهيز.'}
              {activeNotification.status === 'CANCELLED' && '⚠️ تم التعديل على الطلب من قبل المطبخ.'}
            </p>

            <div className="flex items-center gap-2 mt-1.5 text-[11px] text-m-text-muted">
              <span>طلب #{activeNotification.orderNumber}</span>
              <span>•</span>
              <span>{activeNotification.itemCount} أصناف</span>
              <span>•</span>
              <span className="text-m-text font-bold">{formatPrice(activeNotification.total, currency)}</span>
            </div>
          </div>
        </div>

        {/* 4-Step Visual Timeline Tracker */}
        <div className="pt-2 border-t border-m-hairline/80">
          <div className="grid grid-cols-4 gap-1 text-center">
            {[
              { label: 'المستلم', status: 'PENDING' as OrderStatus },
              { label: 'التحضير', status: 'PREPARING' as OrderStatus },
              { label: 'جاهز', status: 'READY' as OrderStatus },
              { label: 'تم التقديم', status: 'SERVED' as OrderStatus },
            ].map((s) => {
              const step = getOrderStatusConfig(s.status).stepIndex;
              const isActive = step > 0 && step <= currentStep;
              const isCurrent = step === currentStep;
              return (
                <div key={s.status} className="space-y-1">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      isActive
                        ? isCurrent
                          ? 'bg-gradient-to-r from-m-brand to-[var(--m-success)] shadow-[0_0_8px_rgb(var(--m-success-rgb)/0.6)]'
                          : 'bg-[var(--m-success)]'
                        : 'bg-m-surface-raised'
                    }`}
                  />
                  {/* "Completed" is a success state, not a per-status state, so
                      it resolves --m-success/-strong rather than a literal
                      palette shade — the -strong token is mode-aware, which
                      the fixed -300 shade was not (~1.9:1 on the light
                      canvas). */}
                  <span
                    className={`text-[11px] font-bold block transition-colors ${
                      isActive
                        ? 'text-[rgb(var(--m-success-strong-rgb,52_211_153))]'
                        : 'text-m-text-subtle'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => {
              setIsOrderTrackingOpen(true);
              setIsDismissed(true);
            }}
            className="flex-1 py-2 rounded-xl brand-fill font-bold text-xs flex items-center justify-center gap-1.5 shadow-[0_0_18px_-4px_var(--m-brand-glow)] active:scale-95 transition-all cursor-pointer"
          >
            <span>👨‍🍳 تتبع المطبخ الحي</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsWaiterModalOpen(true)}
            className="px-3 py-2 rounded-xl bg-m-surface-raised hover:bg-m-surface-raised text-m-text font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
            title="استدعاء النادل"
          >
            <Bell className="w-3.5 h-3.5 text-m-brand-strong" />
            <span>النادل</span>
          </button>
        </div>
      </div>
    </div>
  );
};
