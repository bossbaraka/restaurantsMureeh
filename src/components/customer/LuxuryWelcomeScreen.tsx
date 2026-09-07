import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Sparkles, ArrowLeft, UtensilsCrossed, MessageCircle, QrCode, ShieldCheck, PhoneCall, Award } from 'lucide-react';

interface LuxuryWelcomeScreenProps {
  onDismiss: () => void;
}

export const LuxuryWelcomeScreen: React.FC<LuxuryWelcomeScreenProps> = ({ onDismiss }) => {
  const { currentRestaurant, activeTableId } = useRestaurant();
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  const tableNumStr = activeTableId ? activeTableId.replace(/^(?:TABLE-|.*-T)/, '') : '—';
  const restName = currentRestaurant?.name || 'مطعم مريح الأخرق';
  const restNameEn = currentRestaurant?.nameEn || 'MUREEH DINING';
  const coverImg = currentRestaurant?.coverImage || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85';
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
      {/* Background Cinematic Food Photography with Ambient Light Rays */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <img
          src={coverImg}
          alt={restName}
          className="w-full h-full object-cover object-center opacity-30 filter blur-[3px] scale-110 transform animate-pulse duration-10000"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050608] via-[#050608]/90 to-[#050608]/75" />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background: `radial-gradient(ellipse at top, ${primaryCol} 0%, transparent 70%)`,
          }}
        />
      </div>

      {/* Top Header Bar with Platform Badge */}
      <div className="relative z-10 w-full max-w-lg flex items-center justify-between text-xs animate-in fade-in slide-in-from-top-4 duration-700">
        <div
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-luxury-900/90 border backdrop-blur-md shadow-lg"
          style={{ borderColor: `${primaryCol}40`, color: primaryCol }}
        >
          <Sparkles className="w-3.5 h-3.5 animate-spin" />
          <span className="font-bold">منصة مريح MUREEH · الخدمة الذكية</span>
        </div>

        {activeTableId ? (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono text-xs backdrop-blur-md">
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

      {/* Main Creative Welcome Hero Box */}
      <div className="relative z-10 my-auto text-center max-w-md w-full space-y-6 animate-in fade-in zoom-in-95 duration-1000 py-6">
        {/* Glowing Monogram Logo */}
        <div className="relative inline-block group">
          <div
            className="absolute -inset-1 rounded-3xl opacity-70 blur-lg group-hover:opacity-100 transition duration-500 animate-pulse"
            style={{ background: `linear-gradient(135deg, ${primaryCol}, ${accentCol})` }}
          />
          <div
            className="relative w-24 h-24 rounded-3xl mx-auto flex items-center justify-center overflow-hidden text-luxury-950 font-serif font-extrabold text-4xl shadow-2xl border-2 bg-luxury-950"
            style={{
              borderColor: `${primaryCol}80`,
              background: currentRestaurant?.logo
                ? '#0A0B0D'
                : `linear-gradient(135deg, ${primaryCol}, ${accentCol})`,
            }}
          >
            {currentRestaurant?.logo ? (
              <img src={currentRestaurant.logo} alt={restName} className="w-full h-full object-cover" />
            ) : (
              restNameEn.charAt(0) || 'M'
            )}
          </div>
        </div>

        {/* Restaurant Title & Subtitle */}
        <div className="space-y-1">
          <h1 className="text-3xl sm:text-4xl font-black text-luxury-50 font-serif tracking-tight leading-tight drop-shadow-md">
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
            className="w-16 h-[1px]"
            style={{ background: `linear-gradient(to right, transparent, ${primaryCol}, transparent)` }}
          />
          <Award className="w-4 h-4 shrink-0" style={{ color: primaryCol }} />
          <div
            className="w-16 h-[1px]"
            style={{ background: `linear-gradient(to left, transparent, ${primaryCol}, transparent)` }}
          />
        </div>

        {/* Creative Poetic Welcome Card */}
        <div
          className="p-5 rounded-3xl bg-luxury-900/85 border backdrop-blur-xl shadow-2xl space-y-3"
          style={{ borderColor: `${primaryCol}30` }}
        >
          <p className="text-base sm:text-lg text-luxury-100 font-serif leading-relaxed italic font-medium">
            «أهلاً بكم في رحاب الضيافة الاستثنائية.. طلبك يصل لطاولتك مباشرة بلمسة واحدة.»
          </p>
          <p className="text-xs text-luxury-300 leading-relaxed max-w-xs mx-auto">
            تصفح أشهى الأطباق المجهزة طازجة بكل عناية، واطلب مباشرة مع متابعة حالة التحضير لحظة بلحظة.
          </p>

          {activeTableId && (
            <div className="pt-2 border-t border-luxury-800 flex items-center justify-center gap-2 text-xs text-luxury-200">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>الجلسة مفعلة ومربوطة بـ <strong className="font-serif font-bold" style={{ color: primaryCol }}>طاولة {tableNumStr}</strong></span>
            </div>
          )}
        </div>

        {/* WhatsApp Contact Badge */}
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs font-semibold backdrop-blur-md">
          <MessageCircle className="w-4 h-4 text-emerald-400 animate-bounce" />
          <span>للتواصل والدعم عبر واتساب:</span>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono font-bold text-emerald-300 hover:text-white underline direction-ltr"
          >
            00970593498909
          </a>
        </div>
      </div>

      {/* Bottom CTA Button & Platform Credits */}
      <div className="relative z-10 w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-1000 space-y-3">
        <button
          onClick={handleStart}
          className="w-full py-4 px-6 rounded-2xl text-luxury-950 font-black transition-all shadow-2xl flex items-center justify-center gap-3 text-sm active:scale-98 group cursor-pointer"
          style={{
            background: `linear-gradient(135deg, ${primaryCol}, ${accentCol})`,
            boxShadow: `0 0 25px -5px ${primaryCol}60`,
          }}
        >
          <span>استعرض القائمة واطلب الآن</span>
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        </button>

        <div className="text-[11px] text-center text-luxury-400 space-y-1 pt-1">
          <p className="font-semibold text-luxury-300">
            خدمة منيو رقمي وحجوزات من <strong style={{ color: primaryCol }}>منصة مريح MUREEH</strong>
          </p>
          <p className="text-[10px] text-luxury-500">
            للتواصل المباشر مع المنصة واتساب: <span className="font-mono" style={{ color: primaryCol }}>00970593498909</span>
          </p>
        </div>
      </div>
    </div>
  );
};

