import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { getTableZoneLabel } from '../../utils/formatting';
import { X, QrCode, ArrowRight, Check, Sparkles, MapPin, Search } from 'lucide-react';

export const DirectTableEntryModal: React.FC = () => {
  const { isTableSelectorOpen, setIsTableSelectorOpen, activeTableId, validateAndSetTable, tables } = useRestaurant();
  const [inputVal, setInputVal] = useState('');
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<'ALL' | 'MAIN_HALL' | 'TERRACE' | 'VIP_LOUNGE' | 'GARDEN'>('ALL');
  const [errorMsg, setErrorMsg] = useState('');

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

  const filteredTables = tables.filter((t) => {
    if (selectedZoneFilter === 'ALL') return true;
    return t.zone === selectedZoneFilter;
  });

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
            <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-400">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-luxury-50 font-serif">تحديد رقم الطاولة والجلسة</h3>
              <p className="text-xs text-luxury-400">
                اختر طاولتك في المطعم أو أدخل الرقم الظاهر على بطاقة QR
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
                className="flex-1 bg-luxury-900 border border-luxury-750 text-luxury-100 placeholder-luxury-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-gold-500/60 font-mono"
              />
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-gold-500 text-luxury-950 font-bold text-xs hover:bg-gold-400 transition-colors shadow-gold-glow"
              >
                تأكيد الطاولة
              </button>
            </div>
            {errorMsg && <p className="text-xs text-red-400 mt-2">{errorMsg}</p>}
          </form>

          {/* 50 Tables Visual Floor Grid */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <h4 className="text-xs font-bold text-luxury-200 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-gold-400" />
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
                        ? 'bg-gold-500/20 text-gold-300 border border-gold-500/40'
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
                        ? 'bg-gold-500 border-gold-400 text-luxury-950 font-extrabold shadow-gold-glow scale-105 z-10'
                        : isOccupied
                        ? 'bg-luxury-850/90 border-amber-500/40 text-amber-300 hover:border-amber-400'
                        : 'bg-luxury-850/50 border-luxury-800 text-luxury-300 hover:border-gold-500/40 hover:text-luxury-100'
                    }`}
                  >
                    <span className="text-xs font-mono font-bold">
                      {table.tableNumber < 10 ? `0${table.tableNumber}` : table.tableNumber}
                    </span>
                    <span className="text-[9px] opacity-75 truncate max-w-full">
                      {table.capacity} مقاعد
                    </span>

                    {isActiveCurrent && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[8px] font-bold">
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
          <span>الطاولة الحالية: {activeTableId || 'غير محددة'}</span>
        </div>
      </div>
    </div>
  );
};
