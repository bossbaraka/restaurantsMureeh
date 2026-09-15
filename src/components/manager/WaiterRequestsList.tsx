import React from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatTime, formatRelativeMinutes, formatTableNumber } from '../../utils/formatting';
import { Bell, CheckCircle2, Clock, HelpCircle, Receipt, Droplets, Sparkles, Check, UtensilsCrossed, Footprints } from 'lucide-react';

export const WaiterRequestsList: React.FC = () => {
  const { waiterRequests, tables, resolveWaiterRequest, acknowledgeWaiterRequest, isMutationPending } = useRestaurant();

  const getTableLabel = (tableId: string) => {
    const found = tables.find((t) => t.id === tableId);
    if (found) return `طاولة ${found.tableNumber}`;
    return `طاولة ${formatTableNumber(tableId)}`;
  };

  const pendingRequests = waiterRequests.filter((w) => w.status === 'PENDING');
  const acknowledgedRequests = waiterRequests.filter((w) => w.status === 'ACKNOWLEDGED');
  const activeRequests = [...pendingRequests, ...acknowledgedRequests].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const resolvedRequests = waiterRequests.filter((w) => w.status === 'RESOLVED');

  // Icons cover BOTH the guest-facing reason codes (ASSISTANCE, WATER_REFILL,
  // CLEANING, EXTRA_CUTLERY, BILL) and the legacy 'WATER' value kept for old
  // records, so every call reads at a glance in the noisy dining room.
  const getReasonIcon = (reason: string) => {
    switch (reason) {
      case 'BILL':
        return <Receipt className="w-5 h-5 text-purple-400" />;
      case 'WATER_REFILL':
      case 'WATER':
        return <Droplets className="w-5 h-5 text-sky-400" />;
      case 'CLEANING':
        return <Sparkles className="w-5 h-5 text-emerald-400" />;
      case 'EXTRA_CUTLERY':
        return <UtensilsCrossed className="w-5 h-5 text-gold-400" />;
      case 'ASSISTANCE':
        return <Bell className="w-5 h-5 text-gold-400" />;
      default:
        return <HelpCircle className="w-5 h-5 text-gold-400" />;
    }
  };

  return (
    <div className="space-y-5 text-right">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <Bell className="w-5 h-5 text-gold-400" />
            <span>سجل نداءات واستدعاءات طاقم الضيافة</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            استجابة فورية لطلبات المساعدة، تعبئة المياه، وطلب الحسابات من الطاولات
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-3 py-1.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 font-bold">
            {pendingRequests.length} بانتظار الاستلام · {acknowledgedRequests.length} قيد الخدمة
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-luxury-850 text-luxury-400 border border-luxury-800">
            {resolvedRequests.length} تمت خدمتهم
          </span>
        </div>
      </div>

      {/* Pending Requests Section */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-luxury-300 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
          <span>النداءات النشطة غير المنجزة ({activeRequests.length})</span>
        </h3>

        {activeRequests.length === 0 ? (
          <div className="p-8 text-center rounded-2xl bg-luxury-900/50 border border-luxury-800 text-xs text-luxury-400">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="font-bold text-luxury-200">جميع الضيوف يتلقون الخدمة برضا تام</p>
            <p className="text-[11px] text-luxury-500 mt-0.5">لا توجد طلبات مساعدة معلقة حالياً.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeRequests.map((req) => {
              const isUpdating = isMutationPending(`waiter:${req.id}`);
              const isPending = req.status === 'PENDING';
              return (
              <div
                key={req.id}
                className={`p-4 rounded-2xl bg-luxury-900 border shadow-luxury flex items-start justify-between gap-3 animate-in fade-in ${
                  isPending ? 'border-red-500/40' : 'border-sky-500/40'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2.5 rounded-xl border shrink-0 ${
                      isPending
                        ? 'bg-red-500/20 text-red-400 border-red-500/30'
                        : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                    }`}
                  >
                    {getReasonIcon(req.reason)}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-luxury-50">
                        {getTableLabel(req.tableId)}
                      </span>
                      <span className="text-[10px] text-luxury-400">
                        ({formatRelativeMinutes(req.createdAt)})
                      </span>
                      {/* PENDING (red, urgent, pulsing) vs ACKNOWLEDGED (sky,
                          "on the way") — two genuinely different workloads. */}
                      {isPending ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-300 bg-red-500/10 border border-red-500/25 rounded-full px-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
                          بانتظار الاستلام
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-300 bg-sky-500/10 border border-sky-500/25 rounded-full px-2 py-0.5">
                          <Footprints className="w-3 h-3" />
                          تم الاستلام — في الطريق
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-luxury-300 mt-1">{req.reasonText}</p>
                    <span className="text-[11px] text-gold-400 font-mono block mt-1">
                      وقت النداء: {formatTime(req.createdAt)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => isPending ? acknowledgeWaiterRequest(req.id) : resolveWaiterRequest(req.id)}
                  disabled={isUpdating}
                  aria-busy={isUpdating}
                  className={`px-3.5 py-2 rounded-xl text-luxury-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm shrink-0 ${isPending ? 'bg-amber-500 hover:bg-amber-400' : 'bg-emerald-500 hover:bg-emerald-400'}`}
                >
                  {isPending ? <Clock className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  <span>{isUpdating ? 'جاري التأكيد...' : isPending ? 'استلام النداء' : 'تمت الخدمة'}</span>
                </button>
              </div>
            );
            })}
          </div>
        )}
      </div>

      {/* Resolved Requests Archive */}
      {resolvedRequests.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-luxury-800">
          <h3 className="text-xs font-bold text-luxury-400">سجل النداءات المنجزة مؤخراً</h3>
          <div className="space-y-2">
            {resolvedRequests.slice(0, 6).map((req) => (
              <div
                key={req.id}
                className="p-3 rounded-xl bg-luxury-900/60 border border-luxury-850 flex items-center justify-between text-xs text-luxury-400"
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-bold text-luxury-200">
                    {getTableLabel(req.tableId)}
                  </span>
                  <span>—</span>
                  <span>{req.reasonText}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    تمت الخدمة
                  </span>
                  <span className="text-[10px] text-luxury-500">{formatTime(req.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
