import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice, getOrderStatusConfig } from '../../utils/formatting';
import { Search, Sparkles, Flame, ChefHat, Clock, ArrowLeft, UtensilsCrossed, Camera, Play, X, Eye, ChevronRight, ChevronLeft } from 'lucide-react';
import { OrderStatus } from '../../types/restaurant';
import { optimizeImageUrl } from './ProductImage';
import { useDialog } from '../../hooks/useDialog';
import {
  isAwaitingGuestPayment,
  isPaymentVerificationPending,
  isPaymentRejected,
  isOrderOperational,
} from '../../utils/orderLifecycle';

/**
 * Turn a manager-supplied promo-video link into an embeddable YouTube player
 * source. Only well-formed YouTube links are accepted (watch?v=, youtu.be,
 * embed/, shorts/, live/); anything else returns null so no arbitrary frame is
 * ever rendered. Autoplay is muted so the browser's autoplay policy actually
 * lets the video start without a tap.
 */
function toEmbeddableVideo(url: string): { kind: 'youtube'; src: string } | null {
  if (!url) return null;
  const yt = url.match(
    /(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})/
  );
  if (yt) {
    const id = yt[1] || yt[2];
    return {
      kind: 'youtube',
      src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&muted=1&rel=0`,
    };
  }
  return null;
}

const DEFAULT_GALLERY = [
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=85',
  'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&w=1200&q=85',
  'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=85',
  'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=1200&q=85',
];

export const CustomerHero: React.FC = () => {
  const { searchQuery, setSearchQuery, offers, currentRestaurant, activeTableOrders, setIsOrderTrackingOpen } = useRestaurant();
  const currency = currentRestaurant?.currency || '₪';

  const galleryList = (currentRestaurant?.galleryImages && currentRestaurant.galleryImages.length > 0)
    ? currentRestaurant.galleryImages
    : DEFAULT_GALLERY;

  const [activeGalleryIndex, setActiveGalleryIndex] = useState<number | null>(null);
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const handleNext = () => {
    setActiveGalleryIndex((prev) => (prev !== null ? (prev + 1) % galleryList.length : 0));
  };

  const handlePrev = () => {
    setActiveGalleryIndex((prev) => (prev !== null ? (prev - 1 + galleryList.length) % galleryList.length : 0));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(deltaX) > 40) {
      if (deltaX > 0) {
        // In RTL, swipe right goes to previous image
        handlePrev();
      } else {
        // Swipe left goes to next image
        handleNext();
      }
    }
    touchStartX.current = null;
  };

  // Full-screen photo lightbox: Escape closes, focus is trapped and restored.
  useDialog({ isOpen: activeGalleryIndex !== null, onClose: () => setActiveGalleryIndex(null) });

  // Keyboard arrow navigation for lightbox
  useEffect(() => {
    if (activeGalleryIndex === null || typeof window === 'undefined') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        handlePrev();
      } else if (e.key === 'ArrowLeft') {
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeGalleryIndex, galleryList.length]);

  // The promo video plays inline inside the hero: Escape still closes it, but
  // it is non-modal — no scroll lock or focus trap for an in-page media swap.
  useDialog({
    isOpen: isPlayingVideo,
    onClose: () => setIsPlayingVideo(false),
    lockBodyScroll: false,
    trapFocus: false,
  });

  const activeOffers = offers.filter((o) => o.isActive);

  const heroImage = currentRestaurant?.coverImage || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85';
  const restName = currentRestaurant?.name || '';
  const restDesc = currentRestaurant?.description || 'مأكولات استثنائية محضرة بأيدي نخبة الطهاة بأرقى المكونات المعتقة.';
  const promoVideo = currentRestaurant?.promoVideoUrl || '';

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
  const isAwaitingPayment = latestOrder ? isAwaitingGuestPayment(latestOrder) : false;
  const isVerificationPending = latestOrder ? isPaymentVerificationPending(latestOrder) : false;

  const heroOrderStatusText = useMemo(() => {
    if (!latestOrder) return '';
    if (isAwaitingGuestPayment(latestOrder)) {
      return 'طلبك بانتظار تأكيد الدفع لبدء التحضير';
    }
    if (isPaymentVerificationPending(latestOrder)) {
      return 'جاري التحقق من إشعار التحويل بواسطة الكاشير';
    }
    if (isPaymentRejected(latestOrder)) {
      return 'لم يتم تأكيد إشعار التحويل — يرجى مراجعة الكاشير';
    }
    if (latestOrder.status === 'PREPARING') {
      return 'المطبخ الحي يعمل على تجهيز طلبك الآن بكل عناية';
    }
    if (latestOrder.status === 'READY') {
      return 'طلبك جاهز ولذيذ وبانتظار التقديم';
    }
    if (latestOrder.status === 'SERVED') {
      return 'تم تقديم وجبتك، نتمنى لك تجربة ممتعة';
    }
    if (isOrderOperational(latestOrder)) {
      return 'تم تأكيد الدفع، والمطبخ يستعد لتحضير طلبك';
    }
    return 'طلبك بانتظار تأكيد الدفع لبدء التحضير';
  }, [latestOrder]);

  return (
    <div className="relative overflow-hidden mb-6">
      {/* Background Editorial Hero Image & Video Container */}
      <div className="relative h-64 sm:h-80 w-full overflow-hidden rounded-2xl border border-m-hairline shadow-2xl mx-auto group">
        {isPlayingVideo && promoVideo ? (
          <div
            role="dialog"
            aria-modal="false"
            aria-label="مشغّل فيديو صالة المطعم"
            className="relative w-full h-full bg-black"
          >
            {(() => {
              const embed = toEmbeddableVideo(promoVideo);
              if (!embed) return null;
              return (
                <iframe
                  src={embed.src}
                  title="فيديو صالة المطعم"
                  className="w-full h-full border-0"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              );
            })()}
            <button
              onClick={() => setIsPlayingVideo(false)}
              className="touch-target absolute top-3 left-3 z-20 p-2.5 rounded-full bg-m-bg/80 text-white hover:bg-red-500 transition-colors"
              title="إغلاق الفيديو"
              aria-label="إغلاق الفيديو"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <img
              src={optimizeImageUrl(heroImage, 1280, 75)}
              alt={restName}
              loading="eager"
              decoding="async"
              // React 19 prop; DOM attribute is `fetchpriority`.
              {...({ fetchPriority: 'high' } as React.ImgHTMLAttributes<HTMLImageElement>)}
              className="w-full h-full object-cover object-center transform scale-105 transition-transform duration-1000 ease-out group-hover:scale-100"
            />
            {/* Layered luxury overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-m-bg via-m-bg/70 to-m-bg/20" />
            <div className="absolute inset-0 bg-gradient-to-r from-m-bg/90 via-m-bg/40 to-transparent" />

            {/* Hero Content */}
            <div className="absolute inset-0 p-6 sm:p-8 flex flex-col justify-end text-right z-10 max-w-xl">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-m-surface/90 border backdrop-blur-md text-xs font-bold shadow-lg"
                  style={{
                    // Brand identity via the resolved --brand-* tokens
                    // (theme-first), not the legacy color columns.
                    borderColor: 'rgb(var(--m-brand-on-surface-rgb) / 0.5)',
                    color: 'var(--m-brand-on-surface)',
                  }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>قائمة الطعام الرقمية — {restName}</span>
                </div>

                {promoVideo && toEmbeddableVideo(promoVideo) && (
                  <button
                    onClick={() => setIsPlayingVideo(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-600/90 hover:bg-red-500 text-white text-xs font-bold backdrop-blur-md shadow-lg transition-transform active:scale-95 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>فيديو صالة المطعم</span>
                  </button>
                )}
              </div>

              <h2 className="text-2xl sm:text-4xl font-extrabold text-m-text font-serif tracking-tight leading-tight mb-1.5">
                أجواء فاخرة وتجربة تُكتشف.
              </h2>

              <p className="text-xs sm:text-sm text-m-text-muted leading-relaxed max-w-md line-clamp-2">
                {restDesc}
              </p>
            </div>
          </>
        )}
      </div>

      {/* RESTAURANT DINING HALL & EDITORIAL ATMOSPHERE GALLERY */}
      {galleryList.length > 0 && (
        <div className="mt-5 p-4 sm:p-5 rounded-3xl bg-m-surface/90 border border-m-hairline space-y-3.5 shadow-2xl">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs sm:text-sm font-bold text-m-text flex items-center gap-2">
              <Camera className="w-4 h-4 text-[var(--m-brand-on-surface)]" />
              <span>أجواء وصالة المطعم الحية</span>
            </span>
            <span className="text-[11px] text-m-text-muted font-mono">
              {galleryList.length} لقطات حصرية
            </span>
          </div>

          {/* Desktop & Tablet: Large main image + clean secondary asymmetric grid */}
          <div className="hidden md:grid grid-cols-12 gap-3.5 items-stretch">
            {/* Main Atmosphere Hero Image */}
            <button
              type="button"
              onClick={() => setActiveGalleryIndex(0)}
              aria-label="عرض صورة الصالة الرئيسية بالحجم الكامل"
              className={`${
                galleryList.length === 1 ? 'col-span-12 h-[420px]' : 'col-span-7 h-[420px]'
              } relative rounded-2xl overflow-hidden group cursor-pointer border border-m-hairline shadow-xl transition-all hover:border-[var(--m-brand-on-surface)] text-right`}
            >
              <img
                src={optimizeImageUrl(galleryList[0], 1200, 80)}
                alt="الصورة الرئيسية لصالة المطعم"
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
              <div className="absolute bottom-3.5 right-3.5 z-10 flex items-center gap-2 text-white">
                <div className="px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-white/20 text-xs font-bold flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-[var(--m-brand-on-surface)]" />
                  <span>اللقطة الرئيسية</span>
                </div>
              </div>
            </button>

            {/* Supporting Asymmetric Secondary Grid */}
            {galleryList.length > 1 && (
              <div
                className={`col-span-5 grid gap-3 ${
                  galleryList.length === 2
                    ? 'grid-cols-1 h-[420px]'
                    : galleryList.length === 3
                    ? 'grid-cols-1 grid-rows-2 h-[420px]'
                    : 'grid-cols-2 grid-rows-2 h-[420px]'
                }`}
              >
                {galleryList.slice(1, 5).map((imgUrl, idx) => {
                  const actualIndex = idx + 1;
                  const isLastSlot = idx === 3 && galleryList.length > 5;
                  return (
                    <button
                      key={actualIndex}
                      type="button"
                      onClick={() => setActiveGalleryIndex(actualIndex)}
                      aria-label={`عرض صورة المعرض رقم ${actualIndex + 1}`}
                      className="relative w-full h-full rounded-xl overflow-hidden group cursor-pointer border border-m-hairline transition-all hover:border-[var(--m-brand-on-surface)] shadow-md"
                    >
                      <img
                        src={optimizeImageUrl(imgUrl, 600, 75)}
                        alt={`لقطة ${actualIndex + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                        <Eye className="w-5 h-5 text-[var(--m-brand-on-surface)]" />
                      </div>
                      {isLastSlot && (
                        <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-white font-bold font-mono text-sm">
                          +{galleryList.length - 4} صور
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mobile: Large main atmosphere card + swipeable scroll-snap strip */}
          <div className="block md:hidden space-y-2.5">
            {/* Mobile Main Atmosphere Image */}
            <button
              type="button"
              onClick={() => setActiveGalleryIndex(0)}
              aria-label="عرض صورة الصالة الرئيسية"
              className="w-full aspect-[4/3] relative rounded-2xl overflow-hidden border border-m-hairline shadow-lg text-right group cursor-pointer"
            >
              <img
                src={optimizeImageUrl(galleryList[0], 800, 80)}
                alt="الصورة الرئيسية لصالة المطعم"
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-2.5 right-2.5 z-10 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-white/20 text-[11px] font-bold text-white flex items-center gap-1.5">
                <Eye className="w-3 h-3 text-[var(--m-brand-on-surface)]" />
                <span>اللقطة الرئيسية</span>
              </div>
            </button>

            {/* Mobile Secondary Swipeable Snap Strip */}
            {galleryList.length > 1 && (
              <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar py-1 snap-x">
                {galleryList.slice(1).map((imgUrl, idx) => {
                  const actualIndex = idx + 1;
                  return (
                    <button
                      key={actualIndex}
                      type="button"
                      onClick={() => setActiveGalleryIndex(actualIndex)}
                      aria-label={`عرض صورة المعرض رقم ${actualIndex + 1}`}
                      className="relative w-36 aspect-[4/3] rounded-xl overflow-hidden shrink-0 border border-m-hairline snap-start group cursor-pointer shadow-md"
                    >
                      <img
                        src={optimizeImageUrl(imgUrl, 420, 70)}
                        alt={`لقطة ${actualIndex + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                        <Eye className="w-4 h-4 text-[var(--m-brand-on-surface)]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PROMINENT LIVE ORDER STATUS BANNER ON MENU PAGE */}
      {latestOrder && statusCfg && (
        <div className="mt-4 p-4 rounded-2xl bg-m-surface/95 border border-[rgb(var(--m-brand-on-surface-rgb)/0.5)] shadow-2xl backdrop-blur-md space-y-3 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex items-center justify-between border-b border-m-hairline pb-2.5">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-[rgb(var(--m-brand-on-surface-rgb)/0.15)] border border-[rgb(var(--m-brand-on-surface-rgb)/0.3)] flex items-center justify-center text-[var(--m-brand-on-surface)]">
                {isAwaitingPayment || isVerificationPending ? (
                  <Clock className="w-5 h-5 text-amber-400" />
                ) : (
                  <ChefHat className="w-5 h-5 animate-pulse" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-m-text">حالة طلبك الفعّال #{latestOrder.id.slice(-6)}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[rgb(var(--m-brand-on-surface-rgb)/0.2)] text-[var(--m-brand-on-surface)] border border-[rgb(var(--m-brand-on-surface-rgb)/0.4)] font-mono">
                    {formatPrice(latestOrder.total, currency)}
                  </span>
                </div>
                <p className="text-[11px] text-m-text-muted mt-0.5">
                  {heroOrderStatusText}
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsOrderTrackingOpen(true)}
              className="px-3.5 py-1.5 rounded-xl brand-cta font-bold text-xs flex items-center gap-1 shadow-[0_0_22px_-6px_var(--m-brand-glow)] transition-all"
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
                ? 'bg-[rgb(var(--m-brand-on-surface-rgb)/0.15)] border-[rgb(var(--m-brand-on-surface-rgb)/0.5)] text-[var(--m-brand-on-surface)]'
                : 'bg-m-bg border-m-hairline text-m-text-subtle'
            }`}>
              <div className="flex items-center justify-center mb-1">
                <Clock className={`w-3.5 h-3.5 ${currentStep >= 1 ? 'text-[var(--m-brand-on-surface)]' : 'text-m-text-subtle'}`} />
              </div>
              <span className="block text-[10px]">استقبال</span>
            </div>

            {/* Step 2: Kitchen Preparing */}
            <div className={`p-2 rounded-xl border text-[11px] font-semibold transition-all ${
              currentStep >= 2
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 animate-pulse'
                : 'bg-m-bg border-m-hairline text-m-text-subtle'
            }`}>
              <div className="flex items-center justify-center mb-1">
                <ChefHat className={`w-3.5 h-3.5 ${currentStep >= 2 ? 'text-amber-400' : 'text-m-text-subtle'}`} />
              </div>
              <span className="block text-[10px]">تحضير</span>
            </div>

            {/* Step 3: Ready */}
            <div className={`p-2 rounded-xl border text-[11px] font-semibold transition-all ${
              currentStep >= 3
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-m-bg border-m-hairline text-m-text-subtle'
            }`}>
              <div className="flex items-center justify-center mb-1">
                <Sparkles className={`w-3.5 h-3.5 ${currentStep >= 3 ? 'text-emerald-400' : 'text-m-text-subtle'}`} />
              </div>
              <span className="block text-[10px]">جاهز</span>
            </div>

            {/* Step 4: Served */}
            <div className={`p-2 rounded-xl border text-[11px] font-semibold transition-all ${
              currentStep >= 4
                ? 'bg-blue-500/15 border-blue-500/50 text-blue-300'
                : 'bg-m-bg border-m-hairline text-m-text-subtle'
            }`}>
              <div className="flex items-center justify-center mb-1">
                <UtensilsCrossed className={`w-3.5 h-3.5 ${currentStep >= 4 ? 'text-blue-400' : 'text-m-text-subtle'}`} />
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
            aria-label="ابحث عن طبق، مكون، أو صنف"
            data-guide="search"
            className="w-full bg-m-surface border border-m-hairline text-m-text placeholder-m-text-subtle rounded-xl py-3 pr-11 pl-4 text-sm focus:outline-none focus:border-[rgb(var(--m-brand-on-surface-rgb)/0.6)] focus:ring-1 focus:ring-[rgb(var(--m-brand-on-surface-rgb)/0.3)] transition-all shadow-inner"
          />
          <Search className="w-4 h-4 text-m-text-muted absolute right-4 pointer-events-none" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-3.5 text-xs text-m-text-muted hover:text-m-text bg-m-surface-raised px-2 py-0.5 rounded-md"
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
            <span className="text-xs font-bold text-[var(--m-brand-on-surface)] flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-[var(--m-brand-on-surface)] fill-[rgb(var(--m-brand-on-surface-rgb)/0.2)]" />
              العروض والتجارب الحصرية
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeOffers.map((offer) => (
              <div
                key={offer.id}
                className="relative overflow-hidden rounded-xl bg-m-surface border border-[rgb(var(--m-brand-on-surface-rgb)/0.2)] p-3.5 flex gap-3.5 items-center hover:border-[rgb(var(--m-brand-on-surface-rgb)/0.4)] transition-all group"
              >
                <img
                  src={offer.image ? optimizeImageUrl(offer.image, 240, 75) : ''}
                  alt={offer.title}
                  loading="lazy"
                  decoding="async"
                  className="w-20 h-20 rounded-lg object-cover shrink-0 border border-m-hairline group-hover:scale-105 transition-transform duration-300"
                />
                <div className="flex-1 text-right min-w-0">
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-[rgb(var(--m-brand-on-surface-rgb)/0.2)] text-[var(--m-brand-on-surface)] border border-[rgb(var(--m-brand-on-surface-rgb)/0.3)] mb-1">
                    {offer.badge}
                  </span>
                  <h4 className="text-xs font-bold text-m-text truncate">{offer.title}</h4>
                  <p className="text-[11px] text-m-text-muted line-clamp-1 mt-0.5">{offer.subtitle}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-sm font-bold text-[var(--m-brand-on-surface)]">
                      {formatPrice(offer.discountedPrice || 0, currency)}
                    </span>
                    {offer.originalPrice && (
                      <span className="text-xs text-m-text-subtle line-through">
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
      {activeGalleryIndex !== null && galleryList[activeGalleryIndex] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl animate-in fade-in duration-300 select-none"
          onClick={() => setActiveGalleryIndex(null)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={() => setActiveGalleryIndex(null)}
            className="absolute top-4 left-4 p-2.5 rounded-full bg-m-surface/80 text-m-text hover:text-white border border-m-hairline/60 transition-colors z-20 backdrop-blur-sm"
            aria-label="إغلاق الصورة"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Counter Badge */}
          <div className="absolute top-4 right-4 z-20 px-3.5 py-1.5 rounded-full bg-m-surface/80 border border-m-hairline/60 text-xs font-mono font-bold text-m-text backdrop-blur-sm">
            <span>{activeGalleryIndex + 1}</span>
            <span className="text-m-text-subtle mx-1">/</span>
            <span>{galleryList.length}</span>
          </div>

          {/* Previous Button (Right arrow in RTL / Prev) */}
          {galleryList.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/60 text-white hover:bg-black/90 border border-white/20 transition-all hover:scale-110 shadow-lg"
              aria-label="الصورة السابقة"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          {/* Next Button (Left arrow in RTL / Next) */}
          {galleryList.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/60 text-white hover:bg-black/90 border border-white/20 transition-all hover:scale-110 shadow-lg"
              aria-label="الصورة التالية"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Modal Container */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`صورة من صالة المطعم (${activeGalleryIndex + 1} من ${galleryList.length})`}
            className="relative max-w-5xl max-h-[85vh] w-full rounded-2xl overflow-hidden border border-m-hairline shadow-2xl bg-black/50 flex flex-col items-center justify-center"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={galleryList[activeGalleryIndex]}
              alt={`صورة من صالة وأجواء المطعم ${activeGalleryIndex + 1}`}
              className="w-full h-full object-contain max-h-[80vh] mx-auto select-none"
            />
            <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent text-right text-xs text-m-text">
              <span className="font-bold font-serif text-sm text-[var(--m-brand-on-surface)]">
                لقطة من داخل صالة وأجواء {restName}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
