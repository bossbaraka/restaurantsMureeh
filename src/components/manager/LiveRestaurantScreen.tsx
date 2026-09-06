import React, { useEffect, useMemo, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
import { computeSalesKpis, ZONE_LABELS } from '../../services/analytics';
import {
  Activity,
  Bell,
  CheckCircle2,
  ChefHat,
  Clock,
  Flame,
  Maximize2,
  Radio,
  Users,
  Wallet,
  Minus,
} from 'lucide-react';

const ORDER_FLOW: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: 'قيد الانتظار', color: 'text-sky-300', bg: 'bg-sky-500/15 border-sky-500/30' },
  PREPARING: { label: 'قيد التحضير', color: 'text-amber-300', bg: 'bg-amber-500/15 border-amber-500/30' },
  READY: { label: 'جاهز للتقديم', color: 'text-emerald-300', bg: 'bg-emerald-500/15 border-emerald-500/30' },
  SERVED: { label: 'تم التقديم', color: 'text-luxury-400', bg: 'bg-luxury-800/60 border-luxury-700' },
};

export const LiveRestaurantScreen: React.FC = () => {
  const { currentRestaurant, orders, tables, waiterRequests, payments, refreshTenantData, viewMode } = useRestaurant();

  const [now, setNow] = useState<Date>(() => new Date());
  const [hidden, setHidden] = useState(false);

  // Live clock + gentle data refresh (server deployments also push via SSE)
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    const poll = window.setInterval(() => refreshTenantData(), 8000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(poll);
    };
  }, [refreshTenantData]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    } catch {
      // Fullscreen API unavailable (iframe preview) — ignore.
    }
  };

  const kpis = useMemo(() => computeSalesKpis(orders, payments), [orders, payments]);

  const liveOrders = orders
    .filter((o) => ['PENDING', 'PREPARING', 'READY'].includes(o.status))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const pendingWaiterCalls = waiterRequests.filter((w) => w.status === 'PENDING');
  const occupiedTables = tables.filter(
    (t) => t.status === 'OCCUPIED' || t.status === 'BILL_REQUESTED' || t.activeOrderIds.length > 0
  );
  const readyOrders = liveOrders.filter((o) => o.status === 'READY');

  const ageMinutes = (iso: string) => Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));

  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });

  const zones = useMemo(() => {
    const keys = Array.from(new Set(tables.map((t) => t.zone))).sort();
    return keys;
  }, [tables]);

  if (hidden) return null;

  return (
    <div dir="rtl" className="fixed inset-0 z-[70] bg-[#050607] text-luxury-50 flex flex-col overflow-hidden select-none">
      {/* ===== Header ===== */}
      <header className="flex items-center justify-between px-5 py-2.5 bg-gradient-to-l from-[#0B0C0E] via-luxury-950 to-[#0B0C0E] border-b border-luxury-800/70">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center font-serif font-bold text-luxury-950"
            style={{ background: `linear-gradient(135deg, ${currentRestaurant?.primaryColor || '#D4AF37'}, ${currentRestaurant?.accentColor || '#C5A880'})` }}
          >
            {currentRestaurant?.nameEn.charAt(0) || 'M'}
          </div>
          <div>
            <h1 className="font-serif font-bold text-sm leading-tight">{currentRestaurant?.name || 'المطعم'}</h1>
            <p className="text-[10px] text-luxury-500">{currentRestaurant?.address}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1">
            <Radio className="w-3.5 h-3.5 text-red-400 animate-pulse" />
            <span className="text-[11px] font-bold text-red-300">بث مباشر</span>
          </div>
          <div className="text-center">
            <div className="font-mono text-lg font-bold text-gold-400 leading-none">{timeStr}</div>
            <div className="text-[10px] text-luxury-400 mt-0.5">{dateStr}</div>
          </div>
          <button onClick={toggleFullscreen} className="p-2 rounded-lg bg-luxury-900 border border-luxury-750 text-luxury-300 hover:text-gold-300 cursor-pointer" title="ملء الشاشة (F)">
            <Maximize2 className="w-4 h-4" />
          </button>
          <button onClick={() => setHidden(true)} className="p-2 rounded-lg bg-luxury-900 border border-luxury-750 text-luxury-400 hover:text-red-400 cursor-pointer" title="إخفاء الشاشة">
            <Minus className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ===== KPI strip ===== */}
      <div className="grid grid-cols-5 gap-2 px-5 py-2 bg-luxury-950/60 border-b border-luxury-800/50 text-center">
        <div className="rounded-xl bg-luxury-900/70 border border-luxury-800 py-1.5">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-luxury-400 font-bold"><Wallet className="w-3 h-3 text-gold-400" /> محصّل اليوم</div>
          <div className="text-lg font-bold text-gold-400 leading-tight">{formatPrice(kpis.todayCollected)}</div>
        </div>
        <div className="rounded-xl bg-luxury-900/70 border border-luxury-800 py-1.5">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-luxury-400 font-bold"><ChefHat className="w-3 h-3 text-amber-300" /> أوامر نشطة</div>
          <div className="text-lg font-bold text-amber-300 leading-tight">{liveOrders.length}</div>
        </div>
        <div className="rounded-xl bg-luxury-900/70 border border-luxury-800 py-1.5">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-luxury-400 font-bold"><CheckCircle2 className="w-3 h-3 text-emerald-400" /> جاهزة للتقديم</div>
          <div className="text-lg font-bold text-emerald-400 leading-tight">{readyOrders.length}</div>
        </div>
        <div className="rounded-xl bg-luxury-900/70 border border-luxury-800 py-1.5">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-luxury-400 font-bold"><Users className="w-3 h-3 text-sky-300" /> حضور الآن</div>
          <div className="text-lg font-bold text-sky-300 leading-tight">{occupiedTables.length}</div>
        </div>
        <div className="rounded-xl bg-luxury-900/70 border border-luxury-800 py-1.5">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-luxury-400 font-bold"><Bell className="w-3 h-3 text-red-400" /> نداءات النادل</div>
          <div className="text-lg font-bold text-red-400 leading-tight">{pendingWaiterCalls.length}</div>
        </div>
      </div>

      {/* ===== Main board ===== */}
      <div className="flex-1 grid grid-cols-12 gap-2 px-5 py-3 min-h-0">
        {/* Zones / tables */}
        <div className="col-span-8 grid grid-cols-2 xl:grid-cols-4 gap-2 min-h-0 overflow-y-auto no-scrollbar">
          {zones.map((zone) => {
            const zoneTables = tables.filter((t) => t.zone === zone);
            const zoneLive = zoneTables.filter((t) => t.status === 'OCCUPIED' || t.status === 'BILL_REQUESTED' || t.activeOrderIds.length > 0);
            return (
              <section key={zone} className="rounded-xl bg-luxury-950/70 border border-luxury-800/60 p-2">
                <header className="flex items-center justify-between px-1 pb-1.5 border-b border-luxury-800/50 mb-1.5">
                  <h3 className="text-[11px] font-bold text-luxury-200">{ZONE_LABELS[zone] || zone}</h3>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${zoneLive.length ? 'bg-amber-500/15 text-amber-300' : 'bg-luxury-800/60 text-luxury-500'}`}>
                    {zoneLive.length}/{zoneTables.length}
                  </span>
                </header>
                <div className="space-y-1">
                  {zoneTables.map((t) => {
                    const isLive = t.status === 'OCCUPIED' || t.status === 'BILL_REQUESTED' || t.activeOrderIds.length > 0;
                    const isBill = t.status === 'BILL_REQUESTED';
                    const mins = t.lastActivityAt ? ageMinutes(t.lastActivityAt) : 0;
                    const hasCall = t.hasWaiterCall;
                    const openTotal = orders
                      .filter((o) => o.tableId === t.id && o.paymentStatus !== 'PAID' && o.status !== 'CANCELLED')
                      .reduce((s, o) => s + (o.total || 0), 0);
                    return (
                      <div
                        key={t.id}
                        className={`relative rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                          isBill
                            ? 'bg-red-500/15 border-red-500/50'
                            : isLive
                              ? 'bg-luxury-900 border-luxury-700'
                              : 'bg-luxury-900/50 border-luxury-850 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-sm">{String(t.tableNumber).padStart(2, '0')}</span>
                          <div className="flex items-center gap-1">
                            {hasCall && <Bell className="w-3 h-3 text-red-400 animate-bounce" />}
                            {isBill && <Flame className="w-3 h-3 text-red-400" />}
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isBill ? 'bg-red-500 animate-pulse' : isLive ? 'bg-emerald-400' : 'bg-luxury-600'
                              }`}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[9px] text-luxury-500 mt-0.5">
                          <span>
                            {isLive
                              ? isBill
                                ? 'طلبات الفاتورة'
                                : t.activeOrderIds.length > 0
                                  ? `${mins} دقيقة منذ الطلب`
                                  : 'جلسة نشطة'
                              : 'متاحة'}
                          </span>
                          {openTotal > 0 && <span className="font-bold text-gold-400 font-mono">{formatPrice(openTotal)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {/* Orders live feed */}
        <div className="col-span-4 flex flex-col gap-2 min-h-0">
          {/* Waiter calls (emergency strip) */}
          {pendingWaiterCalls.length > 0 && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/40 p-2 shrink-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-300 mb-1.5">
                <Bell className="w-3.5 h-3.5 animate-pulse" /> نداءات خدمة بحاجة لرد
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {pendingWaiterCalls.map((w) => (
                  <span key={w.id} className="bg-red-500/20 border border-red-400/40 rounded-full px-2 py-0.5 text-[10px] font-bold text-red-200 animate-pulse">
                    طاولة {w.tableId.replace(/^(?:TABLE-|.*-T)/, '')} — {w.reason}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Active orders feed */}
          <div className="flex-1 rounded-xl bg-luxury-950/70 border border-luxury-800/60 p-2 min-h-0 flex flex-col">
            <header className="flex items-center justify-between pb-1.5 border-b border-luxury-800/50 mb-1.5 shrink-0">
              <h3 className="text-[11px] font-bold text-luxury-200 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-gold-400" /> سير الطلبات المباشر
              </h3>
              <span className="text-[10px] text-luxury-500 font-mono">{liveOrders.length}</span>
            </header>
            <div className="flex-1 overflow-y-auto no-scrollbar space-y-1.5">
              {liveOrders.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-luxury-600 gap-2">
                  <CheckCircle2 className="w-8 h-8 opacity-40" />
                  <span className="text-xs">لا توجد أوامر نشطة الآن</span>
                </div>
              )}
              {liveOrders.map((o) => {
                const flow = ORDER_FLOW[o.status] || ORDER_FLOW.PENDING;
                return (
                  <div key={o.id} className={`rounded-lg border p-2 ${flow.bg} animate-fade-in`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-luxury-100">{o.id}</span>
                      <span className={`text-[10px] font-bold ${flow.color}`}>{flow.label}</span>
                    </div>
                    <p className="text-[10px] text-luxury-300 truncate mt-0.5">
                      {o.items.map((i) => `${i.productName || i.name} ×${i.quantity}`).join('، ')}
                    </p>
                    <div className="flex items-center justify-between mt-1 text-[9px] text-luxury-500">
                      <span>طاولة {o.tableId.replace(/^(?:TABLE-|.*-T)/, '')}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {ageMinutes(o.createdAt)} د
                      </span>
                      {o.status === 'READY' && <span className="text-emerald-400 font-bold">انتباه للتقديم!</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent payments ticker */}
          <div className="rounded-xl bg-luxury-950/70 border border-luxury-800/60 p-2 shrink-0">
            <h3 className="text-[10px] font-bold text-luxury-400 mb-1 flex items-center gap-1">
              <Wallet className="w-3 h-3 text-gold-400" /> آخر الدفعات
            </h3>
            <div className="flex gap-1.5 overflow-hidden whitespace-nowrap">
              <div className="flex gap-1.5 animate-marquee">
                {payments.slice(0, 12).map((p) => (
                  <span key={p.id} className="bg-luxury-900 border border-luxury-800 rounded-full px-2 py-0.5 text-[10px] text-luxury-300 font-mono shrink-0">
                    {p.receiptNumber} • {formatPrice(p.total)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <footer className="text-center text-[9px] text-luxury-600 pb-1.5">
        اضغط F لملء الشاشة • {currentRestaurant?.name} — نظام تشغيل المطاعم MÉRAR •{' '}
        {viewMode === 'LIVE_SCREEN' ? 'شاشة العرض الحية' : ''}
      </footer>
    </div>
  );
};
