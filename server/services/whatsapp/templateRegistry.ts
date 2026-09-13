/**
 * Central WhatsApp template registry.
 * Maps domain events to Meta-approved template names and variable extraction.
 * 
 * Do NOT hard-code template names throughout the codebase — all mappings live here.
 * Easy to extend for future notifications.
 */

export enum NotificationEventType {
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_PREPARING = 'ORDER_PREPARING',
  ORDER_READY = 'ORDER_READY',
  ORDER_COMPLETED = 'ORDER_COMPLETED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  RESERVATION_CONFIRMED = 'RESERVATION_CONFIRMED',
}

export interface TemplateVariable {
  key: string;
  value: string;
}

export interface TemplateMapping {
  eventType: NotificationEventType;
  // Meta template name (must be approved in WhatsApp Manager)
  templateName: string;
  // Language code for template (e.g., ar, en_US, ar_AR)
  languageCode: string;
  // Human-readable description for docs/admin UI
  description: string;
  descriptionAr: string;
  // Example with placeholders: "مرحبًا {{1}} 👋 طلبك رقم {{2}} أصبح جاهزًا للتقديم."
  example: string;
  // Function to extract variables from order/customer context
  getVariables: (ctx: TemplateContext) => string[];
}

export interface TemplateContext {
  customerName?: string | null;
  orderNumber: string;
  orderId: string;
  restaurantName?: string;
  tableNumber?: number;
  total?: number;
  currency?: string;
}

/**
 * Default template mappings.
 * These names must match approved templates in Meta WhatsApp Manager.
 * Restaurant can override via integration metadata in future.
 */
const TEMPLATE_MAPPINGS: Record<NotificationEventType, TemplateMapping> = {
  [NotificationEventType.ORDER_CONFIRMED]: {
    eventType: NotificationEventType.ORDER_CONFIRMED,
    templateName: 'order_confirmed',
    languageCode: 'ar',
    description: 'Order confirmed notification',
    descriptionAr: 'تأكيد الطلب',
    example: 'مرحبًا {{1}} 👋 تم تأكيد طلبك رقم {{2}} وسيتم تحضيره قريبًا.',
    getVariables: (ctx) => [ctx.customerName || 'عزيزي العميل', ctx.orderNumber],
  },
  [NotificationEventType.ORDER_PREPARING]: {
    eventType: NotificationEventType.ORDER_PREPARING,
    templateName: 'order_preparing',
    languageCode: 'ar',
    description: 'Order preparing notification',
    descriptionAr: 'جاري تحضير الطلب',
    example: 'مرحبًا {{1}} 👋 طلبك رقم {{2}} قيد التحضير الآن في المطبخ.',
    getVariables: (ctx) => [ctx.customerName || 'عزيزي العميل', ctx.orderNumber],
  },
  [NotificationEventType.ORDER_READY]: {
    eventType: NotificationEventType.ORDER_READY,
    templateName: 'order_ready',
    languageCode: 'ar',
    description: 'Order ready for serving/pickup',
    descriptionAr: 'الطلب جاهز للتقديم',
    example: 'مرحبًا {{1}} 👋 طلبك رقم {{2}} أصبح جاهزًا للتقديم.',
    getVariables: (ctx) => [ctx.customerName || 'عزيزي العميل', ctx.orderNumber],
  },
  [NotificationEventType.ORDER_COMPLETED]: {
    eventType: NotificationEventType.ORDER_COMPLETED,
    templateName: 'order_completed',
    languageCode: 'ar',
    description: 'Order completed / served',
    descriptionAr: 'تم تقديم الطلب',
    example: 'شكرًا {{1}} 🙏 تم تقديم طلبك رقم {{2}}. نتمنى لك وجبة شهية!',
    getVariables: (ctx) => [ctx.customerName || 'عزيزي العميل', ctx.orderNumber],
  },
  [NotificationEventType.ORDER_CANCELLED]: {
    eventType: NotificationEventType.ORDER_CANCELLED,
    templateName: 'order_cancelled',
    languageCode: 'ar',
    description: 'Order cancelled',
    descriptionAr: 'إلغاء الطلب',
    example: 'مرحبًا {{1}}، نأسف لإبلاغك بأن طلبك رقم {{2}} تم إلغاؤه.',
    getVariables: (ctx) => [ctx.customerName || 'عزيزي العميل', ctx.orderNumber],
  },
  [NotificationEventType.PAYMENT_CONFIRMED]: {
    eventType: NotificationEventType.PAYMENT_CONFIRMED,
    templateName: 'payment_confirmed',
    languageCode: 'ar',
    description: 'Payment confirmed',
    descriptionAr: 'تأكيد الدفع',
    example: 'مرحبًا {{1}}، تم تأكيد دفع طلبك رقم {{2}} بقيمة {{3}}.',
    getVariables: (ctx) => [
      ctx.customerName || 'عزيزي العميل',
      ctx.orderNumber,
      ctx.total ? `${ctx.total} ${ctx.currency || '₪'}` : '',
    ],
  },
  [NotificationEventType.RESERVATION_CONFIRMED]: {
    eventType: NotificationEventType.RESERVATION_CONFIRMED,
    templateName: 'reservation_confirmed',
    languageCode: 'ar',
    description: 'Reservation confirmed',
    descriptionAr: 'تأكيد الحجز',
    example: 'مرحبًا {{1}}، تم تأكيد حجزك رقم {{2}}.',
    getVariables: (ctx) => [ctx.customerName || 'عزيزي العميل', ctx.orderNumber],
  },
};

export function getTemplateMapping(eventType: NotificationEventType): TemplateMapping | null {
  return TEMPLATE_MAPPINGS[eventType] || null;
}

export function getAllTemplateMappings(): TemplateMapping[] {
  return Object.values(TEMPLATE_MAPPINGS);
}

export function isSupportedEventType(eventType: string): eventType is NotificationEventType {
  return Object.values(NotificationEventType).includes(eventType as NotificationEventType);
}

/**
 * Resolve template name with possible restaurant override.
 * Future: check integration metadata for custom template names.
 */
export function resolveTemplateName(
  eventType: NotificationEventType,
  restaurantMetadata?: any
): { name: string; languageCode: string } {
  const mapping = getTemplateMapping(eventType);
  if (!mapping) {
    throw new Error(`Unsupported notification event type: ${eventType}`);
  }
  // Allow per-restaurant override via metadata.templates[EVENT_TYPE] = { name, language }
  if (restaurantMetadata?.templates?.[eventType]) {
    const override = restaurantMetadata.templates[eventType];
    if (override?.name) {
      return {
        name: override.name,
        languageCode: override.languageCode || mapping.languageCode,
      };
    }
  }
  return {
    name: mapping.templateName,
    languageCode: mapping.languageCode,
  };
}
