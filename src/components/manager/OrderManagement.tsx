import React, { useState, useMemo } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { Order, OrderStatus } from '../../types/restaurant';
import { escapeHtml, formatPrice, formatTime, formatRelativeMinutes, getOrderStatusConfig, formatTableNumber } from '../../utils/formatting';
import { isOrderHeldForPayment, isOrderOperational, isOrderCancellableByStaff, canRoleCancelOrders } from '../../utils/orderLifecycle';
import { TableAggregationModal } from './TableAggregationModal';
import {
  ChefHat,
  Search,
  Filter,
  CheckCircle,
  Clock,
  Layers,
  ArrowRight,
  AlertCircle,
  Calendar,
  Sparkles,
  Printer,
  Ban,
} from 'lucide-react';

export const OrderManagement: React.FC = () => {
  const { orders, updateOrderStatus, cancelStaffOrder, isMutationPending, tables } = useRestaurant();
  const { currentUser } = useAuth();

  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAggregateTableId, setSelectedAggregateTableId] = useState<string | null>(null);
  // Two-step cancel confirm: no modal, the first tap arms the button, the
  // second executes. Leaving the card disarms it via a blur-safe reset below.
  const [armedCancelOrderId, setArmedCancelOrderId] = useState<string | null>(null);

  const handlePrintInvoice = (order: Order) => {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=720,height=800');
    if (!printWindow) return;

    // Every interpolated value is untrusted (product names come from tenant
    // input) — escape before building the invoice document. No inline
    // <script>: printing is triggered from the opener instead.
    const itemsHtml = order.items
      .map((item) => `<tr><td>${Number(item.quantity) || 0} × ${escapeHtml(item.productName)}</td><td>${escapeHtml(formatPrice(item.totalPrice))}</td></tr>`)
      .join('');
    const restaurantName = 'مُريح | MUREEH';
    const orderId = escapeHtml(order.id);
    const tableLabel = escapeHtml(order.tableNumber ? String(order.tableNumber) : (order.tableName || formatTableNumber(order.tableId)));
    printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${orderId}</title><style>body{font-family:Tahoma,Arial,sans-serif;color:#111;max-width:620px;margin:32px auto;padding:0 20px}header{border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:20px;display:flex;justify-content:space-between}h1{font-size:22px;margin:0 0 6px}p{margin:4px 0;color:#555;font-size:13px}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:10px 4px;border-bottom:1px solid #ddd;font-size:14px}td:last-child{text-align:left;font-weight:bold}.total{display:flex;justify-content:space-between;font-size:18px;font-weight:bold;border-top:2px solid #111;padding-top:14px}@media print{body{margin:0}}</style></head><body><header><div><h1>${restaurantName}</h1><p>فاتورة طلب ${orderId}</p></div><div><p>التاريخ: ${escapeHtml(formatTime(order.createdAt))}</p><p>الطاولة: ${tableLabel}</p></div></header><table>${itemsHtml}</table><div class="total"><span>الإجمالي</span><span>${escapeHtml(formatPrice(order.total))}</span></div><p style="text-align:center;margin-top:32px">شكرًا لزيارتكم</p></body></html>`);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    };
  };

  // -----------------------------------------------------------------------
  // THE PAYMENT GATE.
  //
  // This tab is the kitchen's OWN landing screen (a KITCHEN account starts on
  // it), so it obeys exactly the rule the KDS obeys: an order whose payment no
  // cashier has confirmed is not work, and it is not shown as work.
  //
  // Held tickets are still counted in a banner — "an order the kitchen cannot
  // see" must never read as a lost order — and their status buttons are absent,
  // which also removes the guaranteed 409 the server would answer to
  // «بدء التحضير» on a held order (PUT /orders/:id/status enforces the gate).
  // A CANCELLED held order stays visible: cancellation is the one action the
  // gate never blocks.
  // -----------------------------------------------------------------------
  const heldForPayment = useMemo(
    () => orders.filter((order) => order.status !== 'CANCELLED' && isOrderHeldForPayment(order)),
    [orders]
  );
  const gateVisibleOrders = useMemo(
    () => orders.filter((order) => isOrderOperational(order) || order.status === 'CANCELLED'),
    [orders]
  );

  // Filter orders
  const filteredOrders = useMemo(() => {
    return gateVisibleOrders.filter((order) => {
      // Status filter
      if (statusFilter !== 'ALL' && order.status !== statusFilter) {
        return false;
      }
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesId = order.id.toLowerCase().includes(q);
        const matchesTable =
          order.tableId.toLowerCase().includes(q) ||
          (order.tableNumber != null && String(order.tableNumber).includes(q)) ||
          (order.tableName != null && order.tableName.toLowerCase().includes(q)) ||
          order.tableId.replace(/^(?:TABLE-|.*-T)/, 'طاولة ').includes(q);
        const matchesItems = order.items.some((i) => i.productName.toLowerCase().includes(q));
        return matchesId || matchesTable || matchesItems;
      }
      return true;
    });
  }, [gateVisibleOrders, statusFilter, searchQuery]);

  // Status Counts — over the gate-visible set only. A held order is not a
  // kitchen ticket, so it must not appear in «تم الاستلام (Pending)» either.
  const counts = {
    ALL: gateVisibleOrders.length,
    PENDING: gateVisibleOrders.filter((o) => o.status === 'PENDING').length,
    PREPARING: gateVisibleOrders.filter((o) => o.status === 'PREPARING').length,
    READY: gateVisibleOrders.filter((o) => o.status === 'READY').length,
    SERVED: gateVisibleOrders.filter((o) => o.status === 'SERVED').length,
    CANCELLED: gateVisibleOrders.filter((o) => o.status === 'CANCELLED').length,
  };

  return (
    <div className="space-y-5 text-right">
      {/* Top Header & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-luxury-900 border border-luxury-800 p-4 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-gold-400" />
            <span>شاشة إدارة طلبات المطعم والمطبخ</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            التحكم بدورة حياة الطلبات ومتابعة التحضير لحظة بلحظة
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث برقم الطلب، الطاولة، أو الصنف..."
            aria-label="بحث برقم الطلب، الطاولة، أو الصنف"
            className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 placeholder-luxury-500 rounded-xl py-2 pr-9 pl-3 text-xs focus:outline-none focus:border-gold-500/60"
          />
          <Search className="w-4 h-4 text-luxury-400 absolute right-3 top-2.5 pointer-events-none" />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
        {[
          { id: 'ALL', label: 'كافة الطلبات', count: counts.ALL },
          { id: 'PENDING', label: 'تم الاستلام (Pending)', count: counts.PENDING, color: 'text-amber-400' },
          { id: 'PREPARING', label: 'جاري التحضير (Preparing)', count: counts.PREPARING, color: 'text-blue-400' },
          { id: 'READY', label: 'جاهز للتقديم (Ready)', count: counts.READY, color: 'text-emerald-400' },
          { id: 'SERVED', label: 'تم التقديم (Served)', count: counts.SERVED },
          { id: 'CANCELLED', label: 'الملغية', count: counts.CANCELLED },
        ].map((tab) => {
          const isSelected = statusFilter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as any)}
              className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                isSelected
                  ? 'bg-gold-500 text-luxury-950 shadow-gold-glow font-bold'
                  : 'bg-luxury-900 text-luxury-300 hover:text-luxury-100 hover:bg-luxury-850 border border-luxury-800'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  isSelected ? 'bg-luxury-950/20 text-luxury-950 font-bold' : 'bg-luxury-800 text-luxury-400'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Orders held by the payment gate: a count only, exactly like the KDS.
          The kitchen learns WHY a ticket is missing without being handed work it
          is not allowed to start. */}
      {heldForPayment.length > 0 && (
        <div
          role="status"
          className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2 text-xs font-bold text-amber-200"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {heldForPayment.length} طلب لا يظهر هنا ولا في المطبخ لأنه بانتظار
            تأكيد الدفع من الكاشير (إشعار تحويل أو دفع عند الصندوق). يُعرض فور
            التأكيد كطلب جديد «جاهز للبدء».
          </span>
        </div>
      )}

      {/* Orders Grid / Cards */}
      {filteredOrders.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-luxury-900/50 border border-luxury-800">
          <ChefHat className="w-12 h-12 text-luxury-600 mx-auto mb-3" />
          <h4 className="text-base font-bold text-luxury-200">
            {orders.length === 0
              ? 'لا توجد طلبات حتى الآن'
              : gateVisibleOrders.length === 0
                ? 'لا طلبات مطبوخة حالياً — كل ما ورد بانتظار تأكيد الدفع'
                : 'لا توجد طلبات تطابق البحث أو الفلتر'}
          </h4>
          <p className="text-xs text-luxury-400 mt-1">
            {orders.length === 0
              ? 'ستظهر طلبات العملاء هنا بعد إرسالها من الطاولات وتأكيد الكاشير للدفع.'
              : gateVisibleOrders.length === 0
                ? 'الطلبات مُرَتَّبة عند الزبون لكنها لم تُفرَج بعد: تظهر هنا وبحالة «جاهز للبدء» فور تأكيد الدفع.'
                : 'الطلبات موجودة، لكن لا يطابق أي منها الاختيارات الحالية.'}
          </p>
          {gateVisibleOrders.length > 0 && (statusFilter !== 'ALL' || searchQuery.trim()) && (
            <button
              type="button"
              onClick={() => { setStatusFilter('ALL'); setSearchQuery(''); }}
              className="mt-4 px-4 py-2 rounded-xl bg-luxury-800 hover:bg-luxury-750 text-luxury-100 text-xs font-bold"
            >
              مسح البحث والفلاتر
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map((order) => {
            const statusCfg = getOrderStatusConfig(order.status);
            const isUpdating = isMutationPending(`order:${order.id}`);
            return (
              <div
                key={order.id}
                className="rounded-2xl bg-luxury-900 border border-luxury-800 overflow-hidden flex flex-col justify-between shadow-luxury transition-all hover:border-luxury-700"
              >
                {/* Header */}
                <div className="p-4 bg-luxury-850/70 border-b border-luxury-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedAggregateTableId(order.tableId)}
                      className="text-xs font-bold text-gold-400 hover:underline flex items-center gap-1"
                      title="عرض كافة طلبات هذه الطاولة مجمعة"
                    >
                      <span>طاولة {order.tableNumber ? order.tableNumber : (order.tableName || formatTableNumber(order.tableId))}</span>
                      <Layers className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[11px] text-luxury-400 font-mono">({order.id})</span>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusCfg.badgeBg} ${statusCfg.badgeText}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotColor}`} />
                    {statusCfg.label}
                  </span>
                </div>

                {/* Items Body */}
                <div className="p-4 space-y-3 flex-1 text-xs">
                  <div className="space-y-2">
                    {order.items.map((item) => (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-xl bg-luxury-950/60 border border-luxury-850 flex items-start justify-between gap-2"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          {item.productImage && (
                            <img
                              src={item.productImage}
                              alt=""
                              className="w-9 h-9 rounded-lg object-cover shrink-0 border border-luxury-800"
                            />
                          )}
                          <div>
                            <span className="font-bold text-luxury-100">
                              {item.quantity} × {item.productName}
                            </span>
                            {item.selectedSize && (
                              <span className="text-gold-400 text-[11px] block">
                                {typeof item.selectedSize === "object" ? item.selectedSize.name : item.selectedSize}
                              </span>
                            )}
                            {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                              <span className="text-luxury-400 text-[10px] block">
                                + {item.selectedAddOns.join('، ')}
                              </span>
                            )}
                            {item.removedIngredients && item.removedIngredients.length > 0 && (
                              <span className="text-red-400/80 text-[10px] block">
                                بدون: {item.removedIngredients.join('، ')}
                              </span>
                            )}
                          </div>
                        </div>

                        <span className="font-bold text-luxury-300 shrink-0">
                          {formatPrice(item.totalPrice)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Notes if any */}
                  {order.notes && (
                    <div className="bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl text-[11px] text-amber-300">
                      <strong className="block mb-0.5">ملاحظات العميل:</strong>
                      <span>"{order.notes}"</span>
                    </div>
                  )}

                  {/* Timestamps */}
                  <div className="flex items-center justify-between text-[11px] text-luxury-400 pt-1">
                    <span>الطلب: {formatTime(order.createdAt)}</span>
                    <span>{formatRelativeMinutes(order.createdAt)}</span>
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="p-4 bg-luxury-950/80 border-t border-luxury-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-luxury-400 block">الإجمالي</span>
                    <span className="text-sm font-bold text-gold-400">{formatPrice(order.total)}</span>
                  </div>

                  {/* State Machine Transition Actions */}
                  <div className="flex items-center gap-1.5">
                    {/* Staff cancellation (audit H-02): cashier/manager only,
                        requires the money guard (never PAID), two-tap confirm. */}
                    {isOrderCancellableByStaff(order) && canRoleCancelOrders(currentUser?.role) && (
                      <button
                        onClick={() => {
                          if (armedCancelOrderId === order.id) {
                            setArmedCancelOrderId(null);
                            void cancelStaffOrder(order.id);
                          } else {
                            setArmedCancelOrderId(order.id);
                          }
                        }}
                        disabled={isUpdating}
                        className={`p-2 rounded-xl border transition-colors ${
                          armedCancelOrderId === order.id
                            ? 'bg-red-500 hover:bg-red-400 text-white border-red-400 px-2.5 text-[11px] font-bold'
                            : 'bg-luxury-800 hover:bg-red-500/15 hover:text-red-300 text-luxury-400 border-luxury-700'
                        }`}
                        title="إلغاء الطلب"
                        aria-label={`إلغاء الطلب ${order.id}`}
                      >
                        {armedCancelOrderId === order.id ? 'تأكيد الإلغاء؟' : <Ban className="w-4 h-4" />}
                      </button>
                    )}
                    <button
                      onClick={() => handlePrintInvoice(order)}
                      className="p-2 rounded-xl bg-luxury-800 hover:bg-luxury-750 text-luxury-200 border border-luxury-700 transition-colors"
                      title="طباعة الفاتورة"
                      aria-label={`طباعة فاتورة ${order.id}`}
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    {order.status === 'PENDING' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'PREPARING')}
                        disabled={isUpdating}
                        aria-busy={isUpdating}
                        className="px-3.5 py-2 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs transition-colors shadow-gold-glow"
                      >
                        قبول وبدء التحضير
                      </button>
                    )}

                    {order.status === 'PREPARING' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'READY')}
                        disabled={isUpdating}
                        aria-busy={isUpdating}
                        className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-luxury-950 font-bold text-xs transition-colors shadow-sm"
                      >
                        وسم كجاهز للتقديم
                      </button>
                    )}

                    {order.status === 'READY' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'SERVED')}
                        disabled={isUpdating}
                        aria-busy={isUpdating}
                        className="px-3.5 py-2 rounded-xl bg-luxury-800 hover:bg-luxury-750 text-luxury-100 border border-luxury-700 font-bold text-xs transition-colors"
                      >
                        تم التقديم للعميل
                      </button>
                    )}

                    {order.status === 'SERVED' && (
                      <span className="text-xs text-luxury-400 font-medium">مكتمل</span>
                    )}

                    {order.status === 'CANCELLED' && (
                      <span className="text-xs text-red-400 font-medium">ملغي</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table Aggregation Modal */}
      <TableAggregationModal
        tableId={selectedAggregateTableId}
        isOpen={!!selectedAggregateTableId}
        onClose={() => setSelectedAggregateTableId(null)}
      />
    </div>
  );
};
