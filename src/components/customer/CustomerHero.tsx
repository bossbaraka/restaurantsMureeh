import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice, getOrderStatusConfig } from '../../utils/formatting';
import { Search, Sparkles, Flame, ChefHat, Clock, CheckCircle2, ArrowLeft, UtensilsCrossed, Camera, Play, X, Image as ImageIcon, Video, Film, Eye } from 'lucide-react';
import { OrderStatus } from '../../types/restaurant';

export const CustomerHero: React.FC = () => {
  const { searchQuery, setSearchQuery, offers, currentRestaurant, activeTableOrders, setIsOrderTrackingOpen } = useRestaurant();
  const currency = currentRestaurant?.currency || '₪';

  const [activeGalleryImg, setActiveGalleryImg] = useState<string | null>(null);
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);

  const activeOffers = offers.filter((o) => o.isActive);

  const heroImage = currentRestaurant?.coverImage || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85';
  const restName = currentRestaurant?.name || '';
  const restDesc = currentRestaurant?.description || 'مأكولات استثنائية محضرة بأيدي نخبة الطهاة بأرقى المكونات المعتقة.';
  const primaryCol = currentRestaurant?.primaryColor || '#D4AF37';
  const promoVideo = currentRestaurant?.promoVideoUrl || '';

  // Default interior dining hall gallery shots if none uploaded yet
  const defaultGallery = [
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=85',
    'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&w=1200&q=85',
    'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=85',
    'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=1200&q=85',
  ];

  const galleryList = (currentRestaurant?.galleryImages && currentRestaurant.galleryImages.length > 0)
    ? currentRestaurant.galleryImages
    : defaultGallery;

  const latestOrder = activeTableOrders.length > 0 ? activeTableOrders[0] : null;
  const statusCfg = latestOrder ? getOrderStatusConfig(latestOrder.status) : null;

  const getStepIndex = (status: OrderStatus) => {
    switch (status) {
      case 'PENDING':
        return 1;
      case 'PREPARING':
        return 2;
      case 'READY':
        return 3;
      case 'SERVED':
        return 4;
      default:
        return 0;
    }
  };

  const currentStep = latestOrder ? getStepIndex(latestOrder.status) : 0;

  return (
    <div className="relative overflow-hidden mb-6">
      {/* Background Editorial Hero Image & Video Container */}
      <div className="relative h-64 sm:h-80 w-full overflow-hidden rounded-2xl border border-luxury-800 shadow-2xl mx-auto group">
        {isPlayingVideo && promoVideo ? (
          <div className="relative w-full h-full bg-black">
            {promoVideo.includes('youtube.com') || promoVideo.includes('youtu.be') ? (
              <iframe
                src={`${promoVideo.replace('watch?v=', 'embed/')}?autoplay=1&muted=0`}
                title="فيديو صالة المطعم"
                className="w-full h-full border-0"
                allow="autoplay; encrypted-media"
                allowFullScreen
              />
            ) : (
              <video
                src={promoVideo}
                controls
                autoPlay
                className="w-full h-full object-cover"
              />
            )}
            <button
              onClick={() => setIsPlayingVideo(false)}
              className="absolute top-3 left-3 z-20 p-2 rounded-full bg-luxury-950/80 text-white hover:bg-red-500 transition-colors"
              title="إغلاق الفيديو"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <img
              src={heroImage}
              alt={restName}
              className="w-full h-full object-cover object-center transform scale-105 transition-transform duration-1000 ease-out group-hover:scale-100"
            />
            {/* Layered luxury overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-luxury-950 via-luxury-950/70 to-luxury-950/20" />
            <div className="absolute inset-0 bg-gradient-to-r from-luxury-950/90 via-luxury-950/40 to-transparent" />

            {/* Hero Content */}
            <div className="absolute inset-0 p-6 sm:p-8 flex flex-col justify-end text-right z-10 max-w-xl">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-luxury-900/90 border backdrop-blur-md text-xs font-bold shadow-lg"
                  style={{ borderColor: `${primaryCol}50`, color: primaryCol }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>قائمة الطعام الرقمية — {restName}</span>
                </div>

                {promoVideo && (
                  <button
                    onClick={() => setIsPlayingVideo(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-600/90 hover:bg-red-500 text-white text-xs font-bold backdrop-blur-md shadow-lg transition-transform active:scale-95 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>فيديو صالة المطعم</span>
                  </button>
                )}
              </div>

              <h2 className="text-2xl sm:text-4xl font-extrabold text-luxury-50 font-serif tracking-tight leading-tight mb-1.5">
                أجواء فاخرة وتجربة تُكتشف.
              </h2>

              <p className="text-xs sm:text-sm text-luxury-300 leading-relaxed max-w-md line-clamp-2">
                {restDesc}
              </p>
            </div>
          </>
        )}
      </div>

      {/* RESTAURANT DINING HALL & INTERIOR CREATIVE GALLERY BAR */}
      <div className="mt-4 p-3.5 rounded-2xl bg-luxury-900/90 border border-luxury-800 space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold text-luxury-200 flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-[var(--brand-primary-strong)]" />
            <span>لقطات حية من داخل صالة المطعم والأجواء</span>
          </span>
          <span className="text-[11px] text-luxury-400 font-mono">
            {galleryList.length} صور مصورة
          </span>
        </div>

        {/* Scrollable Gallery Thumbnails Strip */}
        <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar py-1">
          {galleryList.map((imgUrl, index) => (
            <button
              key={index}
              onClick={() => setActiveGalleryImg(imgUrl)}
              className="relative w-28 h-20 sm:w-36 sm:h-24 rounded-xl overflow-hidden shrink-0 border border-luxury-750 group cursor-pointer hover:border-[rgb(var(--brand-primary-strong-rgb)/0.8)] transition-all shadow-md"
            >
              <img
                src={imgUrl}
                alt={`صالة المطعم ${index + 1}`}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                <Eye className="w-5 h-5 text-[var(--brand-primary-strong)]" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* PROMINENT LIVE ORDER STATUS BANNER ON MENU PAGE */}
      {latestOrder && statusCfg && (
        <div className="mt-4 p-4 rounded-2xl bg-luxury-900/95 border border-[rgb(var(--brand-primary-strong-rgb)/0.5)] shadow-2xl backdrop-blur-md space-y-3 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex items-center justify-between border-b border-luxury-800 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-[rgb(var(--brand-primary-strong-rgb)/0.15)] border border-[rgb(var(--brand-primary-strong-rgb)/0.3)] flex items-center justify-center text-[var(--brand-primary-strong)]">
                <ChefHat className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-luxury-50">حالة طلبك الفعّال #{latestOrder.id.slice(-6)}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[rgb(var(--brand-primary-strong-rgb)/0.2)] text-[var(--brand-primary-strong)] border border-[rgb(var(--brand-primary-strong-rgb)/0.4)] font-mono">
                    {formatPrice(latestOrder.total, currency)}
                  </span>
                </div>
                <p className="text-[11px] text-luxury-400 mt-0.5">
                  المطبخ الحي يعمل على تجهيز طلبك الآن بكل عناية
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsOrderTrackingOpen(true)}
              className="px-3.5 py-1.5 rounded-xl brand-cta font-bold text-xs flex items-center gap-1 shadow-[0_0_22px_-6px_var(--brand-glow)] transition-all"
            >
              <span>تفاصيل الطلب</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Stepper Progress Bar */}
          <div className="grid grid-cols-4 gap-1 sm:gap-2 pt-1 text-center">
            {/* Step 1: Received */}
            <div className={`p-2 rounded-xl border text-[11px] font-semibold transition-all ${
              currentStep >= 1
                ? 'bg-[rgb(var(--brand-primary-strong-rgb)/0.15)] border-[rgb(var(--brand-primary-strong-rgb)/0.5)] text-[var(--brand-primary-strong)]'
                : 'bg-luxury-950 border-luxury-850 text-luxury-500'
            }`}>
              <div className="flex items-center justify-center mb-1">
                <Clock className={`w-3.5 h-3.5 ${currentStep >= 1 ? 'text-[var(--brand-primary-strong)]' : 'text-luxury-600'}`} />
              </div>
              <span className="block text-[10px]">استقبال</span>
            </div>

            {/* Step 2: Kitchen Preparing */}
            <div className={`p-2 rounded-xl border text-[11px] font-semibold transition-all ${
              currentStep >= 2
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 animate-pulse'
                : 'bg-luxury-950 border-luxury-850 text-luxury-500'
            }`}>
              <div className="flex items-center justify-center mb-1">
                <ChefHat className={`w-3.5 h-3.5 ${currentStep >= 2 ? 'text-amber-400' : 'text-luxury-600'}`} />
              </div>
              <span className="block text-[10px]">تحضير</span>
            </div>

            {/* Step 3: Ready */}
            <div className={`p-2 rounded-xl border text-[11px] font-semibold transition-all ${
              currentStep >= 3
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-luxury-950 border-luxury-850 text-luxury-500'
            }`}>
              <div className="flex items-center justify-center mb-1">
                <Sparkles className={`w-3.5 h-3.5 ${currentStep >= 3 ? 'text-emerald-400' : 'text-luxury-600'}`} />
              </div>
              <span className="block text-[10px]">جاهز</span>
            </div>

            {/* Step 4: Served */}
            <div className={`p-2 rounded-xl border text-[11px] font-semibold transition-all ${
              currentStep >= 4
                ? 'bg-blue-500/15 border-blue-500/50 text-blue-300'
                : 'bg-luxury-950 border-luxury-850 text-luxury-500'
            }`}>
              <div className="flex items-center justify-center mb-1">
                <UtensilsCrossed className={`w-3.5 h-3.5 ${currentStep >= 4 ? 'text-blue-400' : 'text-luxury-600'}`} />
              </div>
              <span className="block text-[10px]">تم التقديم</span>
            </div>
          </div>
        </div>
      )}

      {/* Search Input Bar */}
      <div className="mt-4 relative max-w-4xl mx-auto">
        <div className="relative flex items-center">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث عن طبق، مكون، أو صنف..."
            className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 placeholder-luxury-500 rounded-xl py-3 pr-11 pl-4 text-sm focus:outline-none focus:border-[rgb(var(--brand-primary-strong-rgb)/0.6)] focus:ring-1 focus:ring-[rgb(var(--brand-primary-strong-rgb)/0.3)] transition-all shadow-inner"
          />
          <Search className="w-4 h-4 text-luxury-400 absolute right-4 pointer-events-none" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-3.5 text-xs text-luxury-400 hover:text-luxury-200 bg-luxury-800 px-2 py-0.5 rounded-md"
            >
              مسح
            </button>
          )}
        </div>
      </div>

      {/* Special Offers Strip */}
      {!searchQuery && activeOffers.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2.5 px-1">
            <span className="text-xs font-bold text-[var(--brand-primary-strong)] flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-[var(--brand-primary-strong)] fill-[rgb(var(--brand-primary-strong-rgb)/0.2)]" />
              العروض والتجارب الحصرية
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeOffers.map((offer) => (
              <div
                key={offer.id}
                className="relative overflow-hidden rounded-xl bg-luxury-900 border border-[rgb(var(--brand-primary-strong-rgb)/0.2)] p-3.5 flex gap-3.5 items-center hover:border-[rgb(var(--brand-primary-strong-rgb)/0.4)] transition-all group"
              >
                <img
                  src={offer.image}
                  alt={offer.title}
                  className="w-20 h-20 rounded-lg object-cover shrink-0 border border-luxury-800 group-hover:scale-105 transition-transform duration-300"
                />
                <div className="flex-1 text-right min-w-0">
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-[rgb(var(--brand-primary-strong-rgb)/0.2)] text-[var(--brand-primary-strong)] border border-[rgb(var(--brand-primary-strong-rgb)/0.3)] mb-1">
                    {offer.badge}
                  </span>
                  <h4 className="text-xs font-bold text-luxury-100 truncate">{offer.title}</h4>
                  <p className="text-[11px] text-luxury-400 line-clamp-1 mt-0.5">{offer.subtitle}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-sm font-bold text-[var(--brand-primary-strong)]">
                      {formatPrice(offer.discountedPrice || 0, currency)}
                    </span>
                    {offer.originalPrice && (
                      <span className="text-xs text-luxury-500 line-through">
                        {formatPrice(offer.originalPrice, currency)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FULLSCREEN LIGHTBOX FOR INTERIOR HALL GALLERY PHOTOS */}
      {activeGalleryImg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
          <button
            onClick={() => setActiveGalleryImg(null)}
            className="absolute top-4 left-4 p-2.5 rounded-full bg-luxury-900 text-luxury-200 hover:text-white border border-luxury-700 transition-colors z-10"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="relative max-w-4xl max-h-[85vh] w-full rounded-2xl overflow-hidden border border-luxury-700 shadow-2xl">
            <img
              src={activeGalleryImg}
              alt="صالة المطعم"
              className="w-full h-full object-contain max-h-[85vh] mx-auto"
            />
            <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 to-transparent text-right text-xs text-luxury-200">
              <span className="font-bold font-serif text-sm text-[var(--brand-primary-strong)]">لقطة من داخل صالة وأجواء {restName}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
