import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRestaurant } from '../../context/RestaurantContext';
import {
  X,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  Key,
  Users,
  AlertTriangle,
  Clock,
  CheckCircle2,
} from 'lucide-react';

export const LoginModal: React.FC = () => {
  const {
    isLoginModalOpen,
    setIsLoginModalOpen,
    login,
    loginWithPin,
    currentUser,
    logout,
    failedAttempts,
    lockoutRemainingSeconds,
  } = useAuth();
  const { showToast, setViewMode } = useRestaurant();

  const [authTab, setAuthTab] = useState<'MANAGERS' | 'STAFF_PIN'>('MANAGERS');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isLoginModalOpen) return null;

  const handleManagerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) return;

    setIsLoading(true);
    setErrorMsg('');
    const res = await login(emailInput.trim(), passwordInput || 'Merar@123456');
    setIsLoading(false);

    if (res.success) {
      const isDemoAccount = emailInput.trim().toLowerCase() === 'demo.manager@merar-promo.com';
      showToast(
        isDemoAccount ? 'warning' : 'success',
        isDemoAccount ? 'تم تسجيل الدخول إلى الحساب التجريبي' : 'تم تسجيل الدخول بنجاح',
        isDemoAccount ? 'هذا الحساب للعرض فقط ولا يملك صلاحية إجراء تغييرات حقيقية.' : 'مرحباً بك في لوحة تحكم المنظومة.'
      );
      setIsLoginModalOpen(false);
      setViewMode('MANAGER');
    } else {
      setErrorMsg(res.error || 'بيانات الدخول غير صحيحة');
    }
  };

  const handlePinSubmit = async (pinToVerify: string) => {
    if (pinToVerify.length < 4) {
      setErrorMsg('رمز PIN يجب أن يتكون من 4 أرقام على الأقل');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    const res = await loginWithPin(pinToVerify);
    setIsLoading(false);

    if (res.success) {
      showToast('success', 'تم الدخول بنجاح', 'مرحباً بك في وردية العمل.');
      setIsLoginModalOpen(false);

      const staffRole = currentUser?.role || 'WAITER';
      if (pinToVerify === '9900') {
        setViewMode('KITCHEN_KDS');
      } else if (pinToVerify === '4455' || pinToVerify === '7788') {
        setViewMode('CUSTOMER');
      } else {
        setViewMode('MANAGER');
      }
    } else {
      setErrorMsg(res.error || 'رمز PIN غير صالح');
      setPinInput('');
    }
  };

  const handlePinKeyPress = (num: string) => {
    if (pinInput.length < 6) {
      const nextPin = pinInput + num;
      setPinInput(nextPin);
      if (nextPin.length === 4) {
        handlePinSubmit(nextPin);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/85 backdrop-blur-md transition-opacity" onClick={() => setIsLoginModalOpen(false)} />

      {/* Dialog */}
      <div
        className="relative w-full max-w-md bg-luxury-900 border border-luxury-700/80 rounded-3xl shadow-2xl overflow-hidden z-10 my-4 animate-in fade-in zoom-in-95 duration-200 text-right flex flex-col"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-luxury-950 to-luxury-900 border-b border-luxury-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-gold-500 to-gold-600 text-luxury-950 flex items-center justify-center font-bold shadow-gold-glow">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-luxury-50 font-serif">بوابة دخول الإدارة والعمال</h3>
              <p className="text-xs text-luxury-400">حسابات مشفرة ومحمية بنظام Bcrypt & JWT</p>
            </div>
          </div>

          <button
            onClick={() => setIsLoginModalOpen(false)}
            className="p-2 rounded-xl bg-luxury-800/80 hover:bg-luxury-750 text-luxury-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Security Lockout Banner */}
        {lockoutRemainingSeconds > 0 && (
          <div className="bg-red-500/15 border-b border-red-500/30 p-3.5 flex items-center gap-3 text-red-300 text-xs">
            <Clock className="w-5 h-5 text-red-400 animate-spin shrink-0" />
            <div>
              <span className="font-bold block">النظام مقفل مؤقتاً لأسباب أمنية</span>
              <span>يرجى الانتظار {lockoutRemainingSeconds} ثانية قبل إعادة المحاولة.</span>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-luxury-800 bg-luxury-950/60 p-1.5 gap-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setAuthTab('MANAGERS');
              setErrorMsg('');
            }}
            className={`flex-1 py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              authTab === 'MANAGERS'
                ? 'bg-gold-500 text-luxury-950 shadow-gold-glow'
                : 'text-luxury-400 hover:text-luxury-200 hover:bg-luxury-850'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>مدير / مشرف</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAuthTab('STAFF_PIN');
              setErrorMsg('');
            }}
            className={`flex-1 py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              authTab === 'STAFF_PIN'
                ? 'bg-gold-500 text-luxury-950 shadow-gold-glow'
                : 'text-luxury-400 hover:text-luxury-200 hover:bg-luxury-850'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>العمال (PIN)</span>
          </button>

        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {/* Current Logged in User Bar */}
          {currentUser && (
            <div className="p-3.5 rounded-2xl bg-luxury-950 border border-luxury-800 flex items-center justify-between text-xs">
              <div>
                <span className="text-luxury-400 block text-[11px]">أنت مسجل حالياً:</span>
                <span className="text-luxury-100 font-bold">{currentUser.name}</span>
                <span className="text-gold-400 block font-mono text-[10px]">{currentUser.email}</span>
              </div>
              <button
                onClick={() => {
                  logout();
                  showToast('info', 'تم تسجيل الخروج');
                }}
                className="px-3 py-1.5 rounded-xl bg-luxury-850 hover:bg-red-500/20 text-red-400 text-xs font-semibold cursor-pointer transition-colors"
              >
                خروج
              </button>
            </div>
          )}

          {/* TAB 1: MANAGER EMAIL & PASSWORD */}
          {authTab === 'MANAGERS' && (
            <form onSubmit={handleManagerLogin} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-luxury-300 mb-1.5">
                  البريد الإلكتروني الإداري *
                </label>
                <input
                  type="email"
                  required
                  placeholder="manager@merar-dining.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-3.5 py-2.5 text-xs text-luxury-100 font-mono placeholder-luxury-600 focus:outline-none focus:border-gold-500/60"
                  disabled={lockoutRemainingSeconds > 0 || isLoading}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-luxury-300">
                    كلمة المرور المشفرة *
                  </label>
                  <span className="text-[10px] text-luxury-500">Bcrypt Protected</span>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full bg-luxury-950 border border-luxury-800 rounded-xl pr-3.5 pl-10 py-2.5 text-xs text-luxury-100 font-mono placeholder-luxury-600 focus:outline-none focus:border-gold-500/60"
                    disabled={lockoutRemainingSeconds > 0 || isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 hover:text-luxury-200 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={lockoutRemainingSeconds > 0 || isLoading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-400 hover:to-gold-500 text-luxury-950 font-bold text-xs shadow-gold-glow transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Lock className="w-4 h-4" />
                <span>{isLoading ? 'جاري التحقق والمصادقة...' : 'دخول لوحة التحكم'}</span>
              </button>
            </form>
          )}

          {/* TAB 2: STAFF NUMERIC PIN PAD */}
          {authTab === 'STAFF_PIN' && (
            <div className="space-y-4 text-center">
              <div>
                <span className="text-xs text-luxury-300 font-medium">أدخل رمز PIN المكون من 4 أرقام للوردية</span>
                <div className="flex justify-center gap-3 my-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`w-10 h-12 rounded-xl border flex items-center justify-center font-mono text-lg font-bold transition-all ${
                        pinInput[i]
                          ? 'border-gold-500 bg-gold-500/20 text-gold-300 shadow-gold-glow scale-105'
                          : 'border-luxury-800 bg-luxury-950 text-luxury-600'
                      }`}
                    >
                      {pinInput[i] ? '●' : '—'}
                    </div>
                  ))}
                </div>
              </div>

              {/* Numeric Keypad Grid */}
              <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => handlePinKeyPress(n)}
                    disabled={lockoutRemainingSeconds > 0 || isLoading}
                    className="h-11 rounded-xl bg-luxury-950 hover:bg-luxury-850 active:bg-gold-500/20 border border-luxury-800 text-luxury-100 font-mono text-base font-bold transition-all cursor-pointer"
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPinInput('')}
                  className="h-11 rounded-xl bg-luxury-950 hover:bg-red-500/20 border border-luxury-800 text-red-400 font-bold text-xs transition-all cursor-pointer flex items-center justify-center"
                >
                  مسح
                </button>
                <button
                  type="button"
                  onClick={() => handlePinKeyPress('0')}
                  disabled={lockoutRemainingSeconds > 0 || isLoading}
                  className="h-11 rounded-xl bg-luxury-950 hover:bg-luxury-850 active:bg-gold-500/20 border border-luxury-800 text-luxury-100 font-mono text-base font-bold transition-all cursor-pointer"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => handlePinSubmit(pinInput)}
                  disabled={pinInput.length < 4 || lockoutRemainingSeconds > 0 || isLoading}
                  className="h-11 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs transition-all cursor-pointer flex items-center justify-center disabled:opacity-40"
                >
                  تأكيد
                </button>
              </div>

              {errorMsg && (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  {errorMsg}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 bg-luxury-950 border-t border-luxury-800 text-[11px] text-luxury-400 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>حماية من التخمين المتكرر (Anti-Brute Force)</span>
          </span>
          <span className="font-mono text-gold-400">v2.0 SaaS</span>
        </div>
      </div>
    </div>
  );
};
