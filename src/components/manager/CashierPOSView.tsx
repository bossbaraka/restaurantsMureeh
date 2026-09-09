import React, { useMemo, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { escapeHtml, formatPrice, formatTableNumber } from '../../utils/formatting';
import {
  PaymentRecord,
  Order,
  OrderItem,
} from '../../types/restaurant';
import { computeSalesKpis, METHOD_LABELS, ZONE_LABELS } from '../../services/analytics';
import {
  Search,
  ShoppingBasket,
  Banknote,
  CreditCard,
  Smartphone,
  Printer,
  CheckCircle2,
  X,
  Plus,
  Minus,
  Trash2,
  Receipt,
  User,
  Store,
  Lock,
} from 'lucide-react';

interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
}

const PAY_METHODS = [
  { id: 'CASH', label: 'نقدي', icon: Banknote, color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' },
  { id: 'CARD', label: 'بطاقة', icon: CreditCard, color: 'text-sky-400 border-sky-500/40 bg-sky-500/10' },
  { id: 'MOBILE', label: 'محفظة إلكترونية', icon: Smartphone, color: 'text-violet-400 border-violet-500/40 bg-violet-500/10' },
];

export const CashierPOSView: React.FC = () => {
  const {
    currentRestaurant,
    products,
    categories,
    tables,
    orders,
    payments,
    branches,
    showToast,
    refreshTenantData,
  } = useRestaurant();
  const { currentUser } = useAuth();

  const tenantId = currentRestaurant?.id || '';
  const isWalkInId = '__WALKIN__';

  // --- State ---
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [method, setMethod] = useState<string>('CASH');
  const [cashReceived, setCashReceived] = useState<string>('');
  const [tip, setTip] = useState<string>('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<PaymentRecord | null>(null);
  const [processing, setProcessing] = useState(false);

  // --- Derived data ---
  const branchTables = useMemo(() => {
    if (branchFilter === '__UNASSIGNED__') return tables.filter((t) => !t.branchId);
    if (branchFilter) return tables.filter((t) => t.branchId === branchFilter);
    return tables;
  }, [tables, branchFilter]);

  const openOrdersFor = (tableId: string): Order[] =>
    orders.filter(
      (o) => o.tableId === tableId && o.status !== 'CANCELLED' && o.paymentStatus !== 'PAID'
    );

  const activeTable = selectedTableId
    ? tables.find((t) => t.id === selectedTableId) || null
    : null;
  const activeTableOrders = activeTable ? openOrdersFor(activeTable.id) : [];
  const isWalkIn = selectedTableId === isWalkInId;

  const cartSubtotal = cart.reduce((sum, l) => sum + l.totalPrice, 0);
  const openBillsTotal = activeTableOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const tipValue = Math.max(0, Number(tip) || 0);
  const grandTotal = Math.round((cartSubtotal + openBillsTotal + tipValue) * 100) / 100;
  const cashReceivedValue = Number(cashReceived) || 0;
  const changeDue =
    method === 'CASH' && cashReceivedValue > 0
      ? Math.round(Math.max(0, cashReceivedValue - grandTotal) * 100) / 100
      : 0;

  const kpis = useMemo(() => computeSalesKpis(orders, payments), [orders, payments]);
  const todayPayments = payments.filter(
    (p) => new Date(p.createdAt).toDateString() === new Date().toDateString()
  );

  const visibleProducts = useMemo(() => {
    let list = products;
    if (activeCategory) list = list.filter((p) => p.categoryId === activeCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.nameEn || '').toLowerCase().includes(q)
      );
    }
    return list.filter((p) => p.isAvailable).slice(0, 60);
  }, [products, activeCategory, searchQuery]);

  if (!currentUser) {
    return (
      <div className="p-12 text-center rounded-2xl bg-luxury-900 border border-luxury-800 space-y-3">
        <div className="w-12 h-12 rounded-full bg-gold-500/10 text-gold-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="font-bold text-luxury-100">سجّل دخولك لفتح الكاشير</h2>
        <p className="text-xs text-luxury-400">يتطلب الكاشير حساب مدير مطعم أو كاشير معتمد.</p>
      </div>
    );
  }

  const selectTable = (tableId: string | null) => {
    setSelectedTableId(tableId);
    setCart([]);
  };

  const addToCart = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === productId
            ? { ...l, quantity: l.quantity + 1, totalPrice: Math.round((l.quantity + 1) * l.unitPrice * 100) / 100 }
            : l
        );
      }
      return [...prev, { productId, name: product.name, unitPrice: product.price, quantity: 1, totalPrice: product.price }];
    });
  };

  const changeQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) =>
          l.productId === productId
            ? { ...l, quantity: Math.max(0, l.quantity + delta), totalPrice: Math.round(Math.max(0, l.quantity + delta) * l.unitPrice * 100) / 100 }
            : l
        )
        .filter((l) => l.quantity > 0)
    );
  };

  const buildOrderItems = (): OrderItem[] =>
    cart.map((l) => ({
      id: `pos-item-${Date.now()}-${l.productId}`,
      productId: l.productId,
      productName: l.name,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      totalPrice: l.totalPrice,
    }));

  const openCheckout = () => {
    if (selectedTableId && !isWalkIn && !activeTable) {
      showToast('error', 'اختر طاولة أولاً', 'حدد طاولة (أو عميل مباشر) قبل إتمام الدفع.');
      return;
    }
    if (grandTotal <= 0) {
      showToast('warning', 'لا توجد أصناف للتحصيل', 'أضف أصنافًا أو اختر طاولة فيها فواتير مفتوحة.');
      return;
    }
    setMethod('CASH');
    setCashReceived('');
    setTip('');
    setNote('');
    setCheckoutOpen(true);
  };

  const handleConfirmPayment = async () => {
    if (!tenantId || !selectedTableId) return;
    if (grandTotal <= 0) return;
    if (method === 'CASH' && cashReceivedValue > 0 && cashReceivedValue < grandTotal) {
      showToast('warning', 'المبلغ المقبوض غير كافٍ', 'أدخل مبلغًا أكبر أو مساويًا لقيمة الفاتورة.');
      return;
    }
    setProcessing(true);
    try {
      const tableId = selectedTableId;
      // 1) Create a fresh order for the POS cart items (if any) — persisted
      //    straight to the tenant's real database by the manager endpoint.
      const cartItems = buildOrderItems();
      let createdOrderId: string | null = null;
      if (cartItems.length > 0) {
        const orderRes = await api.createManagerOrder(currentUser, tenantId, tableId, cartItems, note || undefined);
        if (!orderRes.success || !orderRes.data) {
          showToast('error', 'تعذر إنشاء فاتورة الكاشير', orderRes.error);
          setProcessing(false);
          return;
        }
        createdOrderId = orderRes.data.order.id;
      }

      // 2) Collect every open order for the bill (existing + newly created)
      const openOrders = orders.filter(
        (o) =>
          o.tableId === tableId && o.status !== 'CANCELLED' && o.paymentStatus !== 'PAID'
      );
      const orderIds = openOrders.map((o) => o.id);
      if (createdOrderId && !orderIds.includes(createdOrderId)) orderIds.push(createdOrderId);

      // Empty cash tendered = exact payment; the server requires the
      // recorded amount to cover the bill in full.
      const tenderedCash = method === 'CASH' ? cashReceivedValue || grandTotal : undefined;
      const payRes = await api.processPayment(currentUser, tenantId, {
        tableId,
        orderIds,
        method,
        cashReceived: tenderedCash,
        tip: tipValue || undefined,
        note: note || undefined,
      });
      setProcessing(false);
      if (!payRes.success || !payRes.data) {
        showToast('error', 'فشل إتمام الدفع', payRes.error);
        return;
      }
      setCart([]);
      setCheckoutOpen(false);
      setReceipt(payRes.data.payment);
      setSelectedTableId(null);
      refreshTenantData();
      showToast('success', 'تم تحصيل الفاتورة بنجاح', `الإيصال ${payRes.data.payment.receiptNumber} — ${payRes.data.payment.total}₪`);
    } catch {
      setProcessing(false);
      showToast('error', 'خطأ غير متوقع في الدفع', 'حاول مرة أخرى.');
    }
  };

  const printReceipt = () => {
    if (!receipt) return;
    const printWindow = window.open('', '_blank', 'width=320,height=640');
    if (!printWindow) {
      showToast('warning', 'الطباعة غير متاحة', 'اسمح بالنوافذ المنبثقة لطباعة الإيصال.');
      return;
    }
    // All receipt fields are untrusted tenant/user input — escape before
    // building the document. No inline <script>: print from the opener.
    const ordersForReceipt = orders.filter((o) => (receipt.orderIds || []).includes(o.id));
    const lines = ordersForReceipt.flatMap((o) =>
      o.items.map(
        (i) => `<tr><td>${escapeHtml((i as { productName?: string; name?: string }).productName || (i as { name?: string }).name || 'صنف')}</td><td>x${Number(i.quantity) || 0}</td><td style="text-align:left">${escapeHtml(formatPrice(i.totalPrice))}</td></tr>`
      )
    );
    const esc = escapeHtml;
    printWindow.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/>
<title>إيصال ${esc(receipt.receiptNumber)}</title>
<style>
body{font-family:'Segoe UI',Tahoma,sans-serif;width:280px;margin:0 auto;padding:12px;color:#111;font-size:13px}
h2{margin:0;text-align:center}.center{text-align:center}
table{width:100%;border-collapse:collapse;margin:8px 0}td,th{padding:3px 2px;border-bottom:1px dashed #ccc}
.total td{font-weight:bold;font-size:15px}
.dashed{border-top:1px dashed #999;margin:8px 0}
</style></head><body>
<h2>${esc(currentRestaurant?.name || '')}</h2>
<p class="center">${esc(currentRestaurant?.address || '')}</p>
<p class="center">${esc(currentRestaurant?.phone || '')}</p>
<div class="dashed"></div>
<p><b>الإيصال:</b> ${esc(receipt.receiptNumber)}</p>
<p><b>الطاولة:</b> ${esc(receipt.tableLabel)}</p>
<p><b>التاريخ:</b> ${esc(new Date(receipt.createdAt).toLocaleString('ar-EG'))}</p>
<p><b>الكاشير:</b> ${esc(receipt.cashierName)}</p>
<table>${lines.join('')}</table>
<table class="total">
<tr><td>المجموع</td><td style="text-align:left">${esc(formatPrice(receipt.total))}</td></tr>
${receipt.tip ? `<tr><td>إكرامية</td><td style="text-align:left">${esc(formatPrice(receipt.tip))}</td></tr>` : ''}
${receipt.cashReceived !== undefined ? `<tr><td>مدفوع</td><td style="text-align:left">${esc(formatPrice(receipt.cashReceived))}</td></tr>` : ''}
${receipt.changeDue ? `<tr><td>الباقي</td><td style="text-align:left">${esc(formatPrice(receipt.changeDue))}</td></tr>` : ''}
</table>
<p class="center"><b>طريقة الدفع:</b> ${esc(METHOD_LABELS[receipt.method] || receipt.method)}</p>
<div class="dashed"></div>
<p class="center">شكرًا لزيارتكم — نتمنى لكم أوقاتًا سعيدة 🌟</p>
</body></html>`);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
    };
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-luxury-900 border border-luxury-800 p-3">
          <div className="text-[10px] text-luxury-400 font-bold mb-1">محصّل اليوم</div>
          <div className="text-xl font-bold text-gold-400">{formatPrice(kpis.todayCollected)}</div>
        </div>
        <div className="rounded-xl bg-luxury-900 border border-luxury-800 p-3">
          <div className="text-[10px] text-luxury-400 font-bold mb-1">فواتير مفتوحة</div>
          <div className="text-xl font-bold text-luxury-100">{formatPrice(kpis.openBillsValue)}</div>
        </div>
        <div className="rounded-xl bg-luxury-900 border border-luxury-800 p-3">
          <div className="text-[10px] text-luxury-400 font-bold mb-1">طلبات اليوم</div>
          <div className="text-xl font-bold text-luxury-100">{kpis.todayOrders}</div>
        </div>
        <div className="rounded-xl bg-luxury-900 border border-luxury-800 p-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-luxury-400 font-bold mb-1">معاملات اليوم</div>
            <div className="text-xl font-bold text-luxury-100">{todayPayments.length}</div>
          </div>
          <Receipt className="w-5 h-5 text-gold-500/50" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ============ RIGHT: TABLE & BILL CONTEXT ============ */}
        <div className="lg:col-span-3 space-y-3 order-3 lg:order-1">
          <div className="rounded-2xl bg-luxury-900 border border-luxury-800 p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-luxury-100 flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5 text-gold-400" /> نقطة البيع — اختر الطاولة
              </h3>
            </div>
            <select
              value={branchFilter || ''}
              onChange={(e) => setBranchFilter(e.target.value || null)}
              className="w-full mb-2 bg-luxury-950 border border-luxury-750 rounded-lg px-2 py-1.5 text-xs text-luxury-200"
            >
              <option value="">كل الفروع ({tables.length} طاولة)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({tables.filter((t) => t.branchId === b.id).length})</option>
              ))}
              <option value="__UNASSIGNED__">غير مصنفة ({tables.filter((t) => !t.branchId).length})</option>
            </select>
            <button
              onClick={() => selectTable(isWalkInId)}
              className={`w-full mb-2 p-2 rounded-xl border text-right text-xs font-bold flex items-center justify-between transition-colors cursor-pointer ${
                isWalkIn ? 'bg-gold-500 text-luxury-950 border-gold-400' : 'bg-luxury-950 border-luxury-750 text-luxury-200 hover:border-gold-500/50'
              }`}
            >
              <span className="flex items-center gap-2"><User className="w-4 h-4" /> عميل مباشر (كاونتر)</span>
              <span className="text-[10px] font-mono opacity-70">WALK-IN</span>
            </button>
            <div className="grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto pl-1">
              {branchTables.map((t) => {
                const openTotal = openOrdersFor(t.id).reduce((s, o) => s + (o.total || 0), 0);
                const isActiveSel = selectedTableId === t.id;
                const occupied = t.status === 'OCCUPIED' || t.status === 'BILL_REQUESTED' || t.activeOrderIds.length > 0;
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTable(t.id)}
                    className={`rounded-lg border p-1.5 text-center transition-colors cursor-pointer ${
                      isActiveSel
                        ? 'bg-gold-500 border-gold-400 text-luxury-950'
                        : occupied
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 hover:border-amber-400'
                          : 'bg-luxury-950 border-luxury-750 text-luxury-300 hover:border-gold-500/40'
                    }`}
                  >
                    <div className="text-sm font-bold font-mono">{formatTableNumber(t.tableNumber || t.id)}</div>
                    <div className="text-[11px] opacity-80">{t.capacity} مقعد</div>
                    {occupied && openTotal > 0 && (
                      <div className="text-[11px] font-bold text-gold-300">{formatPrice(openTotal)}</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Open bill summary for selected context */}
          <div className="rounded-2xl bg-luxury-900 border border-luxury-800 p-3">
            <h3 className="text-xs font-bold text-luxury-100 mb-2">
              {isWalkIn ? 'فاتورة الكاونتر' : activeTable ? `فاتورة طاولة ${formatTableNumber(activeTable.tableNumber || activeTable.id)}` : 'فاتورة جديدة'}
            </h3>
            {activeTable && (
              <div className="text-[10px] text-luxury-400 mb-2">
                {ZONE_LABELS[activeTable.zone] || activeTable.zone} — {activeTable.status === 'OCCUPIED' ? 'مشغولة' : 'متاحة'}
              </div>
            )}
            {activeTableOrders.length === 0 ? (
              <p className="text-[11px] text-luxury-500 leading-relaxed">
                لا توجد فواتير مفتوحة. أضف الأصناف من المنتصف وستُنشأ فاتورة عند الدفع.
              </p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {activeTableOrders.map((o) => (
                  <div key={o.id} className="bg-luxury-950 rounded-lg p-2 text-[11px]">
                    <div className="flex justify-between text-luxury-300">
                      <span className="font-bold font-mono">{o.id}</span>
                      <span>{formatPrice(o.total || 0)}</span>
                    </div>
                    <div className="text-luxury-500 truncate mt-0.5">
                      {o.items.map((i) => `${i.productName || i.name} x${i.quantity}`).join(' • ')}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Cart lines */}
            {cart.length > 0 && (
              <div className="mt-2 border-t border-luxury-800 pt-2 space-y-1">
                {cart.map((l) => (
                  <div key={l.productId} className="flex items-center justify-between text-[11px] gap-1">
                    <span className="text-luxury-200 truncate flex-1">{l.name}</span>
                    <button onClick={() => changeQty(l.productId, -1)} className="text-luxury-500 hover:text-red-400 cursor-pointer"><Minus className="w-3 h-3" /></button>
                    <span className="font-bold w-5 text-center">{l.quantity}</span>
                    <button onClick={() => changeQty(l.productId, 1)} className="text-luxury-500 hover:text-gold-400 cursor-pointer"><Plus className="w-3 h-3" /></button>
                    <span className="font-mono font-bold text-gold-300 w-14 text-left">{formatPrice(l.totalPrice)}</span>
                    <button onClick={() => setCart((prev) => prev.filter((x) => x.productId !== l.productId))} className="text-luxury-600 hover:text-red-400 cursor-pointer"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-luxury-800 mt-2 pt-2 space-y-1 text-xs">
              {openBillsTotal > 0 && (
                <div className="flex justify-between text-luxury-300">
                  <span>فواتير مفتوحة</span><span>{formatPrice(openBillsTotal)}</span>
                </div>
              )}
              {cartSubtotal > 0 && (
                <div className="flex justify-between text-luxury-300">
                  <span>أصناف جديدة</span><span>{formatPrice(cartSubtotal)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-luxury-50 text-sm">
                <span>الإجمالي</span><span className="text-gold-400">{formatPrice(grandTotal)}</span>
              </div>
            </div>

            <button
              onClick={openCheckout}
              disabled={grandTotal <= 0}
              className="mt-3 w-full bg-gold-500 hover:bg-gold-400 disabled:opacity-40 disabled:cursor-not-allowed text-luxury-950 font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <ShoppingBasket className="w-4 h-4" />
              تحصيل {formatPrice(grandTotal)}
            </button>
          </div>
        </div>

        {/* ============ MIDDLE: PRODUCT CATALOG ============ */}
        <div className="lg:col-span-6 order-1 lg:order-2 rounded-2xl bg-luxury-900 border border-luxury-800 p-3">
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-luxury-500" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث في قائمة الكاشير..."
                className="w-full bg-luxury-950 border border-luxury-750 rounded-xl pr-9 pl-3 py-2 text-xs text-luxury-100 placeholder:text-luxury-600 focus:border-gold-500/60 outline-none"
              />
            </div>
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 mb-2">
            <button
              onClick={() => setActiveCategory(null)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
                !activeCategory ? 'bg-gold-500 text-luxury-950' : 'bg-luxury-950 border border-luxury-750 text-luxury-300'
              }`}
            >
              الكل ({visibleProducts.length})
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(activeCategory === c.id ? null : c.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
                  activeCategory === c.id ? 'bg-gold-500 text-luxury-950' : 'bg-luxury-950 border border-luxury-750 text-luxury-300'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2 max-h-[560px] overflow-y-auto pl-1">
            {visibleProducts.map((p) => {
              const inCart = cart.find((l) => l.productId === p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p.id)}
                  className="relative rounded-xl bg-luxury-950 border border-luxury-800 hover:border-gold-500/60 p-2 text-right transition-colors cursor-pointer group"
                >
                  <div className="h-14 rounded-lg bg-cover bg-center mb-1.5" style={{ backgroundImage: p.image ? `url(${p.image})` : undefined }} />
                  <div className="text-[10px] leading-tight text-luxury-200 line-clamp-2 min-h-6">{p.name}</div>
                  <div className="text-[11px] font-bold text-gold-400 mt-1">{formatPrice(p.price)}</div>
                  {inCart && (
                    <span className="absolute top-1.5 left-1.5 bg-gold-500 text-luxury-950 text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                      {inCart.quantity}
                    </span>
                  )}
                </button>
              );
            })}
            {visibleProducts.length === 0 && (
              <div className="col-span-full py-10 text-center text-xs text-luxury-500">لا توجد أصناف مطابقة.</div>
            )}
          </div>
        </div>

        {/* ============ LEFT: RECENT TRANSACTIONS ============ */}
        <div className="lg:col-span-3 order-2 lg:order-3 rounded-2xl bg-luxury-900 border border-luxury-800 p-3">
          <h3 className="text-xs font-bold text-luxury-100 mb-2 flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5 text-gold-400" /> آخر معاملات اليوم
          </h3>
          <div className="space-y-1.5 max-h-96 overflow-y-auto pl-1">
            {todayPayments.length === 0 && (
              <p className="text-[11px] text-luxury-500">لا توجد معاملات بعد — أتمم أول عملية دفع.</p>
            )}
            {todayPayments.slice(0, 25).map((p) => (
              <div key={p.id} className="bg-luxury-950 rounded-lg p-2 text-[11px] flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-luxury-100">{p.receiptNumber}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                      p.method === 'CASH' ? 'bg-emerald-500/15 text-emerald-300'
                        : p.method === 'CARD' ? 'bg-sky-500/15 text-sky-300'
                          : 'bg-violet-500/15 text-violet-300'
                    }`}>
                      {METHOD_LABELS[p.method] || p.method}
                    </span>
                  </div>
                  <div className="text-luxury-500 truncate">{p.tableLabel} • {new Date(p.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <span className="font-bold text-gold-300 font-mono">{formatPrice(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ============ CHECKOUT MODAL ============ */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-luxury-900 border border-luxury-750 rounded-2xl w-full max-w-md shadow-2xl p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-luxury-50 text-sm">إتمام الدفع</h3>
              <button onClick={() => setCheckoutOpen(false)} className="text-luxury-400 hover:text-luxury-100 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="bg-luxury-950 rounded-xl p-3 mb-3 text-xs space-y-1">
              <div className="flex justify-between text-luxury-300">
                <span>{isWalkIn ? 'عميل مباشر' : activeTable ? `طاولة ${activeTable.tableNumber}` : ''}</span>
                <span>{activeTableOrders.length} فاتورة + {cart.length} صنف جديد</span>
              </div>
              <div className="flex justify-between text-luxury-200">
                <span>قيمة الطلبات المفتوحة</span><span>{formatPrice(openBillsTotal + cartSubtotal)}</span>
              </div>
              {tipValue > 0 && (
                <div className="flex justify-between text-luxury-200"><span>إكرامية</span><span>{formatPrice(tipValue)}</span></div>
              )}
              <div className="flex justify-between font-bold text-luxury-50 text-base pt-1 border-t border-luxury-800">
                <span>الإجمالي</span><span className="text-gold-400">{formatPrice(grandTotal)}</span>
              </div>
            </div>

            <label className="text-[10px] text-luxury-400 font-bold block mb-1" htmlFor="cashierposview-f1">طريقة الدفع</label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {PAY_METHODS.map((m) => {
                const Icon = m.icon;
                const active = method === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => { setMethod(m.id); setCashReceived(''); }}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-bold transition-colors cursor-pointer ${
                      active ? `${m.color} border-current` : 'bg-luxury-950 border-luxury-750 text-luxury-400 hover:text-luxury-200'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {m.label}
                  </button>
                );
              })}
            </div>

            {method === 'CASH' && (
              <div className="mb-3">
                <label className="text-[10px] text-luxury-400 font-bold block mb-1">المبلغ المقبوض</label>
                <input id="cashierposview-f1"
                  type="number"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  placeholder={`${Math.ceil(grandTotal)}`}
                  className="w-full bg-luxury-950 border border-luxury-750 rounded-xl px-3 py-2 text-sm text-luxury-100 outline-none focus:border-gold-500/60 mb-2"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {[50, 100, 200, 500].map((amount) => (
                    <button
                      key={amount}
                      onClick={() => setCashReceived(String(amount))}
                      className="px-2.5 py-1 rounded-lg bg-luxury-950 border border-luxury-750 text-[11px] text-luxury-300 hover:border-gold-500/50 cursor-pointer"
                    >
                      {amount}₪
                    </button>
                  ))}
                </div>
                {cashReceivedValue > 0 && (
                  <div className="mt-2 flex justify-between text-xs font-bold">
                    <span className="text-luxury-300">الباقي</span>
                    <span className={changeDue > 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {changeDue > 0 ? formatPrice(changeDue) : cashReceivedValue >= grandTotal ? '0₪' : `ناقص ${formatPrice(grandTotal - cashReceivedValue)}`}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[10px] text-luxury-400 font-bold block mb-1" htmlFor="cashierposview-f2">إكرامية (اختياري)</label>
                <input id="cashierposview-f2"
                  type="number"
                  value={tip}
                  onChange={(e) => setTip(e.target.value)}
                  placeholder="0"
                  className="w-full bg-luxury-950 border border-luxury-750 rounded-xl px-3 py-2 text-xs text-luxury-100 outline-none focus:border-gold-500/60"
                />
              </div>
              <div>
                <label className="text-[10px] text-luxury-400 font-bold block mb-1" htmlFor="cashierposview-f3">ملاحظة</label>
                <input id="cashierposview-f3"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="اختياري"
                  className="w-full bg-luxury-950 border border-luxury-750 rounded-xl px-3 py-2 text-xs text-luxury-100 outline-none focus:border-gold-500/60"
                />
              </div>
            </div>

            <button
              onClick={handleConfirmPayment}
              disabled={processing}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-emerald-950 font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {processing ? 'جارٍ المعالجة...' : `تأكيد الدفع — ${formatPrice(grandTotal)}`}
            </button>
          </div>
        </div>
      )}

      {/* ============ RECEIPT SUCCESS ============ */}
      {receipt && (
        <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-luxury-900 border border-gold-500/40 rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h3 className="font-bold text-luxury-50 text-base mb-1">تم الدفع بنجاح</h3>
            <div className="font-mono text-gold-400 text-sm font-bold mb-4">{receipt.receiptNumber}</div>
            <div className="bg-luxury-950 rounded-xl p-4 text-xs space-y-1.5 text-right">
              <div className="flex justify-between"><span className="text-luxury-400">الطاولة</span><span className="text-luxury-100 font-bold">{receipt.tableLabel}</span></div>
              <div className="flex justify-between"><span className="text-luxury-400">طريقة الدفع</span><span className="text-luxury-100 font-bold">{METHOD_LABELS[receipt.method] || receipt.method}</span></div>
              <div className="flex justify-between"><span className="text-luxury-400">الكاشير</span><span className="text-luxury-100 font-bold">{receipt.cashierName}</span></div>
              <div className="flex justify-between"><span className="text-luxury-400">الوقت</span><span className="text-luxury-100 font-bold">{new Date(receipt.createdAt).toLocaleTimeString('ar-EG')}</span></div>
              {receipt.cashReceived !== undefined && (
                <div className="flex justify-between"><span className="text-luxury-400">مدفوع نقدًا</span><span className="text-luxury-100 font-bold">{formatPrice(receipt.cashReceived)}</span></div>
              )}
              {receipt.changeDue ? (
                <div className="flex justify-between"><span className="text-luxury-400">الباقي للعميل</span><span className="text-emerald-400 font-bold">{formatPrice(receipt.changeDue)}</span></div>
              ) : null}
              <div className="flex justify-between border-t border-luxury-800 pt-1.5 mt-1.5 text-base">
                <span className="text-luxury-300 font-bold">الإجمالي</span><span className="text-gold-400 font-bold">{formatPrice(receipt.total)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button onClick={printReceipt} className="flex items-center justify-center gap-2 bg-luxury-800 hover:bg-luxury-750 text-luxury-100 font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer">
                <Printer className="w-4 h-4" /> طباعة الإيصال
              </button>
              <button
                onClick={() => setReceipt(null)}
                className="bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
              >
                فاتورة جديدة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
