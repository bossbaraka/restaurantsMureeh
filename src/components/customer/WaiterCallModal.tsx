import React, { useState, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { WaiterCallReason } from '../../types/restaurant';
import { Bell, Check, X, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';
import { formatTableNumber } from '../../utils/formatting';

export const WaiterCallModal: React.FC = () => {
  const {
    isWaiterModalOpen,
    setIsWaiterModalOpen,
    activeTableId,
    activeTableNumber,
    activeTable,
    callWaiter,
    waiterRequests,
    currentRestaurant,
  } = useRestaurant();

  const [selectedReason, setSelectedReason] = useState<WaiterCallReason>('ASSISTANCE');
  const [note, setNote] = useState('');
  // Explicit request state machine — the UI may only show SUCCESS after the
  // server accepted the call. IDLE → SUBMITTING → SUCCESS | ERROR.
  const [submitState, setSubmitState] = useState<'IDLE' | 'SUBMITTING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const isSubmitting = submitState === 'SUBMITTING';
  const justCalled = submitState === 'SUCCESS';

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

  // A failed attempt must not linger as an error on the next time the modal
  // is opened; the form starts fresh (the persistent active-request banner
  // still reflects real server state).
  useEffect(() => {
    if (isWaiterModalOpen && submitState === 'ERROR') {
      setSubmitState('IDLE');
      setErrorMessage('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWaiterModalOpen]);

  // UX-001: Escape-to-close + body scroll lock (see hooks/useDialog).
  useDialog({ isOpen: isWaiterModalOpen, onClose: () => setIsWaiterModalOpen(false) });

  if (!isWaiterModalOpen) return null;

  const reasons: { id: WaiterCallReason; label: string; desc: string; icon: string }[] = [
    { id: 'ASSISTANCE', label: 'مساعدة واستفسار', desc: 'طلب مساعدة من طاقم الخدمة', icon: '🙋‍♂️' },
    { id: 'WATER_REFILL', label: 'طلب ماء إضافي', desc: 'مياه باردة أو منعشة للطاولة', icon: '💧' },
    { id: 'CLEANING', label: 'تنظيف الطاولة', desc: 'مسح الطاولة أو إزالة الأطباق الفارغة', icon: '✨' },
    { id: 'EXTRA_CUTLERY', label: 'أدوات مائدة إضافية', desc: 'شوك، ملاعق، مناديل، أو صحون', icon: '🍴' },
    { id: 'BILL', label: 'طلب الحساب / الفاتورة', desc: 'إعداد الحساب للدفع عند الكاشير', icon: '🧾' },
  ];

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activeTableId || cooldownSeconds > 0 || activeRequest || isSubmitting) return;

    // SUBMITTING: lock the form and show an inline indicator. No success
    // messaging is rendered until `callWaiter` resolves successfully.
    setSubmitState('SUBMITTING');
    setErrorMessage('');
    const result = await callWaiter(selectedReason, note.trim() || undefined);

    if (!result.success) {
      // ERROR: explain what happened and keep every choice the guest made so
      // a single tap retries the exact same request.
      setSubmitState('ERROR');
      setErrorMessage(result.error || 'تعذر الاتصال بالخادم');
      return;
    }

    // SUCCESS only after the server confirmed acceptance.
    setSubmitState('SUCCESS');
    setCooldownSeconds(60); // UI feedback complements the existing server limiter.
    setNote('');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={() => setIsWaiterModalOpen(false)}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="waiter-call-title"
        className="relative w-full max-w-lg border border-m-hairline/70 sm:rounded-3xl rounded-t-3xl p-6 z-10 space-y-5 animate-fade-in text-right"
        style={{ backgroundColor: 'var(--m-surface)', boxShadow: 'var(--m-shadow-lg)' }}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-m-hairline pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[rgb(var(--m-brand-on-surface-rgb)/0.1)] border border-[rgb(var(--m-brand-on-surface-rgb)/0.3)] flex items-center justify-center text-[var(--m-brand-on-surface)]">
              <Bell className="w-5 h-5 animate-bounce" />
            </div>
            <div>
              <h3 id="waiter-call-title" className="text-base font-bold text-m-text font-serif">طلب النادل إلى الطاولة</h3>
              <p className="text-xs text-m-text-muted font-mono">
                {activeTableNumber != null
                  ? `طاولة رقم ${activeTableNumber}`
                  : activeTable?.tableNumber != null
                  ? `طاولة رقم ${activeTable.tableNumber}`
                  : activeTableId
                  ? `طاولة رقم ${formatTableNumber(activeTableId) || '—'}`
                  : 'طاولة عامة'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsWaiterModalOpen(false)}
            className="p-2 rounded-xl text-m-text-muted hover:text-m-text hover:bg-m-surface-raised transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {justCalled ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto animate-pulse">
              <Check className="w-8 h-8" />
            </div>
            <h4 className="text-base font-bold text-m-text font-serif">تم إرسال طلبك إلى طاقم الضيافة</h4>
            <p className="text-xs text-m-text-muted">حالة الطلب: بانتظار استلام أحد أفراد الطاقم. لا حاجة لإعادة الإرسال.</p>
          </div>
        ) : activeRequest && cooldownSeconds === 0 ? (
          <div
            className="p-4 rounded-2xl border space-y-2"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--m-warning) 10%, transparent)',
              borderColor: 'color-mix(in srgb, var(--m-warning) 30%, transparent)',
            }}
          >
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold">
              <Clock className="w-4 h-4 animate-spin" />
              <span>{activeRequest.status === 'ACKNOWLEDGED' ? 'تم استلام طلبك والطاقم في الطريق' : 'طلبك بانتظار استلام طاقم الضيافة'}</span>
            </div>
            <p className="text-[11px] text-m-text-muted">
              يوجد طلب نشط لطاولتك ({reasons.find((r) => r.id === activeRequest.reason)?.label || activeRequest.reason}). لا حاجة لإرسال طلب آخر الآن.
            </p>
          </div>
        ) : null}

        {!justCalled && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="block text-xs font-bold text-m-text mb-2">نوع الطلب:</p>
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
                          ? 'bg-[rgb(var(--m-brand-on-surface-rgb)/0.15)] border-[rgb(var(--m-brand-on-surface-rgb)/0.6)] ring-1 ring-[rgb(var(--m-brand-on-surface-rgb)/0.4)] text-[var(--m-brand-on-surface)]'
                          : 'bg-m-surface-raised/60 border-m-hairline text-m-text-muted hover:border-m-hairline'
                      }`}
                    >
                      <span className="text-xl">{r.icon}</span>
                      <div>
                        <div className="text-xs font-bold">{r.label}</div>
                        <div className="text-[10px] text-m-text-muted mt-0.5">{r.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="waitercallmodal-f1" className="block text-xs font-bold text-m-text mb-1.5">ملاحظة إضافية (اختياري):</label>
              <input id="waitercallmodal-f1"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="مثال: يرجى إحضار كراسي إضافية أو مكعبات ثلج..."
                className="w-full bg-m-bg border border-m-hairline rounded-xl px-3.5 py-2.5 text-xs text-m-text placeholder-m-text-subtle focus:outline-none focus:border-[rgb(var(--m-brand-on-surface-rgb)/0.6)]"
              />
            </div>

            {cooldownSeconds > 0 && (
              <div className="text-center text-[11px] text-[rgb(var(--m-brand-on-surface-rgb)/0.8)] bg-[rgb(var(--m-brand-on-surface-rgb)/0.05)] py-1.5 rounded-lg border border-[rgb(var(--m-brand-on-surface-rgb)/0.2)]">
                يرجى الانتظار {cooldownSeconds} ثانية قبل إرسال نداء آخر منعاً للتكرار.
              </div>
            )}

            {/* ERROR: human-readable explanation + one-tap retry. The guest's
                selected reason and note are preserved above. */}
            {submitState === 'ERROR' && (
              <div
                role="alert"
                className="rounded-2xl bg-red-500/10 border border-red-500/30 p-3.5 flex items-start gap-3"
              >
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-red-300">تعذر إرسال النداء</p>
                  <p className="text-[11px] text-red-200/80 mt-0.5 leading-relaxed">
                    {errorMessage} — لم يتم تسجيل أي طلب. تحقق من اتصالك بالشبكة وأعد المحاولة.
                  </p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || cooldownSeconds > 0 || !!activeRequest}
              aria-busy={isSubmitting}
              className="w-full py-3.5 rounded-2xl bg-[var(--m-brand-on-surface)] hover:bg-[var(--m-brand-on-surface)] disabled:opacity-50 text-m-bg font-bold text-xs shadow-[0_0_22px_-6px_var(--m-brand-glow)] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري إرسال الطلب...</span>
                </>
              ) : (
                <>
                  <Bell className="w-4 h-4" />
                  <span>
                    {submitState === 'ERROR'
                      ? 'إعادة المحاولة'
                      : activeRequest
                      ? 'يوجد طلب نشط لطاولتك'
                      : cooldownSeconds > 0
                      ? `تم الإرسال — انتظر (${cooldownSeconds}s)`
                      : 'إرسال النداء الآن'}
                  </span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
