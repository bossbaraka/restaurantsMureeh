import React, { useState, useEffect, useRef } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { api, isEmbeddedImage } from '../../services/api';
import { applyBrandTheme, getCachedBrandTheme } from '../../theme/brandTheme';
import {
  AlertTriangle,
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
  Video,
  Film,
  Camera,
  Trash2,
  Eye,
  Coffee,
  Croissant,
} from 'lucide-react';
import type { BusinessType } from '../../types/restaurant';

/**
 * Venue kinds. Selecting one changes how the guest QR experience is composed,
 * so the manager picks it here next to the rest of the restaurant's identity.
 */
const BUSINESS_TYPES: Array<{
  id: BusinessType;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'RESTAURANT',
    label: 'مطعم',
    desc: 'طلب من الطاولة + نداء النادل',
    icon: UtensilsCrossed,
  },
  { id: 'CAFE', label: 'كافيه', desc: 'طلب سريع + تيك أواي', icon: Coffee },
  { id: 'BAKERY', label: 'مخبز / مشروع طعام', desc: 'استعراض منتجات + استلام', icon: Croissant },
];

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

/**
 * Logo framing presets. A 3×3 grid maps to CSS `object-position` anchors so a
 * manager can keep the focal point of a wide/tall logo visible inside the
 * fixed square box, instead of having it cropped awkwardly.
 */
const LOGO_POSITION_GRID: Array<{ label: string; value: string }> = [
  // Rendered inside a dir="rtl" page, so the grid flows right-to-left: the
  // first cell of each row sits on the RIGHT, matching its label. The stored
  // value is a physical CSS object-position (0% = left, 100% = right).
  { label: 'أعلى يمين', value: '100% 0%' },
  { label: 'أعلى وسط', value: '50% 0%' },
  { label: 'أعلى يسار', value: '0% 0%' },
  { label: 'وسط يمين', value: '100% 50%' },
  { label: 'وسط المنتصف', value: '50% 50%' },
  { label: 'وسط يسار', value: '0% 50%' },
  { label: 'أسفل يمين', value: '100% 100%' },
  { label: 'أسفل وسط', value: '50% 100%' },
  { label: 'أسفل يسار', value: '0% 100%' },
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

  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [mapImage, setMapImage] = useState('');
  const [logo, setLogo] = useState('');
  const [logoFit, setLogoFit] = useState<'cover' | 'contain'>('cover');
  const [logoPosition, setLogoPosition] = useState('50% 50%');
  const [coverImage, setCoverImage] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');
  const [accentColor, setAccentColor] = useState('#C5A880');
  const [businessType, setBusinessType] = useState<BusinessType>('RESTAURANT');
  const [promoVideoUrl, setPromoVideoUrl] = useState('');
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [newGalleryUrl, setNewGalleryUrl] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [uploadingMap, setUploadingMap] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentRestaurant) {
      setName(currentRestaurant.name);
      setNameEn(currentRestaurant.nameEn);
      setDescription(currentRestaurant.description);
      setPhone(currentRestaurant.phone);
      setAddress(currentRestaurant.address);
      setMapImage(currentRestaurant.mapImageUrl || '');
      setLogo(currentRestaurant.logo);
      setLogoFit(currentRestaurant.logoFit === 'contain' ? 'contain' : 'cover');
      setLogoPosition(currentRestaurant.logoPosition || '50% 50%');
      setCoverImage(currentRestaurant.coverImage || '');
      const prim = currentRestaurant.primaryColor || '#D4AF37';
      const acc = currentRestaurant.accentColor || '#C5A880';
      setPrimaryColor(prim);
      setAccentColor(acc);
      // Automatically detect and select matching preset
      const matched = THEME_PRESETS.find(
        (p) => p.primary.toLowerCase() === prim.toLowerCase() && p.accent.toLowerCase() === acc.toLowerCase()
      );
      if (matched) {
        setActivePreset(matched.id);
      } else {
        const cached = getCachedBrandTheme();
        if (cached?.presetId) {
          setActivePreset(cached.presetId);
        }
      }
      setBusinessType(currentRestaurant.businessType || 'RESTAURANT');
      setPromoVideoUrl(currentRestaurant.promoVideoUrl || '');
      setGalleryImages(currentRestaurant.galleryImages || []);
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
    applyBrandTheme(preset.primary, preset.accent, null, {
      presetId,
      restaurantId: currentRestaurant?.id,
      slug: currentRestaurant?.slug,
    });
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
      const res = await api.uploadImage(blob, `brand-${kind}-${Date.now()}.${ext}`, kind, currentRestaurant.id);
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

  const handleAddGalleryImage = () => {
    if (!newGalleryUrl.trim()) return;
    setGalleryImages((prev) => [...prev, newGalleryUrl.trim()]);
    setNewGalleryUrl('');
  };

  const handleRemoveGalleryImage = (index: number) => {
    setGalleryImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUploadGalleryFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'صيغة غير مدعومة', 'يرجى اختيار صورة JPG أو PNG أو WEBP');
      return;
    }
    setUploadingGallery(true);
    try {
      const { blob, ext } = await fileToResizedBlob(file, 1600);
      const res = await api.uploadImage(blob, `hall-gallery-${Date.now()}.${ext}`, 'gallery', currentRestaurant.id);
      if (!res.success || !res.data) {
        showToast('error', 'تعذر رفع الصورة', res.error);
        return;
      }
      setGalleryImages((prev) => [...prev, res.data.url]);
      showToast('success', 'تم إضافة الصورة لمعرض الصالة', 'احفظ التعديلات لتنعكس على المنيو');
    } catch {
      showToast('error', 'تعذر معالجة الصورة', 'تعذر قراءة الملف');
    } finally {
      setUploadingGallery(false);
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const handleUploadMap = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'صيغة غير مدعومة', 'يرجى اختيار صورة JPG أو PNG أو WEBP');
      return;
    }
    setUploadingMap(true);
    try {
      const { blob, ext } = await fileToResizedBlob(file, 1200);
      const res = await api.uploadImage(blob, `map-${Date.now()}.${ext}`, 'map', currentRestaurant.id);
      if (!res.success || !res.data) {
        showToast('error', 'تعذر رفع صورة الخريطة', res.error);
        return;
      }
      setMapImage(res.data.url);
      showToast('success', 'تم رفع صورة الخريطة', 'احفظ التعديلات لتظهر خريطة موقعك للعملاء');
    } catch {
      showToast('error', 'تعذر معالجة الصورة', 'تعذر قراءة الملف');
    } finally {
      setUploadingMap(false);
      if (mapInputRef.current) mapInputRef.current.value = '';
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!currentRestaurant || isSaving) return;

    // A base64 data URL in any image field would 413 the save (server JSON
    // limit is 1MB) — stop here with guidance instead of a failed request.
    if (
      isEmbeddedImage(logo) ||
      isEmbeddedImage(coverImage) ||
      galleryImages.some((u) => isEmbeddedImage(u))
    ) {
      showToast('error', 'تعذر حفظ الهوية البصرية', 'إحدى الصور مخزنة كنص ثقيل (base64) — أعد رفعها عبر أزرار الرفع من جهازك ثم اضغط حفظ مجدداً');
      return;
    }

    setIsSaving(true);
    const res = await api.saveBranding(currentRestaurant.id, {
      name: name.trim(),
      nameEn: nameEn.trim(),
      description: description.trim(),
      phone: phone.trim(),
      address: address.trim(),
      mapImageUrl: mapImage.trim(),
      logo: logo.trim(),
      logoFit,
      logoPosition,
      coverImage: coverImage.trim(),
      primaryColor,
      accentColor,
      businessType,
      promoVideoUrl: promoVideoUrl.trim(),
      galleryImages,
    });
    setIsSaving(false);
    if (!res.success || !res.data) {
      showToast('error', 'تعذر حفظ الهوية البصرية', res.error || 'يرجى المحاولة لاحقاً');
      return;
    }
    setCurrentRestaurant(res.data.restaurant);
    applyBrandTheme(res.data.restaurant.primaryColor, res.data.restaurant.accentColor, null, {
      presetId: activePreset || undefined,
      restaurantId: res.data.restaurant.id,
      slug: res.data.restaurant.slug,
    });
    refreshTenantData();
    showToast('success', 'تم حفظ إعدادات الهوية بنجاح', 'تم تثبيت وتطبيق ألوان الـ Theme والشعار والمعرض مباشرة عبر النظام.');
  };

  const currency = currentRestaurant.currency || '₪';
  const logoPreview = logo || currentRestaurant.logo || '';

  // Images stored with the legacy base64 flow must be re-uploaded before the
  // next save, otherwise the save is blocked by the guards above.
  const hasLegacyEmbeddedImages =
    isEmbeddedImage(logoPreview) ||
    isEmbeddedImage(coverImage) ||
    galleryImages.some((u) => isEmbeddedImage(u));

  return (
    <div className="space-y-6 text-right max-w-6xl" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <Palette className="w-5 h-5 text-gold-400" />
            <span>هوية مطعمك — الشعار والألوان والمعرض والفيديو</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            تحديث الهوية البصرية، إرفاق صور صالة المطعم، وفيديو الأجواء لتظهر مباشرة للعميل عند مسح كود QR
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

      {hasLegacyEmbeddedImages && (
        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 text-xs leading-relaxed">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-amber-200">
            <span className="font-bold">تنبيه: بعض الصور مخزنة بالصيغة القديمة الثقيلة</span> ولن يكتمل الحفظ قبل معالجتها —
            أعد رفع الشعار / الغلاف / صور الصالة عبر أزرار الرفع من جهازك (ستُحفظ كروابط خفيفة)، ثم اضغط «حفظ ونشر الهوية الجديدة».
          </p>
        </div>
      )}

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
                <label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-f1">اسم المطعم (بالعربية)</label>
                <input id="brandingsettingsview-f1"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60"
                />
              </div>
              <div>
                <label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-f2">الاسم بالإنجليزية</label>
                <input id="brandingsettingsview-f2"
                  type="text"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60"
                />
              </div>
            </div>
            <div>
              <label className="block font-bold text-luxury-200 mb-1" htmlFor="brandingsettingsview-f3">الوصف (يظهر للعميل تحت اسم المطعم)</label>
              <textarea id="brandingsettingsview-f3"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60 resize-none"
              />
            </div>

            {/* Venue kind — decides how the guest QR experience is composed */}
            <div>
              <span className="block font-bold text-luxury-200 mb-1.5">
                نوع النشاط (يشكّل شاشة الترحيب التي يراها العميل بعد مسح QR)
              </span>
              <div
                role="radiogroup"
                aria-label="نوع النشاط"
                className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
              >
                {BUSINESS_TYPES.map((type) => {
                  const Icon = type.icon;
                  const selected = businessType === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setBusinessType(type.id)}
                      className={`p-3 rounded-xl border text-right transition-all flex items-start gap-2.5 cursor-pointer ${
                        selected
                          ? 'bg-luxury-800 border-gold-500/70 shadow-[0_0_22px_-8px_rgba(212,175,55,0.5)]'
                          : 'bg-luxury-950 border-luxury-800 hover:border-luxury-700'
                      }`}
                    >
                      <Icon
                        className={`w-5 h-5 mt-0.5 shrink-0 ${selected ? 'text-gold-400' : 'text-luxury-400'}`}
                      />
                      <span>
                        <span className="block text-luxury-100 font-bold text-sm">{type.label}</span>
                        <span className="block text-[10px] text-luxury-400 leading-relaxed">
                          {type.desc}
                        </span>
                      </span>
                      {selected && <Check className="w-4 h-4 text-gold-400 mr-auto shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-luxury-200 mb-1 flex items-center gap-1" htmlFor="brandingsettingsview-f4">
                  <Phone className="w-3.5 h-3.5 text-gold-400" /> رقم الهاتف للتواصل
                </label>
                <input id="brandingsettingsview-f4"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-bold text-luxury-200 mb-1 flex items-center gap-1" htmlFor="brandingsettingsview-f5">
                  <MapPin className="w-3.5 h-3.5 text-gold-400" /> العنوان والفرع
                </label>
                <input id="brandingsettingsview-f5"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
                  placeholder="مثال: شارع الإرسال، رام الله"
                />
              </div>
            </div>

            {/* Map Image (replaces the Google Maps link) */}
            <div className="pt-2 border-t border-luxury-850 space-y-3">
              <div className="flex items-center justify-between">
                <label className="block font-bold text-luxury-200 mb-1 flex items-center gap-1" htmlFor="brandingsettingsview-map">
                  <MapPin className="w-3.5 h-3.5 text-gold-400" /> صورة الخريطة (موقع المطعم)
                </label>
                <span className="text-[10px] text-luxury-500">اختياري — تظهر للعملاء بدل الخريطة الخارجية</span>
              </div>
              <div className="h-36 rounded-xl overflow-hidden border border-luxury-700 bg-luxury-900 flex items-center justify-center">
                {mapImage ? (
                  <img src={mapImage} alt="خريطة الموقع" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px] text-luxury-500">لا توجد صورة خريطة بعد</span>
                )}
              </div>
              <div className="space-y-2">
                <input
                  ref={mapInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => handleUploadMap(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => mapInputRef.current?.click()}
                  disabled={uploadingMap}
                  className="w-full py-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 border border-luxury-700 text-luxury-100 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {uploadingMap ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 text-gold-400" />}
                  {uploadingMap ? 'جاري رفع صورة الخريطة...' : mapImage ? 'استبدال صورة الخريطة' : 'رفع صورة خريطة من الجهاز'}
                </button>
                {mapImage && (
                  <button
                    type="button"
                    onClick={() => setMapImage('')}
                    className="w-full py-2 rounded-xl bg-luxury-900 hover:bg-luxury-800 border border-luxury-700 text-luxury-400 text-xs flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    إزالة صورة الخريطة
                  </button>
                )}
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
                  <label className="block font-bold text-luxury-200" htmlFor="brandingsettingsview-f9">شعار المطعم / الكافيه</label>
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
                      <img
                        src={logoPreview}
                        alt={name}
                        className="w-full h-full"
                        style={{ objectFit: logoFit, objectPosition: logoPosition }}
                      />
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
                  <input id="brandingsettingsview-f9"
                    type="url"
                    dir="ltr"
                    value={logo}
                    onChange={(e) => setLogo(e.target.value)}
                    placeholder="https://…"
                    className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2 rounded-lg focus:border-gold-500/60 text-left"
                  />
                </div>

                {/* Logo framing controls — make the logo appear regularly */}
                {logoPreview && (
                  <div className="pt-3 border-t border-luxury-800 space-y-3">
                    <div>
                      <span className="block text-luxury-300 font-bold mb-1.5">طريقة إظهار الشعار داخل الصندوق</span>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setLogoFit('cover')}
                          className={`px-3 py-2 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer ${
                            logoFit === 'cover'
                              ? 'bg-gold-500/15 border-gold-500/60 text-gold-300'
                              : 'bg-luxury-900 border-luxury-800 text-luxury-400 hover:text-luxury-200'
                          }`}
                        >
                          تغطية الصندوق (قصّ)
                        </button>
                        <button
                          type="button"
                          onClick={() => setLogoFit('contain')}
                          className={`px-3 py-2 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer ${
                            logoFit === 'contain'
                              ? 'bg-gold-500/15 border-gold-500/60 text-gold-300'
                              : 'bg-luxury-900 border-luxury-800 text-luxury-400 hover:text-luxury-200'
                          }`}
                        >
                          إظهار الشعار كاملاً
                        </button>
                      </div>
                    </div>

                    <div>
                      <span className="block text-luxury-300 font-bold mb-1.5">موضع الشعار (اتجاه القصّ أو التمركز)</span>
                      <div className="grid grid-cols-3 gap-1.5 w-full max-w-[150px]">
                        {LOGO_POSITION_GRID.map((cell) => {
                          const active = logoPosition === cell.value;
                          return (
                            <button
                              key={cell.value}
                              type="button"
                              title={cell.label}
                              aria-label={cell.label}
                              onClick={() => setLogoPosition(cell.value)}
                              className={`h-9 rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                                active
                                  ? 'bg-gold-500/20 border-gold-500/70'
                                  : 'bg-luxury-900 border-luxury-800 hover:border-luxury-600'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-gold-400' : 'bg-luxury-600'}`}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
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

          {/* PROMO VIDEO & INTERIOR HALL GALLERY */}
          <div className="bg-luxury-900 border border-luxury-800 rounded-2xl p-6 shadow-luxury space-y-5 text-xs">
            <h3 className="font-bold text-luxury-100 text-sm flex items-center gap-2">
              <Video className="w-4 h-4 text-gold-400" />
              فيديو ترويجي ومعرض صور أجواء صالة المطعم
            </h3>

            {/* Video Input */}
            <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-3">
              <div className="flex items-center justify-between">
                <label className="block font-bold text-luxury-200">رابط الفيديو الترويجي لصالة المطعم</label>
                <span className="text-[10px] text-luxury-500">رابط فيديو (MP4) أو فيديو YouTube</span>
              </div>
              <input
                type="url"
                dir="ltr"
                value={promoVideoUrl}
                onChange={(e) => setPromoVideoUrl(e.target.value)}
                placeholder="https://... or https://youtube.com/watch?v=..."
                className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60 font-mono text-[11px]"
              />
              {promoVideoUrl && (
                <div className="p-2.5 rounded-xl bg-luxury-900 border border-gold-500/30 flex items-center justify-between text-gold-300">
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <Film className="w-4 h-4 text-gold-400" />
                    سيظهر زر تشغيل فيديو الأجواء التفاعلي في المنيو لعملائك
                  </span>
                  <button
                    type="button"
                    onClick={() => setPromoVideoUrl('')}
                    className="text-red-400 hover:text-red-300 text-[11px]"
                  >
                    إزالة الفيديو
                  </button>
                </div>
              )}
            </div>

            {/* Gallery Uploader & List */}
            <div className="p-4 rounded-2xl bg-luxury-950 border border-luxury-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <label className="block font-bold text-luxury-200">صور صالة المطعم والأجواء ({galleryImages.length})</label>
                  <p className="text-[10px] text-luxury-400 mt-0.5">ارفع لقطات صالة الطعام والديكورات لعرضها في منيو الزبون عند مسح QR</p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => handleUploadGalleryFile(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={uploadingGallery}
                    className="px-3 py-1.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-gold-glow disabled:opacity-60 cursor-pointer"
                  >
                    {uploadingGallery ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>رفع صورة للصالة</span>
                  </button>
                </div>
              </div>

              {/* Paste URL inline */}
              <div className="flex gap-2">
                <input
                  type="url"
                  dir="ltr"
                  value={newGalleryUrl}
                  onChange={(e) => setNewGalleryUrl(e.target.value)}
                  placeholder="أو ألصق رابط صورة مباشر https://..."
                  className="flex-1 bg-luxury-900 border border-luxury-800 text-luxury-100 p-2 rounded-xl text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={handleAddGalleryImage}
                  className="px-3 py-2 bg-luxury-850 hover:bg-luxury-800 text-luxury-200 font-bold rounded-xl text-xs"
                >
                  إضافة رابط
                </button>
              </div>

              {/* Gallery Grid items */}
              {galleryImages.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  {galleryImages.map((url, i) => (
                    <div key={i} className="relative group rounded-xl overflow-hidden border border-luxury-800 h-24 bg-luxury-900">
                      <img src={url} alt={`صالة ${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemoveGalleryImage(i)}
                        className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/70 text-red-400 hover:bg-red-500 hover:text-white transition-colors"
                        title="حذف الصورة"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                      const next = e.target.value;
                      setPrimaryColor(next);
                      setActivePreset(null);
                      applyBrandTheme(next, accentColor);
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
                      const next = e.target.value;
                      setAccentColor(next);
                      setActivePreset(null);
                      applyBrandTheme(primaryColor, next);
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
                <div className="absolute top-2 inset-x-3 flex items-center justify-between text-[11px] text-luxury-200/90 font-mono">
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
                      <img
                        src={logoPreview}
                        alt=""
                        className="w-full h-full"
                        style={{ objectFit: logoFit, objectPosition: logoPosition }}
                      />
                    ) : (
                      (nameEn.charAt(0) || 'م')
                    )}
                  </div>
                  <div className="min-w-0 pb-0.5">
                    <div className="text-sm font-serif font-bold text-white truncate">{name || 'اسم المطعم'}</div>
                    <div className="text-[11px] text-luxury-300 truncate">{nameEn || 'Restaurant Name'}</div>
                  </div>
                </div>
              </div>

              {/* Gallery Preview Bar */}
              {galleryImages.length > 0 && (
                <div className="px-3 pt-2">
                  <div className="flex gap-1.5 overflow-hidden rounded-lg p-1 bg-luxury-900 border border-luxury-800">
                    {galleryImages.slice(0, 3).map((g, idx) => (
                      <img key={idx} src={g} alt="" className="w-10 h-8 rounded object-cover" />
                    ))}
                    {galleryImages.length > 3 && (
                      <span className="text-[11px] text-gold-400 self-center font-mono">+{galleryImages.length - 3}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Menu body */}
              <div className="p-3.5 space-y-2.5">
                {/* category chips */}
                <div className="flex gap-1.5 overflow-hidden">
                  {['الأطباق الرئيسية', 'مشاوي', 'مقبلات'].map((c) => (
                    <span
                      key={c}
                      className="px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap text-white"
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
                      <div className="text-[11px] text-luxury-400 flex items-center gap-1">
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
              </div>
            </div>
          </div>

          <p className="text-[10px] text-luxury-500 text-center px-4 leading-relaxed">
            المعاينة تُظهر الألوان والشعار ومعرض الصالة والفيديو التي سيراها العميل فور مسح كود QR —
            اضغط «حفظ ونشر الهوية الجديدة» لتطبيقها على منيو موقعك الحقيقي.
          </p>
        </div>
      </div>
    </div>
  );
};
