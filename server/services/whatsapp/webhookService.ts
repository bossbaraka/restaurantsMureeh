import crypto from 'crypto';
import { prisma } from '../../db/prisma';
import { config } from '../../config';

/**
 * WhatsApp webhook security and idempotency handling.
 */

// Constant-time comparison to prevent timing attacks
export function timingSafeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader) return false;
  if (!appSecret) return false;

  // Header format: sha256=<hex>
  const parts = signatureHeader.split('=');
  if (parts.length !== 2) return false;
  const algo = parts[0];
  const signature = parts[1];
  if (algo !== 'sha256') return false;
  if (!signature) return false;

  const bodyBuffer = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = crypto.createHmac('sha256', appSecret).update(bodyBuffer).digest('hex');

  return timingSafeEqual(signature, expected);
}

export function computePayloadHash(payload: any): string {
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Check if webhook event already processed (idempotency).
 * Uses eventId (wamid) as unique key.
 */
export async function isEventAlreadyProcessed(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const existing = await prisma.whatsAppWebhookEvent.findUnique({
    where: { eventId },
  });
  return !!existing;
}

export async function markEventProcessed(params: {
  eventId: string;
  eventType?: string;
  restaurantId?: string;
  payload?: any;
}): Promise<void> {
  const payloadHash = params.payload ? computePayloadHash(params.payload) : undefined;
  try {
    await prisma.whatsAppWebhookEvent.create({
      data: {
        eventId: params.eventId,
        eventType: params.eventType,
        restaurantId: params.restaurantId,
        payloadHash,
      },
    });
  } catch (err: any) {
    // Unique constraint violation means already processed (race condition)
    if (err?.code === 'P2002') {
      return;
    }
    throw err;
  }
}

/**
 * Resolve restaurantId from phoneNumberId (reverse lookup).
 * This is needed because webhook payload contains phone_number_id but not restaurantId directly.
 */
export async function resolveRestaurantByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  if (!phoneNumberId) return null;

  // Check tenant integrations
  const integration = await prisma.whatsAppIntegration.findFirst({
    where: { phoneNumberId },
    select: { restaurantId: true },
  });
  if (integration) return integration.restaurantId;

  // If global fallback matches, we can't resolve specific tenant — return null
  // In that case, status updates will be matched by providerMessageId alone
  if (config.whatsappPhoneNumberId === phoneNumberId) {
    // For global config, we cannot determine tenant from phoneNumberId alone
    // The notification log lookup by providerMessageId will still work
    return null;
  }

  return null;
}

/**
 * Handle status updates from webhook (sent, delivered, read, failed)
 */
export async function handleStatusUpdate(params: {
  messageId: string;
  status: string;
  timestamp: string;
  recipientId?: string;
  errors?: any[];
  pricing?: any;
}): Promise<void> {
  const { messageId, status } = params;
  if (!messageId) return;

  // Map WhatsApp status to our NotificationStatus enum
  const statusMap: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
    sent: 'SENT',
    delivered: 'DELIVERED',
    read: 'READ',
    failed: 'FAILED',
  };

  const mappedStatus = statusMap[status.toLowerCase()];
  if (!mappedStatus) return;

  try {
    await prisma.notificationLog.updateMany({
      where: { providerMessageId: messageId },
      data: {
        status: mappedStatus,
        failureReason: mappedStatus === 'FAILED' ? JSON.stringify(params.errors || { status }) : undefined,
        metadata: {
          webhookStatus: status,
          timestamp: params.timestamp,
          recipientId: params.recipientId,
          errors: params.errors,
          pricing: params.pricing,
        },
      },
    });
  } catch (err) {
    console.error('[WhatsApp Webhook] Failed to update notification log for status', messageId, err);
  }
}

/**
 * Parse incoming webhook payload safely.
 * Returns normalized events.
 */
export interface ParsedWebhookEvent {
  phoneNumberId: string;
  wabaId: string;
  contacts?: any[];
  messages?: Array<{
    from: string;
    id: string;
    timestamp: string;
    type: string;
    text?: { body: string };
  }>;
  statuses?: Array<{
    id: string;
    status: string;
    timestamp: string;
    recipient_id: string;
    errors?: any[];
    pricing?: any;
  }>;
}

export function parseWebhookPayload(payload: any): ParsedWebhookEvent[] {
  const events: ParsedWebhookEvent[] = [];

  try {
    if (!payload || typeof payload !== 'object') return events;
    const object = payload.object;
    // Meta sends object: 'whatsapp_business_account'
    if (object && object !== 'whatsapp_business_account') {
      // Unknown object type, ignore gracefully
      return events;
    }

    const entries = payload.entry;
    if (!Array.isArray(entries)) return events;

    for (const entry of entries) {
      const wabaId = entry.id;
      const changes = entry.changes;
      if (!Array.isArray(changes)) continue;

      for (const change of changes) {
        const value = change.value;
        if (!value) continue;

        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        events.push({
          phoneNumberId,
          wabaId,
          contacts: value.contacts,
          messages: value.messages,
          statuses: value.statuses,
        });
      }
    }
  } catch (err) {
    console.error('[WhatsApp Webhook] Failed to parse payload', err);
  }

  return events;
}
