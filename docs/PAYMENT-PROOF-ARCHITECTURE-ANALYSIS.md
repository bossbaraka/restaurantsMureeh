# Mureeh Menu | مُريح — Architecture analysis before the Payment-Proof / Daily-Archive feature

> Phase 1 output (DISCOVERY). **No file in this repository was modified to produce this
> report.** Every statement below was verified against the code at commit
> `11299bd7c1184ce63cf60f4ffa577058f6b0101c` (branch `main`), not assumed.

---

## 0. Stack & deployment (verified)

| Layer | What is actually there | Evidence |
|---|---|---|
| Frontend | React 19 + Vite 8 + Tailwind 3, single-page app, Arabic RTL, luxury dark theme | `src/`, `tailwind.config.js` |
| Backend | Node + Express 5 executed through `tsx` (`server/index.ts`) | `package.json` scripts, `server/index.ts` |
| Database | PostgreSQL through Prisma 5.22 (20 models) | `prisma/schema.prisma` |
| Auth | JWT HS256 (iss `mureeh-api`, aud `mureeh-app`, `tv` token-version) + bcrypt password + bcrypt PIN | `server/middleware/auth.ts`, `server/routes/auth.ts` |
| Validation | Zod 4 with `validateBody()` strict schemas | `server/validation/schemas.ts` |
| Uploads | Multer (memory) + storage abstraction (`local` \| `supabase`) | `server/routes/uploads.ts`, `server/services/storage/*` |
| Realtime | Server-Sent Events (`GET /api/public/events`) with connection caps | `server/routes/public.ts`, `server/services/realtime.ts` |
| Scheduler | **No cron.** Two opt-in in-process `setInterval` jobs (keep-alive ping, DB backup) + **manual CLI scripts** documented for an external/Render cron | `server/index.ts` (`KEEP_ALIVE`, `BACKUP_ENABLED`), `server/db/expire-subscriptions.ts` (`npm run subscriptions:expire`) |
| Deployment | Render (API + static frontend) `render.yaml`; Vercel/Netlify configs also present | `render.yaml`, `vercel.json`, `netlify.toml` |
| Tests | Vitest (`npm test`), oxlint (`npm run lint`), `tsc -b && vite build`, plus out-of-band HTTP suites | `package.json`, `src/tests/`, `security-tests/`, `e2e/` |

**Baseline captured before any change** (see §12 of the final report):
`npm test` → 478 passed / 18 skipped, `npm run lint` → 0 errors (156 warnings),
`npm run build` → PASS.

---

## A. Current order lifecycle (verified end-to-end)

```
Guest scans QR  ──►  POST /api/public/tables/qr/:qrToken/verify        (public.ts)
                     │  opaque qrToken must match exactly; tenant/slug hints must agree
                     └─►  POST /api/public/tables/qr/:qrToken/session
                          creates/reuses TableSession { status: ACTIVE, expiresAt: now+6h }
                          returns { sessionToken, sessionId, tableId, tableNumber }

Menu browse      ──►  GET  /api/public/restaurants/:slug   (catalog, offers, tables)
                      GET  /api/public/tables/:tableId/orders?sessionToken=… (own orders only)

Submit order     ──►  POST /api/public/orders
                      • restaurant must be ACTIVE, table must belong to restaurant
                      • QR session must be ACTIVE + unexpired
                      • idempotent by (restaurantId, clientRequestId) – unique index
                      • EVERY price/name snapshot is re-derived from the DB menu
                      • Order created: status=PENDING, paymentMethod='PAY AT CASHIER',
                        paymentStatus='UNPAID'; table → OCCUPIED
                      • SSE: ORDER_CREATED (broadcastToTable)

Kitchen/service  ──►  PUT /api/manager/orders/:id/status   (monotonic PENDING→PREPARING→READY→SERVED)
                      PUT /api/manager/orders/:id/notes | POST /api/public/orders/:id/cancel
                      Waiter calls: POST /api/public/waiter-requests + PUT /api/manager/waiter-requests/:id

Payment          ──►  POST /api/manager/tables/:id/settle      (cashier/manager)
                      POST /api/manager/payments                (cashier/manager, POS ledger)
                      Both: conditional `updateMany({ paymentStatus: 'UNPAID' })` claim inside a
                      transaction → 409 on a lost race, never a duplicate receipt;
                      Payment ledger row (receiptNumber per tenant) + table freed +
                      TableSession CLOSED + waiter calls RESOLVED;
                      SSE: TABLE_SETTLED + PAYMENT_RECORDED.

Closed           ──►  No order-level "closed/archived" concept exists today.
                      TableSession CLOSED is the only session boundary in the system.
```

Orders are never deleted or archived anywhere in the codebase: `Order` rows accumulate
forever, and there is **no `Order.archivedAt`, no business-day model, no purge job**
(`grep -rn "archiv|businessDay|dailyClosing|shift" server/ src/ prisma/` returns nothing
relevant).

## B. Current payment architecture (verified)

* **Method** — `Order.paymentMethod` is a free-form `String` that defaults to
  `'PAY AT CASHIER'` and is overwritten with the ledger method on settlement.
* **Status** — `Order.paymentStatus String @default("UNPAID")`, comment says
  `UNPAID | PAID`. It is a **plain string column, not a Prisma enum**, so extending it is
  additive and backward-compatible. There is no `Payment`-status column: the existence of a
  `Payment` ledger row *is* the proof of settlement.
* **Records** — `Payment` (cashier/POS ledger): `receiptNumber` unique per
  `(restaurantId, receiptNumber)`, `orderIds String[]`, `method`, `subtotal/total`,
  `cashReceived/changeDue/tip`, `cashierId/cashierName`, `branchId`, `createdAt`.
  Records are immutable and are the revenue source of truth for analytics.
* **Cash** — `reconcileCashPayment()` (shared, pure): CASH requires tendered ≥ total + tip,
  change is computed server-side, short payment is rejected.
* **Transfer** — **does not exist anywhere today.** `PAYMENT_METHODS = CASH | CARD | MOBILE | SPLIT`
  (POS input), and nothing in the codebase handles a bank-transfer receipt.
* **Who may confirm payment** — `requireCashierOrManager()`
  (`RESTAURANT_MANAGER`, `CASHIER`; platform roles bypass) on both payment routes.
* **Tenant isolation** — `getTenantId(req)` + `ownTenant(req, id)`; a non-platform caller's
  `restaurantId` (query or body) can never widen access, and `Payment.restaurantId` is written
  from the authenticated tenant, never from the request body.
* **Idempotency / concurrency** — conditional claim + `P2002` receipt retry loop +
  `PAYMENT_RACE` / `SETTLE_RACE` → HTTP 409. `paymentLimiter` (60 / 15 min / IP).
* No SSE event exists for "a payment needs a human decision" — only the post-hoc
  `PAYMENT_RECORDED` / `TABLE_SETTLED` events.

## C. Current storage architecture (verified)

* One abstraction: `StorageService` (`upload/delete/exists/getUrl/keyFromUrl`) with two drivers
  — `LocalStorageDriver` (dev, `./uploads`, fsync'd) and `SupabaseStorageDriver`
  (`restaurant-assets` **public** bucket via the service-role key, server-side only).
* Keys are always **server-generated and tenant-scoped**:
  `restaurants/{restaurantId}/{folder}/{uuid}{ext}` (`buildStorageKey`), folder comes from a
  fixed allow-list, filename is a CSPRNG UUID, `sanitizePathSegment()` strips `/ \ .. NUL`
  → path traversal and cross-tenant collision are structurally impossible.
* Deployment fail-closed: `STORAGE_DRIVER=supabase` without credentials refuses to boot;
  `local` in production refuses to boot unless `STORAGE_ALLOW_LOCAL_IN_PROD=true`.
  Boot probe `verifyStorageReady()` logs readiness.
* Upload security (`.routes/uploads.ts`): multer memory storage, 5 MB cap, `image/*` prefilter,
  `sniffImage()` **magic-byte** validation (PNG/JPEG/WEBP/GIF; SVG deliberately rejected),
  server-derived extension, `uploadLimiter` (60/h/IP), audit trail, and tenant-checked delete
  (`keyBelongsToRestaurant`) that only ever touches the caller's own namespace.
* Local files are served by `express.static('/uploads')` with `nosniff` + sandbox CSP —
  i.e. **everything under the existing storage namespace is effectively public.** A payment
  receipt must not be, so the feature needs a *private* namespace, not another storage system.

## D. Current notification architecture (verified)

* **One** mechanism: SSE at `GET /api/public/events`, dual-authenticated
  (staff JWT `?token=`, or guest `tableId + sessionToken` QR capability), capped globally
  (2000), per tenant (150), per subject (10); heartbeats every 25 s; reconnect handled by
  `openEventSourceWithBackoff()`.
* `RealtimeService.broadcastToRestaurant()` / `broadcastToTable()` — a *table-scoped* broadcast
  reaches that table's guest stream plus every staff stream (staff streams carry no `tableId`).
* Frontend consumption: `RestaurantContext` opens one guest stream and one staff stream and
  fans events into `refreshTenantData()`; known events are `ORDER_CREATED`,
  `ORDER_STATUS_UPDATED`, `ORDER_CANCELLED`, `WAITER_STATUS_UPDATED`, `TABLE_SETTLED`,
  `PAYMENT_RECORDED`.
* UI notifications: the design-system `showToast()` from `RestaurantContext` (no second
  notification centre exists), plus `soundFX` chimes.
* A background `refreshTenantData()` poll (≈10 s in `LiveRestaurantScreen`, longer otherwise)
  already exists as a fallback, so a new event is an *optimisation*, not a dependency.

## E. Current daily / session architecture (verified)

* **Nothing named business day, shift, cashier session, daily closing or archive exists.**
* What *does* exist and is reusable:
  * `TableSession` — per-table, `ACTIVE` → `CLOSED` (closed by settle/payment, 6 h TTL).
  * `Order.createdAt / updatedAt / settledAt` and `Restaurant.timezone` (default
    `Asia/Jerusalem`) with `startOfDayInTimezone(date, tz)` — the project's canonical
    tenant-local-day boundary helper (used by the dashboard).
  * Manual CLI scripts + opt-in in-process intervals (the project's only automation pattern).
* Therefore the smallest mechanism that fits: a **timestamp marker on `Order`
  (`archivedAt`)** computed from the *tenant-local* business-day boundary (with a grace window
  so a venue open past midnight is one session), plus an idempotent retention service and CLI.

---

## Design decision (why this shape fits the existing system)

1. **Extend, don't duplicate.** `Order` already carries `paymentMethod`, `paymentStatus`,
   `settledAt`, `cashierId`; the `Payment` ledger already records money. The feature adds
   *only* the missing operational facts (phone, private proof reference, rejection marker,
   archive/purge markers) and reuses `settledAt`/`cashierId` as
   "paymentVerifiedAt / paymentVerifiedBy" — no duplicate verification columns.
2. **Payment states** reuse the existing string column:
   `UNPAID → PENDING_VERIFICATION → PAID`, and rejection returns the order to `UNPAID` with a
   `paymentRejectedAt` marker. Rationale: every existing collect-path filters
   `paymentStatus: 'UNPAID'`; a fourth collectable state would silently make rejected orders
   uncollectable at the POS. Rejection is therefore *metadata on an unpaid order*, and the
   guest UI derives "rejected" from the marker. No new enum, no duplicated status field.
3. **Storage**: the existing `StorageService` drivers gain a private namespace
   (Supabase private bucket `payment-proofs` by default / `<UPLOAD_DIR>-private` locally,
   **never** served by `express.static`). Same keys, same validation, same tenant scoping —
   the object is reachable only through an authenticated, tenant-checked API route.
4. **Notifications**: reuse the existing SSE stream and `showToast`; add only the two event
   names the workflow needs (`PAYMENT_PROOF_SUBMITTED`, `PAYMENT_PROOF_REJECTED`).
5. **Archival**: `Order.archivedAt` marks "the business session this order belongs to is
   closed". Financial rows are untouched forever; only temporary operational data
   (`customerPhone`, the private proof object) is purged, after an explicit retention window,
   by an idempotent, retry-safe, observable service that refuses to touch orders that are not
   financially closed.
6. **Automation**: an npm script (`retention:cleanup`, dry-run capable) for an external/Render
   cron — the documented project convention — plus an opt-in in-process interval
   (`RETENTION_ENABLED=true`) mirroring the existing `BACKUP_ENABLED` pattern.

## Explicit non-goals (per the requirement)

No customer account, profile, CRM, loyalty, marketing database or customer history; no second
storage system; no second notification system; no `ArchiveOrder`/`ArchivePayment` tables; no
deletion of financial history; no new runtime dependency (Supabase SDK, multer, zod and Node
`crypto` are already used).

---

# Implementation record (what actually shipped)

This section is the as-built record. The analysis above is unchanged: the feature extends the
existing system, it does not replace or duplicate any part of it.

## States (no status explosion)

`Order.paymentStatus` (TEXT, already existed) gains exactly one new mutable value:

```
UNPAID ──upload receipt──► PENDING_VERIFICATION ──cashier confirm──► PAID
   ▲                              │
   └────────cashier reject────────┘        (paymentRejectedAt + reason on the same row)
```

`PAID` still means "settled"; `settledAt` + `cashierId` remain the single source of truth for
when/by whom, and a verified transfer also writes the same immutable `Payment` ledger row the
cash/card flows write, with `method = 'TRANSFER'` (server-produced only — the POS input enum is
unchanged). Rejection deliberately returns the order to `UNPAID`, so every pre-existing collect
query keeps working with zero changes.

## Endpoints (all additive)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/public/orders/:orderId/payment-proof` | QR session capability | multipart `proof` + optional `customerPhone`; `paymentProofLimiter` (30/15min); magic-byte validated; guest never supplies an amount |
| GET | `/api/manager/payment-verifications` | `requireCashierOrManager()` | the verification queue; the ONLY endpoint that returns `customerPhone` |
| GET | `/api/manager/orders/:orderId/payment-proof` | `requireCashierOrManager()` + `paymentProofReadLimiter` (300/15min) | streams private bytes; tenant re-check (`proofBelongsToTenant`), `Cache-Control: private, no-store`, `nosniff` |
| POST | `/api/manager/orders/:orderId/payment/confirm` | `requireCashierOrManager()` + `paymentLimiter` | ONE atomic conditional claim + ledger row; 409 on a lost race |
| POST | `/api/manager/orders/:orderId/payment/reject` | `requireCashierOrManager()` + `paymentLimiter` | discards the object, returns to `UNPAID`, keeps the reason marker |

There is no public URL for a receipt, no signed-URL leak, and no way for a body field to set an
amount, tenant, branch, cashier or status: all of those are derived from the JWT and the database
row.

## Storage layout

```
Supabase (private bucket, default "payment-proofs")
  payment-proofs/restaurant/{restaurantId}/order/{orderId}/{uuid}{ext}

Local driver (default "./private-uploads", never mounted on /uploads)
  <PRIVATE_UPLOAD_DIR>/payment-proofs/restaurant/{restaurantId}/order/{orderId}/{uuid}{ext}
```

Same storage subsystem, same driver abstraction, same magic-byte validation and 5 MB cap as the
public assets; only the destination is private. The bucket is created idempotently at boot with
the service-role key (no manual step); a readiness failure is logged loudly and never blocks
orders or payments.

## Archive vs. purge (what remains / what is removed)

**Remains forever:** order id/numeric id, items, subtotal/tax/total, `paymentMethod`,
`paymentStatus`, `settledAt`, `cashierId`, `archivedAt`, `paymentRejectedAt` +
`paymentRejectionReason`, `retentionPurgedAt`, restaurant/branch/table references, creation and
settlement timestamps, `Payment` ledger rows and audit rows.

**Purged after the retention window:** `customerPhone` → `null`, the private receipt object
deleted, `paymentProofPath` → `null`.

Boundary: the tenant-local day start + `RETENTION_ARCHIVE_GRACE_HOURS` (default 6). A venue open
10:00 → 02:30 keeps ONE session per business day, so an order placed at 02:20 belongs to the
previous business day and is archived with it. Nothing is purged while a receipt is still
awaiting a decision; a re-upload always wins over a pending purge.

Two ways to become purge-eligible, both time-based and idempotent: (A) the order was archived
(settled or cancelled business), (B) the cashier rejected the receipt and the object outlived the
decision — which is how a failed storage delete at decision time is retried instead of leaking a
customer document forever.

## Automation (no platform scheduler is assumed)

- `npm run retention:cleanup` — the portable entry point (also `-- --dry-run`); exit code 1 on a
  partial failure so an external scheduler can alert.
- `RETENTION_ENABLED=true` — opt-in in-process interval (`RETENTION_INTERVAL_HOURS`, default 6h),
  mirroring the existing `BACKUP_ENABLED` pattern for hosts without a cron.
- `render.yaml` intentionally gains no cron job: add one only if the operator wants a guaranteed
  schedule.

## Configuration (all optional; defaults are production-safe)

```
SUPABASE_PRIVATE_BUCKET="payment-proofs"     # private bucket
PRIVATE_UPLOAD_DIR="./private-uploads"       # local driver private dir (never served)
RETENTION_ENABLED="false"
RETENTION_INTERVAL_HOURS="6"
RETENTION_ARCHIVE_GRACE_HOURS="6"
RETENTION_PROOF_HOURS="48"
RETENTION_BATCH_SIZE="500"
```

## Tests added

- `src/tests/payment-proof.test.ts` — phone normalization/validation, zod contracts, private key
  layout & traversal, both drivers' private namespace, upload validation, guest/manager route
  contracts, schema + migration safety (40 tests).
- `src/tests/retention.test.ts` — business-session math, archivability, purge eligibility
  (including the rejected-receipt retry), sweep idempotency/failure-safety contracts (19 tests).
- `src/tests/payment-proof-ui.test.tsx` — rendered guest modal, cashier panel/queue contracts,
  POS integration (pending receipts are not collectable cash) (25 tests).
- `src/tests/payment-proof-flow.integration.test.ts` — DB-gated end-to-end flow (10 tests;
  skipped without `DATABASE_URL`).
