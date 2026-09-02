import React, { useEffect, useState } from 'react';
import { RestaurantTable } from '../../types/restaurant';
import { generateQrDataUrl } from '../../utils/qrCodeGenerator';
import { getTableZoneLabel } from '../../utils/formatting';
import { useRestaurant } from '../../context/RestaurantContext';
import { X, Printer, Sparkles, QrCode } from 'lucide-react';

interface PrintQRTentCardsModalProps {
  tables: RestaurantTable[];
  isOpen: boolean;
  onClose: () => void;
  selectedTable?: RestaurantTable | null;
}

export const PrintQRTentCardsModal: React.FC<PrintQRTentCardsModalProps> = ({
  tables,
  isOpen,
  onClose,
  selectedTable,
}) => {
  const { currentRestaurant } = useRestaurant();
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const targetTables = selectedTable ? [selectedTable] : tables.slice(0, 12);
  const slug = currentRestaurant?.slug || 'merar';
  const restName = currentRestaurant?.name || 'مطعم مِيرار';
  const restNameEn = currentRestaurant?.nameEn || 'MÉRAR LUXURY DINING';

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);

    const loadAll = async () => {
      const map: Record<string, string> = {};
      for (const t of targetTables) {
        const dataUrl = await generateQrDataUrl(t.id, slug, undefined, t.qrToken);
        map[t.id] = dataUrl;
      }
      if (isMounted) {
        setQrImages(map);
        setIsLoading(false);
      }
    };

    loadAll();

    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedTable, slug]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/85 backdrop-blur-md transition-opacity" onClick={onClose} />

      {/* Modal Container */}
      <div
        className="relative w-full max-w-4xl bg-luxury-900 border border-luxury-700/80 rounded-2xl shadow-luxury overflow-hidden z-10 my-6 animate-in fade-in zoom-in-95 duration-200 text-right flex flex-col max-h-[92vh]"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 bg-luxury-850/80 border-b border-luxury-800 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-400">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-luxury-50 font-serif">
                {selectedTable ? `معاينة بطاقة طاولة ${selectedTable.tableNumber}` : `معاينة طباعة بطاقات طاولات ${restName}`}
              </h3>
              <p className="text-xs text-luxury-400">
                تصميم فاخر جاهز للطباعة بدقة عالية ووضعه على الطاولات
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-gold-glow"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة فورية</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Tent Cards Preview Container */}
        <div className="p-6 overflow-y-auto flex-1 bg-neutral-950">
          {isLoading ? (
            <div className="py-16 text-center text-luxury-400 text-sm">
              <span className="inline-block w-6 h-6 border-2 border-gold-500 border-t-transparent rounded-full animate-spin mb-2" />
              <p>جاري توليد رموز QR عالية الدقة...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {targetTables.map((table) => (
                <div
                  key={table.id}
                  className="bg-luxury-950 border-2 border-gold-500/50 rounded-2xl p-6 text-center shadow-2xl relative flex flex-col items-center justify-between aspect-[3/4] max-w-xs mx-auto w-full text-luxury-50 overflow-hidden"
                >
                  <div className="absolute top-2 left-2 right-2 bottom-2 border border-gold-500/20 rounded-xl pointer-events-none" />

                  {/* Brand Top */}
                  <div className="relative z-10 mt-1">
                    <div className="w-8 h-8 rounded-lg bg-gold-500 text-luxury-950 flex items-center justify-center font-serif font-bold text-sm mx-auto shadow-gold-glow mb-1.5">
                      {restNameEn.charAt(0) || 'M'}
                    </div>
                    <h4 className="text-lg font-bold font-serif text-gold-300 tracking-wider">
                      {restName}
                    </h4>
                    <span className="text-[10px] text-luxury-400 uppercase tracking-widest font-serif block">
                      {restNameEn}
                    </span>
                  </div>

                  {/* QR Canvas Center */}
                  <div className="relative z-10 bg-white p-3 rounded-2xl shadow-xl my-2 border border-gold-500/30">
                    {qrImages[table.id] ? (
                      <img
                        src={qrImages[table.id]}
                        alt={`QR ${table.id}`}
                        className="w-36 h-36 object-contain"
                      />
                    ) : (
                      <div className="w-36 h-36 flex items-center justify-center text-luxury-800">
                        <QrCode className="w-12 h-12" />
                      </div>
                    )}
                  </div>

                  {/* Table Number & Instructions Bottom */}
                  <div className="relative z-10 mb-1 space-y-1">
                    <div className="text-xl font-extrabold text-gold-400 font-serif">
                      طاولة {table.tableNumber < 10 ? `0${table.tableNumber}` : table.tableNumber}
                    </div>
                    <p className="text-[11px] text-luxury-300 font-medium">
                      امسح الرمز بكاميرا هاتفك لتصفح المنيو والطلب
                    </p>
                    <span className="text-[9px] text-luxury-500 block">
                      {getTableZoneLabel(table.zone)} · الدفع عند الكاشير
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-luxury-950 border-t border-luxury-800 text-xs text-luxury-400 flex items-center justify-between print:hidden">
          <span>عدد البطاقات المعروضة: {targetTables.length}</span>
          <span>المقاس الموصى به: بطاقة طي طاولة 10x15 سم (Tent Card)</span>
        </div>
      </div>
    </div>
  );
};
