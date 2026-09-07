import type { FC } from 'react';
import { Check, Clock, Flame, Plus, Search, Wallet } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Decorative QR-style matrix (13×13 with finder squares, deterministic) */
/* ------------------------------------------------------------------ */
const QR_SIZE = 13;

function qrCellOn(row: number, col: number): boolean {
  const n = QR_SIZE;
  const origins: Array<[number, number]> = [
    [0, 0],
    [0, n - 5],
    [n - 5, 0],
  ];
  for (const [originRow, originCol] of origins) {
    if (
      row >= originRow &&
      row < originRow + 5 &&
      col >= originCol &&
      col < originCol + 5
    ) {
      const lr = row - originRow;
      const lc = col - originCol;
      const edge = lr === 0 || lr === 4 || lc === 0 || lc === 4;
      if (edge) return true;
      return lr === 2 && lc === 2;
    }
  }
  // separator lines around finders
  if ((row === 5 || row === n - 6) && (col < 5 || col > n - 6)) return false;
  if ((col === 5 || col === n - 6) && (row < 5 || row > n - 6)) return false;
  // pseudo-random data modules (deterministic)
  return (row * 31 + col * 17 + ((row * col * 7) % 11)) % 3 === 0;
}

export const MiniQr: FC<{ size?: number; className?: string }> = ({
  size = 84,
  className = '',
}) => (
  <div
    dir="ltr"
    className={`grid shrink-0 ${className}`}
    style={{
      gridTemplateColumns: `repeat(${QR_SIZE}, 1fr)`,
      width: size,
      height: size,
      gap: Math.max(1, Math.round(size / 60)),
    }}
    aria-hidden="true"
  >
    {Array.from({ length: QR_SIZE * QR_SIZE }).map((_, i) => {
      const r = Math.floor(i / QR_SIZE);
      const c = i % QR_SIZE;
      return (
        <span
          key={i}
          className={`rounded-[1px] ${qrCellOn(r, c) ? 'bg-white' : 'bg-white/10'}`}
        />
      );
    })}
  </div>
);

/* ------------------------------------------------------------------ */
/* Phone mockup — customer QR menu                                       */
/* ------------------------------------------------------------------ */
const DISHES = [
  { emoji: '🍔', name: 'برجر لحم أنجوس', price: 58, tint: 'from-amber-500/50 to-orange-600/30' },
  { emoji: '🌯', name: 'شاورما عربي دبل', price: 42, tint: 'from-emerald-500/50 to-teal-600/30' },
  { emoji: '🍰', name: 'كنافة نابلسية', price: 28, tint: 'from-yellow-500/50 to-amber-600/30' },
];

export const PhoneMockup: FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`relative mx-auto w-[238px] sm:w-[258px] ${className}`}>
    <div className="rounded-[2.4rem] border border-[#0072BC]/40 bg-[#020A14] p-2 shadow-[0_30px_80px_-20px_rgba(0,114,188,0.55)]">
      <div className="relative overflow-hidden rounded-[1.9rem] bg-[#040D1A]">
        {/* notch */}
        <div className="absolute top-2 right-1/2 translate-x-1/2 w-24 h-5 rounded-full bg-black/80 z-10" />
        <div className="pt-9 pb-3 px-3 space-y-2.5" dir="rtl">
          {/* venue header */}
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#0072BC] to-[#009FE3] flex items-center justify-center text-white text-xs font-black shrink-0">
              د
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black text-white leading-tight">
                مطعم الديوان
              </p>
              <p className="text-[9px] text-slate-400">طاولة 12 · الصالة الرئيسية</p>
            </div>
            <span className="relative flex w-2.5 h-2.5 shrink-0">
              <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-400" />
            </span>
          </div>
          {/* search */}
          <div className="flex items-center gap-1.5 rounded-xl bg-[#0B2545] border border-[#004B87]/60 px-2.5 py-1.5">
            <Search className="w-3 h-3 text-slate-400 shrink-0" />
            <span className="text-[9px] text-slate-400">دوّر على طبق أو مكوّن...</span>
          </div>
          {/* categories */}
          <div className="flex gap-1.5">
            {['الكل', 'مشاوي', 'برجر', 'حلويات'].map((c, i) => (
              <span
                key={c}
                className={`text-[9px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                  i === 0
                    ? 'bg-[#0072BC] text-white'
                    : 'bg-[#0B2545] text-slate-300 border border-[#004B87]/50'
                }`}
              >
                {c}
              </span>
            ))}
          </div>
          {/* dishes */}
          {DISHES.map((d) => (
            <div
              key={d.name}
              className="flex items-center gap-2 rounded-2xl bg-[#081B33] border border-[#004B87]/50 p-2"
            >
              <span
                className={`w-10 h-10 rounded-xl bg-gradient-to-br ${d.tint} flex items-center justify-center text-lg shrink-0`}
              >
                {d.emoji}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-white truncate">{d.name}</p>
                <p className="text-[10px] font-black text-[#38BDF8]">{d.price} ₪</p>
              </div>
              <span className="w-6 h-6 rounded-full bg-[#0072BC] text-white flex items-center justify-center shrink-0">
                <Plus className="w-3.5 h-3.5" />
              </span>
            </div>
          ))}
          {/* cart bar */}
          <div className="flex items-center justify-between rounded-2xl bg-gradient-to-l from-[#003865] to-[#0072BC] px-3 py-2">
            <span className="text-[10px] font-black text-white">3 أصناف · 184 ₪</span>
            <span className="text-[10px] font-black text-white bg-white/20 px-2.5 py-1 rounded-full">
              اطلب الآن
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/* Kitchen display (KDS) mockup                                        */
/* ------------------------------------------------------------------ */
const TICKETS = [
  { table: 'طاولة 12', items: 4, elapsed: '02:14', status: 'طلب جديد', live: true },
  { table: 'طاولة 05', items: 6, elapsed: '09:41', status: 'قيد التحضير', live: false },
  { table: 'طاولة 21', items: 2, elapsed: '14:02', status: 'جاهز للتقديم', live: false },
];

const TICKET_STYLES = [
  {
    ring: 'border-emerald-400/50 shadow-[0_0_28px_-8px_rgba(52,211,153,0.6)]',
    chip: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/40',
    bar: 'from-emerald-400 to-teal-400',
  },
  {
    ring: 'border-amber-400/40',
    chip: 'bg-amber-400/15 text-amber-300 border-amber-400/40',
    bar: 'from-amber-400 to-orange-400',
  },
  {
    ring: 'border-[#38BDF8]/40',
    chip: 'bg-[#38BDF8]/15 text-[#38BDF8] border-[#38BDF8]/40',
    bar: 'from-[#38BDF8] to-[#009FE3]',
  },
];

export const KdsMockup: FC<{ className?: string }> = ({ className = '' }) => (
  <div
    dir="rtl"
    className={`rounded-3xl border border-[#0072BC]/30 bg-[#020A14]/90 shadow-[0_30px_80px_-24px_rgba(0,114,188,0.5)] overflow-hidden ${className}`}
  >
    {/* window bar */}
    <div className="flex items-center gap-2 px-4 py-3 border-b border-[#004B87]/40 bg-[#081B33]/60">
      <span className="flex gap-1.5" dir="ltr">
        <i className="w-2.5 h-2.5 rounded-full bg-rose-400/80" />
        <i className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
        <i className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
      </span>
      <span className="text-[11px] font-black text-white mr-1">شاشة المطبخ</span>
      <span className="mr-auto flex items-center gap-1.5 text-[10px] font-bold text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-saas-blink" />
        مباشر
      </span>
    </div>
    {/* tickets */}
    <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
      {TICKETS.map((t, i) => {
        const s = TICKET_STYLES[i % TICKET_STYLES.length]!;
        return (
          <div
            key={t.table}
            className={`rounded-2xl border bg-[#081B33]/70 p-3 space-y-2.5 ${s.ring} ${
              t.live ? 'animate-saas-pop' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-white">{t.table}</span>
              {t.live ? (
                <Flame className="w-3.5 h-3.5 text-emerald-300" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-slate-400" />
              )}
            </div>
            <div className="flex items-center gap-1">
              {Array.from({ length: t.items }).map((_, d) => (
                <span key={d} className="h-1.5 flex-1 rounded-full bg-[#0072BC]/40" />
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span
                className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${s.chip}`}
              >
                {t.status}
              </span>
              <span className="text-[11px] font-black text-white font-mono tabular-nums" dir="ltr">
                {t.elapsed}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-l ${s.bar}`}
                style={{ width: `${[88, 55, 100][i % 3]}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/* Manager dashboard mockup                                            */
/* ------------------------------------------------------------------ */
const BARS = [34, 52, 44, 68, 58, 80, 62, 92, 74, 100, 84, 70];
const RECENT_ORDERS = [
  { table: 'طاولة 12', total: '184 ₪', paid: true },
  { table: 'طاولة 05', total: '342 ₪', paid: true },
  { table: 'طاولة 21', total: '96 ₪', paid: false },
];

export const ManagerMockup: FC<{ className?: string }> = ({ className = '' }) => (
  <div
    dir="rtl"
    className={`rounded-3xl border border-[#0072BC]/30 bg-[#020A14]/90 shadow-[0_30px_80px_-24px_rgba(0,114,188,0.5)] overflow-hidden ${className}`}
  >
    <div className="flex items-center gap-2 px-4 py-3 border-b border-[#004B87]/40 bg-[#081B33]/60">
      <span className="flex gap-1.5" dir="ltr">
        <i className="w-2.5 h-2.5 rounded-full bg-rose-400/80" />
        <i className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
        <i className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
      </span>
      <span className="text-[11px] font-black text-white mr-1">لوحة تحكم المدير</span>
      <span className="mr-auto flex items-center gap-1 text-[10px] font-bold text-[#38BDF8]">
        <Wallet className="w-3 h-3" />
        مبيعات اليوم
      </span>
    </div>
    <div className="p-4 space-y-3">
      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: 'مبيعات اليوم', value: '4,820 ₪', delta: '+12%' },
          { label: 'طلبات نشطة', value: '18', delta: 'مباشر' },
          { label: 'متوسط الطلب', value: '96 ₪', delta: '+8%' },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl bg-[#081B33]/70 border border-[#004B87]/50 p-2.5 sm:p-3"
          >
            <p className="text-[9px] text-slate-400 font-bold truncate">{kpi.label}</p>
            <p className="text-sm sm:text-base font-black text-white tabular-nums mt-0.5">
              {kpi.value}
            </p>
            <p className="text-[9px] font-black text-emerald-400">{kpi.delta}</p>
          </div>
        ))}
      </div>
      {/* chart */}
      <div className="rounded-2xl bg-[#081B33]/70 border border-[#004B87]/50 p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-black text-white">مبيعات آخر 12 ساعة</span>
          <span className="text-[9px] font-bold text-slate-400">تحديث لحظي</span>
        </div>
        <svg viewBox="0 0 240 90" className="w-full h-20 sm:h-24" aria-hidden="true">
          <defs>
            <linearGradient id="saas-bar-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#0072BC" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          {BARS.map((h, i) => (
            <rect
              key={i}
              x={6 + i * 19.5}
              y={90 - h * 0.8}
              width="12"
              rx="4"
              height={h * 0.8}
              fill={i === 9 ? '#34D399' : 'url(#saas-bar-grad)'}
              opacity={i === 9 ? 1 : 0.85}
            />
          ))}
        </svg>
      </div>
      {/* recent orders */}
      <div className="space-y-1.5">
        {RECENT_ORDERS.map((o) => (
          <div
            key={o.table}
            className="flex items-center gap-2 rounded-xl bg-[#081B33]/50 border border-[#004B87]/40 px-3 py-2"
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                o.paid ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'
              }`}
            >
              <Check className="w-3 h-3" />
            </span>
            <span className="text-[10px] font-bold text-white">{o.table}</span>
            <span className="mr-auto text-[10px] font-black text-[#38BDF8] tabular-nums">
              {o.total}
            </span>
          </div>
        ))}
      </div>
    </div>
  </div>
);
