import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { Restaurant, RestaurantTable, Plan } from '../../types/restaurant';
import { db } from '../../services/db';
import { api } from '../../services/api';
import {
  X,
  Building2,
  Sparkles,
  Palette,
  MapPin,
  Utensils,
  QrCode,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Store,
  Layers,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface RestaurantOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RestaurantOnboardingModal: React.FC<RestaurantOnboardingModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { showToast, refreshTenantData, setCurrentTenantBySlug } = useRestaurant();
  const { switchManagerRestaurant } = useAuth();

  const [step, setStep] = useState<number>(1);

  // Form State
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [slug, setSlug] = useState('');
  const [phone, setPhone] = useState('+970 599 ');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('₪');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [coverImage, setCoverImage] = useState('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=85');
  const [logo, setLogo] = useState('https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=200&q=80');
  const [planId, setPlanId] = useState('plan-pro');
  const [tableCount, setTableCount] = useState<number>(20);

  if (!isOpen) return null;

  const handleSlugAutoFill = (val: string) => {
    setNameEn(val);
    const clean = val.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    setSlug(clean);
  };

  const handleFinishOnboarding = async () => {
    if (!name.trim() || !slug.trim()) {
      showToast('error', 'يرجى استكمال البيانات المطلوبة');
      return;
    }

    const normalizedSlug = slug.trim().toLowerCase();
    if (db.getRestaurantBySlug(normalizedSlug)) {
      showToast('error', 'رابط المطعم مستخدم بالفعل', 'اختر رابطًا مختلفًا للمطعم الجديد.');
      return;
    }

    const restId = `rest-${normalizedSlug}`;
    const newRestaurant: Restaurant = {
      id: restId,
      name: name.trim(),
      nameEn: nameEn.trim() || name.trim(),
      slug: normalizedSlug,
      logo,
      coverImage,
      description: description.trim() || 'مطعم فاخر يقدم أرقى تجارب الطعام.',
      phone: phone.trim(),
      address: address.trim() || 'وسط المدينة',
      currency: currency || '₪',
      language: 'ar',
      timezone: 'Asia/Jerusalem',
      status: 'ACTIVE',
      primaryColor,
      accentColor: '#C5A880',
      planId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const apiResult = await api.onboardRestaurant({
      name: newRestaurant.name,
      nameEn: newRestaurant.nameEn,
      slug: newRestaurant.slug,
      description: newRestaurant.description,
      phone: newRestaurant.phone,
      address: newRestaurant.address,
      currency: newRestaurant.currency,
      primaryColor: newRestaurant.primaryColor,
      accentColor: newRestaurant.accentColor,
      logoUrl: newRestaurant.logo,
      coverImageUrl: newRestaurant.coverImage,
      planId: newRestaurant.planId,
      managerName: `مدير ${name}`,
      managerEmail: `manager@${normalizedSlug}.com`,
      managerPassword: `Temp-${normalizedSlug}-${Date.now()}!`,
      tablesCount: tableCount,
      categories: [
        { id: `cat-${restId}-mains`, name: 'الأطباق الرئيسية الفاخرة', nameEn: 'Prime Mains' },
        { id: `cat-${restId}-drinks`, name: 'المشروبات المنعشة والموكتيل', nameEn: 'Signature Drinks' },
      ],
    });
    if (apiResult.statusCode === 400 || apiResult.statusCode === 401 || apiResult.statusCode === 403) {
      showToast('error', 'تعذر حفظ المطعم في قاعدة البيانات', apiResult.error);
      return;
    }

    // Save Restaurant locally as the offline/demo mirror.
    db.saveRestaurant(newRestaurant);

    // Create Subscription
    db.saveSubscription({
      id: `sub-${restId}`,
      restaurantId: restId,
      planId,
      status: 'ACTIVE',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    });

    // Create initial Tables
    const newTables: RestaurantTable[] = Array.from({ length: tableCount }, (_, i) => {
      const num = i + 1;
      const numStr = num < 10 ? `0${num}` : `${num}`;
      const qrToken = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
      return {
        id: `TABLE-${numStr}`,
        restaurantId: restId,
        qrToken: `${restId}-qr-${numStr}-${qrToken}`,
        tableNumber: num,
        capacity: num % 2 === 0 ? 4 : 2,
        zone: num <= Math.ceil(tableCount * 0.6) ? 'MAIN_HALL' : 'TERRACE',
        status: 'AVAILABLE',
        activeOrderIds: [],
        hasWaiterCall: false,
      };
    });
    db.saveTablesBatch(newTables);

    // Create default Starter Categories
    const catMains = {
      id: `cat-${restId}-mains`,
      restaurantId: restId,
      name: 'الأطباق الرئيسية الفاخرة',
      nameEn: 'Prime Mains',
      sortOrder: 1,
    };
    const catDrinks = {
      id: `cat-${restId}-drinks`,
      restaurantId: restId,
      name: 'المشروبات المنعشة والموكتيل',
      nameEn: 'Signature Drinks',
      sortOrder: 2,
    };
    db.saveCategory(catMains);
    db.saveCategory(catDrinks);

    // Create sample product
    db.saveProduct({
      id: `prod-${restId}-1`,
      restaurantId: restId,
      categoryId: catMains.id,
      name: `طبق توقيع الشيف — ${name}`,
      nameEn: `Chef Signature Selection`,
      description: 'طبق استثنائي محضر بأجود المكونات الطازجة مع صلصة المطعم الخاصة.',
      price: 85,
      image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
      isAvailable: true,
      isFeatured: true,
      badge: 'توقيع المطعم',
      preparationTimeMinutes: 18,
      calories: 620,
    });

    // Create Manager User
    db.saveUser({
      id: `user-${restId}-mgr`,
      restaurantId: restId,
      name: `مدير ${name}`,
      email: `manager@${slug}.com`,
      role: 'RESTAURANT_MANAGER',
      token: `token-${restId}-mgr`,
      createdAt: new Date().toISOString(),
    });

    refreshTenantData();
    switchManagerRestaurant(restId);
    setCurrentTenantBySlug(newRestaurant.slug);

    try {
      confetti({
        particleCount: 90,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#D4AF37', '#10B981', '#3B82F6'],
      });
    } catch {
      // ignore
    }

    showToast('success', 'تم تدشين المطعم بنجاح!', `تم إنشاء ${name} وتجهيز ${tableCount} طاولة ورموز QR.`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-3 sm:p-4">
      <div className="fixed inset-0 bg-black/85 backdrop-blur-md" onClick={onClose} />

      <div
        className="relative w-full max-w-2xl bg-luxury-900 border border-gold-500/40 rounded-2xl shadow-luxury overflow-hidden z-10 my-6 animate-in fade-in zoom-in-95 duration-200 text-right flex flex-col max-h-[92vh]"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 bg-luxury-850/90 border-b border-luxury-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-400">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-luxury-50 font-serif">
                إضافة وتدشين مطعم جديد (Restaurant Onboarding)
              </h3>
              <p className="text-xs text-luxury-400">الخطوة {step} من 4 — معالج التهيئة السحابية متعدد المستأجرين</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1.5 rounded-lg text-luxury-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Progress Dots */}
        <div className="grid grid-cols-4 gap-1 p-2 bg-luxury-950 border-b border-luxury-800 text-[11px] text-center font-medium">
          {[
            { s: 1, title: '1. معلومات المطعم' },
            { s: 2, title: '2. الهوية والمظهر' },
            { s: 3, title: '3. الطاولات والباقة' },
            { s: 4, title: '4. المراجعة والتدشين' },
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

        {/* Step Contents */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* STEP 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-3.5 animate-in fade-in">
              <div>
                <label className="block font-bold text-luxury-200 mb-1">اسم المطعم (بالعربية) *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: مطعم الأوركيد الفاخر"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-luxury-200 mb-1">الاسم بالإنجليزية *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Orchid Fine Dining"
                    value={nameEn}
                    onChange={(e) => handleSlugAutoFill(e.target.value)}
                    className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60"
                  />
                </div>
                <div>
                  <label className="block font-bold text-luxury-200 mb-1">الرابط المخصص (Slug) *</label>
                  <div className="flex items-center bg-luxury-950 border border-luxury-800 rounded-xl px-2.5 text-luxury-400 font-mono">
                    <span>app.merar.com/r/</span>
                    <input
                      type="text"
                      required
                      placeholder="orchid"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      className="flex-1 bg-transparent border-0 text-gold-400 font-bold p-2 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-luxury-200 mb-1">رقم الهاتف للتواصل</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-luxury-200 mb-1">العنوان والموقع</label>
                  <input
                    type="text"
                    placeholder="المدينة، الشارع، الحي..."
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-luxury-200 mb-1">نبذة قصيرة عن المطعم</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="وصف راقٍ يظهر للعملاء في أعلى القائمة..."
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Branding */}
          {step === 2 && (
            <div className="space-y-4 animate-in fade-in">
              <div>
                <label className="block font-bold text-luxury-200 mb-1">رابط صورة الغلاف الفاخرة (Cover Image)</label>
                <input
                  type="url"
                  value={coverImage}
                  onChange={(e) => setCoverImage(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl mb-2"
                />
                <img src={coverImage} alt="Cover Preview" className="h-28 w-full object-cover rounded-xl border border-luxury-800" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-luxury-200 mb-1">لون التمييز الأساسي (Primary Accent)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0"
                    />
                    <span className="font-mono text-gold-400 font-bold">{primaryColor}</span>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-luxury-200 mb-1">العملة الافتراضية</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl font-bold text-gold-400"
                  >
                    <option value="₪">₪ (شيكل إسرائيلي جديد)</option>
                    <option value="$">$ (دولار أمريكي)</option>
                    <option value="€">€ (يورو)</option>
                    <option value="SAR">SAR (ريال سعودي)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Tables & Plan */}
          {step === 3 && (
            <div className="space-y-4 animate-in fade-in">
              <div>
                <label className="block font-bold text-luxury-200 mb-1">عدد الطاولات الأولية المراد توليد رموز QR لها</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={5}
                    max={50}
                    value={tableCount}
                    onChange={(e) => setTableCount(Number(e.target.value))}
                    className="flex-1 accent-gold-500"
                  />
                  <span className="font-bold text-base text-gold-400 px-3 py-1 bg-luxury-950 rounded-xl border border-luxury-800 font-mono">
                    {tableCount} طاولة
                  </span>
                </div>
                <p className="text-[11px] text-luxury-400 mt-1">
                  سيتم إنشاء الطاولات تلقائياً من TABLE-01 إلى TABLE-{tableCount < 10 ? `0${tableCount}` : tableCount} مع رموز QR مخصصة.
                </p>
              </div>

              <div>
                <label className="block font-bold text-luxury-200 mb-2">اختر باقة الاشتراك السحابية</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'plan-starter', name: 'Starter', price: '₪149/شهرياً', desc: 'حتى 15 طاولة' },
                    { id: 'plan-pro', name: 'Pro Hospitality', price: '₪349/شهرياً', desc: 'حتى 50 طاولة + تحليلات', popular: true },
                    { id: 'plan-enterprise', name: 'Enterprise', price: '₪799/شهرياً', desc: 'طاولات وفروع غير محدودة' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlanId(p.id)}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        planId === p.id
                          ? 'bg-gold-500/10 border-gold-500 text-gold-300 font-bold'
                          : 'bg-luxury-950 border-luxury-800 text-luxury-400'
                      }`}
                    >
                      <span className="text-xs font-bold block">{p.name}</span>
                      <span className="text-[10px] text-gold-400 font-semibold block">{p.price}</span>
                      <span className="text-[9px] opacity-75 mt-1 block">{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Review & Publish */}
          {step === 4 && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-4 rounded-xl bg-luxury-950 border border-luxury-800 space-y-2">
                <h4 className="text-sm font-bold text-gold-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  <span>ملخص تهيئة المطعم المستأجر</span>
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs pt-2">
                  <div>
                    <span className="text-luxury-400">اسم المطعم:</span>
                    <strong className="block text-luxury-100">{name} ({nameEn})</strong>
                  </div>
                  <div>
                    <span className="text-luxury-400">رابط القائمة الرقمية:</span>
                    <strong className="block text-gold-400 font-mono">/r/{slug}</strong>
                  </div>
                  <div>
                    <span className="text-luxury-400">عدد الطاولات:</span>
                    <strong className="block text-luxury-100">{tableCount} طاولة مستقلة</strong>
                  </div>
                  <div>
                    <span className="text-luxury-400">الباقة المختارة:</span>
                    <strong className="block text-luxury-100">{planId.toUpperCase()}</strong>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                جاهز للإطلاق! بمجرد النقر على "تدشين المطعم الآن"، سيتم إعداد قاعدة البيانات وعزل المستأجر وتجهيز رموز QR.
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-4 bg-luxury-950 border-t border-luxury-800 flex items-center justify-between">
          {step > 1 ? (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="px-4 py-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-luxury-300 text-xs font-semibold flex items-center gap-1"
            >
              <ArrowRight className="w-4 h-4" />
              <span>السابق</span>
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              onClick={() => {
                if (step === 1 && (!name.trim() || !slug.trim())) {
                  showToast('error', 'يرجى إدخال اسم المطعم والرابط المخصص');
                  return;
                }
                setStep((s) => s + 1);
              }}
              className="px-6 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1 shadow-gold-glow"
            >
              <span>التالي</span>
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleFinishOnboarding}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-lg"
            >
              <CheckCircle className="w-4 h-4" />
              <span>تدشين المطعم الآن 🚀</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
