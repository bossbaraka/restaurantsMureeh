import React from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { getOrderStatusConfig, formatPrice } from '../../utils/formatting';
import { ChefHat, ChevronLeft, ArrowLeft } from 'lucide-react';

export const ActiveOrdersFloatingBar: React.FC = () => {
  const { activeTableOrders, setIsOrderTrackingOpen, isCartOpen, isOrderTrackingOpen } = useRestaurant();

  if (activeTableOrders.length === 0 || isCartOpen || isOrderTrackingOpen) return null;

  const latestOrder = activeTableOrders[0];
  const statusCfg = getOrderStatusConfig(latestOrder.status);

  return (
    <div className="fixed bottom-4 left-4 right-4 z-30 max-w-lg mx-auto select-none animate-in slide-in-from-bottom duration-300">
      <button
        onClick={() => setIsOrderTrackingOpen(true)}
        className="w-full bg-luxury-900/95 border border-gold-500/40 backdrop-blur-md rounded-2xl p-3.5 shadow-luxury flex items-center justify-between text-right group hover:border-gold-500/70 transition-all active:scale-[0.99]"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-400 shrink-0">
            <ChefHat className="w-5 h-5" />
          </div>

          <div className="text-right">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-luxury-50">
                طلب {latestOrder.id}
              </span>
              {activeTableOrders.length > 1 && (
                <span className="text-[10px] bg-luxury-800 text-gold-300 px-1.5 py-0.5 rounded-full">
                  +{activeTableOrders.length - 1} طلبات أخرى
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotColor}`} />
              <span className="text-xs text-gold-300 font-medium">{statusCfg.label}</span>
              <span className="text-[11px] text-luxury-400 mr-1.5">
                ({formatPrice(latestOrder.total)})
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 text-xs font-bold text-gold-400 group-hover:translate-x-[-2px] transition-transform">
          <span>متابعة</span>
          <ArrowLeft className="w-4 h-4" />
        </div>
      </button>
    </div>
  );
};
