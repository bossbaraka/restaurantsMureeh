import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import type { Restaurant } from '../../types/restaurant';
import { useDialog } from '../../hooks/useDialog';
import {
  Store,
  Building2,
  QrCode,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  LogOut,
  Copy,
  UtensilsCrossed,
} from 'lucide-react';

/**
 * Owner-facing self-service setup (2026-10) — the tenantless-manager flow.
 *
 * Rendered by the App-level gate whenever a signed-in RESTAURANT_MANAGER has
 * no restaurant yet (freshly registered OR returning to finish later — same
 * surface, identity comes from /auth/me). It replaces the platform shell for
 * that state: ManagerLayout is never shown to a tenantless owner.
 *
 * Deliberately the MINIMAL twin of the admin wizard:
 *   * collects only the restaurant NAME and one closed table count (10/15/20);
 *   * the server owns slug, plan binding, subscription, logo and membership;
 *   * no logo/upload step (the platform default-logo fallback renders until
 *     the owner uploads their own in the branding settings later);
 *   * success is shown ONLY after the API returns 201, and the success screen
 *     reports the server-confirmed table count, not the selection.
 *
 * Duplicate clicks are guarded client-side (isSubmitting) but the real
 * protection is the server-side transactional membership claim.
 */

type TablesChoice = 10 | 15 | 20;
const TABLE_CHOICES: ReadonlyArray<{ value: TablesChoice; label: string; hint: string }> = [
  { value: 10, label: '10 طاولات', hint: 'مساحة صغيرة / كافيه' },
  { value: 15, label: '15 طاولة', hint: 'مطعم متوسط' },
  { value: 20, label: '20 طاولة', hint: 'الحد الأقصى في الخطة المجانية' },
];

interface CreatedResult {
  restaurant: Restaurant;
  tablesCount: number;
  planName: string;
}

export const OwnerSelfOnboarding: React.FC = () => {
  const { showToast, setCurrentRestaurant, setViewMode } = useRestaurant();
  const { currentUser, setCurrentUser, setCurrentManagerRestaurant, logout } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState('');
  const [tablesCount, setTablesCount] = useState<TablesChoice>(20);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [created, setCreated] = useState<CreatedResult | null>(null);

  // Non-dismissible by design (the wizard IS the state of the account), with
  // an explicit "finish later" logout escape so the flow is always resumable.
  useDialog({ isOpen: true, onClose: () => undefined, closeOnEscape: false });

  const publicLink = created
    ? `${window.location.origin}/r/${created.restaurant.slug}`
    : '';

  const handleCreate = async () => {
    if (isSubmitting) return;
    if (!name.trim()) {
      setErrorMsg('أدخل اسم المطعم للمتابعة');
      return;
    }
    if (!(TABLE_CHOICES.some((c) => c.value === tablesCount))) {
      // Defensive: the radios can only produce the closed set.
      setErrorMsg('عدد الطاولات غير مسموح به');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg('');
    const res = await api.selfOnboardRestaurant({ name: name.trim(), tablesCount });
    if (!res.success || !res.data?.restaurant) {
      setErrorMsg(res.error || 'تعذر إنشاء المطعم. يرجى المحاولة مرة أخرى.');
      setIsSubmitting(false);
      return;
    }
    // Server-confirmed success only from here on.
    setCreated({
      restaurant: res.data.restaurant,
      tablesCount: res.data.tablesCount,
      planName: res.data.planName,
    });
    setStep(4);
    setIsSubmitting(false);
  };

  const finishToDashboard = async () => {
    if (!created) return;
    // Persist the tenant for the shell immediately (works even if /auth/me
    // is slow), then re-sync the authoritative identity so the App-level gate
    // lifts: currentUser.restaurantId becomes non-null server-side.
    setCurrentRestaurant(created.restaurant);
    setCurrentManagerRestaurant(created.restaurant);
    const me = await api.getCurrentUser();
    if (me.success && me.data?.user) {
      setCurrentUser(me.data.user);
      if (me.data.restaurant) setCurrentManagerRestaurant(me.data.restaurant);
    } else {
      // Offline edge: fall back to the 201 payload for the local state only.
      setCurrentUser({ ...(currentUser as any), restaurantId: created.restaurant.id });
    }
    // No success toast here on purpose: this very click unmounts the wizard
    // gate, so a toast raised from here would die with it — the dashboard
    // lands the owner straight on their own tenant, which is the signal.
    setViewMode('MANAGER');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      showToast('info', 'تم نسخ رابط المطعم', publicLink);
    } catch {
      showToast('info', 'رابط مطعمك', publicLink);
    }
  };

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-3 sm:p-4">
      <div className="fixed inset-0 bg-luxury-950" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-self-onboarding-title"
        className="relative w-full max-w-lg bg-luxury-900 border border-gold-500/40 rounded-2xl shadow-luxury overflow-hidden z-10 my-6 animate-in fade-in zoom-in-95 duration-200 text-right flex flex-col max-h-[92vh]"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 bg-luxury-850/90 border-b border-luxury-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-400 shrink-0">
              <Store className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="owner-self-onboarding-title" className="text-base font-bold text-luxury-50 font-serif truncate">
                تهيئة مطعمك — خطوة بخطوة
              </h2>
              <p className="text-xs text-luxury-400">
                {created ? 'اكتمل الإنشاء — مطعمك جاهز' : `الخطوة ${step} من 3`}
                {' — '}
                {currentUser?.name ? `أهلاً ${currentUser.name}` : 'أهلاً بك'}
              </p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="px-2.5 py-1.5 rounded-lg bg-luxury-850 hover:bg-luxury-800 text-luxury-300 text-[11px] font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
            title="يمكنك إكمال الإعداد لاحقاً بعد تسجيل الدخول بهذا الحساب"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>إنهاء لاحقاً</span>
          </button>
        </div>

        {/* Progress dots */}
        <div className="grid grid-cols-4 gap-1 p-2 bg-luxury-950 border-b border-luxury-800 text-[11px] text-center font-medium">
          {[
            { s: 1, title: '1. اسم المطعم' },
            { s: 2, title: '2. عدد الطاولات' },
            { s: 3, title: '3. التأكيد' },
            { s: 4, title: '4. مطعمك جاهز' },
          ].map((item) => (
            <div
              key={item.s}
              className={`py-1.5 rounded-lg transition-colors ${
                step === item.s
                  ? 'bg-gold-500 text-luxury-950 font-bold'
                  : step > item.s
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-luxury-500'
              }`}
            >
              {item.title}
            </div>
          ))}
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {step === 1 && (
            <div className="space-y-3.5 animate-in fade-in">
              <div>
                <label className="block font-bold text-luxury-200 mb-1.5 text-sm" htmlFor="owner-onboard-f1">
                  اسم المطعم *
                </label>
                <input
                  id="owner-onboard-f1"
                  type="text"
                  required
                  autoFocus
                  placeholder="مثال: مطعم الياسمين"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-3 rounded-xl focus:border-gold-500/60 text-sm"
                />
              </div>
              <p className="text-xs text-luxury-400 leading-relaxed">
                سننشئ تلقائياً الرابط العام لمطعمك (‏<span dir="ltr">/r/…</span>‏) — يمكنك تعديل الاسم
                لاحقاً من «الإعدادات» في أي وقت، وإضافة الشعار والوصف أيضاً.
              </p>
            </div>
          )}

          {step === 2 && (
            <fieldset className="space-y-3 animate-in fade-in">
              <legend className="font-bold text-luxury-200 text-sm mb-2">كم طاولة في مطعمك؟</legend>
              <div
                role="radiogroup"
                aria-label="عدد الطاولات الأولي"
                className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
              >
                {TABLE_CHOICES.map((choice) => (
                  <label
                    key={choice.value}
                    htmlFor={`owner-onboard-tables-${choice.value}`}
                    className={`block cursor-pointer rounded-xl border p-3 text-center transition-all ${
                      tablesCount === choice.value
                        ? 'bg-gold-500/10 border-gold-500 text-gold-300'
                        : 'bg-luxury-950 border-luxury-800 text-luxury-300 hover:border-luxury-700'
                    }`}
                  >
                    <input
                      id={`owner-onboard-tables-${choice.value}`}
                      type="radio"
                      name="owner-onboard-tables"
                      value={choice.value}
                      checked={tablesCount === choice.value}
                      onChange={() => setTablesCount(choice.value)}
                      className="sr-only"
                    />
                    <span className="flex items-center justify-center gap-1.5 text-sm font-black">
                      <Building2 className="w-4 h-4" />
                      {choice.label}
                    </span>
                    <span className="block text-[11px] mt-1 opacity-80">{choice.hint}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-luxury-400 flex items-start gap-2 leading-relaxed">
                <QrCode className="w-4 h-4 text-gold-400 shrink-0 mt-0.5" />
                <span>
                  سُنشئ الطاولات فوراً بأرقامها (من طاولة 01 حتى طاولة {String(tablesCount).padStart(2, '0')})
                  مع رمز QR مستقل لكل طاولة — يمكنك تعديلها وإضافة المزيد لاحقاً.
                </span>
              </p>
            </fieldset>
          )}

          {step === 3 && !created && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-4 rounded-xl bg-luxury-950 border border-luxury-800 space-y-2.5 text-sm">
                <h3 className="text-sm font-bold text-gold-300 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4" />
                  <span>مراجعة سريعة قبل الإنشاء</span>
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div>
                    <span className="text-luxury-400">اسم المطعم:</span>
                    <strong className="block text-luxury-100">{name.trim()}</strong>
                  </div>
                  <div>
                    <span className="text-luxury-400">عدد الطاولات:</span>
                    <strong className="block text-luxury-100">{tablesCount} طاولة مع QR</strong>
                  </div>
                  <div>
                    <span className="text-luxury-400">الخطة:</span>
                    <strong className="block text-emerald-300">الخطة المجانية الدائمة</strong>
                  </div>
                  <div>
                    <span className="text-luxury-400">الشعار:</span>
                    <strong className="block text-luxury-300">افتراضي الآن — ارفعه لاحقاً من الإعدادات</strong>
                  </div>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs leading-relaxed">
                لن ننشئ أي أطباق أو تصنيفات تجريبية — القائمة تبدأ فارغة وأنتم تملأونها.
                بعد التأكيد مباشرة تنتقلون إلى لوحة المطعم لإضافة تصنيفاتكم وأطباقكم.
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs"
                >
                  {errorMsg}
                </div>
              )}
            </div>
          )}

          {step === 4 && created && (
            <div className="space-y-4 animate-in fade-in text-center">
              <div className="flex flex-col items-center gap-2.5 pt-1">
                <span className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gold-500/25 to-luxury-950 border border-gold-500/40 flex items-center justify-center overflow-hidden text-gold-300 text-xl font-black font-serif">
                  {created.restaurant.logo ? (
                    <img src={created.restaurant.logo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    // Platform default-logo fallback (same rule as the manager
                    // sidebar): the venue initial until an upload exists.
                    (created.restaurant.nameEn || created.restaurant.name).charAt(0) || 'M'
                  )}
                </span>
                <h3 className="text-lg font-black text-luxury-50 font-serif">{created.restaurant.name}</h3>
                <p className="text-xs text-luxury-400">
                  {created.tablesCount} طاولات جاهزة برموز QR مستقلة · {created.planName}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-luxury-950 border border-luxury-800 flex items-center justify-between gap-2 text-xs">
                <span className="text-gold-400 font-mono truncate" dir="ltr" title={publicLink}>
                  {publicLink}
                </span>
                <button
                  type="button"
                  onClick={copyLink}
                  className="p-2 rounded-lg bg-luxury-900 hover:bg-luxury-850 border border-luxury-800 text-luxury-200 shrink-0 cursor-pointer"
                  aria-label="نسخ رابط القائمة العامة"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs leading-relaxed flex items-start gap-2 text-right">
                <UtensilsCrossed className="w-4 h-4 shrink-0 mt-0.5" />
                <span>الخطوة التالية: أضف تصنيفاتك وأطباقك من «إدارة المنيو» — زبائنكم يستطيعون الطلب فوراً.</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="p-4 bg-luxury-950 border-t border-luxury-800 flex items-center justify-between gap-2">
          {step > 1 && step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
              className="px-4 py-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-luxury-300 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>السابق</span>
            </button>
          ) : (
            <div />
          )}

          {step < 3 && (
            <button
              type="button"
              onClick={() => {
                if (step === 1 && !name.trim()) {
                  setErrorMsg('أدخل اسم المطعم للمتابعة');
                  return;
                }
                setErrorMsg('');
                setStep((s) => (s + 1) as 2 | 3);
              }}
              className="px-6 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1 shadow-gold-glow cursor-pointer"
            >
              <span>التالي</span>
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          {step === 3 && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-lg disabled:opacity-60 cursor-pointer"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              <span>{isSubmitting ? 'جاري إنشاء المطعم والطاولات...' : 'إنشاء مطعمي الآن 🚀'}</span>
            </button>
          )}

          {step === 4 && (
            <button
              type="button"
              onClick={finishToDashboard}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-gold-glow cursor-pointer"
            >
              <span>أضف تصنيفاتك وأطباقك الآن</span>
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
