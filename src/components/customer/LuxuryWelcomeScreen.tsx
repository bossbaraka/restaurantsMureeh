import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import {
  Sparkles,
  ArrowLeft,
  MessageCircle,
  QrCode,
  ShieldCheck,
  PhoneCall,
  Award,
  ChefHat,
  Clock,
  Zap,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Maximize2,
  X,
  Star,
  Flame,
  LayoutGrid,
  Layers,
  Heart,
  Camera,
  Coffee,
  ShoppingBag,
} from 'lucide-react';
import { optimizeImageUrl } from './ProductImage';
import { soundFX } from '../../utils/audio';

interface LuxuryWelcomeScreenProps {
  onDismiss: () => void;
}

interface GallerySlide {
  id: string;
  name: string;
  nameEn?: string;
  price: number;
  image: string;
  category?: string;
  badge?: string;
  description?: string;
}

const FALLBACK_SHOWCASE_PHOTOS: GallerySlide[] = [
  {
    id: 'f1',
    name: 'قهوة مختصة فاخرة',
    nameEn: 'Signature Specialty Coffee',
    price: 12,
    image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=1200&q=85',
    category: 'القهوة والمشروبات',
    badge: 'توصية الشيف ✨',
    description: 'بن مختص محمص بعناية لتقديم أرقى درجات النكهة المتوازنة والعبق الفاخر.',
  },
  {
    id: 'f2',
    name: 'عصير طبيعي طازج ومثلج',
    nameEn: 'Artisanal Fresh Smoothie',
    price: 10,
    image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=1200&q=85',
    category: 'العصائر الطبيعية',
    badge: 'طازج ومنعش 🌿',
    description: 'فواكه طبيعية معصورة يومياً تمنحك انتعاشاً استثنائياً في كل رشفة.',
  },
  {
    id: 'f3',
    name: 'حلويات فريدة ومبتكرة',
    nameEn: 'Artisanal Dessert Creation',
    price: 18,
    image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=1200&q=85',
    category: 'الحلويات الفاخرة',
    badge: 'الأكثر طلباً 🔥',
    description: 'مزيج ساحر من الشوكولاتة البلجيكية والمكسرات المحمصة لإسعاد حواسك.',
  },
  {
    id: 'f4',
    name: 'أطباق الإفطار والعشاء الراقية',
    nameEn: 'Gourmet Dining Experience',
    price: 25,
    image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=85',
    category: 'المأكولات الفاخرة',
    badge: 'إبداع طهي متجدد ⭐',
    description: 'مكونات منتقاة بعناية وطهي احترافي يضمن تجربة تذوق ترتقي لتوقعاتك.',
  },
];

export const LuxuryWelcomeScreen: React.FC<LuxuryWelcomeScreenProps> = ({ onDismiss }) => {
  const { currentRestaurant, activeTableId, products, categories } = useRestaurant();
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isAutoPlay, setIsAutoPlay] = useState(true);
  const [lightboxImage, setLightboxImage] = useState<GallerySlide | null>(null);
  const [viewMode, setViewMode] = useState<'slider' | 'grid'>('slider');
  const touchStartXRef = useRef<number | null>(null);

  /**
   * Extract clean table number
   */
  const tableNumStr = useMemo(() => {
    if (!activeTableId) return '—';
    const digits = activeTableId.replace(/\D+/g, '');
    if (!digits) return activeTableId;
    const n = parseInt(digits, 10);
    return n < 10 ? `0${n}` : String(n);
  }, [activeTableId]);

  const restName = currentRestaurant?.name || 'مطعم مريح';
  const restNameEn = currentRestaurant?.nameEn || 'MUREEH DINING';
  const rawCoverImg =
    currentRestaurant?.coverImage ||
    'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85';
  const coverImg = optimizeImageUrl(rawCoverImg, 1280, 70);
  const logoImg = currentRestaurant?.logo ? optimizeImageUrl(currentRestaurant.logo, 180, 75) : '';
  const primaryCol = currentRestaurant?.primaryColor || '#D4AF37';
  const accentCol = currentRestaurant?.accentColor || '#C5A880';
  const currency = currentRestaurant?.currency || '₪';

  // Dynamic time-based welcoming message
  const timeGreeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      return {
        title: 'صباح النور والقهوة الفاخرة',
        sub: 'ابدأ يومك بنكهات أصيلة وأجواء صباحية استثنائية',
        badge: 'صباح الذواقة ☀️',
      };
    } else if (hour >= 12 && hour < 17) {
      return {
        title: 'أهلاً بك في رحاب الضيافة',
        sub: 'أوقات استثنائية وأطباق شهية تُحضر بكل شغف وإتقان',
        badge: 'غداء الذواقة 🍽️',
      };
    } else {
      return {
        title: 'مساء الأناقة والذوق الرفيع',
        sub: 'أمسية لا تُنسى في ضيافتنا وتجربة طعام متكاملة',
        badge: 'أمسية فاخرة ✨',
      };
    }
  }, []);

  // Build the culinary showcase photo album from real products or high-res fallbacks
  const gallerySlides = useMemo<GallerySlide[]>(() => {
    const productSlides: GallerySlide[] = (products || [])
      .filter((p) => p.image && p.image.trim().length > 10 && !p.image.includes('placeholder'))
      .slice(0, 8)
      .map((p) => {
        const cat = categories.find((c) => c.id === p.categoryId);
        return {
          id: p.id,
          name: p.name,
          nameEn: p.nameEn,
          price: p.price,
          image: p.image,
          category: cat ? cat.name : 'طبق فاخر',
          badge: p.badge || (p.isFeatured ? 'توصية الشيف ✨' : 'الأكثر طلباً 🔥'),
          description: p.description,
        };
      });

    if (productSlides.length >= 3) {
      return productSlides;
    }

    // Combine any available products with curated fallback showcase
    return [...productSlides, ...FALLBACK_SHOWCASE_PHOTOS].slice(0, 6);
  }, [products, categories]);

  // Slideshow auto-advance
  useEffect(() => {
    if (!isAutoPlay || gallerySlides.length <= 1 || viewMode !== 'slider') return;

    const timer = setInterval(() => {
      setActiveSlideIndex((prev) => (prev + 1) % gallerySlides.length);
    }, 3800);

    return () => clearInterval(timer);
  }, [isAutoPlay, gallerySlides.length, viewMode]);

  const handleNextSlide = () => {
    soundFX.playTap();
    setActiveSlideIndex((prev) => (prev + 1) % gallerySlides.length);
  };

  const handlePrevSlide = () => {
    soundFX.playTap();
    setActiveSlideIndex((prev) => (prev - 1 + gallerySlides.length) % gallerySlides.length);
  };

  const handleStart = () => {
    soundFX.playChime();
    setIsAnimatingOut(true);
    setTimeout(() => {
      onDismiss();
    }, 380);
  };

  // Touch Swipe Handlers for Photo Album
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
    if (Math.abs(deltaX) > 40) {
      if (deltaX > 0) {
        // Swipe right (in RTL this moves to previous or next depending on perspective)
        handlePrevSlide();
      } else {
        handleNextSlide();
      }
    }
    touchStartXRef.current = null;
  };

  const activeSlide = gallerySlides[activeSlideIndex] || gallerySlides[0];

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-between p-4 sm:p-7 bg-[#050608] text-luxury-50 transition-all duration-500 overflow-y-auto select-none ${
        isAnimatingOut ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'
      }`}
      dir="rtl"
    >
      {/* Background Cinematic Food Photography with Ambient SaaS Light Rays */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <img
          src={coverImg}
          alt={restName}
          loading="eager"
          decoding="async"
          {...({ fetchPriority: 'high' } as React.ImgHTMLAttributes<HTMLImageElement>)}
          className="w-full h-full object-cover object-center opacity-20 filter blur-[3px] scale-110 transform animate-pulse duration-10000"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050608] via-[#050608]/92 to-[#050608]/85" />
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            background: `radial-gradient(circle at 50% 15%, ${primaryCol}40 0%, transparent 70%)`,
          }}
        />
      </div>

      {/* Top Header Bar */}
      <div className="relative z-10 w-full max-w-2xl flex items-center justify-between text-xs animate-in fade-in slide-in-from-top-4 duration-700">
        <div
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-luxury-900/90 border backdrop-blur-xl shadow-2xl"
          style={{ borderColor: `${primaryCol}50`, color: primaryCol }}
        >
          <Sparkles className="w-4 h-4 animate-spin text-[var(--brand-primary-strong)]" />
          <span className="font-bold tracking-wide">منصة مريح MUREEH · تجربة طعام ذكية</span>
        </div>

        {activeTableId ? (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 font-mono text-xs backdrop-blur-xl shadow-lg">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-bold">طاولة {tableNumStr}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-luxury-900/80 border border-luxury-750 text-luxury-300 text-xs backdrop-blur-md">
            <QrCode className="w-3.5 h-3.5" style={{ color: primaryCol }} />
            <span>جلسة منيو تفاعلي</span>
          </div>
        )}
      </div>

      {/* Main Showcase Body */}
      <div className="relative z-10 my-auto text-center max-w-2xl w-full space-y-5 animate-in fade-in zoom-in-95 duration-700 py-3">
        {/* Glowing Monogram Logo & Personalized Dynamic Greeting */}
        <div className="space-y-3">
          <div className="relative inline-block group">
            <div
              className="absolute -inset-2 rounded-3xl opacity-75 blur-xl group-hover:opacity-100 transition duration-500 animate-pulse"
              style={{ background: `linear-gradient(135deg, ${primaryCol}, ${accentCol})` }}
            />
            <div
              className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-3xl mx-auto flex items-center justify-center overflow-hidden text-luxury-950 font-serif font-extrabold text-3xl sm:text-4xl shadow-2xl border-2 bg-luxury-950"
              style={{
                borderColor: `${primaryCol}90`,
                background: currentRestaurant?.logo
                  ? '#0A0B0D'
                  : `linear-gradient(135deg, ${primaryCol}, ${accentCol})`,
              }}
            >
              {logoImg ? (
                <img
                  src={logoImg}
                  alt={restName}
                  className="w-full h-full object-cover"
                  loading="eager"
                  decoding="async"
                />
              ) : (
                restNameEn.charAt(0) || 'M'
              )}
            </div>
          </div>

          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[11px] font-medium bg-luxury-900/80 border border-luxury-800 text-luxury-300">
              <span>{timeGreeting.badge}</span>
              <span className="text-luxury-600">·</span>
              <span>{timeGreeting.title}</span>
            </div>
            {/* A11Y-005: <h2> for screen readers while <h1> lives in CustomerHeader */}
            <h2 className="text-2xl sm:text-4xl font-black text-luxury-50 font-serif tracking-tight leading-tight drop-shadow-md">
              {restName}
            </h2>
            <p
              className="text-xs sm:text-sm font-serif tracking-widest uppercase font-bold"
              style={{ color: primaryCol }}
            >
              {restNameEn}
            </p>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* Creative Culinary Photo Album & Showcase                      */}
        {/* ------------------------------------------------------------- */}
        <div
          className="p-4 sm:p-5 rounded-3xl bg-luxury-900/90 border backdrop-blur-2xl shadow-2xl space-y-3.5 text-right relative overflow-hidden"
          style={{ borderColor: `${primaryCol}35` }}
          onMouseEnter={() => setIsAutoPlay(false)}
          onMouseLeave={() => setIsAutoPlay(true)}
        >
          {/* Header of the Photo Showcase */}
          <div className="flex items-center justify-between border-b border-luxury-800 pb-2.5">
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-xl flex items-center justify-center text-luxury-950 font-bold"
                style={{ background: `linear-gradient(135deg, ${primaryCol}, ${accentCol})` }}
              >
                <Camera className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-luxury-100 font-serif flex items-center gap-1.5">
                  <span>ألبوم الأطباق والمختارات الفاخرة</span>
                  <span className="text-[10px] font-sans px-2 py-0.2 rounded-full bg-luxury-800 text-luxury-300">
                    {gallerySlides.length} صور
                  </span>
                </h3>
              </div>
            </div>

            {/* Toggle View Mode */}
            <div className="flex items-center gap-1 bg-luxury-950/80 p-1 rounded-xl border border-luxury-800 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  soundFX.playTap();
                  setViewMode('slider');
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  viewMode === 'slider'
                    ? 'bg-luxury-800 text-luxury-100 font-bold shadow'
                    : 'text-luxury-400 hover:text-luxury-200'
                }`}
                title="عرض السلايدر المتحرك"
              >
                <Layers className="w-3 h-3" />
                <span className="hidden xs:inline">متنقل</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  soundFX.playTap();
                  setViewMode('grid');
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-luxury-800 text-luxury-100 font-bold shadow'
                    : 'text-luxury-400 hover:text-luxury-200'
                }`}
                title="عرض شبكة الصور"
              >
                <LayoutGrid className="w-3 h-3" />
                <span className="hidden xs:inline">شبكة</span>
              </button>
            </div>
          </div>

          {/* View Mode: Interactive Slider Carousel */}
          {viewMode === 'slider' && activeSlide && (
            <div
              className="space-y-3"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              {/* Featured Showcase Slide Card */}
              <div className="relative w-full h-52 sm:h-64 rounded-2xl overflow-hidden border border-luxury-800 group shadow-inner">
                <img
                  src={optimizeImageUrl(activeSlide.image, 900, 80)}
                  alt={activeSlide.name}
                  className="w-full h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
                  loading="eager"
                  decoding="async"
                />

                {/* Dark Vignette Gradients */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/30" />

                {/* Top Badges */}
                <div className="absolute top-3 inset-x-3 flex items-center justify-between z-10">
                  {activeSlide.badge && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-black/60 backdrop-blur-md border border-white/15 text-amber-300 shadow">
                      <Flame className="w-3 h-3 text-amber-400" />
                      <span>{activeSlide.badge}</span>
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setLightboxImage(activeSlide)}
                    className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 text-luxury-200 flex items-center justify-center transition-transform hover:scale-110 cursor-pointer"
                    title="تكبير الصورة"
                    aria-label="تكبير الصورة"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Navigation Arrows */}
                <button
                  type="button"
                  onClick={handlePrevSlide}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/55 hover:bg-black/85 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-all opacity-80 group-hover:opacity-100 hover:scale-110 cursor-pointer z-10"
                  aria-label="الصورة السابقة"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleNextSlide}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/55 hover:bg-black/85 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-all opacity-80 group-hover:opacity-100 hover:scale-110 cursor-pointer z-10"
                  aria-label="الصورة التالية"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                {/* Bottom Slide Info Card Overlay */}
                <div className="absolute bottom-3 inset-x-3 z-10 flex items-end justify-between gap-3 text-right">
                  <div className="space-y-0.5 max-w-[70%]">
                    {activeSlide.category && (
                      <span className="text-[10px] font-medium text-luxury-400 block">
                        {activeSlide.category}
                      </span>
                    )}
                    <h4 className="text-sm sm:text-base font-bold text-white tracking-tight drop-shadow">
                      {activeSlide.name}
                    </h4>
                    {activeSlide.nameEn && (
                      <p className="text-[10px] sm:text-xs text-luxury-300 font-sans opacity-90 truncate">
                        {activeSlide.nameEn}
                      </p>
                    )}
                  </div>

                  {activeSlide.price > 0 && (
                    <div
                      className="px-3 py-1.5 rounded-xl bg-black/70 backdrop-blur-md border border-amber-500/40 text-left shrink-0 shadow-lg"
                      style={{ color: primaryCol }}
                    >
                      <span className="text-[10px] text-luxury-400 block text-right font-sans">السعر</span>
                      <span className="text-sm sm:text-base font-black font-mono">
                        {currency} {activeSlide.price}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Thumbnails Navigation Strip */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 px-0.5 no-scrollbar">
                {gallerySlides.map((slide, index) => {
                  const isActive = index === activeSlideIndex;
                  return (
                    <button
                      key={slide.id}
                      type="button"
                      onClick={() => {
                        soundFX.playTap();
                        setActiveSlideIndex(index);
                      }}
                      className={`relative w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                        isActive
                          ? 'border-[var(--brand-primary)] scale-105 shadow-md shadow-[var(--brand-primary)]/20'
                          : 'border-luxury-800 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={optimizeImageUrl(slide.image, 120, 70)}
                        alt={slide.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                      {isActive && (
                        <div
                          className="absolute inset-0 border-2 rounded-xl pointer-events-none"
                          style={{ borderColor: primaryCol }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* View Mode: Creative Mini Gallery Grid */}
          {viewMode === 'grid' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto pr-1">
              {gallerySlides.map((slide, idx) => (
                <div
                  key={slide.id}
                  onClick={() => setLightboxImage(slide)}
                  className="group relative h-28 sm:h-32 rounded-xl overflow-hidden border border-luxury-800 bg-luxury-950 cursor-pointer transition-all hover:border-[var(--brand-primary)] hover:scale-[1.02]"
                >
                  <img
                    src={optimizeImageUrl(slide.image, 400, 75)}
                    alt={slide.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                  <div className="absolute bottom-1.5 inset-x-2 z-10 text-right">
                    <p className="text-[11px] font-bold text-white truncate drop-shadow">
                      {slide.name}
                    </p>
                    {slide.price > 0 && (
                      <span className="text-[10px] font-mono font-bold" style={{ color: primaryCol }}>
                        {currency} {slide.price}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 3 Interactive Experience Micro-stats */}
          <div className="pt-2 border-t border-luxury-800 grid grid-cols-3 gap-2 text-center text-luxury-300 text-[10px]">
            <div className="py-1 px-1.5 rounded-lg bg-luxury-950/60 border border-luxury-800 flex items-center justify-center gap-1">
              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
              <span>تقييم 4.9 ★</span>
            </div>
            <div className="py-1 px-1.5 rounded-lg bg-luxury-950/60 border border-luxury-800 flex items-center justify-center gap-1">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span>تحضير سريع</span>
            </div>
            <div className="py-1 px-1.5 rounded-lg bg-luxury-950/60 border border-luxury-800 flex items-center justify-center gap-1">
              <Award className="w-3 h-3 text-[var(--brand-primary)]" />
              <span>جودة وضيافة</span>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* SaaS Smart Service Features                                   */}
        {/* ------------------------------------------------------------- */}
        <div
          className="p-4 sm:p-5 rounded-3xl bg-luxury-900/80 border backdrop-blur-xl shadow-xl space-y-3 text-right"
          style={{ borderColor: `${primaryCol}30` }}
        >
          <div className="flex items-center justify-between border-b border-luxury-800 pb-2.5">
            <h3 className="text-xs sm:text-sm font-bold text-luxury-100 font-serif flex items-center gap-2">
              <Zap className="w-4 h-4" style={{ color: primaryCol }} />
              <span>مزايا الخدمة الذكية المباشرة عبر المنيو</span>
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Live Digital Service
            </span>
          </div>

          {/* 3 Pillars */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="p-3 rounded-2xl bg-luxury-950/80 border border-luxury-800 flex flex-col justify-between space-y-2 hover:border-luxury-700 transition-colors">
              <div className="w-8 h-8 rounded-xl bg-[rgb(var(--brand-primary-strong-rgb)/0.1)] border border-[rgb(var(--brand-primary-strong-rgb)/0.3)] flex items-center justify-center text-[var(--brand-primary-strong)]">
                <ChefHat className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-luxury-100">مطبخ حي وتتبع لحظي</h4>
                <p className="text-[10px] text-luxury-400 mt-0.5 leading-relaxed">
                  شاهد حالة أطباقك خطوة بخطوة من التحضير وحتى التقديم
                </p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-luxury-950/80 border border-luxury-800 flex flex-col justify-between space-y-2 hover:border-luxury-700 transition-colors">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <ShoppingBag className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-luxury-100">طلب مباشر فوري</h4>
                <p className="text-[10px] text-luxury-400 mt-0.5 leading-relaxed">
                  اختر ما يروق لك واطلب مباشرة بدون الحاجة لانتظار كابتن الصالة
                </p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-luxury-950/80 border border-luxury-800 flex flex-col justify-between space-y-2 hover:border-luxury-700 transition-colors">
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <PhoneCall className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-luxury-100">استدعاء النادل بضغطة</h4>
                <p className="text-[10px] text-luxury-400 mt-0.5 leading-relaxed">
                  طلب المساعدة أو الفاتورة أو أدوات المائدة فوراً لطاولتك
                </p>
              </div>
            </div>
          </div>

          {activeTableId && (
            <div className="pt-2.5 border-t border-luxury-800 flex items-center justify-between text-xs text-luxury-200">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  جلسة الطاولة مفعلة: <strong className="font-serif font-bold text-emerald-300">طاولة {tableNumStr}</strong>
                </span>
              </div>
              <span className="text-[11px] text-emerald-400 font-mono">● متصل بالخادم</span>
            </div>
          )}
        </div>

        {/* Telegram Contact Badge */}
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl bg-sky-950/70 border border-sky-500/40 text-sky-300 text-xs font-semibold backdrop-blur-md shadow-lg">
          <MessageCircle className="w-4 h-4 text-sky-400 animate-bounce" />
          <span>للتواصل والدعم الفني عبر تليجرام:</span>
          <a
            href="https://t.me/Mureeh_tech_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono font-bold text-sky-300 hover:text-white underline direction-ltr"
          >
            @Mureeh_tech_bot
          </a>
        </div>
      </div>

      {/* Bottom CTA Button & Platform Credits */}
      <div className="relative z-10 w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-700 space-y-2.5 pt-2">
        <button
          type="button"
          onClick={handleStart}
          className="w-full py-4 px-6 rounded-2xl text-luxury-950 font-black transition-all shadow-2xl flex items-center justify-center gap-3 text-sm active:scale-98 group cursor-pointer hover:brightness-105"
          style={{
            background: `linear-gradient(135deg, ${primaryCol}, ${accentCol})`,
            boxShadow: `0 0 35px -5px ${primaryCol}80`,
          }}
        >
          <span>تصفح المنيو والتجارب الفاخرة</span>
          <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1.5 transition-transform" />
        </button>

        <div className="text-[11px] text-center text-luxury-400 space-y-0.5 pt-1">
          <p className="font-semibold text-luxury-300">
            منصة مريح MUREEH · نظام إدارة المطاعم والضيافة الذكي
          </p>
          <p className="text-[10px] text-luxury-500">
            للتواصل المباشر مع المنصة تليجرام:{' '}
            <span className="font-mono" style={{ color: primaryCol }}>
              @Mureeh_tech_bot
            </span>
          </p>
        </div>
      </div>

      {/* Fullscreen Lightbox Modal for Photo Album Zoom */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-60 bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-4 animate-in fade-in duration-300"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-luxury-900 border border-luxury-750 text-luxury-200 flex items-center justify-center hover:bg-luxury-800 transition-colors cursor-pointer z-10"
            aria-label="إغلاق معاينة الصورة"
          >
            <X className="w-5 h-5" />
          </button>

          <div
            className="relative max-w-2xl w-full max-h-[80vh] rounded-2xl overflow-hidden border border-luxury-800 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={optimizeImageUrl(lightboxImage.image, 1400, 85)}
              alt={lightboxImage.name}
              className="w-full max-h-[70vh] object-contain mx-auto bg-black"
            />
            <div className="p-4 bg-luxury-950/95 border-t border-luxury-800 text-right space-y-1">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-bold text-white font-serif">{lightboxImage.name}</h4>
                {lightboxImage.price > 0 && (
                  <span className="font-mono font-bold text-base" style={{ color: primaryCol }}>
                    {currency} {lightboxImage.price}
                  </span>
                )}
              </div>
              {lightboxImage.description && (
                <p className="text-xs text-luxury-400 leading-relaxed">{lightboxImage.description}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
