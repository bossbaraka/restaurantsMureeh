import React, { useState, useEffect } from 'react';
import { Product, ProductAddOn, ProductSize } from '../../types/restaurant';
import { formatPrice } from '../../utils/formatting';
import { useRestaurant } from '../../context/RestaurantContext';
import { X, Plus, Minus, Check, Sparkles, Clock, Flame, ShieldAlert, ShoppingBag } from 'lucide-react';

interface ProductDetailModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({ product, isOpen, onClose }) => {
  const { addToCart } = useRestaurant();

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
        className="relative w-full max-w-lg bg-luxury-900 border border-luxury-700/80 rounded-3xl overflow-hidden shadow-2xl z-10 animate-fade-in text-right max-h-[90vh] flex flex-col"
        dir="rtl"
      >
        {/* Sticky Header with Close Button & Image */}
        <div className="relative aspect-[16/9] w-full shrink-0 bg-luxury-950">
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-luxury-900 via-luxury-900/30 to-black/60" />

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 left-4 w-9 h-9 rounded-full bg-luxury-950/80 text-luxury-300 hover:text-white flex items-center justify-center border border-luxury-700 transition-colors backdrop-blur-sm cursor-pointer z-20"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Badge */}
          {product.badge && (
            <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-gold-500/90 text-luxury-950 font-bold text-xs shadow-gold-glow flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              <span>{product.badge}</span>
            </div>
          )}

          {/* Product Title on Image Bottom */}
          <div className="absolute bottom-3 right-4 left-4">
            <h2 className="text-xl sm:text-2xl font-bold font-serif text-luxury-50 leading-tight">
              {product.name}
            </h2>
            {product.nameEn && (
              <p className="text-xs text-gold-400 font-serif italic mt-0.5">
                {product.nameEn}
              </p>
            )}
          </div>
        </div>

        {/* Scrollable Customization Content */}
        <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
          {/* Description & Metadata Strip */}
          <div>
            <p className="text-xs sm:text-sm text-luxury-300 leading-relaxed">
              {product.description}
            </p>

            <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-luxury-800 text-xs text-luxury-400">
              {product.preparationTimeMinutes && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-gold-400" />
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

            {/* Allergens Warning if any */}
            {product.allergens && product.allergens.length > 0 && (
              <div className="mt-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span>مسببات الحساسية: {product.allergens.join('، ')}</span>
              </div>
            )}
          </div>

          {/* SIZES SELECTOR */}
          {product.sizes && product.sizes.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-luxury-200 mb-2">
                اختر الحجم
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {product.sizes.map((size) => {
                  const isSelected = selectedSize?.id === size.id;
                  const mod = size.priceModifier || size.price || 0;
                  return (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => setSelectedSize(size)}
                      className={`p-3 rounded-xl border text-xs font-medium transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${
                        isSelected
                          ? 'bg-gold-500/15 border-gold-500 text-gold-300 ring-1 ring-gold-500/30 font-bold'
                          : 'bg-luxury-850/60 border-luxury-800 text-luxury-300 hover:border-luxury-700'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            isSelected ? 'border-gold-500 bg-gold-500 text-luxury-950' : 'border-luxury-600'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                        </div>
                        <span>{size.name}</span>
                      </div>
                      {mod > 0 && (
                        <span className="text-gold-400 font-bold">+{formatPrice(mod)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ADD-ONS SELECTOR */}
          {product.addOns && product.addOns.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-luxury-200 mb-2">
                إضافات فاخرة (اختياري)
              </label>
              <div className="space-y-2">
                {product.addOns.map((addOn) => {
                  const isChecked = selectedAddOns.some((a) => a.id === addOn.id);
                  return (
                    <button
                      key={addOn.id}
                      type="button"
                      onClick={() => toggleAddOn(addOn)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                        isChecked
                          ? 'bg-gold-500/10 border-gold-500 text-gold-300 font-bold'
                          : 'bg-luxury-850/60 border-luxury-800 text-luxury-300 hover:border-luxury-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center ${
                            isChecked ? 'border-gold-500 bg-gold-500 text-luxury-950' : 'border-luxury-600'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span>{addOn.name}</span>
                      </div>
                      <span className="text-gold-400 font-bold">+{formatPrice(addOn.price)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* REMOVABLE INGREDIENTS */}
          {((product.removableIngredients && product.removableIngredients.length > 0) ||
            (product.ingredients && product.ingredients.length > 0)) && (
            <div>
              <label className="block text-xs font-bold text-luxury-200 mb-2">
                استبعاد مكونات (حسب تفضيلك)
              </label>
              <div className="flex flex-wrap gap-2">
                {(product.removableIngredients || product.ingredients || []).map((ing) => {
                  const isRemoved = removedIngredients.includes(ing);
                  return (
                    <button
                      key={ing}
                      type="button"
                      onClick={() => toggleRemoveIngredient(ing)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                        isRemoved
                          ? 'bg-red-500/20 border-red-500 text-red-400 line-through'
                          : 'bg-luxury-850 border-luxury-800 text-luxury-300 hover:border-luxury-700'
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
            <label className="block text-xs font-bold text-luxury-200 mb-1.5">
              ملاحظات أو طلبات خاصة للشيف
            </label>
            <textarea
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              placeholder="مثال: درجة الاستواء، بدون ملح إضافي، الصوص جانباً..."
              rows={2}
              className="w-full bg-luxury-950 border border-luxury-800 rounded-xl p-3 text-xs text-luxury-100 placeholder-luxury-500 focus:outline-none focus:border-gold-500/60 resize-none"
            />
          </div>
        </div>

        {/* Fixed Footer with Quantity & Add to Cart Button */}
        <div className="p-4 sm:p-5 bg-luxury-950 border-t border-luxury-800 flex items-center justify-between gap-4 shrink-0">
          {/* Quantity Controls */}
          <div className="flex items-center gap-2 bg-luxury-900 border border-luxury-800 rounded-xl p-1 shrink-0">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="w-8 h-8 rounded-lg bg-luxury-800 hover:bg-luxury-750 text-luxury-200 flex items-center justify-center transition-colors cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="w-7 text-center font-bold text-sm font-mono text-luxury-100">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="w-8 h-8 rounded-lg bg-gold-500 hover:bg-gold-400 text-luxury-950 flex items-center justify-center transition-colors cursor-pointer font-bold"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Add to Cart CTA Button */}
          <button
            onClick={handleAddToCart}
            className="flex-1 py-3.5 px-4 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs sm:text-sm flex items-center justify-between shadow-gold-glow transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" />
              <span>إضافة إلى الطلب</span>
            </div>
            <span className="font-mono text-xs font-black">{formatPrice(totalPrice)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
