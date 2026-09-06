import React, { useMemo } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
import {
  computeSalesKpis,
  computeVisitorKpis,
  METHOD_LABELS,
} from '../../services/analytics';
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
  Printer,
  Wallet,
  Receipt,
  Eye,
  Building2,
} from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  const { orders, tables, payments, branches, currentRestaurant, hasEntitlement, showToast } = useRestaurant();

  const canUseAnalytics = hasEntitlement('CAN_USE_ANALYTICS');

  const sales = useMemo(() => computeSalesKpis(orders, payments), [orders, payments]);
  const visitors = useMemo(() => computeVisitorKpis(orders, tables, payments), [orders, tables, payments]);

  // Popular products (kept local — analytics engine focuses on money/visitors)
  const popularProducts = useMemo(() => {
    const map = new Map<string, { name: string; count: number; revenue: number }>();
    orders
      .filter((o) => o.status !== 'CANCELLED')
      .forEach((o) =>
        o.items.forEach((item) => {
          const key = item.productName || item.name || 'صنف';
          const cur = map.get(key) || { name: key, count: 0, revenue: 0 };
          cur.count += item.quantity;
          cur.revenue += item.totalPrice;
          map.set(key, cur);
        })
      );
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }, [orders]);

  const handleExportCsv = () => {
    const rows = [
      ['receipt', 'table', 'method', 'total', 'cashier', 'date'],
      ...payments.map((p) => [p.receiptNumber, p.tableLabel, p.method, p.total.toString(), p.cashierName, p.createdAt]),
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `pos-report-${currentRestaurant?.slug || 'restaurant'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('success', 'تم تصدير تقرير الدفعات بنجاح (CSV)');
  };

  const handlePrintReport = () => {
    window.print();
  };

  if (!canUseAnalytics) {
    return (
      <div className="p-12 text-center rounded-2xl bg-luxury-900 border border-luxury-800 space-y-3">
        <div className="w-12 h-12 rounded-full bg-gold-500/10 text-gold-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="font-bold text-luxury-100">التحليلات والتقارير ضمن باقة المحترفين</h2>
        <p className="text-xs text-luxury-400 max-w-md mx-auto">
          التحليلات اللحظية للمبيعات والزوار وتقارير الأداء متاحة في باقة المحترفين وما فوق. قم بترقية باقتك من تبويب «الباقة والاشتراك».
        </p>
      </div>
    );
  }

  const maxDaily = Math.max(...sales.dailySeries.map((d) => Math.max(d.gross, d.collected)), 1);
  const maxHour = Math.max(...visitors.hourlyDistribution.map((h) => h.orders), 1);
  const maxVisits = Math.max(...visitors.weekSeries.map((d) => d.visits), 1);
  const branchRevenue = branches
    .map((b) => ({
      branch: b,
      total: payments.filter((p) => p.branchId === b.id).reduce((s, p) => s + (p.total || 0), 0),
      count: payments.filter((p) => p.branchId === b.id).length,
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header + instant report actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-luxury-50 text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-gold-400" />
            تحليلات المبيعات والزوار
          </h2>
          <p className="text-[11px] text-luxury-400 mt-0.5">
            تقارير لحظية من سجل نقاط البيع — {currentRestaurant?.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 bg-luxury-900 hover:bg-luxury-850 border border-luxury-750 text-luxury-200 px-3 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-gold-400" /> تصدير CSV
          </button>
          <button
            onClick={handlePrintReport}
            className="flex items-center gap-1.5 bg-gold-500 hover:bg-gold-400 text-luxury-950 px-3 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" /> تقرير فوري (طباعة)
          </button>
        </div>
      </div>

      {/* ===== KPI CARDS ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-luxury-900 border border-luxury-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-luxury-400 font-bold">الإيرادات المحصّلة</span>
            <Wallet className="w-4 h-4 text-gold-400" />
          </div>
          <div className="text-xl font-bold text-gold-400">{formatPrice(sales.collectedRevenue)}</div>
          <div className="text-[10px] text-luxury-500 mt-1">اليوم: {formatPrice(sales.todayCollected)}</div>
        </div>
        <div className="rounded-2xl bg-luxury-900 border border-luxury-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-luxury-400 font-bold">فواتير مفتوحة (غير محصّلة)</span>
            <Receipt className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-amber-300">{formatPrice(sales.openBillsValue)}</div>
          <div className="text-[10px] text-luxury-500 mt-1">{sales.openOrdersCount} فاتورة نشطة على الطاولات</div>
        </div>
        <div className="rounded-2xl bg-luxury-900 border border-luxury-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-luxury-400 font-bold">قيمة الطلبات (الإجمالي)</span>
            <TrendingUp className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-xl font-bold text-luxury-50">{formatPrice(sales.grossOrderValue)}</div>
          <div className="text-[10px] text-luxury-500 mt-1">متوسط الفاتورة: {formatPrice(sales.avgOrderValue)}</div>
        </div>
        <div className="rounded-2xl bg-luxury-900 border border-luxury-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-luxury-400 font-bold">متوسط الإيصال</span>
            <CreditCard className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-luxury-50">{formatPrice(sales.avgPaidValue)}</div>
          <div className="text-[10px] text-luxury-500 mt-1">{sales.paidOrdersCount} طلب مدفوع • {payments.length} إيصال</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ===== DAILY SALES CHART ===== */}
        <div className="lg:col-span-2 rounded-2xl bg-luxury-900 border border-luxury-800 p-4">
          <h3 className="text-xs font-bold text-luxury-100 mb-3 flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-gold-400" /> المبيعات آخر 7 أيام (إجمالي مقابل محصّل)
          </h3>
          <div className="flex items-end justify-between gap-2 h-36">
            {sales.dailySeries.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="flex items-end gap-1 w-full flex-1 justify-center">
                  <div
                    className="w-2.5 sm:w-3.5 rounded-t bg-sky-500/70 hover:bg-sky-400 transition-all"
                    style={{ height: `${Math.max(3, (d.gross / maxDaily) * 100)}%` }}
                    title={`إجمالي ${d.label}: ${formatPrice(d.gross)}`}
                  />
                  <div
                    className="w-2.5 sm:w-3.5 rounded-t bg-gold-500 hover:bg-gold-400 transition-all"
                    style={{ height: `${Math.max(3, (d.collected / maxDaily) * 100)}%` }}
                    title={`محصّل ${d.label}: ${formatPrice(d.collected)}`}
                  />
                </div>
                <span className="text-[9px] text-luxury-400 font-bold">{d.label}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-luxury-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500 inline-block" /> قيمة الطلبات</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gold-500 inline-block" /> المحصّل نقدًا/بطاقة</span>
          </div>
        </div>

        {/* ===== PAYMENT METHODS ===== */}
        <div className="rounded-2xl bg-luxury-900 border border-luxury-800 p-4">
          <h3 className="text-xs font-bold text-luxury-100 mb-3 flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-gold-400" /> توزيع طرق الدفع
          </h3>
          {sales.paymentMethods.length === 0 ? (
            <p className="text-[11px] text-luxury-500">لا توجد دفعات محصّلة بعد.</p>
          ) : (
            <div className="space-y-3">
              {sales.paymentMethods.map((m) => {
                const pct = sales.collectedRevenue ? Math.round((m.total / sales.collectedRevenue) * 100) : 0;
                return (
                  <div key={m.method}>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-bold text-luxury-200">{METHOD_LABELS[m.method] || m.method}</span>
                      <span className="text-luxury-400 font-mono">
                        {formatPrice(m.total)} • {m.count} معاملة
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-luxury-950 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-l from-gold-400 to-gold-600" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-luxury-800">
            <h4 className="text-[11px] font-bold text-luxury-300 mb-2 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-luxury-400" /> إيرادات الفروع
            </h4>
            {branches.length === 0 ? (
              <p className="text-[10px] text-luxury-500">لا توجد فروع مفعّلة — فعّل باقة المؤسسات.</p>
            ) : (
              <div className="space-y-1">
                {branchRevenue.map(({ branch, total, count }) => (
                  <div key={branch.id} className="flex items-center justify-between text-[10px]">
                    <span className="text-luxury-300 truncate ml-2" style={{ color: branch.color || undefined }}>{branch.name}</span>
                    <span className="font-mono text-luxury-400">{formatPrice(total)} ({count})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ===== VISITOR ANALYTICS ===== */}
        <div className="rounded-2xl bg-luxury-900 border border-luxury-800 p-4">
          <h3 className="text-xs font-bold text-luxury-100 mb-3 flex items-center gap-1.5">
            <Eye className="w-4 h-4 text-sky-400" /> تحليلات الزوار
          </h3>
          <div className="grid grid-cols-3 gap-2 text-center mb-4">
            <div className="bg-luxury-950 rounded-xl p-2.5">
              <div className="text-lg font-bold text-sky-300">{visitors.activeNow}</div>
              <div className="text-[9px] text-luxury-500 font-bold mt-0.5">حضور الآن</div>
            </div>
            <div className="bg-luxury-950 rounded-xl p-2.5">
              <div className="text-lg font-bold text-luxury-100">{visitors.visitsToday}</div>
              <div className="text-[9px] text-luxury-500 font-bold mt-0.5">جلسات اليوم</div>
            </div>
            <div className="bg-luxury-950 rounded-xl p-2.5">
              <div className="text-lg font-bold text-luxury-100">{visitors.visitsYesterday}</div>
              <div className="text-[9px] text-luxury-500 font-bold mt-0.5">أمس</div>
            </div>
          </div>
          <div className="flex items-end justify-between gap-1 h-16 mb-1">
            {visitors.weekSeries.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                <span className="text-[8px] text-luxury-500 font-mono">{d.visits || ''}</span>
                <div
                  className="w-full max-w-5 rounded-t bg-sky-500/60"
                  style={{ height: d.visits ? `${(d.visits / Math.max(maxVisits, 1)) * 100}%` : '2px' }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[8px] text-luxury-500 font-bold">
            {visitors.weekSeries.map((d) => <span key={d.date}>{d.label}</span>)}
          </div>
          <div className="mt-3 pt-3 border-t border-luxury-800 grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 text-luxury-300">
              <Clock className="w-3.5 h-3.5 text-gold-400" />
              متوسط الجلسة: <b>{visitors.avgVisitMinutes !== null ? `${visitors.avgVisitMinutes} دقيقة` : '—'}</b>
            </div>
            <div className="flex items-center gap-1.5 text-luxury-300">
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              كاونتر مباشر: <b>{visitors.walkInSalesCount}</b>
            </div>
          </div>
        </div>

        {/* ===== PEAK HOURS ===== */}
        <div className="rounded-2xl bg-luxury-900 border border-luxury-800 p-4">
          <h3 className="text-xs font-bold text-luxury-100 mb-3 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-gold-400" /> زحام اليوم حسب الساعة
          </h3>
          <div className="space-y-1">
            {visitors.hourlyDistribution
              .filter((h) => h.orders > 0)
              .sort((a, b) => b.orders - a.orders)
              .slice(0, 8)
              .map((h) => (
                <div key={h.hour} className="flex items-center gap-2 text-[11px]">
                  <span className="w-12 text-luxury-400 font-bold shrink-0">{h.label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-luxury-950 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-l from-amber-400 to-orange-600" style={{ width: `${(h.orders / maxHour) * 100}%` }} />
                  </div>
                  <span className="w-6 text-left font-mono text-luxury-300 shrink-0">{h.orders}</span>
                </div>
              ))}
            {visitors.hourlyDistribution.every((h) => h.orders === 0) && (
              <p className="text-[11px] text-luxury-500">لا توجد طلبات مسجلة اليوم بعد — تظهر الذروة فور بدء العمل.</p>
            )}
          </div>
        </div>

        {/* ===== BEST SELLERS ===== */}
        <div className="rounded-2xl bg-luxury-900 border border-luxury-800 p-4">
          <h3 className="text-xs font-bold text-luxury-100 mb-3 flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-amber-400" /> الأطباق الأكثر طلبًا
          </h3>
          <div className="space-y-2">
            {popularProducts.map((p, idx) => (
              <div key={p.name} className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0 ${idx === 0 ? 'bg-gold-500 text-luxury-950' : 'bg-luxury-800 text-luxury-300'}`}>
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-luxury-200 truncate">{p.name}</div>
                  <div className="text-[9px] text-luxury-500">{p.count} طلب • {formatPrice(p.revenue)}</div>
                </div>
                <span className="text-[10px] font-bold text-luxury-300 shrink-0 font-mono">×{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== PRINTABLE INSTANT REPORT AREA ===== */}
      <div className="print-area hidden print:block bg-white text-black p-6 rounded-xl">
        <h1 className="text-xl font-bold">تقرير الأداء الفوري — {currentRestaurant?.name}</h1>
        <p>{new Date().toLocaleString('ar-EG')}</p>
        <table className="w-full text-sm mt-4">
          <tbody>
            <tr><td className="font-bold py-1">الإيرادات المحصّلة</td><td>{formatPrice(sales.collectedRevenue)}</td></tr>
            <tr><td className="font-bold py-1">فواتير مفتوحة</td><td>{formatPrice(sales.openBillsValue)}</td></tr>
            <tr><td className="font-bold py-1">عدد الإيصالات</td><td>{payments.length}</td></tr>
            <tr><td className="font-bold py-1">متوسط الإيصال</td><td>{formatPrice(sales.avgPaidValue)}</td></tr>
            <tr><td className="font-bold py-1">حضور الآن / جلسات اليوم</td><td>{visitors.activeNow} / {visitors.visitsToday}</td></tr>
          </tbody>
        </table>
        <h3 className="font-bold mt-4">آخر 20 إيصالًا</h3>
        <table className="w-full text-xs mt-1">
          <thead>
            <tr className="border-b border-black">
              <th className="text-right py-1">الإيصال</th><th className="text-right">الطاولة</th><th className="text-right">الطريقة</th><th className="text-right">القيمة</th><th className="text-right">الكاشير</th><th className="text-right">الوقت</th>
            </tr>
          </thead>
          <tbody>
            {payments.slice(0, 20).map((p) => (
              <tr key={p.id} className="border-b border-gray-300">
                <td className="py-1">{p.receiptNumber}</td>
                <td>{p.tableLabel}</td>
                <td>{METHOD_LABELS[p.method] || p.method}</td>
                <td>{formatPrice(p.total)}</td>
                <td>{p.cashierName}</td>
                <td>{new Date(p.createdAt).toLocaleString('ar-EG')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-center text-xs text-gray-500">نظام تشغيل المطاعم MÉRAR — تقرير مولّد آليًا بواسطة Sales OS</p>
      </div>

      {/* Bottom hint chip */}
      <div className="flex items-center gap-2 text-[10px] text-luxury-500">
        <Sparkles className="w-3.5 h-3.5 text-gold-500" />
        البيانات لحظية: كل دفعة تتم على الكاشير تنعكس هنا فورًا.
      </div>
    </div>
  );
};
