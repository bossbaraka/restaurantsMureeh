import React, { useState, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { WaiterCallReason } from '../../types/restaurant';
import { Bell, Check, X, Clock, AlertCircle } from 'lucide-react';

export const WaiterCallModal: React.FC = () => {
  const {
    isWaiterModalOpen,
    setIsWaiterModalOpen,
    activeTableId,
    callWaiter,
    waiterRequests,
    currentRestaurant,
  } = useRestaurant();

  const [selectedReason, setSelectedReason] = useState<WaiterCallReason>('ASSISTANCE');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [justCalled, setJustCalled] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Check if there is already an active pending request for this table
  const activeRequest = waiterRequests.find(
    (r) =>
      r.tableId === activeTableId &&
      r.restaurantId === currentRestaurant?.id &&
      (r.status === 'PENDING' || r.status === 'ACKNOWLEDGED')
  );

  useEffect(() => {
    let timer: any;
    if (cooldownSeconds > 0) {
      timer = setInterval(() => {
        setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  if (!isWaiterModalOpen) return null;

  const reasons: { id: WaiterCallReason; label: string; desc: string; icon: string }[] = [
    { id: 'ASSISTANCE', label: 'مساعدة واستفسار', desc: 'طلب مساعدة من طاقم الخدمة', icon: '🙋‍♂️' },
    { id: 'WATER_REFILL', label: 'طلب ماء إضافي', desc: 'مياه باردة أو منعشة للطاولة', icon: '💧' },
    { id: 'CLEANING', label: 'تنظيف الطاولة', desc: 'مسح الطاولة أو إزالة الأطباق الفارغة', icon: '✨' },
    { id: 'EXTRA_CUTLERY', label: 'أدوات مائدة إضافية', desc: 'شوك، ملاعق، مناديل، أو صحون', icon: '🍴' },
    { id: 'BILL', label: 'طلب الحساب / الفاتورة', desc: 'إعداد الحساب للدفع عند الكاشير', icon: '🧾' },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTableId || cooldownSeconds > 0) return;

    setIsSubmitting(true);
    callWaiter(selectedReason, note.trim() || undefined);
    setIsSubmitting(false);
    setJustCalled(true);
    setCooldownSeconds(60); // 60s debounce protection

    setTimeout(() => {
      setJustCalled(false);
      setIsWaiterModalOpen(false);
      setNote('');
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={() => setIsWaiterModalOpen(false)}
      />

      <div
        className="relative w-full max-w-lg bg-luxury-900 border border-luxury-700/70 sm:rounded-3xl rounded-t-3xl p-6 z-10 shadow-2xl space-y-5 animate-fade-in text-right"
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-luxury-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-400">
              <Bell className="w-5 h-5 animate-bounce" />
            </div>
            <div>
              <h3 className="text-base font-bold text-luxury-50 font-serif">طلب النادل إلى الطاولة</h3>
              <p className="text-xs text-luxury-400 font-mono">
                {activeTableId ? `طاولة رقم ${activeTableId.replace('TABLE-', '')}` : 'طاولة عامة'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsWaiterModalOpen(false)}
            className="p-2 rounded-xl text-luxury-400 hover:text-luxury-200 hover:bg-luxury-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {justCalled ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto animate-pulse">
              <Check className="w-8 h-8" />
            </div>
            <h4 className="text-base font-bold text-luxury-100 font-serif">تم إرسال طلبك للنادل بنجاح</h4>
            <p className="text-xs text-luxury-400">طاقم الضيافة في طريقه إلى طاولتك الآن.</p>
          </div>
        ) : activeRequest && cooldownSeconds === 0 ? (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold">
              <Clock className="w-4 h-4 animate-spin" />
              <span>طلب النادل قيد التنفيذ حالياً</span>
            </div>
            <p className="text-[11px] text-luxury-300">
              يوجد نداء نشط بالفعل لطاولتك ({reasons.find((r) => r.id === activeRequest.reason)?.label || activeRequest.reason}). طاقم الخدمة على علم بذلك.
            </p>
          </div>
        ) : null}

        {!justCalled && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-luxury-200 mb-2">نوع الطلب:</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {reasons.map((r) => {
                  const isSelected = selectedReason === r.id;
                  return (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => setSelectedReason(r.id)}
                      className={`p-3 rounded-2xl border text-right transition-all flex items-center gap-3 ${
                        isSelected
                          ? 'bg-gold-500/15 border-gold-500/60 ring-1 ring-gold-500/40 text-gold-300'
                          : 'bg-luxury-850/60 border-luxury-800 text-luxury-300 hover:border-luxury-700'
                      }`}
                    >
                      <span className="text-xl">{r.icon}</span>
                      <div>
                        <div className="text-xs font-bold">{r.label}</div>
                        <div className="text-[10px] text-luxury-400 mt-0.5">{r.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-luxury-200 mb-1.5">ملاحظة إضافية (اختياري):</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="مثال: يرجى إحضار كراسي إضافية أو مكعبات ثلج..."
                className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-3.5 py-2.5 text-xs text-luxury-100 placeholder-luxury-500 focus:outline-none focus:border-gold-500/60"
              />
            </div>

            {cooldownSeconds > 0 && (
              <div className="text-center text-[11px] text-gold-400/80 bg-gold-500/5 py-1.5 rounded-lg border border-gold-500/20">
                يرجى الانتظار {cooldownSeconds} ثانية قبل إرسال نداء آخر منعاً للتكرار.
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || cooldownSeconds > 0}
              className="w-full py-3.5 rounded-2xl bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-luxury-950 font-bold text-xs shadow-gold-glow flex items-center justify-center gap-2 transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              <Bell className="w-4 h-4" />
              <span>{isSubmitting ? 'جاري الإرسال...' : cooldownSeconds > 0 ? `انتظر (${cooldownSeconds}s)` : 'إرسال النداء الآن'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
