import React from 'react';
import { Restaurant } from '../../types/restaurant';
import { MapPin, Phone, ExternalLink, X, Navigation, Compass } from 'lucide-react';

interface RestaurantMapModalProps {
  restaurant: Restaurant | null;
  isOpen: boolean;
  onClose: () => void;
}

export const RestaurantMapModal: React.FC<RestaurantMapModalProps> = ({
  restaurant,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !restaurant) return null;

  // Default coordinates (Ramallah / Jerusalem center if not specified)
  const lat = restaurant.latitude || 31.9029;
  const lng = restaurant.longitude || 35.2062;
  const googleMapsUrl =
    restaurant.mapUrl || `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  // OpenStreetMap embed URL
  const mapEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.008},${lat - 0.008},${lng + 0.008},${lat + 0.008}&layer=mapnik&marker=${lat},${lng}`;

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
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Map Body & Embed */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Interactive Map Frame */}
          <div className="relative w-full h-72 sm:h-80 rounded-2xl overflow-hidden border border-luxury-800 shadow-inner bg-luxury-900">
            <iframe
              title={`خريطة موقع ${restaurant.name}`}
              src={mapEmbedUrl}
              className="w-full h-full border-none filter contrast-105"
              loading="lazy"
            />
            {/* Overlay Navigation Badge */}
            <div className="absolute top-3 right-3 bg-luxury-950/90 backdrop-blur-md border border-luxury-750 px-3 py-1.5 rounded-xl text-[11px] font-bold text-luxury-100 flex items-center gap-1.5 shadow-lg">
              <Compass className="w-3.5 h-3.5 text-gold-400 animate-spin-slow" />
              <span>إحداثيات الموقع: {lat.toFixed(4)}, {lng.toFixed(4)}</span>
            </div>
          </div>

          {/* Restaurant Location Details Card */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-luxury-900/60 border border-luxury-800 space-y-1">
              <div className="text-xs font-bold text-gold-400 flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                <span>العنوان التفصيلي:</span>
              </div>
              <p className="text-xs text-luxury-200 leading-relaxed font-medium">
                {restaurant.address || 'شارع الرئيسي، رام الله، فلسطين'}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-luxury-900/60 border border-luxury-800 space-y-1">
              <div className="text-xs font-bold text-gold-400 flex items-center gap-1.5">
                <Phone className="w-4 h-4" />
                <span>رقم الهاتف والتواصل:</span>
              </div>
              <p className="text-xs text-luxury-200 font-mono" dir="ltr">
                {restaurant.phone || '+970 599 123 456'}
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
            href={googleMapsUrl}
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
