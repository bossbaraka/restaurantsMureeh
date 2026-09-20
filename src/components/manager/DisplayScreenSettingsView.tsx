import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { api, isEmbeddedImage } from '../../services/api';
import { optimizeImageFile } from '../../utils/imageOptimize';
import { DISPLAY_FONT_PRESETS, SIGNAGE_MIN_WIDTH } from '../display/liveMenuModel';
import type {
  DisplayBackgroundMode,
  DisplayFontKey,
  Restaurant,
} from '../../types/restaurant';
import {
  Check,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Info,
  Loader2,
  MonitorPlay,
  Save,
  Smartphone,
  Sparkles,
  Trash2,
  Tv,
  Type,
  Upload,
} from 'lucide-react';

/**
 * شاشة العرض — إعدادات القائمة للقراءة فقط (Display screen settings)
 * =================================================================
 * The venue's own board: the same read-only menu the guest sees on the TV, on
 * the phone and on the tablet. This screen edits exactly the two things the
 * venue owns about it and nothing else:
 *
 *   1. the BACKGROUND — «من الثيم» (the venue's own brand canvas, the default)
 *      or «صورة» (a photograph the venue uploads), and
 *   2. the FONT — the display face of the whole board.
 *
 * Everything else about the board is derived, not configured: the palette,
 * density, imagery and rhythm come from the venue's own identity, and the
 * large-screen rule (automatic film on a TV/desktop, a static read-only menu on
 * a phone or tablet) is a property of the device, shown here as information —
 * never a switch the venue could use to allow ordering on the board.
 *
 * The write path is the existing branding save (`PUT /manager/branding`): the
 * backdrop goes through the same storage-reference contract as the logo and the
 * cover, and the font is one of the families the product ships.
 */

const BACKGROUND_MODES: Array<{
  id: DisplayBackgroundMode;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'theme',
    label: 'من الثيم',
    desc: 'كانفاس المطعم بألوان الهوية وتدرجاتها — بلا صورة (الافتراضي).',
    icon: Sparkles,
  },
  {
    id: 'image',
    label: 'صورة',
    desc: 'صورة من المطعم خلف القائمة كاملة، مع تعتيم يحفظ وضوح الأسعار.',
    icon: ImageIcon,
  },
];

const FONT_OPTIONS: Array<{
  id: DisplayFontKey;
  label: string;
  desc: string;
  /** CSS families used only for the live sample in this screen. */
  titleFace: string;
}> = [
  {
    id: 'auto',
    label: 'خط الهوية (تلقائي)',
    desc: 'يُختار من ألوان مطعمك وصوره — نفس هوية الشاشة الحالية.',
    titleFace: "'Tajawal', 'Cairo', sans-serif",
  },
  ...Object.values(DISPLAY_FONT_PRESETS).map((preset) => ({
    id: preset.key as DisplayFontKey,
    label: preset.label,
    desc: 'خط ثابت لكل الشاشة: العناوين والنصوص.',
    titleFace: preset.titleFace,
  })),
];

export const DisplayScreenSettingsView: React.FC = () => {
  const { currentRestaurant, setCurrentRestaurant, refreshTenantData, showToast } = useRestaurant();

  const saved = currentRestaurant?.display;
  const [backgroundMode, setBackgroundMode] = useState<DisplayBackgroundMode>(
    saved?.backgroundMode ?? 'theme'
  );
  const [backgroundImage, setBackgroundImage] = useState(saved?.backgroundImage ?? '');
  const [font, setFont] = useState<DisplayFontKey>(saved?.font ?? 'auto');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const lastRestaurantIdRef = useRef<string>('');
  // Unsaved edits on the current restaurant are never overwritten by a
  // background sync (same rule as the identity screen).
  const isDirtyRef = useRef(false);

  useEffect(() => {
    if (!currentRestaurant) return;
    const isDifferentTenant = lastRestaurantIdRef.current !== currentRestaurant.id;
    if (!isDifferentTenant && isDirtyRef.current) return;
    lastRestaurantIdRef.current = currentRestaurant.id;
    isDirtyRef.current = false;
    const display = currentRestaurant.display;
    setBackgroundMode(display?.backgroundMode ?? 'theme');
    setBackgroundImage(display?.backgroundImage ?? '');
    setFont(display?.font ?? 'auto');
  }, [currentRestaurant]);

  const displayUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/r/${currentRestaurant?.slug || ''}?view=display`;
  }, [currentRestaurant?.slug]);

  if (!currentRestaurant) return null;

  const markDirty = () => {
    isDirtyRef.current = true;
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const handleUpload = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'صيغة غير مدعومة', 'يرجى اختيار صورة JPG أو PNG أو WEBP');
      return;
    }
    setIsUploading(true);
    try {
      const { blob, ext } = await optimizeImageFile(file, 'cover');
      const res = await api.uploadImage(
        blob,
        `display-background-${Date.now()}.${ext}`,
        'cover',
        currentRestaurant.id
      );
      if (!res.success || !res.data) {
        showToast('error', 'تعذر رفع الصورة إلى الخادم', res.error);
        return;
      }
      setBackgroundImage(res.data.url);
      setBackgroundMode('image');
      markDirty();
      showToast('success', 'تم رفع الخلفية', 'اضغط «حفظ إعدادات الشاشة» لتطبيقها على شاشة العرض.');
    } catch {
      showToast('error', 'تعذر معالجة الصورة', 'تعذر قراءة الملف أو ضغطه');
    } finally {
      setIsUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  const handleClearBackground = () => {
    // '' is the explicit clear: the server writes NULL and the board returns to
    // its themed canvas.
    setBackgroundImage('');
    setBackgroundMode('theme');
    markDirty();
  };

  const handleSave = async () => {
    if (backgroundMode === 'image' && !backgroundImage.trim()) {
      showToast('error', 'لا توجد صورة للخلفية', 'ارفع صورة أولاً أو اختر «من الثيم»');
      return;
    }
    if (isEmbeddedImage(backgroundImage)) {
      showToast(
        'error',
        'تعذر حفظ إعدادات الشاشة',
        'الصورة مخزنة كنص ثقيل (base64) — أعد رفعها عبر زر الرفع من جهازك ثم احفظ مجدداً'
      );
      return;
    }
    const patch: Partial<Restaurant> = {
      display: {
        backgroundMode,
        backgroundImage: backgroundImage.trim(),
        font,
      },
    };
    setIsSaving(true);
    const res = await api.saveBranding(currentRestaurant.id, patch);
    setIsSaving(false);
    if (!res.success || !res.data) {
      showToast('error', 'تعذر حفظ إعدادات الشاشة', res.error || 'يرجى المحاولة لاحقاً');
      return;
    }
    isDirtyRef.current = false;
    setCurrentRestaurant(res.data.restaurant);
    refreshTenantData();
    showToast(
      'success',
      'تم حفظ إعدادات شاشة العرض',
      'ستظهر الخلفية والخط على شاشة العرض مباشرة (تلفاز، هاتف أو آيباد).'
    );
  };

  return (
    <div className="space-y-5 text-right">
      {/* ===== Header ===== */}
      <header className="rounded-2xl bg-luxury-900 border border-luxury-800 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-11 h-11 rounded-xl bg-gold-500/15 border border-gold-500/30 flex items-center justify-center text-gold-400 shrink-0">
              <MonitorPlay className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-luxury-50 font-serif">شاشة العرض (للقراءة فقط)</h2>
              <p className="text-xs text-luxury-400 mt-1 leading-relaxed">
                خلفية القائمة وخطها كما تظهر على شاشة المطعم. الشاشة للعرض فقط: لا سلة ولا
                طلب — الطلب يبقى عبر رمز QR على الطاولة.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={displayUrl || undefined}
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2.5 rounded-xl bg-luxury-850 hover:bg-luxury-800 border border-luxury-750 text-luxury-100 text-xs font-bold flex items-center gap-2 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-gold-400" />
              فتح المعاينة
            </a>
            <button
              type="button"
              onClick={copyLink}
              className="px-3.5 py-2.5 rounded-xl bg-luxury-850 hover:bg-luxury-800 border border-luxury-750 text-luxury-200 text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'تم النسخ' : 'نسخ الرابط'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-luxury-950/60 border border-luxury-800 px-3.5 py-3 flex items-center gap-2.5">
            <Tv className="w-4 h-4 text-gold-400 shrink-0" />
            <div className="min-w-0">
              <span className="block text-[11px] font-bold text-luxury-100">
                تلفاز وحاسوب (شاشة كبيرة)
              </span>
              <span className="block text-[10px] text-luxury-400 leading-relaxed">
                معاينة تلقائية متتابعة للأقسام على مدار الساعة.
              </span>
            </div>
          </div>
          <div className="rounded-xl bg-luxury-950/60 border border-luxury-800 px-3.5 py-3 flex items-center gap-2.5">
            <Smartphone className="w-4 h-4 text-gold-400 shrink-0" />
            <div className="min-w-0">
              <span className="block text-[11px] font-bold text-luxury-100">هاتف وآيباد</span>
              <span className="block text-[10px] text-luxury-400 leading-relaxed">
                قائمة ثابتة تُقرأ بأصابعك، بلا تشغيل تلقائي وبلا أي طلب.
              </span>
            </div>
          </div>
        </div>
        <p className="mt-2.5 text-[10px] text-luxury-500 flex items-center gap-1.5">
          <Info className="w-3 h-3 shrink-0" />
          القاعدة تُطبَّق تلقائياً حسب جهاز العرض: الشاشة الكبيرة بلا لمس ({SIGNAGE_MIN_WIDTH}px
          وأكثر = تلفاز أو حاسوب) تعرض المعاينة التلقائية، والهاتف أو الآيباد يعرض القائمة
          الثابتة — ولا يمكن تنفيذ أي طلب من الشاشة في كل الأحوال.
        </p>
      </header>

      {/* ===== Background ===== */}
      <section className="rounded-2xl bg-luxury-900 border border-luxury-800 p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <ImageIcon className="w-4 h-4 text-gold-400" />
          <h3 className="text-sm font-bold text-luxury-50">خلفية الشاشة</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {BACKGROUND_MODES.map((mode) => {
            const isActive = backgroundMode === mode.id;
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => {
                  setBackgroundMode(mode.id);
                  isDirtyRef.current = true;
                }}
                className={`p-3.5 rounded-2xl border text-right transition-all active:scale-[0.99] cursor-pointer ${
                  isActive
                    ? 'bg-gold-500/10 border-gold-500/50'
                    : 'bg-luxury-850/60 border-luxury-800 hover:border-gold-500/30'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isActive
                        ? 'bg-gold-500 text-luxury-950'
                        : 'bg-luxury-900 text-gold-400 border border-luxury-750'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className={`text-xs font-bold ${isActive ? 'text-gold-200' : 'text-luxury-100'}`}>
                    {mode.label}
                  </span>
                  {isActive && <Check className="w-3.5 h-3.5 text-gold-400 ms-auto" />}
                </div>
                <p className="mt-2 text-[10px] text-luxury-400 leading-relaxed">{mode.desc}</p>
              </button>
            );
          })}
        </div>

        {backgroundMode === 'image' && (
          <div className="rounded-2xl bg-luxury-950/60 border border-luxury-800 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => uploadRef.current?.click()}
                disabled={isUploading}
                className="px-3.5 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 disabled:opacity-60 text-luxury-950 text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
              >
                {isUploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {isUploading ? 'جارٍ الرفع…' : 'رفع صورة من الجهاز'}
              </button>
              {backgroundImage && (
                <button
                  type="button"
                  onClick={handleClearBackground}
                  className="px-3.5 py-2.5 rounded-xl bg-luxury-850 hover:bg-luxury-800 border border-luxury-750 text-luxury-300 hover:text-red-400 text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  إزالة الصورة
                </button>
              )}
              <input
                ref={uploadRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files?.[0])}
              />
            </div>

            {backgroundImage ? (
              <div className="rounded-xl overflow-hidden border border-luxury-800 bg-luxury-950">
                <img
                  src={backgroundImage}
                  alt="خلفية شاشة العرض"
                  className="w-full h-40 object-cover"
                />
              </div>
            ) : (
              <p className="text-[11px] text-luxury-400 leading-relaxed">
                لم تُرفع صورة بعد — الشاشة تعمل الآن على خلفية الثيم حتى ترفع صورة وتحفظ.
              </p>
            )}
            <p className="text-[10px] text-luxury-500 leading-relaxed">
              يُفضّل صورة أفقية عريضة (نسبة 16:9) عالية الجودة؛ يتم ضغطها تلقائياً قبل الرفع.
            </p>
          </div>
        )}
      </section>

      {/* ===== Fonts ===== */}
      <section className="rounded-2xl bg-luxury-900 border border-luxury-800 p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Type className="w-4 h-4 text-gold-400" />
          <h3 className="text-sm font-bold text-luxury-50">خط شاشة العرض</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {FONT_OPTIONS.map((option) => {
            const isActive = font === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => {
                  setFont(option.id);
                  isDirtyRef.current = true;
                }}
                className={`p-3.5 rounded-2xl border text-right transition-all active:scale-[0.99] cursor-pointer ${
                  isActive
                    ? 'bg-gold-500/10 border-gold-500/50'
                    : 'bg-luxury-850/60 border-luxury-800 hover:border-gold-500/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-bold ${isActive ? 'text-gold-200' : 'text-luxury-100'}`}>
                    {option.label}
                  </span>
                  {isActive && <Check className="w-3.5 h-3.5 text-gold-400 shrink-0" />}
                </div>
                <span
                  className="block mt-2 text-xl text-luxury-50 leading-snug"
                  style={{ fontFamily: option.titleFace }}
                >
                  حمص بالصنوبر — ₪24
                </span>
                <p className="mt-1.5 text-[10px] text-luxury-400 leading-relaxed">{option.desc}</p>
              </button>
            );
          })}
        </div>

        <p className="text-[10px] text-luxury-500 leading-relaxed">
          الخط يُطبَّق على عناوين الأقسام وأسماء الأطباق والأسعار في شاشة العرض فقط — منيو
          الطلب عبر QR يبقى بخط النظام.
        </p>
      </section>

      {/* ===== Save ===== */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="px-5 py-3 rounded-xl bg-gold-500 hover:bg-gold-400 disabled:opacity-60 text-luxury-950 text-sm font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-gold-glow"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isSaving ? 'جارٍ الحفظ…' : 'حفظ إعدادات الشاشة'}
        </button>
      </div>
    </div>
  );
};

export default DisplayScreenSettingsView;
