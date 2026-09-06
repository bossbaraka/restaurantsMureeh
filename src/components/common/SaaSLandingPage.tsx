import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { BrandLogo, BrandMark, BrandWordmark } from '../brand/BrandLogo';
import { useAuth } from '../../context/AuthContext';
import { formatPrice } from '../../utils/formatting';
import {
  Sparkles,
  Smartphone,
  ChefHat,
  TrendingUp,
  Clock,
  ShieldCheck,
  CheckCircle2,
  ArrowLeft,
  QrCode,
  Users,
  CreditCard,
  Building2,
  MessageSquare,
  HelpCircle,
  ExternalLink,
  Check,
  Crown,
  Store,
  CalendarRange,
  BadgeCheck,
  Lock,
} from 'lucide-react';

type FeatureGroup = { title: string; items: string[] };

type PlanDef = {
  id: string;
  name: string;
  tagline: string;
  priceMonthly: number;
  priceYearly: number;
  priceYearlyPerMonth: number;
  features: string[];
  details: FeatureGroup[];
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
};

const PLANS: PlanDef[] = [
  {
    id: 'starter',
    name: 'الباقة الأساسية',
    tagline: 'للكافيهات والمطاعم الصغيرة التي تبدأ مشوارها الرقمي',
    priceMonthly: 149,
    priceYearly: 1490,
    priceYearlyPerMonth: Math.round(1490 / 12),
    features: [
      'حتى 15 طاولة برموز QR فريدة وآمنة',
      'منيو رقمي فاخر وتحديث فوري للأطباق',
      'زر استدعاء النادل من الطاولة',
      'الطلبات المباشرة والدفع عند الكاشير',
      'تقارير يومية أساسية للمبيعات',
    ],
    details: [
      {
        title: 'حدود الباقة',
        items: [
          '15 طاولة برموز QR فريدة وآمنة لكل طاولة',
          '6 أقسام للمنيو و 35 صنفاً نشطاً',
          'حساب مدير واحد + طاقم غير محدود (نادل/مطبخ/كاشير)',
        ],
      },
      {
        title: 'المنيو الرقمي للعميل',
        items: [
          'قائمة طعام فاخرة بصور وأوصاف وتصنيفات (عربي/إنجليزي)',
          'بحث فوري عن الأطباق والمكونات',
          'تحديث الأسعار والأصناف مباشرة من لوحة التحكم',
        ],
      },
      {
        title: 'الطلب الذكي من الطاولة',
        items: [
          'طلب بدون تسجيل حساب — يمسح الضيف رمز QR ويطلب فوراً',
          'تخصيص الطلب: إضافات، استبعاد مكونات، أحجام، ملاحظات',
          'جولات طلب متعددة تُجمَّع تلقائياً في فاتورة واحدة',
          'تتبع مباشر لحالة الطلب (قيد التحضير → جاهز → تم التقديم)',
        ],
      },
      {
        title: 'الضيافة والكاشير',
        items: [
          'زر استدعاء النادل من الطاولة مع اختيار السبب',
          'الدفع عند الكاشير مع إيصالات مرقمة RC وحساب الباقي',
          'تصفية الطاولة وتحريرها تلقائياً بعد الدفع',
          'مبيعات العميل المباشر (Walk-in Counter)',
        ],
      },
      {
        title: 'الدعم',
        items: ['دعم فني عبر واتساب في أوقات العمل', 'لوحة تحكم عربية كاملة + لوحة تحكم بالإنجليزية'],
      },
    ],
    cta: 'اشترك الآن',
    icon: Store,
  },
  {
    id: 'pro',
    name: 'الباقة الاحترافية',
    tagline: 'للمطاعم الفاخرة وقاعات الضيافة الكبيرة',
    priceMonthly: 349,
    priceYearly: 3490,
    priceYearlyPerMonth: Math.round(3490 / 12),
    features: [
      'حتى 50 طاولة مع خرائط صالات (زونات)',
      'شاشة مطبخ حية KDS مع إشعارات لحظية',
      'حسابات العمال بصلاحيات و PIN آمن',
      'تحليلات مبيعات متقدمة وتصدير CSV',
      'تخصيص كامل: الشعار والألوان وصورة الغلاف',
      'عروض وكومبو وأصناف مميزة غير محدودة',
    ],
    details: [
      {
        title: 'كل مزايا الباقة الأساسية +',
        items: [
          'حتى 50 طاولة (20 قسماً / 150 صنفاً)',
          'إدارة صالات (زونات): صالة رئيسية، تراس، VIP، حديقة',
          'حسابات موظفين بدور PIN لكل دور (نادل/شيف/كاشير/مساعد مدير)',
          'متوسط قيمة الطلب AOV و تحليلات الزوار والذروات',
        ],
      },
      {
        title: 'شاشة المطبخ الحية (KDS)',
        items: [
          'طلبات لحظية تصل الشيف فور إرسال العميل',
          'عدّاد طلبات معلقة + مؤقت زمني لكل طلب',
          'تنبيه صوتي ومرئي عند كل طلب جديد',
          'حالات: قبول → تحضير → جاهز للتقديم (مع حماية من التراجع)',
        ],
      },
      {
        title: 'الهوية البصرية لموقعك',
        items: [
          'رفع شعار مطعمك وصورة الغلاف من جهازك',
          '7 طوابق جاهزة لشكل الموقع + لونان مخصصان',
          'معاينة حية تشبه هاتف العميل قبل النشر',
        ],
      },
      {
        title: 'التسويق والعروض',
        items: [
          'عروض وكومبو مع حساب نسبة التوفير تلقائياً',
          'شارات ترويجية (جديد/مميز/الأكثر مبيعاً) للأصناف',
        ],
      },
      {
        title: 'الكاشير والمالية',
        items: [
          'نقطة بيع POS: دفع نقدي/بطاقة مع حساب الباقي',
          'سجل مدفوعات كامل برموز إيصال RC',
          'مشاركة الفاتورة مع الضيف عبر واتساب',
          'تحليلات المبيعات: إيراد اليوم، قيم مفتوحة، تقارير CSV وتقرير فوري للطباعة',
        ],
      },
      {
        title: 'التشغيل اليومي',
        items: [
          'طباعة بطاقات QR للطاولات (نصبية/مفرودة)',
          'نداءات النادل بلوحة أولويات وحلول من الجوال',
          'سجل تدقيق كامل لكل عملية (من قام بها ومتى)',
        ],
      },
    ],
    cta: 'ابدأ تجربتك المجانية',
    icon: Crown,
  },
  {
    id: 'enterprise',
    name: 'باقة المؤسسات',
    tagline: 'لسلاسل المطاعم والفنادق والفروع المتعددة',
    priceMonthly: 799,
    priceYearly: 7990,
    priceYearlyPerMonth: Math.round(7990 / 12),
    features: [
      'طاولات غير محدودة لكل الفروع',
      'فروع متعددة تحت حساب إدارة واحد',
      'نطاق مخصص لموقعك (Custom Domain)',
      'دعم فني ذو أولوية 24/7 مع تدريب',
      'كل مزايا الباقة الاحترافية',
    ],
    details: [
      {
        title: 'كل مزايا الباقة الاحترافية +',
        items: [
          'طاولات وأقسام وأصناف غير محدودة (999+)',
          'موظفون غير محدودين في كل فرع',
          'مديرو فروع مستقلون لكل موقع بصلاحياته',
        ],
      },
      {
        title: 'الفروع المتعددة (Multi-Branch)',
        items: [
          'فروع غير محدودة تحت حساب إدارة مركزي واحد',
          'قوائم وطاولات مستقلة لكل فرع',
          'ربط الطاولات بفرعها وتقارير مبيعات لكل فرع على حدة',
          'هوية مشتركة مع إمكانية تخصيص كل فرع',
        ],
      },
      {
        title: 'الهوية والنطاق',
        items: [
          'نطاق مخصص يظهر منيو مطعمك على رابطك الخاص',
          'تخصيص كامل للشعار والألوان على مستوى السلسلة',
        ],
      },
      {
        title: 'الدعم والخدمة',
        items: [
          'دعم فني أولوية قصوى على مدار الساعة 24/7',
          'جلسة تدريب وإعداد مجانية (Onboarding)',
          'استشارة تشغيلية دورية لفريقك',
        ],
      },
    ],
    cta: 'تواصل مع المبيعات',
    icon: Building2,
  },
];

export const SaaSLandingPage: React.FC = () => {
  const { setViewMode } = useRestaurant();
  const { currentUser, isSuperAdmin, setIsLoginModalOpen } = useAuth();
  const [tablesInput, setTablesInput] = useState(20);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');

  // ROI calculations
  const estimatedStaffCostSaved = tablesInput * 120; // ₪ saved monthly in paper menu & labor efficiency
  const estimatedRevenueBoost = tablesInput * 350; // ₪ boosted through add-ons and fast table turnover

  const handleContactWhatsApp = (planName: string = 'الاحترافية') => {
    const text = encodeURIComponent(`مرحباً! أود الاشتراك في منصة مُريح للخدمات الإلكترونية للمطاعم (${planName}) والاستفسار عن تدشين الخدمة لمطعمي.`);
    window.open(`https://api.whatsapp.com/send?phone=970593498909&text=${text}`, '_blank');
  };

  const openManagerConsole = () => {
    if (currentUser) {
      setViewMode('MANAGER');
    } else {
      setIsLoginModalOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#07080A] text-luxury-50 font-sans selection:bg-gold-500/20 selection:text-gold-300" dir="rtl">
      <header className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-6 flex items-center justify-between">
        <BrandLogo size={44} subtitle="Restaurant OS" />
        <span className="text-xs text-luxury-400 hidden sm:block">منصة الخدمات الإلكترونية للمطاعم</span>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-16 sm:py-24 px-4 sm:px-6 border-b border-luxury-850">
        <div className="absolute inset-0 bg-radial-gradient from-gold-500/10 via-transparent to-transparent opacity-50 pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center space-y-6 relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-luxury-900/90 border border-[#7E14FF]/50 text-[#C4B5FD] text-xs font-bold shadow-[0_0_20px_rgba(126,20,255,0.25)] backdrop-blur-md">
            <Sparkles className="w-4 h-4 text-gold-400" />
            <span>المنظومة السحابية الأرقى لإدارة المطاعم والطلب الرقمي للطاولات</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold font-serif tracking-wide text-luxury-50 leading-tight">
            حوّل طاولات مطعمك إلى <br />
            <span className="bg-gradient-to-l from-[#D6C7FF] via-[#A78BFA] to-[#47BFFF] bg-clip-text text-transparent">
              تجربة ضيافة استثنائية وأرباح مضاعفة
            </span>
          </h1>

          <p className="text-sm sm:text-lg text-luxury-300 max-w-2xl mx-auto leading-relaxed">
            منيو رقمي فاخر برمز QR لكل طاولة بدون تسجيل حساب للزبون، شاشة مطبخ حية (KDS)، نداء الويتر بضغطة زر، وإدارة كاملة لـ 50 طاولة بنظام سحابي معزول وآمن.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <button
              onClick={openManagerConsole}
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-l from-[#7E14FF] to-[#47BFFF] hover:brightness-110 text-white font-bold text-sm shadow-[0_0_28px_rgba(126,20,255,0.45)] flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-98"
            >
              <span>{currentUser ? 'دخول لوحة تحكم المطعم' : 'دخول لوحة تحكم المطعم'}</span>
              <ArrowLeft className="w-4 h-4" />
            </button>

            {isSuperAdmin && (
              <button
                onClick={() => setViewMode('PLATFORM_ADMIN')}
                className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-luxury-900 hover:bg-luxury-850 border border-luxury-750 text-luxury-100 font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <span>إدارة منصة المستأجرين</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Feature Pillars Grid */}
      <section className="py-16 px-4 sm:px-6 max-w-6xl mx-auto">
        <div className="text-center space-y-2 mb-12">
          <span className="text-xs font-bold text-gold-400 uppercase tracking-widest">لماذا يختارنا أصحاب المطاعم؟</span>
          <h2 className="text-2xl sm:text-3xl font-bold font-serif text-luxury-50">حل متكامل يغنيك عن عشرات البرامج</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl bg-luxury-900/70 border border-luxury-800 hover:border-gold-500/40 transition-all space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-400">
              <QrCode className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold font-serif text-luxury-100">طلب ذكي بدون تسجيل حساب</h3>
            <p className="text-xs text-luxury-400 leading-relaxed">
              يمسح الزبون رمز الـ QR على الطاولة ويطلب فوراً مع خيارات تخصيص الوجبة (إضافات، استبعاد مكونات، أحجام) والدفع عند الكاشير.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-luxury-900/70 border border-luxury-800 hover:border-gold-500/40 transition-all space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <ChefHat className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold font-serif text-luxury-100">شاشة مطبخ حية (KDS)</h3>
            <p className="text-xs text-luxury-400 leading-relaxed">
              تصل الطلبات للشيف فوراً مع تنبيهات صوتية، وقفل تعديل الطلب بمجرد بدء الطهي لمنع إهدار الطعام أو الخلافات مع الزبائن.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-luxury-900/70 border border-luxury-800 hover:border-gold-500/40 transition-all space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold font-serif text-luxury-100">تعدد المستخدمين والعمال</h3>
            <p className="text-xs text-luxury-400 leading-relaxed">
              حسابات خاصة للنادل، الشيف، والكاشير برمز PIN سريع للدخول وإدارة الصالات ونداءات الضيوف.
            </p>
          </div>
        </div>
      </section>

      {/* ROI Profit Calculator */}
      <section className="py-12 px-4 sm:px-6 bg-luxury-950 border-y border-luxury-850">
        <div className="max-w-4xl mx-auto rounded-3xl bg-gradient-to-br from-luxury-900 to-luxury-950 border border-gold-500/30 p-6 sm:p-10 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <span className="text-xs font-bold text-gold-400">حاسبة العائد على الاستثمار (ROI Calculator)</span>
            <h3 className="text-2xl font-bold font-serif text-luxury-50">كم يوفر لك النظام شهرياً؟</h3>
          </div>

          <div className="space-y-3 max-w-md mx-auto text-center">
            <label className="text-xs text-luxury-300 font-bold block">
              حدد عدد الطاولات في مطعمك: <strong className="text-gold-400 text-base">{tablesInput} طاولة</strong>
            </label>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={tablesInput}
              onChange={(e) => setTablesInput(Number(e.target.value))}
              className="w-full accent-gold-500 cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-luxury-800">
            <div className="p-5 rounded-2xl bg-luxury-950 border border-luxury-800 text-center">
              <span className="text-xs text-luxury-400 block">توفير تكاليف الطباعة والعمالة</span>
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-400 mt-1 block font-mono">
                {formatPrice(estimatedStaffCostSaved)} / شهرياً
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-luxury-950 border border-luxury-800 text-center">
              <span className="text-xs text-luxury-400 block">زيادة متوقعة في المبيعات وتدوير الطاولات</span>
              <span className="text-2xl sm:text-3xl font-extrabold text-gold-400 mt-1 block font-mono">
                +{formatPrice(estimatedRevenueBoost)} / شهرياً
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ============ Subscription Pricing Plans (باقات الاشتراك) ============ */}
      <section id="pricing" className="relative overflow-hidden py-16 sm:py-20 px-4 sm:px-6 border-t border-luxury-850/70">
        {/* ambient brand glow */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-[#7E14FF]/60 to-transparent" />
        <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[560px] h-[320px] rounded-full bg-[#7E14FF]/10 blur-3xl pointer-events-none" />

        <div className="max-w-6xl mx-auto relative z-10">
          {/* Brand lockup header */}
          <div className="text-center space-y-4 mb-12">
            <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-luxury-900/90 border border-[#7E14FF]/30 shadow-lg shadow-[#7E14FF]/20 backdrop-blur">
              <BrandMark size={24} />
              <BrandWordmark size={15} subtitle="Pricing" />
              <span className="text-[9px] font-bold tracking-[0.2em] text-luxury-400 uppercase border-r border-luxury-700 pr-2.5">MUREEH · SaaS</span>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold text-gold-400 uppercase tracking-widest block">باقات الاشتراك</span>
              <h2 className="text-2xl sm:text-4xl font-bold font-serif text-luxury-50">باقات واضحة تنمو مع مطعمك</h2>
              <p className="text-xs sm:text-sm text-luxury-400 max-w-xl mx-auto leading-relaxed">
                ابدأ بإطلاق منيو رقمي احترافي خلال دقائق، وطوّر باقاتك كلما كبر مطعمك — بدون رسوم خفية وبدون عقود إجبارية.
              </p>
            </div>

            {/* Billing toggle */}
            <div className="inline-flex items-center gap-1 p-1.5 rounded-2xl bg-luxury-900 border border-luxury-750 relative">
              {(['monthly', 'yearly'] as const).map((period) => {
                const isActive = billingPeriod === period;
                return (
                  <button
                    key={period}
                    onClick={() => setBillingPeriod(period)}
                    className={`relative px-5 sm:px-7 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isActive ? 'text-luxury-950' : 'text-luxury-300 hover:text-luxury-100'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute inset-0 bg-gradient-to-l from-gold-400 to-gold-600 rounded-xl shadow-gold-glow" />
                    )}
                    <span className="relative z-10 flex items-center gap-1.5">
                      {period === 'monthly' ? <CalendarRange className="w-3.5 h-3.5" /> : <BadgeCheck className="w-3.5 h-3.5" />}
                      {period === 'monthly' ? 'الدفع الشهري' : 'الدفع السنوي'}
                    </span>
                  </button>
                );
              })}
            </div>
            {billingPeriod === 'yearly' && (
              <p className="text-[11px] text-emerald-400 font-bold flex items-center justify-center gap-1.5">
                <BadgeCheck className="w-3.5 h-3.5" />
                اخترت الدفع السنوي — وفّرت شهرين كاملين (~17%) على باقتك
              </p>
            )}
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 items-stretch">
            {PLANS.map((plan) => {
              const Icon = plan.icon;
              const isPro = plan.id === 'pro';
              const price = billingPeriod === 'monthly' ? plan.priceMonthly : plan.priceYearlyPerMonth;
              const showYearlyHint = billingPeriod === 'yearly';

              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col rounded-3xl overflow-hidden transition-all duration-300 ${
                    isPro
                      ? 'border border-[#7E14FF]/60 shadow-[0_0_46px_rgba(126,20,255,0.28)] md:-my-2 md:py-0 bg-gradient-to-b from-luxury-850 via-luxury-900 to-luxury-950'
                      : 'border border-luxury-800 bg-luxury-900/80 hover:border-luxury-700'
                  }`}
                >
                  {/* top accent line */}
                  <div
                    className={`h-1.5 w-full ${isPro ? 'bg-gradient-to-l from-[#D6C7FF] via-[#7E14FF] to-[#47BFFF]' : 'bg-gradient-to-l from-luxury-700 to-luxury-800'}`}
                  />

                  {isPro && (
                    <span className="absolute -top-px left-1/2 -translate-x-1/2 z-20 mt-3 px-4 py-1.5 rounded-full bg-gradient-to-l from-[#7E14FF] to-[#47BFFF] text-white text-[10px] font-black flex items-center gap-1.5 shadow-[0_0_24px_rgba(71,191,255,0.4)] whitespace-nowrap">
                      <Crown className="w-3 h-3" />
                      الأكثر طلباً للمطاعم الفاخرة
                    </span>
                  )}

                  <div className="p-6 sm:p-7 flex flex-col flex-1">
                    <div className="flex items-center justify-between mb-5">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                          isPro
                            ? 'bg-[#7E14FF]/15 border border-[#7E14FF]/40 text-[#B79CFF]'
                            : 'bg-[#A78BFA]/10 border border-[#A78BFA]/30 text-[#A78BFA]'
                        }`}
                      >
                        <Icon className="w-6 h-6" />
                      </div>
                      {isPro && (
                        <span className="text-[10px] font-bold text-luxury-400 bg-luxury-950 border border-luxury-800 px-2.5 py-1 rounded-full">
                          لأصحاب المطاعم الجادين
                        </span>
                      )}
                    </div>

                    <h3 className={`text-xl font-bold font-serif ${isPro ? 'text-[#C4B5FD]' : 'text-luxury-50'}`}>{plan.name}</h3>
                    <p className="text-xs text-luxury-400 mt-1 mb-5 leading-relaxed">{plan.tagline}</p>

                    <div className="flex items-end gap-1.5 mb-1">
                      <span className={`text-4xl font-extrabold font-mono ${isPro ? 'text-[#B79CFF]' : 'text-luxury-50'}`}>{price}</span>
                      <span className="text-xs text-luxury-400 mb-1.5">₪ / شهرياً</span>
                    </div>
                    <div className="h-4 mb-5">
                      {showYearlyHint ? (
                        <span className="text-[10px] text-emerald-400 font-bold">
                          تُدفع سنوياً: {(plan.priceYearly)} ₪ — وفّرت {plan.priceMonthly * 12 - plan.priceYearly} ₪
                        </span>
                      ) : (
                        <span className="text-[10px] text-luxury-500">يمكن الترقية أو الإلغاء في أي وقت</span>
                      )}
                    </div>

                    <ul className="space-y-2.5 text-xs mb-5">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-luxury-200 leading-relaxed">
                          <span
                            className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                              isPro ? 'bg-[#7E14FF]/20 text-[#B79CFF]' : 'bg-emerald-500/15 text-emerald-400'
                            }`}
                          >
                            <Check className="w-2.5 h-2.5" />
                          </span>
                          <span className="text-luxury-300">{feature}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Detailed plan features */}
                    <details
                      className={`group mb-5 rounded-xl border overflow-hidden transition-colors ${
                        isPro ? 'border-[#7E14FF]/35 bg-[#7E14FF]/5' : 'border-luxury-800 bg-luxury-950/70'
                      }`}
                    >
                      <summary className="flex items-center justify-between gap-2 px-3.5 py-2.5 cursor-pointer list-none select-none">
                        <span className="text-[11px] font-bold text-luxury-100 flex items-center gap-1.5">
                          <Crown className={`w-3.5 h-3.5 ${isPro ? 'text-gold-400' : 'text-[#A78BFA]'}`} />
                          مزايا الباقة كاملة بالتفصيل
                        </span>
                        <span className={`text-[10px] text-luxury-500 group-open:rotate-180 transition-transform`}>▾</span>
                      </summary>
                      <div className="px-3.5 pb-3.5 pt-1 space-y-3.5">
                        {plan.details.map((group) => (
                          <div key={group.title}>
                            <div className={`text-[10px] font-black mb-1.5 flex items-center gap-1.5 ${isPro ? 'text-gold-300' : 'text-[#A78BFA]'}`}>
                              <span className="w-1 h-1 rounded-full bg-current" />
                              {group.title}
                            </div>
                            <ul className="space-y-1.5">
                              {group.items.map((item) => (
                                <li key={item} className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-luxury-300">
                                  <Check className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" />
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </details>

                    <div className="mt-auto">
                      <button
                        onClick={() => handleContactWhatsApp(plan.name)}
                        className={`w-full py-3.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 ${
                          isPro
                            ? 'bg-gradient-to-l from-[#7E14FF] to-[#47BFFF] text-white shadow-[0_0_26px_rgba(126,20,255,0.45)] hover:brightness-110'
                            : 'bg-luxury-800 hover:bg-luxury-750 text-luxury-100 border border-luxury-700'
                        }`}
                      >
                        {plan.cta}
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Trust strip */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-4xl mx-auto">
            {[
              { icon: Lock, title: 'عزل تام لبيانات مطعمك', desc: 'كل مستأجر يعمل في قاعدة بيانات معزولة؛ لا يرى عملاؤك سوى منيو مطعمك.' },
              { icon: ShieldCheck, title: 'أمان مصرفي حقيقي', desc: 'تشفير Bcrypt لكلمات المرور و JWT لكل جلسة، و سجل تدقيق كامل.' },
              { icon: Clock, title: 'تفعيل خلال دقائق', desc: 'منصة جاهزة تعمل فوراً — بدون تعقيد تقني أو عقود طويلة.' },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3 p-4 rounded-2xl bg-luxury-900/60 border border-luxury-800/80">
                <span className="w-9 h-9 rounded-xl bg-[#7E14FF]/10 border border-[#7E14FF]/30 text-[#A78BFA] flex items-center justify-center shrink-0">
                  <item.icon className="w-5 h-5" />
                </span>
                <div>
                  <div className="text-xs font-bold text-luxury-100">{item.title}</div>
                  <div className="text-[10px] text-luxury-400 mt-0.5 leading-relaxed">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Mini FAQ */}
          <div className="mt-12 max-w-2xl mx-auto space-y-2.5">
            <h3 className="text-center text-sm font-bold font-serif text-luxury-100 mb-4">أسئلة شائعة عن الباقات</h3>
            {[
              { q: 'هل يمكنني تغيير باقتي لاحقاً؟', a: 'نعم — من لوحة تحكم مطعمك (الباقة والاشتراك) يمكنك الترقية أو التخفيض فورياً ويُطبق الفرق تلقائياً على اشتراكك.' },
              { q: 'هل تتغير الأسعار مع عدد الطاولات؟', a: 'لا. سعر الباقة ثابت ويشمل كل ما هو مذكور — الطاولات داخل حد باقتك بدون أي رسوم إضافية.' },
              { q: 'هل يمكنني تخصيص شكل موقعي وشعاري؟', a: 'بالتأكيد — في باقة Pro يمكنك اختيار طابع الألوان، رفع شعار مطعمك وصورة الغلاف، ومعاينة شكل الموقع مباشرة قبل النشر.' },
            ].map((faq) => (
              <details
                key={faq.q}
                className="group rounded-xl bg-luxury-900/70 border border-luxury-800 open:border-gold-500/40 transition-colors"
              >
                <summary className="flex items-center justify-between gap-3 px-4 py-3 text-xs font-bold text-luxury-100 cursor-pointer list-none select-none">
                  <span className="flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-gold-400 shrink-0" />
                    {faq.q}
                  </span>
                  <span className="text-luxury-500 group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="px-4 pb-4 text-[11px] text-luxury-400 leading-relaxed border-t border-luxury-800/70 pt-3">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-luxury-850 text-center text-xs text-luxury-500 space-y-2">
        <p className="font-serif font-extrabold">
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(90deg,#D6C7FF,#A78BFA 45%,#47BFFF)', WebkitBackgroundClip: 'text' }}>
            مُريح للخدمات الإلكترونية
          </span>
        </p>
        <p>© 2026 جميع الحقوق محفوظة · منظومة سحابية آمنة متعددة المستأجرين</p>
      </footer>
    </div>
  );
};
