import { OrderStatus, TableStatus, TableZone } from '../types/restaurant';

/** Escape untrusted strings before interpolating them into printed HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format table ID/number cleanly as numbers only (e.g. 1 -> "1", "rest-merar-T01" -> "1", "TABLE-05" -> "5").
 * Protects against extracting random digits from hexadecimal UUIDs.
 */
export function formatTableNumber(tableIdOrNumber: string | number | undefined | null): string {
  if (tableIdOrNumber === undefined || tableIdOrNumber === null) return '';
  if (typeof tableIdOrNumber === 'number' && Number.isFinite(tableIdOrNumber)) {
    return String(tableIdOrNumber);
  }
  const str = String(tableIdOrNumber).trim();
  if (!str) return '';

  if (str.toUpperCase().includes('WALK-IN') || str.includes('مباشر') || str === '__WALKIN__') {
    return 'عميل مباشر';
  }

  // Pure integer string: e.g. "5", "05"
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    return isNaN(num) ? str : String(num);
  }

  // Recognizable table ID formats: e.g. "TABLE-05", "rest-1-T05", "T-12", "T5", "table_5"
  const prefixedMatch =
    str.match(/(?:(?:-T|TABLE[-_]|[-_]T|^T)\s*0*)(\d+)\b/i) ||
    str.match(/^(?:طاولة|table)[-_ ]*0*(\d+)\b/i);
  if (prefixedMatch) {
    const num = parseInt(prefixedMatch[1], 10);
    return isNaN(num) ? prefixedMatch[1] : String(num);
  }

  // UUID pattern (e.g. 550e8400-e29b-41d4-a716-446655440000): never extract random hex digits!
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return '';
  }

  return str;
}

/**
 * Display label for a table referenced by ID.
 *
 * Table IDs are opaque (UUIDs, or legacy `{tenant}-T{n}` composites), so a
 * number must never be scraped out of the ID itself — that is exactly what
 * made the customer screen show a different number than the one printed on
 * the table's QR card. When the table registry is known, its real
 * `tableNumber` (the same value printed on the QR card) wins. Otherwise we
 * fall back to `formatTableNumber`, which handles special IDs such as
 * `__WALKIN__` and legacy `-T{n}` IDs.
 */
export function resolveTableDisplayNumber(
  tables: ReadonlyArray<{ id: string; tableNumber?: number | null }> | null | undefined,
  tableId: string | null | undefined
): string {
  if (tableId) {
    const table = tables?.find((t) => t.id === tableId);
    if (
      table &&
      typeof table.tableNumber === 'number' &&
      Number.isFinite(table.tableNumber) &&
      table.tableNumber > 0
    ) {
      return String(table.tableNumber);
    }
  }
  return formatTableNumber(tableId);
}

/** Numeric part of a price, without the currency symbol (e.g. "1,240.50"). */
export function formatAmount(price: number): string {
  const value = Number(price) || 0;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function formatPrice(price: number, currency = '₪'): string {
  return `${currency || '₪'}${formatAmount(price)}`;
}

/** Whole days left until an ISO date (0 once it has passed). */
export function daysUntil(isoDate?: string | null, now: number = Date.now()): number {
  if (!isoDate) return 0;
  const target = new Date(isoDate).getTime();
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.ceil((target - now) / 86_400_000));
}

export function formatTime(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export function formatRelativeMinutes(isoDate: string): string {
  try {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'الآن';
    if (mins === 1) return 'منذ دقيقة';
    if (mins === 2) return 'منذ دقيقتين';
    if (mins <= 10) return `منذ ${mins} دقائق`;
    return `منذ ${mins} دقيقة`;
  } catch {
    return '';
  }
}

export function getOrderStatusConfig(status: OrderStatus): {
  label: string;
  customerTitle: string;
  customerDesc: string;
  badgeBg: string;
  badgeText: string;
  dotColor: string;
  stepIndex: number;
} {
  switch (status) {
    case 'PENDING':
      return {
        label: 'تم استلام الطلب',
        customerTitle: 'تم استلام الطلب',
        customerDesc: 'طلبك وصل إلى المطعم وجاهز للإرسال للمطبخ.',
        badgeBg: 'bg-amber-500/10 border-amber-500/30',
        badgeText: 'text-amber-400',
        dotColor: 'bg-amber-400',
        stepIndex: 1,
      };
    case 'PREPARING':
      return {
        label: 'جاري التحضير',
        customerTitle: 'جاري التحضير',
        customerDesc: 'المطبخ يعمل على إعداد طلبك بعناية واهتمام فائق.',
        badgeBg: 'bg-blue-500/10 border-blue-500/30',
        badgeText: 'text-blue-400',
        dotColor: 'bg-blue-400 animate-pulse',
        stepIndex: 2,
      };
    case 'READY':
      return {
        label: 'الطلب جاهز',
        customerTitle: 'الطلب جاهز',
        customerDesc: 'طلبك جاهز تماماً وفي طريقه إلى طاولتك الآن.',
        badgeBg: 'bg-emerald-500/10 border-emerald-500/30',
        badgeText: 'text-emerald-400',
        dotColor: 'bg-emerald-400',
        stepIndex: 3,
      };
    case 'SERVED':
      return {
        label: 'تم التقديم',
        customerTitle: 'تم التقديم',
        customerDesc: 'تم تقديم طلبك بنجاح. نتمنى لك تجربة طعام استثنائية.',
        badgeBg: 'bg-zinc-500/10 border-zinc-500/30',
        badgeText: 'text-zinc-300',
        dotColor: 'bg-zinc-400',
        stepIndex: 4,
      };
    case 'CANCELLED':
      return {
        label: 'ملغي',
        customerTitle: 'تم إلغاء الطلب',
        customerDesc: 'تم إلغاء هذا الطلب بناءً على رغبتك.',
        badgeBg: 'bg-red-500/10 border-red-500/30',
        badgeText: 'text-red-400',
        dotColor: 'bg-red-500',
        stepIndex: 0,
      };
  }
}

export function getTableZoneLabel(zone: TableZone): string {
  switch (zone) {
    case 'MAIN_HALL':
      return 'الصالة الرئيسية';
    case 'TERRACE':
      return 'التراس الخارجي';
    case 'VIP_LOUNGE':
      return 'الردهة الملكية VIP';
    case 'GARDEN':
      return 'الحديقة الزجاجية';
  }
}

export function getTableStatusConfig(status: TableStatus): {
  label: string;
  badgeBg: string;
  badgeText: string;
} {
  switch (status) {
    case 'AVAILABLE':
      return {
        label: 'شاغرة ومتاحة',
        badgeBg: 'bg-emerald-500/10 border-emerald-500/30',
        badgeText: 'text-emerald-400',
      };
    case 'OCCUPIED':
      return {
        label: 'مشغولة (نشطة)',
        badgeBg: 'bg-amber-500/10 border-amber-500/30',
        badgeText: 'text-amber-400',
      };
    case 'BILL_REQUESTED':
      return {
        label: 'طلب الحساب',
        badgeBg: 'bg-purple-500/10 border-purple-500/30',
        badgeText: 'text-purple-400',
      };
  }
}
