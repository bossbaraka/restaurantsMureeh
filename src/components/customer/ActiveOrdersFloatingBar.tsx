import React from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { getOrderStatusConfig, formatPrice } from '../../utils/formatting';
import { ChefHat, ChevronLeft, ArrowLeft } from 'lucide-react';

export const ActiveOrdersFloatingBar: React.FC = () => {
  const { currentRestaurant,  activeTableOrders, setIsOrderTrackingOpen, isCartOpen, isOrderTrackingOpen } = useRestaurant();
  const currency = currentRestaurant?.currency || '₪';

  if (activeTableOrders.length === 0 || isCartOpen || isOrderTrackingOpen) return null;

  const latestOrder = activeTableOrders[0];
  const statusCfg = getOrderStatusConfig(latestOrder.status);

  return (
    <div
      className="fixed left-4 right-4 z-30 max-w-lg mx-auto select-none animate-in slide-in-from-bottom duration-300"
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <button
        onClick={() => setIsOrderTrackingOpen(true)}
        aria-label="متابعة حالة الطلب"
        className="w-full min-w-0 border border-m-hairline backdrop-blur-md rounded-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-right group hover:border-m-hairline-strong transition-all active:scale-[0.99]"
        style={{ backgroundColor: 'color-mix(in srgb, var(--m-surface) 95%, transparent)', boxShadow: 'var(--m-shadow-lg)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-[rgb(var(--m-brand-on-surface-rgb)/0.1)] border border-m-hairline flex items-center justify-center text-[var(--m-brand-on-surface)] shrink-0">
            <ChefHat className="w-5 h-5" />
          </div>

          <div className="text-right min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-m-text truncate">
                طلب {latestOrder.id}
              </span>
              {activeTableOrders.length > 1 && (
                <span className="text-[10px] bg-m-surface-raised text-[var(--m-brand-on-surface)] px-1.5 py-0.5 rounded-full">
                  +{activeTableOrders.length - 1} طلبات أخرى
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotColor}`} />
              <span className="text-xs text-[var(--m-brand-on-surface)] font-medium">{statusCfg.label}</span>
              <span className="text-[11px] text-m-text-muted mr-1.5">
                ({formatPrice(latestOrder.total, currency)})
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 text-xs font-bold text-[var(--m-brand-on-surface)] group-hover:translate-x-[-2px] transition-transform">
          <span className="hidden sm:inline">متابعة الطلب</span>
          <ArrowLeft className="w-4 h-4" />
        </div>
      </button>
    </div>
  );
};
