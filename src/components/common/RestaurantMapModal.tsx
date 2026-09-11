import React from 'react';
import { Restaurant } from '../../types/restaurant';
import { MapPin, Phone, ExternalLink, X, Navigation, Compass } from 'lucide-react';

interface RestaurantMapModalProps {
  restaurant: Restaurant | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Build the map sources.
 *
 * The embed prefers a precise coordinate pin when the venue set one; otherwise
 * it falls back to a Google-Maps search by the venue's address so the guest
 * still lands on the right building (previously the map silently defaulted to
 * a platform pin far from the restaurant).
 */
function resolveMapSources(restaurant: Restaurant) {
  const lat = restaurant.latitude;
  const lng = restaurant.longitude;
  const address = restaurant.address?.trim();
  // A venue-provided static map image replaces the external embed entirely.
  const mapImage = restaurant.mapImageUrl || null;

  const hasCoords = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);

  let query: string;
  if (hasCoords && lat !== undefined && lng !== undefined) {
    query = `${lat},${lng}`;
  } else if (address) {
    query = encodeURIComponent(`${address}, ${restaurant.name}`);
  } else {
    query = encodeURIComponent(restaurant.name || 'مطعم');
  }

  const embedUrl = `https://www.google.com/maps?q=${query}&z=16&hl=ar&output=embed`;
  const openUrl =
    restaurant.mapUrl ||
    `https://www.google.com/maps/search/?api=1&query=${query}`;

  return { lat, lng, hasCoords, mapImage, embedUrl, openUrl };
}

export const RestaurantMapModal: React.FC<RestaurantMapModalProps> = ({
  restaurant,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !restaurant) return null;

  const { lat, lng, hasCoords, mapImage, embedUrl, openUrl } = resolveMapSources(restaurant);
  const primaryColor = restaurant.primaryColor || '#D4AF37';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0" onClick={onClose} />

      {/* Modal Card */}
      <div className="relative w-full max-w-2xl bg-luxury-950 border border-luxury-800 rounded-3xl shadow-2xl overflow-hidden z-10 text-right flex flex-col max-h-[90vh]" dir="rtl">
        {/* Modal Header */}
        <div className="p-5 bg-luxury-900 border-b border-luxury-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ background: primaryColor }}
            >
              <MapPin className="w-5 h-5 text-black" />
            </div>
            <div>
              <h3 className="text-base font-bold text-luxury-50 font-serif">
                موقع وخريطة الوصول — {restaurant.name}
              </h3>
              <p className="text-xs text-luxury-400">
                {restaurant.address || 'العنوان غير محدد'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-luxury-300 transition-colors"
            aria-label="إغلاق الخريطة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Map Body & Embed */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Map: prefer the venue's uploaded static map image, otherwise fall
              back to an interactive embed by address/coordinates. */}
          {mapImage ? (
            <div className="relative w-full h-72 sm:h-80 rounded-2xl overflow-hidden border border-luxury-800 shadow-inner bg-luxury-900">
              <img
                src={mapImage}
                alt={`خريطة موقع ${restaurant.name}`}
                className="w-full h-full object-cover"
              />
              {/* Overlay Navigation Badge */}
              <div className="absolute top-3 right-3 bg-luxury-950/90 backdrop-blur-md border border-luxury-750 px-3 py-1.5 rounded-xl text-[11px] font-bold text-luxury-100 flex items-center gap-1.5 shadow-lg pointer-events-none">
                <Compass className="w-3.5 h-3.5 text-gold-400" />
                <span>
                  {hasCoords && lat !== undefined && lng !== undefined
                    ? `الإحداثيات: ${lat.toFixed(4)}, ${lng.toFixed(4)}`
                    : 'الموقع حسب العنوان'}
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* Interactive Map Frame */}
              <div className="relative w-full h-72 sm:h-80 rounded-2xl overflow-hidden border border-luxury-800 shadow-inner bg-luxury-900">
                <iframe
                  title={`خريطة موقع ${restaurant.name}`}
                  src={embedUrl}
                  className="w-full h-full border-none"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
                {/* Overlay Navigation Badge */}
                <div className="absolute top-3 right-3 bg-luxury-950/90 backdrop-blur-md border border-luxury-750 px-3 py-1.5 rounded-xl text-[11px] font-bold text-luxury-100 flex items-center gap-1.5 shadow-lg pointer-events-none">
                  <Compass className="w-3.5 h-3.5 text-gold-400" />
                  <span>
                    {hasCoords && lat !== undefined && lng !== undefined
                      ? `الإحداثيات: ${lat.toFixed(4)}, ${lng.toFixed(4)}`
                      : 'الموقع حسب العنوان'}
                  </span>
                </div>
              </div>

              {/* Fallback hint: the embed may be blocked by an ad-blocker or an
                  offline network; the button below always works. */}
              <p className="text-[11px] text-luxury-400 leading-relaxed flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5 text-gold-400 shrink-0" />
                إن لم تظهر الخريطة أعلاه، استخدم الزر التالي لفتحها مباشرة في تطبيق الخرائط.
              </p>
            </>
          )}

          {/* Restaurant Location Details Card */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-luxury-900/60 border border-luxury-800 space-y-1">
              <div className="text-xs font-bold text-gold-400 flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                <span>العنوان التفصيلي:</span>
              </div>
              <p className="text-xs text-luxury-200 leading-relaxed font-medium">
                {restaurant.address || 'العنوان غير محدد — تواصل مع المطعم للاستفسار'}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-luxury-900/60 border border-luxury-800 space-y-1">
              <div className="text-xs font-bold text-gold-400 flex items-center gap-1.5">
                <Phone className="w-4 h-4" />
                <span>رقم الهاتف والتواصل:</span>
              </div>
              <p className="text-xs text-luxury-200 font-mono" dir="ltr">
                {restaurant.phone || 'غير محدد'}
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-luxury-900 border-t border-luxury-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-xs text-luxury-400">
            انقر للفتح والتوجيه المباشر عبر تطبيق التقييم والتنقل
          </span>

          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl font-black text-xs text-black flex items-center justify-center gap-2 shadow-lg transition-all hover:brightness-110 active:scale-95 cursor-pointer"
            style={{ background: primaryColor }}
          >
            <Navigation className="w-4 h-4" />
            <span>فتح في Google Maps</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </a>
        </div>
      </div>
    </div>
  );
};
