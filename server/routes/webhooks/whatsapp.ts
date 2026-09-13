import { Router, Request, Response } from 'express';
import { config } from '../../config';
import {
  verifyWebhookSignature,
  parseWebhookPayload,
  isEventAlreadyProcessed,
  markEventProcessed,
  resolveRestaurantByPhoneNumberId,
  handleStatusUpdate,
} from '../../services/whatsapp/webhookService';
import { prisma } from '../../db/prisma';
import { whatsappWebhookLimiter } from '../../middleware/rateLimit';

const router = Router();

router.use(whatsappWebhookLimiter);

/**
 * GET /api/webhooks/whatsapp — Meta webhook verification
 * Query params: hub.mode, hub.verify_token, hub.challenge
 */
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  const verifyToken = config.whatsappVerifyToken;

  if (!verifyToken) {
    console.warn('[WhatsApp Webhook] Verification attempted but WHATSAPP_VERIFY_TOKEN not configured');
    return res.status(403).json({ success: false, error: 'Webhook not configured' });
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[WhatsApp Webhook] Verification successful');
    // Must return challenge as plain text, not JSON
    return res.status(200).send(challenge);
  }

  console.warn('[WhatsApp Webhook] Verification failed: invalid token or mode');
  return res.status(403).json({ success: false, error: 'Verification failed' });
});

/**
 * POST /api/webhooks/whatsapp — Receive WhatsApp events
 * Security: Validates X-Hub-Signature-256 using App Secret
 * Idempotency: Checks eventId to avoid duplicate processing
 */
router.post('/', async (req: Request, res: Response) => {
  // Always respond 200 quickly to avoid Meta retries, but process async
  // However we need to validate signature first (fail closed)

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = (req as any).rawBody as Buffer | undefined;
  const appSecret = config.whatsappAppSecret;

  // Security: if app secret is configured, signature is mandatory
  if (appSecret) {
    if (!signature) {
      console.warn('[WhatsApp Webhook] Missing signature header');
      return res.status(401).json({ success: false, error: 'Missing signature' });
    }

    const bodyForVerification = rawBody || Buffer.from(JSON.stringify(req.body), 'utf8');
    const isValid = verifyWebhookSignature(bodyForVerification, signature, appSecret);
    if (!isValid) {
      console.warn('[WhatsApp Webhook] Invalid signature');
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }
  } else {
    console.warn('[WhatsApp Webhook] WHATSAPP_APP_SECRET not configured — signature verification skipped (not recommended for production)');
  }

  // Parse payload safely
  const payload = req.body;
  if (!payload) {
    return res.status(200).json({ success: true, message: 'No payload' });
  }

  const events = parseWebhookPayload(payload);

  if (events.length === 0) {
    // Unknown event type or empty — acknowledge gracefully
    return res.status(200).json({ success: true, message: 'No relevant events' });
  }

  // Process events (with idempotency)
  for (const event of events) {
    const { phoneNumberId, wabaId, statuses, messages } = event;

    // Resolve restaurant for this phone number (for logging/tracing)
    let restaurantId: string | null = null;
    try {
      restaurantId = await resolveRestaurantByPhoneNumberId(phoneNumberId);
    } catch (err) {
      console.error('[WhatsApp Webhook] Failed to resolve restaurant', err);
    }

    // Handle status updates (sent, delivered, read, failed)
    if (statuses && statuses.length > 0) {
      for (const status of statuses) {
        const eventId = status.id; // provider message ID is the idempotency key for status
        if (!eventId) continue;

        // Idempotency check for status events — use composite key to avoid collision with message ids
        const statusEventId = `status-${eventId}-${status.status}-${status.timestamp}`;
        if (await isEventAlreadyProcessed(statusEventId)) {
          continue;
        }

        try {
          await handleStatusUpdate({
            messageId: status.id,
            status: status.status,
            timestamp: status.timestamp,
            recipientId: status.recipient_id,
            errors: (status as any).errors,
            pricing: (status as any).pricing,
          });

          await markEventProcessed({
            eventId: statusEventId,
            eventType: `status_${status.status}`,
            restaurantId: restaurantId || undefined,
            payload: status,
          });
        } catch (err) {
          console.error('[WhatsApp Webhook] Failed to handle status update', err);
        }
      }
    }

    // Handle incoming messages (for future auto-replies, etc.)
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        const eventId = msg.id;
        if (!eventId) continue;

        if (await isEventAlreadyProcessed(eventId)) {
          continue;
        }

        try {
          // For now, just log incoming message and mark processed
          // Future: implement auto-reply, customer support, etc.
          console.log(`[WhatsApp Webhook] Incoming message from ${msg.from} type=${msg.type} id=${msg.id} restaurant=${restaurantId || 'unknown'}`);

          // Optionally store as audit log
          await prisma.auditLog.create({
            data: {
              restaurantId: restaurantId || null,
              actor: `WhatsApp:${msg.from}`,
              actorRole: 'STAFF',
              action: 'WHATSAPP_MESSAGE_RECEIVED',
              entity: 'WhatsAppMessage',
              entityId: msg.id,
              details: `Incoming WhatsApp message type=${msg.type} from ${msg.from}`,
              metadata: {
                phoneNumberId,
                wabaId,
                messageType: msg.type,
                timestamp: msg.timestamp,
              },
            },
          }).catch(() => {});

          await markEventProcessed({
            eventId,
            eventType: `message_${msg.type}`,
            restaurantId: restaurantId || undefined,
            payload: msg,
          });
        } catch (err) {
          console.error('[WhatsApp Webhook] Failed to handle incoming message', err);
        }
      }
    }
  }

  // Always return 200 to acknowledge receipt (Meta will retry on non-2xx)
  return res.status(200).json({ success: true, message: 'Events processed' });
});

export default router;
