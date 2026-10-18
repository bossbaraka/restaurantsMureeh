import { useEffect, useState, type FC } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { BrandMark } from '../brand/BrandLogo';
import { useAuth } from '../../context/AuthContext';
import { Reveal, SectionHeading } from './landing/primitives';
import { KdsMockup, ManagerMockup, MiniQr, PhoneMockup } from './landing/mockups';
import { LAUNCH_OFFER, PLAN_PRICING, getDisplayedPlanPrice, getPlanDiscountPercent, isLaunchOfferActive } from '../../../shared/plan-pricing';
import { buildMureehWhatsAppUrl, MUREEH_WHATSAPP_DISPLAY } from '../../../shared/mureeh-contact';
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
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
  Receipt,
  Rocket,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';

/* ============================== Data ============================== */

type PlanKey = keyof typeof PLAN_PRICING;

type PlanDef = {
  id: PlanKey;
  name: string;
  tagline: string;
  pricing: (typeof PLAN_PRICING)[PlanKey];
  limits: string;
  features: string[];
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
};

const PLANS: PlanDef[] = [
  {
    id: 'starter',
    name: 'الباقة الأساسية',
    tagline: 'للمطاعم والكافيهات الواعدة',
    pricing: PLAN_PRICING.starter,
    limits: 'حتى 20 طاولة و35 صنفاً — فرع واحد',
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
    pricing: PLAN_PRICING.pro,
    limits: 'حتى 50 طاولة و150 صنفاً — 3 فروع',
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
    pricing: PLAN_PRICING.enterprise,
    limits: 'حتى 10 فروع و200 طاولة و500 صنف',
    features: [
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
  { href: '#showcase', label: 'جولة حيّة' },
  { href: '#launch-now', label: 'دشّن مطعمك الآن' },
  { href: '#pricing', label: 'الباقات' },
  { href: '#faq', label: 'الأسئلة الشائعة' },
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
    title: 'طلبات واضحة للمطبخ',
    desc: 'شاشة عرض ذكية للمطبخ تساعد الفريق على متابعة الطلبات وترتيب العمل بوضوح.',
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
    title: 'إدارة المطعم من لوحة واحدة',
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

const FAQS = [
  {
    q: 'هل يمكنني تغيير باقتي لاحقاً؟',
    a: 'نعم — من لوحة تحكم مطعمك (الباقة والاشتراك) يمكنك الترقية أو التخفيض فورياً، ويُطبق الفرق تلقائياً على اشتراكك بدون أي تعقيد.',
  },
  {
    q: 'إلى متى يستمر عرض الإطلاق؟',
    a: `عرض الإطلاق للمشتركين الجدد متاح حتى ${LAUNCH_OFFER.endsAtLabelAr}. بعد انتهاء المدة يعود السعر إلى السعر المعتاد الظاهر على الباقة.`,
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
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [tab, setTab] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [pricingNow, setPricingNow] = useState(() => Date.now());

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Repaint exactly at campaign start/end so an open landing tab never keeps
  // displaying a price after the advertised window has expired.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const syncToNextBoundary = () => {
      const now = Date.now();
      setPricingNow(now);
      const nextBoundary = [Date.parse(LAUNCH_OFFER.startsAt), Date.parse(LAUNCH_OFFER.endsAt)]
        .filter((time) => time > now)
        .sort((a, b) => a - b)[0];
      if (nextBoundary !== undefined) {
        timer = setTimeout(syncToNextBoundary, nextBoundary - now + 50);
      }
    };
    syncToNextBoundary();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  const handleContactWhatsApp = (topic: string = 'الاحترافية') => {
    const message = `مرحباً، أود التحدث مع فريق مريح بشأن ${topic}.`;
    window.open(buildMureehWhatsAppUrl(message), '_blank', 'noopener,noreferrer');
  };

  const openManagerConsole = () => {
    if (currentUser) {
      setViewMode('MANAGER');
    } else {
      setIsLoginModalOpen(true);
    }
  };

  const handleLaunchRestaurantNow = () => {
    setMenuOpen(false);
    setViewMode('ONBOARDING');
  };

  const selectTab = (i: number) => {
    setTab(i);
  };

  const activeTab = SHOWCASE_TABS[tab] ?? SHOWCASE_TABS[0]!;
  const isOfferActive = isLaunchOfferActive(pricingNow);

  return (
    <div
      id="top"
      dir="rtl"
      className="min-h-screen bg-[#F7F6F1] text-[#1D3548] font-sans overflow-x-clip selection:bg-[#0072BC]/25 selection:text-[#003865]"
    >
      {/* ================= Sticky glass navbar ================= */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-[#F7F6F1]/85 backdrop-blur-xl border-b border-[#004B87]/40 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.8)]'
            : 'bg-transparent border-b border-transparent'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-[72px] flex items-center justify-between gap-4">
          <nav className="hidden lg:flex items-center gap-1 text-[13px] font-bold text-[#536879]">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="px-3.5 py-2 rounded-xl hover:text-[#003865] hover:bg-white/85 transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="hidden lg:flex items-center gap-2.5">
            <button
              onClick={() => handleContactWhatsApp('تواصل عام')}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 text-emerald-800 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              واتساب مريح
            </button>
            <button
              onClick={handleLaunchRestaurantNow}
              className="btn-shine px-4 py-2.5 rounded-xl bg-gradient-to-l from-[#003865] via-[#00649C] to-[#0072BC] hover:brightness-110 text-white text-xs font-bold shadow-[0_0_24px_rgba(0,114,188,0.4)] transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Store className="w-3.5 h-3.5" />
              اضغط لتدشين مطعمك
            </button>
            <button
              onClick={openManagerConsole}
              className="px-3.5 py-2.5 rounded-xl bg-white/90 hover:bg-white border border-[#004B87]/35 text-[#003865] text-xs font-bold transition-all cursor-pointer"
            >
              دخول لوحة التحكم
            </button>
          </div>
          <button
            className="lg:hidden w-11 h-11 rounded-xl bg-[#FFFDF8] border border-[#004B87]/60 text-[#344D60] flex items-center justify-center cursor-pointer"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="فتح القائمة"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="lg:hidden border-t border-[#004B87]/40 bg-[#F7F6F1]/95 backdrop-blur-xl px-4 py-4 space-y-1 animate-fade-in">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2.5 rounded-xl text-sm font-bold text-[#344D60] hover:bg-white/85"
              >
                {l.label}
              </a>
            ))}
            <div className="flex flex-col gap-2 pt-3">
              <button
                onClick={handleLaunchRestaurantNow}
                className="w-full py-3 rounded-xl bg-gradient-to-l from-[#003865] via-[#00649C] to-[#0072BC] text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
              >
                <Store className="w-3.5 h-3.5" />
                اضغط لتدشين مطعمك (صفحة التدشين المستقلة)
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => handleContactWhatsApp('تواصل عام')}
                  className="flex-1 py-3 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-emerald-800 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  واتساب
                </button>
                <button
                  onClick={openManagerConsole}
                  className="flex-1 py-3 rounded-xl bg-white border border-[#004B87]/35 text-[#003865] text-xs font-bold cursor-pointer"
                >
                  دخول لوحة التحكم
                </button>
              </div>
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
          {/* Brand at the top of the landing hero: clear, unframed and readable. */}
          <Reveal className="lg:col-span-2 mb-1 flex justify-center">
            <div className="flex flex-col items-center text-center">
              <img
                src="/mureeh-bird.png"
                alt=""
                aria-hidden="true"
                width={219}
                height={204}
                fetchPriority="high"
                className="saas-bird-return h-[104px] w-[112px] object-contain drop-shadow-[0_10px_18px_rgba(0,114,188,0.2)] sm:h-[122px] sm:w-[132px]"
              />
              <img
                src="/mureeh-wordmark.png"
                alt="مُريح — MUREEH، منصة مريح للخدمات الإلكترونية"
                width={396}
                height={320}
                fetchPriority="high"
                className="-mt-2 h-auto w-[244px] object-contain sm:w-[280px]"
              />
            </div>
          </Reveal>
          {/* copy */}
          <div className="text-center lg:text-start space-y-6">
            <Reveal>
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#EAF2F6] border border-[#C7DCE7] text-[#004B87] text-xs font-bold shadow-[0_0_24px_rgba(0,114,188,0.35)] backdrop-blur-md">
                <Sparkles className="w-4 h-4" />
                منصة مُريح لإدارة المطاعم
              </span>
            </Reveal>
            <Reveal delay={90}>
              <h1 className="text-4xl sm:text-5xl xl:text-[3.6rem] font-black leading-[1.25] text-[#1D3548] text-balance">
                <span aria-hidden="true">
                  مطعمك كاملاً…
                  <br />
                  يُدار من{' '}
                  <span className="bg-gradient-to-l from-[#003865] via-[#00649C] to-[#0072BC] bg-clip-text text-transparent">
                    رمز QR واحد
                  </span>
                </span>
                <span className="sr-only">مطعمك كاملاً… يُدار من رمز QR واحد</span>
              </h1>
            </Reveal>
            <Reveal delay={180}>
              <p className="text-sm sm:text-lg text-[#536879] max-w-xl mx-auto lg:mx-0 leading-relaxed">
                منيو رقمي فاخر بدون تطبيق وبدون تسجيل، شاشة مطبخ حيّة، نداء نادل فوري،
                وتقارير مبيعات لحظية — منصة مُريح تربط الطلبات والمطبخ والإدارة في سير عمل واحد.
              </p>
            </Reveal>
            <Reveal delay={260}>
              <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center lg:justify-start gap-3">
                <button
                  onClick={handleLaunchRestaurantNow}
                  className="btn-shine w-full sm:w-auto px-7 py-4 rounded-2xl bg-gradient-to-l from-[#003865] via-[#00649C] to-[#0072BC] hover:brightness-110 text-white font-bold text-sm shadow-[0_0_36px_rgba(0,114,188,0.5)] flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                >
                  <Store className="w-4 h-4" />
                  اضغط لتدشين مطعمك
                </button>
                <button
                  onClick={() => handleContactWhatsApp('عرض توضيحي لمنصة مريح')}
                  className="w-full sm:w-auto px-6 py-4 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/35 text-emerald-900 font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Rocket className="w-4 h-4 text-emerald-700" />
                  اطلب عرضاً توضيحياً
                </button>
                <a
                  href="#how"
                  className="w-full sm:w-auto px-6 py-4 rounded-2xl bg-white/85 hover:bg-[#F0EFE9] border border-[#D8DFE2] text-[#1D3548] font-bold text-sm flex items-center justify-center gap-2 transition-all backdrop-blur"
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
                  className="mt-3 px-6 py-2.5 rounded-xl bg-[#FFFDF8] hover:bg-[#E7EEF1] border border-[#0072BC]/40 text-[#004B87] font-bold text-xs transition-all cursor-pointer"
                >
                  إدارة منصة المستأجرين (Mureeh Admin)
                </button>
              )}
            </Reveal>
            <Reveal delay={340}>
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 text-[11px] sm:text-xs font-bold text-[#536879]">
                {['تفعيل خلال دقائق', 'بدون عقود إجبارية', 'إلغاء في أي وقت'].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    {t}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>

          {/* Product preview remains visible alongside the brand identity. */}
          <Reveal delay={160} className="relative flex min-h-[300px] items-center justify-center sm:min-h-[390px]">
            <div
              className="pointer-events-none absolute h-64 w-64 rounded-full bg-[#0072BC]/10 blur-[90px] sm:h-80 sm:w-80"
              aria-hidden="true"
            />
            <PhoneMockup className="relative z-10" />
          </Reveal>
        </div>

        {/* Quick value summary */}
        <div className="max-w-6xl mx-auto relative z-10 mt-12 sm:mt-16">
          <Reveal>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { title: 'للزبون', detail: 'منيو وطلب عبر QR دون تطبيق' },
                { title: 'للمطبخ', detail: 'شاشة لمتابعة الطلبات وحالتها' },
                { title: 'للإدارة', detail: 'لوحة واحدة لإدارة العمليات' },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-[#004B87]/40 bg-[#FFFDF8]/75 px-4 py-4 text-center sm:text-right">
                  <dt className="text-xs font-extrabold text-[#004B87]">{item.title}</dt>
                  <dd className="mt-1 text-sm font-semibold text-[#344D60]">{item.detail}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

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
                <div className="group relative h-full rounded-3xl bg-[#FFFDF8]/60 border border-[#004B87]/40 hover:border-[#0072BC]/60 hover:bg-[#FFFDF8] p-7 text-center space-y-4 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.45)]">
                  <span
                    className="absolute top-5 left-6 text-5xl font-black text-[#003865]/[0.06] select-none group-hover:text-[#004B87]/15 transition-colors"
                    aria-hidden="true"
                  >
                    {step.num}
                  </span>
                  <div className="relative w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[#003865] to-[#0072BC] text-white border border-[#38BDF8]/30 flex items-center justify-center shadow-[0_0_28px_rgba(0,114,188,0.4)]">
                    <step.icon className="w-7 h-7" />
                    <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-[#38BDF8] text-[#003865] text-xs font-black flex items-center justify-center shadow">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-[#1D3548]">{step.title}</h3>
                  <p className="text-[13px] text-[#536879] leading-relaxed">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= Bento features ================= */}
      <section id="features" className="relative py-16 sm:py-24 px-4 sm:px-6 bg-[#EFEEE8] border-y border-[#004B87]/30 overflow-hidden">
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
              <div className="group h-full rounded-3xl bg-gradient-to-br from-[#FFFDF8] to-[#F7F6F1] border border-[#004B87]/40 hover:border-[#0072BC]/60 p-6 sm:p-8 transition-all duration-300 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.4)] overflow-hidden relative">
                <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-[#009FE3]/10 blur-[80px] pointer-events-none" />
                <div className="flex flex-col sm:flex-row sm:items-center gap-6 relative">
                  <div className="flex-1 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#0072BC]/15 border border-[#0072BC]/40 flex items-center justify-center text-[#004B87]">
                      <ChefHat className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-black text-[#1D3548]">شاشة مطبخ حيّة (KDS)</h3>
                    <p className="text-[13px] text-[#536879] leading-relaxed">
                      الطلبات تصل الشيف لحظياً مع تنبيه صوتي ومؤقت ملوّن لكل طلب — وقفل تلقائي
                      للتعديل بعد بدء التحضير لمنع الهدر والخلافات.
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0" dir="rtl">
                    {[
                      { t: 'طاولة 12', time: '02:14', tone: 'border-emerald-400/40 text-emerald-800' },
                      { t: 'طاولة 05', time: '09:41', tone: 'border-amber-400/40 text-amber-800' },
                      { t: 'طاولة 21', time: '14:02', tone: 'border-[#38BDF8]/40 text-[#004B87]' },
                    ].map((c) => (
                      <div
                        key={c.t}
                        className={`rounded-xl bg-[#F7F6F1] border ${c.tone} px-3 py-2.5 text-center min-w-[74px] group-hover:-translate-y-1 transition-transform duration-300`}
                      >
                        <p className="text-[10px] font-black text-[#1D3548]">{c.t}</p>
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
              <div className="group h-full rounded-3xl bg-[#FFFDF8]/60 border border-[#004B87]/40 hover:border-[#0072BC]/60 p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.4)] space-y-4 text-center">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-[#0072BC]/15 border border-[#0072BC]/40 flex items-center justify-center text-[#004B87]">
                  <QrCode className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-[#1D3548]">طلب ذكي بدون تسجيل</h3>
                <p className="text-xs text-[#536879] leading-relaxed">
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
              <div className="group h-full rounded-3xl bg-[#FFFDF8]/60 border border-[#004B87]/40 hover:border-[#0072BC]/60 p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.4)] space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center text-emerald-800">
                  <BarChart3 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-[#1D3548]">تحليلات ترفع أرباحك</h3>
                <p className="text-xs text-[#536879] leading-relaxed">
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
              <div className="group h-full rounded-3xl bg-[#FFFDF8]/60 border border-[#004B87]/40 hover:border-[#0072BC]/60 p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.4)] space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-[#009FE3]/10 border border-[#009FE3]/30 flex items-center justify-center text-[#004B87]">
                  <Palette className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-[#1D3548]">هوية مطعمك الكاملة</h3>
                <p className="text-xs text-[#536879] leading-relaxed">
                  شعارك وألوانك وصورك — موقع يعكس فخامة مطعمك وكأنه صُمم خصيصاً لك.
                </p>
                <div className="flex items-center gap-2 pt-2" dir="ltr" aria-hidden="true">
                  {['#003865', '#0072BC', '#009FE3', '#38BDF8', '#E0F2FE'].map((c) => (
                    <span
                      key={c}
                      className="w-8 h-8 rounded-full border-2 border-[#5B6871]/30 shadow-lg group-hover:scale-110 transition-transform"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <span className="mr-auto text-[10px] font-black text-[#1D3548] bg-[#E9E7E0] px-2.5 py-1.5 rounded-lg">
                    Aa عربي
                  </span>
                </div>
              </div>
            </Reveal>

            {/* Staff */}
            <Reveal delay={200}>
              <div className="group h-full rounded-3xl bg-[#FFFDF8]/60 border border-[#004B87]/40 hover:border-[#0072BC]/60 p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-20px_rgba(0,114,188,0.4)] space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-[#38BDF8]/10 border border-[#38BDF8]/30 flex items-center justify-center text-[#004B87]">
                  <Users className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-black text-[#1D3548]">طاقم بصلاحيات ذكية</h3>
                <p className="text-xs text-[#536879] leading-relaxed">
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
                      className="inline-flex items-center gap-2 text-[11px] font-bold text-[#344D60] bg-[#F7F6F1] border border-[#004B87]/50 rounded-full px-3 py-1.5"
                    >
                      {r.role}
                      <span className="font-mono text-[#004B87]" dir="ltr">{r.pin}</span>
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>

          {/* POS strip */}
          <Reveal delay={120}>
            <div className="mt-4 sm:mt-5 flex flex-col sm:flex-row items-center gap-4 rounded-3xl bg-[#EAF2F6] border border-[#0072BC]/30 p-6 sm:px-8">
              <span className="w-12 h-12 shrink-0 rounded-2xl bg-[#0072BC]/20 border border-[#0072BC]/40 flex items-center justify-center text-[#004B87]">
                <Receipt className="w-6 h-6" />
              </span>
              <div className="flex-1 text-center sm:text-start">
                <h3 className="text-base sm:text-lg font-black text-[#1D3548]">
                  نقطة بيع وفواتير وتقارير — كلها مترابطة تلقائياً
                </h3>
                <p className="text-xs text-[#536879] mt-1">
                  فواتير مرقمة، مشاركة عبر واتساب، وتصدير CSV — من الكاشير إلى التقارير بدون خطوة يدوية.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0" dir="ltr" aria-hidden="true">
                <span className="text-[10px] font-black text-emerald-800 bg-emerald-400/10 border border-emerald-400/30 px-3 py-1.5 rounded-lg">
                  CSV ✓
                </span>
                <span className="text-[10px] font-black text-[#004B87] bg-[#0072BC]/15 border border-[#0072BC]/40 px-3 py-1.5 rounded-lg">
                  RC-1042
                </span>
              </div>
            </div>
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
              className="inline-flex items-center gap-1 p-1.5 rounded-2xl bg-[#FFFDF8] border border-[#004B87]/60 max-w-full overflow-x-auto no-scrollbar"
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
                      isActive ? 'text-white' : 'text-[#5B6871] hover:text-[#003865]'
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
                <h3 className="text-xl sm:text-3xl font-black text-[#1D3548]">{activeTab.title}</h3>
                <p className="text-sm text-[#536879] mt-2 leading-relaxed">{activeTab.desc}</p>
              </div>
              <ul className="space-y-3">
                {activeTab.bullets.map((b) => (
                  <li key={b} className="flex items-center justify-center lg:justify-start gap-2.5 text-sm text-[#344D60]">
                    <span className="w-6 h-6 rounded-full bg-[#0072BC]/20 border border-[#0072BC]/40 text-[#004B87] flex items-center justify-center shrink-0">
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

      {/* ================= Official Launch & Verification Gate Menu ================= */}
      <section id="launch-now" className="relative overflow-hidden py-16 sm:py-24 px-4 sm:px-6 bg-gradient-to-b from-[#F7F6F1] via-[#EFECE4] to-[#F7F6F1] border-y border-[#004B87]/20">
        <div className="max-w-6xl mx-auto relative z-10">
          <SectionHeading
            eyebrow="استوديو التدشين والتحقق الرسمي"
            title={<>انطلاقتك الرقمية تبدأ الآن — مجاناً وبأناقة تليق بمطعمك!</>}
            sub="افتح حساب مالك مطعمك على الخطة المجانية الدائمة (حتى 20 طاولة مع رموز QR مستقلة لكل طاولة). صمّمنا لك استوديو تدشين تفاعلياً وبوابة تحقق ذكية تحمي اسم مطعمك وتجهّزه للعمل في دقائق."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {[
              {
                step: '01',
                icon: Users,
                title: 'حساب المالك المتألق',
                desc: 'سجّل اسمك وبريدك الرسمي في ثوانٍ — مع درع ذكي يحظر البريد الوهمي ليحافظ على رقيّ المنصة.',
              },
              {
                step: '02',
                icon: Store,
                title: 'هوية مطعمك الفريدة',
                desc: 'أدخل اسم مطعمك ورقم الجوال/واتساب الرسمي الفريد، وشاهد رابطك الرقمي يولد أمامك مباشرةً.',
              },
              {
                step: '03',
                icon: QrCode,
                title: 'صالتك الذكية برموز QR',
                desc: 'اختر 10 أو 15 أو 20 طاولة لنولّد لكل طاولة رمز QR مستقلاً جاهزاً للطباعة والمسح الفوري.',
              },
              {
                step: '04',
                icon: ShieldCheck,
                title: 'توثيق رسمي وانطلاق فوري',
                desc: 'يُعتمد مطعمك برقم مرجع رسمي (#MRH) عبر واتساب مريح أو رمز التفعيل من 6 أرقام لتنطلق بقوة!',
              },
            ].map((item, idx) => (
              <Reveal key={item.step} delay={idx * 80}>
                <div className="h-full rounded-2xl bg-[#FFFDF8] hover:bg-white border border-[#004B87]/35 hover:border-[#0072BC] p-5 shadow-sm hover:shadow-[0_18px_40px_-20px_rgba(0,114,188,0.45)] transition-all duration-300 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="w-10 h-10 rounded-xl bg-[#0072BC]/15 border border-[#0072BC]/30 text-[#004B87] flex items-center justify-center">
                        <item.icon className="w-5 h-5" />
                      </span>
                      <span className="text-xs font-black font-mono text-[#0072BC] bg-[#EAF2F6] px-2.5 py-1 rounded-lg">
                        خطوة {item.step}
                      </span>
                    </div>
                    <h3 className="text-base font-black text-[#1D3548] mb-1.5">{item.title}</h3>
                    <p className="text-xs text-[#536879] leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal>
            <div className="rounded-3xl bg-gradient-to-l from-[#003865] via-[#005288] to-[#0072BC] text-white p-6 sm:p-8 shadow-[0_20px_50px_-20px_rgba(0,114,188,0.55)] flex flex-col lg:flex-row items-center justify-between gap-6">
              <div className="space-y-2 text-center lg:text-right max-w-2xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-xs font-bold">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>الخطة المجانية الدائمة · استوديو تدشين تفاعلي مع معاينة حية</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black">
                  جاهز لترى مطعمك يتألق بمنيو رقمي فاخر وطاولات QR ذكية؟
                </h3>
                <p className="text-xs sm:text-sm text-white/85 leading-relaxed">
                  لا حاجة لبطاقة ائتمانية — انتقل الآن إلى صفحة التدشين المستقلة وشاهد هوية مطعمك وطاولاتك تتشكل أمامك لحظة بلحظة!
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto shrink-0">
                <button
                  onClick={handleLaunchRestaurantNow}
                  className="btn-shine w-full sm:w-auto px-7 py-4 rounded-2xl bg-[#FFFDF8] hover:bg-white text-[#003865] font-black text-sm shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                >
                  <Store className="w-4 h-4 text-[#0072BC]" />
                  <span>اضغط لتدشين مطعمك</span>
                  <ArrowLeft className="w-4 h-4" />
                </button>
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
              <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#FFFDF8] border border-[#0072BC]/40 shadow-lg shadow-[#0072BC]/20">
                <BrandMark size={24} />
                <span className="text-sm font-extrabold text-[#004B87]">مُريح</span>
                <span className="text-[9px] font-bold tracking-[0.2em] text-[#004B87] uppercase border-r border-[#004B87] pr-2.5">
                  MUREEH · SaaS
                </span>
              </div>
            </Reveal>
            <SectionHeading
              eyebrow="باقات الاشتراك"
              title={<>باقة لكل مرحلة من نموّك</>}
              sub="ابدأ بإطلاق منيو رقمي احترافي خلال دقائق، وطوّر باقتك كلما كبر مطعمك — بدون رسوم خفية وبدون عقود إجبارية."
            />
            {isOfferActive && (
              <Reveal className="max-w-3xl mx-auto -mt-8 mb-8">
                <div
                  role="status"
                  aria-label={`عرض إطلاق لفترة محدودة حتى ${LAUNCH_OFFER.endsAtLabelAr}`}
                  className="relative overflow-hidden rounded-2xl border border-amber-400/35 bg-gradient-to-l from-[#FBF7ED]/70 via-[#F5F2EA] to-[#FFFDF8] px-5 py-4 shadow-[0_12px_45px_-24px_rgba(245,158,11,0.6)]"
                >
                  <div className="absolute inset-y-0 right-0 w-1 bg-gradient-to-b from-amber-200 via-amber-400 to-amber-700" />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-center gap-2 sm:gap-4">
                    <span className="inline-flex items-center justify-center gap-1.5 self-center sm:self-auto rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-[10px] font-black text-amber-800">
                      <Clock className="h-3.5 w-3.5" />
                      عرض إطلاق لفترة محدودة
                    </span>
                    <p className="m-0 text-xs sm:text-sm font-bold text-[#1D3548]">
                      للمشتركين الجدد حتى {LAUNCH_OFFER.endsAtLabelAr}
                    </p>
                  </div>
                  <p className="mt-2 mb-0 text-[10px] leading-relaxed text-[#536879]">
                    أسعار العرض بالشيكل ظاهرة بوضوح بجانب السعر المعتاد؛ والدفع السنوي يشمل خصم شهرين إضافيين مقارنةً بالدفع الشهري.
                  </p>
                </div>
              </Reveal>
            )}
            {/* billing toggle */}
            <Reveal className="flex justify-center">
              <div className="inline-flex items-center gap-1 p-1.5 rounded-2xl bg-[#FFFDF8] border border-[#004B87]/60">
                {(['monthly', 'yearly'] as const).map((period) => {
                  const isActive = billingPeriod === period;
                  return (
                    <button
                      key={period}
                      onClick={() => setBillingPeriod(period)}
                      aria-pressed={isActive}
                      className={`relative px-5 sm:px-7 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        isActive ? 'text-white' : 'text-[#5B6871] hover:text-[#003865]'
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
              <p className="text-[11px] text-emerald-700 font-bold flex items-center justify-center gap-1.5 animate-saas-pop">
                <BadgeCheck className="w-3.5 h-3.5" />
                {isOfferActive
                  ? 'الدفع السنوي يوفّر شهرين إضافيين فوق سعر عرض الإطلاق'
                  : 'الدفع السنوي يوفّر شهرين كاملين مقارنةً بالدفع الشهري'}
              </p>
            )}
          </div>

          {/* plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 items-stretch">
            {PLANS.map((plan, i) => {
              const Icon = plan.icon;
              const isPro = plan.id === 'pro';
              const selectedPrice = getDisplayedPlanPrice(plan.pricing, billingPeriod, pricingNow);
              const price = billingPeriod === 'yearly' ? Math.round(selectedPrice / 12) : selectedPrice;
              const regularPrice =
                billingPeriod === 'yearly'
                  ? Math.round(plan.pricing.priceYearly / 12)
                  : plan.pricing.priceMonthly;
              const annualPrice = getDisplayedPlanPrice(plan.pricing, 'yearly', pricingNow);
              const annualSavings = plan.pricing.priceYearly - annualPrice;
              const discountPercent = getPlanDiscountPercent(plan.pricing);

              const card = (
                <div
                  className={`saas-plan-card h-full rounded-[1.65rem] overflow-hidden flex flex-col ${
                    isPro
                      ? 'bg-gradient-to-b from-[#F1EFE8] via-[#FFFDF8] to-[#F7F6F1]'
                      : 'bg-[#FFFDF8]/80'
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
                            ? 'bg-[#0072BC]/15 border border-[#0072BC]/35 text-[#004B87]'
                            : 'bg-[#EAF2F6] border border-[#C7DCE7] text-[#004B87]'
                        }`}
                      >
                        <Icon className="w-6 h-6" />
                      </div>
                      {isOfferActive && (
                        <span className="text-[10px] font-black text-amber-800 bg-amber-400/10 border border-amber-300/25 px-2.5 py-1 rounded-full">
                          خصم {discountPercent}% لفترة محدودة
                        </span>
                      )}
                    </div>

                    <h3 className="text-xl font-black text-[#1D3548]">{plan.name}</h3>
                    <p className="text-xs text-[#5B6871] mt-1 mb-5 leading-relaxed">{plan.tagline}</p>

                    <div className="flex items-end gap-2 mb-1" aria-live="polite">
                      {isOfferActive && (
                        <span className="mb-1.5 text-sm font-bold text-[#5B6871] line-through tabular-nums">
                          {regularPrice}
                        </span>
                      )}
                      <span
                        className={`text-4xl font-black tabular-nums ${
                          isPro ? 'text-[#004B87]' : 'text-[#1D3548]'
                        }`}
                      >
                        {price}
                      </span>
                      <span className="text-xs text-[#5B6871] mb-1.5">
                        ₪ / شهرياً{billingPeriod === 'yearly' ? ' عند الدفع السنوي' : ''}
                      </span>
                    </div>
                    <div className="min-h-8 mb-4 space-y-1">
                      {billingPeriod === 'yearly' ? (
                        <div className="rounded-xl border border-[#38BDF8]/20 bg-[#0072BC]/10 px-3 py-2">
                          <span className="block text-[10px] font-bold text-[#004B87]">
                            الإجمالي السنوي: <strong className="text-sm tabular-nums">{annualPrice} ₪</strong>
                          </span>
                          <span className="mt-0.5 block text-[10px] text-[#5B6871]">
                            يعادل {price} ₪ شهرياً · توفير {isOfferActive ? annualSavings : plan.pricing.priceMonthly * 12 - annualPrice} ₪ عن الدفع الشهري
                          </span>
                        </div>
                      ) : isOfferActive ? (
                        <span className="block text-[10px] text-amber-800 font-bold">
                          عرض الإطلاق حتى {LAUNCH_OFFER.endsAtLabelAr} · وفّر {regularPrice - price} ₪ شهرياً
                        </span>
                      ) : (
                        <span className="block text-[10px] text-[#5B6871]">
                          يمكن الترقية أو الإلغاء في أي وقت
                        </span>
                      )}
                    </div>

                    <p className="text-[10px] font-bold text-[#5B6871] mb-3">{plan.limits}</p>
                    <ul className="space-y-2.5 text-xs mb-5">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 leading-relaxed">
                          <span
                            className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                              isPro
                                ? 'bg-[#0072BC]/25 text-[#004B87]'
                                : 'bg-emerald-500/15 text-emerald-700'
                            }`}
                          >
                            <Check className="w-2.5 h-2.5" />
                          </span>
                          <span className="text-[#536879]">{feature}</span>
                        </li>
                      ))}
                    </ul>

                     <div className="mt-auto pt-2">
                       <button
                         onClick={() => handleContactWhatsApp(plan.name)}
                         className={`w-full py-3.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] ${
                           isPro
                             ? 'btn-shine bg-gradient-to-l from-[#003865] via-[#00649C] to-[#0072BC] text-white shadow-[0_0_26px_rgba(0,114,188,0.28)] hover:brightness-105'
                             : 'bg-[#0072BC]/10 hover:bg-[#0072BC]/15 text-[#004B87] border border-[#0072BC]/30'
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
                      <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full bg-gradient-to-l from-[#004B87] via-[#00649C] to-[#0072BC] text-white text-[10px] font-black flex items-center gap-1.5 shadow-[0_0_24px_rgba(0,114,188,0.5)] whitespace-nowrap">
                        <Crown className="w-3 h-3 text-white" />
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
                <div className="h-full flex items-start gap-3 p-4 rounded-2xl bg-[#FFFDF8]/60 border border-[#004B87]/50">
                  <span className="w-9 h-9 rounded-xl bg-[#0072BC]/15 border border-[#0072BC]/30 text-[#004B87] flex items-center justify-center shrink-0">
                    <item.icon className="w-5 h-5" />
                  </span>
                  <div>
                    <div className="text-xs font-bold text-[#1D3548]">{item.title}</div>
                    <div className="text-[10px] text-[#5B6871] mt-0.5 leading-relaxed">{item.desc}</div>
                  </div>
                </div>
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
                        ? 'border-[#0072BC]/60 bg-[#FFFDF8] shadow-[0_16px_40px_-20px_rgba(0,114,188,0.5)]'
                        : 'border-[#004B87]/40 bg-[#FFFDF8]/50 hover:border-[#0072BC]/40'
                    }`}
                  >
                    <button
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-3 px-5 py-4 text-start cursor-pointer"
                    >
                      <span className="text-sm font-bold text-[#1D3548]">{f.q}</span>
                      <span
                        className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-all duration-300 ${
                          open
                            ? 'rotate-45 bg-[#0072BC] text-white'
                            : 'bg-[#0072BC]/15 text-[#004B87]'
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
                        <p className="px-5 pb-5 text-[13px] text-[#536879] leading-relaxed">{f.a}</p>
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
            <div className="relative overflow-hidden rounded-[2rem] border border-[#0072BC]/40 bg-gradient-to-br from-[#FCFBF7] via-[#F0EFE9] to-[#F7F6F1] px-6 py-12 sm:p-14 text-center">
              <div className="absolute inset-0 saas-grid-bg saas-fade-radial pointer-events-none opacity-70" />
              <div className="absolute -top-24 right-1/4 w-96 h-96 rounded-full bg-[#0072BC]/25 blur-[110px] pointer-events-none animate-saas-drift-a" />
              <div className="absolute -bottom-28 left-1/4 w-96 h-96 rounded-full bg-[#009FE3]/15 blur-[110px] pointer-events-none animate-saas-drift-b" />
              <div className="relative z-10 space-y-5">
                <BrandMark size={56} className="mx-auto" />
                <h2 className="text-2xl sm:text-4xl font-black text-[#1D3548] leading-snug text-balance">
                  جاهز تحوّل مطعمك إلى{' '}
                  <span className="bg-gradient-to-l from-[#003865] via-[#00649C] to-[#0072BC] bg-clip-text text-transparent">
                    تجربة رقمية كاملة؟
                  </span>
                </h2>
                <p className="text-sm sm:text-base text-[#536879] max-w-xl mx-auto leading-relaxed">
                  انضم إلى المطاعم التي تدير طاولاتها ومطبخها وكاشيرها من منظومة واحدة.
                  التفعيل خلال دقائق — والدعم معك خطوة بخطوة.
                </p>
                <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    onClick={handleLaunchRestaurantNow}
                    className="btn-shine w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-l from-[#003865] via-[#00649C] to-[#0072BC] hover:brightness-110 text-white font-bold text-sm shadow-[0_0_36px_rgba(0,114,188,0.5)] flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <Store className="w-4 h-4" />
                    اضغط لتدشين مطعمك
                  </button>
                  <button
                    onClick={() => handleContactWhatsApp('تواصل عام')}
                    className="w-full sm:w-auto px-7 py-4 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/35 text-emerald-900 font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4 text-emerald-700" />
                    تحدث مع المبيعات
                  </button>
                  <button
                    onClick={openManagerConsole}
                    className="w-full sm:w-auto px-7 py-4 rounded-2xl bg-white/85 hover:bg-[#F0EFE9] border border-[#D8DFE2] text-[#1D3548] font-bold text-sm transition-all cursor-pointer backdrop-blur"
                  >
                    ادخل لوحة التحكم
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] font-bold text-[#5B6871] pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-[#004B87]" />
                    بدون بطاقة ائتمانية
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    إلغاء في أي وقت
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-[#004B87]" />
                    دعم بالعربية
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ================= Footer ================= */}
      <footer id="contact" className="border-t border-[#004B87]/40 bg-[#F7F6F1] px-4 sm:px-6 pt-12 pb-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 pb-10 border-b border-[#004B87]/30">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-3">
                <BrandMark size={40} />
                <span className="leading-tight">
                  <span className="block text-base font-black text-[#004B87]">مُريح</span>
                  <span className="block text-[9px] font-bold tracking-[0.2em] text-[#004B87]">MUREEH TECH</span>
                </span>
              </div>
              <p className="text-xs text-[#5B6871] leading-relaxed">
                منصة مُريح للخدمات الإلكترونية — منظومة سحابية متكاملة لإدارة المطاعم والمقاهي:
                منيو QR، شاشة مطبخ، ونقطة بيع في مكان واحد.
              </p>
              <a
                href={buildMureehWhatsAppUrl('مرحباً، أود الاستفسار عن منصة مُريح.')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 text-emerald-800 text-xs font-bold transition-all"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>واتساب مريح</span>
                <span className="font-mono" dir="ltr">{MUREEH_WHATSAPP_DISPLAY}</span>
              </a>
            </div>
            <nav aria-label="روابط سريعة">
              <h4 className="text-sm font-black text-[#1D3548] mb-4">روابط سريعة</h4>
              <ul className="space-y-2.5 text-xs font-bold text-[#5B6871]">
                {NAV_LINKS.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className="hover:text-[#004B87] transition-colors">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="الباقات">
              <h4 className="text-sm font-black text-[#1D3548] mb-4">الباقات</h4>
              <ul className="space-y-2.5 text-xs font-bold text-[#5B6871]">
                {PLANS.map((p) => (
                  <li key={p.id}>
                    <a href="#pricing" className="hover:text-[#004B87] transition-colors">
                      {p.name} — {getDisplayedPlanPrice(p.pricing, 'monthly', pricingNow)} ₪/شهرياً
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div>
              <h4 className="text-sm font-black text-[#1D3548] mb-4">تواصل معنا</h4>
              <ul className="space-y-2.5 text-xs font-bold text-[#5B6871]">
                <li className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />
                  واتساب:{' '}
                  <a
                    href={buildMureehWhatsAppUrl('مرحباً، أود التواصل مع فريق مريح.')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[#536879] hover:text-emerald-800"
                    dir="ltr"
                  >
                    {MUREEH_WHATSAPP_DISPLAY}
                  </a>
                </li>
                <li className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-[#004B87]" />
                  دعم فني يومي في أوقات العمل
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#004B87]" />
                  منصة سحابية آمنة متعددة المستأجرين
                </li>
              </ul>
            </div>
          </div>
          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-[#5B6871]">
            <p>© 2026 منصة مريح للخدمات الإلكترونية (MUREEH) — جميع الحقوق محفوظة</p>
            <p>إحدى خدمات منصة مريح الإلكترونية · صُنع بشغف للمطاعم العربية</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
