import React, { useRef, useState, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatPrice } from '../../utils/formatting';
import { generateQrDataUrl } from '../../utils/qrCodeGenerator';
import { Printer, X, Phone, MapPin, QrCode } from 'lucide-react';

interface PrintMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrintMenuModal: React.FC<PrintMenuModalProps> = ({ isOpen, onClose }) => {
  const { currentRestaurant, categories, products } = useRestaurant();
  const printContainerRef = useRef<HTMLDivElement>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

  useEffect(() => {
    if (!isOpen || !currentRestaurant) return;
    let isMounted = true;
    generateQrDataUrl('1', currentRestaurant.slug || 'mureeh').then((url) => {
      if (isMounted) setQrCodeUrl(url);
    });
    return () => {
      isMounted = false;
    };
  }, [isOpen, currentRestaurant]);

  if (!isOpen || !currentRestaurant) return null;

  const handlePrint = () => {
    window.print();
  };

  const primaryColor = currentRestaurant.primaryColor || '#D4AF37';
  const accentColor = currentRestaurant.accentColor || '#C5A880';

  // Group products by category
  const categorizedMenu = categories
    .map((cat) => ({
      category: cat,
      items: products.filter((p) => p.categoryId === cat.id && p.isAvailable),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto">
      {/* Modal Container */}
      <div className="relative w-full max-w-5xl bg-luxury-950 border border-luxury-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Controls Bar (Hidden during printing) */}
        <div className="print:hidden flex items-center justify-between px-6 py-4 bg-luxury-900 border-b border-luxury-800">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})` }}
            >
              <Printer className="w-5 h-5 text-black" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-luxury-50 font-serif">معاينة طباعة المنيو الورقي الفاخر</h3>
              <p className="text-xs text-luxury-400">تصميم فاخر مستوحى من هوية وتنسيق مطعم {currentRestaurant.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="px-5 py-2.5 rounded-xl text-xs font-black text-black transition-all flex items-center gap-2 shadow-lg hover:brightness-110 active:scale-95 cursor-pointer"
              style={{ background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})` }}
            >
              <Printer className="w-4 h-4" />
              <span>طباعة المنيو الآن (A4 / A3)</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-luxury-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Menu Paper Sheet */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-neutral-900 print:bg-white print:p-0">
          <div
            ref={printContainerRef}
            id="printable-menu-sheet"
            className="max-w-4xl mx-auto bg-luxury-950 text-luxury-100 rounded-3xl p-6 sm:p-10 shadow-2xl border border-luxury-800/80 print:border-none print:shadow-none print:bg-white print:text-black print:p-6 print:rounded-none"
            dir="rtl"
          >
            {/* Header Banner */}
            <div
              className="relative rounded-2xl p-8 mb-8 overflow-hidden print:rounded-none print:p-4 print:border-b-2 print:border-black"
              style={{
                background: `linear-gradient(135deg, rgba(20, 20, 20, 0.95), rgba(10, 10, 10, 0.98)), url(${currentRestaurant.coverImage || ''}) center/cover`,
                borderColor: primaryColor,
              }}
            >
              <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-right">
                <div className="flex items-center gap-4">
                  {currentRestaurant.logo && (
                    <div
                      className="w-20 h-20 rounded-2xl overflow-hidden shadow-xl border-2 shrink-0 print:w-16 print:h-16"
                      style={{ borderColor: primaryColor }}
                    >
                      <img src={currentRestaurant.logo} alt={currentRestaurant.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div>
                    <h1
                      className="text-2xl sm:text-3xl font-black font-serif tracking-tight print:text-black print:text-2xl"
                      style={{ color: primaryColor }}
                    >
                      {currentRestaurant.name}
                    </h1>
                    {currentRestaurant.nameEn && (
                      <p className="text-xs uppercase tracking-widest font-mono text-luxury-400 print:text-gray-600 mt-0.5">
                        {currentRestaurant.nameEn}
                      </p>
                    )}
                    <p className="text-xs text-luxury-300 print:text-gray-700 mt-1 max-w-md line-clamp-2">
                      {currentRestaurant.description}
                    </p>
                  </div>
                </div>

                {/* Restaurant Contact & QR Code */}
                <div className="flex items-center gap-4 bg-black/40 backdrop-blur-md p-3.5 rounded-2xl border border-luxury-800/60 print:bg-transparent print:border-none print:p-0">
                  <div className="text-xs text-right space-y-1 text-luxury-300 print:text-gray-800">
                    <p className="flex items-center gap-1.5 justify-end">
                      <span>{currentRestaurant.phone}</span>
                      <Phone className="w-3.5 h-3.5 text-luxury-400 print:text-black" />
                    </p>
                    <p className="flex items-center gap-1.5 justify-end">
                      <span className="line-clamp-1">{currentRestaurant.address}</span>
                      <MapPin className="w-3.5 h-3.5 text-luxury-400 print:text-black" />
                    </p>
                  </div>
                  <div className="w-16 h-16 bg-white p-1 rounded-xl flex items-center justify-center shrink-0 shadow-md border border-luxury-700 print:w-16 print:h-16">
                    {qrCodeUrl ? (
                      <img src={qrCodeUrl} alt="Menu QR Code" className="w-full h-full object-contain print:w-full print:h-full" />
                    ) : (
                      <QrCode className="w-full h-full text-black" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Menu Categories & Product Items */}
            <div className="space-y-10">
              {categorizedMenu.map(({ category, items }) => (
                <div key={category.id} className="space-y-4">
                  {/* Category Title Banner */}
                  <div className="flex items-center gap-3 pb-2 border-b-2" style={{ borderColor: primaryColor }}>
                    <h2
                      className="text-lg sm:text-xl font-black font-serif print:text-black"
                      style={{ color: primaryColor }}
                    >
                      {category.name}
                    </h2>
                    {category.nameEn && (
                      <span className="text-xs text-luxury-400 font-mono tracking-wider print:text-gray-500">
                        / {category.nameEn}
                      </span>
                    )}
                    <div className="flex-1 h-[1px] bg-luxury-800/60 print:bg-gray-300 mr-2" />
                  </div>

                  {/* Products Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2 print:gap-3">
                    {items.map((product) => (
                      <div
                        key={product.id}
                        className="flex items-start justify-between gap-3 p-3.5 rounded-2xl bg-luxury-900/60 border border-luxury-800/60 print:bg-white print:border-gray-200 print:p-2.5 print:rounded-lg"
                      >
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-bold text-luxury-100 print:text-black font-serif">
                              {product.name}
                            </h3>
                            <span
                              className="text-sm font-black font-mono shrink-0 print:text-black"
                              style={{ color: primaryColor }}
                            >
                              {formatPrice(product.price)}
                            </span>
                          </div>

                          {product.nameEn && (
                            <p className="text-[10px] text-luxury-400 font-mono print:text-gray-500">
                              {product.nameEn}
                            </p>
                          )}

                          {product.description && (
                            <p className="text-xs text-luxury-300 print:text-gray-600 line-clamp-2 leading-relaxed">
                              {product.description}
                            </p>
                          )}

                          {/* Options & Addons hint */}
                          {((product.sizes && product.sizes.length > 0) || (product.addOns && product.addOns.length > 0)) && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {product.sizes?.map((size) => (
                                <span
                                  key={size.id}
                                  className="text-[9px] px-1.5 py-0.5 rounded bg-luxury-800 text-luxury-300 print:bg-gray-100 print:text-gray-700"
                                >
                                  {size.name} ({formatPrice(size.priceModifier || size.price || 0)})
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Product Image Thumbnail if available */}
                        {product.image && (
                          <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-luxury-800 print:border-gray-200 print:w-14 print:h-14">
                            <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer Notice */}
            <div className="mt-12 pt-4 border-t border-luxury-850 text-center text-xs text-luxury-400 print:border-gray-300 print:text-gray-600">
              <p>نشكركم لزيارتكم مطعم {currentRestaurant.name} — أهلاً وسهلاً بكم دائماً</p>
              <p className="text-[10px] text-luxury-500 font-mono mt-1 print:text-gray-500">
                منصة مريح للخدمات الإلكترونية (MUREEH)
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
