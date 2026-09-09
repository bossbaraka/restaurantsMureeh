import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import {
  Utensils,
  ArrowLeft,
  MapPin,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  MessageCircle,
  Clock,
  Star,
  CheckCircle2,
  Flame,
} from 'lucide-react';
import { optimizeImageUrl } from './ProductImage';
import { soundFX } from '../../utils/audio';

interface LuxuryWelcomeScreenProps {
  onDismiss: () => void;
}

interface CulinaryHighlight {
  id: string;
  name: string;
  nameEn?: string;
  price: number;
  image: string;
  tag?: string;
}

const CURATED_CULINARY_FALLBACKS: CulinaryHighlight[] = [
  {
    id: 'c1',
    name: 'قهوة مختصة محضرة بعناية',
    nameEn: 'Signature Specialty Brew',
    price: 12,
    image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80',
    tag: 'مشروب مميز ✨',
  },
  {
    id: 'c2',
    name: 'عصير طبيعي طازج ومنعش',
    nameEn: 'Fresh Pressed Juice',
    price: 10,
    image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=800&q=80',
    tag: 'طازج 🌿',
  },
  {
    id: 'c3',
    name: 'أطباق فاخرة وتجربة متجددة',
    nameEn: 'Artisanal Selection',
    price: 22,
    image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80',
    tag: 'الأكثر طلباً 🔥',
  },
];

export const LuxuryWelcomeScreen: React.FC<LuxuryWelcomeScreenProps> = ({ onDismiss }) => {
  const { currentRestaurant, activeTableId, products } = useRestaurant();
  const [isDismissing, setIsDismissing] = useState(false);
  const [activeHighlightIndex, setActiveHighlightIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartXRef = useRef<number | null>(null);

  // Table number extraction
  const tableNumStr = useMemo(() => {
    if (!activeTableId) return null;
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
  const logoImg = currentRestaurant?.logo ? optimizeImageUrl(currentRestaurant.logo, 200, 80) : '';
  const primaryCol = currentRestaurant?.primaryColor || '#D4AF37';
  const accentCol = currentRestaurant?.accentColor || '#0A2472';
  const currency = currentRestaurant?.currency || '₪';

  // Highlight dishes for the compact culinary preview strip
  const highlights = useMemo<CulinaryHighlight[]>(() => {
    const list: CulinaryHighlight[] = (products || [])
      .filter((p) => p.image && p.image.trim().length > 10 && !p.image.includes('placeholder'))
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        name: p.name,
        nameEn: p.nameEn,
        price: p.price,
        image: p.image,
        tag: p.badge || (p.isFeatured ? 'مختارات الشيف ✦' : 'الأكثر طلباً 🔥'),
      }));

    if (list.length >= 2) return list;
    return [...list, ...CURATED_CULINARY_FALLBACKS].slice(0, 3);
  }, [products]);

  // Gentle auto-rotation for highlights
  useEffect(() => {
    if (isPaused || highlights.length <= 1) return;
    const interval = setInterval(() => {
      setActiveHighlightIndex((prev) => (prev + 1) % highlights.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [isPaused, highlights.length]);

  const handleNext = () => {
    soundFX.playTap();
    setActiveHighlightIndex((prev) => (prev + 1) % highlights.length);
  };

  const handlePrev = () => {
    soundFX.playTap();
    setActiveHighlightIndex((prev) => (prev - 1 + highlights.length) % highlights.length);
  };

  const handleStart = () => {
    soundFX.playChime();
    setIsDismissing(true);
    setTimeout(() => {
      onDismiss();
    }, 320);
  };

  // Touch swipe support for preview
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartXRef.current;
    if (Math.abs(delta) > 35) {
      if (delta > 0) handlePrev();
      else handleNext();
    }
    touchStartXRef.current = null;
  };

  const currentDish = highlights[activeHighlightIndex] || highlights[0];

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col justify-between bg-[#00072D] text-slate-100 transition-opacity duration-300 select-none overflow-y-auto ${
        isDismissing ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      dir="rtl"
    >
      {/* Cinematic Deep Atmosphere Background */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <img
          src={coverImg}
          alt={restName}
          loading="eager"
          decoding="async"
          {...({ fetchPriority: 'high' } as React.ImgHTMLAttributes<HTMLImageElement>)}
          className="w-full h-full object-cover object-center opacity-25 filter blur-[2px] scale-105"
        />
        {/* Deep Mureeh Navy Vignette Layers */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#00072D]/95 via-[#00072D]/85 to-[#00072D]" />
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            background: `radial-gradient(circle at 50% 18%, ${primaryCol}30 0%, transparent 65%)`,
          }}
        />
      </div>

      {/* Top Bar: Table & Hospitality Confirmation */}
      <header className="relative z-10 w-full max-w-lg mx-auto pt-4 px-4 sm:px-6 flex items-center justify-between text-xs">
        {tableNumStr ? (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#051650]/90 border border-[#123499]/60 text-slate-100 shadow-md backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-semibold">طاولة</span>
            <span className="font-mono font-bold text-amber-300 text-sm px-1.5 py-0.2 rounded-md bg-white/10">
              {tableNumStr}
            </span>
            <span className="text-[10px] text-emerald-400 font-medium">● متصل</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#051650]/80 border border-[#123499]/50 text-slate-200 text-xs backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>جلسة ضيافة مباشرة</span>
          </div>
        )}

        {currentRestaurant?.address && (
          <div className="hidden sm:flex items-center gap-1 text-[11px] text-slate-300/80 bg-[#051650]/40 px-2.5 py-1 rounded-full border border-white/5 truncate max-w-[180px]">
            <MapPin className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="truncate">{currentRestaurant.address}</span>
          </div>
        )}
      </header>

      {/* Center Core: Restaurant Identity & Immediate Clarity */}
      <main className="relative z-10 w-full max-w-lg mx-auto px-4 sm:px-6 py-2 my-auto flex flex-col items-center text-center space-y-4">
        {/* Restaurant Crest / Logo */}
        <div className="relative group">
          <div
            className="absolute -inset-1 rounded-3xl opacity-60 blur-lg transition duration-500"
            style={{ background: `linear-gradient(135deg, ${primaryCol}, #123499)` }}
          />
          <div
            className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-3xl mx-auto flex items-center justify-center overflow-hidden shadow-2xl border-2 bg-[#051650]"
            style={{ borderColor: `${primaryCol}80` }}
          >
            {logoImg ? (
              <img
                src={logoImg}
                alt={restName}
                className="w-full h-full object-cover p-1"
                loading="eager"
                decoding="async"
              />
            ) : (
              <div className="font-serif font-black text-2xl sm:text-3xl text-amber-300">
                {restNameEn.charAt(0) || 'M'}
              </div>
            )}
          </div>
        </div>

        {/* Restaurant Identity Headings */}
        <div className="space-y-1 w-full">
          {/* A11Y-005: <h2> preserves single <h1> on document in CustomerHeader */}
          <h2 className="text-2xl sm:text-3xl font-serif font-black text-white tracking-tight leading-snug drop-shadow-sm">
            {restName}
          </h2>
          {restNameEn && (
            <p
              className="text-xs font-serif tracking-widest uppercase font-semibold"
              style={{ color: primaryCol }}
            >
              {restNameEn}
            </p>
          )}
          <p className="text-xs text-slate-300/90 max-w-xs mx-auto pt-1 leading-relaxed">
            أهلاً بك في رحاب الضيافة · قائمتك الذكية جاهزة بلمسة واحدة
          </p>
        </div>

        {/* Compact Culinary Preview Strip */}
        {highlights.length > 0 && currentDish && (
          <div
            className="w-full rounded-2xl bg-[#051650]/70 border border-[#123499]/50 p-2.5 backdrop-blur-md shadow-xl text-right transition-all"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div className="flex items-center gap-3">
              {/* Dish Visual Thumbnail */}
              <div className="relative w-16 h-16 sm:w-18 sm:h-18 rounded-xl overflow-hidden shrink-0 border border-white/10 bg-black/40 shadow-md">
                <img
                  src={optimizeImageUrl(currentDish.image, 200, 75)}
                  alt={currentDish.name}
                  className="w-full h-full object-cover"
                  loading="eager"
                  decoding="async"
                />
                {currentDish.tag && (
                  <div className="absolute bottom-0 inset-x-0 bg-black/75 backdrop-blur-xs py-0.5 text-[9px] text-amber-300 text-center font-bold truncate px-1">
                    {currentDish.tag}
                  </div>
                )}
              </div>

              {/* Dish Meta */}
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-slate-400 font-medium">مختارات المنيو</span>
                  {currentDish.price > 0 && (
                    <span className="text-xs sm:text-sm font-mono font-black text-amber-300">
                      {currency} {currentDish.price}
                    </span>
                  )}
                </div>
                <h3 className="text-xs sm:text-sm font-bold text-white truncate">
                  {currentDish.name}
                </h3>
                {currentDish.nameEn && (
                  <p className="text-[10px] text-slate-300/70 font-sans truncate">
                    {currentDish.nameEn}
                  </p>
                )}
              </div>

              {/* Navigation Arrows */}
              {highlights.length > 1 && (
                <div className="flex items-center gap-1 shrink-0 pl-1">
                  <button
                    type="button"
                    onClick={handlePrev}
                    className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                    aria-label="الطبق السابق"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                    aria-label="الطبق التالي"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Pagination Dots */}
            {highlights.length > 1 && (
              <div className="flex items-center justify-center gap-1.5 pt-2">
                {highlights.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      soundFX.playTap();
                      setActiveHighlightIndex(idx);
                    }}
                    className={`h-1 rounded-full transition-all cursor-pointer ${
                      idx === activeHighlightIndex
                        ? 'w-4 bg-amber-400'
                        : 'w-1.5 bg-white/20 hover:bg-white/40'
                    }`}
                    aria-label={`انتقال للطبق ${idx + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3 Clear Hospitality Reassurances */}
        <div className="w-full grid grid-cols-3 gap-2 text-center text-[10px] text-slate-300/80 pt-1">
          <div className="p-2 rounded-xl bg-[#051650]/40 border border-[#123499]/30 flex flex-col items-center justify-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-semibold text-slate-200">طلب مباشر فوري</span>
          </div>
          <div className="p-2 rounded-xl bg-[#051650]/40 border border-[#123499]/30 flex flex-col items-center justify-center gap-1">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-semibold text-slate-200">تتبع لحظي للمطبخ</span>
          </div>
          <div className="p-2 rounded-xl bg-[#051650]/40 border border-[#123499]/30 flex flex-col items-center justify-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-semibold text-slate-200">ضيافة معتمدة</span>
          </div>
        </div>
      </main>

      {/* Bottom Fixed Action Section: Dominant Single CTA */}
      <footer className="relative z-10 w-full max-w-lg mx-auto px-4 sm:px-6 pb-5 pt-2 space-y-3">
        {/* Dominant Primary CTA */}
        <button
          type="button"
          onClick={handleStart}
          className="w-full min-h-[52px] py-3.5 px-6 rounded-2xl font-black text-sm sm:text-base flex items-center justify-center gap-3 transition-all transform active:scale-[0.98] shadow-2xl hover:brightness-110 cursor-pointer text-[#00072D]"
          style={{
            background: `linear-gradient(135deg, ${primaryCol}, #E2C067)`,
            boxShadow: `0 0 25px -4px ${primaryCol}90`,
          }}
        >
          <span>استكشف القائمة</span>
          <ArrowLeft className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
        </button>

        {/* Secondary Details: Support & Mureeh Identity */}
        <div className="flex items-center justify-between text-[11px] text-slate-400/80 px-1">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>تجربة طعام رقمية مدعومة بـ</span>
            <span className="font-bold text-slate-200 tracking-wide">MUREEH</span>
          </div>

          <a
            href="https://t.me/Mureeh_tech_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-slate-300 hover:text-white transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5 text-sky-400" />
            <span>الدعم الفني</span>
          </a>
        </div>
      </footer>
    </div>
  );
};
