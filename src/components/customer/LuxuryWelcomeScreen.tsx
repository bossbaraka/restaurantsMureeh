import React, { useState, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Sparkles, ArrowLeft, UtensilsCrossed, MapPin, QrCode } from 'lucide-react';

interface LuxuryWelcomeScreenProps {
  onDismiss: () => void;
}

export const LuxuryWelcomeScreen: React.FC<LuxuryWelcomeScreenProps> = ({ onDismiss }) => {
  const { currentRestaurant, activeTableId, tables } = useRestaurant();
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  const tableNumStr = activeTableId ? activeTableId.replace('TABLE-', '') : '12';
  const restName = currentRestaurant?.name || 'مطعم مِيرار الفاخر';
  const restNameEn = currentRestaurant?.nameEn || 'MÉRAR LUXURY DINING';
  const coverImg = currentRestaurant?.coverImage || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85';
  const primaryCol = currentRestaurant?.primaryColor || '#D4AF37';

  const handleStart = () => {
    setIsAnimatingOut(true);
    setTimeout(() => {
      onDismiss();
    }, 400);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-between p-6 sm:p-10 bg-[#07080A] text-luxury-50 transition-all duration-500 overflow-hidden select-none ${
        isAnimatingOut ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'
      }`}
      dir="rtl"
    >
      {/* Background Cinematic Food Photography with Luxury Ambient Gradients */}
      <div className="absolute inset-0 z-0">
        <img
          src={coverImg}
          alt={restName}
          className="w-full h-full object-cover object-center opacity-25 filter blur-[2px] scale-105 transform animate-pulse duration-10000"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07080A] via-[#07080A]/85 to-[#07080A]/70" />
        <div className="absolute inset-0 bg-radial-gradient from-transparent via-[#07080A]/70 to-[#07080A]" />
      </div>

      {/* Top Header Badge */}
      <div className="relative z-10 w-full flex items-center justify-between text-xs animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-luxury-900/80 border border-gold-500/30 text-gold-300 backdrop-blur-md">
          <Sparkles className="w-3.5 h-3.5 text-gold-400" />
          <span>تجربة الضيافة الرقمية الفاخرة</span>
        </div>

        {activeTableId && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-luxury-900/80 border border-luxury-750 text-luxury-300 font-mono text-xs backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>طاولة {tableNumStr}</span>
          </div>
        )}
      </div>

      {/* Main Luxury Hero Typography Content */}
      <div className="relative z-10 my-auto text-center max-w-lg space-y-6 animate-in fade-in zoom-in-95 duration-1000">
        {/* Monogram / Logo Mark */}
        <div
          className="w-20 h-20 rounded-2xl mx-auto flex items-center justify-center text-luxury-950 font-serif font-bold text-3xl shadow-gold-glow border border-gold-400/40 transform transition-transform hover:scale-105 duration-300"
          style={{
            background: `linear-gradient(135deg, #FFF6DD 0%, ${primaryCol} 50%, #9C7A4A 100%)`,
          }}
        >
          {restNameEn.charAt(0) || 'M'}
        </div>

        {/* Brand Name */}
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-luxury-50 font-serif tracking-wide leading-tight">
            {restName}
          </h1>
          <p className="text-xs sm:text-sm text-gold-400 font-serif tracking-widest uppercase mt-1">
            {restNameEn}
          </p>
        </div>

        {/* Divider Ornament */}
        <div className="flex items-center justify-center gap-3 opacity-60">
          <div className="w-12 h-[1px] bg-gradient-to-r from-transparent to-gold-400" />
          <div className="w-1.5 h-1.5 rotate-45 bg-gold-400" />
          <div className="w-12 h-[1px] bg-gradient-to-l from-transparent to-gold-400" />
        </div>

        {/* Poetic Welcome Copy */}
        <div className="space-y-2">
          <p className="text-base sm:text-lg text-luxury-100 font-serif leading-relaxed italic">
            «أهلاً بكم.. حيث تتحول التفاصيل الصغيرة إلى تجربة لا تُنسى.»
          </p>
          <p className="text-xs text-luxury-400 max-w-sm mx-auto leading-relaxed">
            تصفح قائمتنا المختارة بعناية، خصص أطباقك حسب ذوقك، واطلب مباشرة إلى طاولتك.
          </p>
        </div>

        {/* Table Detected Card */}
        {activeTableId && (
          <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-luxury-900/90 border border-gold-500/30 backdrop-blur-md text-xs shadow-luxury">
            <QrCode className="w-4 h-4 text-gold-400" />
            <span className="text-luxury-200">
              تم التعرف على جلستك في: <strong className="text-gold-400 font-serif text-sm">طاولة {tableNumStr}</strong>
            </span>
          </div>
        )}
      </div>

      {/* Bottom CTA Button */}
      <div className="relative z-10 w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-1000 space-y-3">
        <button
          onClick={handleStart}
          className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-gold-500 via-gold-400 to-gold-600 text-luxury-950 font-bold hover:from-gold-400 hover:to-gold-500 transition-all shadow-gold-glow flex items-center justify-center gap-3 text-sm active:scale-98 group"
        >
          <span>ابدأ تجربتك واستعرض القائمة</span>
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        </button>

        <p className="text-[10px] text-center text-luxury-500">
          لا يتطلب تسجيل حساب · الدفع عند الكاشير
        </p>
      </div>
    </div>
  );
};
