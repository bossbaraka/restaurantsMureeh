import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Product, Category } from '../../types/restaurant';
import { formatPrice } from '../../utils/formatting';
import { ProductFormModal } from './ProductFormModal';
import {
  Utensils,
  Plus,
  Edit2,
  Trash2,
  Search,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

export const MenuManagement: React.FC = () => {
  const {
    categories,
    products,
    currentRestaurant,
    addProduct,
    updateProduct,
    deleteProduct,
    toggleProductAvailability,
    addCategory,
    updateCategory,
    deleteCategory,
  } = useRestaurant();

  const [selectedCatId, setSelectedCatId] = useState<string>('ALL');
  const [searchDish, setSearchDish] = useState('');
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // New category inline form state
  const [isAddingCat, setIsAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatNameEn, setNewCatNameEn] = useState('');

  const filteredProducts = products.filter((p) => {
    if (selectedCatId !== 'ALL' && p.categoryId !== selectedCatId) return false;
    if (searchDish.trim()) {
      const q = searchDish.toLowerCase().trim();
      return p.name.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    }
    return true;
  });

  const handleOpenAddProduct = () => {
    setEditingProduct(null);
    setIsProductModalOpen(true);
  };

  const handleOpenEditProduct = (p: Product) => {
    setEditingProduct(p);
    setIsProductModalOpen(true);
  };

  const handleSaveProduct = (prodData: Omit<Product, 'id' | 'restaurantId'>, editId?: string) => {
    if (editId) {
      updateProduct({ ...prodData, id: editId, restaurantId: currentRestaurant?.id || "rest-merar" });
    } else {
      addProduct(prodData);
    }
  };

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    addCategory(newCatName.trim(), newCatNameEn.trim());
    setNewCatName('');
    setNewCatNameEn('');
    setIsAddingCat(false);
  };

  return (
    <div className="space-y-5 text-right">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <Utensils className="w-5 h-5 text-gold-400" />
            <span>إدارة قائمة الأطباق والتسعير ({currentRestaurant?.name})</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            إضافة وتعديل الأطباق، التحكم في توفر المخزون اللحظي، وتنظيم الأقسام
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddingCat(true)}
            className="px-3.5 py-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-gold-300 border border-luxury-750 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة فئة جديدة</span>
          </button>

          <button
            onClick={handleOpenAddProduct}
            className="px-4 py-2 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-gold-glow transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة طبق فاخر</span>
          </button>
        </div>
      </div>

      {/* New Category Inline Form */}
      {isAddingCat && (
        <form onSubmit={handleCreateCategory} className="p-4 rounded-2xl bg-luxury-850 border border-gold-500/30 flex flex-col sm:flex-row items-center gap-3">
          <input
            type="text"
            required
            placeholder="اسم الفئة (بالعربية) *"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            className="flex-1 bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl text-xs"
          />
          <input
            type="text"
            placeholder="الاسم بالإنجليزية"
            value={newCatNameEn}
            onChange={(e) => setNewCatNameEn(e.target.value)}
            className="flex-1 bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl text-xs"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="submit"
              className="px-4 py-2 bg-gold-500 text-luxury-950 font-bold text-xs rounded-xl shadow-gold-glow"
            >
              حفظ الفئة
            </button>
            <button
              type="button"
              onClick={() => setIsAddingCat(false)}
              className="px-3 py-2 bg-luxury-800 text-luxury-300 text-xs rounded-xl"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* Categories Filter Strip & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setSelectedCatId('ALL')}
            className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
              selectedCatId === 'ALL'
                ? 'bg-gold-500 text-luxury-950 font-bold shadow-gold-glow'
                : 'bg-luxury-900 text-luxury-300 hover:text-luxury-100 border border-luxury-800'
            }`}
          >
            كافة الأطباق ({products.length})
          </button>

          {categories.map((c) => {
            const isSelected = selectedCatId === c.id;
            const count = products.filter((p) => p.categoryId === c.id).length;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedCatId(c.id)}
                className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isSelected
                    ? 'bg-gold-500 text-luxury-950 font-bold shadow-gold-glow'
                    : 'bg-luxury-900 text-luxury-300 hover:text-luxury-100 border border-luxury-800'
                }`}
              >
                {c.name} ({count})
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-60">
          <input
            type="text"
            value={searchDish}
            onChange={(e) => setSearchDish(e.target.value)}
            placeholder="بحث في القائمة..."
            className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 placeholder-luxury-500 rounded-xl py-2 pr-8 pl-3 text-xs focus:outline-none focus:border-gold-500/60"
          />
          <Search className="w-3.5 h-3.5 text-luxury-400 absolute right-3 top-2.5 pointer-events-none" />
        </div>
      </div>

      {/* Dishes Table */}
      <div className="bg-luxury-900 border border-luxury-800 rounded-2xl overflow-hidden shadow-luxury">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-luxury-850/80 border-b border-luxury-800 text-luxury-300 font-bold">
              <tr>
                <th className="p-4">الطبق</th>
                <th className="p-4">الفئة</th>
                <th className="p-4">السعر</th>
                <th className="p-4">الحالة والمخزون</th>
                <th className="p-4 text-left">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-luxury-800/60">
              {filteredProducts.map((product) => {
                const categoryObj = categories.find((c) => c.id === product.categoryId);

                return (
                  <tr key={product.id} className="hover:bg-luxury-850/40 transition-colors">
                    {/* Dish name & thumb */}
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-12 h-12 rounded-xl object-cover border border-luxury-800 shrink-0"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-luxury-100">{product.name}</span>
                            {product.badge && (
                              <span className="text-[10px] bg-gold-500/10 text-gold-400 border border-gold-500/30 px-1.5 py-0.2 rounded-full font-semibold">
                                {product.badge}
                              </span>
                            )}
                          </div>
                          {product.nameEn && (
                            <span className="text-[11px] text-luxury-400 block mt-0.5">
                              {product.nameEn}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="p-4 text-luxury-300">{categoryObj?.name || '—'}</td>

                    {/* Price */}
                    <td className="p-4 font-bold text-gold-400 text-sm">
                      {formatPrice(product.price)}
                    </td>

                    {/* Instant Stock Availability Toggle */}
                    <td className="p-4">
                      <button
                        onClick={() => toggleProductAvailability(product.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                          product.isAvailable
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                            : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                        }`}
                        title="انقر لتبديل حالة التوفر الفوري"
                      >
                        {product.isAvailable ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>متوفر للطلب</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5" />
                            <span>غير متوفر حالياً</span>
                          </>
                        )}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="p-4 text-left">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenEditProduct(product)}
                          className="p-2 rounded-lg bg-luxury-850 hover:bg-luxury-800 text-luxury-300 hover:text-luxury-100 border border-luxury-750 transition-colors"
                          title="تعديل"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteProduct(product.id)}
                          className="p-2 rounded-lg bg-luxury-850 hover:bg-red-500/20 text-luxury-400 hover:text-red-400 border border-luxury-750 transition-colors"
                          title="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Product Modal */}
      <ProductFormModal
        product={editingProduct}
        categories={categories}
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        onSave={handleSaveProduct}
      />
    </div>
  );
};
