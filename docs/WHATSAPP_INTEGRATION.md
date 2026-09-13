# WhatsApp Business Platform Integration — Mureeh SaaS

Production-ready, multi-tenant WhatsApp Cloud API integration. Primary use-case: notify customers via WhatsApp when order becomes READY. Extensible to ORDER_CONFIRMED, PREPARING, COMPLETED, CANCELLED, PAYMENT_CONFIRMED, RESERVATION_CONFIRMED.

## Architecture

```
Order Service → Domain Event (previousStatus → newStatus) → Notification Service → WhatsApp Provider → Meta Cloud API
                                            ↓
                              NotificationLog (PENDING/SENT/DELIVERED/READ/FAILED)
                                            ↓
                              Webhook (status updates + idempotency)
```

- **Order Service**: `PUT /api/manager/orders/:id/status` enforces state machine PENDING→PREPARING→READY→SERVED, compare-and-set. On transition to READY (and only when previous ≠ READY), fire-and-forget `triggerOrderNotificationAsync`.
- **Notification Service** (`server/services/notifications/notificationService.ts`): checks consent (`whatsappOptIn`), phone presence (`customerPhoneE164`), tenant WhatsApp enabled, template mapping, then calls provider.
- **WhatsApp Provider** (`server/services/whatsapp/provider.ts` + `client.ts`): centralized API version (`WHATSAPP_API_VERSION`), timeout 10s, retry only transient (429, 5xx, network) with exponential backoff + jitter, maps Meta error codes to typed errors, never leaks secrets in logs.
- **Tenant Isolation**: `WhatsAppIntegration` per restaurant (phoneNumberId, wabaId, encrypted accessToken, enabled, displayPhoneNumber, status). Lookup by restaurantId only; manager routes enforce `getTenantId`/`ownTenant`. Webhook resolves restaurant by phoneNumberId (unique).

## Data Model

- `WhatsAppIntegration`: `restaurantId` PK/FK unique, `phoneNumberId` unique (for webhook routing), `wabaId`, `accessTokenEncrypted` + `accessTokenIv` + `accessTokenTag` (AES-256-GCM), `displayPhoneNumber`, `enabled`, `status`, `metadata` JSON, `verifiedAt`, `lastError`.
- `Order` additions: `customerName`, `customerPhone` (raw), `customerPhoneE164` (normalized), `whatsappOptIn` boolean. Validation: E.164 via `libphonenumber-js` (fallback regex), require phone when optIn true.
- `NotificationLog`: `restaurantId`, `orderId`, `channel=WHATSAPP`, `eventType` (ORDER_READY etc), `recipientPhone` (E164, redacted in API), `templateName`, `providerMessageId`, `status`, `errorCode`, `errorMessage`, `attempts`, `metadata`.
- `WhatsAppWebhookEvent`: `eventId` unique (composite phoneNumberId-status-messageId), `restaurantId`, `type` (message|status), `payload` JSON, `processedAt`.

## Consent & PII

- `whatsappOptIn` required true to send. No send if false/missing.
- Phone validation E.164 (`normalizePhoneNumber` in `server/services/whatsapp/phone.ts`).
- No logs leak full phone: `redactPhone` shows last 4 only; audit logs never include token.
- Templates use placeholders, no free-form marketing.

## Webhook

- **GET** `/api/webhooks/whatsapp`: verification per Meta spec. Query `hub.mode=subscribe`, `hub.verify_token` constant-time compare against `WHATSAPP_VERIFY_TOKEN`, `hub.challenge` returned as text/plain. Rate limited 300/15m.
- **POST** `/api/webhooks/whatsapp`: 
  - Raw body captured via `express.json({ verify: (req,_,buf)=> req.rawBody=buf })` for HMAC.
  - Header `X-Hub-Signature-256`: HMAC SHA256 of raw body with `WHATSAPP_APP_SECRET`, constant-time `timingSafeEqual`. Fail-closed when secret configured: missing/invalid → 401/403, no processing. If secret not configured, log warning but allow (dev).
  - Payload parsed via `parseWebhookPayload` (defensive), idempotency via `WhatsAppWebhookEvent.eventId` unique + `isEventAlreadyProcessed`/`markEventProcessed`.
  - Tenant resolved via `resolveRestaurantByPhoneNumberId(phoneNumberId)`.
  - Status updates: `sent/delivered/read/failed` → update `NotificationLog` by provider message ID, tenant-scoped.
  - Always return 200 on success to stop Meta retries, even on internal errors after validation.
  - Rate limited 300/15m.

## Provider Client

- Centralized base URL `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`.
- Timeout 10s, Axios.
- Error handling: 400 validation, 401/403 auth, 404 number not found, 429 rate limit (retryable), 500 transient (retryable).
- Retry: exponential backoff 1s,2s,4s with jitter, max 3 attempts, only for retryable errors.
- Token: per-tenant encrypted, decrypted via `WHATSAPP_TOKEN_ENCRYPTION_KEY` (AES-256-GCM). Env fallback `WHATSAPP_ACCESS_TOKEN` for single-tenant dev.

## Templates

- `server/services/whatsapp/templates.ts`: mapping `OrderEventType → {name, language, variables}`.
- Default `order_ready` ar template with 2 vars: order id, restaurant name (example). Approval required in Meta Business Manager.
- `getAllTemplateMappings()` for manager UI to display without secrets.
- Extensible: add new event types in `OrderEventType` union, then mapping.

## Order READY Trigger

- In `PUT /api/manager/orders/:id/status`:
  ```ts
  if (order.status !== 'READY' && status === 'READY' && updated) {
    triggerOrderNotificationAsync({ orderId, restaurantId, previousStatus, newStatus });
  }
  ```
- `triggerOrderNotificationAsync` is fire-and-forget, catches all errors, logs but never throws to order flow.
- Avoid duplicate: state machine already rejects READY→READY (idempotent 200), plus NotificationLog unique per order+eventType can be checked if needed.

## Async & Failure Isolation

- No queue required initially; `triggerOrderNotificationAsync` uses `setImmediate` + async function, isolated try/catch.
- If queue exists in future, wrap in `server/services/queue.ts` abstraction.
- WhatsApp failure must never break KDS/POS/order creation. All WhatsApp calls are best-effort.

## Admin Config

- `GET /api/manager/whatsapp`: returns safe config (no token), enabled, phoneNumberId, wabaId, displayPhoneNumber, status, templates list. Tenant isolated.
- `PUT /api/manager/whatsapp`: upsert with validation, encrypt token, audit log `WHATSAPP_CONFIG_UPSERTED`, rate limited 60/15m.
- `POST /api/manager/whatsapp/test`: send test template to provided phone, normalize, provider send, create NotificationLog, audit log. Rate limited 10/1h to prevent spam.
- `GET /api/manager/whatsapp/logs`: paginated, phone redacted, tenant scoped.

## API Conventions

- Follows existing REST: `/api/manager/*` protected, `/api/webhooks/*` public but HMAC secured.
- Validation via `validateBody` + Zod schemas (`whatsappConfigSchema`, `whatsappTestSchema`).
- Tenant isolation via `getTenantId`/`ownTenant`, audit via `logAuditEvent`.

## Env Vars

See `.env.example`:

- `WHATSAPP_VERIFY_TOKEN`: random string ≥20 chars for webhook verification.
- `WHATSAPP_APP_SECRET`: Meta app secret for HMAC signature validation.
- `WHATSAPP_TOKEN_ENCRYPTION_KEY`: 32-byte hex for AES-GCM encryption of per-tenant tokens.
- `WHATSAPP_API_VERSION`: e.g. `v21.0`.
- `WHATSAPP_DEFAULT_TEMPLATES`: optional JSON override.

Never commit real tokens. Manager UI never exposes `accessToken`.

## Setup Steps

1. Create Meta App, add WhatsApp Business Platform, get `phoneNumberId`, `wabaId`, `accessToken`, `appSecret`.
2. Set env vars above.
3. Create approved template `order_ready` in Business Manager (e.g. Arabic: "طلبك {{1}} من {{2}} جاهز للاستلام").
4. Configure webhook in Meta dashboard: URL `https://yourdomain.com/api/webhooks/whatsapp`, verify token same as env, subscribe to `messages` and `message_status`.
5. In Mureeh manager UI (future), set WhatsApp config per restaurant, enable.
6. Test via `POST /api/manager/whatsapp/test` with your phone.

## Security Checklist

- [x] HMAC signature verification constant-time, fail-closed.
- [x] Verify token constant-time compare.
- [x] Raw body capture for HMAC (not JSON.stringify).
- [x] Idempotency via eventId unique.
- [x] Tenant isolation on all routes.
- [x] Token encrypted at rest, never logged, never returned in API.
- [x] Phone redaction in logs.
- [x] Rate limiters on webhook/config/test.
- [x] No PII in error messages.

## Testing

See `server/tests/whatsapp.test.ts` (to be added) and `src/tests` – covers webhook verification valid/invalid, signature valid/invalid/missing, malformed payload, duplicate event idempotency, notification trigger positive/negative (opt-in, phone, duplicate READY), tenant isolation, PII redaction.

## Future Extensions

- Add ORDER_CONFIRMED, PREPARING, COMPLETED templates in `templates.ts`.
- Add reservation/payment events.
- Add queue (BullMQ) if volume grows, wrap in `notificationService`.
- Add inbound message handling for customer replies (STOP opt-out).
