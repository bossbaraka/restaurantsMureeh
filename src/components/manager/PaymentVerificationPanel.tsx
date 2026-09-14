import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { formatPrice } from '../../utils/formatting';
import { PaymentVerificationItem, TransferChannel } from '../../types/restaurant';
import { isOrderHeldForPayment } from '../../utils/orderLifecycle';
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
  User,
  Landmark,
  Wallet,
  ChefHat,
} from 'lucide-react';

// ============================================================
// Cashier — transfer payment verification
//
// Answers ONE question in the cashier's own screen: "which order needs
// verification?" List → guest identity + the order's own items + the private
// receipt → confirm / reject.
//
// A submission reaches this panel the moment the guest sends it (the existing
// SSE + background refresh drive the queue — no polling loop of its own).
//
// Two groups, because the cashier's two questions are different:
//   1. "a receipt is attached — may I release the money?"  → confirm / reject
//        (confirm settles the money AND opens the payment gate: the order is
//         released to the KDS as a fresh "ready to start" ticket)
//   2. "the guest placed an order but has not paid yet"      → waiting on the
//        guest (no receipt to inspect, nothing to confirm; the order becomes
//        collectable cash at the POS, which releases it)
//
// Receipt images are fetched as authenticated blobs and revoked on close.
// ============================================================

/**
 * Display hint only — the ledger method is always TRANSFER. Local to this
 * screen on purpose: the channel label is a cashier-facing string, not a
 * shared domain value.
 */
const TRANSFER_CHANNEL_LABEL: Record<TransferChannel, string> = {
  BANK: 'حوالة بنكية',
  WALLET: 'محفظة إلكترونية',
};

const channelLabel = (channel?: TransferChannel): string =>
  channel === 'WALLET' ? TRANSFER_CHANNEL_LABEL.WALLET : TRANSFER_CHANNEL_LABEL.BANK;

const ChannelIcon: React.FC<{ channel?: TransferChannel; className?: string }> = ({
  channel,
  className = 'w-3.5 h-3.5',
}) =>
  channel === 'WALLET' ? <Wallet className={className} /> : <Landmark className={className} />;

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

  // Identity of the queue: refetch only when the set actually changes. Both
  // groups are watched — a new awaiting-payment order and a newly attached
  // receipt both have to appear without a manual refresh.
  const pendingKey = useMemo(
    () =>
      orders
        .filter((o) => o.status !== 'CANCELLED' && isOrderHeldForPayment(o))
        .map((o) => `${o.id}:${o.fulfillmentState || o.paymentStatus}`)
        .sort()
        .join(','),
    [orders]
  );

  // Receipts waiting for a decision (actionable) vs orders the guest has not
  // paid for yet (informational).
  const verificationQueue = useMemo(
    () => items.filter((item) => item.state !== 'WAITING_RECEIPT'),
    [items]
  );
  const awaitingReceiptQueue = useMemo(
    () => items.filter((item) => item.state === 'WAITING_RECEIPT'),
    [items]
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
    const res = await api.getPaymentVerifications(currentUser, tenantId, {
      includeAwaiting: true,
    });
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
    // `res.success` is the whole test: the server accepted the confirmation.
    // A replay can legitimately carry no receipt row (`payment: null`) and the
    // previous `res.success && res.data` + unguarded `payment.receiptNumber`
    // read turned that success into «تعذر تأكيد الدفع» — over money that had
    // already been settled and a gate that had already opened.
    if (res.success) {
      const receipt = res.data?.payment || null;
      const released = res.data?.kitchenReleased;
      const receiptLine = receipt
        ? `إيصال ${receipt.receiptNumber} — ${formatPrice(receipt.total, currency)}`
        : 'الإيصال مسجّل مسبقاً لدى الصندوق';
      showToast(
        'success',
        res.data?.alreadyConfirmed
          ? 'كان هذا الإشعار مؤكداً مسبقاً'
          : released
            ? 'تم تأكيد الدفع وإرسال الطلب للمطبخ'
            : 'تم تأكيد الدفع',
        res.data?.alreadyConfirmed
          ? `${receiptLine} — لم يُنشأ إيصال مزدوج، وحالة المطبخ كما هي.`
          : released
            ? `${receiptLine} · الطلب الآن في المطبخ جاهز للبدء`
            : receiptLine
      );
      closeProof();
      void loadQueue();
      return;
    }
    // The server's own Arabic reason (already paid / no receipt attached /
    // another device got there first) is the actionable part.
    showToast(
      'error',
      'تعذر تأكيد الدفع',
      res.error || 'لم يقبل الخادم التأكيد. حدّث القائمة وحاول مجدداً.'
    );
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
      showToast('info', 'تم رفض الإشعار', 'الطلب بقي خارج المطبخ؛ يمكن للزبون إرسال إشعار جديد أو الدفع عند الكاشير.');
      closeProof();
      void loadQueue();
      return;
    }
    showToast(
      'error',
      'تعذر رفض الإشعار',
      res.error || 'لم يقبل الخادم الرفض. حدّث القائمة وحاول مجدداً.'
    );
    void loadQueue();
  };

  // Waiters/kitchen staff have no permission for this surface at all.
  if (!canVerify) return null;

  return (
    <div className="rounded-2xl bg-luxury-900 border border-amber-500/30 overflow-hidden" dir="rtl">
      <div className="p-3 border-b border-luxury-800 bg-amber-500/5 flex items-center justify-between">
        <h3 className="text-xs font-bold text-amber-200 flex items-center gap-2">
          <BadgeCheck className="w-4 h-4" />
          تحقق من إشعارات التحويلات
          {verificationQueue.length > 0 && (
            <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-500 text-luxury-950 text-[11px] font-bold flex items-center justify-center">
              {verificationQueue.length}
            </span>
          )}
          {awaitingReceiptQueue.length > 0 && (
            <span className="min-w-5 h-5 px-1.5 rounded-full bg-luxury-700 text-luxury-100 text-[11px] font-bold flex items-center justify-center">
              {awaitingReceiptQueue.length} بانتظار الدفع
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
          لا توجد إشعارات بانتظار التحقق. ستظهر هنا تلقائياً عند إرسال الزبون إشعار تحويل.
        </p>
      ) : (
        <div className="divide-y divide-luxury-800 max-h-96 overflow-y-auto">
          {verificationQueue.map((item) => (
            <div key={item.orderId} className="p-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-xs text-luxury-100">
                    {item.numericId ? `#${item.numericId}` : item.orderId}
                  </span>
                  <span className="text-[11px] text-luxury-400">
                    {item.tableNumber != null ? `طاولة ${item.tableNumber}` : item.tableName || '—'}
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 font-bold flex items-center gap-1">
                    <ChannelIcon channel={item.transferChannel} className="w-3 h-3" />
                    {channelLabel(item.transferChannel)}
                  </span>
                </div>

                {/* Guest identity — the cashier matches it against the notice. */}
                <div className="text-[11px] text-luxury-400 flex items-center gap-2 mt-0.5 flex-wrap">
                  {item.customerName && (
                    <span className="flex items-center gap-1 text-luxury-200 font-bold">
                      <User className="w-3 h-3" /> {item.customerName}
                    </span>
                  )}
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

                {/* The order itself: the cashier verifies the money against it. */}
                <div className="text-[11px] text-luxury-500 mt-1 leading-relaxed">
                  <span className="font-bold text-gold-300 font-mono">{formatPrice(item.total, currency)}</span>
                  {item.itemsCount ? ` · ${item.itemsCount} صنف` : ''}
                  {item.itemsSummary ? ` · ${item.itemsSummary}` : ''}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => void openProof(item)}
                  className="px-2.5 py-1.5 rounded-lg bg-luxury-850 hover:bg-luxury-800 border border-luxury-750 text-luxury-200 text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5" /> الطلب والإشعار
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

          {awaitingReceiptQueue.length > 0 && (
            <div className="p-3 bg-luxury-950/60 space-y-2">
              <p className="text-[11px] font-bold text-luxury-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-luxury-400" />
                طلبات بانتظار دفع الزبون — لا يوجد إشعار للتحقق بعد
              </p>
              <p className="text-[10px] text-luxury-500 leading-relaxed">
                الطلب محجوز عن المطبخ حتى يتم الدفع. إن دفع الزبون نقداً عند الصندوق، حصّل الفاتورة
                من نقطة البيع — التحصيل يفرج عن الطلب للمطبخ تلقائياً. وإن أرسل إشعار تحويل فسيظهر
                في الأعلى فوراً.
              </p>
              {awaitingReceiptQueue.map((item) => (
                <div
                  key={item.orderId}
                  className="flex items-start justify-between gap-3 rounded-xl border border-luxury-800 bg-luxury-900/60 p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs text-luxury-200">
                        {item.numericId ? `#${item.numericId}` : item.orderId}
                      </span>
                      <span className="text-[11px] text-luxury-400">
                        {item.tableNumber != null ? `طاولة ${item.tableNumber}` : item.tableName || '—'}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                          item.fulfillmentState === 'PAYMENT_REJECTED'
                            ? 'bg-red-500/15 text-red-300'
                            : 'bg-luxury-800 text-luxury-300'
                        }`}
                      >
                        {item.fulfillmentState === 'PAYMENT_REJECTED'
                          ? 'رُفض الإشعار — بانتظار إجراء الزبون'
                          : 'بانتظار دفع الزبون'}
                      </span>
                    </div>
                    <div className="text-[11px] text-luxury-500 mt-1">
                      <span className="font-bold text-gold-300 font-mono">
                        {formatPrice(item.total, currency)}
                      </span>
                      {item.itemsCount ? ` · ${item.itemsCount} صنف` : ''}
                      {item.itemsSummary ? ` · ${item.itemsSummary}` : ''}
                    </div>
                  </div>
                  <span className="text-[10px] text-luxury-500 shrink-0">
                    {new Date(item.submittedAt).toLocaleTimeString('ar-EG', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Order details + receipt + decision */}
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
                  إشعار تحويل — الطلب {openItem.numericId ? `#${openItem.numericId}` : openItem.orderId}
                </h4>
                <p className="text-[11px] text-luxury-400 mt-0.5">
                  {formatPrice(openItem.total, currency)} ·{' '}
                  {openItem.tableNumber != null ? `طاولة ${openItem.tableNumber}` : openItem.tableName || '—'}
                  {' · '}
                  {channelLabel(openItem.transferChannel)}
                  {openItem.customerName ? ` · ${openItem.customerName}` : ''}
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

            {/* The order the transfer must cover (same numbers the guest sees). */}
            <div className="rounded-2xl bg-luxury-950 border border-luxury-800 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-luxury-300">
                <ChefHat className="w-3.5 h-3.5 text-gold-400" /> أصناف الطلب
                <span className="text-luxury-500 font-normal">
                  (لا يُرسل إلى المطبخ إلا بعد تأكيدك)
                </span>
              </div>
              {(openItem.items && openItem.items.length > 0 ? openItem.items : []).map((line, idx) => (
                <div key={idx} className="text-[11px] border-b border-luxury-850 last:border-0 pb-1.5 last:pb-0">
                  <div className="flex justify-between text-luxury-100 font-bold">
                    <span>
                      {line.quantity} × {line.productName}
                    </span>
                    {line.totalPrice !== undefined && (
                      <span className="font-mono">{formatPrice(line.totalPrice, currency)}</span>
                    )}
                  </div>
                  {(line.selectedSize ||
                    (line.selectedAddOns && line.selectedAddOns.length > 0) ||
                    (line.removedIngredients && line.removedIngredients.length > 0) ||
                    line.specialInstructions) && (
                    <div className="text-luxury-500 mt-0.5 space-y-0.5">
                      {line.selectedSize && <div>الحجم: {line.selectedSize}</div>}
                      {line.selectedAddOns && line.selectedAddOns.length > 0 && (
                        <div className="text-emerald-400">+ {line.selectedAddOns.join('، ')}</div>
                      )}
                      {line.removedIngredients && line.removedIngredients.length > 0 && (
                        <div className="text-red-400">- بدون: {line.removedIngredients.join('، ')}</div>
                      )}
                      {line.specialInstructions && <div className="text-amber-300">ملاحظة: {line.specialInstructions}</div>}
                    </div>
                  )}
                </div>
              ))}
              {(!openItem.items || openItem.items.length === 0) && (
                <p className="text-[11px] text-luxury-500">
                  {openItem.itemsSummary || 'لم يتم تحميل أصناف الطلب — حدّث القائمة.'}
                </p>
              )}
              <div className="flex justify-between border-t border-luxury-800 pt-2 text-xs font-bold text-luxury-100">
                <span>الإجمالي المطلوب تحويله</span>
                <span className="font-mono text-gold-300">{formatPrice(openItem.total, currency)}</span>
              </div>
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
                  alt="إشعار التحويل"
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
                  تأكيد الدفع وإرسال للمطبخ
                </button>
              </div>
              <p className="text-[10px] text-luxury-500 leading-relaxed">
                التأكيد يسجّل إيصالاً بقيمة الطلب ({formatPrice(openItem.total, currency)})، يحوّل حالته إلى
                مدفوع، ويُظهر الطلب فوراً في شاشة المطبخ بحالة «جاهز للبدء». لا يمكن تأكيد الطلب مرتين — أي
                محاولة ثانية ستُرفض من الخادم.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
