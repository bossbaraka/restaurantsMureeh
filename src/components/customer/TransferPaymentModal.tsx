import React, { useEffect, useRef, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useDialog } from '../../hooks/useDialog';
import { formatPrice } from '../../utils/formatting';
import { optimizeImageFile } from '../../utils/imageOptimize';
import { Order } from '../../types/restaurant';
import {
  X,
  Smartphone,
  Upload,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Loader2,
  RefreshCw,
} from 'lucide-react';

// ============================================================
// Guest transfer-payment proof
//
// "Transfer Payment → phone (optional) → receipt image → submit"
// After a successful upload the order is PENDING_VERIFICATION and the cashier
// decides. The order's own total is shown — the guest never types an amount,
// and nothing here is trusted by the server.
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

export const TransferPaymentModal: React.FC<TransferPaymentModalProps> = ({
  isOpen,
  onClose,
  order,
}) => {
  const { currentRestaurant, submitTransferPaymentProof } = useRestaurant();
  const currency = currentRestaurant?.currency || '₪';

  const [phone, setPhone] = useState('');
  const [file, setFile] = useState<File | Blob | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>('');
  const objectUrlRef = useRef<string>('');

  useDialog({ isOpen, onClose });

  // Revoke the preview URL when it changes / the modal closes: an object URL
  // holds the whole file in memory until it is released.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setProgress(0);
    setError('');
    if (phase !== 'success') setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

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
    if (!file) {
      setError('يرجى إرفاق صورة إشعار الحوالة');
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
      phone.trim() || undefined,
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
    setError(result.error || 'تعذر إرسال إشعار الحوالة — حاول مجدداً');
  };

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-3 sm:p-4">
      <div className="fixed inset-0 bg-black/85 backdrop-blur-md" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-payment-title"
        className="relative w-full max-w-lg bg-luxury-900 border border-luxury-700 rounded-3xl p-6 z-10 shadow-2xl space-y-5 animate-fade-in text-right"
        dir="rtl"
      >
        <div className="flex items-center justify-between border-b border-luxury-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[rgb(var(--brand-primary-strong-rgb)/0.1)] border border-[rgb(var(--brand-primary-strong-rgb)/0.3)] flex items-center justify-center text-[var(--brand-primary-strong)]">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 id="transfer-payment-title" className="text-base font-bold text-luxury-50 font-serif">
                الدفع عبر حوالة بنكية
              </h3>
              <p className="text-xs text-luxury-400">
                الطلب {order.id} · {formatPrice(order.total, currency)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="p-2 rounded-xl text-luxury-400 hover:text-luxury-200 hover:bg-luxury-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {phase === 'success' ? (
          <div className="space-y-4 text-center py-4">
            <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-base font-bold text-luxury-100">تم إرسال إشعار الحوالة</h4>
            <p className="text-xs text-luxury-400 leading-relaxed max-w-sm mx-auto">
              سيتحقق الكاشير من الإشعار ويؤكد الدفع. تابع حالة طلبك من شاشة تتبع الطلبات —
              ستظهر «بانتظار التحقق» حتى التأكيد.
            </p>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl brand-cta font-bold text-sm shadow-[0_0_22px_-6px_var(--brand-glow)] transition-all cursor-pointer"
            >
              حسناً
            </button>
          </div>
        ) : (
          <>
            {/* Step 1 — amount (read-only, from the order itself) */}
            <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-2">
              <div className="flex justify-between items-center text-sm font-bold">
                <span className="text-luxury-200">المبلغ المطلوب تحويله</span>
                <span className="text-[var(--brand-primary-strong)] font-mono text-base">
                  {formatPrice(order.total, currency)}
                </span>
              </div>
              <p className="text-[11px] text-luxury-400 leading-relaxed">
                حوّل المبلغ إلى حساب المطعم ثم ارفع صورة إشعار الحوالة ليؤكدها الكاشير.
              </p>
            </div>

            {/* Step 2 — optional phone */}
            <div>
              <label htmlFor="transfer-phone" className="block text-xs font-bold text-luxury-300 mb-1.5">
                رقم الهاتف <span className="text-luxury-500 font-normal">(اختياري — للتواصل عند الحاجة)</span>
              </label>
              <div className="relative">
                <Smartphone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-luxury-500" />
                <input
                  id="transfer-phone"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={24}
                  placeholder="0599123456"
                  className="w-full bg-luxury-950 border border-luxury-800 rounded-xl pr-10 pl-3 py-2.5 text-sm text-luxury-100 placeholder-luxury-600 focus:outline-none focus:border-[rgb(var(--brand-primary-strong-rgb)/0.6)] text-left font-mono"
                />
              </div>
            </div>

            {/* Step 3 — receipt image */}
            <div>
              <label className="block text-xs font-bold text-luxury-300 mb-1.5">صورة إشعار الحوالة</label>
              <div className="flex items-center gap-3">
                <label
                  htmlFor="transfer-proof-file"
                  className="flex-1 cursor-pointer rounded-2xl border border-dashed border-luxury-700 hover:border-[rgb(var(--brand-primary-strong-rgb)/0.6)] bg-luxury-950 px-4 py-3 flex items-center justify-center gap-2 text-xs font-bold text-luxury-300 transition-colors"
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
                    alt="معاينة إشعار الحوالة"
                    className="w-16 h-16 rounded-xl object-cover border border-luxury-800"
                  />
                )}
              </div>
              <p className="text-[11px] text-luxury-500 mt-1.5">
                JPG أو PNG أو WEBP — حد أقصى 5 ميجابايت.
              </p>
            </div>

            {/* Upload progress */}
            {phase === 'uploading' && (
              <div className="space-y-2" role="status" aria-live="polite">
                <div className="flex justify-between text-[11px] text-luxury-300">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري رفع الإشعار...
                  </span>
                  <span className="font-mono">{progress}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-luxury-850 overflow-hidden">
                  <div
                    className="h-full bg-[var(--brand-primary-strong)] transition-all"
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

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="w-1/3 py-3 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-luxury-300 font-bold text-xs transition-colors"
              >
                لاحقاً
              </button>
              <button
                type="button"
                disabled={phase === 'uploading'}
                onClick={handleSubmit}
                className="flex-1 py-3 rounded-xl brand-cta font-bold text-xs shadow-[0_0_22px_-6px_var(--brand-glow)] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {phase === 'error' ? <RefreshCw className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                <span>{phase === 'error' ? 'إعادة المحاولة' : 'إرسال إشعار الحوالة'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
