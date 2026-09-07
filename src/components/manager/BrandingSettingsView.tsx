import React, { useState, useEffect, useRef } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import {
  Palette,
  Save,
  Image as ImageIcon,
  Upload,
  Phone,
  MapPin,
  Smartphone,
  Star,
  Loader2,
  Wand2,
  RefreshCcw,
  Check,
  Plus,
  UtensilsCrossed,
  Clock,
} from 'lucide-react';

/** اقتراحات جاهزة لشكل موقع المطعم (Theme Presets) */
const THEME_PRESETS: Array<{
  id: string;
  label: string;
  desc: string;
  primary: string;
  accent: string;
}> = [
  { id: 'royal-gold', label: 'ذهبي ملكي', desc: 'كلاسيكي فاخر دافئ', primary: '#D4AF37', accent: '#8C6D1F' },
  { id: 'midnight-blue', label: 'أزرق ليلي', desc: 'هادئ وعصري وأنيق', primary: '#4F7CFF', accent: '#1E2F6E' },
  { id: 'emerald', label: 'زمردي ملكي', desc: 'انتعاش وثقة راقية', primary: '#10B981', accent: '#065F46' },
  { id: 'amber', label: 'عنبري دافئ', desc: 'طاقة ودفء ترحيبي', primary: '#F59E0B', accent: '#92400E' },
  { id: 'rose', label: 'وردي فاخر', desc: 'ناعم للمقاهي والبووتيك', primary: '#EC4899', accent: '#831843' },
  { id: 'wine', label: 'نبيذي داكن', desc: 'فخامة مطاعم اللحوم', primary: '#C0392B', accent: '#5C1A12' },
  { id: 'silver', label: 'فضي معدني', desc: 'حديث بسيط نظيف', primary: '#94A3B8', accent: '#3E4A5B' },
];

/** ضغط الصورة على جهاز المستخدم ثم رفعها للسيرفر الحقيقي */
async function fileToResizedBlob(file: File, maxDim: number): Promise<{ blob: Blob; ext: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const ratio = Math.min(1, maxDim / Math.max(width, height));
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas'));
      ctx.drawImage(img, 0, 0, width, height);
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      canvas.toBlob(
        (b) => (b ? resolve({ blob: b, ext: isPng ? 'png' : 'jpg' }) : reject(new Error('encode'))),
        isPng ? 'image/png' : 'image/jpeg',
        0.84
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load'));
    };
    img.src = url;
  });
}

export const BrandingSettingsView: React.FC = () => {
  const { currentRestaurant, setCurrentRestaurant, refreshTenantData, showToast } = useRestaurant();
  const { currentUser } = useAuth();
  const isDemo = currentUser?.email.toLowerCase().includes('demo');

  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logo, setLogo] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [accentColor, setAccentColor] = useState('#C5A880');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentRestaurant) {
      setName(currentRestaurant.name);
      setNameEn(currentRestaurant.nameEn);
      setDescription(currentRestaurant.description);
      setPhone(currentRestaurant.phone);
      setAddress(currentRestaurant.address);
      setLogo(currentRestaurant.logo);
      setCoverImage(currentRestaurant.coverImage || '');
      setPrimaryColor(currentRestaurant.primaryColor || '#D4AF37');
      setAccentColor(currentRestaurant.accentColor || '#C5A880');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRestaurant?.id]);

  if (!currentRestaurant) return null;

  const applyPreset = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setPrimaryColor(preset.primary);
    setAccentColor(preset.accent);
    setActivePreset(presetId);
  };

  const handleUpload = async (kind: 'logo' | 'cover', file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'صيغة غير مدعومة', 'يرجى اختيار صورة JPG أو PNG أو WEBP');
      return;
    }
    setUploading(kind);
    try {
      const { blob, ext } = await fileToResizedBlob(file, kind === 'logo' ? 512 : 1600);
      const res = await api.uploadImage(blob, `brand-${kind}-${Date.now()}.${ext}`);
      if (!res.success || !res.data) {
        showToast('error', 'تعذر رفع الصورة إلى الخادم', res.error);
        return;
      }
      if (kind === 'logo') setLogo(res.data.url);
      else setCoverImage(res.data.url);
      showToast('success', 'تم رفع الصورة', kind === 'logo' ? 'تم تحديث شعار المطعم — احفظ للتطبيق' : 'تم تحديث صورة الغلاف — احفظ للتطبيق');
    } catch {
      showToast('error', 'تعذر معالجة الصورة', 'تعذر قراءة الملف أو ضغطه');
    } finally {
      setUploading(null);
      if (logoInputRef.current) logoInputRef.current.value = '';
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!currentRestaurant || isSaving) return;

    if (isDemo) {
      showToast(
        'warning',
        '🔒 تنبيه النسخة التجريبية',
        'لا يمكن حفظ التعديل الدائم في النسخة التجريبية. لتأكيد وتطبيق الهوية البصرية الحقيقية على موقعك، اشترك في منصة مريح.'
      );
      if (currentRestaurant) {
        setCurrentRestaurant({
          ...currentRestaurant,
          name: name.trim(),
          nameEn: nameEn.trim(),
          description: description.trim(),
          phone: phone.trim(),
          address: address.trim(),
          logo: logo.trim(),
          coverImage: coverImage.trim(),
          primaryColor,
          accentColor,
        });
      }
      return;
    }

    setIsSaving(true);
    const res = await api.saveBranding(currentRestaurant.id, {
      name: name.trim(),
      nameEn: nameEn.trim(),
      description: description.trim(),
      phone: phone.trim(),
      address: address.trim(),
      logo: logo.trim(),
      coverImage: coverImage.trim(),
      primaryColor,
      accentColor,
    });
    setIsSaving(false);
    if (!res.success || !res.data) {
      showToast('error', 'تعذر حفظ الهوية البصرية', res.error || 'يرجى المحاولة لاحقاً');
      return;
    }
    setCurrentRestaurant(res.data.restaurant);
    refreshTenantData();
    showToast('success', 'تم حفظ إعدادات الهوية بنجاح', 'سيظهر الشعار والألوان الجديدة مباشرة في منيو عملائك.');
  };

  const currency = currentRestaurant.currency || '₪';
  const logoPreview = logo || currentRestaurant.logo || '';

  return (
    <div className="space-y-6 text-right max-w-6xl" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <Palette className="w-5 h-5 text-gold-400" />
            <span>هوية مطعمك — الشعار والألوان وشكل الموقع</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            اقترح شكل موقعك مباشرة: اختر طابعاً جاهزاً أو ارفع شعار مطعمك/الكافيه وشاهد المعاينة الحية
          </p>
        </div>

        <button
          onClick={() => handleSave()}
          disabled={isSaving || uploading !== null}
          className="px-5 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-gold-glow disabled:opacity-60"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{isSaving ? 'جاري الحفظ في قاعدة البيانات...' : 'حفظ ونشر الهوية الجديدة'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* ============ Right column: editors ============ */}
        <div className="lg:col-span-3 space-y-6">
          {/* Basic info */}
          <form onSubmit={handleSave} className="bg-luxury-900 border border-luxury-800 rounded-2xl p-6 shadow-luxury space-y-5 text-xs">
            <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2">
              <UtensilsCrossed className="w-4 h-4 text-gold-400" />
              بيانات المطعم الأساسية
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-luxury-200 mb-1">اسم المطعم (بالعربية)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60"
                />
              </div>
              <div>
                <label className="block font-bold text-luxury-200 mb-1">الاسم بالإنجليزية</label>
                <input
                  type="text"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60"
                />
              </div>
            </div>
            <div>
              <label className="block font-bold text-luxury-200 mb-1">الوصف (يظهر للعميل تحت اسم المطعم)</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-luxury-200 mb-1 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-gold-400" /> رقم الهاتف
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-bold text-luxury-200 mb-1 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-gold-400" /> العنوان
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
                />
              </div>
            </div>
          </form>

          {/* Logo & Cover upload */}
          <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-6 shadow-luxury space-y-5 text-xs">
            <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-gold-400" />
              شعار المطعم وصورة الغلاف
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Logo */}
              <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block font-bold text-luxury-200">شعار المطعم / الكافيه</label>
                  <span className="text-[10px] text-luxury-500">يظهر أعلى منيو عملائك</span>
                </div>
                <div className="flex items-center gap-4">
                  <div
                    className="w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center shrink-0 border border-luxury-700 text-2xl font-serif font-bold text-luxury-950"
                    style={
                      logoPreview
                        ? { background: 'transparent' }
                        : { background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})` }
                    }
                  >
                    {logoPreview ? (
                      <img src={logoPreview} alt={name} className="w-full h-full object-cover" />
                    ) : (
                      (nameEn.charAt(0) || 'م')
                    )}
                  </div>
                  <div className="space-y-2 flex-1">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => handleUpload('logo', e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={uploading !== null}
                      className="w-full py-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 border border-luxury-700 text-luxury-100 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-60"
                    >
                      {uploading === 'logo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 text-gold-400" />}
                      {uploading === 'logo' ? 'جاري رفع الشعار...' : 'رفع شعار من الجهاز'}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-luxury-400 mb-1">أو رابط مباشر للشعار</label>
                  <input
                    type="url"
                    dir="ltr"
                    value={logo}
                    onChange={(e) => setLogo(e.target.value)}
                    placeholder="https://…"
                    className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2 rounded-lg focus:border-gold-500/60 text-left"
                  />
                </div>
              </div>

              {/* Cover */}
              <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block font-bold text-luxury-200">صورة الغلاف (Hero)</label>
                  <span className="text-[10px] text-luxury-500">تظهر في مقدمة المنيو</span>
                </div>
                <div className="h-24 rounded-xl overflow-hidden border border-luxury-700 bg-luxury-900 flex items-center justify-center">
                  {coverImage ? (
                    <img src={coverImage} alt="غلاف" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-luxury-500">لا توجد صورة غلاف بعد</span>
                  )}
                </div>
                <div className="space-y-2">
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => handleUpload('cover', e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={uploading !== null}
                    className="w-full py-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 border border-luxury-700 text-luxury-100 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    {uploading === 'cover' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 text-gold-400" />}
                    {uploading === 'cover' ? 'جاري رفع الغلاف...' : 'رفع غلاف من الجهاز'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Theme presets */}
          <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-6 shadow-luxury space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-gold-400" />
                اقتراحات شكل الموقع — اختر الطابع الذي يعبر عن مطعمك
              </h3>
              <button
                type="button"
                onClick={() => setActivePreset(null)}
                className="flex items-center gap-1 text-luxury-400 hover:text-luxury-200 transition-colors"
              >
                <RefreshCcw className="w-3 h-3" />
                تخصيص يدوي
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {THEME_PRESETS.map((preset) => {
                const isActive = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    className={`p-3 rounded-xl border text-right transition-all group ${
                      isActive
                        ? 'border-gold-500 bg-gold-500/10 shadow-gold-glow'
                        : 'border-luxury-750 bg-luxury-950 hover:border-luxury-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="w-7 h-7 rounded-lg border border-luxury-600 flex items-center justify-center text-white"
                        style={{ background: `linear-gradient(135deg, ${preset.primary}, ${preset.accent})` }}
                      >
                        {isActive && <Check className="w-3.5 h-3.5 text-white" />}
                      </span>
                      <span className="w-4 h-4 rounded-full border border-luxury-600" style={{ background: preset.accent }} />
                    </div>
                    <div className="text-luxury-100 font-bold">{preset.label}</div>
                    <div className="text-[10px] text-luxury-400">{preset.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* Custom colors */}
            <div className="pt-3 border-t border-luxury-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-luxury-200 mb-1.5">لون التمييز الأساسي (أزرار/شارات)</label>
                <div className="flex items-center gap-3 bg-luxury-950 p-2.5 rounded-xl border border-luxury-800">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => {
                      setPrimaryColor(e.target.value);
                      setActivePreset(null);
                    }}
                    className="w-9 h-9 rounded cursor-pointer bg-transparent border-0"
                  />
                  <span className="font-mono text-gold-400 font-bold" dir="ltr">{primaryColor}</span>
                  <span className="flex-1 h-2 rounded-full" style={{ background: `linear-gradient(to left, ${primaryColor}, ${accentColor})` }} />
                </div>
              </div>
              <div>
                <label className="block font-bold text-luxury-200 mb-1.5">اللون الثانوي (تدرجات/تفاصيل)</label>
                <div className="flex items-center gap-3 bg-luxury-950 p-2.5 rounded-xl border border-luxury-800">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => {
                      setAccentColor(e.target.value);
                      setActivePreset(null);
                    }}
                    className="w-9 h-9 rounded cursor-pointer bg-transparent border-0"
                  />
                  <span className="font-mono text-gold-400 font-bold" dir="ltr">{accentColor}</span>
                  <span className="flex-1 h-2 rounded-full" style={{ background: `linear-gradient(to left, ${accentColor}, ${primaryColor})` }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ============ Live preview (shape of the subscriber's site) ============ */}
        <div className="lg:col-span-2 lg:sticky lg:top-24 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-gold-400" />
              معاينة حية — هكذا سيظهر موقعك لعميلك
            </h3>
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> تحديث فوري
            </span>
          </div>

          {/* Phone frame */}
          <div className="mx-auto w-[290px] rounded-[2.2rem] border-[6px] border-luxury-800 bg-[#0B0C0F] shadow-2xl overflow-hidden">
            <div className="relative">
              {/* Cover */}
              <div className="h-40 w-full relative">
                {coverImage ? (
                  <img src={coverImage} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${accentColor}33, ${primaryColor}55)` }} />
                )}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(7,8,10,0.95), rgba(7,8,10,0.15))' }} />

                {/* Status bar */}
                <div className="absolute top-2 inset-x-3 flex items-center justify-between text-[8px] text-luxury-200/90 font-mono">
                  <span>9:41</span>
                  <span className="w-16 h-3.5 rounded-full bg-black/60 border border-luxury-700" />
                </div>

                {/* Brand row */}
                <div className="absolute bottom-3 inset-x-4 flex items-end gap-3">
                  <div
                    className="w-12 h-12 rounded-2xl overflow-hidden flex items-center justify-center border-2 shadow-lg shrink-0 text-lg font-serif font-bold text-white"
                    style={{
                      background: logoPreview ? 'transparent' : `linear-gradient(135deg, ${primaryColor}, ${accentColor})`,
                      borderColor: `${primaryColor}99`,
                    }}
                  >
                    {logoPreview ? (
                      <img src={logoPreview} alt="" className="w-full h-full object-cover" />
                    ) : (
                      (nameEn.charAt(0) || 'م')
                    )}
                  </div>
                  <div className="min-w-0 pb-0.5">
                    <div className="text-sm font-serif font-bold text-white truncate">{name || 'اسم المطعم'}</div>
                    <div className="text-[9px] text-luxury-300 truncate">{nameEn || 'Restaurant Name'}</div>
                  </div>
                </div>
              </div>

              {/* Rating chip */}
              <div className="absolute top-9 left-3 flex items-center gap-1 px-2 py-1 rounded-full bg-black/55 border border-white/15 backdrop-blur text-[9px] text-amber-300 font-bold">
                <Star className="w-2.5 h-2.5 fill-amber-300" /> 4.9
              </div>

              {/* Menu body */}
              <div className="p-3.5 space-y-2.5">
                {/* category chips */}
                <div className="flex gap-1.5 overflow-hidden">
                  {['الأطباق الرئيسية', 'مشاوي', 'مقبلات'].map((c) => (
                    <span
                      key={c}
                      className="px-2.5 py-1 rounded-full text-[9px] font-bold whitespace-nowrap text-white"
                      style={{ background: `${primaryColor}22`, color: primaryColor, border: `1px solid ${primaryColor}55` }}
                    >
                      {c}
                    </span>
                  ))}
                </div>

                {[
                  { n: 'تندرلوين مشوي مع صوص الترافل', p: 135 },
                  { n: 'مقبلات البحر المتوسط الملكية', p: 85 },
                ].map((dish, i) => (
                  <div key={i} className="flex items-center gap-2.5 bg-luxury-900/90 border border-luxury-800 rounded-xl p-2">
                    <div
                      className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center text-white/90 text-lg"
                      style={{ background: `linear-gradient(135deg, ${accentColor}55, ${primaryColor}88)` }}
                    >
                      <UtensilsCrossed className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold text-luxury-100 truncate">{dish.n}</div>
                      <div className="text-[9px] text-luxury-400 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" /> 15-20 دقيقة
                      </div>
                      <div className="text-[10px] font-bold mt-0.5" style={{ color: primaryColor }}>
                        {currency} {dish.p}
                      </div>
                    </div>
                    <button
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-white font-bold shrink-0"
                      style={{ background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})` }}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                ))}

                {/* fake bottom nav */}
                <div className="flex items-center justify-around pt-2 border-t border-luxury-800 text-luxury-500">
                  <span className="flex flex-col items-center gap-0.5">
                    <UtensilsCrossed className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                    <span className="text-[7px]">المنيو</span>
                  </span>
                  <span className="flex flex-col items-center gap-0.5 text-luxury-400">
                    <Star className="w-3.5 h-3.5" />
                    <span className="text-[7px]">العروض</span>
                  </span>
                  <span className="flex flex-col items-center gap-0.5 text-luxury-400">
                    <Phone className="w-3.5 h-3.5" />
                    <span className="text-[7px]">اتصل بنا</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-luxury-500 text-center px-4 leading-relaxed">
            المعاينة تُظهر الألوان والشعار والغلاف التي سيراها العميل فور مسح رمز QR —
            اضغط «حفظ ونشر الهوية الجديدة» لتطبيقها على موقعك الحقيقي.
          </p>
        </div>
      </div>
    </div>
  );
};
