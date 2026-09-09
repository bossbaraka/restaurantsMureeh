import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import {
  ArrowLeft,
  MapPin,
  Sparkles,
  MessageCircle,
  Star,
  Quote,
  X,
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
  const [showTapHint, setShowTapHint] = useState(false);
  const [reviewPaused, setReviewPaused] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const convergingRef = useRef(false);

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

    if (list.length >= 4) return list.slice(0, 4);
    return [...list, ...DEFAULT_GALLERY_PHOTOS].slice(0, 4);
  }, [currentRestaurant, products, restName]);

  // ---------------------------------------------------------------------------
  // Canvas Particle Network + Logo Reveal Animation
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

    // Richer particle set: 60 nodes with varied speeds and colors
    const particleCount = 60;
    const goldShades = ['rgba(212,175,55,', 'rgba(226,192,103,', 'rgba(255,235,150,', 'rgba(180,140,30,'];
    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 1.4,
      vy: (Math.random() - 0.5) * 1.4,
      radius: Math.random() * 2.5 + 1.0,
      alpha: Math.random() * 0.65 + 0.35,
      colorBase: goldShades[Math.floor(Math.random() * goldShades.length)],
      // Target positions for convergence (toward center cluster)
      targetX: width / 2 + (Math.random() - 0.5) * 60,
      targetY: height / 2 + (Math.random() - 0.5) * 60,
    }));

    // Pulse rings state
    let pulsePhase = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const isConverging = convergingRef.current;

      // Draw subtle pulse rings in NETWORKING stage
      if (!isConverging) {
        pulsePhase += 0.018;
        for (let r = 1; r <= 3; r++) {
          const radius = 55 + r * 55 + Math.sin(pulsePhase + r) * 12;
          const alpha = Math.max(0, 0.08 - (r * 0.02)) * (0.5 + 0.5 * Math.sin(pulsePhase * 1.5 + r));
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(212,175,55,${alpha})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      // Draw connection lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distSq = dx * dx + dy * dy;
          const maxDist = isConverging ? 90 : 130;

          if (distSq < maxDist * maxDist) {
            const dist = Math.sqrt(distSq);
            const lineAlpha = (1 - dist / maxDist) * (isConverging ? 0.4 : 0.22);
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(212,175,55,${lineAlpha})`;
            ctx.lineWidth = isConverging ? 1.0 : 0.7;
            ctx.stroke();
          }
        }
      }

      // Update and draw particles
      for (const p of particles) {
        if (isConverging) {
          // Smooth pull toward individual target positions (cluster around center)
          const cdx = p.targetX - p.x;
          const cdy = p.targetY - p.y;
          p.x += cdx * 0.07;
          p.y += cdy * 0.07;
          // Slightly increase alpha as they converge
          p.alpha = Math.min(1, p.alpha + 0.004);
        } else {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;
        }

        // Glow effect for larger particles
        if (p.radius > 2) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#D4AF37';
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `${p.colorBase}${p.alpha})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      animationFrameIdRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
    };
  }, [step]);

  // ---------------------------------------------------------------------------
  // Stage timings: NETWORKING (2.5s) → LOGO_REVEAL → show tap hint after 1.2s
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (step !== 'NETWORKING') return;
    const timer = setTimeout(() => {
      convergingRef.current = true;
      setStep('LOGO_REVEAL');
    }, 2500);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (step !== 'LOGO_REVEAL') return;
    // Delay tap hint so user first sees the logo assembled, then the CTA appears
    const timer = setTimeout(() => {
      setShowTapHint(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [step]);

  // ---------------------------------------------------------------------------
  // Auto-rotating reviews every 3.5s (pause on interaction)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (step !== 'WELCOME_SHOWCASE' || reviewPaused) return;
    const interval = setInterval(() => {
      setActiveReviewIndex((prev) => (prev + 1) % CURATED_REVIEWS.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [step, reviewPaused]);

  const handleLogoTap = () => {
    soundFX.playTap();
    setStep('WELCOME_SHOWCASE');
  };

  const handleStartBrowsing = () => {
    soundFX.playChime();
    setIsDismissing(true);
    setTimeout(() => onDismiss(), 320);
  };

  const handleReviewSelect = (idx: number) => {
    soundFX.playTap();
    setActiveReviewIndex(idx);
    setReviewPaused(true);
    // Resume auto-rotate after 8s of inactivity
    setTimeout(() => setReviewPaused(false), 8000);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-[#00072D] text-slate-100 select-none overflow-y-auto transition-opacity duration-300 ${
        isDismissing ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      dir="rtl"
    >
      {/* =================================================================== */}
      {/* STAGE 1 & 2: Digital Networking Animation & Logo Reveal             */}
      {/* =================================================================== */}
      {step !== 'WELCOME_SHOWCASE' && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-between p-6 bg-[#00072D]">
          {/* Canvas Background */}
          <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0" />

          {/* Ambient radial glow at center */}
          <div
            className="absolute inset-0 z-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(10,36,114,0.55) 0%, transparent 70%)',
            }}
          />

          {/* Skip Button */}
          <div className="relative z-10 w-full flex justify-end">
            <button
              type="button"
              onClick={handleStartBrowsing}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/15 border border-white/10 backdrop-blur-md transition-colors cursor-pointer"
            >
              تخطي للمنيو مباشرة
            </button>
          </div>

          {/* Center Stage Content */}
          <div className="relative z-10 my-auto flex flex-col items-center text-center space-y-6 max-w-sm w-full px-4">
            {step === 'NETWORKING' ? (
              <div className="space-y-5 animate-in fade-in duration-600">
                {/* Glowing pulse icon */}
                <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border border-amber-400/20 animate-ping" style={{ animationDuration: '2s' }} />
                  <div className="absolute inset-3 rounded-full border border-amber-400/40 animate-ping" style={{ animationDuration: '1.5s', animationDelay: '0.3s' }} />
                  <div className="absolute inset-6 rounded-full border border-amber-400/60 animate-pulse" />
                  <div
                    className="relative w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl"
                    style={{ background: 'radial-gradient(circle, #0A2472 0%, #00072D 100%)', boxShadow: '0 0 24px rgba(212,175,55,0.25)' }}
                  >
                    <Sparkles className="w-7 h-7 text-amber-300 animate-spin" style={{ animationDuration: '3s' }} />
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold font-serif text-white tracking-wide">
                    أهلاً بك...
                  </h3>
                  <p className="text-xs text-slate-300/80 leading-relaxed font-sans">
                    جاري إنشاء الاتصال الرقمي الآمن مع {restName}
                  </p>
                  {tableNumStr && (
                    <span className="inline-block mt-1 px-3 py-1 rounded-full text-[11px] font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-500/40 animate-pulse">
                      ● طاولة {tableNumStr}
                    </span>
                  )}
                </div>

                {/* Animated connecting dots */}
                <div className="flex items-center gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s`, animationDuration: '1s' }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              /* LOGO_REVEAL */
              <div
                className="space-y-5 animate-in zoom-in-90 fade-in duration-700 cursor-pointer group w-full"
                onClick={showTapHint ? handleLogoTap : undefined}
              >
                {/* Assembled Glowing Restaurant Logo */}
                <div className="relative inline-block">
                  <div
                    className="absolute -inset-4 rounded-full opacity-75 blur-2xl animate-pulse"
                    style={{ background: `radial-gradient(circle, ${primaryCol}80 0%, #123499 65%)` }}
                  />
                  {/* Secondary shimmer ring */}
                  <div
                    className="absolute -inset-1 rounded-3xl opacity-50 blur-sm"
                    style={{ background: `linear-gradient(135deg, ${primaryCol}60, transparent, #123499 80%)` }}
                  />
                  <div
                    className={`relative w-32 h-32 sm:w-36 sm:h-36 rounded-3xl mx-auto flex items-center justify-center overflow-hidden shadow-2xl border-2 bg-[#051650] transform transition-transform duration-500 ${showTapHint ? 'group-hover:scale-105' : ''}`}
                    style={{ borderColor: `${primaryCol}90` }}
                  >
                    {logoImg ? (
                      <img
                        src={logoImg}
                        alt={restName}
                        className="w-full h-full object-cover p-2"
                        loading="eager"
                        decoding="async"
                      />
                    ) : (
                      <div className="font-serif font-black text-4xl sm:text-5xl text-amber-300">
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
                    <p className="text-[11px] font-serif tracking-[0.25em] uppercase font-semibold text-amber-300">
                      {restNameEn}
                    </p>
                  )}
                </div>

                {/* Tap hint — delayed reveal */}
                <div
                  className={`pt-1 transition-all duration-700 ${showTapHint ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'}`}
                >
                  <div
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-bold text-sm shadow-xl transition-all group-hover:brightness-110"
                    style={{
                      background: `linear-gradient(135deg, ${primaryCol}, #E2C067)`,
                      color: '#00072D',
                      boxShadow: `0 0 28px -4px ${primaryCol}80`,
                    }}
                  >
                    <span>المس الشعار للدخول</span>
                    <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Subtle Brand Watermark */}
          <div className="relative z-10 text-[10px] text-slate-400/60 font-sans tracking-widest">
            MUREEH · منصة الضيافة الرقمية
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* STAGE 3: Full Restaurant Welcome Showcase                           */}
      {/* =================================================================== */}
      {step === 'WELCOME_SHOWCASE' && (
        <div className="relative z-10 w-full min-h-screen flex flex-col justify-between animate-in fade-in duration-500">
          {/* Ambient Background Cover Art */}
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
            <img
              src={coverImg}
              alt={restName}
              loading="eager"
              decoding="async"
              className="w-full h-full object-cover object-center opacity-15 filter blur-sm scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#00072D]/97 via-[#00072D]/88 to-[#00072D]" />
            <div
              className="absolute inset-0 opacity-35 pointer-events-none"
              style={{ background: `radial-gradient(circle at 50% 10%, ${primaryCol}30 0%, transparent 60%)` }}
            />
          </div>

          {/* Top Header: Table Badge & Branch */}
          <header className="relative z-10 w-full max-w-xl mx-auto pt-4 px-4 sm:px-6 flex items-center justify-between text-xs">
            {tableNumStr ? (
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#051650]/90 border border-[#123499]/60 text-slate-100 shadow-md backdrop-blur-md">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-semibold">أنت الآن على طاولة</span>
                <span className="font-mono font-black text-amber-300 text-sm px-1.5 rounded-md bg-white/10">
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

          {/* Main Content */}
          <main className="relative z-10 w-full max-w-xl mx-auto px-4 sm:px-6 py-4 flex-1 space-y-6">
            {/* 1. Restaurant Hero */}
            <div className="text-center space-y-3 pt-2">
              <div className="relative inline-block">
                <div
                  className="absolute -inset-1 rounded-2xl opacity-50 blur-md"
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
                <h2 className="text-2xl sm:text-3xl font-serif font-black text-white tracking-tight leading-snug">
                  {restName}
                </h2>
                {restNameEn && (
                  <p
                    className="text-[11px] font-serif tracking-[0.22em] uppercase font-semibold"
                    style={{ color: primaryCol }}
                  >
                    {restNameEn}
                  </p>
                )}
              </div>

              <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto leading-relaxed pt-1">
                {currentRestaurant?.description ||
                  `أهلاً وسهلاً بكم في ${restName}، حيث نحرص على أن تكون كل زيارة تجربة طعام استثنائية تستحق أن تُتذكر.`}
              </p>
            </div>

            {/* 2. Customer Reviews — Auto-rotating */}
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
                <span className="text-[11px] text-slate-400 font-sans">من آراء ضيوفنا الكرام</span>
              </div>

              {/* Review content with fade transition */}
              <div className="relative pt-1 space-y-2 min-h-[80px]">
                <Quote className="w-5 h-5 text-amber-400/40 absolute -top-1 right-0" />
                <p
                  key={activeReviewIndex}
                  className="text-xs text-slate-200 leading-relaxed pr-6 italic animate-in fade-in duration-500"
                >
                  &ldquo;{CURATED_REVIEWS[activeReviewIndex].comment}&rdquo;
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

              {/* Dot Navigation */}
              <div className="flex items-center justify-center gap-2 pt-1">
                {CURATED_REVIEWS.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleReviewSelect(idx)}
                    className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                      idx === activeReviewIndex
                        ? 'w-6 bg-amber-400'
                        : 'w-1.5 bg-white/20 hover:bg-white/40'
                    }`}
                    aria-label={`عرض التقييم ${idx + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* 3. Restaurant Gallery Grid */}
            <div className="space-y-2.5 text-right">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-bold text-slate-200 font-serif flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span>صور من أجواء وضيافة {restName}</span>
                </h3>
                <span className="text-[10px] text-slate-400">المس أي صورة للتكبير</span>
              </div>

              {/* Asymmetric Editorial Grid */}
              <div className="grid grid-cols-2 gap-2">
                {/* Large Hero (spans full width) */}
                {galleryImages[0] && (
                  <div
                    onClick={() => setLightboxImage(galleryImages[0].url)}
                    className="col-span-2 relative h-44 sm:h-52 rounded-2xl overflow-hidden border border-white/10 bg-black/40 shadow-md group cursor-pointer"
                  >
                    <img
                      src={optimizeImageUrl(galleryImages[0].url, 800, 80)}
                      alt={galleryImages[0].title}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                    <div className="absolute bottom-3 inset-x-3 z-10 flex items-end justify-between">
                      <span className="text-xs font-bold text-white drop-shadow truncate">
                        {galleryImages[0].title}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/60 backdrop-blur-md text-amber-300 border border-white/10 shrink-0 ml-2">
                        {galleryImages[0].tag}
                      </span>
                    </div>
                  </div>
                )}

                {/* Supporting Cards */}
                {galleryImages.slice(1, 4).map((item, idx) => (
                  <div
                    key={item.id}
                    onClick={() => setLightboxImage(item.url)}
                    className={`relative rounded-2xl overflow-hidden border border-white/10 bg-black/40 shadow-md group cursor-pointer ${
                      idx === 0 ? 'col-span-2 h-36 sm:h-40' : 'h-28 sm:h-36'
                    }`}
                  >
                    <img
                      src={optimizeImageUrl(item.url, 500, 75)}
                      alt={item.title}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                    <div className="absolute bottom-2 inset-x-2.5 z-10 text-right">
                      <span className="text-[10px] font-bold text-white truncate block drop-shadow">
                        {item.title}
                      </span>
                      <span className="text-[9px] text-amber-300 font-medium">{item.tag}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>

          {/* Sticky Bottom CTA */}
          <footer className="relative z-10 w-full max-w-xl mx-auto px-4 sm:px-6 pb-6 pt-3 space-y-3 bg-gradient-to-t from-[#00072D] via-[#00072D]/95 to-transparent">
            <button
              type="button"
              onClick={handleStartBrowsing}
              className="w-full min-h-[54px] py-4 px-6 rounded-2xl font-black text-sm sm:text-base flex items-center justify-center gap-3 transition-all transform active:scale-[0.97] shadow-2xl hover:brightness-110 cursor-pointer text-[#00072D]"
              style={{
                background: `linear-gradient(135deg, ${primaryCol}, #E2C067)`,
                boxShadow: `0 0 30px -4px ${primaryCol}85`,
              }}
            >
              <span>ابدأ التصفح واستكشف القائمة</span>
              <ArrowLeft className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
            </button>

            <div className="flex items-center justify-between text-[11px] text-slate-400/80 px-1">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>مدعوم بـ</span>
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

          {/* Lightbox */}
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
