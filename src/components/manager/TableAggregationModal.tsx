import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { formatPrice, formatTime, getOrderStatusConfig, formatTableNumber } from '../../utils/formatting';
import { X, CheckCircle, Layers } from 'lucide-react';

interface TableAggregationModalProps {
  tableId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const TableAggregationModal: React.FC<TableAggregationModalProps> = ({
  tableId,
  isOpen,
  onClose,
}) => {
  const { orders, tables, currentRestaurant, refreshTenantData, showToast, updateOrderStatus } = useRestaurant();
  const { currentUser } = useAuth();
  const [settling, setSettling] = useState(false);

  if (!isOpen || !tableId) return null;

  const tableOrders = orders.filter((o) => o.tableId === tableId && o.status !== 'CANCELLED');
  const tableTotalRevenue = tableOrders.reduce((sum, o) => sum + o.total, 0);
  const tableObj = tables.find((t) => t.id === tableId);
  const tableLabel = tableObj ? `طاولة ${tableObj.tableNumber}` : (tableOrders[0]?.tableNumber ? `طاولة ${tableOrders[0].tableNumber}` : `طاولة ${formatTableNumber(tableId)}`);

  // Full cashier settle: closes every unpaid order on the table, records a POS
  // receipt in the ledger and frees the table for the next guests.
  const handleSettleBill = async () => {
    if (!currentRestaurant || !currentUser) {
      showToast('error', 'سجّل دخولك أولاً', 'يلزم حساب موظف معتمد لتسوية الحسابات عند الكاشير.');
      return;
    }
    setSettling(true);
    const unpaidOrders = tableOrders.filter((o) => o.paymentStatus !== 'PAID');
    if (unpaidOrders.length === 0) {
      setSettling(false);
      onClose();
      return;
    }
    // Manager settle = cash collected in full: the recorded tendered amount
    // must cover the bill (server-enforced, never silently marked PAID).
    const unpaidTotal = Math.round(unpaidOrders.reduce((sum, o) => sum + o.total, 0) * 100) / 100;
    const res = await api.processPayment(currentUser, currentRestaurant.id, {
      tableId,
      orderIds: unpaidOrders.map((o) => o.id),
      method: 'CASH',
      cashReceived: unpaidTotal,
    });
    setSettling(false);
    if (res.success) {
      refreshTenantData();
      showToast('success', 'تمت تسوية الحساب وتحصيله', `إيصال ${res.data?.payment.receiptNumber} بمبلغ ${formatPrice(res.data?.payment.total || 0)}`);
      onClose();
    } else {
      showToast('error', 'تعذرت تسوية الحساب', res.error);
    }
  };

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div
        className="relative w-full max-w-2xl bg-luxury-900 border border-luxury-700/80 rounded-2xl shadow-luxury overflow-hidden z-10 my-6 animate-in fade-in zoom-in-95 duration-200 text-right flex flex-col max-h-[90vh]"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 bg-luxury-850/80 border-b border-luxury-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gold-500/10 border border-gold-500/30 flex items-center justify-center text-gold-400 font-bold">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-luxury-50 font-serif">
                تجميع طلبات {tableLabel}
              </h3>
              <p className="text-xs text-luxury-400">
                إجمالي الطلبات النشطة: <span className="text-gold-400 font-bold">{tableOrders.length}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {tableOrders.length === 0 ? (
            <div className="p-8 text-center text-luxury-400 text-xs">
              لا توجد طلبات مسجلة لهذه الطاولة حالياً.
            </div>
          ) : (
            tableOrders.map((ord) => {
              const statusCfg = getOrderStatusConfig(ord.status);
              return (
                <div
                  key={ord.id}
                  className="p-4 rounded-xl bg-luxury-850 border border-luxury-750 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gold-400 font-mono">
                        طلب {ord.id}
                      </span>
                      <span className="text-xs text-luxury-400">{formatTime(ord.createdAt)}</span>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusCfg.badgeBg} ${statusCfg.badgeText}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotColor}`} />
                      {statusCfg.label}
                    </span>
                  </div>

                  {/* Items List */}
                  <div className="space-y-1.5 text-xs">
                    {ord.items.map((item) => (
                      <div key={item.id} className="flex justify-between text-luxury-200">
                        <span>
                          {item.quantity} × {item.productName}
                          {item.selectedSize && ` (${item.selectedSize})`}
                        </span>
                        <span className="font-bold text-luxury-300">
                          {formatPrice(item.totalPrice)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Notes if any */}
                  {ord.notes && (
                    <p className="text-[11px] text-luxury-400 italic bg-luxury-900/60 p-2 rounded-lg">
                      ملاحظات: "{ord.notes}"
                    </p>
                  )}

                  {/* Quick Order Status Controller */}
                  <div className="flex items-center justify-between pt-2 border-t border-luxury-800">
                    <span className="text-xs text-luxury-400">
                      قيمة الطلب: <strong className="text-gold-400">{formatPrice(ord.total)}</strong>
                    </span>

                    <div className="flex gap-1.5">
                      {ord.status === 'PENDING' && (
                        <button
                          onClick={() => updateOrderStatus(ord.id, 'PREPARING')}
                          className="px-2.5 py-1 bg-gold-500 text-luxury-950 rounded-lg text-[11px] font-bold"
                        >
                          بدء التحضير
                        </button>
                      )}
                      {ord.status === 'PREPARING' && (
                        <button
                          onClick={() => updateOrderStatus(ord.id, 'READY')}
                          className="px-2.5 py-1 bg-emerald-500 text-luxury-950 rounded-lg text-[11px] font-bold"
                        >
                          وسم كجاهز
                        </button>
                      )}
                      {ord.status === 'READY' && (
                        <button
                          onClick={() => updateOrderStatus(ord.id, 'SERVED')}
                          className="px-2.5 py-1 bg-luxury-750 text-luxury-100 rounded-lg text-[11px] font-bold border border-luxury-650"
                        >
                          تم التقديم
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer: Grand Total & Cashier Settle */}
        <div className="p-4 bg-luxury-950 border-t border-luxury-800 flex items-center justify-between">
          <div>
            <span className="text-xs text-luxury-400 block">إجمالي حساب الطاولة الكامل:</span>
            <span className="text-lg font-bold text-gold-400">{formatPrice(tableTotalRevenue)}</span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-luxury-850 text-luxury-300 text-xs font-semibold hover:bg-luxury-800"
            >
              إغلاق
            </button>

            {/* Payment collection is the cashier/manager duty — the server's
                requireCashierOrManager enforces it for other staff roles. */}
            {tableOrders.length > 0 &&
              ['RESTAURANT_MANAGER', 'PLATFORM_ADMIN', 'SUPER_ADMIN', 'CASHIER'].includes(currentUser?.role || '') && (
                <button
                  onClick={handleSettleBill}
                  disabled={settling}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-lg"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{settling ? 'جارٍ تحصيل الحساب...' : 'تحصيل الحساب (POS) وإفراغ الطاولة'}</span>
                </button>
              )}
          </div>
        </div>
      </div>
    </div>
  );
};
