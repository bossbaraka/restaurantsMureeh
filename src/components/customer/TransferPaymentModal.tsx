import React, { useEffect, useRef, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useDialog } from '../../hooks/useDialog';
import { formatPrice } from '../../utils/formatting';
import { optimizeImageFile } from '../../utils/imageOptimize';
import { Order, TransferChannel } from '../../types/restaurant';
import {
  X,
  Smartphone,
  Upload,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Loader2,
  RefreshCw,
  User,
  Landmark,
  Wallet,
  Copy,
  Check,
} from 'lucide-react';

// ============================================================
// Guest transfer-payment proof
//
// "Transfer channel (bank / wallet) → name → mobile → receipt image → submit"
// After a successful upload the order is PENDING_VERIFICATION, the cashier is
// notified instantly, and the order is HELD out of the kitchen until that
// cashier confirms the money arrived (see OrderTrackingDrawer for the state).
//
// Name and mobile are REQUIRED: a transfer notice the cashier cannot attribute
// to a person is not verifiable. The order's own total is shown — the guest
// never types an amount, and nothing here is trusted by the server.
//
// Uses the shared client-side image pipeline (optimizeImageFile) so a phone
// photo is downscaled before the upload instead of being rejected by the
// server's 5 MB cap.
// ============================================================

interface TransferPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
}

type Phase = 'idle' | 'uploading' | 'success' | 'error';

const CHANNELS: Array<{ id: TransferChannel; label: string; hint: string; icon: React.ReactNode }> = [
  {
    id: 'BANK',
    label: 'حوالة بنكية',
    hint: 'تحويل من حسابك البنكي إلى حساب المطعم',
    icon: <Landmark className="w-4 h-4" />,
  },
  {
    id: 'WALLET',
    label: 'محفظة إلكترونية',
    hint: 'تحويل من محفظتك الإلكترونية إلى محفظة المطعم',
    icon: <Wallet className="w-4 h-4" />,
  },
];

export const TransferPaymentModal: React.FC<TransferPaymentModalProps> = ({
  isOpen,
  onClose,
  order,
}) => {
  const { currentRestaurant, submitTransferPaymentProof } = useRestaurant();
  const currency = currentRestaurant?.currency || '₪';

  // ---------------------------------------------------------------
  // Where the money goes: the venue's own receiving account, configured in
  // Restaurant Settings → Customer Transfer Payment and delivered with the
  // guest catalog (no extra request, no new endpoint).
  //
  // DISPLAY-ONLY. Nothing here is ever sent back to the server: the proof
  // submission below still carries only the guest's name, phone and channel, so
  // no client-supplied account data can reach the settlement path or the
  // cashier's verification decision.
  //
  // A channel with no configured data renders the safe fallback — never an
  // empty card, "undefined" or an invented number.
  // ---------------------------------------------------------------
  const transfer = currentRestaurant?.transfer;
  const venuePhone = (currentRestaurant?.phone || '').trim();
  const bankView = {
    kind: 'BANK' as const,
    providerLabel: 'البنك',
    providerName: transfer?.bankName,
    accountLabel: 'رقم الحساب / IBAN',
    accountValue: transfer?.bankAccount,
    holderLabel: 'اسم صاحب الحساب',
    holderName: transfer?.bankAccountHolder,
  };
  const walletView = {
    kind: 'WALLET' as const,
    providerLabel: 'المحفظة',
    providerName: transfer?.walletName,
    accountLabel: 'رقم المحفظة',
    accountValue: transfer?.walletNumber,
    holderLabel: 'اسم صاحب المحفظة',
    holderName: transfer?.walletAccountHolder,
  };
  const hasBankDetails = Boolean(
    bankView.providerName || bankView.accountValue || bankView.holderName
  );
  const hasWalletDetails = Boolean(
    walletView.providerName || walletView.accountValue || walletView.holderName
  );

  const [channel, setChannel] = useState<TransferChannel>('BANK');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [file, setFile] = useState<File | Blob | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string>('');
  const objectUrlRef = useRef<string>('');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useDialog({ isOpen, onClose });

  // Revoke the preview URL when it changes / the modal closes: an object URL
  // holds the whole file in memory until it is released. The copy confirmation
  // timer is cleared here too, so it can never fire on an unmounted modal.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
      }
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setProgress(0);
    setError('');
    if (phase !== 'success') setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Open on the channel the venue actually receives money through: a guest must
  // not land on «حوالة بنكية» and find no bank account, while a wallet is
  // configured. When both (or neither) are configured the default BANK stays —
  // and with neither, the card below shows the safe fallback.
  useEffect(() => {
    if (!isOpen) return;
    if (!hasBankDetails && hasWalletDetails) setChannel('WALLET');
    else if (hasBankDetails && !hasWalletDetails) setChannel('BANK');
  }, [isOpen, hasBankDetails, hasWalletDetails]);

  if (!isOpen) return null;

  // The receiving account of the channel the guest selected (the effect above
  // already opened the modal on the channel the venue actually configured).
  const activeView = channel === 'WALLET' ? walletView : bankView;
  const hasActiveDetails = channel === 'WALLET' ? hasWalletDetails : hasBankDetails;
  const otherChannelAvailable = channel === 'WALLET' ? hasBankDetails : hasWalletDetails;

  /**
   * Copy an account value for the guest. Best-effort by design: the clipboard
   * API is absent in non-secure contexts and can be denied, and a guest who
   * cannot copy can still read the value (always rendered as selectable text).
   * Never throws and never blocks the submission.
   */
  const handleCopyValue = async (field: string, value: string) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedField(''), 2000);
    } catch {
      // Clipboard unavailable or denied — the value stays visible on screen.
    }
  };

  const handlePickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (!picked) return;
    if (!picked.type.startsWith('image/')) {
      setError('الملف يجب أن يكون صورة بصيغة JPG أو PNG أو WEBP');
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(picked);
    objectUrlRef.current = url;
    setPreviewUrl(url);
    setFile(picked);
    setFileName(picked.name || 'receipt.jpg');
    setError('');
    setPhase('idle');
  };

  const handleSubmit = async () => {
    if (phase === 'uploading') return; // double-submit guard
    // Client-side validation mirrors the server contract (the server re-checks):
    // the cashier must be able to attribute and reach the person who paid.
    if (customerName.trim().length < 2) {
      setError('يرجى كتابة اسم العميل كما هو على إشعار التحويل');
      return;
    }
    if (phone.replace(/\D/g, '').length < 7) {
      setError('يرجى إدخال رقم هاتف محمول صحيح للتواصل عند الحاجة');
      return;
    }
    if (!file) {
      setError('يرجى إرفاق صورة إشعار التحويل');
      return;
    }
    setPhase('uploading');
    setProgress(0);
    setError('');

    // Shrink the photo first (existing shared pipeline). A file the browser
    // cannot decode is rejected here with a clear message; the server would
    // reject it anyway.
    let upload: File | Blob = file;
    try {
      const optimized = await optimizeImageFile(file, 'general');
      upload = optimized.blob;
    } catch {
      setPhase('error');
      setError('تعذر قراءة الصورة — اختر صورة واضحة بصيغة JPG أو PNG أو WEBP');
      return;
    }

    // The server derives the stored type and extension from the magic bytes, so
    // the picked filename is only a multipart hint (the API client normalizes it
    // before it is sent).
    const result = await submitTransferPaymentProof(
      order.id,
      { customerName: customerName.trim(), phone: phone.trim(), channel },
      upload,
      setProgress,
      fileName || undefined
    );

    if (result.success) {
      setPhase('success');
      setProgress(100);
      return;
    }
    // Retry state: keep the chosen file so the guest can resend with one tap.
    setPhase('error');
    setError(result.error || 'تعذر إرسال إشعار التحويل — حاول مجدداً');
  };

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto flex items-start sm:items-center justify-center p-2.5 sm:p-4 overscroll-contain">
      <div className="fixed inset-0 bg-black/85 backdrop-blur-md" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-payment-title"
        className="relative w-full max-w-lg my-auto border border-m-hairline rounded-2xl sm:rounded-3xl p-4 sm:p-6 z-10 animate-fade-in text-right max-h-[calc(100dvh-1.25rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col"
        style={{ backgroundColor: 'var(--m-surface)', boxShadow: 'var(--m-shadow-lg)' }}
        dir="rtl"
      >
        <div className="flex items-center justify-between border-b border-m-hairline pb-3 sm:pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[rgb(var(--m-brand-on-surface-rgb)/0.1)] border border-[rgb(var(--m-brand-on-surface-rgb)/0.3)] flex items-center justify-center text-[var(--m-brand-on-surface)]">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 id="transfer-payment-title" className="text-base font-bold text-m-text font-serif">
                الدفع عبر حوالة بنكية أو محفظة
              </h3>
              <p className="text-xs text-m-text-muted">
                الطلب {order.id} · {formatPrice(order.total, currency)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-10 h-10 rounded-full flex items-center justify-center text-m-text-muted hover:text-m-text hover:bg-m-surface-raised transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {phase === 'success' ? (
          <div className="space-y-4 text-center py-4 overflow-y-auto flex-1">
            <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-base font-bold text-m-text">
              تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع.
            </h4>
            <p className="text-xs text-m-text-muted leading-relaxed max-w-sm mx-auto">
              ظهر إشعارك فوراً على شاشة الكاشير مع تفاصيل الطلب. بعد تأكيد الكاشير للعملية
              ينتقل طلبك إلى المطبخ مباشرة بحالة «جاهز للبدء». تابع الحالة من شاشة تتبع الطلبات.
            </p>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl brand-cta font-bold text-sm transition-all cursor-pointer"
            >
              حسناً
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-4 sm:space-y-5 pr-0.5 custom-scrollbar py-1">
              {/* Step 1 — amount (read-only, from the order itself) */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-m-bg border border-m-hairline space-y-2">
                <div className="flex justify-between items-center text-sm font-bold">
                  <span className="text-m-text">المبلغ المطلوب تحويله</span>
                  <span className="text-[var(--m-brand-on-surface)] font-mono text-base">
                    {formatPrice(order.total, currency)}
                  </span>
                </div>
                <p className="text-[11px] text-m-text-muted leading-relaxed">
                  حوّل المبلغ إلى حساب المطعم أو محفظته، ثم أرسل إشعار التحويل مع اسمك ورقم هاتفك
                  ليؤكده الكاشير — يمكنك أيضاً الدفع نقداً عند الكاشير.
                </p>
                <p className="text-[11px] font-bold text-m-text leading-relaxed">
                  لا يبدأ المطبخ بتحضير الطلب قبل تأكيد الدفع
                </p>
              </div>

              {/* Step 1b — WHERE to send it: the venue's own receiving account
                  for the selected channel (Restaurant Settings → Customer
                  Transfer Payment, delivered with the guest catalog). Read-only
                  and display-only: it is never submitted, and the cashier still
                  verifies the money against the receipt below. A channel the
                  venue did not configure renders the safe fallback — never an
                  empty card, "undefined" or an invented number. */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-m-bg border border-m-hairline space-y-2.5">
                {hasActiveDetails ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-m-text">
                        {channel === 'WALLET' ? (
                          <Wallet className="w-3.5 h-3.5 text-[var(--m-brand-on-surface)]" />
                        ) : (
                          <Landmark className="w-3.5 h-3.5 text-[var(--m-brand-on-surface)]" />
                        )}
                        {channel === 'WALLET' ? 'حوّل إلى محفظة المطعم' : 'حوّل إلى حساب المطعم البنكي'}
                      </span>
                      {activeView.providerName && (
                        <span className="text-[11px] font-bold text-[var(--m-brand-on-surface)] truncate">
                          {activeView.providerName}
                        </span>
                      )}
                    </div>

                    {activeView.accountValue && (
                      <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-m-surface border border-m-hairline">
                        <div className="min-w-0">
                          <span className="block text-[10px] text-m-text-subtle">{activeView.accountLabel}</span>
                          <span
                            dir="ltr"
                            className="block text-xs font-mono font-bold text-m-text break-all select-all"
                          >
                            {activeView.accountValue}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyValue('account', activeView.accountValue || '')}
                          aria-label={`نسخ ${activeView.accountLabel}`}
                          className="shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg bg-m-surface-raised hover:bg-m-surface-raised border border-m-hairline text-[10px] font-bold text-m-text transition-colors cursor-pointer"
                        >
                          {copiedField === 'account' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedField === 'account' ? 'تم النسخ' : 'نسخ'}</span>
                        </button>
                      </div>
                    )}

                    {(activeView.providerName || activeView.holderName) && (
                      <dl className="space-y-1.5">
                        {activeView.providerName && (
                          <div className="flex justify-between items-start gap-3 text-[11px]">
                            <dt className="text-m-text-subtle shrink-0">
                              {channel === 'WALLET' ? 'اسم المحفظة' : 'اسم البنك'}
                            </dt>
                            <dd className="font-bold text-m-text">{activeView.providerName}</dd>
                          </div>
                        )}
                        {activeView.holderName && (
                          <div className="flex justify-between items-start gap-3 text-[11px]">
                            <dt className="text-m-text-subtle shrink-0">{activeView.holderLabel}</dt>
                            <dd className="font-bold text-m-text">{activeView.holderName}</dd>
                          </div>
                        )}
                      </dl>
                    )}

                    {transfer?.instructions && (
                      <p className="text-[11px] text-m-text-muted leading-relaxed whitespace-pre-line border-t border-m-hairline pt-2">
                        {transfer.instructions}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-bold text-m-text flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-m-text-subtle shrink-0" />
                      {channel === 'WALLET'
                        ? 'لم يعلن المطعم بيانات محفظته الإلكترونية بعد'
                        : 'لم يعلن المطعم بيانات حسابه البنكي بعد'}
                    </p>
                    <p className="text-[11px] text-m-text-muted leading-relaxed">
                      {venuePhone ? (
                        <>
                          تواصل مع المطعم على{' '}
                          <span dir="ltr" className="font-mono font-bold text-m-text">
                            {venuePhone}
                          </span>{' '}
                          للحصول على بيانات التحويل، أو ادفع نقداً عند الكاشير.
                        </>
                      ) : (
                        'تواصل مع طاقم المطعم للحصول على بيانات التحويل، أو ادفع نقداً عند الكاشير.'
                      )}
                    </p>
                    {otherChannelAvailable && (
                      <p className="text-[11px] text-m-text-subtle leading-relaxed">
                        {channel === 'WALLET'
                          ? 'يستقبل المطعم التحويل البنكي — اختر «حوالة بنكية» أدناه لتظهر بيانات الحساب.'
                          : 'يستقبل المطعم التحويل بالمحفظة — اختر «محفظة إلكترونية» أدناه لتظهر بيانات المحفظة.'}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Step 2 — how the money was sent (display hint for the cashier) */}
              <div>
                <label className="block text-xs font-bold text-m-text-muted mb-1.5">طريقة التحويل</label>
                <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2" role="radiogroup" aria-label="طريقة التحويل">
                  {CHANNELS.map((option) => {
                    const active = channel === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setChannel(option.id)}
                        className={`p-2.5 rounded-2xl border text-right transition-colors cursor-pointer ${
                          active
                            ? 'bg-[rgb(var(--m-brand-on-surface-rgb)/0.12)] border-[rgb(var(--m-brand-on-surface-rgb)/0.6)]'
                            : 'bg-m-bg border-m-hairline hover:border-m-hairline'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-xs font-bold text-m-text">
                          {option.icon}
                          {option.label}
                        </span>
                        <span className="block text-[10px] text-m-text-subtle mt-1 leading-relaxed">
                          {option.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 3 — guest identity (required) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                <div>
                  <label htmlFor="transfer-name" className="block text-xs font-bold text-m-text-muted mb-1.5">
                    اسم العميل <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-m-text-subtle" />
                    <input
                      id="transfer-name"
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      maxLength={60}
                      autoComplete="name"
                      placeholder="الاسم كما هو على إشعار التحويل"
                      className="w-full bg-m-bg border border-m-hairline rounded-xl pr-10 pl-3 py-2.5 text-sm text-m-text placeholder-m-text-subtle focus:outline-none focus:border-[rgb(var(--m-brand-on-surface-rgb)/0.6)]"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="transfer-phone" className="block text-xs font-bold text-m-text-muted mb-1.5">
                    رقم الهاتف المحمول <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Smartphone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-m-text-subtle" />
                    <input
                      id="transfer-phone"
                      type="tel"
                      inputMode="tel"
                      dir="ltr"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      maxLength={24}
                      autoComplete="tel"
                      placeholder="0599123456"
                      className="w-full bg-m-bg border border-m-hairline rounded-xl pr-10 pl-3 py-2.5 text-sm text-m-text placeholder-m-text-subtle focus:outline-none focus:border-[rgb(var(--m-brand-on-surface-rgb)/0.6)] text-left font-mono"
                    />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-m-text-subtle -mt-2">
                يُستخدم الاسم ورقم الهاتف لمطابقة التحويل مع الطلب والتواصل عند الحاجة فقط.
              </p>

              {/* Step 4 — receipt image */}
              <div>
                <label className="block text-xs font-bold text-m-text-muted mb-1.5">صورة إشعار التحويل</label>
                <div className="flex items-center gap-3">
                  <label
                    htmlFor="transfer-proof-file"
                    className="flex-1 cursor-pointer rounded-2xl border border-dashed border-m-hairline hover:border-[rgb(var(--m-brand-on-surface-rgb)/0.6)] bg-m-bg px-4 py-3 flex items-center justify-center gap-2 text-xs font-bold text-m-text-muted transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{file ? 'تغيير الصورة' : 'اختر صورة الإشعار'}</span>
                  </label>
                  <input
                    id="transfer-proof-file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handlePickFile}
                    className="hidden"
                  />
                  {previewUrl && (
                    <img
                      src={previewUrl}
                      alt="معاينة إشعار التحويل"
                      className="w-16 h-16 rounded-xl object-cover border border-m-hairline"
                    />
                  )}
                </div>
                <p className="text-[11px] text-m-text-subtle mt-1.5">
                  JPG أو PNG أو WEBP — حد أقصى 5 ميجابايت.
                </p>
              </div>

              {/* Upload progress */}
              {phase === 'uploading' && (
                <div className="space-y-2" role="status" aria-live="polite">
                  <div className="flex justify-between text-[11px] text-m-text-muted">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري إرسال الإشعار للكاشير...
                    </span>
                    <span className="font-mono">{progress}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-m-surface-raised overflow-hidden">
                    <div
                      className="h-full bg-[var(--m-brand-on-surface)] transition-all"
                      style={{ width: `${Math.max(4, progress)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Error / retry state */}
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-300"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <p className="text-[11px] text-m-text-subtle leading-relaxed">
                لم تحوّل المبلغ بعد؟ يمكنك إغلاق هذه النافذة والعودة إليها من «تتبع الطلب» — مع
                العلم أن الطلب يبقى بانتظار الدفع ولا يظهر في المطبخ حتى يؤكده الكاشير.
              </p>
            </div>

            <div className="flex gap-2.5 sm:gap-3 pt-3 border-t border-m-hairline/80 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="w-1/3 py-2.5 sm:py-3 rounded-xl bg-m-surface-raised hover:bg-m-surface-raised text-m-text-muted font-bold text-xs transition-colors"
              >
                لاحقاً
              </button>
              <button
                type="button"
                disabled={phase === 'uploading'}
                onClick={handleSubmit}
                className="flex-1 py-2.5 sm:py-3 rounded-xl brand-cta font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {phase === 'error' ? <RefreshCw className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                <span>{phase === 'error' ? 'إعادة المحاولة' : 'إرسال إشعار التحويل'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
