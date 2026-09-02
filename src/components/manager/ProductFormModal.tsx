import React, { useState, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Product, ProductSize, ProductAddOn, Category } from '../../types/restaurant';
import { X, Plus, Trash2, Sparkles, Image as ImageIcon, Check } from 'lucide-react';

interface ProductFormModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  categories?: Category[];
  onSave?: (prodData: Omit<Product, 'id' | 'restaurantId'>, editId?: string) => void;
}

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  product,
  isOpen,
  onClose,
  categories: propCategories,
  onSave,
}) => {
  const { categories: ctxCategories, addProduct, updateProduct, currentRestaurant } = useRestaurant();
  const categories = propCategories || ctxCategories;

  const [categoryId, setCategoryId] = useState('');
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number | ''>('');
  const [image, setImage] = useState('');
  const [badge, setBadge] = useState('');
  const [preparationTimeMinutes, setPreparationTimeMinutes] = useState<number | ''>('');
  const [calories, setCalories] = useState<number | ''>('');
  const [isAvailable, setIsAvailable] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);

  // Removable ingredients
  const [removableIngredients, setRemovableIngredients] = useState<string[]>([]);
  const [newIngredient, setNewIngredient] = useState('');

  // Sizes & AddOns
  const [sizes, setSizes] = useState<ProductSize[]>([]);
  const [newSizeName, setNewSizeName] = useState('');
  const [newSizeMod, setNewSizeMod] = useState<number | ''>(0);

  const [addOns, setAddOns] = useState<ProductAddOn[]>([]);
  const [newAddOnName, setNewAddOnName] = useState('');
  const [newAddOnPrice, setNewAddOnPrice] = useState<number | ''>(0);

  useEffect(() => {
    if (product) {
      setCategoryId(product.categoryId);
      setName(product.name);
      setNameEn(product.nameEn);
      setDescription(product.description);
      setPrice(product.price);
      setImage(product.image);
      setBadge(product.badge || '');
      setPreparationTimeMinutes(product.preparationTimeMinutes || '');
      setCalories(product.calories || '');
      setIsAvailable(product.isAvailable);
      setIsFeatured(product.isFeatured || false);
      setRemovableIngredients(product.removableIngredients || product.ingredients || []);
      setSizes(product.sizes || []);
      setAddOns(product.addOns || []);
    } else {
      setCategoryId(categories[0]?.id || '');
      setName('');
      setNameEn('');
      setDescription('');
      setPrice('');
      setImage('https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80');
      setBadge('');
      setPreparationTimeMinutes(15);
      setCalories(450);
      setIsAvailable(true);
      setIsFeatured(false);
      setRemovableIngredients([]);
      setSizes([]);
      setAddOns([]);
    }
  }, [product, categories, isOpen]);

  if (!isOpen) return null;

  const handleAddSize = () => {
    if (!newSizeName.trim()) return;
    const mod = Number(newSizeMod) || 0;
    setSizes((prev) => [
      ...prev,
      { id: `size-${Date.now()}`, name: newSizeName.trim(), price: mod, priceModifier: mod },
    ]);
    setNewSizeName('');
    setNewSizeMod(0);
  };

  const handleRemoveSize = (id: string) => {
    setSizes((prev) => prev.filter((s) => s.id !== id));
  };

  const handleAddAddOn = () => {
    if (!newAddOnName.trim()) return;
    setAddOns((prev) => [
      ...prev,
      { id: `addon-${Date.now()}`, name: newAddOnName.trim(), price: Number(newAddOnPrice) || 0 },
    ]);
    setNewAddOnName('');
    setNewAddOnPrice(0);
  };

  const handleRemoveAddOn = (id: string) => {
    setAddOns((prev) => prev.filter((a) => a.id !== id));
  };

  const handleAddIngredient = () => {
    if (!newIngredient.trim()) return;
    if (!removableIngredients.includes(newIngredient.trim())) {
      setRemovableIngredients((prev) => [...prev, newIngredient.trim()]);
    }
    setNewIngredient('');
  };

  const handleRemoveIngredient = (ing: string) => {
    setRemovableIngredients((prev) => prev.filter((i) => i !== ing));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !price || !categoryId) return;

    const productPayload = {
      categoryId,
      name: name.trim(),
      nameEn: nameEn.trim() || name.trim(),
      description: description.trim(),
      price: Number(price),
      image: image.trim() || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
      badge: badge.trim() || undefined,
      preparationTimeMinutes: Number(preparationTimeMinutes) || undefined,
      calories: Number(calories) || undefined,
      isAvailable,
      isFeatured,
      sizes: sizes.length > 0 ? sizes : undefined,
      addOns: addOns.length > 0 ? addOns : undefined,
      removableIngredients: removableIngredients.length > 0 ? removableIngredients : undefined,
      ingredients: removableIngredients.length > 0 ? removableIngredients : undefined,
    };

    if (onSave) {
      onSave(productPayload, product ? product.id : undefined);
    } else if (product) {
      updateProduct({ ...productPayload, id: product.id, restaurantId: product.restaurantId || currentRestaurant?.id || 'rest-merar' });
    } else {
      addProduct(productPayload);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative w-full max-w-2xl bg-luxury-900 border border-luxury-700/80 rounded-3xl overflow-hidden shadow-2xl z-10 animate-fade-in text-right max-h-[90vh] flex flex-col"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 border-b border-luxury-800 flex items-center justify-between shrink-0 bg-luxury-950">
          <h3 className="text-base font-bold text-luxury-50 font-serif flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold-400" />
            <span>{product ? `تعديل طبق: ${product.name}` : 'إضافة طبق فاخر جديد'}</span>
          </h3>
          <button onClick={onClose} className="p-1 text-luxury-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar text-xs">
          {/* Category & Badge */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-luxury-200 mb-1">القسم / التصنيف *</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
                className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.nameEn || ''})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-luxury-200 mb-1">شارة مميزة (Badge)</label>
              <input
                type="text"
                value={badge}
                onChange={(e) => setBadge(e.target.value)}
                placeholder="مثال: الشيف يوصي به، الأكثر طلباً"
                className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60"
              />
            </div>
          </div>

          {/* Names */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-luxury-200 mb-1">اسم الطبق بالعربية *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: ستيك ريب آي معتق بالذهب"
                className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60"
              />
            </div>

            <div>
              <label className="block font-bold text-luxury-200 mb-1">الاسم بالإنجليزية</label>
              <input
                type="text"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="Gold Wagyu Ribeye Steak"
                className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60 font-serif"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block font-bold text-luxury-200 mb-1">وصف الطبق والمكونات *</label>
            <textarea
              required
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="شرح شاعري جذاب لمكونات الطبق وطريقة تحضيره الفاخرة..."
              className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60 resize-none"
            />
          </div>

          {/* Price, Prep Time, Calories */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-luxury-200 mb-1">السعر الأساسي (₪) *</label>
              <input
                type="number"
                required
                min="0"
                step="0.5"
                value={price}
                onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="120"
                className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60 font-mono"
              />
            </div>

            <div>
              <label className="block font-bold text-luxury-200 mb-1">وقت التحضير (دقيقة)</label>
              <input
                type="number"
                value={preparationTimeMinutes}
                onChange={(e) => setPreparationTimeMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="15"
                className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60 font-mono"
              />
            </div>

            <div>
              <label className="block font-bold text-luxury-200 mb-1">السعرات الحرارية</label>
              <input
                type="number"
                value={calories}
                onChange={(e) => setCalories(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="550"
                className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60 font-mono"
              />
            </div>
          </div>

          {/* Image URL */}
          <div>
            <label className="block font-bold text-luxury-200 mb-1">رابط الصورة (Unsplash URL) *</label>
            <input
              type="url"
              required
              value={image}
              onChange={(e) => setImage(e.target.value)}
              className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:outline-none focus:border-gold-500/60 font-mono text-[11px]"
            />
          </div>

          {/* Availability Toggles */}
          <div className="flex items-center gap-6 p-3 rounded-xl bg-luxury-950 border border-luxury-800">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isAvailable}
                onChange={(e) => setIsAvailable(e.target.checked)}
                className="w-4 h-4 rounded text-gold-500 focus:ring-0 bg-luxury-900 border-luxury-700"
              />
              <span className="font-bold text-luxury-200">متوفر في القائمة للطلب (In Stock)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isFeatured}
                onChange={(e) => setIsFeatured(e.target.checked)}
                className="w-4 h-4 rounded text-gold-500 focus:ring-0 bg-luxury-900 border-luxury-700"
              />
              <span className="font-bold text-luxury-200">طبق مميز في الواجهة</span>
            </label>
          </div>

          {/* SIZES */}
          <div className="p-4 rounded-xl bg-luxury-950/60 border border-luxury-800 space-y-3">
            <label className="block font-bold text-luxury-200">أحجام الطبق وخيارات التسعير</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newSizeName}
                onChange={(e) => setNewSizeName(e.target.value)}
                placeholder="اسم الحجم (مثل: 300 غرام، كبير)"
                className="flex-1 bg-luxury-900 border border-luxury-800 p-2 rounded-xl text-xs text-luxury-100"
              />
              <input
                type="number"
                value={newSizeMod}
                onChange={(e) => setNewSizeMod(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="+₪ زيادة السعر"
                className="w-28 bg-luxury-900 border border-luxury-800 p-2 rounded-xl text-xs text-luxury-100 font-mono"
              />
              <button
                type="button"
                onClick={handleAddSize}
                className="px-3 py-2 bg-luxury-800 hover:bg-luxury-700 text-gold-400 font-bold rounded-xl"
              >
                + إضافة حجم
              </button>
            </div>
            {sizes.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {sizes.map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-luxury-850 border border-luxury-800 text-[11px]"
                  >
                    <span>{s.name} (+₪{s.priceModifier || s.price || 0})</span>
                    <button type="button" onClick={() => handleRemoveSize(s.id)} className="text-red-400">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ADD-ONS */}
          <div className="p-4 rounded-xl bg-luxury-950/60 border border-luxury-800 space-y-3">
            <label className="block font-bold text-luxury-200">إضافات مخصصة (Add-ons)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newAddOnName}
                onChange={(e) => setNewAddOnName(e.target.value)}
                placeholder="اسم الإضافة (مثل: زبدة الترفل، جبن إضافي)"
                className="flex-1 bg-luxury-900 border border-luxury-800 p-2 rounded-xl text-xs text-luxury-100"
              />
              <input
                type="number"
                value={newAddOnPrice}
                onChange={(e) => setNewAddOnPrice(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="سعر الإضافة ₪"
                className="w-28 bg-luxury-900 border border-luxury-800 p-2 rounded-xl text-xs text-luxury-100 font-mono"
              />
              <button
                type="button"
                onClick={handleAddAddOn}
                className="px-3 py-2 bg-luxury-800 hover:bg-luxury-700 text-gold-400 font-bold rounded-xl"
              >
                + إضافة
              </button>
            </div>
            {addOns.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {addOns.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-luxury-850 border border-luxury-800 text-[11px]"
                  >
                    <span>{a.name} (+₪{a.price})</span>
                    <button type="button" onClick={() => handleRemoveAddOn(a.id)} className="text-red-400">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* REMOVABLE INGREDIENTS */}
          <div className="p-4 rounded-xl bg-luxury-950/60 border border-luxury-800 space-y-3">
            <label className="block font-bold text-luxury-200">مكونات يمكن للعميل استبعادها</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newIngredient}
                onChange={(e) => setNewIngredient(e.target.value)}
                placeholder="مكون (مثل: البصل، الفلفل الحار، المكسرات)"
                className="flex-1 bg-luxury-900 border border-luxury-800 p-2 rounded-xl text-xs text-luxury-100"
              />
              <button
                type="button"
                onClick={handleAddIngredient}
                className="px-3 py-2 bg-luxury-800 hover:bg-luxury-700 text-luxury-200 font-bold rounded-xl"
              >
                + إضافة مكون
              </button>
            </div>
            {removableIngredients.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {removableIngredients.map((ing) => (
                  <span
                    key={ing}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-luxury-850 border border-luxury-800 text-[11px]"
                  >
                    <span>{ing}</span>
                    <button type="button" onClick={() => handleRemoveIngredient(ing)} className="text-red-400">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Footer CTA */}
          <div className="pt-4 border-t border-luxury-800 flex justify-end gap-3 sticky bottom-0 bg-luxury-900 py-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-luxury-850 text-luxury-300 hover:text-white"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold shadow-gold-glow"
            >
              {product ? 'حفظ التعديلات' : 'إنشاء الطبق ونشره'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
