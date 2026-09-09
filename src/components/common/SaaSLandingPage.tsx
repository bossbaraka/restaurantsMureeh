import { useEffect, useState, type FC } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { BrandLogo, BrandMark, BrandWordmark } from '../brand/BrandLogo';
import { useAuth } from '../../context/AuthContext';
import { formatPrice } from '../../utils/formatting';
import { AnimatedNumber, CountUp, Reveal, SectionHeading } from './landing/primitives';
import { KdsMockup, ManagerMockup, MiniQr, PhoneMockup } from './landing/mockups';
import { DemoVideoPlayer } from './landing/DemoVideoPlayer';
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  BellRing,
  Building2,
  CalendarRange,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  CreditCard,
  Crown,
  LayoutDashboard,
  Lock,
  Menu,
  MessageSquare,
  MousePointerClick,
  Palette,
  Play,
  Plus,
  QrCode,
  Quote,
  Receipt,
  Rocket,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Store,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';

/* ============================== Data ============================== */

type FeatureGroup = { title: string; items: string[] };

type PlanDef = {
  id: string;
  name: string;
  tagline: string;
  priceMonthly: number;
  priceYearly: number;
  priceYearlyPerMonth: number;
  features: string[];
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
};

const PLANS: PlanDef[] = [
  {
    id: 'starter',
    name: 'الباقة الأساسية',
    tagline: 'للمطاعم والكافيهات الواعدة',
    priceMonthly: 299,
    priceYearly: 2990,
    priceYearlyPerMonth: Math.round(2990 / 12),
    features: [
      'منيو رقمي فاخر وتفاعلي عبر رمز الـ QR',
      'طلب فوري مباشر من الطاولة بدون أي تطبيق',
      'زر استدعاء النادل وإدارة طلبات الخدمة',
      'نظام كاشير أساسي وتصفية الفواتير',
      'لوحة تحكم ودعم فني من منصة مريح',
    ],
    cta: 'اشترك الآن',
    icon: Store,
  },
  {
    id: 'pro',
    name: 'الباقة الاحترافية (الأكثر طلباً)',
    tagline: 'الحل المتكامل لإدارة الصالات وشاشة المطبخ والـ POS',
    priceMonthly: 299,
    priceYearly: 2990,
    priceYearlyPerMonth: Math.round(2990 / 12),
    features: [
      'جميع مزايا الباقة الأساسية بالكامل',
      'شاشة المطبخ الحية (KDS) بتنبيهات صوتية فورية',
      'نقطة بيع POS متطورة وتصنيفات الصالات',
      'تحليلات مبيعات تفاعلية وتخصيص الهوية البصرية',
      'إدارة العروض والكومبو وشارات الترويج',
    ],
    cta: 'احصل على الباقة الاحترافية',
    icon: Crown,
  },
  {
    id: 'enterprise',
    name: 'باقة المؤسسات والسلاسل',
    tagline: 'لسلاسل المطاعم والفنادق والمنتجعات والفروع المتعددة',
    priceMonthly: 799,
    priceYearly: 7990,
    priceYearlyPerMonth: Math.round(7990 / 12),
    features: [
      'سعة مفتوحة للفروع والأصناف والطلبات',
      'إدارة الفروع المتعددة (Multi-Branch System)',
      'ربط نطاق خاص لموقعك (Custom Domain)',
      'مدير حساب خاص ودعم أولوية قصوى 24/7',
    ],
    cta: 'تواصل مع مبيعات مريح',
    icon: Building2,
  },
];

const NAV_LINKS = [
  { href: '#how', label: 'كيف يعمل' },
  { href: '#features', label: 'المزايا' },
  { href: '#video', label: 'الفيديو' },
  { href: '#showcase', label: 'جولة حيّة' },
  { href: '#pricing', label: 'الباقات' },
  { href: '#faq', label: 'الأسئلة الشائعة' },
];

const MARQUEE_ITEMS = [
  'منيو QR فوري',
  'شاشة مطبخ حيّة',
  'نقطة بيع متطورة',
  'تحليلات لحظية',
  'نداء نادل ذكي',
  'فواتير مرقمة',
  'هوية بصرية كاملة',
  'دعم واتساب مباشر',
];

const STEPS = [
  {
    num: '01',
    icon: ScanLine,
    title: 'جهّز طاولاتك برموز QR',
    desc: 'نجهّز لك بطاقات QR أنيقة ومقاومة لكل طاولة — الصقها على الطاولات وخلّص، والباقي علينا.',
  },
  {
    num: '02',
    icon: MousePointerClick,
    title: 'زبونك يمسح ويطلب فوراً',
    desc: 'بدون تطبيق وبدون تسجيل: منيو تفاعلي بالصور، تخصيص كامل للوجبة، وزر استدعاء النادل.',
  },
  {
    num: '03',
    icon: TrendingUp,
    title: 'استلم أرباحك وراقب النمو',
    desc: 'الطلب يصل المطبخ لحظياً، والفاتورة تُحسم عند الكاشير، وأنت تتابع المبيعات من هاتفك.',
  },
];

type ShowcaseTab = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title: string;
  desc: string;
  bullets: string[];
  Mock: FC<{ className?: string }>;
};

const SHOWCASE_TABS: ShowcaseTab[] = [
  {
    icon: Smartphone,
    label: 'هاتف الزبون',
    title: 'تجربة طلب يعشقها الزبائن',
    desc: 'واجهة عربية فاخرة تعمل على أي هاتف — سريعة، واضحة، ومصممة لترفع متوسط قيمة الطلب.',
    bullets: [
      'مسح QR والطلب فوراً بدون حساب أو تطبيق',
      'تخصيص الوجبة: إضافات وأحجام واستبعاد مكونات',
      'تتبع حي لحالة الطلب حتى لحظة التقديم',
      'استدعاء النادل وطلب الفاتورة بضغطة زر',
    ],
    Mock: PhoneMockup,
  },
  {
    icon: ChefHat,
    label: 'شاشة المطبخ',
    title: 'مطبخ يعمل كخلية نحل منظمة',
    desc: 'شاشة عرض ذكية للمطبخ تنظم الطلبات بالأولوية وتمنع الضياع والهدر نهائياً.',
    bullets: [
      'تنبيه صوتي ومرئي فوري مع كل طلب جديد',
      'مؤقت ملوّن لكل طلب حسب الأولوية الزمنية',
      'قفل التعديل تلقائياً بعد بدء التحضير',
      'زر «جاهز» يُشعر النادل والزبون معاً',
    ],
    Mock: KdsMockup,
  },
  {
    icon: LayoutDashboard,
    label: 'لوحة المدير',
    title: 'كل مطعمك تحت عينك أينما كنت',
    desc: 'لوحة قيادة شاملة للمبيعات والمنيو والطاقم — من هاتفك أو حاسوبك، لحظة بلحظة.',
    bullets: [
      'مبيعات وطلبات لحظية من أي جهاز',
      'تعديل المنيو والأسعار في ثوانٍ معدودة',
      'تقارير CSV وسجل تدقيق أمني كامل',
      'إدارة الطاولات والصلاحيات والفروع',
    ],
    Mock: ManagerMockup,
  },
];

const TESTIMONIALS = [
  {
    quote:
      'استغنينا عن قوائم الورق نهائياً. الزبون يمسح الرمز ويطلب، والطلب يوصل المطبخ قبل ما يكمّل قهوته.',
    name: 'أبو كريم',
    role: 'مطعم عائلي · 28 طاولة',
    initial: 'ك',
    tint: 'from-amber-500 to-orange-600',
  },
  {
    quote:
      'سرعة تدوير الطاولات ارتفعت بشكل واضح، وتقارير المبيعات اليومية وفّرت عليّ ساعات من الحسابات اليدوية.',
    name: 'سارة',
    role: 'مقهى مختص · 16 طاولة',
    initial: 'س',
    tint: 'from-[#0072BC] to-[#009FE3]',
  },
  {
    quote:
      'شاشة المطبخ غيّرت طريقة شغلنا بالكامل — لا طلبات ضائعة ولا خلافات على التعديلات بعد بدء التحضير.',
    name: 'الشيف عمر',
    role: 'مطعم فاخر · 40 طاولة',
    initial: 'ع',
    tint: 'from-emerald-500 to-teal-600',
  },
];

const FAQS = [
  {
    q: 'هل يمكنني تغيير باقتي لاحقاً؟',
    a: 'نعم — من لوحة تحكم مطعمك (الباقة والاشتراك) يمكنك الترقية أو التخفيض فورياً، ويُطبق الفرق تلقائياً على اشتراكك بدون أي تعقيد.',
  },
  {
    q: 'هل تتغير الأسعار مع عدد الطاولات؟',
    a: 'لا. سعر الباقة ثابت ويشمل كل ما هو مذكور — الطاولات داخل حدّ باقتك بدون أي رسوم إضافية مهما زاد عدد طلباتك.',
  },
  {
    q: 'هل يمكنني تخصيص شكل موقعي وشعاري؟',
    a: 'بالتأكيد — في الباقة الاحترافية يمكنك اختيار طابع الألوان، رفع شعار مطعمك وصورة الغلاف، ومعاينة شكل الموقع مباشرة قبل النشر.',
  },
  {
    q: 'هل أحتاج لشراء أجهزة أو معدات خاصة؟',
    a: 'لا. يعمل النظام بالكامل على الأجهزة التي تملكها أصلاً: أي هاتف أو تابلت للزبائن والطاقم، وشاشة عادية للمطبخ. نحن نجهّز لك بطاقات QR فقط.',
  },
  {
    q: 'ماذا لو كان الإنترنت ضعيفاً في مطعمي؟',
    a: 'النظام مصمم ليعمل بكفاءة حتى مع اتصال إنترنت بسيط، وواجهة الزبون خفيفة وتتحمّل بسرعة. وفريق الدعم يساعدك في تجهيز الشبكة بأفضل صورة.',
  },
  {
    q: 'كيف أستقبل المدفوعات من الزبائن؟',
    a: 'بكل مرونة: الدفع نقداً أو بالبطاقة عند الكاشير أو الطاولة، مع فواتير مرقمة وحساب تلقائي للمتبقي وتصفية فورية للطاولة بعد الدفع.',
  },
];

/* ============================== Page ============================== */

export const SaaSLandingPage: FC = () => {
  const { setViewMode } = useRestaurant();
  const { currentUser, isSuperAdmin, setIsLoginModalOpen } = useAuth();
  const [tablesInput, setTablesInput] = useState(20);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [tab, setTab] = useState(0);
  const [tabCycle, setTabCycle] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-rotate showcase tabs (timer resets on manual selection)
  useEffect(() => {
    const id = setInterval(() => setTab((t) => (t + 1) % SHOWCASE_TABS.length), 7000);
    return () => clearInterval(id);
  }, [tabCycle]);

  // ROI calculations
  const estimatedStaffCostSaved = tablesInput * 120;
  const estimatedRevenueBoost = tablesInput * 350;
  const sliderPct = ((tablesInput - 5) / (100 - 5)) * 100;

  const handleContactTelegram = (planName: string = 'الاحترافية') => {
    const text = encodeURIComponent(
      `مرحباً! أود الاشتراك في منصة مُريح للخدمات الإلكترونية للمطاعم (${planName}) والاستفسار عن تدشين الخدمة لمطعمي.`,
    );
    window.open(`https://t.me/+972599891559?text=${text}`, '_blank');
  };

  const openManagerConsole = () => {
    if (currentUser) {
      setViewMode('MANAGER');
    } else {
      setIsLoginModalOpen(true);
    }
  };

  const selectTab = (i: number) => {
    setTab(i);
    setTabCycle((k) => k + 1);
  };

  const activeTab = SHOWCASE_TABS[tab] ?? SHOWCASE_TABS[0]!;

  return (
    <div
      id="top"
      dir="rtl"
      className="min-h-screen bg-[#020A14] text-slate-100 font-sans overflow-x-clip selection:bg-[#0072BC]/40 selection:text-[#7DD3FC]"
    >
      {/* ================= Sticky glass navbar ================= */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-[#020A14]/85 backdrop-blur-xl border-b border-[#004B87]/40 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.8)]'
            : 'bg-transparent border-b border-transparent'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-[72px] flex items-center justify-between gap-4">
          <a href="#top" aria-label="مُريح — الصفحة الرئيسية">
            <BrandLogo size={38} subtitle="MUREEH OS" />
          </a>
          <nav className="hidden lg:flex items-center gap-1 text-[13px] font-bold text-slate-300">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="px-3.5 py-2 rounded-xl hover:text-white hover:bg-white/5 transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="hidden lg:flex items-center gap-2.5">
            <button
              onClick={() => handleContactTelegram('تواصل عام')}
              className="px-4 py-2.5 rounded-xl bg-[#0072BC]/15 hover:bg-[#0072BC]/25 border border-[#0072BC]/40 text-[#7DD3FC] text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              تليجرام المبيعات
            </button>
            <button
              onClick={openManagerConsole}
              className="btn-shine px-4 py-2.5 rounded-xl bg-gradient-to-l from-[#003865] via-[#0072BC] to-[#009FE3] hover:brightness-110 text-white text-xs font-bold shadow-[0_0_24px_rgba(0,114,188,0.4)] transition-all cursor-pointer"
            >
              دخول لوحة التحكم
            </button>
          </div>
          <button
            className="lg:hidden w-10 h-10 rounded-xl bg-[#081B33] border border-[#004B87]/60 text-slate-200 flex items-center justify-center cursor-pointer"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="فتح القائمة"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="lg:hidden border-t border-[#004B87]/40 bg-[#020A14]/95 backdrop-blur-xl px-4 py-4 space-y-1 animate-fade-in">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2.5 rounded-xl text-sm font-bold text-slate-200 hover:bg-white/5"
              >
                {l.label}
              </a>
            ))}
            <div className="flex gap-2 pt-3">
              <button
                onClick={() => handleContactTelegram('تواصل عام')}
                className="flex-1 py-3 rounded-xl bg-[#0072BC]/15 border border-[#0072BC]/40 text-[#7DD3FC] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                تليجرام
              </button>
              <button
                onClick={openManagerConsole}
                className="flex-1 py-3 rounded-xl bg-gradient-to-l from-[#003865] to-[#009FE3] text-white text-xs font-bold cursor-pointer"
              >
                دخول لوحة التحكم
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ================= Hero ================= */}
      <section className="relative overflow-hidden pt-28 sm:pt-40 pb-14 sm:pb-20 px-4 sm:px-6">
        {/* backdrop */}
        <div className="absolute inset-0 saas-grid-bg saas-fade-radial pointer-events-none" />
        <div className="absolute -top-32 right-[8%] w-[420px] h-[420px] rounded-full bg-[#0072BC]/25 blur-[120px] pointer-events-none animate-saas-drift-a" />
        <div className="absolute top-24 left-[4%] w-[380px] h-[380px] rounded-full bg-[#009FE3]/15 blur-[120px] pointer-events-none animate-saas-drift-b" />
        <div className="absolute top-0 right-1/2 translate-x-1/2 w-[720px] h-px bg-gradient-to-l from-transparent via-[#38BDF8]/60 to-transparent pointer-events-none" />

        <div className="max-w-6xl mx-auto relative z-10 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-8 items-center">
          {/* copy */}
          <div className="text-center lg:text-start space-y-6">
            <Reveal>
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#003865]/70 border border-[#0072BC]/50 text-[#7DD3FC] text-xs font-bold shadow-[0_0_24px_rgba(0,114,188,0.35)] backdrop-blur-md">
                <Sparkles className="w-4 h-4" />
                منظومة مُريح OS للمطاعم — إصدار 2026
              </span>
            </Reveal>
            <Reveal delay={90}>
              <h1 className="text-4xl sm:text-5xl xl:text-[3.6rem] font-black leading-[1.25] text-white text-balance">
                مطعمك كاملاً…
                <br />
                يُدار من{' '}
                <span className="bg-gradient-to-l from-white via-[#7DD3FC] to-[#009FE3] bg-clip-text text-transparent">
                  رمز QR واحد
                </span>
              </h1>
            </Reveal>
            <Reveal delay={180}>
              <p className="text-sm sm:text-lg text-slate-300/95 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                منيو رقمي فاخر بدون تطبيق وبدون تسجيل، شاشة مطبخ حيّة، نداء نادل فوري،
                وتقارير مبيعات لحظية — منظومة مُريح السحابية تحوّل كل طاولة إلى مصدر ربح ذكي.
              </p>
            </Reveal>
            <Reveal delay={260}>
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
                <button
                  onClick={openManagerConsole}
                  className="btn-shine w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-l from-[#003865] via-[#0072BC] to-[#009FE3] hover:brightness-110 text-white font-bold text-sm shadow-[0_0_36px_rgba(0,114,188,0.5)] flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                >
                  <Rocket className="w-4 h-4" />
                  ابدأ تجربتك المجانية
                </button>
                <a
                  href="#how"
                  className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/15 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all backdrop-blur"
                >
                  <span className="w-6 h-6 rounded-full bg-[#0072BC] flex items-center justify-center">
                    <Play className="w-3 h-3 fill-white text-white" />
                  </span>
                  شاهد كيف يعمل
                </a>
              </div>
              {isSuperAdmin && (
                <button
                  onClick={() => setViewMode('PLATFORM_ADMIN')}
                  className="mt-3 px-6 py-2.5 rounded-xl bg-[#081B33] hover:bg-[#0C274A] border border-[#0072BC]/40 text-[#E0F2FE] font-bold text-xs transition-all cursor-pointer"
                >
                  إدارة منصة المستأجرين (Mureeh Admin)
                </button>
              )}
            </Reveal>
            <Reveal delay={340}>
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 text-[11px] sm:text-xs font-bold text-slate-300">
                {['تفعيل خلال دقائق', 'بدون عقود إجبارية', 'إلغاء في أي وقت'].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    {t}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>

          {/* visual */}
          <Reveal delay={200} className="relative flex justify-center">
            <div className="relative">
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[330px] h-[330px] sm:w-[400px] sm:h-[400px] rounded-full border border-dashed border-[#0072BC]/30 animate-saas-spin-slow pointer-events-none"
                aria-hidden="true"
              />
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[270px] h-[270px] rounded-full bg-[#0072BC]/20 blur-[90px] pointer-events-none"
                aria-hidden="true"
              />
              <div className="animate-saas-float">
                <PhoneMockup />
              </div>
              {/* floating cards */}
              <div className="absolute -right-4 sm:-right-14 top-10 animate-saas-float-delayed">
                <div className="flex items-center gap-2.5 rounded-2xl bg-[#081B33]/90 backdrop-blur border border-emerald-400/30 px-3.5 py-2.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]">
                  <span className="w-9 h-9 rounded-xl bg-emerald-400/15 border border-emerald-400/30 text-emerald-300 flex items-center justify-center">
                    <BellRing className="w-4 h-4" />
                  </span>
                  <span>
                    <span className="block text-[11px] font-black text-white">طلب جديد · طاولة 12</span>
                    <span className="block text-[10px] text-slate-400">قبل 8 ثوانٍ</span>
                  </span>
                </div>
              </div>
              <div className="absolute -left-4 sm:-left-12 bottom-16 animate-saas-float-slow">
                <div className="flex items-center gap-2.5 rounded-2xl bg-[#081B33]/90 backdrop-blur border border-[#0072BC]/40 px-3.5 py-2.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]">
                  <span className="w-9 h-9 rounded-xl bg-[#0072BC]/20 border border-[#0072BC]/40 text-[#38BDF8] flex items-center justify-center">
                    <Wallet className="w-4 h-4" />
                  </span>
                  <span>
                    <span className="block text-[11px] font-black text-white">تم تحصيل 184 ₪</span>
                    <span className="block text-[10px] text-slate-400">فاتورة RC-1042</span>
                  </span>
                </div>
              </div>
              <div className="absolute right-2 sm:-right-6 -bottom-2 animate-saas-float">
                <div className="flex items-center gap-2 rounded-full bg-[#040D1A]/90 backdrop-blur border border-[#38BDF8]/30 pl-4 pr-1.5 py-1.5 shadow-lg">
                  <span className="bg-white rounded-lg p-1">
                    <MiniQr size={30} />
                  </span>
                  <span className="text-[10px] font-black text-white">امسح واطلب</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        {/* stats */}
        <div className="max-w-6xl mx-auto relative z-10 mt-14 sm:mt-20">
          <Reveal>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {[
                { to: 50, suffix: '+', label: 'طاولة ذكية لكل مطعم' },
                { to: 3, suffix: '', label: 'ثوانٍ فقط لبدء الطلب' },
                { to: 24, suffix: '/7', label: 'دعم فني عبر واتساب' },
                { to: 100, suffix: '%', label: 'بدون تطبيق أو تسجيل' },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl bg-white/[0.03] border border-white/10 hover:border-[#0072BC]/50 px-4 py-5 text-center backdrop-blur transition-colors"
                >
                  <dd className="text-3xl sm:text-4xl font-black text-white tabular-nums">
                    <CountUp to={s.to} suffix={s.suffix} />
                  </dd>
                  <dt className="text-[11px] sm:text-xs text-slate-400 font-bold mt-1.5">{s.label}</dt>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      {/* ================= Marquee strip ================= */}
      <div
        className="relative border-y border-[#004B87]/40 bg-[#020A14] py-4 overflow-hidden saas-marquee-hover"
        dir="ltr"
        aria-hidden="true"
      >
        <div className="flex w-max animate-saas-marquee">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center gap-10 px-5">
              {MARQUEE_ITEMS.map((item) => (
                <span
                  key={`${copy}-${item}`}
                  dir="rtl"
                  className="inline-flex items-center gap-2.5 text-[13px] font-bold text-slate-300 whitespace-nowrap"
                >
                  <Sparkles className="w-4 h-4 text-[#38BDF8] shrink-0" />
                  {item}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#020A14] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#020A14] to-transparent" />
      </div>

      {/* ================= How it works ================= */}
      <section id="how" className="relative py-16 sm:py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="كيف يعمل النظام"
            title={<>ثلاث خطوات فقط… ومطعمك يعمل بذكاء</>}
            sub="بدون تعقيد تقني وبدون أجهزة خاصة — من لحظة التفعيل حتى أول طلب خلال دقائق."
          />
          <div className="relative grid md:grid-cols-3 gap-5">
            <div
              className="hidden md:block absolute top-14 right-[16%] left-[16%] border-t-2 border-dashed border-[#0072BC]/30 pointer-events-none"
              aria-hidden="true"
            />
            {STEPS.map((step, i) => (
              <Reveal key={step.num} delay={i * 120}>
                <div className="group relative h-full rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 hover:border-[#0072BC]/60 hover:bg-[#081B33] p-7 text-center space-y-4 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.45)]">
                  <span
                    className="absolute top-5 left-6 text-5xl font-black text-white/[0.06] select-none group-hover:text-[#0072BC]/15 transition-colors"
                    aria-hidden="true"
                  >
                    {step.num}
                  </span>
                  <div className="relative w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[#003865] to-[#0072BC] border border-[#38BDF8]/30 flex items-center justify-center text-white shadow-[0_0_28px_rgba(0,114,188,0.4)]">
                    <step.icon className="w-7 h-7" />
                    <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-[#38BDF8] text-[#020A14] text-xs font-black flex items-center justify-center shadow">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-white">{step.title}</h3>
                  <p className="text-[13px] text-slate-300 leading-relaxed">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= Bento features ================= */}
      <section id="features" className="relative py-16 sm:py-24 px-4 sm:px-6 bg-[#031326] border-y border-[#004B87]/30 overflow-hidden">
        <div className="absolute -bottom-40 right-1/3 w-[500px] h-[500px] rounded-full bg-[#0072BC]/10 blur-[140px] pointer-events-none" />
        <div className="max-w-6xl mx-auto relative z-10">
          <SectionHeading
            eyebrow="منظومة متكاملة"
            title={<>كل ما يحتاجه مطعمك… في مكان واحد</>}
            sub="ست ركائز ذكية تعمل معاً بتناغم لتغنيك عن عشرات البرامج والأجهزة المتفرقة."
          />
          <div className="grid md:grid-cols-3 gap-4 sm:gap-5">
            {/* KDS — wide card */}
            <Reveal className="md:col-span-2">
              <div className="group h-full rounded-3xl bg-gradient-to-br from-[#081B33] to-[#040D1A] border border-[#004B87]/40 hover:border-[#0072BC]/60 p-6 sm:p-8 transition-all duration-300 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.4)] overflow-hidden relative">
                <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-[#009FE3]/10 blur-[80px] pointer-events-none" />
                <div className="flex flex-col sm:flex-row sm:items-center gap-6 relative">
                  <div className="flex-1 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#0072BC]/15 border border-[#0072BC]/40 flex items-center justify-center text-[#38BDF8]">
                      <ChefHat className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-black text-white">شاشة مطبخ حيّة (KDS)</h3>
                    <p className="text-[13px] text-slate-300 leading-relaxed">
                      الطلبات تصل الشيف لحظياً مع تنبيه صوتي ومؤقت ملوّن لكل طلب — وقفل تلقائي
                      للتعديل بعد بدء التحضير لمنع الهدر والخلافات.
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0" dir="rtl">
                    {[
                      { t: 'طاولة 12', time: '02:14', tone: 'border-emerald-400/40 text-emerald-300' },
                      { t: 'طاولة 05', time: '09:41', tone: 'border-amber-400/40 text-amber-300' },
                      { t: 'طاولة 21', time: '14:02', tone: 'border-[#38BDF8]/40 text-[#38BDF8]' },
                    ].map((c) => (
                      <div
                        key={c.t}
                        className={`rounded-xl bg-[#040D1A] border ${c.tone} px-3 py-2.5 text-center min-w-[74px] group-hover:-translate-y-1 transition-transform duration-300`}
                      >
                        <p className="text-[10px] font-black text-white">{c.t}</p>
                        <p className={`text-xs font-black font-mono tabular-nums mt-0.5 ${c.tone.split(' ')[1]}`} dir="ltr">
                          {c.time}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Reveal>

            {/* QR ordering */}
            <Reveal delay={100}>
              <div className="group h-full rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 hover:border-[#0072BC]/60 p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.4)] space-y-4 text-center">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-[#0072BC]/15 border border-[#0072BC]/40 flex items-center justify-center text-[#38BDF8]">
                  <QrCode className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-white">طلب ذكي بدون تسجيل</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  يمسح الزبون الرمز ويطلب فوراً — بدون تطبيق وبدون حساب، مع تخصيص كامل للوجبة.
                </p>
                <div className="flex justify-center pt-1">
                  <span className="bg-white rounded-2xl p-2.5 shadow-[0_0_30px_rgba(56,189,248,0.25)] group-hover:scale-105 transition-transform">
                    <MiniQr size={72} />
                  </span>
                </div>
              </div>
            </Reveal>

            {/* Analytics */}
            <Reveal>
              <div className="group h-full rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 hover:border-[#0072BC]/60 p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.4)] space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
                  <BarChart3 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-white">تحليلات ترفع أرباحك</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  مبيعات لحظية، متوسط قيمة الطلب، وساعات الذروة — قرارات مبنية على أرقام حقيقية.
                </p>
                <div className="flex items-end justify-center gap-1.5 h-16 pt-2" dir="ltr" aria-hidden="true">
                  {[30, 48, 38, 62, 52, 78, 64, 92, 70, 100].map((h, i) => (
                    <span
                      key={i}
                      className={`w-4 rounded-md ${i === 9 ? 'bg-emerald-400' : 'bg-gradient-to-t from-[#0072BC]/40 to-[#38BDF8]'}`}
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>
            </Reveal>

            {/* Branding */}
            <Reveal delay={100}>
              <div className="group h-full rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 hover:border-[#0072BC]/60 p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.4)] space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-[#009FE3]/10 border border-[#009FE3]/30 flex items-center justify-center text-[#38BDF8]">
                  <Palette className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-white">هوية مطعمك الكاملة</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  شعارك وألوانك وصورك — موقع يعكس فخامة مطعمك وكأنه صُمم خصيصاً لك.
                </p>
                <div className="flex items-center gap-2 pt-2" dir="ltr" aria-hidden="true">
                  {['#003865', '#0072BC', '#009FE3', '#38BDF8', '#E0F2FE'].map((c) => (
                    <span
                      key={c}
                      className="w-8 h-8 rounded-full border-2 border-white/20 shadow-lg group-hover:scale-110 transition-transform"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <span className="mr-auto text-[10px] font-black text-white bg-white/10 px-2.5 py-1.5 rounded-lg">
                    Aa عربي
                  </span>
                </div>
              </div>
            </Reveal>

            {/* Staff */}
            <Reveal delay={200}>
              <div className="group h-full rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 hover:border-[#0072BC]/60 p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.4)] space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-[#38BDF8]/10 border border-[#38BDF8]/30 flex items-center justify-center text-[#38BDF8]">
                  <Users className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-white">طاقم بصلاحيات ذكية</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  حسابات للنادل والشيف والكاشير بدخول سريع عبر PIN — كل موظف يرى ما يخصّه فقط.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {[
                    { role: 'نادل', pin: '•• 412' },
                    { role: 'شيف', pin: '•• 783' },
                    { role: 'كاشير', pin: '•• 256' },
                  ].map((r) => (
                    <span
                      key={r.role}
                      className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-200 bg-[#040D1A] border border-[#004B87]/50 rounded-full px-3 py-1.5"
                    >
                      {r.role}
                      <span className="font-mono text-[#38BDF8]" dir="ltr">{r.pin}</span>
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>

          {/* POS strip */}
          <Reveal delay={120}>
            <div className="mt-4 sm:mt-5 flex flex-col sm:flex-row items-center gap-4 rounded-3xl bg-gradient-to-l from-[#003865]/50 via-[#081B33] to-[#081B33] border border-[#0072BC]/30 p-6 sm:px-8">
              <span className="w-12 h-12 shrink-0 rounded-2xl bg-[#0072BC]/20 border border-[#0072BC]/40 flex items-center justify-center text-[#38BDF8]">
                <Receipt className="w-6 h-6" />
              </span>
              <div className="flex-1 text-center sm:text-start">
                <h3 className="text-base sm:text-lg font-black text-white">
                  نقطة بيع وفواتير وتقارير — كلها مترابطة تلقائياً
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  فواتير مرقمة، مشاركة عبر واتساب، وتصدير CSV — من الكاشير إلى التقارير بدون خطوة يدوية.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0" dir="ltr" aria-hidden="true">
                <span className="text-[10px] font-black text-emerald-300 bg-emerald-400/10 border border-emerald-400/30 px-3 py-1.5 rounded-lg">
                  CSV ✓
                </span>
                <span className="text-[10px] font-black text-[#38BDF8] bg-[#0072BC]/15 border border-[#0072BC]/40 px-3 py-1.5 rounded-lg">
                  RC-1042
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ================= Explainer video ================= */}
      <section id="video" className="relative py-16 sm:py-24 px-4 sm:px-6 overflow-hidden">
        <div className="absolute top-10 right-[12%] w-[420px] h-[420px] rounded-full bg-[#0072BC]/12 blur-[140px] pointer-events-none" />
        <div className="max-w-5xl mx-auto relative z-10">
          <SectionHeading
            eyebrow="شاهد المنصة تعمل"
            title={<>أربعون ثانية تختصر يوم عمل كامل</>}
            sub="من مسح رمز QR على الطاولة حتى تقرير الإيراد في لوحة المدير — جولة داخل النظام نفسه."
          />
          <Reveal>
            <DemoVideoPlayer />
          </Reveal>
        </div>
      </section>

      {/* ================= Live showcase tabs ================= */}
      <section id="showcase" className="relative py-16 sm:py-24 px-4 sm:px-6 overflow-hidden">
        <div className="absolute top-0 left-[10%] w-[420px] h-[420px] rounded-full bg-[#0072BC]/10 blur-[130px] pointer-events-none" />
        <div className="max-w-6xl mx-auto relative z-10">
          <SectionHeading
            eyebrow="جولة حيّة داخل النظام"
            title={<>ثلاث شاشات… عقل واحد ذكي</>}
            sub="تنقّل بين تجربة الزبون وشاشة المطبخ ولوحة المدير — وشاهد كيف يتكامل كل شيء لحظياً."
          />

          {/* tab bar */}
          <Reveal className="flex justify-center mb-8 sm:mb-12">
            <div
              className="inline-flex items-center gap-1 p-1.5 rounded-2xl bg-[#081B33] border border-[#004B87]/60 max-w-full overflow-x-auto no-scrollbar"
              role="tablist"
              aria-label="شاشات النظام"
            >
              {SHOWCASE_TABS.map((t, i) => {
                const isActive = tab === i;
                return (
                  <button
                    key={t.label}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => selectTab(i)}
                    className={`relative px-4 sm:px-7 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                      isActive ? 'text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute inset-0 bg-gradient-to-l from-[#003865] to-[#0072BC] rounded-xl shadow-[0_0_20px_rgba(0,114,188,0.4)]" />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      <t.icon className="w-4 h-4" />
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </Reveal>

          {/* tab panel */}
          <div
            key={tab}
            className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center animate-saas-pop"
            role="tabpanel"
          >
            <div className="space-y-5 text-center lg:text-start order-2 lg:order-1">
              <div>
                <h3 className="text-xl sm:text-3xl font-black text-white">{activeTab.title}</h3>
                <p className="text-sm text-slate-300 mt-2 leading-relaxed">{activeTab.desc}</p>
              </div>
              <ul className="space-y-3">
                {activeTab.bullets.map((b) => (
                  <li key={b} className="flex items-center justify-center lg:justify-start gap-2.5 text-sm text-slate-200">
                    <span className="w-6 h-6 rounded-full bg-[#0072BC]/20 border border-[#0072BC]/40 text-[#38BDF8] flex items-center justify-center shrink-0">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                    <span className="font-bold">{b}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-center lg:justify-start gap-2 pt-2" dir="ltr">
                {SHOWCASE_TABS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => selectTab(i)}
                    aria-label={`عرض ${SHOWCASE_TABS[i]!.label}`}
                    className={`h-1.5 rounded-full transition-all cursor-pointer ${
                      tab === i ? 'w-8 bg-[#38BDF8]' : 'w-3 bg-white/15 hover:bg-white/30'
                    }`}
                  />
                ))}
              </div>
            </div>
            <div className="order-1 lg:order-2">
              {activeTab.label === 'هاتف الزبون' ? (
                <div className="relative flex justify-center py-4">
                  <div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-[#0072BC]/25 blur-[100px] pointer-events-none"
                    aria-hidden="true"
                  />
                  <activeTab.Mock />
                </div>
              ) : (
                <activeTab.Mock className="max-w-xl mx-auto" />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ================= ROI calculator ================= */}
      <section id="roi" className="relative py-16 sm:py-24 px-4 sm:px-6 bg-[#031326] border-y border-[#004B87]/30 overflow-hidden">
        <div className="absolute inset-0 saas-grid-bg saas-fade-radial pointer-events-none opacity-60" />
        <div className="absolute -top-32 left-1/4 w-[420px] h-[420px] rounded-full bg-emerald-500/10 blur-[130px] pointer-events-none" />
        <div className="max-w-5xl mx-auto relative z-10">
          <SectionHeading
            eyebrow="حاسبة العائد على الاستثمار"
            title={<>كم ستربح مع مُريح؟</>}
            sub="حرّك المؤشر حسب عدد طاولاتك وشاهد التوفير والزيادة المتوقعة شهرياً — بالأرقام."
          />
          <Reveal>
            <div className="rounded-[2rem] bg-gradient-to-br from-[#081B33] to-[#040D1A] border border-[#0072BC]/40 shadow-[0_30px_80px_-30px_rgba(0,114,188,0.5)] overflow-hidden">
              <div className="h-1.5 w-full bg-gradient-to-l from-emerald-400 via-[#38BDF8] to-[#0072BC]" />
              <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-8 p-6 sm:p-10">
                {/* controls */}
                <div className="space-y-6">
                  <div className="text-center lg:text-start">
                    <p className="text-xs font-bold text-slate-400">عدد الطاولات في مطعمك</p>
                    <p className="mt-1 text-5xl font-black text-white tabular-nums">
                      {tablesInput}
                      <span className="text-base font-bold text-slate-400 mr-2">طاولة</span>
                    </p>
                  </div>
                  <div>
                    <input
                      type="range"
                      min={5}
                      max={100}
                      step={5}
                      value={tablesInput}
                      onChange={(e) => setTablesInput(Number(e.target.value))}
                      className="saas-range"
                      style={{
                        background: `linear-gradient(to left, #009FE3 0%, #0072BC ${sliderPct}%, #0B2545 ${sliderPct}%)`,
                      }}
                      aria-label="عدد الطاولات"
                    />
                    <div className="flex justify-between mt-2 text-[11px] font-bold text-slate-500 tabular-nums">
                      <span>100</span>
                      <span>5</span>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-[#040D1A]/70 border border-[#004B87]/40 p-4 flex items-center gap-3">
                    <span className="w-10 h-10 shrink-0 rounded-xl bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5" />
                    </span>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      تشمل الحسبة: توفير الطباعة والعمالة + رفع متوسط الطلب عبر الإضافات + تسريع
                      تدوير الطاولات.
                    </p>
                  </div>
                </div>
                {/* results */}
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-[#040D1A] border border-emerald-400/30 p-5 text-center space-y-1.5 relative overflow-hidden">
                      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-l from-transparent via-emerald-400/60 to-transparent" />
                      <p className="text-[11px] font-bold text-slate-400">توفير التكاليف شهرياً</p>
                      <p className="text-2xl sm:text-3xl font-black text-emerald-400 tabular-nums">
                        <AnimatedNumber
                          value={estimatedStaffCostSaved}
                          format={(n) => formatPrice(Math.round(n))}
                        />
                      </p>
                      <p className="text-[10px] text-slate-500 font-bold">شهرياً / طباعة وعمالة</p>
                    </div>
                    <div className="rounded-2xl bg-[#040D1A] border border-[#0072BC]/40 p-5 text-center space-y-1.5 relative overflow-hidden">
                      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-l from-transparent via-[#38BDF8]/60 to-transparent" />
                      <p className="text-[11px] font-bold text-slate-400">زيادة المبيعات شهرياً</p>
                      <p className="text-2xl sm:text-3xl font-black text-[#38BDF8] tabular-nums">
                        +<AnimatedNumber
                          value={estimatedRevenueBoost}
                          format={(n) => formatPrice(Math.round(n))}
                        />
                      </p>
                      <p className="text-[10px] text-slate-500 font-bold">شهرياً / إضافات وتدوير</p>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-gradient-to-l from-[#003865]/60 to-[#0072BC]/20 border border-[#0072BC]/40 p-5 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="text-center sm:text-start">
                      <p className="text-[11px] font-bold text-slate-300">إجمالي العائد السنوي المتوقع</p>
                      <p className="text-3xl font-black text-white tabular-nums mt-1">
                        <AnimatedNumber
                          value={(estimatedStaffCostSaved + estimatedRevenueBoost) * 12}
                          format={(n) => formatPrice(Math.round(n))}
                        />
                      </p>
                    </div>
                    <button
                      onClick={() => handleContactTelegram('استشارة باقة')}
                      className="btn-shine shrink-0 px-6 py-3.5 rounded-xl bg-gradient-to-l from-[#003865] via-[#0072BC] to-[#009FE3] hover:brightness-110 text-white text-xs font-black shadow-[0_0_26px_rgba(0,114,188,0.45)] flex items-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                    >
                      استشر خبير مُريح مجاناً
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 text-center">
                    * أرقام تقديرية مبنية على متوسطات مطاعم مشابهة — تواصل معنا لحسبة دقيقة لمطعمك.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ================= Pricing ================= */}
      <section id="pricing" className="relative overflow-hidden py-16 sm:py-24 px-4 sm:px-6">
        <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[560px] h-[320px] rounded-full bg-[#0072BC]/10 blur-3xl pointer-events-none" />
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center space-y-4 mb-12">
            <Reveal>
              <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#081B33] border border-[#0072BC]/40 shadow-lg shadow-[#0072BC]/20">
                <BrandMark size={24} />
                <BrandWordmark size={15} subtitle="Pricing" />
                <span className="text-[9px] font-bold tracking-[0.2em] text-[#38BDF8] uppercase border-r border-[#004B87] pr-2.5">
                  MUREEH · SaaS
                </span>
              </div>
            </Reveal>
            <SectionHeading
              eyebrow="باقات الاشتراك"
              title={<>باقة لكل مرحلة من نموّك</>}
              sub="ابدأ بإطلاق منيو رقمي احترافي خلال دقائق، وطوّر باقتك كلما كبر مطعمك — بدون رسوم خفية وبدون عقود إجبارية."
            />
            {/* billing toggle */}
            <Reveal className="flex justify-center">
              <div className="inline-flex items-center gap-1 p-1.5 rounded-2xl bg-[#081B33] border border-[#004B87]/60">
                {(['monthly', 'yearly'] as const).map((period) => {
                  const isActive = billingPeriod === period;
                  return (
                    <button
                      key={period}
                      onClick={() => setBillingPeriod(period)}
                      aria-pressed={isActive}
                      className={`relative px-5 sm:px-7 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        isActive ? 'text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute inset-0 bg-gradient-to-l from-[#003865] to-[#0072BC] rounded-xl shadow-md" />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        {period === 'monthly' ? (
                          <CalendarRange className="w-3.5 h-3.5" />
                        ) : (
                          <BadgeCheck className="w-3.5 h-3.5" />
                        )}
                        {period === 'monthly' ? 'الدفع الشهري' : 'الدفع السنوي'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Reveal>
            {billingPeriod === 'yearly' && (
              <p className="text-[11px] text-emerald-400 font-bold flex items-center justify-center gap-1.5 animate-saas-pop">
                <BadgeCheck className="w-3.5 h-3.5" />
                اخترت الدفع السنوي — وفّرت شهرين كاملين (~17%) على باقتك
              </p>
            )}
          </div>

          {/* plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 items-stretch">
            {PLANS.map((plan, i) => {
              const Icon = plan.icon;
              const isPro = plan.id === 'pro';
              const price =
                billingPeriod === 'monthly' ? plan.priceMonthly : plan.priceYearlyPerMonth;

              const card = (
                <div
                  className={`h-full rounded-[1.65rem] overflow-hidden flex flex-col ${
                    isPro
                      ? 'bg-gradient-to-b from-[#0B2545] via-[#081B33] to-[#040D1A]'
                      : 'bg-[#081B33]/80'
                  }`}
                >
                  <div
                    className={`h-1.5 w-full ${
                      isPro
                        ? 'bg-gradient-to-l from-[#38BDF8] via-[#0072BC] to-[#003865]'
                        : 'bg-gradient-to-l from-[#003865] to-[#004B87]'
                    }`}
                  />
                  <div className="p-6 sm:p-7 flex flex-col flex-1">
                    <div className="flex items-center justify-between mb-5">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                          isPro
                            ? 'bg-[#0072BC]/20 border border-[#0072BC]/50 text-[#38BDF8] shadow-[0_0_20px_rgba(0,114,188,0.35)]'
                            : 'bg-[#003865]/30 border border-[#004B87]/40 text-[#38BDF8]'
                        }`}
                      >
                        <Icon className="w-6 h-6" />
                      </div>
                      {isPro && (
                        <span className="text-[10px] font-bold text-[#38BDF8] bg-[#040D1A] border border-[#004B87] px-2.5 py-1 rounded-full">
                          منصة مريح للخدمات
                        </span>
                      )}
                    </div>

                    <h3 className="text-xl font-black text-white">{plan.name}</h3>
                    <p className="text-xs text-slate-400 mt-1 mb-5 leading-relaxed">{plan.tagline}</p>

                    <div className="flex items-end gap-1.5 mb-1">
                      <span
                        className={`text-4xl font-black tabular-nums ${
                          isPro ? 'text-[#38BDF8]' : 'text-white'
                        }`}
                      >
                        {price}
                      </span>
                      <span className="text-xs text-slate-400 mb-1.5">₪ / شهرياً</span>
                    </div>
                    <div className="min-h-4 mb-5">
                      {billingPeriod === 'yearly' ? (
                        <span className="text-[10px] text-emerald-400 font-bold">
                          تُدفع سنوياً: {plan.priceYearly} ₪ — وفّرت{' '}
                          {plan.priceMonthly * 12 - plan.priceYearly} ₪
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">
                          يمكن الترقية أو الإلغاء في أي وقت
                        </span>
                      )}
                    </div>

                    <ul className="space-y-2.5 text-xs mb-5">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 leading-relaxed">
                          <span
                            className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                              isPro
                                ? 'bg-[#0072BC]/25 text-[#38BDF8]'
                                : 'bg-emerald-500/15 text-emerald-400'
                            }`}
                          >
                            <Check className="w-2.5 h-2.5" />
                          </span>
                          <span className="text-slate-300">{feature}</span>
                        </li>
                      ))}
                    </ul>

                     <div className="mt-auto pt-2">
                       <button
                         onClick={() => handleContactTelegram(plan.name)}
                         className={`w-full py-3.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] ${
                           isPro
                             ? 'btn-shine bg-gradient-to-l from-[#003865] via-[#0072BC] to-[#009FE3] text-white shadow-[0_0_26px_rgba(0,114,188,0.45)] hover:brightness-110'
                             : 'bg-[#003865]/60 hover:bg-[#003865] text-white border border-[#0072BC]/40'
                         }`}
                       >
                         {plan.cta}
                         <ArrowLeft className="w-3.5 h-3.5" />
                       </button>
                     </div>
                  </div>
                </div>
              );

              return (
                <Reveal key={plan.id} delay={i * 110} className="h-full">
                  {isPro ? (
                    <div className="relative h-full rounded-[1.75rem] p-[1.5px] bg-gradient-to-b from-[#38BDF8] via-[#0072BC] to-[#003865] shadow-[0_0_60px_-12px_rgba(0,114,188,0.55)] lg:-translate-y-4">
                      <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full bg-gradient-to-l from-[#004B87] via-[#0072BC] to-[#009FE3] text-white text-[10px] font-black flex items-center gap-1.5 shadow-[0_0_24px_rgba(0,114,188,0.5)] whitespace-nowrap">
                        <Crown className="w-3 h-3 text-amber-300" />
                        الأكثر طلباً للمطاعم الفاخرة
                      </span>
                      {card}
                    </div>
                  ) : (
                    <div className="h-full rounded-[1.75rem] border border-[#004B87]/50 hover:border-[#0072BC]/60 transition-colors">
                      {card}
                    </div>
                  )}
                </Reveal>
              );
            })}
          </div>

          {/* trust strip */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-4xl mx-auto">
            {[
              {
                icon: Lock,
                title: 'عزل تام لبيانات مطعمك',
                desc: 'كل مستأجر يعمل في قاعدة بيانات معزولة؛ لا يرى عملاؤك سوى منيو مطعمك.',
              },
              {
                icon: ShieldCheck,
                title: 'أمان مصرفي من مريح',
                desc: 'تشفير Bcrypt لكلمات المرور و JWT لكل جلسة، مع سجل تدقيق كامل.',
              },
              {
                icon: Clock,
                title: 'تفعيل خلال دقائق',
                desc: 'منصة جاهزة تعمل فوراً — بدون تعقيد تقني أو عقود طويلة.',
              },
            ].map((item, i) => (
              <Reveal key={item.title} delay={i * 100}>
                <div className="h-full flex items-start gap-3 p-4 rounded-2xl bg-[#081B33]/60 border border-[#004B87]/50">
                  <span className="w-9 h-9 rounded-xl bg-[#0072BC]/15 border border-[#0072BC]/30 text-[#38BDF8] flex items-center justify-center shrink-0">
                    <item.icon className="w-5 h-5" />
                  </span>
                  <div>
                    <div className="text-xs font-bold text-white">{item.title}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{item.desc}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= Testimonials ================= */}
      <section className="relative py-16 sm:py-24 px-4 sm:px-6 bg-[#031326] border-y border-[#004B87]/30 overflow-hidden">
        <div className="absolute -bottom-32 right-[15%] w-[420px] h-[420px] rounded-full bg-[#0072BC]/10 blur-[130px] pointer-events-none" />
        <div className="max-w-6xl mx-auto relative z-10">
          <SectionHeading
            eyebrow="آراء عملائنا"
            title={<>مطاعم وثقت بمُريح… ونمت معه</>}
            sub="قصص حقيقية من أصحاب مطاعم ومقاهٍ حوّلوا طاولاتهم إلى منظومة رقمية متكاملة."
          />
          <div className="grid md:grid-cols-3 gap-4 sm:gap-5">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 110}>
                <figure className="relative h-full rounded-3xl bg-[#081B33]/60 border border-[#004B87]/40 hover:border-[#0072BC]/50 p-6 sm:p-7 flex flex-col gap-4 transition-all duration-300 hover:-translate-y-1">
                  <Quote
                    className="absolute top-5 left-5 w-8 h-8 text-[#0072BC]/25"
                    aria-hidden="true"
                  />
                  <div className="flex gap-1" dir="ltr" aria-label="تقييم 5 من 5">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <Star key={s} className="w-4 h-4 fill-amber-300 text-amber-300" />
                    ))}
                  </div>
                  <blockquote className="text-[13px] text-slate-200 leading-relaxed flex-1">
                    «{t.quote}»
                  </blockquote>
                  <figcaption className="flex items-center gap-3 pt-4 border-t border-[#004B87]/40">
                    <span
                      className={`w-11 h-11 rounded-full bg-gradient-to-br ${t.tint} flex items-center justify-center text-white font-black text-base shrink-0`}
                    >
                      {t.initial}
                    </span>
                    <span>
                      <span className="block text-sm font-black text-white">{t.name}</span>
                      <span className="block text-[11px] text-slate-400">{t.role}</span>
                    </span>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= FAQ ================= */}
      <section id="faq" className="relative py-16 sm:py-24 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto">
          <SectionHeading
            eyebrow="الأسئلة الشائعة"
            title={<>كل ما تريد معرفته</>}
            sub="إجابات سريعة عن أكثر ما يسألنا عنه أصحاب المطاعم — ولأي سؤال آخر نحن على واتساب."
          />
          <div className="space-y-2.5">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <Reveal key={f.q} delay={Math.min(i * 60, 240)}>
                  <div
                    className={`rounded-2xl border transition-all duration-300 ${
                      open
                        ? 'border-[#0072BC]/60 bg-[#081B33] shadow-[0_16px_40px_-20px_rgba(0,114,188,0.5)]'
                        : 'border-[#004B87]/40 bg-[#081B33]/50 hover:border-[#0072BC]/40'
                    }`}
                  >
                    <button
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-3 px-5 py-4 text-start cursor-pointer"
                    >
                      <span className="text-sm font-bold text-white">{f.q}</span>
                      <span
                        className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-all duration-300 ${
                          open
                            ? 'rotate-45 bg-[#0072BC] text-white'
                            : 'bg-[#0072BC]/15 text-[#38BDF8]'
                        }`}
                      >
                        <Plus className="w-4 h-4" />
                      </span>
                    </button>
                    <div
                      className={`grid transition-all duration-300 ${
                        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <p className="px-5 pb-5 text-[13px] text-slate-300 leading-relaxed">{f.a}</p>
                      </div>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================= Final CTA ================= */}
      <section className="relative pb-16 sm:pb-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] border border-[#0072BC]/40 bg-gradient-to-br from-[#06203F] via-[#04142B] to-[#020A14] px-6 py-12 sm:p-14 text-center">
              <div className="absolute inset-0 saas-grid-bg saas-fade-radial pointer-events-none opacity-70" />
              <div className="absolute -top-24 right-1/4 w-96 h-96 rounded-full bg-[#0072BC]/25 blur-[110px] pointer-events-none animate-saas-drift-a" />
              <div className="absolute -bottom-28 left-1/4 w-96 h-96 rounded-full bg-[#009FE3]/15 blur-[110px] pointer-events-none animate-saas-drift-b" />
              <div className="relative z-10 space-y-5">
                <BrandMark size={56} className="mx-auto" />
                <h2 className="text-2xl sm:text-4xl font-black text-white leading-snug text-balance">
                  جاهز تحوّل مطعمك إلى{' '}
                  <span className="bg-gradient-to-l from-white via-[#7DD3FC] to-[#009FE3] bg-clip-text text-transparent">
                    تجربة رقمية كاملة؟
                  </span>
                </h2>
                <p className="text-sm sm:text-base text-slate-300 max-w-xl mx-auto leading-relaxed">
                  انضم إلى المطاعم التي تدير طاولاتها ومطبخها وكاشيرها من منظومة واحدة.
                  التفعيل خلال دقائق — والدعم معك خطوة بخطوة.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => handleContactTelegram('تواصل عام')}
                    className="btn-shine w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-l from-[#003865] via-[#0072BC] to-[#009FE3] hover:brightness-110 text-white font-bold text-sm shadow-[0_0_36px_rgba(0,114,188,0.5)] flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <MessageSquare className="w-4 h-4" />
                    تحدث مع المبيعات
                  </button>
                  <button
                    onClick={openManagerConsole}
                    className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/15 text-white font-bold text-sm transition-all cursor-pointer backdrop-blur"
                  >
                    ادخل لوحة التحكم
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] font-bold text-slate-400 pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-[#38BDF8]" />
                    بدون بطاقة ائتمانية
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    إلغاء في أي وقت
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-[#38BDF8]" />
                    دعم بالعربية
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ================= Footer ================= */}
      <footer id="contact" className="border-t border-[#004B87]/40 bg-[#020A14] px-4 sm:px-6 pt-12 pb-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 pb-10 border-b border-[#004B87]/30">
            <div className="space-y-4">
              <BrandLogo size={40} subtitle="MUREEH OS" />
              <p className="text-xs text-slate-400 leading-relaxed">
                منصة مُريح للخدمات الإلكترونية — منظومة سحابية متكاملة لإدارة المطاعم والمقاهي:
                منيو QR، شاشة مطبخ، ونقطة بيع في مكان واحد.
              </p>
              <button
                onClick={() => handleContactTelegram('تواصل عام')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-xs font-bold transition-all cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>تليجرام: </span>
                <span className="font-mono" dir="ltr">+972 599 891 559</span>
              </button>
            </div>
            <nav aria-label="روابط سريعة">
              <h4 className="text-sm font-black text-white mb-4">روابط سريعة</h4>
              <ul className="space-y-2.5 text-xs font-bold text-slate-400">
                {NAV_LINKS.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className="hover:text-[#38BDF8] transition-colors">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="الباقات">
              <h4 className="text-sm font-black text-white mb-4">الباقات</h4>
              <ul className="space-y-2.5 text-xs font-bold text-slate-400">
                {PLANS.map((p) => (
                  <li key={p.id}>
                    <a href="#pricing" className="hover:text-[#38BDF8] transition-colors">
                      {p.name} — {p.priceMonthly} ₪/شهرياً
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div>
              <h4 className="text-sm font-black text-white mb-4">تواصل معنا</h4>
              <ul className="space-y-2.5 text-xs font-bold text-slate-400">
                <li className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-[#38BDF8]" />
                  تليجرام:{' '}
                  <a href="https://t.me/+972599891559" target="_blank" rel="noopener noreferrer" className="font-mono text-slate-300 hover:text-sky-400" dir="ltr">
                    +972 599 891 559
                  </a>
                </li>
                <li className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-[#38BDF8]" />
                  دعم فني يومي في أوقات العمل
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#38BDF8]" />
                  منصة سحابية آمنة متعددة المستأجرين
                </li>
              </ul>
            </div>
          </div>
          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-slate-500">
            <p>© 2026 منصة مريح للخدمات الإلكترونية (MUREEH) — جميع الحقوق محفوظة</p>
            <p>إحدى خدمات منصة مريح الإلكترونية · صُنع بشغف للمطاعم العربية</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
