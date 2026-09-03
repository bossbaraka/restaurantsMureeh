import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
import { db } from '../../services/db';
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
} from 'lucide-react';

export const SaaSLandingPage: React.FC = () => {
  const { setViewMode, setCurrentTenantBySlug, setActiveTableId } = useRestaurant();
  const [tablesInput, setTablesInput] = useState(20);

  // ROI calculations
  const estimatedStaffCostSaved = tablesInput * 120; // ₪ saved monthly in paper menu & labor efficiency
  const estimatedRevenueBoost = tablesInput * 350; // ₪ boosted through add-ons and fast table turnover

  const handleContactWhatsApp = (planName: string = 'الاحترافية') => {
    const text = encodeURIComponent(`مرحباً! أود الاشتراك في منصة مُريح للخدمات الإلكترونية للمطاعم (${planName}) والاستفسار عن تدشين الخدمة لمطعمي.`);
    window.open(`https://api.whatsapp.com/send?phone=970593498909&text=${text}`, '_blank');
  };

  const handleDemoPreview = () => {
    const demoTable = db.getTables('rest-demo-promo')[0];
    setCurrentTenantBySlug('merar-demo');
    if (demoTable) setActiveTableId(demoTable.id);
    setViewMode('CUSTOMER');
  };

  return (
    <div className="min-h-screen bg-[#07080A] text-luxury-50 font-sans selection:bg-gold-500/20 selection:text-gold-300" dir="rtl">
      <header className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-700 flex items-center justify-center shadow-lg shadow-sky-900/30">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="text-xl font-extrabold tracking-wide text-sky-300">مُريح</div>
            <div className="text-[10px] font-semibold tracking-[0.18em] text-luxury-400 uppercase">MUREEH</div>
          </div>
        </div>
        <span className="text-xs text-luxury-400 hidden sm:block">منصة الخدمات الإلكترونية للمطاعم</span>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-16 sm:py-24 px-4 sm:px-6 border-b border-luxury-850">
        <div className="absolute inset-0 bg-radial-gradient from-gold-500/10 via-transparent to-transparent opacity-50 pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center space-y-6 relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-luxury-900/90 border border-gold-500/40 text-gold-300 text-xs font-bold shadow-gold-glow backdrop-blur-md">
            <Sparkles className="w-4 h-4 text-gold-400" />
            <span>المنظومة السحابية الأرقى لإدارة المطاعم والطلب الرقمي للطاولات</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold font-serif tracking-wide text-luxury-50 leading-tight">
            حوّل طاولات مطعمك إلى <br />
            <span className="bg-gradient-to-r from-gold-300 via-gold-400 to-gold-600 bg-clip-text text-transparent">
              تجربة ضيافة استثنائية وأرباح مضاعفة
            </span>
          </h1>

          <p className="text-sm sm:text-lg text-luxury-300 max-w-2xl mx-auto leading-relaxed">
            منيو رقمي فاخر برمز QR لكل طاولة بدون تسجيل حساب للزبون، شاشة مطبخ حية (KDS)، نداء الويتر بضغطة زر، وإدارة كاملة لـ 50 طاولة بنظام سحابي معزول وآمن.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <button
              onClick={handleDemoPreview}
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-400 hover:to-gold-500 text-luxury-950 font-bold text-sm shadow-gold-glow flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-98"
            >
              <span>تجربة المنيو الحي للعميل</span>
              <ArrowLeft className="w-4 h-4" />
            </button>

            <button
              onClick={() => setViewMode('MANAGER')}
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-luxury-900 hover:bg-luxury-850 border border-luxury-750 text-luxury-100 font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <span>معاينة لوحة تحكم المطعم</span>
            </button>
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

      {/* Subscription Pricing Plans */}
      <section className="py-16 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="text-center space-y-2 mb-12">
          <span className="text-xs font-bold text-gold-400 uppercase tracking-widest">باقات الاشتراك الشهرية</span>
          <h2 className="text-2xl sm:text-3xl font-bold font-serif text-luxury-50">اختر الباقة المناسبة لمطعمك</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Basic */}
          <div className="p-6 rounded-3xl bg-luxury-900 border border-luxury-800 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <h3 className="text-lg font-bold font-serif text-luxury-100">الباقة الأساسية</h3>
              <p className="text-xs text-luxury-400">للمقاهي والكافيهات الصغيرة</p>
              <div className="text-3xl font-bold font-mono text-luxury-50">
                ₪199 <span className="text-xs text-luxury-400 font-sans">/ شهرياً</span>
              </div>
              <ul className="space-y-2 text-xs text-luxury-300 pt-3 border-t border-luxury-800">
                <li>✓ حتى 15 طاولة</li>
                <li>✓ منيو رقمي سريع برمز QR</li>
                <li>✓ زر استدعاء النادل</li>
                <li>✓ دعم الدفع عند الكاشير</li>
              </ul>
            </div>
            <button
              onClick={() => handleContactWhatsApp('الأساسية')}
              className="w-full py-3 rounded-xl bg-luxury-800 hover:bg-luxury-750 text-luxury-100 font-bold text-xs transition-colors cursor-pointer"
            >
              اشترك الآن
            </button>
          </div>

          {/* Pro */}
          <div className="p-6 rounded-3xl bg-gradient-to-b from-luxury-850 to-luxury-900 border-2 border-gold-500 flex flex-col justify-between space-y-6 shadow-gold-glow relative">
            <span className="absolute -top-3 right-6 px-3 py-1 rounded-full bg-gold-500 text-luxury-950 font-bold text-[10px]">
              الأكثر طلباً ⭐
            </span>
            <div className="space-y-4">
              <h3 className="text-lg font-bold font-serif text-gold-300">الباقة الاحترافية (Pro)</h3>
              <p className="text-xs text-luxury-400">للمطاعم الفاخرة والصالات الكبيرة</p>
              <div className="text-3xl font-bold font-mono text-gold-400">
                ₪399 <span className="text-xs text-luxury-400 font-sans">/ شهرياً</span>
              </div>
              <ul className="space-y-2 text-xs text-luxury-200 pt-3 border-t border-luxury-800">
                <li className="font-bold text-gold-300">✓ طاولات غير محدودة (حتى 50 طاولة)</li>
                <li>✓ شاشة المطبخ الحية (KDS)</li>
                <li>✓ إدارة حسابات العمال بالـ PIN</li>
                <li>✓ تحليلات المبيعات وتصدير CSV</li>
                <li>✓ مشاركة الفواتير عبر واتساب</li>
              </ul>
            </div>
            <button
              onClick={() => handleContactWhatsApp('الاحترافية')}
              className="w-full py-3 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs transition-colors shadow-gold-glow cursor-pointer"
            >
              ابدأ تجربتك المجانية
            </button>
          </div>

          {/* Enterprise */}
          <div className="p-6 rounded-3xl bg-luxury-900 border border-luxury-800 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <h3 className="text-lg font-bold font-serif text-luxury-100">باقة المؤسسات</h3>
              <p className="text-xs text-luxury-400">لسلاسل المطاعم والفروع المتعددة</p>
              <div className="text-3xl font-bold font-mono text-luxury-50">
                ₪799 <span className="text-xs text-luxury-400 font-sans">/ شهرياً</span>
              </div>
              <ul className="space-y-2 text-xs text-luxury-300 pt-3 border-t border-luxury-800">
                <li>✓ فروع متعددة تحت حساب واحد</li>
                <li>✓ نطاق مخصص (Custom Domain)</li>
                <li>✓ تخصيص الهوية والشعار والألوان</li>
                <li>✓ دعم فني وتدريب على مدار الساعة</li>
              </ul>
            </div>
            <button
              onClick={() => handleContactWhatsApp('المؤسسات')}
              className="w-full py-3 rounded-xl bg-luxury-800 hover:bg-luxury-750 text-luxury-100 font-bold text-xs transition-colors cursor-pointer"
            >
              تواصل مع المبيعات
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-luxury-850 text-center text-xs text-luxury-500 space-y-2">
        <p className="font-serif font-bold text-gold-400">مُريح للخدمات الإلكترونية</p>
        <p>© 2026 جميع الحقوق محفوظة · جاهز للتشغيل على السيرفرات السحابية و Supabase</p>
      </footer>
    </div>
  );
};
