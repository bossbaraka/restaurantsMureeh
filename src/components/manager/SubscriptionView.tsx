import React, { useState, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { BrandLogo } from '../brand/BrandLogo';
import { Subscription, Plan } from '../../types/restaurant';
import { formatPrice, formatTime } from '../../utils/formatting';
import {
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Zap,
  ArrowUpRight,
  Clock,
  Layers,
  Crown,
} from 'lucide-react';

const PLAN_DETAIL_LINES: Record<string, string[]> = {
  'plan-starter': [
    'منيو رقمي فاخر وطلبات QR مباشرة من الطاولة',
    'استدعاء النادل وإدارة طلبات الخدمة',
    'نظام كاشير أساسي وتصفية الفواتير',
  ],
  'plan-pro': [
    'شاشة المطبخ الحية (KDS) بإشعارات صوتية فورية',
    'نقطة بيع POS متطورة وتصنيفات الصالات',
    'تحليلات مبيعات تفاعلية وتخصيص الهوية',
  ],
  'plan-enterprise': [
    'سعة مفتوحة للفروع والأصناف والطلبات',
    'إدارة الفروع المتعددة (Multi-Branch System)',
    'ربط نطاق خاص لموقعك ودعم 24/7',
  ],
};

export const SubscriptionView: React.FC = () => {
  const { currentRestaurant, tables, products, categories, refreshTenantData, showToast } = useRestaurant();
  const { currentUser } = useAuth();
  const isDemo = currentUser?.email.toLowerCase().includes('demo');

  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [allPlans, setAllPlans] = useState<Plan[]>([]);

  const loadSubscription = () => {
    if (!currentRestaurant) return;
    api.getManagerSubscription(currentRestaurant.id).then((res) => {
      if (res.success && res.data) {
        setSubscription(res.data.subscription);
        setAllPlans(res.data.plans);
      }
    });
  };

  useEffect(() => {
    loadSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRestaurant?.id]);

  if (!currentRestaurant) return null;

  const currentPlan = subscription ? allPlans.find((p) => p.id === subscription?.planId) || null : null;

  const handleSelectPlan = async (planId: string) => {
    if (!currentRestaurant || isChanging) return;
    if (isDemo) {
      showToast('error', '🔒 تنبيه النسخة التجريبية', 'لا يمكن تغيير الاشتراك في النسخة التجريبية. هذا الحساب مخصص فقط لاستعراض ميزات منصة مريح.');
      return;
    }
    setIsChanging(true);
    const res = await api.changeSubscriptionPlan(currentRestaurant.id, planId);
    setIsChanging(false);
    if (!res.success || !res.data) {
      showToast('error', 'تعذر تغيير الباقة', res.error || 'يرجى المحاولة لاحقاً');
      return;
    }
    setSubscription(res.data.subscription);
    refreshTenantData();
    setIsUpgradeModalOpen(false);
    const nextPlan = allPlans.find((p) => p.id === planId);
    showToast('success', 'تمت ترقية باقة الاشتراك بنجاح!', `أنت الآن على ${nextPlan?.name || 'الباقة الجديدة'}`);
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'ACTIVE':
        return { label: 'اشتراك نشط', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
      case 'TRIAL':
        return { label: 'فترة تجريبية مجانية', color: 'bg-gold-500/10 text-gold-400 border-gold-500/30' };
      case 'PAST_DUE':
        return { label: 'متأخر السداد', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
      default:
        return { label: 'موقوف', color: 'bg-red-500/10 text-red-400 border-red-500/30' };
    }
  };

  const statusCfg = getStatusBadge(subscription?.status);

  return (
    <div className="space-y-6 text-right max-w-4xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-5 rounded-2xl">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandLogo size={38} subtitle="MUREEH Billing" />
          </div>
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2 mt-2">
            <CreditCard className="w-5 h-5 text-gold-400" />
            <span>باقة الاشتراك السحابية والترقية</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            إدارة خطة الاشتراك، حدود استهلاك الطاولات، والميزات المفعلة لحسابك — تُفعَّل التغييرات فوراً على حسابك الحقيقي
          </p>
        </div>

        <button
          onClick={() => setIsUpgradeModalOpen(true)}
          className="px-5 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-gold-glow"
        >
          <Crown className="w-4 h-4" />
          <span>ترقية أو تغيير الباقة</span>
        </button>
      </div>

      {/* Current Plan Overview Card */}
      <div className="bg-luxury-900 border border-gold-500/30 rounded-2xl p-6 shadow-luxury space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${statusCfg.color} mb-2`}>
              {statusCfg.label}
            </span>
            <h3 className="text-xl font-bold text-luxury-50 font-serif">
              {currentPlan?.name || 'باقة غير محددة'}
            </h3>
            <p className="text-xs text-luxury-400 mt-1">{currentPlan?.description}</p>
          </div>

          <div className="text-left space-y-1.5">
            <div>
              <span className="text-2xl font-bold text-gold-400 font-mono">
                {currentPlan ? formatPrice(currentPlan.priceMonthly) : '—'}
              </span>
              <span className="text-xs text-luxury-400"> / شهرياً</span>
            </div>
            {subscription?.currentPeriodEnd && (
              <p className="text-[10px] text-luxury-400 flex items-center gap-1 justify-end" dir="rtl">
                <Clock className="w-3 h-3 text-gold-400/70" />
                <span>
                  تجديد تلقائي في{' '}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </p>
            )}
            {currentPlan && (
              <p className="text-[10px] text-luxury-500">
                أو {formatPrice(currentPlan.priceYearly)} سنوياً — وفّر {formatPrice(currentPlan.priceMonthly * 12 - currentPlan.priceYearly)}
              </p>
            )}
          </div>
        </div>

        {/* Usage Resource Bars */}
        <div className="pt-4 border-t border-luxury-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-3.5 rounded-xl bg-luxury-950 border border-luxury-850">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-luxury-400">الطاولات المفعلة</span>
              <span className="font-bold text-luxury-100">{tables.length} / {currentPlan?.maxTables === 999 ? '∞' : currentPlan?.maxTables}</span>
            </div>
            <div className="w-full bg-luxury-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gold-500 h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, (tables.length / (currentPlan?.maxTables || 50)) * 100)}%` }}
              />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-luxury-950 border border-luxury-850">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-luxury-400">أقسام القائمة</span>
              <span className="font-bold text-luxury-100">{categories.length} / {currentPlan?.maxCategories === 999 ? '∞' : currentPlan?.maxCategories}</span>
            </div>
            <div className="w-full bg-luxury-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gold-500 h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, (categories.length / (currentPlan?.maxCategories || 20)) * 100)}%` }}
              />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-luxury-950 border border-luxury-850">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-luxury-400">الأطباق المتاحة</span>
              <span className="font-bold text-luxury-100">{products.length} / {currentPlan?.maxProducts === 999 ? '∞' : currentPlan?.maxProducts}</span>
            </div>
            <div className="w-full bg-luxury-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gold-500 h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, (products.length / (currentPlan?.maxProducts || 150)) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Entitlements Checklist */}
        <div className="pt-4 border-t border-luxury-800">
          <h4 className="text-xs font-bold text-luxury-200 mb-3 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-gold-400" />
            <span>الميزات والصلاحيات المضمنة في باقتك (Entitlements)</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            {[
              { key: 'CAN_USE_ANALYTICS', label: 'التحليلات ومؤشرات المبيعات (Analytics & AOV)' },
              { key: 'CAN_CUSTOM_BRANDING', label: 'تخصيص الهوية البصرية وشعار المطعم (Custom Branding)' },
              { key: 'CAN_EXPORT_REPORTS', label: 'تصدير تقارير المبيعات بصيغة CSV' },
              { key: 'CAN_CREATE_BRANCH', label: 'إدارة فروع وسلاسل المطاعم المتعددة' },
              { key: 'CAN_UNLIMITED_TABLES', label: 'عدد طاولات ورموز QR غير محدود' },
              { key: 'CAN_PRIORITY_SUPPORT', label: 'دعم فني وكونسيرج مباشر 24/7' },
            ].map((item) => {
              const isIncluded = currentPlan?.entitlements.includes(item.key as any);
              return (
                <div
                  key={item.key}
                  className={`p-2.5 rounded-xl border flex items-center gap-2.5 ${
                    isIncluded
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                      : 'bg-luxury-950/40 border-luxury-850 text-luxury-500 opacity-60'
                  }`}
                >
                  <CheckCircle2 className={`w-4 h-4 shrink-0 ${isIncluded ? 'text-emerald-400' : 'text-luxury-600'}`} />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Upgrade Modal */}
      {isUpgradeModalOpen && (
        <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md" onClick={() => setIsUpgradeModalOpen(false)} />

          <div className="relative w-full max-w-3xl bg-luxury-900 border border-gold-500/40 rounded-2xl p-6 z-10 space-y-5" dir="rtl">
            <div className="flex items-center justify-between border-b border-luxury-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-luxury-50 font-serif">اختر باقة الترقية المناسبة لمطعمك</h3>
                <p className="text-xs text-luxury-400">تفعيل فوري لكافة الميزات دون توقف الخدمة</p>
              </div>
              <button onClick={() => setIsUpgradeModalOpen(false)} className="text-luxury-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {allPlans.map((p) => {
                const isCurrent = currentPlan?.id === p.id;
                return (
                  <div
                    key={p.id}
                    className={`relative p-5 rounded-2xl border flex flex-col justify-between text-xs overflow-hidden ${
                      isCurrent
                        ? 'border-emerald-500/60 ring-2 ring-emerald-500/25 shadow-emerald-glow'
                        : p.isPopular
                          ? 'border-gold-500/60 shadow-gold-glow bg-gradient-to-b from-luxury-850 to-luxury-950'
                          : 'bg-luxury-950 border-luxury-800'
                    }`}
                  >
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-l from-transparent via-gold-500/70 to-transparent" />

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        {p.isPopular && !isCurrent ? (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-gold-500 text-luxury-950 flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" /> الأكثر طلباً
                          </span>
                        ) : isCurrent ? (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-500 text-white flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" /> باقتك الحالية
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-luxury-850 text-luxury-400 border border-luxury-700">
                            باقة متاحة
                          </span>
                        )}
                        {!isCurrent && (
                          <Layers className="w-3.5 h-3.5 text-luxury-500" />
                        )}
                      </div>

                      <h4 className="text-base font-bold text-luxury-50 font-serif flex items-center gap-1.5">
                        {p.isPopular && <Crown className="w-4 h-4 text-gold-400" />}
                        {p.name}
                      </h4>
                      <p className="text-[11px] text-luxury-400 mt-1 leading-relaxed min-h-[2em]">{p.description}</p>

                      <div className="my-3 rounded-xl bg-luxury-950/70 border border-luxury-800 p-3 space-y-1">
                        <div>
                          <span className="text-2xl font-extrabold text-gold-400 font-mono">{formatPrice(p.priceMonthly)}</span>
                          <span className="text-[10px] text-luxury-400"> / شهرياً</span>
                        </div>
                        <div className="text-[10px] text-luxury-400">
                          أو <span className="font-bold text-luxury-200 font-mono">{formatPrice(p.priceYearly)}</span> سنوياً
                          <span className="text-emerald-400 font-bold"> — وفّر {formatPrice(p.priceMonthly * 12 - p.priceYearly)}</span>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-[11px] text-luxury-300 pt-2 border-t border-luxury-800">
                        <div className="flex items-center gap-1.5">
                          <Zap className="w-3 h-3 text-gold-400/80" />
                          {p.maxTables === 999 ? 'طاولات ورموز QR غير محدودة' : `حتى ${p.maxTables} طاولة برموز QR`}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Zap className="w-3 h-3 text-gold-400/80" />
                          {p.maxProducts === 999 ? 'أطباق وأقسام غير محدودة' : `حتى ${p.maxProducts} طبقاً و ${p.maxCategories} قسماً`}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Zap className="w-3 h-3 text-gold-400/80" />
                          {p.entitlements.includes('CAN_CUSTOM_BRANDING' as any) ? 'شعار وألوان وهوية مخصصة' : 'تخصيص أساسي ضمن هوية المنصة'}
                        </div>
                      </div>

                      {/* مزايا الباقة بالتفصيل */}
                      <details className="mt-3 rounded-xl border border-luxury-750 bg-luxury-950/80 group">
                        <summary className="px-3 py-2 text-[10.5px] font-bold text-luxury-200 cursor-pointer list-none select-none flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3 text-[#A78BFA]" />
                            مزايا الباقة بالتفصيل
                          </span>
                          <span className="text-luxury-500 text-[10px] group-open:rotate-180 transition-transform">▾</span>
                        </summary>
                        <ul className="px-3 pb-3 pt-1 space-y-1.5">
                          {(PLAN_DETAIL_LINES[p.id] || []).map((line) => (
                            <li key={line} className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-luxury-300">
                              <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" />
                              {line}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>

                    <button
                      onClick={() => handleSelectPlan(p.id)}
                      disabled={isCurrent || isChanging}
                      className={`mt-4 w-full py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                        isCurrent || isChanging
                          ? 'bg-luxury-800 text-luxury-400 cursor-default'
                          : p.isPopular
                            ? 'bg-gradient-to-l from-[#7E14FF] to-[#47BFFF] hover:brightness-110 text-white shadow-[0_0_22px_rgba(126,20,255,0.4)]'
                            : 'bg-luxury-850 hover:bg-luxury-800 text-luxury-100 border border-luxury-700'
                      }`}
                    >
                      {isChanging && !isCurrent ? 'جاري التفعيل...' : isCurrent ? 'باقتك الحالية' : (
                        <>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          تفعيل هذه الباقة
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
