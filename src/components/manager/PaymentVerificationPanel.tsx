import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { formatPrice } from '../../utils/formatting';
import { PaymentVerificationItem } from '../../types/restaurant';
import {
  BadgeCheck,
  XCircle,
  Image as ImageIcon,
  RefreshCw,
  Phone,
  Clock,
  Loader2,
  AlertCircle,
  Banknote,
} from 'lucide-react';

// ============================================================
// Cashier — transfer payment verification
//
// Answers ONE question in the cashier's own screen: "which order needs
// verification?" List → view the private receipt → confirm / reject.
//
// The queue is refetched only when the SET of pending orders changes (driven by
// the existing SSE + background refresh), never on a polling loop of its own.
// Receipt images are fetched as authenticated blobs and revoked on close.
// ============================================================

export const PaymentVerificationPanel: React.FC = () => {
  const { currentRestaurant, orders, showToast } = useRestaurant();
  const { currentUser } = useAuth();
  const tenantId = currentRestaurant?.id || '';
  const currency = currentRestaurant?.currency || '₪';

  const [items, setItems] = useState<PaymentVerificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const [openItem, setOpenItem] = useState<PaymentVerificationItem | null>(null);
  const [proofUrl, setProofUrl] = useState('');
  const [proofLoading, setProofLoading] = useState(false);
  const [proofError, setProofError] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const objectUrlRef = useRef('');

  const canVerify = currentUser?.role === 'CASHIER' || currentUser?.role === 'RESTAURANT_MANAGER';

  // Identity of the pending set: refetch only when it actually changes.
  const pendingKey = useMemo(
    () =>
      orders
        .filter((o) => o.paymentStatus === 'PENDING_VERIFICATION' && o.status !== 'CANCELLED')
        .map((o) => o.id)
        .sort()
        .join(','),
    [orders]
  );

  const releaseProof = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }
    setProofUrl('');
  }, []);

  const loadQueue = useCallback(async () => {
    if (!currentUser || !tenantId || !canVerify) return;
    setIsLoading(true);
    const res = await api.getPaymentVerifications(currentUser, tenantId);
    setIsLoading(false);
    if (res.success && res.data) {
      setItems(res.data);
      setLoadError('');
      return;
    }
    setLoadError(res.error || 'تعذر تحميل طلبات التحقق');
  }, [currentUser, tenantId, canVerify]);

  useEffect(() => {
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, pendingKey, canVerify]);

  useEffect(() => () => releaseProof(), [releaseProof]);

  const openProof = async (item: PaymentVerificationItem) => {
    setOpenItem(item);
    setRejectReason('');
    setProofError('');
    releaseProof();
    if (!tenantId) return;
    setProofLoading(true);
    const res = await api.fetchPaymentProofObjectUrl(tenantId, item.orderId);
    setProofLoading(false);
    if (res.success && res.data) {
      objectUrlRef.current = res.data.objectUrl;
      setProofUrl(res.data.objectUrl);
      return;
    }
    setProofError(res.error || 'تعذر تحميل صورة الإشعار');
  };

  const closeProof = () => {
    releaseProof();
    setOpenItem(null);
    setRejectReason('');
  };

  const handleConfirm = async (item: PaymentVerificationItem) => {
    if (!currentUser || !tenantId || busyOrderId) return;
    setBusyOrderId(item.orderId);
    const res = await api.confirmTransferPayment(currentUser, tenantId, item.orderId);
    setBusyOrderId(null);
    if (res.success && res.data) {
      showToast('success', 'تم تأكيد الدفع', `إيصال ${res.data.payment.receiptNumber} — ${formatPrice(res.data.payment.total, currency)}`);
      closeProof();
      void loadQueue();
      return;
    }
    showToast('error', 'تعذر تأكيد الدفع', res.error);
    // Someone else may have processed it first: resync the queue.
    void loadQueue();
  };

  const handleReject = async (item: PaymentVerificationItem) => {
    if (!currentUser || !tenantId || busyOrderId) return;
    setBusyOrderId(item.orderId);
    const res = await api.rejectTransferPayment(
      currentUser,
      tenantId,
      item.orderId,
      rejectReason.trim() || undefined
    );
    setBusyOrderId(null);
    if (res.success) {
      showToast('info', 'تم رفض الإشعار', 'أصبح بإمكان الزبون الدفع عند الكاشير.');
      closeProof();
      void loadQueue();
      return;
    }
    showToast('error', 'تعذر رفض الإشعار', res.error);
    void loadQueue();
  };

  // Waiters/kitchen staff have no permission for this surface at all.
  if (!canVerify) return null;

  return (
    <div className="rounded-2xl bg-luxury-900 border border-amber-500/30 overflow-hidden" dir="rtl">
      <div className="p-3 border-b border-luxury-800 bg-amber-500/5 flex items-center justify-between">
        <h3 className="text-xs font-bold text-amber-200 flex items-center gap-2">
          <BadgeCheck className="w-4 h-4" />
          تحقق من إشعارات الحوالات
          {items.length > 0 && (
            <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-500 text-luxury-950 text-[11px] font-bold flex items-center justify-center">
              {items.length}
            </span>
          )}
        </h3>
        <button
          onClick={() => void loadQueue()}
          disabled={isLoading}
          className="p-1.5 rounded-lg text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800 transition-colors cursor-pointer disabled:opacity-50"
          aria-label="تحديث قائمة التحقق"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {loadError && (
        <p className="p-3 text-[11px] text-red-300 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {loadError}
        </p>
      )}

      {items.length === 0 && !loadError ? (
        <p className="p-3 text-[11px] text-luxury-500">
          لا توجد إشعارات بانتظار التحقق. ستظهر هنا تلقائياً عند إرسال الزبون إشعار حوالة.
        </p>
      ) : (
        <div className="divide-y divide-luxury-800 max-h-72 overflow-y-auto">
          {items.map((item) => (
            <div key={item.orderId} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-xs text-luxury-100">
                    {item.numericId ? `#${item.numericId}` : item.orderId}
                  </span>
                  <span className="text-[11px] text-luxury-400">
                    {item.tableNumber != null ? `طاولة ${item.tableNumber}` : item.tableName || '—'}
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 font-bold">
                    حوالة بنكية
                  </span>
                </div>
                <div className="text-[11px] text-luxury-500 flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="font-bold text-gold-300 font-mono">{formatPrice(item.total, currency)}</span>
                  {item.customerPhone && (
                    <span className="flex items-center gap-1 font-mono" dir="ltr">
                      <Phone className="w-3 h-3" /> {item.customerPhone}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(item.submittedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => void openProof(item)}
                  className="px-2.5 py-1.5 rounded-lg bg-luxury-850 hover:bg-luxury-800 border border-luxury-750 text-luxury-200 text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5" /> الإشعار
                </button>
                <button
                  onClick={() => void handleConfirm(item)}
                  disabled={busyOrderId === item.orderId}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {busyOrderId === item.orderId ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <BadgeCheck className="w-3.5 h-3.5" />
                  )}
                  تأكيد
                </button>
                <button
                  onClick={() => void openProof(item)}
                  className="px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" /> رفض
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Receipt preview + decision */}
      {openItem && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4">
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md" onClick={closeProof} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-proof-title"
            className="relative w-full max-w-lg bg-luxury-900 border border-luxury-700 rounded-3xl p-5 z-10 shadow-2xl space-y-4 text-right max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-luxury-800 pb-3">
              <div>
                <h4 id="payment-proof-title" className="text-sm font-bold text-luxury-50 flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-gold-400" />
                  إشعار حوالة — الطلب {openItem.numericId ? `#${openItem.numericId}` : openItem.orderId}
                </h4>
                <p className="text-[11px] text-luxury-400 mt-0.5">
                  {formatPrice(openItem.total, currency)} ·{' '}
                  {openItem.tableNumber != null ? `طاولة ${openItem.tableNumber}` : openItem.tableName || '—'}
                  {openItem.customerPhone ? ` · ${openItem.customerPhone}` : ''}
                </p>
              </div>
              <button
                onClick={closeProof}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-luxury-950 border border-luxury-800 p-2 min-h-40 flex items-center justify-center">
              {proofLoading ? (
                <span className="text-[11px] text-luxury-400 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> جاري تحميل صورة الإشعار...
                </span>
              ) : proofError ? (
                <span className="text-[11px] text-red-300 flex items-center gap-2 text-center px-4">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {proofError}
                </span>
              ) : proofUrl ? (
                <img
                  src={proofUrl}
                  alt="إشعار الحوالة"
                  className="max-h-[50vh] w-auto rounded-xl object-contain"
                />
              ) : null}
            </div>

            <div className="space-y-2">
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                maxLength={300}
                placeholder="سبب الرفض (اختياري) — يظهر للزبون"
                className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-3 py-2 text-xs text-luxury-100 placeholder-luxury-600 focus:outline-none focus:border-red-500/50"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void handleReject(openItem)}
                  disabled={busyOrderId === openItem.orderId}
                  className="flex-1 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> رفض الإشعار
                </button>
                <button
                  onClick={() => void handleConfirm(openItem)}
                  disabled={busyOrderId === openItem.orderId}
                  className="flex-1 py-2.5 rounded-xl brand-cta font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {busyOrderId === openItem.orderId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <BadgeCheck className="w-4 h-4" />
                  )}
                  تأكيد الدفع
                </button>
              </div>
              <p className="text-[10px] text-luxury-500 leading-relaxed">
                التأكيد يسجّل إيصالاً بقيمة الطلب ({formatPrice(openItem.total, currency)}) ويحوّل حالته إلى
                مدفوع. لا يمكن تأكيد الطلب مرتين — أي محاولة ثانية ستُرفض من الخادم.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
