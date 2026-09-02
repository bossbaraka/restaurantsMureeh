import React from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
import { Search, Sparkles, Flame } from 'lucide-react';

export const CustomerHero: React.FC = () => {
  const { searchQuery, setSearchQuery, offers, currentRestaurant } = useRestaurant();

  const activeOffers = offers.filter((o) => o.isActive);

  const heroImage = currentRestaurant?.coverImage || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85';
  const restName = currentRestaurant?.name || 'مطعم مِيرار الفاخر';
  const restDesc = currentRestaurant?.description || 'مأكولات استثنائية محضرة بأيدي نخبة الطهاة بأرقى المكونات المعتقة.';

  return (
    <div className="relative overflow-hidden mb-6">
      {/* Background Editorial Hero Image */}
      <div className="relative h-64 sm:h-72 w-full overflow-hidden rounded-2xl border border-luxury-800 shadow-2xl mx-auto">
        <img
          src={heroImage}
          alt={restName}
          className="w-full h-full object-cover object-center transform scale-105 transition-transform duration-1000 ease-out hover:scale-100"
        />
        {/* Layered luxury overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-luxury-950 via-luxury-950/70 to-luxury-950/20" />
        <div className="absolute inset-0 bg-gradient-to-r from-luxury-950/90 via-luxury-950/40 to-transparent" />

        {/* Hero Content */}
        <div className="absolute inset-0 p-6 sm:p-8 flex flex-col justify-end text-right z-10 max-w-xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gold-500/20 border border-gold-500/40 text-gold-300 text-xs font-medium backdrop-blur-md mb-2 w-max">
            <Sparkles className="w-3.5 h-3.5 text-gold-400" />
            <span>قائمة الطعام الرقمية — {restName}</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-luxury-50 font-serif tracking-tight leading-tight mb-1.5">
            تجربة تُكتشف.
          </h2>

          <p className="text-xs sm:text-sm text-luxury-300 leading-relaxed max-w-md line-clamp-2">
            {restDesc}
          </p>
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="mt-4 relative max-w-4xl mx-auto">
        <div className="relative flex items-center">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث عن طبق، مكون، أو صنف..."
            className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 placeholder-luxury-500 rounded-xl py-3 pr-11 pl-4 text-sm focus:outline-none focus:border-gold-500/60 focus:ring-1 focus:ring-gold-500/30 transition-all shadow-inner"
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
            <span className="text-xs font-bold text-gold-400 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-gold-400 fill-gold-400/20" />
              العروض والتجارب الحصرية
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeOffers.map((offer) => (
              <div
                key={offer.id}
                className="relative overflow-hidden rounded-xl bg-luxury-900 border border-gold-500/20 p-3.5 flex gap-3.5 items-center hover:border-gold-500/40 transition-all group"
              >
                <img
                  src={offer.image}
                  alt={offer.title}
                  className="w-20 h-20 rounded-lg object-cover shrink-0 border border-luxury-800 group-hover:scale-105 transition-transform duration-300"
                />
                <div className="flex-1 text-right min-w-0">
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-gold-500/20 text-gold-300 border border-gold-500/30 mb-1">
                    {offer.badge}
                  </span>
                  <h4 className="text-xs font-bold text-luxury-100 truncate">{offer.title}</h4>
                  <p className="text-[11px] text-luxury-400 line-clamp-1 mt-0.5">{offer.subtitle}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-sm font-bold text-gold-400">
                      {formatPrice(offer.discountedPrice || 0)}
                    </span>
                    {offer.originalPrice && (
                      <span className="text-xs text-luxury-500 line-through">
                        {formatPrice(offer.originalPrice)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
