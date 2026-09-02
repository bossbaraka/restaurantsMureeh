import React, { useState, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { RestaurantTable } from '../../types/restaurant';
import { generateQrDataUrl, getTableLink } from '../../utils/qrCodeGenerator';
import { getTableZoneLabel } from '../../utils/formatting';
import { PrintQRTentCardsModal } from './PrintQRTentCardsModal';
import {
  QrCode,
  Download,
  Printer,
  Copy,
  ExternalLink,
  Search,
  Check,
  Building2,
} from 'lucide-react';

export const QRManagement: React.FC = () => {
  const { tables, currentRestaurant, setActiveTableId, setViewMode, showToast } = useRestaurant();

  const [searchTable, setSearchTable] = useState('');
  const [selectedZone, setSelectedZone] = useState<string>('ALL');
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [selectedTableForPrint, setSelectedTableForPrint] = useState<RestaurantTable | null>(null);

  const slug = currentRestaurant?.slug || 'merar';

  useEffect(() => {
    let isMounted = true;
    const generateAll = async () => {
      const map: Record<string, string> = {};
      for (const t of tables) {
        map[t.id] = await generateQrDataUrl(t.id, slug, undefined, t.qrToken);
      }
      if (isMounted) setQrMap(map);
    };
    generateAll();
    return () => {
      isMounted = false;
    };
  }, [tables, slug]);

  const filteredTables = tables.filter((t) => {
    if (selectedZone !== 'ALL' && t.zone !== selectedZone) return false;
    if (searchTable.trim()) {
      const q = searchTable.trim();
      return t.tableNumber.toString().includes(q) || t.id.toLowerCase().includes(q.toLowerCase());
    }
    return true;
  });

  const handleCopyLink = (tableId: string) => {
    const table = tables.find((item) => item.id === tableId);
    const link = getTableLink(tableId, slug, table?.qrToken);
    navigator.clipboard.writeText(link);
    setCopiedId(tableId);
    showToast('success', 'تم نسخ رابط الطاولة', link);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadQr = (table: RestaurantTable) => {
    const dataUrl = qrMap[table.id];
    if (!dataUrl) return;

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `qr-${slug}-${table.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('info', 'تم تنزيل رمز QR', `بطاقة ${table.id}`);
  };

  const handleOpenCustomer = (tableId: string) => {
    setActiveTableId(tableId);
    setViewMode('CUSTOMER');
  };

  return (
    <div className="space-y-5 text-right">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <QrCode className="w-5 h-5 text-gold-400" />
            <span>إدارة رموز QR للطاولات ({currentRestaurant?.name})</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            توليد وتنزيل وطباعة بطاقات QR المستقلة المرتبطة بالمستأجر <code className="text-gold-400 font-mono">/r/{slug}</code>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSelectedTableForPrint(null);
              setIsPrintModalOpen(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-gold-glow"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة بطاقات الطاولات دفعة واحدة</span>
          </button>
        </div>
      </div>

      {/* Filter Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {[
            { id: 'ALL', label: `كافة الطاولات (${tables.length})` },
            { id: 'MAIN_HALL', label: 'الصالة الرئيسية' },
            { id: 'TERRACE', label: 'التراس' },
            { id: 'VIP_LOUNGE', label: 'VIP' },
            { id: 'GARDEN', label: 'الحديقة' },
          ].map((z) => (
            <button
              key={z.id}
              onClick={() => setSelectedZone(z.id)}
              className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                selectedZone === z.id
                  ? 'bg-gold-500 text-luxury-950 font-bold shadow-gold-glow'
                  : 'bg-luxury-900 text-luxury-300 hover:text-luxury-100 border border-luxury-800'
              }`}
            >
              {z.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-48">
          <input
            type="number"
            value={searchTable}
            onChange={(e) => setSearchTable(e.target.value)}
            placeholder="بحث برقم الطاولة..."
            className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 placeholder-luxury-500 rounded-xl py-2 pr-8 pl-3 text-xs focus:outline-none focus:border-gold-500/60 font-mono"
          />
          <Search className="w-3.5 h-3.5 text-luxury-400 absolute right-3 top-2.5 pointer-events-none" />
        </div>
      </div>

      {/* QR Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredTables.map((table) => {
          const qrSrc = qrMap[table.id];
          const isCopied = copiedId === table.id;

          return (
            <div
              key={table.id}
              className="bg-luxury-900 border border-luxury-800 hover:border-gold-500/40 rounded-2xl p-4 flex flex-col justify-between text-center transition-all shadow-luxury group"
            >
              {/* Card Top */}
              <div className="flex items-center justify-between pb-2 border-b border-luxury-800 text-xs">
                <span className="font-bold text-luxury-100 font-serif">
                  {table.id.replace('TABLE-', 'طاولة ')}
                </span>
                <span className="text-[10px] text-luxury-400 bg-luxury-850 px-2 py-0.5 rounded-full border border-luxury-800">
                  {getTableZoneLabel(table.zone)}
                </span>
              </div>

              {/* QR Code Canvas */}
              <div className="my-4 p-3 bg-white rounded-xl shadow-inner mx-auto max-w-[160px] w-full border border-gold-500/20">
                {qrSrc ? (
                  <img
                    src={qrSrc}
                    alt={`QR for ${table.id}`}
                    className="w-full aspect-square object-contain mx-auto"
                  />
                ) : (
                  <div className="w-32 h-32 flex items-center justify-center text-luxury-800 mx-auto">
                    <QrCode className="w-10 h-10 animate-spin" />
                  </div>
                )}
              </div>

              <span className="text-[10px] text-gold-400/80 font-mono mb-3 truncate block">
                {getTableLink(table.id, slug, table.qrToken)}
              </span>

              {/* Action Buttons */}
              <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-luxury-800 text-xs">
                <button
                  onClick={() => handleDownloadQr(table)}
                  className="p-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-luxury-200 flex flex-col items-center justify-center gap-1 transition-colors"
                  title="تنزيل صورة QR"
                >
                  <Download className="w-3.5 h-3.5 text-gold-400" />
                  <span className="text-[10px]">تنزيل</span>
                </button>

                <button
                  onClick={() => {
                    setSelectedTableForPrint(table);
                    setIsPrintModalOpen(true);
                  }}
                  className="p-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-luxury-200 flex flex-col items-center justify-center gap-1 transition-colors"
                  title="معاينة وطباعة البطاقة"
                >
                  <Printer className="w-3.5 h-3.5 text-gold-400" />
                  <span className="text-[10px]">طباعة</span>
                </button>

                <button
                  onClick={() => handleCopyLink(table.id)}
                  className="p-2 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-luxury-200 flex flex-col items-center justify-center gap-1 transition-colors"
                  title="نسخ رابط الطاولة"
                >
                  {isCopied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-gold-400" />
                  )}
                  <span className="text-[10px]">{isCopied ? 'تم!' : 'نسخ'}</span>
                </button>
              </div>

              {/* Test in customer view button */}
              <button
                onClick={() => handleOpenCustomer(table.id)}
                className="mt-2 w-full py-1.5 rounded-xl bg-luxury-950 hover:bg-black text-luxury-400 hover:text-gold-300 border border-luxury-800 text-[11px] flex items-center justify-center gap-1 transition-colors"
              >
                <span>تجربة طلب العميل للطاولة</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Print Tent Card Modal */}
      <PrintQRTentCardsModal
        tables={tables}
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        selectedTable={selectedTableForPrint}
      />
    </div>
  );
};
