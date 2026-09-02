import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice, formatTime, getOrderStatusConfig } from '../../utils/formatting';
import { ChefHat, Clock, CheckCircle2, AlertCircle, Volume2, VolumeX, Sparkles, Filter, Utensils } from 'lucide-react';

export const KitchenDisplaySystem: React.FC = () => {
  const { orders, updateOrderStatus, currentRestaurant, soundEnabled, toggleSound, showToast } = useRestaurant();
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'PREPARING' | 'READY'>('ALL');

  const kitchenOrders = orders.filter((o) => o.status === 'PENDING' || o.status === 'PREPARING' || o.status === 'READY');

  const filteredOrders = kitchenOrders.filter((o) => {
    if (filter === 'ALL') return true;
    return o.status === filter;
  });

  const handleAdvanceStatus = (orderId: string, currentStatus: string) => {
    if (currentStatus === 'PENDING') {
      updateOrderStatus(orderId, 'PREPARING');
      showToast('info', 'جاري التحضير', `تم إدخال الطلب ${orderId} في مرحلة الطهي`);
    } else if (currentStatus === 'PREPARING') {
      updateOrderStatus(orderId, 'READY');
      showToast('success', 'الطلب جاهز للتقديم', `تم إشعار النادل بأن طلب ${orderId} جاهز للتقديم فوراً`);
    } else if (currentStatus === 'READY') {
      updateOrderStatus(orderId, 'SERVED');
      showToast('success', 'تم التقديم', `تم تسليم الطلب ${orderId} للزبون`);
    }
  };

  return (
    <div className="min-h-screen bg-[#07080A] text-luxury-50 p-4 sm:p-6 select-none" dir="rtl">
      {/* KDS Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-4 sm:p-5 rounded-2xl shadow-luxury mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-bold shadow-lg">
            <ChefHat className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-serif text-luxury-50">شاشة المطبخ والطهي (Kitchen Display)</h1>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <p className="text-xs text-luxury-400">
              {currentRestaurant?.name} · تحديث لحظي مباشر لطلبات الطاولات
            </p>
          </div>
        </div>

        {/* Action Controls & Sound */}
        <div className="flex items-center gap-2">
          {/* Status Filters */}
          <div className="flex items-center bg-luxury-950 p-1 rounded-xl border border-luxury-800">
            {[
              { id: 'ALL', label: `الكل (${kitchenOrders.length})` },
              { id: 'PENDING', label: `جديدة (${kitchenOrders.filter((o) => o.status === 'PENDING').length})` },
              { id: 'PREPARING', label: `قيد الطهي (${kitchenOrders.filter((o) => o.status === 'PREPARING').length})` },
              { id: 'READY', label: `جاهزة (${kitchenOrders.filter((o) => o.status === 'READY').length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  filter === tab.id
                    ? 'bg-amber-500 text-luxury-950 shadow-sm'
                    : 'text-luxury-400 hover:text-luxury-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={toggleSound}
            className="p-2.5 rounded-xl bg-luxury-950 border border-luxury-800 text-luxury-300 hover:text-gold-400 cursor-pointer"
            title={soundEnabled ? 'كتم التنبيهات' : 'تفعيل صوت التنبيه'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-gold-400" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Orders Grid */}
      {filteredOrders.length === 0 ? (
        <div className="p-16 text-center rounded-3xl bg-luxury-900/40 border border-luxury-800/80 my-8">
          <div className="w-16 h-16 rounded-full bg-luxury-800 text-luxury-400 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <h3 className="text-lg font-bold text-luxury-100">المطبخ جاهز بالكامل</h3>
          <p className="text-xs text-luxury-400 mt-1">لا توجد طلبات معلقة حالياً. ستظهر الطلبات هنا فور إرسالها من الطاولات.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredOrders.map((order) => {
            const isPending = order.status === 'PENDING';
            const isPreparing = order.status === 'PREPARING';
            const isReady = order.status === 'READY';
            const statusCfg = getOrderStatusConfig(order.status);

            return (
              <div
                key={order.id}
                className={`rounded-2xl border flex flex-col justify-between overflow-hidden shadow-2xl transition-all ${
                  isPending
                    ? 'bg-luxury-900 border-red-500/50 ring-1 ring-red-500/20 animate-pulse-slow'
                    : isPreparing
                    ? 'bg-luxury-900 border-amber-500/40'
                    : 'bg-luxury-900 border-emerald-500/50'
                }`}
              >
                {/* Card Header */}
                <div
                  className={`p-3.5 border-b flex items-center justify-between ${
                    isPending
                      ? 'bg-red-500/15 border-red-500/30 text-red-300'
                      : isPreparing
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base font-extrabold font-serif">
                      طاولة {order.tableId.replace('TABLE-', '')}
                    </span>
                    <span className="text-[10px] bg-black/40 px-2 py-0.5 rounded font-mono font-bold">
                      {order.id}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatTime(order.createdAt)}</span>
                  </div>
                </div>

                {/* Items List */}
                <div className="p-4 space-y-3 flex-1 overflow-y-auto max-h-72">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="pb-2.5 border-b border-luxury-800/60 last:border-0 last:pb-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-luxury-800 text-gold-400 font-bold text-xs flex items-center justify-center shrink-0 border border-luxury-700">
                            {item.quantity}×
                          </span>
                          <span className="text-sm font-bold text-luxury-100">
                            {item.productName || item.name}
                          </span>
                        </div>
                      </div>

                      {/* Customizations / Notes */}
                      {(item.selectedSize || (item.selectedAddOns && item.selectedAddOns.length > 0) || (item.removedIngredients && item.removedIngredients.length > 0) || item.specialInstructions) && (
                        <div className="mr-8 mt-1 space-y-0.5 text-[11px] text-luxury-400">
                          {item.selectedSize && (
                            <div className="text-gold-400 font-medium">الحجم: {typeof item.selectedSize === 'object' ? item.selectedSize.name : item.selectedSize}</div>
                          )}
                          {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                            <div className="text-emerald-400 font-medium">+ إضافات: {item.selectedAddOns.join(', ')}</div>
                          )}
                          {item.removedIngredients && item.removedIngredients.length > 0 && (
                            <div className="text-red-400 font-medium">- بدون: {item.removedIngredients.join(', ')}</div>
                          )}
                          {item.specialInstructions && (
                            <div className="text-amber-300 italic bg-amber-500/10 p-1 rounded mt-1 border border-amber-500/20">
                              ملاحظة: {item.specialInstructions}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {order.notes && (
                    <div className="bg-red-500/10 border border-red-500/30 p-2.5 rounded-xl text-xs text-red-300 font-bold">
                      ملاحظة الطاولة العامة: {order.notes}
                    </div>
                  )}
                </div>

                {/* Card Action Button */}
                <div className="p-3 bg-luxury-950 border-t border-luxury-800">
                  <button
                    onClick={() => handleAdvanceStatus(order.id, order.status)}
                    className={`w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer active:scale-98 ${
                      isPending
                        ? 'bg-amber-500 hover:bg-amber-400 text-luxury-950'
                        : isPreparing
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-luxury-950'
                        : 'bg-luxury-800 hover:bg-luxury-750 text-luxury-200 border border-luxury-700'
                    }`}
                  >
                    {isPending && (
                      <>
                        <ChefHat className="w-4 h-4" />
                        <span>بدء التحضير والطهي 👨‍🍳</span>
                      </>
                    )}
                    {isPreparing && (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>تم تجهيز الطلب (إشعار النادل) 🔔</span>
                      </>
                    )}
                    {isReady && (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>تم التسليم للزبون (إغلاق) ✔️</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
