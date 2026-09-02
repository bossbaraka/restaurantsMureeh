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
          ? 'border-luxury-800 hover:border-gold-500/40 hover:shadow-luxury cursor-pointer'
          : 'border-luxury-850 opacity-60 cursor-not-allowed bg-luxury-950/40'
      }`}
    >
      {/* Product Image Container */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-luxury-950">
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500 ease-out"
        />

        {/* Gradient shadow for text contrast */}
        <div className="absolute inset-0 bg-gradient-to-t from-luxury-900 via-transparent to-black/30" />

        {/* Top Badges */}
        <div className="absolute top-2.5 right-2.5 flex flex-wrap gap-1.5 z-10">
          {product.badge && product.isAvailable && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gold-500/90 text-luxury-950 backdrop-blur-md shadow-sm">
              <Sparkles className="w-3 h-3 text-luxury-950" />
              {product.badge}
            </span>
          )}

          {!product.isAvailable && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-500/90 text-white backdrop-blur-md">
              <Ban className="w-3 h-3" />
              غير متوفر حالياً
            </span>
          )}
        </div>

        {/* Prep Time pill if available */}
        {product.preparationTimeMinutes && product.isAvailable && (
          <div className="absolute bottom-2 left-2.5 flex items-center gap-1 px-2 py-0.5 rounded-md bg-luxury-950/80 backdrop-blur-md text-luxury-300 text-[10px]">
            <Clock className="w-3 h-3 text-gold-400" />
            <span>{product.preparationTimeMinutes} دقيقة</span>
          </div>
        )}
      </div>

      {/* Product Content Body */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-sm sm:text-base font-bold text-luxury-100 group-hover:text-gold-300 transition-colors line-clamp-1">
              {product.name}
            </h3>
          </div>

          <p className="text-xs text-luxury-400 line-clamp-2 leading-relaxed mb-3">
            {product.description}
          </p>
        </div>

        {/* Card Footer: Price & Add Button */}
        <div className="flex items-center justify-between pt-2 border-t border-luxury-800/80">
          <div className="text-right">
            <span className="text-base sm:text-lg font-bold text-gold-400">
              {formatPrice(product.price)}
            </span>
            {product.sizes && product.sizes.length > 0 && (
              <span className="text-[10px] text-luxury-400 block -mt-1">يبدأ من</span>
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
              className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl bg-gold-500/10 hover:bg-gold-500 text-gold-300 hover:text-luxury-950 border border-gold-500/30 hover:border-gold-500 text-xs font-bold transition-all active:scale-95 shadow-sm"
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
