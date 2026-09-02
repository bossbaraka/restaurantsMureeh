import React from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
import {
  TrendingUp,
  BarChart3,
  Flame,
  Clock,
  Download,
  Users,
  CreditCard,
  Lock,
  Sparkles,
} from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  const { orders, tables, currentRestaurant, hasEntitlement, showToast } = useRestaurant();

  const canUseAnalytics = hasEntitlement('CAN_USE_ANALYTICS');

  const validOrders = orders.filter((o) => o.status !== 'CANCELLED');
  const totalRevenue = validOrders.reduce((sum, o) => sum + o.total, 0);
  const averageOrderValue = validOrders.length > 0 ? Math.round(totalRevenue / validOrders.length) : 0;

  // Calculate popular products
  const productCountMap = new Map<string, { name: string; count: number; revenue: number }>();
  validOrders.forEach((o) => {
    o.items.forEach((item) => {
      const curr = productCountMap.get(item.productName) || { name: item.productName, count: 0, revenue: 0 };
      curr.count += item.quantity;
      curr.revenue += item.totalPrice;
      productCountMap.set(item.productName, curr);
    });
  });

  const popularProducts = Array.from(productCountMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const handleExportCsv = () => {
    const rows = [
      ['Order ID', 'Table', 'Items Count', 'Total', 'Status', 'Date'],
      ...validOrders.map((o) => [o.id, o.tableId, o.items.length.toString(), o.total.toString(), o.status, o.createdAt]),
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `sales-report-${currentRestaurant?.slug || 'restaurant'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('success', 'تم تصدير التقرير بنجاح (CSV)');
  };

  if (!canUseAnalytics) {
    return (
      <div className="p-12 text-center rounded-2xl bg-luxury-900 border border-luxury-800 space-y-3">
        <div className="w-12 h-12 rounded-full bg-gold-500/10 text-gold-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-luxury-100 font-serif">ميزة التحليلات المتقدمة مقفلة</h3>
        <p className="text-xs text-luxury-400 max-w-sm mx-auto leading-relaxed">
          هذه الميزة تتطلب الترقية إلى <strong>باقة المحترفين (Pro)</strong> أو <strong>باقة المؤسسات (Enterprise)</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-right">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-gold-400" />
            <span>لوحة التحليلات والمؤشرات المالية</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            متابعة أداء المبيعات، متوسط قيمة الفاتورة، والأطباق الأكثر طلباً
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          className="px-4 py-2.5 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-gold-300 border border-luxury-750 text-xs font-bold flex items-center gap-1.5 transition-colors"
        >
          <Download className="w-4 h-4" />
          <span>تصدير تقرير المبيعات (CSV)</span>
        </button>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-2xl bg-luxury-900 border border-luxury-800">
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>إجمالي المبيعات</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-luxury-50 mt-2 font-mono">{formatPrice(totalRevenue)}</div>
          <span className="text-[11px] text-emerald-400 mt-1 block">نشطة ومحققة</span>
        </div>

        <div className="p-4 rounded-2xl bg-luxury-900 border border-luxury-800">
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>متوسط قيمة الطلب (AOV)</span>
            <CreditCard className="w-4 h-4 text-gold-400" />
          </div>
          <div className="text-2xl font-bold text-gold-400 mt-2 font-mono">{formatPrice(averageOrderValue)}</div>
          <span className="text-[11px] text-luxury-400 mt-1 block">لكل طلب مكتمل</span>
        </div>

        <div className="p-4 rounded-2xl bg-luxury-900 border border-luxury-800">
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>إجمالي الطلبات</span>
            <Flame className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-luxury-50 mt-2 font-mono">{validOrders.length}</div>
          <span className="text-[11px] text-luxury-400 mt-1 block">طلب مسجل</span>
        </div>

        <div className="p-4 rounded-2xl bg-luxury-900 border border-luxury-800">
          <div className="flex items-center justify-between text-luxury-400 text-xs">
            <span>نسبة إشغال الصالة</span>
            <Users className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-400 mt-2 font-mono">
            {Math.round((tables.filter((t) => t.status === 'OCCUPIED').length / Math.max(1, tables.length)) * 100)}%
          </div>
          <span className="text-[11px] text-luxury-400 mt-1 block">{tables.length} طاولة</span>
        </div>
      </div>

      {/* Popular Products Breakdown */}
      <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-5 shadow-luxury">
        <h3 className="text-sm font-bold text-luxury-100 mb-4 flex items-center gap-2">
          <Flame className="w-4 h-4 text-gold-400" />
          <span>الأطباق الأكثر طلباً وتحقيقاً للإيراد</span>
        </h3>

        {popularProducts.length === 0 ? (
          <p className="text-xs text-luxury-500 py-6 text-center">لا توجد بيانات كافية بعد</p>
        ) : (
          <div className="space-y-3">
            {popularProducts.map((p, idx) => (
              <div
                key={p.name}
                className="p-3.5 rounded-xl bg-luxury-850/60 border border-luxury-800 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-lg bg-gold-500/10 text-gold-400 border border-gold-500/30 flex items-center justify-center font-bold text-xs">
                    {idx + 1}
                  </span>
                  <div>
                    <h4 className="font-bold text-luxury-100">{p.name}</h4>
                    <span className="text-[11px] text-luxury-400">تم طلبه {p.count} مرات</span>
                  </div>
                </div>

                <div className="text-left">
                  <span className="font-bold text-gold-400">{formatPrice(p.revenue)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
