import React from 'react';
import { Product } from '../../types/restaurant';
import { formatPrice } from '../../utils/formatting';
import { Plus, Sparkles, Clock, Ban } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
  onQuickAdd: (product: Product, e: React.MouseEvent) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onSelect, onQuickAdd }) => {
  const hasOptions = (product.sizes && product.sizes.length > 0) || (product.addOns && product.addOns.length > 0) || (product.removableIngredients && product.removableIngredients.length > 0);

  return (
    <div
      onClick={() => product.isAvailable && onSelect(product)}
      className={`group relative flex flex-col justify-between bg-luxury-900/90 rounded-2xl border transition-all duration-300 overflow-hidden text-right select-none ${
        product.isAvailable
          ? 'border-luxury-800/90 hover:border-gold-500/50 hover:shadow-2xl hover:shadow-gold-500/5 cursor-pointer'
          : 'border-luxury-850 opacity-60 cursor-not-allowed bg-luxury-950/40'
      }`}
    >
      {/* Product Image Container */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-luxury-950">
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500 ease-out"
        />

        {/* Gradient shadow overlay for badge readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-luxury-900 via-transparent to-black/40" />

        {/* Top Badges */}
        <div className="absolute top-2.5 right-2.5 flex flex-wrap gap-1.5 z-10">
          {product.badge && product.isAvailable && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold bg-gold-500 text-luxury-950 backdrop-blur-md shadow-md">
              <Sparkles className="w-3 h-3 text-luxury-950" />
              {product.badge}
            </span>
          )}

          {!product.isAvailable && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-red-500/90 text-white backdrop-blur-md">
              <Ban className="w-3 h-3" />
              غير متوفر حالياً
            </span>
          )}
        </div>

        {/* Prep Time indicator */}
        {product.preparationTimeMinutes && product.isAvailable && (
          <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-luxury-950/85 backdrop-blur-md text-luxury-300 text-[10px] border border-luxury-800">
            <Clock className="w-3 h-3 text-gold-400" />
            <span>{product.preparationTimeMinutes} دقيقة</span>
          </div>
        )}
      </div>

      {/* Product Content Body */}
      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div>
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-sm sm:text-base font-bold text-luxury-100 group-hover:text-gold-300 transition-colors line-clamp-1">
              {product.name}
            </h3>
          </div>

          <p className="text-xs text-luxury-400 line-clamp-2 leading-relaxed">
            {product.description}
          </p>
        </div>

        {/* Card Footer: Price & Add Button */}
        <div className="flex items-center justify-between pt-3 border-t border-luxury-800/70 mt-auto">
          <div className="text-right">
            <span className="text-base sm:text-lg font-bold text-gold-400 font-mono">
              {formatPrice(product.price)}
            </span>
            {product.sizes && product.sizes.length > 0 && (
              <span className="text-[10px] text-luxury-400 block -mt-1 font-serif italic">يبدأ من</span>
            )}
          </div>

          {product.isAvailable ? (
            <button
              onClick={(e) => {
                if (hasOptions) {
                  e.stopPropagation();
                  onSelect(product);
                } else {
                  onQuickAdd(product, e);
                }
              }}
              className="flex items-center justify-center gap-1 px-3.5 py-1.5 rounded-xl bg-gold-500/10 hover:bg-gold-500 text-gold-300 hover:text-luxury-950 border border-gold-500/30 hover:border-gold-500 text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
              title={hasOptions ? 'تخصيص وإضافة' : 'إضافة سريعة'}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{hasOptions ? 'تخصيص' : 'إضافة'}</span>
            </button>
          ) : (
            <span className="text-xs text-luxury-500 font-medium">غير متاح</span>
          )}
        </div>
      </div>
    </div>
  );
};
