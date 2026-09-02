import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { TableZone, RestaurantTable } from '../../types/restaurant';
import { getTableZoneLabel, formatPrice } from '../../utils/formatting';
import { TableAggregationModal } from './TableAggregationModal';
import { db } from '../../services/db';
import {
  MapPin,
  Users,
  Bell,
  Receipt,
  CheckCircle,
  ExternalLink,
  Layers,
  Sparkles,
  Search,
  Plus,
  Edit2,
  X,
  Power,
} from 'lucide-react';

export const TableManagement: React.FC = () => {
  const { tables, orders, currentRestaurant, refreshTenantData, setActiveTableId, setViewMode, showToast } = useRestaurant();

  const [selectedZone, setSelectedZone] = useState<'ALL' | TableZone>('ALL');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [searchTableNum, setSearchTableNum] = useState('');

  // Table Create / Edit Modal State
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [tableNumInput, setTableNumInput] = useState<number>(1);
  const [capacityInput, setCapacityInput] = useState<number>(4);
  const [zoneInput, setZoneInput] = useState<TableZone>('MAIN_HALL');

  const filteredTables = tables.filter((t) => {
    if (selectedZone !== 'ALL' && t.zone !== selectedZone) return false;
    if (searchTableNum.trim()) {
      const q = searchTableNum.trim();
      return t.tableNumber.toString().includes(q) || t.id.toLowerCase().includes(q.toLowerCase());
    }
    return true;
  });

  const counts = {
    TOTAL: tables.length,
    AVAILABLE: tables.filter((t) => t.status === 'AVAILABLE').length,
    OCCUPIED: tables.filter((t) => t.status === 'OCCUPIED').length,
    BILL_REQUESTED: tables.filter((t) => t.status === 'BILL_REQUESTED').length,
    WITH_WAITER: tables.filter((t) => t.hasWaiterCall).length,
  };

  const handleTestTableInCustomerView = (tableId: string) => {
    setActiveTableId(tableId);
    setViewMode('CUSTOMER');
  };

  const handleOpenAddTable = () => {
    const nextNum = tables.length > 0 ? Math.max(...tables.map((t) => t.tableNumber)) + 1 : 1;
    setEditingTable(null);
    setTableNumInput(nextNum);
    setCapacityInput(4);
    setZoneInput('MAIN_HALL');
    setIsTableModalOpen(true);
  };

  const handleOpenEditTable = (table: RestaurantTable, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTable(table);
    setTableNumInput(table.tableNumber);
    setCapacityInput(table.capacity);
    setZoneInput(table.zone);
    setIsTableModalOpen(true);
  };

  const handleSaveTable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRestaurant) return;

    const numStr = tableNumInput < 10 ? `0${tableNumInput}` : `${tableNumInput}`;
    const tableId = `TABLE-${numStr}`;

    const newOrUpdated: RestaurantTable = {
      id: tableId,
      restaurantId: currentRestaurant.id,
      tableNumber: Number(tableNumInput),
      capacity: Number(capacityInput) || 4,
      zone: zoneInput,
      status: editingTable?.status || 'AVAILABLE',
      activeOrderIds: editingTable?.activeOrderIds || [],
      hasWaiterCall: editingTable?.hasWaiterCall || false,
    };

    db.saveTable(newOrUpdated);
    refreshTenantData();
    setIsTableModalOpen(false);
    showToast('success', editingTable ? 'تم تعديل بيانات الطاولة' : 'تمت إضافة الطاولة بنجاح', `طاولة ${tableNumInput}`);
  };

  return (
    <div className="space-y-5 text-right">
      {/* Header & Stats Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <MapPin className="w-5 h-5 text-gold-400" />
            <span>إدارة طاولات المطعم ({tables.length} طاولة — {currentRestaurant?.name})</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            متابعة حالة الإشغال المباشرة، إضافة وتعديل الطاولات، وتصفية الحسابات
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenAddTable}
            className="px-4 py-2 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-gold-glow"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة طاولة جديدة</span>
          </button>
        </div>
      </div>

      {/* Quick Filter Counters Strip */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold">
          {counts.AVAILABLE} شاغرة ومتاحة
        </div>
        <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold">
          {counts.OCCUPIED} مشغولة
        </div>
        {counts.BILL_REQUESTED > 0 && (
          <div className="px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 font-bold">
            {counts.BILL_REQUESTED} طلب حساب
          </div>
        )}
        {counts.WITH_WAITER > 0 && (
          <div className="px-3 py-1.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 font-bold animate-pulse">
            {counts.WITH_WAITER} نداء نادل
          </div>
        )}
      </div>

      {/* Zone Filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Zone Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {[
            { id: 'ALL', label: `كافة الصالات (${tables.length})` },
            { id: 'MAIN_HALL', label: 'الصالة الرئيسية' },
            { id: 'TERRACE', label: 'التراس الخارجي' },
            { id: 'VIP_LOUNGE', label: 'الردهة الملكية VIP' },
            { id: 'GARDEN', label: 'الحديقة الزجاجية' },
          ].map((z) => {
            const isSelected = selectedZone === z.id;
            return (
              <button
                key={z.id}
                onClick={() => setSelectedZone(z.id as any)}
                className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isSelected
                    ? 'bg-gold-500 text-luxury-950 font-bold shadow-gold-glow'
                    : 'bg-luxury-900 text-luxury-300 hover:text-luxury-100 border border-luxury-800'
                }`}
              >
                {z.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-48">
          <input
            type="number"
            value={searchTableNum}
            onChange={(e) => setSearchTableNum(e.target.value)}
            placeholder="رقم الطاولة..."
            className="w-full bg-luxury-900 border border-luxury-800 text-luxury-100 placeholder-luxury-500 rounded-xl py-2 pr-8 pl-3 text-xs focus:outline-none focus:border-gold-500/60 font-mono"
          />
          <Search className="w-3.5 h-3.5 text-luxury-400 absolute right-3 top-2.5 pointer-events-none" />
        </div>
      </div>

      {/* Tables Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
        {filteredTables.map((table) => {
          const tableOrders = orders.filter((o) => o.tableId === table.id && o.status !== 'CANCELLED');
          const activeOrders = tableOrders.filter((o) => o.status !== 'SERVED');
          const isOccupied = table.status === 'OCCUPIED' || activeOrders.length > 0;
          const isBillReq = table.status === 'BILL_REQUESTED';
          const tableTotal = tableOrders.reduce((sum, o) => sum + o.total, 0);

          return (
            <div
              key={table.id}
              onClick={() => setSelectedTableId(table.id)}
              className={`p-4 rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col justify-between select-none relative group shadow-sm ${
                table.hasWaiterCall
                  ? 'bg-red-500/10 border-red-500/60 ring-1 ring-red-500/40'
                  : isBillReq
                  ? 'bg-purple-500/10 border-purple-500/50'
                  : isOccupied
                  ? 'bg-luxury-850 border-amber-500/40 hover:border-amber-400'
                  : 'bg-luxury-900/90 border-luxury-800 hover:border-gold-500/40 hover:bg-luxury-850'
              }`}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm font-bold text-luxury-100 font-mono flex items-center gap-1.5">
                    <span>{table.id.replace('TABLE-', 'طاولة ')}</span>
                  </span>
                  <span className="text-[10px] text-luxury-400 block mt-0.5">
                    {getTableZoneLabel(table.zone)} · {table.capacity} مقاعد
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => handleOpenEditTable(table, e)}
                    className="p-1 rounded-md text-luxury-500 hover:text-luxury-200 hover:bg-luxury-800 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="تعديل الطاولة"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  {table.hasWaiterCall && (
                    <span className="p-1 rounded-md bg-red-500 text-white animate-bounce" title="نداء نادل">
                      <Bell className="w-3 h-3" />
                    </span>
                  )}
                  {isBillReq && (
                    <span className="p-1 rounded-md bg-purple-500 text-white" title="طلب حساب">
                      <Receipt className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </div>

              {/* Status pill & Orders indicator */}
              <div className="my-3 pt-2 border-t border-luxury-800/60">
                {isOccupied ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-amber-400 font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        مشغولة ({activeOrders.length} طلبات)
                      </span>
                    </div>
                    <span className="text-xs font-bold text-gold-400 block">
                      {formatPrice(tableTotal)}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    شاغرة ومتاحة
                  </span>
                )}
              </div>

              {/* Quick Actions Row */}
              <div className="pt-2 border-t border-luxury-800 flex items-center justify-between text-[11px]">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTableId(table.id);
                  }}
                  className="text-gold-400 hover:underline flex items-center gap-1 font-medium"
                >
                  <Layers className="w-3 h-3" />
                  <span>الطلبات</span>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTestTableInCustomerView(table.id);
                  }}
                  className="text-luxury-400 hover:text-luxury-200 flex items-center gap-1"
                  title="فتح واجهة العميل لهذه الطاولة"
                >
                  <span>معاينة العميل</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table Create / Edit Modal */}
      {isTableModalOpen && (
        <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md" onClick={() => setIsTableModalOpen(false)} />

          <div className="relative w-full max-w-md bg-luxury-900 border border-luxury-700 rounded-2xl p-5 z-10 space-y-4 text-xs" dir="rtl">
            <div className="flex items-center justify-between border-b border-luxury-800 pb-3">
              <h3 className="text-base font-bold text-luxury-50 font-serif">
                {editingTable ? `تعديل طاولة ${editingTable.tableNumber}` : 'إضافة طاولة جديدة'}
              </h3>
              <button onClick={() => setIsTableModalOpen(false)} className="text-luxury-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTable} className="space-y-3">
              <div>
                <label className="block font-bold text-luxury-200 mb-1">رقم الطاولة *</label>
                <input
                  type="number"
                  required
                  min={1}
                  max={999}
                  value={tableNumInput}
                  onChange={(e) => setTableNumInput(Number(e.target.value))}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-luxury-200 mb-1">عدد المقاعد (السعة)</label>
                <select
                  value={capacityInput}
                  onChange={(e) => setCapacityInput(Number(e.target.value))}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
                >
                  <option value={2}>مقعدين (طاولة ثنائية)</option>
                  <option value={4}>4 مقاعد (عائلية / أصدقاء)</option>
                  <option value={6}>6 مقاعد</option>
                  <option value={8}>8 مقاعد (مقصورة VIP)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-luxury-200 mb-1">موقع الطاولة / الصالة</label>
                <select
                  value={zoneInput}
                  onChange={(e) => setZoneInput(e.target.value as TableZone)}
                  className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
                >
                  <option value="MAIN_HALL">الصالة الرئيسية</option>
                  <option value="TERRACE">التراس الخارجي</option>
                  <option value="VIP_LOUNGE">الردهة الملكية VIP</option>
                  <option value="GARDEN">الحديقة الزجاجية</option>
                </select>
              </div>

              <div className="pt-3 border-t border-luxury-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsTableModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-luxury-850 text-luxury-300"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold shadow-gold-glow"
                >
                  {editingTable ? 'حفظ التعديلات' : 'إنشاء الطاولة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table Aggregation Modal */}
      <TableAggregationModal
        tableId={selectedTableId}
        isOpen={!!selectedTableId}
        onClose={() => setSelectedTableId(null)}
      />
    </div>
  );
};
