import React, { useState, useEffect, useRef } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Order, OrderStatus } from '../../types/restaurant';
import { formatPrice, formatTime, getOrderStatusConfig, formatTableNumber } from '../../utils/formatting';
import { soundFX } from '../../utils/audio';
import { getDismissedCompletedOrderIds } from './OrderCompletedModal';
import {
  ChefHat,
  Bell,
  Utensils,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowLeft,
  Clock,
  Sparkles,
  Flame,
  Volume2,
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

  const getStepProgress = (status: OrderStatus) => {
    switch (status) {
      case 'PENDING':
        return 1;
      case 'PREPARING':
        return 2;
      case 'READY':
        return 3;
      case 'SERVED':
        return 4;
      default:
        return 1;
    }
  };

  const currentStep = getStepProgress(activeNotification.status);

  return (
    <div className="fixed top-28 sm:top-24 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-40 animate-in fade-in slide-in-from-top-3 duration-300 select-none">
      <div className="bg-luxury-900/95 border border-[rgb(var(--brand-primary-strong-rgb)/0.5)] backdrop-blur-xl rounded-2xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.8)] space-y-3.5 text-right text-luxury-50 relative overflow-hidden">
        {/* Top glowing ambient line */}
        <div
          className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[var(--brand-primary-strong)] to-transparent"
        />

        {/* Header with close button */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setIsDismissed(true)}
            className="p-1 rounded-lg text-luxury-400 hover:text-white hover:bg-luxury-800 transition-colors"
            title="إغلاق التنبيه"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-luxury-400">{activeNotification.updatedAt}</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              تحديث حي
            </span>
          </div>
        </div>

        {/* Main Status Banner */}
        <div className="flex items-start gap-3">
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border shadow-lg ${
              activeNotification.status === 'READY'
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 animate-bounce'
                : activeNotification.status === 'PREPARING'
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                : activeNotification.status === 'SERVED'
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                : 'bg-gold-500/15 border-gold-500/40 text-gold-400'
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
              <h4 className="text-sm font-bold text-luxury-50 flex items-center gap-1.5">
                <span>{statusCfg.label}</span>
              </h4>
              <span className="text-xs font-mono font-bold text-[var(--brand-primary-strong)]">
                طاولة {tableNum}
              </span>
            </div>

            <p className="text-xs text-luxury-300 mt-0.5 leading-relaxed">
              {activeNotification.status === 'PREPARING' && '👨‍🍳 بدأ الشيف بتحضير طلبك بخصائصه الفاخرة.'}
              {activeNotification.status === 'READY' && '🎉 اكتمل تحضير أطباقك والنادل في طريقه لطاولتك!'}
              {activeNotification.status === 'SERVED' && '🍽️ تم تقديم الطلب على طاولتك. بالهناء والشفاء!'}
              {activeNotification.status === 'PENDING' && '📋 تم تسجيل الطلب وفي انتظار التجهيز.'}
              {activeNotification.status === 'CANCELLED' && '⚠️ تم التعديل على الطلب من قبل المطبخ.'}
            </p>

            <div className="flex items-center gap-2 mt-1.5 text-[11px] text-luxury-400">
              <span>طلب #{activeNotification.orderNumber}</span>
              <span>•</span>
              <span>{activeNotification.itemCount} أصناف</span>
              <span>•</span>
              <span className="text-luxury-200 font-bold">{formatPrice(activeNotification.total, currency)}</span>
            </div>
          </div>
        </div>

        {/* 4-Step Visual Timeline Tracker */}
        <div className="pt-2 border-t border-luxury-800/80">
          <div className="grid grid-cols-4 gap-1 text-center">
            {[
              { label: 'المستلم', step: 1 },
              { label: 'التحضير', step: 2 },
              { label: 'جاهز', step: 3 },
              { label: 'تم التقديم', step: 4 },
            ].map((s) => {
              const isActive = s.step <= currentStep;
              const isCurrent = s.step === currentStep;
              return (
                <div key={s.step} className="space-y-1">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      isActive
                        ? isCurrent
                          ? 'bg-gradient-to-r from-gold-500 to-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]'
                          : 'bg-emerald-500'
                        : 'bg-luxury-800'
                    }`}
                  />
                  <span
                    className={`text-[11px] font-bold block transition-colors ${
                      isActive ? 'text-emerald-300' : 'text-luxury-500'
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
            className="flex-1 py-2 rounded-xl brand-fill font-bold text-xs flex items-center justify-center gap-1.5 shadow-[0_0_18px_-4px_var(--brand-glow)] active:scale-95 transition-all cursor-pointer"
          >
            <span>👨‍🍳 تتبع المطبخ الحي</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsWaiterModalOpen(true)}
            className="px-3 py-2 rounded-xl bg-luxury-800 hover:bg-luxury-750 text-luxury-200 font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
            title="استدعاء النادل"
          >
            <Bell className="w-3.5 h-3.5 text-gold-400" />
            <span>النادل</span>
          </button>
        </div>
      </div>
    </div>
  );
};
