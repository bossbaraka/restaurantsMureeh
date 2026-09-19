import React, { useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { ShieldAlert, Lock, X } from 'lucide-react';

// ============================================================
// Step-up authentication modal.
//
// Sensitive operations (payment void, employee credential/role/status
// changes, employee deletion) require a FRESH verification of the
// current user's secret: managers/platform staff re-enter their
// password, shift staff re-enter their 6-digit PIN. The returned token
// is valid for 5 minutes and bound to the user's current session.
// ============================================================

interface StepUpModalProps {
  isOpen: boolean;
  /** Human-readable description of the sensitive action being confirmed. */
  actionLabel: string;
  onCancel: () => void;
  /** Called with the fresh step-up token. */
  onVerified: (stepUpToken: string) => void;
}

export const StepUpModal: React.FC<StepUpModalProps> = ({
  isOpen,
  actionLabel,
  onCancel,
  onVerified,
}) => {
  const { currentUser } = useAuth();
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const isShiftStaff =
    currentUser?.role === 'WAITER' ||
    currentUser?.role === 'KITCHEN' ||
    currentUser?.role === 'CASHIER' ||
    currentUser?.role === 'STAFF';

  useDialog({ isOpen, onClose: onCancel });

  if (!isOpen) return null;

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim() || isVerifying) return;
    setIsVerifying(true);
    setErrorMsg('');
    const res = await api.stepUp(
      isShiftStaff ? { pin: secret.trim() } : { password: secret }
    );
    setIsVerifying(false);
    if (res.success && res.data?.stepUpToken) {
      setSecret('');
      onVerified(res.data.stepUpToken);
    } else {
      setErrorMsg(res.error || 'كلمة المرور أو رمز PIN غير صحيح');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stepup-title"
        className="bg-luxury-900 border border-luxury-750 rounded-2xl w-full max-w-sm p-6 relative shadow-2xl my-4"
        dir="rtl"
      >
        <div className="flex items-start justify-between mb-3">
          <h2 id="stepup-title" className="text-lg font-bold font-serif text-luxury-50 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-gold-400" />
            <span>تأكيد الهوية</span>
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-2 rounded-xl bg-luxury-800/80 hover:bg-luxury-750 text-luxury-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-luxury-400 text-xs mb-5 leading-relaxed">
          الإجراء «{actionLabel}» حساس ويتطلب تأكيداً جديداً لهويتك. أدخل{' '}
          {isShiftStaff ? 'رمز PIN الخاص بك' : 'كلمة المرور الخاصة بك'} للمتابعة.
        </p>

        <form onSubmit={handleVerify} className="space-y-4">
          <div className="relative">
            <input
              aria-label={isShiftStaff ? 'رمز PIN' : 'كلمة المرور'}
              type={isShiftStaff ? 'password' : showSecret ? 'text' : 'password'}
              inputMode={isShiftStaff ? 'numeric' : undefined}
              maxLength={isShiftStaff ? 6 : 128}
              placeholder={isShiftStaff ? '••••••' : '••••••••'}
              value={secret}
              onChange={(e) => setSecret(isShiftStaff ? e.target.value.replace(/\D/g, '') : e.target.value)}
              className="w-full bg-luxury-950 border border-luxury-800 rounded-xl pr-4 pl-10 py-3 text-sm text-luxury-100 font-mono tracking-widest placeholder-luxury-600 focus:outline-none focus:border-gold-500/60 text-center"
              autoFocus
              disabled={isVerifying}
            />
            {!isShiftStaff && (
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 hover:text-luxury-200 cursor-pointer"
              >
                {showSecret ? 'إخفاء' : 'إظهار'}
              </button>
            )}
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-luxury-800">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-xs font-medium text-luxury-400 hover:text-luxury-200 hover:bg-luxury-800 transition-colors cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={!secret.trim() || (isShiftStaff && secret.length !== 6) || isVerifying}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gold-500 hover:bg-gold-400 text-luxury-950 transition-colors shadow-gold-glow cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <Lock className="w-3.5 h-3.5" />
              {isVerifying ? 'جاري التحقق...' : 'تأكيد ومتابعة'}
            </button>
          </div>
        </form>

        <p className="text-[10px] text-luxury-500 mt-3 text-center">
          صلاحية التأكيد 5 دقائق — ولن تُخزَّن كلمة المرور أو رمز PIN إطلاقاً.
        </p>
      </div>
    </div>
  );
};
