import React from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice, formatRelativeMinutes, getOrderStatusConfig } from '../../utils/formatting';
import {
  TrendingUp,
  ShoppingBag,
  Clock,
  CheckCircle,
  Bell,
  ChefHat,
  Users,
  Layers,
  ArrowUpRight,
  Flame,
  CheckCheck,
} from 'lucide-react';

interface DashboardOverviewProps {
  onNavigateTab: (tab: 'ORDERS' | 'TABLES' | 'QR' | 'MENU' | 'OFFERS' | 'WAITERS') => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ onNavigateTab }) => {
  const { orders, tables, waiterRequests, updateOrderStatus, resolveWaiterRequest } = useRestaurant();

  // Metrics
  const totalRevenue = orders
    .filter((o) => o.status !== 'CANCELLED')
    .reduce((sum, o) => sum + o.total, 0);

  const pendingOrders = orders.filter((o) => o.status === 'PENDING');
  const preparingOrders = orders.filter((o) => o.status === 'PREPARING');
  const readyOrders = orders.filter((o) => o.status === 'READY');
  const servedOrders = orders.filter((o) => o.status === 'SERVED');

  const occupiedTables = tables.filter((t) => t.status === 'OCCUPIED' || t.status === 'BILL_REQUESTED');
  const pendingWaiters = waiterRequests.filter((w) => w.status === 'PENDING');

  // Recent activity feed combining orders & waiter calls
  const activityFeed = [
    ...orders.slice(0, 8).map((ord) => ({
      id: `act-ord-${ord.id}-${ord.updatedAt}`,
      type: 'ORDER' as const,
      title: `${ord.tableId.replace('TABLE-', 'طاولة ')}: ${getOrderStatusConfig(ord.status).label}`,
      subtitle: `${ord.items.map((i) => `${i.quantity}× ${i.productName}`).join('، ')} (${formatPrice(ord.total)})`,
      time: ord.updatedAt || ord.createdAt,
      status: ord.status,
      orderId: ord.id,
      tableId: ord.tableId,
    })),
    ...waiterRequests.slice(0, 5).map((w) => ({
      id: `act-wait-${w.id}`,
      type: 'WAITER' as const,
      title: `${w.tableId.replace('TABLE-', 'طاولة ')}: طلب نادل (${w.reasonText})`,
      subtitle: w.status === 'PENDING' ? 'قيد الانتظار لم تتم تلبيته' : 'تمت الخدمة بنجاح',
      time: w.createdAt,
      status: w.status,
      requestId: w.id,
      tableId: w.tableId,
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8);

  return (
    <div className="space-y-6 text-right">
      {/* Top Banner with Hospitality Greetings */}
      <div className="bg-gradient-to-r from-luxury-900 via-luxury-850 to-luxury-900 border border-luxury-750 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-luxury">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-emerald-400">النظام متصل ويعمل بكفاءة عالية</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-luxury-50 font-serif">
            مركز عمليات مطعم مِيرار الفاخر
          </h2>
          <p className="text-xs text-luxury-400 mt-1">
            إدارة مباشرة لـ 50 طاولة وطلبات المطبخ اللحظية وخدمة الضيوف
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigateTab('ORDERS')}
            className="px-4 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 text-xs font-bold transition-all shadow-gold-glow flex items-center gap-1.5"
          >
            <ChefHat className="w-4 h-4" />
            <span>عرض شاشة المطبخ ({pendingOrders.length + preparingOrders.length})</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Metric 1: Today Revenue */}
        <div className="p-4 sm:p-5 rounded-2xl bg-luxury-900 border border-luxury-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>مبيعات اليوم الكلية</span>
            <div className="p-2 rounded-xl bg-gold-500/10 text-gold-400 border border-gold-500/20">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-luxury-50 font-sans">
              {formatPrice(totalRevenue)}
            </div>
            <div className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
              <span>{orders.length} طلبات مسجلة</span>
            </div>
          </div>
        </div>

        {/* Metric 2: Active Tables */}
        <div
          onClick={() => onNavigateTab('TABLES')}
          className="p-4 sm:p-5 rounded-2xl bg-luxury-900 border border-luxury-800 hover:border-gold-500/40 transition-colors cursor-pointer flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>الطاولات المشغولة</span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-luxury-50 font-sans flex items-baseline gap-1.5">
              <span>{occupiedTables.length}</span>
              <span className="text-xs text-luxury-400 font-normal">/ 50 طاولة</span>
            </div>
            <div className="text-[11px] text-luxury-400 mt-1 group-hover:text-gold-400 transition-colors flex items-center gap-1">
              <span>عرض الخريطة الكاملة</span>
              <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
        </div>

        {/* Metric 3: Orders in Kitchen */}
        <div
          onClick={() => onNavigateTab('ORDERS')}
          className="p-4 sm:p-5 rounded-2xl bg-luxury-900 border border-luxury-800 hover:border-gold-500/40 transition-colors cursor-pointer flex flex-col justify-between group"
        >
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>طلبات قيد المطبخ</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <ChefHat className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-amber-400 font-sans flex items-baseline gap-2">
              <span>{pendingOrders.length + preparingOrders.length}</span>
              {pendingOrders.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
                  {pendingOrders.length} جديد
                </span>
              )}
            </div>
            <div className="text-[11px] text-luxury-400 mt-1">
              {readyOrders.length} طلبات جاهزة للتقديم
            </div>
          </div>
        </div>

        {/* Metric 4: Waiter Calls Alert */}
        <div
          onClick={() => onNavigateTab('WAITERS')}
          className={`p-4 sm:p-5 rounded-2xl border transition-colors cursor-pointer flex flex-col justify-between group ${
            pendingWaiters.length > 0
              ? 'bg-red-500/10 border-red-500/40'
              : 'bg-luxury-900 border-luxury-800 hover:border-gold-500/40'
          }`}
        >
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>نداءات طاقم الضيافة</span>
            <div
              className={`p-2 rounded-xl ${
                pendingWaiters.length > 0
                  ? 'bg-red-500/20 text-red-400 animate-bounce'
                  : 'bg-luxury-800 text-luxury-400'
              }`}
            >
              <Bell className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div
              className={`text-2xl font-bold font-sans ${
                pendingWaiters.length > 0 ? 'text-red-400' : 'text-luxury-50'
              }`}
            >
              {pendingWaiters.length}
            </div>
            <div className="text-[11px] text-luxury-400 mt-1">
              {pendingWaiters.length > 0 ? 'يتطلب استجابة فورية' : 'لا توجد نداءات معلقة'}
            </div>
          </div>
        </div>
      </div>

      {/* Kitchen Pipeline Mini Quick-Board */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Column 1: Pending (Needs Approval) */}
        <div className="bg-luxury-900/90 rounded-2xl border border-luxury-800 p-4">
          <div className="flex items-center justify-between pb-3 border-b border-luxury-800 mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <h3 className="text-sm font-bold text-luxury-100">بانتظار الموافقة (Pending)</h3>
            </div>
            <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              {pendingOrders.length}
            </span>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto">
            {pendingOrders.length === 0 ? (
              <p className="text-xs text-luxury-500 py-6 text-center">لا توجد طلبات جديدة معلقة</p>
            ) : (
              pendingOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="p-3 rounded-xl bg-luxury-850 border border-luxury-750 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-gold-400">
                      {ord.tableId.replace('TABLE-', 'طاولة ')} ({ord.id})
                    </span>
                    <span className="text-luxury-400">{formatRelativeMinutes(ord.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-luxury-200 line-clamp-2">
                    {ord.items.map((i) => `${i.quantity}× ${i.productName}`).join('، ')}
                  </p>
                  <div className="flex items-center justify-between pt-1 border-t border-luxury-800">
                    <span className="text-xs font-bold text-gold-400">{formatPrice(ord.total)}</span>
                    <button
                      onClick={() => updateOrderStatus(ord.id, 'PREPARING')}
                      className="px-3 py-1 rounded-lg bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-[11px] transition-colors"
                    >
                      بدء التحضير
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 2: Preparing */}
        <div className="bg-luxury-900/90 rounded-2xl border border-luxury-800 p-4">
          <div className="flex items-center justify-between pb-3 border-b border-luxury-800 mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <h3 className="text-sm font-bold text-luxury-100">جاري التحضير بالمطبخ</h3>
            </div>
            <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
              {preparingOrders.length}
            </span>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto">
            {preparingOrders.length === 0 ? (
              <p className="text-xs text-luxury-500 py-6 text-center">المطبخ لا يقوم بإعداد طلبات حالياً</p>
            ) : (
              preparingOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="p-3 rounded-xl bg-luxury-850 border border-luxury-750 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-blue-300">
                      {ord.tableId.replace('TABLE-', 'طاولة ')} ({ord.id})
                    </span>
                    <span className="text-luxury-400">{formatRelativeMinutes(ord.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-luxury-200 line-clamp-2">
                    {ord.items.map((i) => `${i.quantity}× ${i.productName}`).join('، ')}
                  </p>
                  <div className="flex items-center justify-between pt-1 border-t border-luxury-800">
                    <span className="text-xs font-bold text-gold-400">{formatPrice(ord.total)}</span>
                    <button
                      onClick={() => updateOrderStatus(ord.id, 'READY')}
                      className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-luxury-950 font-bold text-[11px] transition-colors"
                    >
                      وسم كجاهز
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 3: Ready for Serving */}
        <div className="bg-luxury-900/90 rounded-2xl border border-luxury-800 p-4">
          <div className="flex items-center justify-between pb-3 border-b border-luxury-800 mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <h3 className="text-sm font-bold text-luxury-100">جاهز للتقديم للطاولة</h3>
            </div>
            <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              {readyOrders.length}
            </span>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto">
            {readyOrders.length === 0 ? (
              <p className="text-xs text-luxury-500 py-6 text-center">لا توجد أطباق بانتظار التقديم</p>
            ) : (
              readyOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="p-3 rounded-xl bg-luxury-850 border border-emerald-500/30 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-300">
                      {ord.tableId.replace('TABLE-', 'طاولة ')} ({ord.id})
                    </span>
                    <span className="text-luxury-400">{formatRelativeMinutes(ord.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-luxury-200 line-clamp-2">
                    {ord.items.map((i) => `${i.quantity}× ${i.productName}`).join('، ')}
                  </p>
                  <div className="flex items-center justify-between pt-1 border-t border-luxury-800">
                    <span className="text-xs font-bold text-gold-400">{formatPrice(ord.total)}</span>
                    <button
                      onClick={() => updateOrderStatus(ord.id, 'SERVED')}
                      className="px-3 py-1 rounded-lg bg-luxury-750 hover:bg-luxury-700 text-luxury-100 font-bold text-[11px] border border-luxury-600 transition-colors"
                    >
                      تم التقديم للضيف
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Activity Feed Section */}
      <div className="bg-luxury-900/90 rounded-2xl border border-luxury-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-luxury-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-gold-400" />
            <span>سجل النشاط المباشر (Live Activity Feed)</span>
          </h3>
          <span className="text-xs text-luxury-400">تحديث لحظي متزامن</span>
        </div>

        <div className="space-y-3">
          {activityFeed.map((act) => (
            <div
              key={act.id}
              className="p-3 rounded-xl bg-luxury-850/60 border border-luxury-800 flex items-center justify-between gap-3 text-xs"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    act.type === 'WAITER'
                      ? 'bg-red-500/10 text-red-400'
                      : act.status === 'READY'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : act.status === 'PREPARING'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-gold-500/10 text-gold-400'
                  }`}
                >
                  {act.type === 'WAITER' ? <Bell className="w-4 h-4" /> : <ShoppingBag className="w-4 h-4" />}
                </div>
                <div>
                  <h4 className="font-bold text-luxury-100">{act.title}</h4>
                  <p className="text-[11px] text-luxury-400 mt-0.5">{act.subtitle}</p>
                </div>
              </div>

              <div className="text-left shrink-0">
                <span className="text-[11px] text-luxury-400">{formatRelativeMinutes(act.time)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
