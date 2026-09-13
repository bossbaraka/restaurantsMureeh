import { prisma } from '../../db/prisma';
import { getWhatsAppProviderForRestaurant } from '../whatsapp/configService';
import { normalizePhoneNumber, redactPhone } from '../whatsapp/phone';
import {
  getTemplateMapping,
  resolveTemplateName,
  NotificationEventType,
  TemplateContext,
} from '../whatsapp/templateRegistry';
import { WhatsAppError, WhatsAppErrorType } from '../whatsapp/provider';
import { config } from '../../config';

/**
 * Notification Service — central abstraction for all notification channels.
 * Order Service -> Domain Event -> Notification Service -> Provider -> Meta API
 * 
 * Architecture: Order lifecycle remains independent from external providers.
 * This service is fire-and-forget from order operations — failures never break orders.
 */

export interface OrderStatusChangeEvent {
  orderId: string;
  restaurantId: string;
  previousStatus: string;
  newStatus: string;
  order: {
    id: string;
    numericId?: number;
    restaurantId: string;
    tableId: string;
    customerName?: string | null;
    customerPhone?: string | null;
    customerPhoneE164?: string | null;
    whatsappOptIn?: boolean;
    lastWhatsappNotificationAt?: Date | null;
    lastWhatsappNotificationType?: string | null;
  };
  restaurant?: {
    id: string;
    name: string;
    currency: string;
  };
  table?: {
    number: number;
  };
}

export interface NotificationResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  messageId?: string;
  logId?: string;
}

// Map OrderStatus to NotificationEventType
const ORDER_STATUS_TO_EVENT: Record<string, NotificationEventType> = {
  PENDING: NotificationEventType.ORDER_CONFIRMED,
  PREPARING: NotificationEventType.ORDER_PREPARING,
  READY: NotificationEventType.ORDER_READY,
  SERVED: NotificationEventType.ORDER_COMPLETED,
  CANCELLED: NotificationEventType.ORDER_CANCELLED,
};

// Which statuses should trigger WhatsApp notifications by default
const DEFAULT_TRIGGER_STATUSES = new Set<string>([
  'READY', // Primary use case
  // Future: add more as needed, but configurable per restaurant
]);

/**
 * Check if notification should be sent for this status transition.
 * Prevents duplicate sends: READY -> READY should not trigger again.
 */
export function shouldTriggerNotification(
  previousStatus: string,
  newStatus: string,
  lastNotifiedType?: string | null,
  lastNotifiedAt?: Date | null
): boolean {
  // Only trigger on meaningful transitions
  if (previousStatus === newStatus) return false;

  // Check if this status is in trigger list
  if (!DEFAULT_TRIGGER_STATUSES.has(newStatus)) return false;

  // Prevent duplicate: if last notification was same event type and recent (within 5 minutes), skip
  const eventType = ORDER_STATUS_TO_EVENT[newStatus];
  if (lastNotifiedType === eventType && lastNotifiedAt) {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (lastNotifiedAt.getTime() > fiveMinutesAgo) {
      return false;
    }
  }

  // For READY, ensure we only send once per order (unless explicitly reset)
  // If last notification was READY and new status is also READY, don't send
  if (lastNotifiedType === NotificationEventType.ORDER_READY && newStatus === 'READY') {
    return false;
  }

  return true;
}

export async function handleOrderStatusChange(event: OrderStatusChangeEvent): Promise<NotificationResult> {
  const { order, previousStatus, newStatus, restaurantId } = event;

  // Early exits — do not send if conditions fail
  if (!shouldTriggerNotification(previousStatus, newStatus, order.lastWhatsappNotificationType, order.lastWhatsappNotificationAt)) {
    return { success: false, skipped: true, reason: 'Status transition does not require notification or duplicate' };
  }

  // Check customer phone and opt-in
  const rawPhone = order.customerPhoneE164 || order.customerPhone;
  if (!rawPhone) {
    return { success: false, skipped: true, reason: 'No customer phone' };
  }

  if (!order.whatsappOptIn) {
    return { success: false, skipped: true, reason: 'No WhatsApp opt-in' };
  }

  // Normalize phone
  const normalizedPhone = normalizePhoneNumber(rawPhone);
  if (!normalizedPhone) {
    return { success: false, skipped: true, reason: 'Invalid phone number' };
  }

  // Check restaurant WhatsApp integration
  const provider = await getWhatsAppProviderForRestaurant(restaurantId);
  if (!provider) {
    return { success: false, skipped: true, reason: 'WhatsApp integration not enabled or missing config' };
  }

  // Resolve event type and template
  const eventType = ORDER_STATUS_TO_EVENT[newStatus];
  if (!eventType) {
    return { success: false, skipped: true, reason: `No event mapping for status ${newStatus}` };
  }

  // Get restaurant metadata for template overrides
  const integration = await prisma.whatsAppIntegration.findUnique({
    where: { restaurantId },
    select: { metadata: true },
  });

  const templateInfo = (() => {
    try {
      const resolved = resolveTemplateName(eventType, integration?.metadata);
      return resolved;
    } catch {
      return null;
    }
  })();

  if (!templateInfo) {
    return { success: false, skipped: true, reason: `No template mapping for event ${eventType}` };
  }

  const mapping = getTemplateMapping(eventType);
  if (!mapping) {
    return { success: false, skipped: true, reason: `Template mapping not found for ${eventType}` };
  }

  // Build template context
  const templateContext: TemplateContext = {
    customerName: order.customerName || 'عزيزي العميل',
    orderNumber: order.numericId ? `#${order.numericId}` : order.id,
    orderId: order.id,
    restaurantName: event.restaurant?.name,
    tableNumber: event.table?.number,
    total: undefined,
    currency: event.restaurant?.currency,
  };

  const variables = mapping.getVariables(templateContext);

  // Create notification log (PENDING)
  let logId: string | undefined;
  try {
    const log = await prisma.notificationLog.create({
      data: {
        restaurantId,
        orderId: order.id,
        channel: 'WHATSAPP',
        eventType,
        recipientPhone: rawPhone,
        recipientPhoneE164: normalizedPhone,
        templateName: templateInfo.name,
        status: 'PENDING',
        metadata: {
          previousStatus,
          newStatus,
          templateLanguage: templateInfo.languageCode,
          variables,
        },
      },
    });
    logId = log.id;
  } catch (err) {
    console.error('[NotificationService] Failed to create log', err);
    // Continue — log failure shouldn't block sending, but we try to log
  }

  // Attempt to send via WhatsApp provider
  try {
    const result = await provider.sendTemplate({
      to: normalizedPhone,
      templateName: templateInfo.name,
      languageCode: templateInfo.languageCode,
      variables,
    });

    // Update log to SENT
    if (logId) {
      await prisma.notificationLog.update({
        where: { id: logId },
        data: {
          status: 'SENT',
          providerMessageId: result.messageId,
          metadata: {
            previousStatus,
            newStatus,
            templateLanguage: templateInfo.languageCode,
            variables,
            providerRaw: result.raw,
          },
        },
      });
    }

    // Update order's last notification tracking (prevent duplicates)
    await prisma.order.update({
      where: { id: order.id },
      data: {
        lastWhatsappNotificationAt: new Date(),
        lastWhatsappNotificationType: eventType,
      },
    });

    console.log(`[NotificationService] WhatsApp sent for order ${order.id} to ${redactPhone(normalizedPhone)} event=${eventType} msgId=${result.messageId}`);

    return {
      success: true,
      messageId: result.messageId,
      logId,
    };
  } catch (err: any) {
    const isWhatsAppError = err instanceof WhatsAppError;
    const errorType = isWhatsAppError ? err.type : WhatsAppErrorType.UNKNOWN;
    const errorMessage = err?.message || 'Unknown error';
    const retryable = isWhatsAppError ? err.retryable : false;

    console.error(`[NotificationService] WhatsApp failed for order ${order.id} to ${redactPhone(normalizedPhone)} event=${eventType} error=${errorType} msg=${errorMessage} retryable=${retryable}`);

    // Update log to FAILED
    if (logId) {
      try {
        await prisma.notificationLog.update({
          where: { id: logId },
          data: {
            status: 'FAILED',
            failureReason: `${errorType}: ${errorMessage}`.slice(0, 500),
            metadata: {
              previousStatus,
              newStatus,
              templateLanguage: templateInfo.languageCode,
              variables,
              errorType,
              errorRaw: isWhatsAppError ? err.raw : undefined,
              retryable,
            },
          },
        });
      } catch (logErr) {
        console.error('[NotificationService] Failed to update log to FAILED', logErr);
      }
    }

    // For retryable errors, we could enqueue retry (future: queue system)
    // For now, just log and return failure — order itself already succeeded
    if (retryable) {
      // TODO: implement retry with exponential backoff if queue system exists
      // For now, we rely on manual retry or future job system
    }

    return {
      success: false,
      reason: `${errorType}: ${errorMessage}`,
      logId,
    };
  }
}

/**
 * Async wrapper — fire-and-forget, never throws to break order flow.
 * Call this from order status update handler.
 */
export function triggerOrderNotificationAsync(event: OrderStatusChangeEvent): void {
  // Don't await — run in background
  // Use setImmediate to avoid blocking current request
  setImmediate(async () => {
    try {
      await handleOrderStatusChange(event);
    } catch (err) {
      console.error('[NotificationService] Unhandled error in async trigger', err);
    }
  });
}

/**
 * Future extensibility: handle other event types
 */
export async function handleGenericNotification(params: {
  restaurantId: string;
  eventType: NotificationEventType;
  recipientPhone: string;
  customerName?: string;
  orderId?: string;
  orderNumber?: string;
  metadata?: any;
}): Promise<NotificationResult> {
  const normalizedPhone = normalizePhoneNumber(params.recipientPhone);
  if (!normalizedPhone) {
    return { success: false, skipped: true, reason: 'Invalid phone' };
  }

  const provider = await getWhatsAppProviderForRestaurant(params.restaurantId);
  if (!provider) {
    return { success: false, skipped: true, reason: 'WhatsApp not enabled' };
  }

  const integration = await prisma.whatsAppIntegration.findUnique({
    where: { restaurantId: params.restaurantId },
    select: { metadata: true },
  });

  const templateInfo = resolveTemplateName(params.eventType, integration?.metadata);
  const mapping = getTemplateMapping(params.eventType);
  if (!mapping) {
    return { success: false, skipped: true, reason: 'No template mapping' };
  }

  const ctx: TemplateContext = {
    customerName: params.customerName,
    orderNumber: params.orderNumber || params.orderId || 'N/A',
    orderId: params.orderId || '',
  };

  const variables = mapping.getVariables(ctx);

  try {
    const result = await provider.sendTemplate({
      to: normalizedPhone,
      templateName: templateInfo.name,
      languageCode: templateInfo.languageCode,
      variables,
    });

    await prisma.notificationLog.create({
      data: {
        restaurantId: params.restaurantId,
        orderId: params.orderId,
        channel: 'WHATSAPP',
        eventType: params.eventType,
        recipientPhone: params.recipientPhone,
        recipientPhoneE164: normalizedPhone,
        templateName: templateInfo.name,
        status: 'SENT',
        providerMessageId: result.messageId,
        metadata: params.metadata,
      },
    });

    return { success: true, messageId: result.messageId };
  } catch (err: any) {
    const errorType = err instanceof WhatsAppError ? err.type : 'UNKNOWN';
    await prisma.notificationLog.create({
      data: {
        restaurantId: params.restaurantId,
        orderId: params.orderId,
        channel: 'WHATSAPP',
        eventType: params.eventType,
        recipientPhone: params.recipientPhone,
        recipientPhoneE164: normalizedPhone,
        templateName: templateInfo.name,
        status: 'FAILED',
        failureReason: `${errorType}: ${err?.message}`.slice(0, 500),
        metadata: params.metadata,
      },
    });
    return { success: false, reason: `${errorType}: ${err?.message}` };
  }
}
