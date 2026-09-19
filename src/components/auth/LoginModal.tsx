import React, { useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useAuth } from '../../context/AuthContext';
import { useRestaurant } from '../../context/RestaurantContext';
import {
  X,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  Users,
  AlertTriangle,
  Clock,
  CheckCircle2,
} from 'lucide-react';

// ============================================================
// Login modal — two authentication paths (2026-09 auth redesign):
//
//   Managers / platform staff : email + strong password.
//   Shift staff (WAITER/KITCHEN/CASHIER/STAFF):
//                              restaurant code (public slug — an identifier,
//                              not a secret) + per-tenant username + 6-digit
//                              PIN, resolved entirely server-side.
//
// There is deliberately NO public restaurant dropdown: the employee types
// the venue code once; it is remembered on this device for fast shift login.
// ============================================================

export const LoginModal: React.FC = () => {
  const {
    isLoginModalOpen,
    setIsLoginModalOpen,
    login,
    employeeLogin,
    currentUser,
    logout,
    lockoutRemainingSeconds,
  } = useAuth();
  const { showToast, setViewMode, currentRestaurant } = useRestaurant();

  const WORKER_REST_CODE_KEY = 'merar_worker_restaurant_code';
  const WORKER_USERNAME_KEY = 'merar_worker_username';

  const [authTab, setAuthTab] = useState<'MANAGERS' | 'STAFF_PIN'>('MANAGERS');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Employee path state.
  const [restaurantCodeInput, setRestaurantCodeInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(WORKER_REST_CODE_KEY);
      if (saved) return saved;
    }
    return currentRestaurant?.slug || '';
  });
  const [usernameInput, setUsernameInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(WORKER_USERNAME_KEY) || '';
    }
    return '';
  });
  const [pinInput, setPinInput] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useDialog({ isOpen: isLoginModalOpen, onClose: () => setIsLoginModalOpen(false) });

  if (!isLoginModalOpen) return null;

  const afterSuccessfulLogin = (role: string | undefined) => {
    showToast('success', 'تم تسجيل الدخول بنجاح', 'مرحباً بك في وردية العمل.');
    setIsLoginModalOpen(false);
    const effectiveRole = role || currentUser?.role;
    if (effectiveRole === 'KITCHEN') {
      setViewMode('KITCHEN_KDS');
    } else {
      setViewMode('MANAGER');
    }
  };

  const handleManagerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) return;

    if (!passwordInput) {
      setErrorMsg('يرجى إدخال كلمة المرور للمتابعة');
      return;
    }
    setIsLoading(true);
    setErrorMsg('');
    const res = await login(emailInput.trim(), passwordInput);
    setIsLoading(false);

    if (res.success) {
      afterSuccessfulLogin(res.role);
    } else {
      setErrorMsg(res.error || 'بيانات الدخول غير صحيحة');
    }
  };

  const handleEmployeeLogin = async (pinToVerify: string) => {
    if (!restaurantCodeInput.trim()) {
      setErrorMsg('أدخل رمز المطعم (تجده في رابط قائمة مطعمك: /r/رمز-المطعم)');
      return;
    }
    if (!usernameInput.trim()) {
      setErrorMsg('أدخل اسم المستخدم الخاص بك');
      return;
    }
    if (!/^\d{6}$/.test(pinToVerify)) {
      setErrorMsg('رمز PIN يجب أن يتكون من 6 أرقام بالضبط');
      return;
    }

    // Remember code + username on this (shared) device: identifiers only,
    // never secrets — makes the next shift login a 6-digit tap-away.
    if (typeof window !== 'undefined') {
      localStorage.setItem(WORKER_REST_CODE_KEY, restaurantCodeInput.trim().toLowerCase());
      localStorage.setItem(WORKER_USERNAME_KEY, usernameInput.trim().toLowerCase());
    }

    setIsLoading(true);
    setErrorMsg('');
    const res = await employeeLogin(restaurantCodeInput.trim(), usernameInput.trim(), pinToVerify);
    setIsLoading(false);

    if (res.success) {
      afterSuccessfulLogin(res.role);
    } else {
      setErrorMsg(res.error || 'رمز المطعم أو اسم المستخدم أو رمز PIN غير صحيح');
      setPinInput('');
    }
  };

  const handlePinKeyPress = (num: string) => {
    if (pinInput.length < 6) {
      setPinInput(pinInput + num);
    }
  };

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/85 backdrop-blur-md transition-opacity" onClick={() => setIsLoginModalOpen(false)} />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="تسجيل الدخول"
        className="relative w-full max-w-md bg-luxury-900 border border-luxury-700/80 rounded-3xl shadow-2xl overflow-hidden z-10 my-4 animate-in fade-in zoom-in-95 duration-200 text-right flex flex-col"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-luxury-950 to-luxury-900 border-b border-luxury-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-luxury-400 mt-0.5">بوابة دخول الإدارة والموظفين — Bcrypt & JWT</p>
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
            <span>البريد وكلمة المرور</span>
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
            <span>دخول الموظفين</span>
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
                <span className="text-gold-400 block font-mono text-[10px]">{currentUser.email || currentUser.username}</span>
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
                <label className="block text-xs font-medium text-luxury-300 mb-1.5" htmlFor="loginmodal-f1">
                  البريد الإلكتروني الإداري *
                </label>
                <input id="loginmodal-f1"
                  type="email"
                  required
                  dir="ltr"
                  placeholder="manager@your-restaurant.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 rounded-xl px-3.5 py-2.5 text-xs text-luxury-100 font-mono placeholder-luxury-600 focus:outline-none focus:border-gold-500/60"
                  disabled={lockoutRemainingSeconds > 0 || isLoading}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-luxury-300" htmlFor="loginmodal-f2">
                    كلمة المرور *
                  </label>
                  <span className="text-[10px] text-luxury-500">Bcrypt Protected</span>
                </div>
                <div className="relative">
                  <input id="loginmodal-f2" aria-label="••••••••"
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
                <span>{isLoading ? 'جاري التحقق والمصادقة...' : 'دخول وردية العمل واللوحة'}</span>
              </button>

              <p className="text-[10px] text-luxury-500 text-center">
                حسابات الموظفين (نادل / كاشير / مطبخ) تستخدم تبويب «دخول الموظفين».
              </p>
            </form>
          )}

          {/* TAB 2: EMPLOYEE LOGIN — restaurant code + username + 6-digit PIN */}
          {authTab === 'STAFF_PIN' && (
            <div className="space-y-4 text-center">
              <div className="text-right bg-luxury-950 p-3 rounded-2xl border border-luxury-800 space-y-2">
                <div>
                  <label className="block text-[11px] font-semibold text-luxury-300" htmlFor="loginmodal-rest-code">
                    رمز المطعم *
                  </label>
                  <input
                    id="loginmodal-rest-code"
                    type="text"
                    dir="ltr"
                    placeholder="مثال: mureeh"
                    value={restaurantCodeInput}
                    onChange={(e) => setRestaurantCodeInput(e.target.value)}
                    className="w-full bg-luxury-900 border border-luxury-750 text-luxury-100 rounded-xl px-3 py-2 text-xs font-mono font-bold placeholder-luxury-600 focus:outline-none focus:border-gold-500/60"
                    disabled={lockoutRemainingSeconds > 0 || isLoading}
                    autoComplete="off"
                  />
                  <p className="text-[10px] text-luxury-500 mt-1">
                    تجده في رابط قائمة مطعمك: <span dir="ltr">/r/رمز-المطعم</span> — يُحفظ على هذا الجهاز لدخول أسرع.
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-luxury-300" htmlFor="loginmodal-username">
                    اسم المستخدم *
                  </label>
                  <input
                    id="loginmodal-username"
                    type="text"
                    dir="ltr"
                    placeholder="مثال: ahmad"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    className="w-full bg-luxury-900 border border-luxury-750 text-luxury-100 rounded-xl px-3 py-2 text-xs font-mono font-bold placeholder-luxury-600 focus:outline-none focus:border-gold-500/60"
                    disabled={lockoutRemainingSeconds > 0 || isLoading}
                    autoComplete="off"
                  />
                  <p className="text-[10px] text-luxury-500 mt-1">
                    اسم المستخدم يعيّنه لك مدير المطعم — يُحفظ على هذا الجهاز.
                  </p>
                </div>
              </div>

              <div>
                <span className="text-xs text-luxury-300 font-medium">أدخل رمز PIN (6 أرقام) ثم اضغط تأكيد</span>
                <div className="flex justify-center gap-2.5 my-3" dir="ltr">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div
                      key={i}
                      className={`w-9 h-12 rounded-xl border flex items-center justify-center font-mono text-lg font-bold transition-all ${
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
                  onClick={() => handleEmployeeLogin(pinInput)}
                  disabled={pinInput.length !== 6 || lockoutRemainingSeconds > 0 || isLoading}
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
            <span>حماية مزدوجة من التخمين (لكل جهاز ولكل حساب)</span>
          </span>
          <span className="font-mono text-gold-400">v3.0 SaaS</span>
        </div>
      </div>
    </div>
  );
};
