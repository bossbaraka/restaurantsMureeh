import React, { useState, useEffect } from 'react';
import { Product, ProductAddOn, ProductSize } from '../../types/restaurant';
import { formatPrice } from '../../utils/formatting';
import { useRestaurant } from '../../context/RestaurantContext';
import { X, Plus, Minus, Check, Sparkles, Clock, Flame, ShieldAlert, ShoppingBag } from 'lucide-react';
import { optimizeImageUrl } from './ProductImage';
import { useDialog } from '../../hooks/useDialog';

interface ProductDetailModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({ product, isOpen, onClose }) => {
  const { currentRestaurant,  addToCart } = useRestaurant();
  const currency = currentRestaurant?.currency || '₪';

  const [quantity, setQuantity] = useState(1);
  const [selectedSize, setSelectedSize] = useState<ProductSize | undefined>(undefined);
  const [selectedAddOns, setSelectedAddOns] = useState<ProductAddOn[]>([]);
  const [removedIngredients, setRemovedIngredients] = useState<string[]>([]);
  const [specialInstructions, setSpecialInstructions] = useState('');

  // Reset local state when product changes
  useEffect(() => {
    if (product) {
      setQuantity(1);
      setSelectedSize(product.sizes && product.sizes.length > 0 ? product.sizes[0] : undefined);
      setSelectedAddOns([]);
      setRemovedIngredients([]);
      setSpecialInstructions('');
    }
  }, [product]);

  // UX-001: Escape-to-close + body scroll lock (see hooks/useDialog).
  useDialog({ isOpen, onClose });

  if (!isOpen || !product) return null;

  // Calculate live dynamic price
  const basePrice = product.price;
  const sizeMod = selectedSize?.priceModifier || selectedSize?.price || 0;
  const addOnsMod = selectedAddOns.reduce((sum, item) => sum + item.price, 0);
  const unitPrice = basePrice + sizeMod + addOnsMod;
  const totalPrice = unitPrice * quantity;

  const toggleAddOn = (addOn: ProductAddOn) => {
    if (selectedAddOns.some((a) => a.id === addOn.id)) {
      setSelectedAddOns((prev) => prev.filter((a) => a.id !== addOn.id));
    } else {
      setSelectedAddOns((prev) => [...prev, addOn]);
    }
  };

  const toggleRemoveIngredient = (ing: string) => {
    if (removedIngredients.includes(ing)) {
      setRemovedIngredients((prev) => prev.filter((i) => i !== ing));
    } else {
      setRemovedIngredients((prev) => [...prev, ing]);
    }
  };

  const handleAddToCart = () => {
    addToCart(product, quantity, {
      size: selectedSize,
      selectedAddOns,
      removedIngredients,
      specialInstructions: specialInstructions.trim() || undefined,
      notes: specialInstructions.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-3 sm:p-4">
      {/* Dark luxury Backdrop */}
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-md transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-detail-title"
        className="relative w-full max-w-lg border border-m-hairline/80 rounded-3xl overflow-hidden z-10 animate-fade-in text-right max-h-[90vh] flex flex-col"
        style={{ backgroundColor: 'var(--m-surface)', boxShadow: 'var(--m-shadow-lg)' }}
        dir="rtl"
      >
        {/* Sticky Header with Close Button & Image */}
        <div className="relative aspect-[16/9] w-full shrink-0 bg-m-bg">
          {product.image ? (
            <img
              src={optimizeImageUrl(product.image, 960, 75)}
              alt={product.name}
              loading="eager"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent pointer-events-none" />

          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="إغلاق تفاصيل الصنف"
            className="absolute top-4 left-4 w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center border border-white/20 transition-colors backdrop-blur-md cursor-pointer z-20"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Badge */}
          {product.badge && (
            <div className="absolute top-4 right-4 px-3 py-1 rounded-full brand-fill font-bold text-xs flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              <span>{product.badge}</span>
            </div>
          )}

          {/* Product Title on Image Bottom */}
          <div className="absolute bottom-3 right-4 left-4">
            <h2 id="product-detail-title" className="text-xl sm:text-2xl font-bold font-serif text-white leading-tight line-clamp-2">
              {product.name}
            </h2>
            {product.nameEn && (
              <p className="text-xs text-white/80 font-serif italic mt-0.5">
                {product.nameEn}
              </p>
            )}
          </div>
        </div>

        {/* Scrollable Customization Content */}
        <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
          {/* Description & Metadata Strip */}
          <div>
            <p className="text-xs sm:text-sm text-m-text-muted leading-relaxed">
              {product.description}
            </p>

            <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-m-hairline text-xs text-m-text-muted">
              {product.preparationTimeMinutes && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-[var(--m-brand-on-surface)]" />
                  <span>{product.preparationTimeMinutes} دقيقة تحضير</span>
                </span>
              )}
              {product.calories && (
                <span className="flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span>{product.calories} سعرة حرارية</span>
                </span>
              )}
            </div>

            {/* Allergens Warning if any — warning surface from the Theme
                (`--m-warning`, amber-500 at the platform default). */}
            {product.allergens && product.allergens.length > 0 && (
              <div
                className="mt-2.5 p-2.5 rounded-xl border text-[11px] text-amber-300/90 flex items-center gap-2"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--m-warning) 10%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--m-warning) 20%, transparent)',
                }}
              >
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span>مسببات الحساسية: {product.allergens.join('، ')}</span>
              </div>
            )}
          </div>

          {/* SIZES SELECTOR */}
          {product.sizes && product.sizes.length > 0 && (
            <div role="radiogroup" aria-label="اختر الحجم">
              <p className="block text-xs font-bold text-m-text mb-2" id="product-size-label">
                اختر الحجم
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {product.sizes.map((size) => {
                  const isSelected = selectedSize?.id === size.id;
                  const mod = size.priceModifier || size.price || 0;
                  return (
                    <button
                      key={size.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={`الحجم ${size.name}${mod > 0 ? ` — زيادة ${formatPrice(mod, currency)}` : ''}`}
                      onClick={() => setSelectedSize(size)}
                      className={`p-3 rounded-xl border text-xs font-medium transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${
                        isSelected
                          ? 'bg-[rgb(var(--m-brand-on-surface-rgb)/0.15)] border-[var(--m-brand-on-surface)] text-[var(--m-brand-on-surface)] ring-1 ring-[rgb(var(--m-brand-on-surface-rgb)/0.3)] font-bold'
                          : 'bg-m-surface-raised/60 border-m-hairline text-m-text-muted hover:border-m-hairline'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            isSelected ? 'border-transparent brand-fill' : 'border-m-hairline'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                        </div>
                        <span>{size.name}</span>
                      </div>
                      {mod > 0 && (
                        <span className="text-[var(--m-brand-on-surface)] font-bold">+{formatPrice(mod, currency)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ADD-ONS SELECTOR */}
          {product.addOns && product.addOns.length > 0 && (
            <div role="group" aria-label="إضافات اختيارية">
              <p className="block text-xs font-bold text-m-text mb-2">
                إضافات (اختياري)
              </p>
              <div className="space-y-2">
                {product.addOns.map((addOn) => {
                  const isChecked = selectedAddOns.some((a) => a.id === addOn.id);
                  return (
                    <button
                      key={addOn.id}
                      type="button"
                      role="checkbox"
                      aria-checked={isChecked}
                      aria-label={`${isChecked ? 'إزالة' : 'إضافة'} ${addOn.name} مقابل ${formatPrice(addOn.price, currency)}`}
                      onClick={() => toggleAddOn(addOn)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                        isChecked
                          ? 'bg-[rgb(var(--m-brand-on-surface-rgb)/0.1)] border-[var(--m-brand-on-surface)] text-[var(--m-brand-on-surface)] font-bold'
                          : 'bg-m-surface-raised/60 border-m-hairline text-m-text-muted hover:border-m-hairline'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center ${
                            isChecked ? 'border-transparent brand-fill' : 'border-m-hairline'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span>{addOn.name}</span>
                      </div>
                      <span className="text-[var(--m-brand-on-surface)] font-bold">+{formatPrice(addOn.price, currency)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* REMOVABLE INGREDIENTS — the guest may leave these out. Descriptive
              `ingredients` are deliberately NOT a fallback source: they are
              composition metadata, not customization options. */}
          {product.removableIngredients && product.removableIngredients.length > 0 && (
            <div role="group" aria-label="استبعاد مكونات حسب تفضيلك">
              <p className="block text-xs font-bold text-m-text mb-2">
                استبعاد مكونات (حسب تفضيلك)
              </p>
              <div className="flex flex-wrap gap-2">
                {product.removableIngredients.map((ing) => {
                  const isRemoved = removedIngredients.includes(ing);
                  return (
                    <button
                      key={ing}
                      type="button"
                      role="checkbox"
                      aria-checked={isRemoved}
                      aria-label={`${isRemoved ? 'إعادة' : 'استبعاد'} ${ing}`}
                      onClick={() => toggleRemoveIngredient(ing)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                        isRemoved
                          ? 'bg-red-500/20 border-red-500 text-red-400 line-through'
                          : 'bg-m-surface-raised border-m-hairline text-m-text-muted hover:border-m-hairline'
                      }`}
                    >
                      {ing}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* SPECIAL INSTRUCTIONS INPUT */}
          <div>
            <label htmlFor="productdetailmodal-f1" className="block text-xs font-bold text-m-text mb-1.5">
              ملاحظات أو طلبات خاصة للشيف
            </label>
            <textarea id="productdetailmodal-f1"
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              placeholder="مثال: درجة الاستواء، بدون ملح إضافي، الصوص جانباً..."
              rows={2}
              className="w-full bg-m-bg border border-m-hairline rounded-xl p-3 text-xs text-m-text placeholder-m-text-subtle focus:outline-none focus:border-[rgb(var(--m-brand-on-surface-rgb)/0.6)] resize-none"
            />
          </div>
        </div>

        {/* Fixed Footer with Quantity & Add to Cart Button */}
        <div className="p-4 sm:p-5 bg-m-bg border-t border-m-hairline flex items-center justify-between gap-4 shrink-0">
          {/* Quantity Controls */}
          <div className="flex items-center gap-2 bg-m-surface border border-m-hairline rounded-xl p-1 shrink-0" role="group" aria-label="الكمية">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              aria-label="إنقاص الكمية"
              className="touch-target w-9 h-9 rounded-lg bg-m-surface-raised hover:bg-m-surface-raised disabled:opacity-40 text-m-text flex items-center justify-center transition-colors cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="w-7 text-center font-bold text-sm font-mono text-m-text" aria-live="polite">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              aria-label="زيادة الكمية"
              className="touch-target w-9 h-9 rounded-lg brand-cta flex items-center justify-center transition-colors cursor-pointer font-bold"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Add to Cart CTA Button */}
          <button
            onClick={handleAddToCart}
            className="flex-1 py-3.5 px-4 rounded-xl brand-cta font-bold text-xs sm:text-sm flex items-center justify-between transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" />
              <span>إضافة إلى الطلب</span>
            </div>
            <span className="font-mono text-xs font-black">{formatPrice(totalPrice, currency)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
