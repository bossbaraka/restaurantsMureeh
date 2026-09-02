import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { db } from '../../services/db';
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

export const SubscriptionView: React.FC = () => {
  const { currentRestaurant, tables, products, categories, refreshTenantData, showToast } = useRestaurant();

  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  if (!currentRestaurant) return null;

  const subscription = db.getSubscriptionByRestaurantId(currentRestaurant.id);
  const currentPlan = subscription ? db.getPlanById(subscription.planId) : null;
  const allPlans = db.getPlans();

  const handleSelectPlan = (planId: string) => {
    if (!subscription) return;
    const updatedSub = {
      ...subscription,
      planId,
      status: 'ACTIVE' as const,
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    };
    db.saveSubscription(updatedSub);

    // Also update restaurant planId
    const updatedRest = { ...currentRestaurant, planId };
    db.saveRestaurant(updatedRest);

    refreshTenantData();
    setIsUpgradeModalOpen(false);
    showToast('success', 'تمت ترقية باقة الاشتراك بنجاح!', `أنت الآن على ${currentPlan?.name || 'الباقة الجديدة'}`);
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
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-gold-400" />
            <span>باقة الاشتراك السحابية والترقية</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            إدارة خطة الاشتراك، حدود استهلاك الطاولات، والميزات المفعلة لحسابك
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

          <div className="text-left">
            <span className="text-2xl font-bold text-gold-400 font-mono">
              {currentPlan ? formatPrice(currentPlan.priceMonthly) : '—'}
            </span>
            <span className="text-xs text-luxury-400"> / شهرياً</span>
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
                    className={`p-5 rounded-2xl border flex flex-col justify-between text-xs ${
                      p.isPopular ? 'bg-luxury-850 border-gold-500/50 shadow-luxury' : 'bg-luxury-950 border-luxury-800'
                    }`}
                  >
                    <div>
                      {p.isPopular && (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-gold-500 text-luxury-950 mb-2">
                          الأكثر طلباً
                        </span>
                      )}
                      <h4 className="text-sm font-bold text-luxury-100">{p.name}</h4>
                      <p className="text-[11px] text-luxury-400 mt-1">{p.description}</p>

                      <div className="my-3">
                        <span className="text-xl font-bold text-gold-400 font-mono">{formatPrice(p.priceMonthly)}</span>
                        <span className="text-[10px] text-luxury-400"> / شهر</span>
                      </div>

                      <div className="space-y-1.5 text-[11px] text-luxury-300 pt-2 border-t border-luxury-800">
                        <div>✓ حتى {p.maxTables === 999 ? 'غير محدود' : p.maxTables} طاولة</div>
                        <div>✓ {p.maxProducts === 999 ? 'أطباق غير محدودة' : `${p.maxProducts} طبق`}</div>
                        <div>✓ دعم الدفع عند الكاشير</div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleSelectPlan(p.id)}
                      disabled={isCurrent}
                      className={`mt-4 w-full py-2.5 rounded-xl font-bold text-xs transition-all ${
                        isCurrent
                          ? 'bg-luxury-800 text-luxury-400 cursor-default'
                          : 'bg-gold-500 hover:bg-gold-400 text-luxury-950 shadow-gold-glow'
                      }`}
                    >
                      {isCurrent ? 'باقتك الحالية' : 'الترقية لهذه الباقة'}
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
