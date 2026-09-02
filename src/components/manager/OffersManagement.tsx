import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
import { Tag, Plus, Trash2, CheckCircle2, X, Sparkles, Image as ImageIcon } from 'lucide-react';

export const OffersManagement: React.FC = () => {
  const { offers, addOffer, deleteOffer, currentRestaurant } = useRestaurant();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [discountedPrice, setDiscountedPrice] = useState<number | ''>('');
  const [originalPrice, setOriginalPrice] = useState<number | ''>('');
  const [badge, setBadge] = useState('عرض نهاية الأسبوع');
  const [image, setImage] = useState('https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80');

  const handleCreateOffer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    addOffer({
      title: title.trim(),
      subtitle: subtitle.trim(),
      description: subtitle.trim() || title.trim(),
      discountedPrice: Number(discountedPrice) || 0,
      originalPrice: Number(originalPrice) || undefined,
      badge: badge.trim() || 'عرض خاص',
      image: image.trim() || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
      isActive: true,
    });

    setTitle('');
    setSubtitle('');
    setIsAddModalOpen(false);
  };

  return (
    <div className="space-y-6 text-right" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-6 rounded-2xl">
        <div>
          <h2 className="text-xl font-bold text-luxury-50 font-serif flex items-center gap-2">
            <Tag className="w-5 h-5 text-gold-400" />
            <span>إدارة العروض الترويجية والكومبو ({offers.length} عروض)</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-1">
            إضافة وتعديل البنرات الترويجية وباقات العشاء المعروضة في شريط العروض بالصفحة الرئيسية
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-2 self-start sm:self-auto shadow-gold-glow transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة عرض جديد</span>
        </button>
      </div>

      {/* Offers Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {offers.map((offer) => (
          <div
            key={offer.id}
            className="group relative overflow-hidden rounded-2xl bg-luxury-900 border border-luxury-800 p-5 flex gap-4 transition-all hover:border-gold-500/40"
          >
            {/* Image */}
            {offer.image && (
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden shrink-0 border border-luxury-800">
                <img
                  src={offer.image}
                  alt={offer.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
            )}

            {/* Details */}
            <div className="flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gold-500/15 text-gold-400 border border-gold-500/30">
                    {offer.badge || 'عرض خاص'}
                  </span>
                  {offer.isActive && (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      مفعل للعملاء
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-bold text-luxury-100 font-serif leading-snug">{offer.title}</h4>
                <p className="text-[11px] text-luxury-400 mt-1 line-clamp-2">{offer.subtitle || offer.description}</p>
              </div>

              <div className="flex items-center justify-between pt-3 mt-2 border-t border-luxury-800/80">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-bold text-gold-400">{formatPrice(offer.discountedPrice || 0)}</span>
                  {offer.originalPrice && (
                    <span className="text-xs text-luxury-500 line-through">{formatPrice(offer.originalPrice)}</span>
                  )}
                </div>

                <button
                  onClick={() => deleteOffer(offer.id)}
                  className="p-1.5 rounded-lg text-luxury-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="حذف العرض"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Offer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsAddModalOpen(false)} />

          <div className="relative w-full max-w-lg bg-luxury-900 border border-luxury-700/80 rounded-2xl p-6 z-10 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-luxury-800 pb-3">
              <h3 className="text-base font-bold text-luxury-100 font-serif flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-gold-400" />
                <span>إنشاء عرض ترويجي جديد</span>
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-luxury-400 hover:text-luxury-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOffer} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-luxury-200 mb-1">عنوان العرض الرئيسي *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثال: كومبو عشاء الشيف الفاخر لشخصين"
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60"
                />
              </div>

              <div>
                <label className="block font-bold text-luxury-200 mb-1">وصف العرض / تفاصيل الأطباق المشمولة</label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="مثال: يشمل 2 ستيك تندرلوين + شوربة كمأة + طبقين حلى"
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-luxury-200 mb-1">السعر بعد الخصم (₪) *</label>
                  <input
                    type="number"
                    required
                    value={discountedPrice}
                    onChange={(e) => setDiscountedPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="180"
                    className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-luxury-200 mb-1">السعر الأصلي قبل الخصم (₪)</label>
                  <input
                    type="number"
                    value={originalPrice}
                    onChange={(e) => setOriginalPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="240"
                    className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-luxury-200 mb-1">شارة العرض (Badge)</label>
                  <input
                    type="text"
                    value={badge}
                    onChange={(e) => setBadge(e.target.value)}
                    placeholder="توفير 25%"
                    className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60"
                  />
                </div>

                <div>
                  <label className="block font-bold text-luxury-200 mb-1">رابط صورة العرض (Unsplash URL)</label>
                  <input
                    type="url"
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60 font-mono text-[11px]"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-luxury-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-luxury-850 text-luxury-300 hover:text-white"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold shadow-gold-glow"
                >
                  حفظ ونشر العرض
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
