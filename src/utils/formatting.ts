import { OrderStatus, TableStatus, TableZone } from '../types/restaurant';

export function formatPrice(price: number): string {
  return `₪${price.toLocaleString('en-US')}`;
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
