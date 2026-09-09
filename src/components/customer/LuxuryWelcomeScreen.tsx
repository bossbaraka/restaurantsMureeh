import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import {
  ArrowLeft,
  MapPin,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  MessageCircle,
  Star,
  Quote,
  X,
  Maximize2,
  CheckCircle2,
  Flame,
} from 'lucide-react';
import { optimizeImageUrl } from './ProductImage';
import { soundFX } from '../../utils/audio';

interface LuxuryWelcomeScreenProps {
  onDismiss: () => void;
}

type WelcomeStep = 'NETWORKING' | 'LOGO_REVEAL' | 'WELCOME_SHOWCASE';

interface CustomerReview {
  id: string;
  author: string;
  badge: string;
  rating: number;
  comment: string;
}

const CURATED_REVIEWS: CustomerReview[] = [
  {
    id: 'rev-1',
    author: 'سارة القحطاني',
    badge: 'ضيف معتمد · تجربة غداء',
    rating: 5,
    comment: 'تجربة ضيافة استثنائية بكل المقاييس. جودة الأطباق والتقديم تفوق التوقعات، وأجواء المكان غاية في الرقي.',
  },
  {
    id: 'rev-2',
    author: 'م. أحمد الشريف',
    badge: 'زائر دائم · جلسة مسائية',
    rating: 5,
    comment: 'الخدمة الرقمية سريعة جداً وطلب الطعام من الطاولة بلمسة واحدة مريح للغاية. المذاق أصيل والقهوة ممتازة.',
  },
  {
    id: 'rev-3',
    author: 'د. خلود اليافعي',
    badge: 'ضيف معتمد · عشاء عائلي',
    rating: 5,
    comment: 'اهتمام فائق بأدق التفاصيل من لحظة مسح الباركود حتى استلام الطلب. بالتأكيد سأكرر الزيارة مراراً.',
  },
];

const DEFAULT_GALLERY_PHOTOS = [
  {
    id: 'g-1',
    title: 'أجواء الضيافة والاسترخاء',
    url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80',
    tag: 'أجواء المكان ✨',
  },
  {
    id: 'g-2',
    title: 'المشروبات والقهوة المختصة',
    url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80',
    tag: 'قهوة مختصة ☕',
  },
  {
    id: 'g-3',
    title: 'أطباق فاخرة محضرة بعناية',
    url: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80',
    tag: 'مذاق فريد 🌿',
  },
  {
    id: 'g-4',
    title: 'عصائر ومنعشات طازجة',
    url: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=800&q=80',
    tag: 'طازج ولذيذ 🔥',
  },
];

export const LuxuryWelcomeScreen: React.FC<LuxuryWelcomeScreenProps> = ({ onDismiss }) => {
  const { currentRestaurant, activeTableId, products } = useRestaurant();
  const [step, setStep] = useState<WelcomeStep>('NETWORKING');
  const [isDismissing, setIsDismissing] = useState(false);
  const [activeReviewIndex, setActiveReviewIndex] = useState(0);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  // Extract clean table number
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
  const logoImg = currentRestaurant?.logo ? optimizeImageUrl(currentRestaurant.logo, 240, 85) : '';
  const primaryCol = currentRestaurant?.primaryColor || '#D4AF37';
  const accentCol = currentRestaurant?.accentColor || '#0A2472';

  // Build curated gallery images from restaurant & products
  const galleryImages = useMemo(() => {
    const list: Array<{ id: string; title: string; url: string; tag: string }> = [];

    if (currentRestaurant?.coverImage) {
      list.push({
        id: 'cover',
        title: restName,
        url: currentRestaurant.coverImage,
        tag: 'الواجهة الرئيسية ✦',
      });
    }

    if (currentRestaurant?.galleryImages && currentRestaurant.galleryImages.length > 0) {
      currentRestaurant.galleryImages.forEach((img, idx) => {
        list.push({
          id: `custom-g-${idx}`,
          title: `أجواء ${restName}`,
          url: img,
          tag: 'أجواء المطعم ✨',
        });
      });
    }

    // Add signature dishes with photos
    if (products && products.length > 0) {
      products
        .filter((p) => p.image && p.image.trim().length > 10 && !p.image.includes('placeholder'))
        .slice(0, 4)
        .forEach((p) => {
          list.push({
            id: p.id,
            title: p.name,
            url: p.image,
            tag: p.badge || (p.isFeatured ? 'مختارات الشيف ✦' : 'الأكثر طلباً 🔥'),
          });
        });
    }

    if (list.length >= 4) {
      return list.slice(0, 4);
    }

    return [...list, ...DEFAULT_GALLERY_PHOTOS].slice(0, 4);
  }, [currentRestaurant, products, restName]);

  // ---------------------------------------------------------------------------
  // Step 1: Digital Networking Canvas Particle Effect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (step === 'WELCOME_SHOWCASE') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      height = canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const particleCount = 42;
    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 1.2,
      vy: (Math.random() - 0.5) * 1.2,
      radius: Math.random() * 2 + 1.2,
      alpha: Math.random() * 0.7 + 0.3,
    }));

    let converging = step === 'LOGO_REVEAL';

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;

      // Draw connection lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = 120;

          if (dist < maxDist) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            const lineAlpha = (1 - dist / maxDist) * 0.25;
            ctx.strokeStyle = `rgba(212, 175, 55, ${lineAlpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      // Update and draw particles
      for (const p of particles) {
        if (converging) {
          // Particles pull smoothly toward the center to form the logo
          const cdx = centerX - p.x;
          const cdy = centerY - p.y;
          p.x += cdx * 0.08;
          p.y += cdy * 0.08;
        } else {
          p.x += p.vx;
          p.y += p.vy;

          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(226, 192, 103, ${p.alpha})`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#D4AF37';
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      animationFrameIdRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [step]);

  // Transition from NETWORKING to LOGO_REVEAL after ~1.4s
  useEffect(() => {
    if (step !== 'NETWORKING') return;
    const timer = setTimeout(() => {
      setStep('LOGO_REVEAL');
    }, 1400);
    return () => clearTimeout(timer);
  }, [step]);

  // Click handler on the revealed logo to enter the welcome showcase
  const handleLogoTap = () => {
    soundFX.playTap();
    setStep('WELCOME_SHOWCASE');
  };

  // Final CTA to dismiss and enter the menu directly
  const handleStartBrowsing = () => {
    soundFX.playChime();
    setIsDismissing(true);
    setTimeout(() => {
      onDismiss();
    }, 320);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col justify-between bg-[#00072D] text-slate-100 transition-opacity duration-300 select-none overflow-y-auto ${
        isDismissing ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      dir="rtl"
    >
      {/* ===================================================================== */}
      {/* STAGE 1 & 2: Digital Networking Animation & Logo Reveal Overlay       */}
      {/* ===================================================================== */}
      {step !== 'WELCOME_SHOWCASE' && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-between p-6 bg-[#00072D] animate-fade-in">
          {/* Dynamic Networking Canvas */}
          <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0" />

          {/* Quick Skip Button in Top Corner */}
          <div className="relative z-10 w-full flex justify-end">
            <button
              type="button"
              onClick={handleStartBrowsing}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/15 border border-white/10 backdrop-blur-md transition-colors cursor-pointer"
            >
              تخطي للمنيو مباشرة
            </button>
          </div>

          {/* Center Stage: Networking Pulse & Particle Logo Reveal */}
          <div className="relative z-10 my-auto flex flex-col items-center text-center space-y-6 max-w-sm">
            {step === 'NETWORKING' ? (
              <div className="space-y-4 animate-in fade-in duration-500">
                <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border border-amber-400/30 animate-ping duration-1000" />
                  <div className="absolute inset-2 rounded-full border border-amber-400/50 animate-pulse" />
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center bg-[#051650] border border-amber-400/60 shadow-xl shadow-amber-400/20"
                    style={{ background: `radial-gradient(circle, #0A2472 0%, #00072D 100%)` }}
                  >
                    <Sparkles className="w-8 h-8 text-amber-300 animate-spin" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <h3 className="text-lg sm:text-xl font-bold font-serif text-white tracking-wide">
                    أهلاً بك...
                  </h3>
                  <p className="text-xs text-slate-300/80 leading-relaxed font-sans">
                    جاري إنشاء الاتصال الرقمي الآمن مع {restName}
                  </p>
                  {tableNumStr && (
                    <span className="inline-block mt-1 px-3 py-1 rounded-full text-[11px] font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-500/40">
                      طاولة {tableNumStr}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              /* Step: LOGO_REVEAL */
              <div
                className="space-y-5 animate-in zoom-in-90 fade-in duration-700 cursor-pointer group"
                onClick={handleLogoTap}
              >
                {/* Assembled Glowing Restaurant Logo */}
                <div className="relative inline-block">
                  <div
                    className="absolute -inset-3 rounded-full opacity-80 blur-xl group-hover:opacity-100 transition-opacity animate-pulse"
                    style={{ background: `radial-gradient(circle, ${primaryCol}90 0%, #123499 70%)` }}
                  />
                  <div
                    className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-3xl mx-auto flex items-center justify-center overflow-hidden shadow-2xl border-2 bg-[#051650] transform group-hover:scale-105 transition-transform duration-300"
                    style={{ borderColor: `${primaryCol}90` }}
                  >
                    {logoImg ? (
                      <img
                        src={logoImg}
                        alt={restName}
                        className="w-full h-full object-cover p-1.5"
                        loading="eager"
                        decoding="async"
                      />
                    ) : (
                      <div className="font-serif font-black text-3xl sm:text-4xl text-amber-300">
                        {restNameEn.charAt(0) || 'M'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <h2 className="text-2xl sm:text-3xl font-black font-serif text-white tracking-tight">
                    {restName}
                  </h2>
                  {restNameEn && (
                    <p className="text-xs font-serif tracking-widest uppercase font-semibold text-amber-300">
                      {restNameEn}
                    </p>
                  )}
                </div>

                {/* Elegant Interaction Hint */}
                <div className="pt-2">
                  <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-[#00072D] font-bold text-xs sm:text-sm shadow-xl shadow-amber-400/30 group-hover:brightness-110 transition-all">
                    <span>المس الشعار للدخول</span>
                    <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Subtle Bottom Brand Watermark */}
          <div className="relative z-10 text-[10px] text-slate-400/70 font-sans">
            منصة مريح MUREEH · تجربة الضيافة الرقمية
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STAGE 3: Full Restaurant Welcome Showcase                             */}
      {/* ===================================================================== */}
      {step === 'WELCOME_SHOWCASE' && (
        <div className="relative z-10 w-full min-h-screen flex flex-col justify-between animate-in fade-in duration-500">
          {/* Ambient Background Cover Art */}
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
            <img
              src={coverImg}
              alt={restName}
              loading="eager"
              decoding="async"
              className="w-full h-full object-cover object-center opacity-20 filter blur-[2px] scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#00072D]/95 via-[#00072D]/90 to-[#00072D]" />
            <div
              className="absolute inset-0 opacity-40 pointer-events-none"
              style={{
                background: `radial-gradient(circle at 50% 12%, ${primaryCol}35 0%, transparent 65%)`,
              }}
            />
          </div>

          {/* Top Sticky Header: Table Badge & Branch Presence */}
          <header className="relative z-10 w-full max-w-xl mx-auto pt-4 px-4 sm:px-6 flex items-center justify-between text-xs">
            {tableNumStr ? (
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#051650]/90 border border-[#123499]/60 text-slate-100 shadow-md backdrop-blur-md">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="font-semibold">أنت الآن على طاولة</span>
                <span className="font-mono font-black text-amber-300 text-sm px-1.5 py-0.2 rounded-md bg-white/10">
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
              <div className="hidden xs:flex items-center gap-1 text-[11px] text-slate-300/80 bg-[#051650]/50 px-2.5 py-1 rounded-full border border-white/5 truncate max-w-[190px]">
                <MapPin className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="truncate">{currentRestaurant.address}</span>
              </div>
            )}
          </header>

          {/* Main Content Area */}
          <main className="relative z-10 w-full max-w-xl mx-auto px-4 sm:px-6 py-4 flex-1 space-y-6">
            {/* 1. Restaurant Hero & Warm Human Welcome */}
            <div className="text-center space-y-3 pt-2">
              <div className="relative inline-block">
                <div
                  className="absolute -inset-1 rounded-2xl opacity-60 blur-md"
                  style={{ background: `linear-gradient(135deg, ${primaryCol}, #123499)` }}
                />
                <div
                  className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl mx-auto flex items-center justify-center overflow-hidden shadow-2xl border-2 bg-[#051650]"
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
                    <div className="font-serif font-black text-3xl text-amber-300">
                      {restNameEn.charAt(0) || 'M'}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                {/* A11Y-005: <h2> preserves single <h1> on document in CustomerHeader */}
                <h2 className="text-2xl sm:text-3xl font-serif font-black text-white tracking-tight leading-snug">
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
              </div>

              {/* Human Welcome Note */}
              <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto leading-relaxed pt-1">
                {currentRestaurant?.description ||
                  `أهلاً وسهلاً بكم في ${restName}، حيث نحرص على أن تكون كل زيارة تجربة طعام استثنائية تستحق أن تُتذكر.`}
              </p>
            </div>

            {/* 2. Customer Reviews & Experiences (آراء وتجارب العملاء) */}
            <div className="rounded-2xl bg-[#051650]/60 border border-[#123499]/40 p-4 backdrop-blur-md shadow-lg space-y-3 text-right">
              <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 text-amber-400">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
                    ))}
                  </div>
                  <span className="text-xs font-bold text-white font-mono">4.9 / 5.0</span>
                </div>
                <span className="text-[11px] text-slate-400 font-sans">
                  من آراء ضيوفنا الكرام
                </span>
              </div>

              {/* Active Review Quote */}
              <div className="relative pt-1 space-y-2">
                <Quote className="w-5 h-5 text-amber-400/40 absolute -top-1 right-0" />
                <p className="text-xs text-slate-200 leading-relaxed pr-6 italic">
                  "{CURATED_REVIEWS[activeReviewIndex].comment}"
                </p>

                <div className="flex items-center justify-between text-[11px] pt-1">
                  <span className="font-bold text-amber-300">
                    — {CURATED_REVIEWS[activeReviewIndex].author}
                  </span>
                  <span className="text-slate-400 text-[10px]">
                    {CURATED_REVIEWS[activeReviewIndex].badge}
                  </span>
                </div>
              </div>

              {/* Review Switcher Dots */}
              <div className="flex items-center justify-center gap-1.5 pt-1">
                {CURATED_REVIEWS.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      soundFX.playTap();
                      setActiveReviewIndex(idx);
                    }}
                    className={`h-1.5 rounded-full transition-all cursor-pointer ${
                      idx === activeReviewIndex
                        ? 'w-5 bg-amber-400'
                        : 'w-1.5 bg-white/20 hover:bg-white/40'
                    }`}
                    aria-label={`عرض التقييم ${idx + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* 3. Restaurant Gallery Grid (صور وأجواء المطعم في شبكة فاخرة) */}
            <div className="space-y-2.5 text-right">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-bold text-slate-200 font-serif flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span>صور من أجواء وضيافة {restName}</span>
                </h3>
                <span className="text-[10px] text-slate-400">المس أي صورة للتكبير</span>
              </div>

              {/* Editorial Dynamic Asymmetric Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {/* Large Hero Card (Spans 2 cols on small screens or taller) */}
                {galleryImages[0] && (
                  <div
                    onClick={() => setLightboxImage(galleryImages[0].url)}
                    className="col-span-2 sm:col-span-2 relative h-40 sm:h-48 rounded-2xl overflow-hidden border border-white/10 bg-black/40 shadow-md group cursor-pointer"
                  >
                    <img
                      src={optimizeImageUrl(galleryImages[0].url, 800, 80)}
                      alt={galleryImages[0].title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    <div className="absolute bottom-2.5 inset-x-3 z-10 flex items-center justify-between">
                      <span className="text-xs font-bold text-white drop-shadow truncate">
                        {galleryImages[0].title}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/60 backdrop-blur-md text-amber-300 border border-white/10">
                        {galleryImages[0].tag}
                      </span>
                    </div>
                  </div>
                )}

                {/* Supporting Grid Images */}
                {galleryImages.slice(1, 4).map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setLightboxImage(item.url)}
                    className="relative h-28 sm:h-48 rounded-2xl overflow-hidden border border-white/10 bg-black/40 shadow-md group cursor-pointer"
                  >
                    <img
                      src={optimizeImageUrl(item.url, 400, 75)}
                      alt={item.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                    <div className="absolute bottom-2 inset-x-2 z-10 text-right">
                      <span className="text-[10px] font-bold text-white truncate block drop-shadow">
                        {item.title}
                      </span>
                      <span className="text-[9px] text-amber-300 font-medium">
                        {item.tag}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>

          {/* Bottom Fixed Action Section: Dominant Primary CTA */}
          <footer className="relative z-10 w-full max-w-xl mx-auto px-4 sm:px-6 pb-5 pt-3 space-y-3 bg-gradient-to-t from-[#00072D] via-[#00072D]/95 to-transparent">
            {/* Dominant Primary CTA */}
            <button
              type="button"
              onClick={handleStartBrowsing}
              className="w-full min-h-[52px] py-3.5 px-6 rounded-2xl font-black text-sm sm:text-base flex items-center justify-center gap-3 transition-all transform active:scale-[0.98] shadow-2xl hover:brightness-110 cursor-pointer text-[#00072D]"
              style={{
                background: `linear-gradient(135deg, ${primaryCol}, #E2C067)`,
                boxShadow: `0 0 25px -4px ${primaryCol}90`,
              }}
            >
              <span>ابدأ التصفح واستكشف القائمة</span>
              <ArrowLeft className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
            </button>

            {/* Secondary Details: Support & Mureeh Identity */}
            <div className="flex items-center justify-between text-[11px] text-slate-400/80 px-1">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>تجربة ضيافة رقمية مدعومة بـ</span>
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

          {/* Fullscreen Lightbox Modal for Gallery Image Preview */}
          {lightboxImage && (
            <div
              className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
              onClick={() => setLightboxImage(null)}
            >
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer z-10"
                aria-label="إغلاق المعاينة"
              >
                <X className="w-5 h-5" />
              </button>

              <div
                className="relative max-w-2xl w-full max-h-[80vh] rounded-2xl overflow-hidden border border-white/10 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={optimizeImageUrl(lightboxImage, 1400, 85)}
                  alt={restName}
                  className="w-full max-h-[75vh] object-contain mx-auto bg-black"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
