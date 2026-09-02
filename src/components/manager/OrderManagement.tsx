import React, { useState, useMemo } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Order, OrderStatus } from '../../types/restaurant';
import { formatPrice, formatTime, formatRelativeMinutes, getOrderStatusConfig } from '../../utils/formatting';
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
} from 'lucide-react';

export const OrderManagement: React.FC = () => {
  const { orders, updateOrderStatus, tables } = useRestaurant();

  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAggregateTableId, setSelectedAggregateTableId] = useState<string | null>(null);

  // Filter orders
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Status filter
      if (statusFilter !== 'ALL' && order.status !== statusFilter) {
        return false;
      }
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesId = order.id.toLowerCase().includes(q);
        const matchesTable = order.tableId.toLowerCase().includes(q) || order.tableId.replace('TABLE-', 'طاولة ').includes(q);
        const matchesItems = order.items.some((i) => i.productName.toLowerCase().includes(q));
        return matchesId || matchesTable || matchesItems;
      }
      return true;
    });
  }, [orders, statusFilter, searchQuery]);

  // Status Counts
  const counts = {
    ALL: orders.length,
    PENDING: orders.filter((o) => o.status === 'PENDING').length,
    PREPARING: orders.filter((o) => o.status === 'PREPARING').length,
    READY: orders.filter((o) => o.status === 'READY').length,
    SERVED: orders.filter((o) => o.status === 'SERVED').length,
    CANCELLED: orders.filter((o) => o.status === 'CANCELLED').length,
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

      {/* Orders Grid / Cards */}
      {filteredOrders.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-luxury-900/50 border border-luxury-800">
          <ChefHat className="w-12 h-12 text-luxury-600 mx-auto mb-3" />
          <h4 className="text-base font-bold text-luxury-200">لا توجد طلبات مطابقة للفلتر</h4>
          <p className="text-xs text-luxury-400 mt-1">
            جميع الطلبات المحددة تم إنجازها أو لا توجد طلبات جديدة حالياً.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map((order) => {
            const statusCfg = getOrderStatusConfig(order.status);
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
                      <span>{order.tableId.replace('TABLE-', 'طاولة ')}</span>
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
                    {order.status === 'PENDING' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'PREPARING')}
                        className="px-3.5 py-2 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs transition-colors shadow-gold-glow"
                      >
                        قبول وبدء التحضير
                      </button>
                    )}

                    {order.status === 'PREPARING' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'READY')}
                        className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-luxury-950 font-bold text-xs transition-colors shadow-sm"
                      >
                        وسم كجاهز للتقديم
                      </button>
                    )}

                    {order.status === 'READY' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'SERVED')}
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
