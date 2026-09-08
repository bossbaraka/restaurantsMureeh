import React, { useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Order, OrderStatus } from '../../types/restaurant';
import { formatPrice, formatTime, getOrderStatusConfig } from '../../utils/formatting';
import { CustomerRatingModal } from './CustomerRatingModal';
import {
  X,
  Clock,
  CheckCircle2,
  ChefHat,
  Bell,
  Utensils,
  PlusCircle,
  AlertCircle,
  Edit3,
  Trash2,
  Lock,
  ChevronDown,
  ChevronUp,
  Share2,
  Star,
  Printer,
} from 'lucide-react';

export const OrderTrackingDrawer: React.FC = () => {
  const {
    isOrderTrackingOpen,
    setIsOrderTrackingOpen,
    activeTableOrders,
    activeTableId,
    cancelCustomerOrder,
    editCustomerOrderNotes,
    setIsWaiterModalOpen,
    currentRestaurant,
    showToast,
  } = useRestaurant();
  const currency = currentRestaurant?.currency || '₪';

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [editingNotesOrderId, setEditingNotesOrderId] = useState<string | null>(null);
  const [editingNotesText, setEditingNotesText] = useState<string>('');
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);

  if (!isOrderTrackingOpen) return null;

  const tableNumStr = activeTableId ? activeTableId.replace(/^(?:TABLE-|.*-T)/, '') : '—';

  const handleStartEditNotes = (order: Order) => {
    setEditingNotesOrderId(order.id);
    setEditingNotesText(order.notes || '');
  };

  const handleSaveNotes = (orderId: string) => {
    editCustomerOrderNotes(orderId, editingNotesText);
    setEditingNotesOrderId(null);
  };

  const handleShareWhatsApp = (order: Order) => {
    const restName = currentRestaurant?.name || '';
    const itemsList = order.items.map((i) => `• ${i.quantity}x ${i.productName || i.name} (${formatPrice(i.totalPrice, currency)})`).join('\n');
    const msg = `🧾 *فاتورة إلكترونية - ${restName}*\n📍 *طاولة رقم:* ${tableNumStr}\n🔢 *رقم الطلب:* ${order.id}\n\n*الأصناف:*\n${itemsList}\n\n💰 *الإجمالي:* ${formatPrice(order.total, currency)}\n💳 *طريقة الدفع:* الدفع عند الكاشير\n\n✨ شكراً لزيارتكم!`;

    const encoded = encodeURIComponent(msg);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
    showToast('success', 'تم فتح واتساب', 'تم تجهيز نص الفاتورة للمشاركة');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={() => setIsOrderTrackingOpen(false)}
      />

      {/* Drawer Container */}
      <div
        className="relative w-full max-w-lg bg-luxury-900 border-r border-luxury-800 text-luxury-50 h-full flex flex-col shadow-2xl z-10 animate-in slide-in-from-right duration-300"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-5 border-b border-luxury-800 flex items-center justify-between bg-luxury-850/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[rgb(var(--brand-primary-strong-rgb)/0.1)] border border-[rgb(var(--brand-primary-strong-rgb)/0.3)] flex items-center justify-center text-[var(--brand-primary-strong)]">
              <ChefHat className="w-5 h-5" />
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-luxury-50 font-serif">المطبخ الحي ومتابعة الطلب</h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  مباشر
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-[var(--brand-primary-strong)] font-semibold">طاولة {tableNumStr}</span>
                <span className="text-xs text-luxury-400">
                  ({activeTableOrders.length} طلبات نشطة)
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => setIsOrderTrackingOpen(false)}
            className="p-2 rounded-xl text-luxury-400 hover:text-luxury-100 hover:bg-luxury-800 transition-colors cursor-pointer"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-right">
          {activeTableOrders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-luxury-400 space-y-3">
              <div className="w-16 h-16 rounded-full bg-luxury-800/80 flex items-center justify-center text-luxury-500">
                <Utensils className="w-8 h-8 stroke-1" />
              </div>
              <h4 className="text-base font-bold text-luxury-200">لا توجد طلبات نشطة لطاولتك</h4>
              <p className="text-xs text-luxury-400 max-w-xs leading-relaxed">
                اطلب من القائمة وسنقوم بعرض مراحل إعداد طلبك في المطبخ لحظة بلحظة.
              </p>
              <button
                onClick={() => setIsOrderTrackingOpen(false)}
                className="mt-2 px-4 py-2 rounded-xl brand-fill text-xs font-bold transition-all shadow-[0_0_22px_-6px_var(--brand-glow)] cursor-pointer"
              >
                تصفح قائمة الطعام
              </button>
            </div>
          ) : (
            <>
              {/* Live Kitchen Radar Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-luxury-900 via-luxury-850 to-luxury-900 border border-[rgb(var(--brand-primary-strong-rgb)/0.4)] shadow-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">👨‍🍳</span>
                    <div>
                      <h4 className="text-sm font-bold text-[var(--brand-primary-strong)]">المطبخ الحي (Live KDS)</h4>
                      <p className="text-[11px] text-luxury-300">يتم إرسال حالة الأطباق مباشرة من شاشة المطبخ</p>
                    </div>
                  </div>
                  <div className="text-left">
                    <span className="text-[10px] text-luxury-400 block">وقت التحضير المتوقع</span>
                    <span className="text-xs font-mono font-bold text-[var(--brand-primary-strong)] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      12 - 18 دقيقة
                    </span>
                  </div>
                </div>
              </div>

              {activeTableOrders.map((order) => {
                const statusCfg = getOrderStatusConfig(order.status);
                const isExpanded = expandedOrderId === order.id || activeTableOrders.length === 1;
                const isPending = order.status === 'PENDING';
                const isPreparing = order.status === 'PREPARING';
                const isReady = order.status === 'READY';
                const isServed = order.status === 'SERVED';

                return (
                  <div
                    key={order.id}
                    className="rounded-2xl bg-luxury-850/90 border border-luxury-750 overflow-hidden shadow-lg transition-all"
                  >
                    {/* Order Card Header */}
                    <div className="p-4 bg-luxury-800/50 border-b border-luxury-750 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[var(--brand-primary-strong)] font-mono">
                          طلب {order.id}
                        </span>
                        <span className="text-[11px] text-luxury-400">
                          {formatTime(order.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${statusCfg.badgeBg} ${statusCfg.badgeText}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotColor}`} />
                          {statusCfg.label}
                        </span>

                        <button
                          onClick={() =>
                            setExpandedOrderId(isExpanded ? null : order.id)
                          }
                          className="p-1 text-luxury-400 hover:text-luxury-200 cursor-pointer"
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Completion Alert Banner if Ready/Served */}
                    {(isReady || isServed) && (
                      <div className="p-3 bg-emerald-500/15 border-b border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300 font-bold">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>🎉 تم إنجاز طلبك! طاقم الخدمة يقدم الوجبة الآن.</span>
                        </div>
                      </div>
                    )}

                    {/* Visual Status Progress Flow */}
                    <div className="p-4 bg-luxury-950/40 border-b border-luxury-800">
                      <div className="text-xs mb-3">
                        <span className="font-bold text-luxury-100">{statusCfg.customerTitle}</span>
                        <p className="text-luxury-400 text-[11px] mt-0.5">{statusCfg.customerDesc}</p>
                      </div>

                      {/* Step bar */}
                      <div className="grid grid-cols-4 gap-1.5 pt-1">
                        {[
                          { title: 'الاستلام', active: true, done: !isPending },
                          {
                            title: 'التحضير',
                            active: isPreparing || isReady || isServed,
                            done: isReady || isServed,
                          },
                          { title: 'تم الإنجاز', active: isReady || isServed, done: isServed },
                          { title: 'تم التقديم', active: isServed, done: isServed },
                        ].map((step, idx) => (
                          <div key={idx} className="flex flex-col items-center gap-1">
                            <div
                              className={`h-1.5 w-full rounded-full transition-all duration-500 ${
                                step.active
                                  ? step.done
                                    ? 'bg-emerald-500'
                                    : 'bg-[var(--brand-primary-strong)] animate-pulse'
                                  : 'bg-luxury-800'
                              }`}
                            />
                            <span
                              className={`text-[10px] ${
                                step.active ? 'text-luxury-200 font-bold' : 'text-luxury-500'
                              }`}
                            >
                              {step.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                  {/* Collapsible Order Items & Details */}
                  {isExpanded && (
                    <div className="p-4 space-y-3">
                      {/* Items */}
                      <div className="space-y-2">
                        {order.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-start justify-between text-xs py-1 border-b border-luxury-800/60 last:border-0"
                          >
                            <div className="flex-1">
                              <span className="font-bold text-luxury-100">
                                {item.quantity} × {item.productName || item.name}
                              </span>
                              {item.selectedSize && (
                                <span className="text-[11px] text-[var(--brand-primary-strong)] block">
                                  {typeof item.selectedSize === "object" ? item.selectedSize.name : item.selectedSize}
                                </span>
                              )}
                              {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                                <span className="text-[10px] text-luxury-400 block">
                                  + {item.selectedAddOns.join('، ')}
                                </span>
                              )}
                              {item.removedIngredients && item.removedIngredients.length > 0 && (
                                <span className="text-[10px] text-red-400/80 block">
                                  بدون: {item.removedIngredients.join('، ')}
                                </span>
                              )}
                            </div>
                            <span className="font-bold text-luxury-200 shrink-0">
                              {formatPrice(item.totalPrice, currency)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Notes / Edit Notes */}
                      <div className="pt-2 border-t border-luxury-800">
                        {editingNotesOrderId === order.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editingNotesText}
                              onChange={(e) => setEditingNotesText(e.target.value)}
                              className="w-full bg-luxury-950 border border-luxury-750 text-luxury-100 p-2 rounded-lg text-xs"
                              rows={2}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSaveNotes(order.id)}
                                className="px-3 py-1 brand-fill font-bold text-xs rounded-lg cursor-pointer"
                              >
                                حفظ الملاحظات
                              </button>
                              <button
                                onClick={() => setEditingNotesOrderId(null)}
                                className="px-3 py-1 bg-luxury-800 text-luxury-300 text-xs rounded-lg cursor-pointer"
                              >
                                إلغاء
                              </button>
                            </div>
                          </div>
                        ) : (
                          order.notes && (
                            <p className="text-[11px] text-luxury-300 italic bg-luxury-950/60 p-2 rounded-lg">
                              ملاحظاتك: "{order.notes}"
                            </p>
                          )
                        )}
                      </div>

                      {/* Total & Payment method */}
                      <div className="flex items-center justify-between pt-2 border-t border-luxury-800 text-xs">
                        <span className="text-luxury-400">طريقة الدفع: الدفع عند الكاشير</span>
                        <div className="text-left">
                          <span className="text-xs text-luxury-400 ml-2">الإجمالي:</span>
                          <span className="text-sm font-bold text-[var(--brand-primary-strong)]">
                            {formatPrice(order.total, currency)}
                          </span>
                        </div>
                      </div>

                      {/* Quick Actions: Share WhatsApp & Rate Experience */}
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-luxury-800">
                        <button
                          onClick={() => handleShareWhatsApp(order)}
                          className="p-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>مشاركة واتساب</span>
                        </button>

                        <button
                          onClick={() => setIsRatingModalOpen(true)}
                          className="p-2.5 rounded-xl bg-[rgb(var(--brand-primary-strong-rgb)/0.15)] hover:bg-[rgb(var(--brand-primary-strong-rgb)/0.25)] border border-[rgb(var(--brand-primary-strong-rgb)/0.3)] text-[var(--brand-primary-strong)] text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Star className="w-3.5 h-3.5 fill-[var(--brand-primary-strong)]" />
                          <span>تقييم الوجبة</span>
                        </button>
                      </div>

                      {/* Customer Actions & Rules Enforcement */}
                      <div className="pt-2 border-t border-luxury-800 flex items-center justify-between gap-2">
                        {isPending ? (
                          <>
                            <button
                              onClick={() => handleStartEditNotes(order)}
                              className="flex items-center gap-1 text-xs text-[var(--brand-primary-strong)] hover:text-[var(--brand-primary-strong)] transition-colors cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>تعديل الملاحظات</span>
                            </button>

                            <button
                              onClick={() => cancelCustomerOrder(order.id)}
                              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>إلغاء هذا الطلب</span>
                            </button>
                          </>
                        ) : (
                          <div className="w-full flex items-center gap-2 p-2 rounded-xl bg-luxury-950/70 border border-luxury-800 text-luxury-400 text-[11px]">
                            <Lock className="w-3.5 h-3.5 text-luxury-400 shrink-0" />
                            <span>
                              بدأ المطبخ بتحضير طلبك، لذلك لم يعد بالإمكان تعديله أو إلغاؤه.
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

        {/* Sticky Footer: Order More, Call Waiter & WhatsApp Support */}
        <div className="p-4 bg-luxury-950 border-t border-luxury-800 space-y-2 shrink-0">
          <div className="flex items-center gap-2 text-xs justify-between">
            <a
              href={`https://wa.me/970593498909?text=${encodeURIComponent(`السلام عليكم، استفسار بشأن الطلب في ${currentRestaurant?.name || 'المطعم'}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2 px-3 rounded-xl bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>واتساب الخدمة (مريح):</span>
              <span className="font-mono direction-ltr">00970593498909</span>
            </a>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsWaiterModalOpen(true)}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-luxury-850 hover:bg-luxury-800 text-[var(--brand-primary-strong)] border border-luxury-750 text-xs font-bold transition-all cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              <span>طلب النادل</span>
            </button>

            <button
              onClick={() => setIsOrderTrackingOpen(false)}
              className="flex-1 py-3 px-4 rounded-xl brand-cta font-bold transition-all flex items-center justify-center gap-2 text-xs active:scale-98 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>طلب أصناف إضافية من المنيو</span>
            </button>
          </div>
        </div>
      </div>

      {/* Customer Rating Modal */}
      <CustomerRatingModal
        isOpen={isRatingModalOpen}
        onClose={() => setIsRatingModalOpen(false)}
      />
    </div>
  );
};
