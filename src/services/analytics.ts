// Pure analytics engine for the Restaurant Sales Operating System.
// All functions are side-effect free so they can be unit tested and reused
// by the manager dashboard, POS reports and the live restaurant screen.
import { Order, PaymentRecord, RestaurantTable } from '../types/restaurant';

export interface SalesKpis {
  grossOrderValue: number; // value of all non-cancelled orders
  collectedRevenue: number; // revenue confirmed through POS payments
  openBillsValue: number; // unpaid open orders still on tables
  cancelledValue: number;
  ordersCount: number;
  paidOrdersCount: number;
  openOrdersCount: number;
  avgOrderValue: number;
  avgPaidValue: number;
  paymentMethods: { method: string; count: number; total: number }[];
  dailySeries: { date: string; label: string; gross: number; collected: number }[];
  todayCollected: number;
  todayOpen: number;
  todayOrders: number;
}

export interface VisitorKpis {
  activeNow: number; // tables currently occupied / asking bill
  visitsToday: number; // distinct tables with activity today
  visitsYesterday: number;
  weekSeries: { date: string; label: string; visits: number; revenue: number }[];
  hourlyDistribution: { hour: number; label: string; orders: number }[];
  avgVisitMinutes: number | null; // from first order to settle (best-effort)
  walkInSalesCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function toISODate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysAgoDate(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - n * DAY_MS);
}

const isSameISODate = (iso: string, date: Date) => toISODate(new Date(iso)) === toISODate(date);

function lastNDates(n: number): Date[] {
  const dates: Date[] = [];
  for (let i = n - 1; i >= 0; i--) dates.push(daysAgoDate(i));
  return dates;
}

const dateLabel = (d: Date): string => {
  const today = daysAgoDate(0);
  const yesterday = daysAgoDate(1);
  if (toISODate(d) === toISODate(today)) return 'اليوم';
  if (toISODate(d) === toISODate(yesterday)) return 'أمس';
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

export function computeSalesKpis(orders: Order[], payments: PaymentRecord[]): SalesKpis {
  const nonCancelled = orders.filter((o) => o.status !== 'CANCELLED');
  const cancelledValue = orders
    .filter((o) => o.status === 'CANCELLED')
    .reduce((s, o) => s + (o.total || 0), 0);
  const grossOrderValue = nonCancelled.reduce((s, o) => s + (o.total || 0), 0);

  const collectedRevenue = payments.reduce((s, p) => s + (p.total || 0), 0);
  const paidIds = new Set<string>();
  payments.forEach((p) => (p.orderIds || []).forEach((id) => paidIds.add(id)));

  const paidOrders = nonCancelled.filter((o) => paidIds.has(o.id) || o.paymentStatus === 'PAID');
  // "Open bills" = unpaid orders still flowing through the floor (queue/prep/ready).
  // SERVED orders that were closed via the legacy quick-settle (no POS receipt)
  // count toward gross value but are no longer open bills.
  const openOrders = nonCancelled.filter(
    (o) =>
      !paidIds.has(o.id) &&
      o.paymentStatus !== 'PAID' &&
      (o.status === 'PENDING' || o.status === 'PREPARING' || o.status === 'READY')
  );
  const openBillsValue = openOrders.reduce((s, o) => s + (o.total || 0), 0);

  const methodTotals = new Map<string, { count: number; total: number }>();
  payments.forEach((p) => {
    const key = p.method || 'PAY AT CASHIER';
    const cur = methodTotals.get(key) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += p.total || 0;
    methodTotals.set(key, cur);
  });
  const paymentMethods = Array.from(methodTotals.entries()).map(([method, v]) => ({
    method,
    count: v.count,
    total: v.total,
  }));

  const today = daysAgoDate(0);
  const dailySeries = lastNDates(7).map((date) => {
    const dayGross = nonCancelled
      .filter((o) => isSameISODate(o.createdAt, date))
      .reduce((s, o) => s + (o.total || 0), 0);
    const dayCollected = payments
      .filter((p) => isSameISODate(p.createdAt, date))
      .reduce((s, p) => s + (p.total || 0), 0);
    return { date: toISODate(date), label: dateLabel(date), gross: dayGross, collected: dayCollected };
  });

  return {
    grossOrderValue,
    collectedRevenue,
    openBillsValue,
    cancelledValue,
    ordersCount: nonCancelled.length,
    paidOrdersCount: paidOrders.length,
    openOrdersCount: openOrders.length,
    avgOrderValue: nonCancelled.length ? Math.round(grossOrderValue / nonCancelled.length) : 0,
    avgPaidValue: payments.length ? Math.round(collectedRevenue / payments.length) : 0,
    paymentMethods,
    dailySeries,
    todayCollected: payments
      .filter((p) => isSameISODate(p.createdAt, today))
      .reduce((s, p) => s + (p.total || 0), 0),
    todayOpen: openOrders
      .filter((o) => isSameISODate(o.createdAt, today))
      .reduce((s, o) => s + (o.total || 0), 0),
    todayOrders: nonCancelled.filter((o) => isSameISODate(o.createdAt, today)).length,
  };
}

export function computeVisitorKpis(
  orders: Order[],
  tables: RestaurantTable[],
  payments: PaymentRecord[]
): VisitorKpis {
  const nonCancelled = orders.filter((o) => o.status !== 'CANCELLED');
  const today = daysAgoDate(0);
  const yesterday = daysAgoDate(1);

  const visitsPerDate = (ordersOf: Order[], date: Date): number => {
    const set = new Set<string>();
    ordersOf
      .filter((o) => isSameISODate(o.createdAt, date))
      .forEach((o) => set.add(o.tableId));
    return set.size;
  };

  const weekSeries = lastNDates(7).map((date) => ({
    date: toISODate(date),
    label: dateLabel(date),
    visits: visitsPerDate(nonCancelled, date),
    revenue: payments
      .filter((p) => isSameISODate(p.createdAt, date))
      .reduce((s, p) => s + (p.total || 0), 0),
  }));

  const hourly = new Array(24).fill(0);
  const todayOrders = nonCancelled.filter((o) => isSameISODate(o.createdAt, today));
  todayOrders.forEach((o) => {
    const h = new Date(o.createdAt).getHours();
    hourly[h] += 1;
  });
  const hourlyDistribution = hourly.map((count, hour) => ({
    hour,
    label: hour === 0 ? '12 ص' : hour < 12 ? `${hour} ص` : hour === 12 ? '12 م' : `${hour - 12} م`,
    orders: count,
  }));

  // Best-effort average visit length: minutes between first order and its payment.
  const paidAtByOrder = new Map<string, string>();
  payments.forEach((p) => (p.orderIds || []).forEach((oid) => paidAtByOrder.set(oid, p.createdAt)));
  let totalMinutes = 0;
  let countPairs = 0;
  nonCancelled.forEach((o) => {
    const paidAt = paidAtByOrder.get(o.id);
    if (paidAt && isSameISODate(o.createdAt, today)) {
      const mins = (new Date(paidAt).getTime() - new Date(o.createdAt).getTime()) / 60000;
      if (mins >= 0 && mins < 24 * 60) {
        totalMinutes += mins;
        countPairs += 1;
      }
    }
  });

  return {
    activeNow: tables.filter((t) => t.status === 'OCCUPIED' || t.status === 'BILL_REQUESTED').length,
    visitsToday: visitsPerDate(nonCancelled, today),
    visitsYesterday: visitsPerDate(nonCancelled, yesterday),
    weekSeries,
    hourlyDistribution,
    avgVisitMinutes: countPairs ? Math.round(totalMinutes / countPairs) : null,
    walkInSalesCount: payments.filter((p) => p.tableId === '__WALKIN__').length,
  };
}

export const METHOD_LABELS: Record<string, string> = {
  CASH: 'نقدي',
  CARD: 'بطاقة',
  MOBILE: 'محفظة إلكترونية',
  SPLIT: 'تجزئة',
  'PAY AT CASHIER': 'عند الكاشير',
};

export const ZONE_LABELS: Record<string, string> = {
  MAIN_HALL: 'الصالة الرئيسية',
  TERRACE: 'التراس',
  VIP_LOUNGE: 'صالة VIP',
  GARDEN: 'الحديقة',
};

export type PaymentMethodTotal = { method: string; total: number; count: number };

export function summarizeByPaymentMethod(payments: PaymentRecord[]): PaymentMethodTotal[] {
  const map = new Map<string, PaymentMethodTotal>();
  payments.forEach((p) => {
    const m = p.method || 'CASH';
    const cur = map.get(m) || { method: m, total: 0, count: 0 };
    cur.total += p.total || 0;
    cur.count += 1;
    map.set(m, cur);
  });
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} د`;
  const h = Math.floor(min / 60);
  return `${h} س ${min % 60} د`;
}
