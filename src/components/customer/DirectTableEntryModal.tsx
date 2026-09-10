import React, { useMemo, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { formatTableNumber } from '../../utils/formatting';
import { RestaurantTable } from '../../types/restaurant';
import {
  X,
  QrCode,
  Check,
  Lock,
  ScanLine,
  MapPin,
  ShieldCheck,
  User,
} from 'lucide-react';

/** Format a zero-padded human-readable table label from table state. */
function formatTableLabel(table: RestaurantTable | null, tableNumber: number | null, id: string | null): string {
  if (tableNumber != null && tableNumber > 0) {
    return `طاولة ${tableNumber < 10 ? `0${tableNumber}` : tableNumber}`;
  }
  if (table?.tableNumber != null && table.tableNumber > 0) {
    return `طاولة ${table.tableNumber < 10 ? `0${table.tableNumber}` : table.tableNumber}`;
  }
  if (!id) return 'غير محددة';
  const formatted = formatTableNumber(id);
  if (formatted && formatted !== 'عميل مباشر' && formatted !== '—') {
    return `طاولة ${formatted}`;
  }
  return 'غير محددة';
}

/**
 * Table selector.
 *
 * For GUESTS this is strictly QR-only: the customer experience can only be
 * entered by scanning the physical QR card on a table — there is no manual
 * number entry, no floor-grid picker, and no way to switch tables once one
 * QR has been scanned (one barcode per device).
 *
 * For signed-in staff/managers previewing the venue, the real table grid is
 * kept so they can inspect any table's customer view without a physical QR.
 */
export const DirectTableEntryModal: React.FC = () => {
  const {
    isTableSelectorOpen,
    setIsTableSelectorOpen,
    activeTableId,
    activeTableNumber,
    activeTable,
    validateAndSetTable,
    tables,
  } = useRestaurant();
  const { currentUser } = useAuth();
  const isConsoleUser = !!currentUser;

  const [inputVal, setInputVal] = useState('');
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<'ALL' | 'MAIN_HALL' | 'TERRACE' | 'VIP_LOUNGE' | 'GARDEN'>('ALL');
  const [errorMsg, setErrorMsg] = useState('');

  const sortedTables = useMemo(() => {
    return [...tables].sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0));
  }, [tables]);

  const filteredTables = useMemo(() => {
    if (selectedZoneFilter === 'ALL') return sortedTables;
    return sortedTables.filter((t) => t.zone === selectedZoneFilter);
  }, [sortedTables, selectedZoneFilter]);

  if (!isTableSelectorOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal) {
      setErrorMsg('الرجاء إدخال رقم الطاولة (1 - 50)');
      return;
    }

    const res = validateAndSetTable(Number(inputVal));
    if (res.success) {
      setErrorMsg('');
      setIsTableSelectorOpen(false);
    } else {
      setErrorMsg(res.error || 'رقم طاولة غير صالح');
    }
  };

  const handleSelectTable = (tableNumber: number) => {
    const res = validateAndSetTable(tableNumber);
    if (res.success) {
      setErrorMsg('');
      setIsTableSelectorOpen(false);
    }
  };

  // ---- Guest QR-only gate ------------------------------------------------
  if (!isConsoleUser) {
    const isBound = !!activeTableId;
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto flex items-center justify-center p-3 sm:p-4">
        <div
          className="fixed inset-0 z-0 bg-black/85 backdrop-blur-md transition-opacity"
          onClick={() => setIsTableSelectorOpen(false)}
        />

        <div
          className="relative z-10 w-full max-w-md bg-luxury-900 border border-luxury-700/80 rounded-2xl shadow-luxury overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-200 text-right flex flex-col"
          dir="rtl"
        >
          {/* Header */}
          <div className="p-5 bg-luxury-850/80 border-b border-luxury-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[rgb(var(--brand-primary-strong-rgb)/0.1)] border border-[rgb(var(--brand-primary-strong-rgb)/0.3)] flex items-center justify-center text-[var(--brand-primary-strong)]">
                <QrCode className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-luxury-50 font-serif">
                  {isBound ? 'أنت مرتبط بطاولتك' : 'الدخول عبر رمز QR فقط'}
                </h3>
                <p className="text-xs text-luxury-400">جلسة آمنة مرتبطة بطاولة واحدة</p>
              </div>
            </div>

            <button
              onClick={() => setIsTableSelectorOpen(false)}
              className="p-1.5 rounded-lg text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800 transition-colors"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            {isBound ? (
              <>
                {/* Locked bound state */}
                <div className="flex flex-col items-center text-center gap-3 py-2">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <Lock className="w-9 h-9" />
                    </div>
                    <span className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-emerald-500 text-luxury-950 flex items-center justify-center">
                      <Check className="w-4 h-4" />
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-luxury-50">
                      {formatTableLabel(activeTable, activeTableNumber, activeTableId)}
                    </div>
                    <p className="text-xs text-luxury-400 mt-1 leading-relaxed max-w-xs">
                      هذا الجهاز مرتبط بهذه الطاولة عبر رمز QR، ولا يمكن تغييرها من داخل الجلسة.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsTableSelectorOpen(false)}
                  className="w-full py-3 rounded-xl brand-cta font-bold text-sm transition-all cursor-pointer"
                >
                  متابعة الطلب من طاولتي
                </button>
              </>
            ) : (
              <>
                {/* QR scan guidance */}
                <div className="flex flex-col items-center text-center gap-4">
                  <div className="relative w-28 h-28">
                    <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-[rgb(var(--brand-primary-strong-rgb)/0.5)]" />
                    <div className="absolute inset-3 rounded-xl bg-luxury-950 border border-luxury-750 flex items-center justify-center text-[var(--brand-primary-strong)] overflow-hidden">
                      <QrCode className="w-12 h-12" />
                    </div>
                    <div className="absolute inset-x-2 top-2 h-0.5 bg-[var(--brand-primary-strong)] shadow-[0_0_12px_2px_var(--brand-glow)] animate-qr-scan" />
                    <ScanLine className="absolute -top-2 -left-2 w-5 h-5 text-[var(--brand-primary-strong)]" />
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-sm font-bold text-luxury-50">افتح القائمة بمسح الرمز</h4>
                    <p className="text-xs text-luxury-400 leading-relaxed max-w-sm">
                      وجّه كاميرا هاتفك نحو رمز QR المطبوع على طاولتك. ستُفتح القائمة مباشرةً ومرتبطةً بطاولتك تلقائياً.
                    </p>
                  </div>

                  <ol className="w-full space-y-2 text-right">
                    {[
                      'لا يُمكن إدخال رقم الطاولة يدوياً.',
                      'كل جهاز يرتبط بطاولة واحدة فقط (باركود واحد).',
                      'الطلبات وحالة المطبخ تظهر لطاولتك فقط.',
                    ].map((rule) => (
                      <li
                        key={rule}
                        className="flex items-start gap-2 p-2.5 rounded-xl bg-luxury-950/70 border border-luxury-800 text-xs text-luxury-300"
                      >
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{rule}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <button
                  onClick={() => setIsTableSelectorOpen(false)}
                  className="w-full py-3 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-luxury-200 border border-luxury-750 font-bold text-sm transition-colors cursor-pointer"
                >
                  حسناً، فهمت
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- Staff / Manager preview (keeps the full grid picker) --------------
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-0 bg-black/85 backdrop-blur-md transition-opacity"
        onClick={() => setIsTableSelectorOpen(false)}
      />

      {/* Modal Container */}
      <div
        className="relative z-10 w-full max-w-2xl bg-luxury-900 border border-luxury-700/80 rounded-2xl shadow-luxury overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-200 text-right flex flex-col max-h-[90vh]"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 bg-luxury-850/80 border-b border-luxury-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[rgb(var(--brand-primary-strong-rgb)/0.1)] border border-[rgb(var(--brand-primary-strong-rgb)/0.3)] flex items-center justify-center text-[var(--brand-primary-strong)]">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-luxury-50 font-serif">معاينة تجربة الزبون (للطاقم)</h3>
              <p className="text-xs text-luxury-400">
                اختر طاولة لمعاينة منيوها وجلسة طلبها كما يراها العميل
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsTableSelectorOpen(false)}
            className="p-1.5 rounded-lg text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Quick Direct Number Form */}
          <form onSubmit={handleSubmit} className="p-4 rounded-xl bg-luxury-950/70 border border-luxury-800">
            <label className="block text-xs font-bold text-luxury-200 mb-2">
              إدخال رقم الطاولة مباشرة (1 - 50)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={50}
                value={inputVal}
                onChange={(e) => {
                  setInputVal(e.target.value);
                  setErrorMsg('');
                }}
                placeholder="مثال: 12"
                className="flex-1 bg-luxury-900 border border-luxury-750 text-luxury-100 placeholder-luxury-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[rgb(var(--brand-primary-strong-rgb)/0.6)] font-mono"
              />
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl brand-fill font-bold text-xs hover:bg-[var(--brand-primary-strong)] transition-colors shadow-[0_0_22px_-6px_var(--brand-glow)]"
              >
                تأكيد الطاولة
              </button>
            </div>
            {errorMsg && <p className="text-xs text-red-400 mt-2">{errorMsg}</p>}
          </form>

          {/* Tables Visual Floor Grid */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <h4 className="text-xs font-bold text-luxury-200 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[var(--brand-primary-strong)]" />
                <span>أو اختر من خريطة طاولات المطعم (50 طاولة)</span>
              </h4>

              {/* Zone Filter Chips */}
              <div className="flex flex-wrap gap-1">
                {[
                  { id: 'ALL', label: 'الكل (50)' },
                  { id: 'MAIN_HALL', label: 'الرئيسية (20)' },
                  { id: 'TERRACE', label: 'التراس (12)' },
                  { id: 'VIP_LOUNGE', label: 'VIP (10)' },
                  { id: 'GARDEN', label: 'الحديقة (8)' },
                ].map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => setSelectedZoneFilter(z.id as any)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      selectedZoneFilter === z.id
                        ? 'bg-[rgb(var(--brand-primary-strong-rgb)/0.2)] text-[var(--brand-primary-strong)] border border-[rgb(var(--brand-primary-strong-rgb)/0.4)]'
                        : 'bg-luxury-850 text-luxury-400 hover:text-luxury-200'
                    }`}
                  >
                    {z.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid of Tables */}
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 max-h-64 overflow-y-auto p-1">
              {filteredTables.map((table) => {
                const isActiveCurrent = table.id === activeTableId;
                const isOccupied = table.status === 'OCCUPIED';

                return (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => handleSelectTable(table.tableNumber)}
                    className={`p-2 rounded-xl flex flex-col items-center justify-center border transition-all text-center relative group ${
                      isActiveCurrent
                        ? 'bg-[var(--brand-primary-strong)] border-[var(--brand-primary-strong)] text-luxury-950 font-extrabold shadow-[0_0_22px_-6px_var(--brand-glow)] scale-105 z-10'
                        : isOccupied
                        ? 'bg-luxury-850/90 border-amber-500/40 text-amber-300 hover:border-amber-400'
                        : 'bg-luxury-850/50 border-luxury-800 text-luxury-300 hover:border-[rgb(var(--brand-primary-strong-rgb)/0.4)] hover:text-luxury-100'
                    }`}
                  >
                    <span className="text-xs font-mono font-bold">
                      {table.tableNumber < 10 ? `0${table.tableNumber}` : table.tableNumber}
                    </span>
                    <span className="text-[11px] opacity-75 truncate max-w-full">
                      {table.capacity} مقاعد
                    </span>

                    {isActiveCurrent && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[11px] font-bold">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="p-4 bg-luxury-950 border-t border-luxury-800 flex items-center justify-between text-xs text-luxury-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>شاغرة</span>
            <span className="w-2 h-2 rounded-full bg-amber-400 mr-2" />
            <span>مشغولة</span>
          </div>
          <span>الطاولة الحالية: {formatTableLabel(activeTable, activeTableNumber, activeTableId)}</span>
        </div>
      </div>
    </div>
  );
};
