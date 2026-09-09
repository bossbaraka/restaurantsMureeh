import React, { useMemo, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Sparkles, ArrowLeft, UtensilsCrossed, MessageCircle, QrCode, ShieldCheck, PhoneCall, Award, ChefHat, Clock, Zap, CheckCircle2 } from 'lucide-react';
import { optimizeImageUrl } from './ProductImage';

interface LuxuryWelcomeScreenProps {
  onDismiss: () => void;
}

export const LuxuryWelcomeScreen: React.FC<LuxuryWelcomeScreenProps> = ({ onDismiss }) => {
  const { currentRestaurant, activeTableId } = useRestaurant();
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  /**
   * Extract a clean table number (zero-padded) from whatever QR slug we got.
   * Reuses the same robust digit-extraction pattern as CustomerHeader so the
   * welcome screen and the header always agree on the displayed number.
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
  const rawCoverImg = currentRestaurant?.coverImage || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85';
  const coverImg = optimizeImageUrl(rawCoverImg, 1280, 70);
  const logoImg = currentRestaurant?.logo ? optimizeImageUrl(currentRestaurant.logo, 180, 75) : '';
  const primaryCol = currentRestaurant?.primaryColor || '#D4AF37';
  const accentCol = currentRestaurant?.accentColor || '#C5A880';

  const handleStart = () => {
    setIsAnimatingOut(true);
    setTimeout(() => {
      onDismiss();
    }, 400);
  };

  const whatsappUrl = `https://wa.me/970593498909?text=${encodeURIComponent(`السلام عليكم، أتواصل معكم عبر منصة مريح لتجربة الطعام في ${restName}`)}`;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-between p-5 sm:p-8 bg-[#050608] text-luxury-50 transition-all duration-500 overflow-y-auto select-none ${
        isAnimatingOut ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'
      }`}
      dir="rtl"
    >
      {/* Background Cinematic Food Photography with Ambient SaaS Light Rays */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <img
          src={coverImg}
          alt={restName}
          loading="eager"
          decoding="async"
          {...({ fetchPriority: 'high' } as React.ImgHTMLAttributes<HTMLImageElement>)}
          className="w-full h-full object-cover object-center opacity-25 filter blur-[2px] scale-110 transform animate-pulse duration-10000"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050608] via-[#050608]/90 to-[#050608]/80" />
        <div
          className="absolute inset-0 opacity-25"
          style={{
            background: `radial-gradient(circle at 50% 20%, ${primaryCol} 0%, transparent 65%)`,
          }}
        />
      </div>

      {/* Top SaaS Header Bar */}
      <div className="relative z-10 w-full max-w-xl flex items-center justify-between text-xs animate-in fade-in slide-in-from-top-4 duration-700">
        <div
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-luxury-900/90 border backdrop-blur-xl shadow-2xl"
          style={{ borderColor: `${primaryCol}50`, color: primaryCol }}
        >
          <Sparkles className="w-4 h-4 animate-spin text-[var(--brand-primary-strong)]" />
          <span className="font-bold tracking-wide">منصة مريح MUREEH · SaaS Showcase</span>
        </div>

        {activeTableId ? (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 font-mono text-xs backdrop-blur-xl shadow-lg">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-bold">طاولة {tableNumStr}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-luxury-900/80 border border-luxury-750 text-luxury-300 text-xs backdrop-blur-md">
            <QrCode className="w-3.5 h-3.5" style={{ color: primaryCol }} />
            <span>جلسة منيو رقمي</span>
          </div>
        )}
      </div>

      {/* Main SaaS Welcome Showcase Hero */}
      <div className="relative z-10 my-auto text-center max-w-xl w-full space-y-6 animate-in fade-in zoom-in-95 duration-700 py-4">
        {/* Glowing Monogram Logo */}
        <div className="relative inline-block group">
          <div
            className="absolute -inset-1.5 rounded-3xl opacity-75 blur-xl group-hover:opacity-100 transition duration-500 animate-pulse"
            style={{ background: `linear-gradient(135deg, ${primaryCol}, ${accentCol})` }}
          />
          <div
            className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-3xl mx-auto flex items-center justify-center overflow-hidden text-luxury-950 font-serif font-extrabold text-4xl shadow-2xl border-2 bg-luxury-950"
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

        {/* Restaurant Branding Header */}
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-5xl font-black text-luxury-50 font-serif tracking-tight leading-tight drop-shadow-md">
            {restName}
          </h1>
          <p
            className="text-xs sm:text-sm font-serif tracking-widest uppercase font-bold"
            style={{ color: primaryCol }}
          >
            {restNameEn}
          </p>
        </div>

        {/* Ornament Divider */}
        <div className="flex items-center justify-center gap-3 opacity-70">
          <div
            className="w-20 h-[1px]"
            style={{ background: `linear-gradient(to right, transparent, ${primaryCol}, transparent)` }}
          />
          <Award className="w-4 h-4 shrink-0" style={{ color: primaryCol }} />
          <div
            className="w-20 h-[1px]"
            style={{ background: `linear-gradient(to left, transparent, ${primaryCol}, transparent)` }}
          />
        </div>

        {/* SaaS Feature Highlights Grid Card */}
        <div
          className="p-6 rounded-3xl bg-luxury-900/90 border backdrop-blur-2xl shadow-2xl space-y-4 text-right"
          style={{ borderColor: `${primaryCol}40` }}
        >
          <div className="flex items-center justify-between border-b border-luxury-800 pb-3">
            <h3 className="text-sm font-bold text-luxury-100 font-serif flex items-center gap-2">
              <Zap className="w-4 h-4" style={{ color: primaryCol }} />
              <span>تجربة الخدمة الذكية المباشرة عبر المنيو</span>
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Live SaaS Platform
            </span>
          </div>

          {/* 3 SaaS Feature Pillars */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-2xl bg-luxury-950/80 border border-luxury-800 flex flex-col justify-between space-y-2">
              <div className="w-8 h-8 rounded-xl bg-[rgb(var(--brand-primary-strong-rgb)/0.1)] border border-[rgb(var(--brand-primary-strong-rgb)/0.3)] flex items-center justify-center text-[var(--brand-primary-strong)]">
                <ChefHat className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-luxury-100">مطبخ حي وتتبع لحظي</h4>
                <p className="text-[10px] text-luxury-400 mt-0.5">شاهد حالة أطباقك خطوة بخطوة من التحضير للتقديم</p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-luxury-950/80 border border-luxury-800 flex flex-col justify-between space-y-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-luxury-100">طلب مباشر بدون تطبيق</h4>
                <p className="text-[10px] text-luxury-400 mt-0.5">امسح الكود واطلب فوراً بلمسة واحدة</p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-luxury-950/80 border border-luxury-800 flex flex-col justify-between space-y-2">
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <PhoneCall className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-luxury-100">زر نادل ذكي واستدعاء</h4>
                <p className="text-[10px] text-luxury-400 mt-0.5">استدعاء الويتر فوراً مع تحديد نوع الخدمة</p>
              </div>
            </div>
          </div>

          {activeTableId && (
            <div className="pt-3 border-t border-luxury-800 flex items-center justify-between text-xs text-luxury-200">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>جلسة الطاولة مفعلة: <strong className="font-serif font-bold text-emerald-300">طاولة {tableNumStr}</strong></span>
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
      <div className="relative z-10 w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-700 space-y-3">
        <button
          onClick={handleStart}
          className="w-full py-4 px-6 rounded-2xl text-luxury-950 font-black transition-all shadow-2xl flex items-center justify-center gap-3 text-sm active:scale-98 group cursor-pointer"
          style={{
            background: `linear-gradient(135deg, ${primaryCol}, ${accentCol})`,
            boxShadow: `0 0 30px -5px ${primaryCol}80`,
          }}
        >
          <span>تصفح المنيو والتجارب الفاخرة</span>
          <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1.5 transition-transform" />
        </button>

        <div className="text-[11px] text-center text-luxury-400 space-y-1 pt-1">
          <p className="font-semibold text-luxury-300">
            منصة مريح MUREEH · نظام إدارة المطاعم الذكي
          </p>
          <p className="text-[10px] text-luxury-500">
            للتواصل المباشر مع المنصة تليجرام: <span className="font-mono" style={{ color: primaryCol }}>@Mureeh_tech_bot</span>
          </p>
        </div>
      </div>
    </div>
  );
};
