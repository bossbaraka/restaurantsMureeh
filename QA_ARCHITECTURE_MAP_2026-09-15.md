# MÉRAR — Architecture Map (pre-testing artifact)

**Audit:** Adversarial QA / Security / SRE audit of `bossbaraka/restaurantsMureeh`
**Baseline:** HEAD `6574a5c` (merge of PR #36), branch `arena/01a0a609-restaurantsmureeh`
**Date:** 2026-09-15 · Author: Principal QA + Security + SRE audit session
**Method note:** produced from direct code inspection (not README claims) before any dynamic testing, per audit protocol.

---

## 1) Request path — Customer → QR/Public Menu → Frontend → API → Auth → Business Logic → Prisma → PostgreSQL

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ GUEST (anonymous)                        STAFF (PIN/JWT)         PLATFORM (email)  │
│  QR card → /r/{slug}?qr={qrToken}         /login (staff)          /login (email+pw)│
└──────┬────────────────────────────────────────┬───────────────────────┬────────────┘
       │                                        │                       │
       ▼                                        ▼                       ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React 19 + Vite SPA, single 964 kB bundle, RTL Arabic)                    │
│  src/App.tsx — view router (CUSTOMER | MANAGER | KITCHEN_KDS | LIVE_SCREEN |        │
│  PLATFORM_ADMIN | SAAS_LANDING — no react-router; viewMode from context)            │
│  ├─ src/context/RestaurantContext.tsx (1885 LOC)                                    │
│  │   • QR entry state machine (services/customerEntry.ts):                         │
│  │     INITIALIZING → VALIDATING_QR → LOADING_CATALOG → READY / INVALID / RECOVERY │
│  │   • table binding persisted in sessionStorage (qrToken + sessionToken)          │
│  │   • background poll: refreshTenantData() every 10 s (M-02/M-04 mitigation)      │
│  │   • SSE wiring per mode (guest table session | staff JWT)                       │
│  ├─ src/context/AuthContext.tsx — token+user+restaurant in localStorage;           │
│  │     boot restore via GET /auth/me; ROLE_VIEW_ACCESS / ROLE_MANAGER_TAB_ACCESS   │
│  ├─ src/services/api.ts (1796 LOC) — VITE_API_URL base; Bearer header;             │
│  │     idempotency ids (newClientRequestId); XHR multipart for receipt upload      │
│  └─ src/utils/sse.ts — EventSource wrapper, reconnect backoff 1s→30s + jitter      │
└──────┬──────────────────────────── HTTP JSON / multipart ───────────┬──────────────┘
       │                                                              │ SSE (GET …/events)
       ▼                                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ EXPRESS 5 API (server/index.ts) — tsx runtime, single Node process                  │
│  helmet CSP (script-src 'self'; style-src 'unsafe-inline'), CORS allowlist (env),   │
│  morgan w/ URL-secret redaction (qrToken|sessionToken|token|pin|password|…),        │
│  TRUST_PROXY-gated, static /uploads (local driver only), SPA fallback w/ API-404    │
│  guard, boot: deploy-migrations.ts (prisma migrate deploy; P3005 baseline recovery) │
│  optional in-process timers: retention sweep (RETENTION_ENABLED), backups           │
│  (BACKUP_ENABLED), keep-alive self-ping                                             │
│                                                                                     │
│  ROUTES          AUTHN/Z                            VALIDATION    RATE LIMIT        │
│  /api/public/*   anonymous + qrSession / JWT        zod .strict() per-IP limiters   │
│  /api/auth/*     loginLimiter/pinLimiter            zod           (in-memory)       │
│  /api/manager/*  router.use(requireAuth) → per-route                              │
│                  requireManager | requireCashierOrManager | requireServiceStaff     │
│                  + ownTenant() JWT↔tenant match on EVERY route                      │
│  /api/admin/*    platform roles only                                                │
│  /api/uploads/*  requireCashierOrManager / manager, multer 5 MB, magic-byte sniff   │
│                                                                                     │
│  middleware/auth.ts: JWT HS256 pinned (iss/aud), DB re-validation every request     │
│  (user ACTIVE, tokenVersion match, tenant ACTIVE unless platform)                   │
└──────┬─────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ BUSINESS LOGIC (server/services/*)                                                  │
│  orderLifecycle.ts — fulfillment gate:                                              │
│    AWAITING_PAYMENT → PAYMENT_VERIFICATION_PENDING → (confirm)→RELEASED             │
│                                          └────────→ PAYMENT_REJECTED → (re-upload)  │
│  paymentProofs.ts — private storage namespace, sniff on write AND read,             │
│    guest view strips storage key + phone                                            │
│  plans.ts — trial 7d one-per-tenant-ever (trialEndsAt 409/410), lazy entitlement    │
│    evaluation, tenant self-upgrade blocked (402), 7d PAST_DUE grace                 │
│  realtime.ts — SSE registry: global/tenant/subject caps, table-scoped broadcasts    │
│  retention.ts + retentionPolicy.ts — archive marker (never delete money),           │
│    receipt/phone purge windows, idempotent sweeps                                   │
│  security.ts — reconcileCashPayment (till math), CSV formula-injection defense,     │
│    parsePagination caps (take≤100 default 50)                                       │
│  storage/{index,resolve,helpers,local,supabase,imageSniff}.ts — key↔URL contract,   │
│    PNG/JPG/WEBP/GIF only, traversal-guard, supabase|local lazy drivers              │
└──────┬─────────────────────────────────────────────────────────────────────────────┘
       │ Prisma Client (15 models)
       ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ PostgreSQL (Supabase in prod per render.yaml; compose maps to 127.0.0.1 locally)    │
│  Restaurant, RestaurantUser, Plan, Subscription, Branch, Table (qrToken),           │
│  TableSession (sessionToken, 6h TTL), Category, Product, ProductOption, AddOn,      │
│  Offer, Order (+fulfillmentState, clientRequestId, payment proof fields, archive),  │
│  OrderItem (price snapshot), WaiterRequest, Payment, AuditLog                       │
│  Migrations: 20+ folders, additive/intent-documented; unique indexes incl.          │
│  (restaurantId,clientRequestId), single-TableSession-per-table partial unique       │
└────────────────────────────────────────────────────────────────────────────────────┘

OBJECT STORAGE: Supabase Storage (prod, fail-closed) or local ./uploads (dev).
Public ns: restaurants/{tenant}/{folder}/{uuid}.{ext} · Private ns: payment-proofs/…
```

## 2) Flow notebooks (short)

- **Guest order:** scan QR → `POST /public/tables/qr/:qrToken/session` (mint 6 h TableSession) → catalog `GET /public/restaurants/:slug` → `POST /public/orders` (server-side pricing from DB; idempotent by `(restaurantId, clientRequestId)`; order starts **AWAITING_PAYMENT**, invisible to KDS) → guest pays cash (cashier `POST /manager/payments` → RELEASED) or transfers (`POST /public/orders/:id/payment-proof` → PENDING_VERIFICATION; cashier confirm/reject at `/manager/payment-verifications*`) → statuses PENDING→PREPARING→READY→SERVED via `PUT /manager/orders/:id/status` (CAS update, payment-gated, no cancel transition) → settle `POST /manager/tables/:id/settle`.
- **Staff login:** `POST /auth/login` (email+pw → bcrypt; optional PIN-swap scans tenant PIN holders) or dedicated PIN login with `pinLimiter`. JWT carries `{id, restaurantId, role, tv}`; every request re-validates user+tenant in DB.
- **SSE:** `GET /public/events?restaurantId&[tableId&sessionToken | token]` — staff JWT verified fresh (status/tokenVersion/tenant), guests via `getQrSession(sessionToken, restaurantId, tableId)`; caps enforced; 25 s heartbeat.
- **Platform admin:** `/api/admin/*` — onboard tenant (transactional), plan assignment, trial grant, audit log, storage health.

## 3) Trust boundaries that matter (for the audit)

1. `qrToken` = anonymous capability — printed on table cards; anyone holding it can mint guest sessions. Distribution surface = **the printed card + `GET /api/manager/tables` response**.
2. `sessionToken` = per-session guest credential (6 h TTL, bound to restaurant+table).
3. Staff JWT = role + tenant claim; server never trusts the header beyond signature — re-checks DB each request.
4. Payment authority boundary = cashier/manager-only routes (`requireCashierOrManager`) + `fulfillmentState` gate blocking kitchen work pre-verification.
5. Tenant isolation is enforced per-route by `ownTenant()` after JWT resolution — every cross-tenant probe answered by `deny()` (403, audit-logged).
6. Storage boundary: receipt bytes only in the private namespace; server re-sniffs content on every read.

## 4) Test/tooling baseline measured this session

| Check | Command | Result |
|---|---|---|
| Unit/component tests | `npx vitest run` | **649 pass / 1 fail / 27 skip (677)** — sole failure `production-hardening.test.ts` is environmental: Prisma client cannot generate engines in this sandbox (binaries.prisma.sh unreachable), not a code defect |
| Types | `npx tsc -b` | clean (exit 0) |
| Lint | `npx oxlint` | 0 errors, 138 warnings (mostly react-hooks/exhaustive-deps) |
| Build | `npm run build` | OK — **single 964.20 kB JS chunk (241.68 kB gzip), no code-splitting** |
| Live-DB E2E | n/a | Not runnable here: no PostgreSQL binary in sandbox; `prisma generate` blocked by network policy |

*Historical claims in README ("46 tests") and `docs/SYSTEM-DESCRIPTION-AR.md` ("294 passing") are stale relative to today's 677 — evidence-weighted accordingly in the audit.*
