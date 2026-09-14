# Payment Fulfillment Gate — Implementation & Verification Report

**Task:** a customer order must not enter the restaurant's live operational workflow (KDS /
floor / service API) until a cashier has verified and confirmed the payment.

**Branch:** `arena/01a09ee6-restaurantsmureeh` · **Base:** `0ab2b42`
**Deliverable status:** implemented, tested, build-verified; DB-backed manual QA listed as
environment-blocked (see §7.4 and §8).

---

## ملخّص تنفيذي (Arabic executive summary)

أصبح دفع الطلب **بوابة إلزامية** قبل دخول الطلب إلى المطبخ:

1. الزبون يرسل الطلب → الطلب يُنشأ بحالة `AWAITING_PAYMENT` ولا يظهر في المطبخ.
2. الزبون يرسل إشعار التحويل (الاسم + الهاتف + صورة الإشعار) → `PAYMENT_VERIFICATION_PENDING`
   ويظهر فوراً عند الكاشير.
3. الكاشير يؤكد → الدفع `PAID` والطلب يُفرج عنه للمطبخ (`RELEASED`) **في نفس المعاملة**، ويظهر
   في شاشة المطبخ لحظياً بدون تحديث يدوي.
4. الكاشير يرفض → `PAYMENT_REJECTED`، الطلب يبقى خارج المطبخ، والزبون يرى سبب الرفض ويمكنه
   إرسال إشعار جديد أو الدفع نقداً عند الكاشير (التحصيل عند الصندوق يفرج عن الطلب أيضاً).

كل الانتقالات تُنفَّذ على الخادم فقط، وكل شاشة تعتمد على القيمة المشتقّة من الخادم
(`operational` / `fulfillmentState`)، ولا يوجد أي مسار يقبل حالة من جسم الطلب.

---

## 1. Root cause analysis

The lifecycle previously relied on `paymentStatus` alone (`UNPAID | PENDING_VERIFICATION | PAID`)
plus a *client-side* KDS filter:

| # | Defect | Consequence |
|---|--------|-------------|
| 1 | A guest order was created as an operational order (`ORDER_CREATED` broadcast, `status=PENDING`, no hold) | the KDS received a ticket the instant the guest submitted, before any money was verified |
| 2 | The only protection was `KitchenDisplaySystem` filtering `PENDING + PENDING_VERIFICATION` in the browser | a crafted/stale client, the live floor screen, and `PUT /orders/:id/status` all stayed open — the server had no authorization boundary |
| 3 | "Paid" and "may be cooked" were the same axis | a rejected receipt returned to `UNPAID` (correct for money) but nothing recorded *why* the kitchen must not have the order, and a POS staff order (money at the counter) could not be distinguished from an unverified guest order |
| 4 | No terminal release marker | a receipt uploaded mid-cooking risked re-holding a ticket the kitchen had already started ("vanishing ticket") |
| 5 | Confirmation and kitchen state were conflated | confirming a transfer rewrote the order's kitchen status, so a paid-but-not-started order could be marked `SERVED` without ever being cooked |

Fix: a dedicated, server-owned **fulfillment gate** (`Order.fulfillmentState`) that answers only
"may the restaurant execute this order?", written in the same transaction as the payment claim,
with every screen and the service API derived from it.

## 2. Architecture changes

```
guest order ──► AWAITING_PAYMENT ──(receipt)──► PAYMENT_VERIFICATION_PENDING
   (held)              │                                   │
                       │                      cashier confirm│   cashier reject
                       │                                   ▼            ▼
                       │                               RELEASED   PAYMENT_REJECTED
                       │                                   ▲            │ (guest may retry)
                       └────── cash/POS collection ─────────┘◄───────────┘
                       └────── POS staff order ─────────────►RELEASED (money at the counter)
```

* **Single policy module** — `server/services/orderLifecycle.ts` (142 lines): the four states,
  the narrow transition table (`RELEASED` is terminal; `AWAITING_PAYMENT` cannot be rejected),
  `normalizeFulfillmentState` (unknown/NULL → `RELEASED`, so a pre-gate row or an older process
  can never be stranded), `isOperational` / `isHeldForPayment`, and `releaseFields(now)` — the
  *only* thing that may open the gate, returned as an object spread into the payment's own
  statement/transaction.
* **One predicate on the wire** — `GET /manager/orders` emits both the stored `fulfillmentState`
  and the derived `operational` flag; the client mirror (`src/utils/orderLifecycle.ts`, 84 lines)
  prefers the server flag, then the stored state, then the pre-gate rule (legacy payload),
  so a rolling deploy never blanks or over-fills the KDS.
* **Server-enforced boundary** — `PUT /orders/:id/status` returns 409 for any held order (except
  `CANCELLED`), so a stale bundle or a crafted request cannot start/plate/serve unverified work.
* **No new infrastructure** — plain TEXT column (same convention as `paymentStatus`), existing
  Express routes, existing SSE registry, existing audit service, existing private storage.

## 3. Database changes

`prisma/schema.prisma` (`Order`):

```prisma
fulfillmentState String   @default("RELEASED")   // AWAITING_PAYMENT | PAYMENT_VERIFICATION_PENDING | PAYMENT_REJECTED | RELEASED
releasedAt       DateTime?
@@index([restaurantId, fulfillmentState])         // operational set + cashier awaiting list
```

Migration `prisma/migrations/20260914180000_add_order_fulfillment_gate/migration.sql`
(38 lines, applied by `prisma migrate deploy` via `npm run db:migrate`):

* `ADD COLUMN IF NOT EXISTS "fulfillmentState" TEXT NOT NULL DEFAULT 'RELEASED'`
* `ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3)`
* backfill `releasedAt = COALESCE("settledAt","createdAt")` **only** for `NULL` rows that are
  already `RELEASED` (legacy rows were operational before the gate: no financial value changes)
* `CREATE INDEX IF NOT EXISTS "Order_restaurantId_fulfillmentState_idx"`

Purely additive, idempotent (`IF NOT EXISTS`, same convention as `20260914120000`), reversible
(drop the index / column), data-preserving (no `DROP`, no `DELETE`, no type/enum DDL, no data
mutation beyond the nullable backfill). Existing `[restaurantId, paymentStatus]` index untouched.
Executed inside Prisma's per-migration transaction; no `CONCURRENTLY`/non-transactional statement.

## 4. API changes (existing endpoints extended, none invented)

| Endpoint | Change |
|---|---|
| `POST /api/public/orders` | both allocation sites write `fulfillmentState=AWAITING_PAYMENT`, `releasedAt=null`; broadcast is now `ORDER_AWAITING_PAYMENT` (no `ORDER_CREATED`); audit `CUSTOMER_ORDER_CREATED` + gate metadata |
| `POST /api/public/orders/:id/payment-proof` | gate → `PAYMENT_VERIFICATION_PENDING` **only while held** (a receipt during cooking never re-holds a live ticket); audit `PAYMENT_PROOF_SUBMITTED` + `paymentEvent: 'PAYMENT_SUBMITTED'` |
| `GET /api/public/tables/:id/orders` | tracker payload adds normalized `fulfillmentState` + `releasedAt`; never exposes proof path or phone |
| `POST /api/public/orders/:id/cancel` | 409 when `PAID`/`PENDING_VERIFICATION`; CAS `updateMany` now also requires `paymentStatus=UNPAID` (loses the race against a cashier confirmation) |
| `GET /api/manager/orders` | optional `?operational=true\|false`; every row adds `fulfillmentState`, `operational`, `releasedAt` |
| `PUT /api/manager/orders/:id/status` | 409 while the order is held (server-side gate) |
| `POST /api/manager/orders/:id/payment/confirm` | conditional claim → `PAID` + `...releaseFields(now)` + `settledAt` + `cashierId` in one statement/tx (kitchen status untouched, receipt in the same tx); lost race with a `PAID` row → `200 {payment, alreadyConfirmed:true, kitchenReleased}`; any other race → 409 |
| `POST /api/manager/orders/:id/payment/reject` | → `UNPAID` + `PAYMENT_REJECTED` + reason, proof object deleted first |
| `GET /api/manager/payment-verifications` | `?include=awaiting\|all` adds `AWAITING_PAYMENT`/`PAYMENT_REJECTED`; every row adds `state` (`WAITING_VERIFICATION` \| `WAITING_RECEIPT`) + `fulfillmentState` + `paymentRejected(Reason)` |
| `POST /api/manager/tables/:id/settle`, `POST /api/manager/payments` | bill split into `closingOperational` (close as before) and `releasedByCollection` (gate opens + `PAID`, kitchen status stays `PENDING` → fresh ticket); summed conditional claim → `SETTLE_RACE`/`PAYMENT_RACE` 409 |
| `POST /api/manager/orders` (POS) | staff order released at creation (`releaseReason: STAFF_ORDER`, money taken in person) |

Tenant/role rules unchanged: every path resolves the order through `getTenantId(req)` +
`ownTenant(...)` / `resolveTenantOrder(...)`; the gate value is never read from `req.body`.

## 5. Event changes (existing SSE layer)

| Event | Audience | Meaning |
|---|---|---|
| `ORDER_AWAITING_PAYMENT` *(new)* | guest (own table) + staff (tenant) | order created, **not** a kitchen ticket; cashier/manager get a toast, the kitchen gets no chime |
| `PAYMENT_PROOF_SUBMITTED` | staff (existing) | receipt queued for verification |
| `ORDER_RELEASED_TO_KITCHEN` *(new)* | guest + staff | payment verified / collected — the KDS ticket appears now; guest toast «تم تأكيد الدفع، وجارٍ تجهيز طلبك.»; kitchen chime only while the order is still `PENDING` |
| `PAYMENT_PROOF_VERIFIED` / `ORDER_STATUS_UPDATED` (`kitchenReleased`) | existing | kept for backwards compatibility with current clients |
| `PAYMENT_PROOF_REJECTED` | guest + staff (existing) | receipt refused; order stays out |

`order.created` is never published as a kitchen-operational event on guest submission (verified by
test: the create block contains no `'ORDER_CREATED'`). Audit records:
`PAYMENT_PROOF_SUBMITTED` + `paymentEvent:'PAYMENT_SUBMITTED'`, `PAYMENT_VERIFIED` +
`paymentEvent:'PAYMENT_CONFIRMED'` + **`ORDER_RELEASED_TO_KDS`**, `PAYMENT_REJECTED`
(the required names are recorded as the explicit `paymentEvent` metadata on the established
action rows — one audit row per event, no duplicated/parallel taxonomy).

Required guest copy is in the shipped UI: «تم إرسال طلبك، يرجى تأكيد عملية الدفع لإتمام الطلب.» →
«تم إرسال إشعار التحويل، الطلب بانتظار التحقق من الدفع.» → «تم تأكيد الدفع، وجارٍ تجهيز طلبك.»

## 6. Security review

* **Server-side authority** — the gate is written only by the four server paths above; request
  schemas (`server/validation/schemas.ts`) contain no `fulfillmentState` / `releasedAt` /
  `operational` field (asserted by test) and `validateBody` strips unknown keys.
* **Client status never trusted** — order create/confirm/reject/POS paths derive every value
  (prices, tenant, cashier id, money state, gate) from the session/JWT and the database.
* **Tenant isolation & IDOR** — confirm/reject/queue/proof-read all resolve the order against the
  caller's tenant (`resolveTenantOrder`, `ownTenant`), receipts remain in the private namespace
  (`proofBelongsToTenant`) and are streamed through `GET /orders/:id/payment-proof` after a
  cashier/manager + tenant check (403 audit on failure).
* **Receipt privacy** — guest payloads carry booleans/state only (`hasPaymentProof`,
  `paymentRejected`, `fulfillmentState`); no storage key, no phone; the queue remains the only
  surface that returns the guest phone, restricted to `requireCashierOrManager()`.
* **Race & idempotency** — one conditional `updateMany` per decision (double-confirm → exactly one
  201, replayed confirmation → 200 `alreadyConfirmed`, no second receipt); cancel CAS vs confirm;
  receipt-number collisions retried under `P2002` inside the same transaction; money and gate can
  never diverge (single statement).
* **No new attack surface** — no new endpoints, no new auth mechanism, no public URLs, no Redis/queues.

## 7. Tests + results

### 7.1 Commands run (this checkout)

| Command | Result |
|---|---|
| `npx vitest run` | **630 passed / 1 failed / 27 skipped** (40 files: 38 passed, 1 failed, 1 skipped) |
| `npx tsc -b` | pass |
| `npm run build` (`tsc -b && vite build`) | pass (§8 note on the pre-existing chunk-size warning) |
| `npm run lint` (oxlint) | **0 errors**, 156 warnings — identical to the pre-change baseline (no new warnings) |
| `npx tsc -p tsconfig.server-check.json` | 107 diagnostics vs 100 at baseline (`git worktree` of HEAD); **every extra diagnostic reuses a baseline message** (implicit-`any` params / `string\|string[]` unions caused by the unavailable generated Prisma client), no new error class, no runtime impact |
| `npx vitest run --config e2e/vitest.guard.config.ts` | fails identically on HEAD (`@testing-library/react` not installed) — harness-only, pre-existing |

Baseline before the change: 580 passed / 1 failed / 27 skipped → **+50 new tests, 0 regressions**.

### 7.2 New suite — `src/tests/fulfillment-gate.test.ts` (49 tests)

State machine (4 states, unknown→`RELEASED`, `RELEASED` terminal, `AWAITING_PAYMENT` cannot be
rejected, idempotent repeats, `releaseFields`), client-mirror precedence + legacy fallback +
filters (never resurrecting `CANCELLED`), schema/migration additivity + newest-migration ordering,
both guest create sites + `ORDER_AWAITING_PAYMENT` (and the absence of `'ORDER_CREATED'`), cancel
freeze, confirm claim/idempotent replay/audits, reject, till-collection split + race codes, KDS /
floor / POS / cashier-panel filtering, API shape, required Arabic copy, receipt privacy, and an
8-step executable walkthrough of the manual QA scenarios.

### 7.3 Updated pre-existing suites (deliberate re-pinning, not silencing)

* `payment-proof-ui.test.tsx` — 37 tests, now pins the gate helpers (`isOrderOperational`,
  `heldForPayment.length`, queue `include=awaiting`, `URLSearchParams`), the new modal/tracker
  copy, and the KDS "started tickets stay visible" invariant at runtime.
* `cashier-payment.test.ts` — race test now pins the summed `claimedCount` claim (two conditional
  halves) instead of the previous single claim literal.
* `payment-proof.test.ts`, `release-gate.test.ts`, `retention.test.ts`,
  `pos*.test.ts`, `security-remediation.test.ts`, `order-legacy-null-compatibility.test.ts` —
  unchanged and still green (confirms POS, waiter calls, table sessions, QR menus, subscriptions,
  admin, SSE and the pre-gate transfer flow keep working).

### 7.4 Environment limitations (honest status)

* `prisma generate` / `prisma validate` / `prisma migrate deploy` cannot run here: the sandbox
  cannot reach `binaries.prisma.sh` (TLS) and no engine binary exists anywhere on the image.
  Therefore the **only** test failure is `production-hardening.test.ts`, which imports
  `server/db/prisma.ts` at module scope and fails with *"@prisma/client did not initialize yet"* —
  it fails identically at the base commit (pre-existing environment blocker, not a regression).
  Migration validation in this environment is static (SQL + schema inspection + tests); the
  commands to run where a database exists are listed in §9.
* No Postgres/docker in the sandbox → the DB-gated integration suite and the live manual browser
  scenarios could not be executed here; they are encoded as the executable walkthrough in
  §7.2 and as the checklist in §9.

## 8. Remaining risks & limitations

1. **Legacy payloads during a rolling deploy** — an old server sends no gate fields; the client
   then applies the pre-gate rule (`PENDING_VERIFICATION` hidden, everything else shown). Safe but
   not identical to the new semantics until both sides are deployed.
2. **`AWAITING_PAYMENT` orders with no receipt** — visible to the cashier only in the info list
   (`?include=awaiting`); they must be collected at the till to be released. This is by design
   (a guest may pay cash), but it does mean an abandoned order can sit held indefinitely; the
   existing archiving/retention sweep is unaffected and keeps cleaning them up.
3. **Cash settlement of held orders** keeps `status=PENDING` (correct: never cooked) and closes the
   table — the ticket appears as a new KDS ticket on a now-`AVAILABLE` table; operators should
   treat a fresh ticket after settlement as expected. No functional impact.
4. **Migration not executed here** (see §7.4). It is additive/idempotent; run `npm run db:migrate`
   in a staging database first, then verify `SELECT "fulfillmentState", count(*) FROM "Order"
   GROUP BY 1;` before production.
5. **Receipt object deletion on reject is best-effort** — if storage refuses, the DB pointer is kept
   so the retention sweep retries it (unchanged pre-existing behaviour).
6. **`tsconfig.server-check.json` diagnostics** — the 107 diagnostics are artefacts of the stub
   Prisma client; re-run in CI (with a generated client) to get a clean server type-check.

## 9. Files changed

**New**

| File | Purpose |
|---|---|
| `server/services/orderLifecycle.ts` | gate policy: states, transitions, predicates, `releaseFields` |
| `src/utils/orderLifecycle.ts` | client mirror (server flag → state → legacy rule) |
| `prisma/migrations/20260914180000_add_order_fulfillment_gate/migration.sql` | additive migration + index + backfill |
| `src/tests/fulfillment-gate.test.ts` | 49 gate tests incl. executable manual scenarios |

**Modified**

| File | Change |
|---|---|
| `prisma/schema.prisma` | `fulfillmentState`, `releasedAt`, `[restaurantId, fulfillmentState]` index |
| `server/routes/public.ts` | create gate + `ORDER_AWAITING_PAYMENT`, tracker fields, proof-upload gate, cancel freeze, audit metadata |
| `server/routes/manager.ts` | `?operational`, POS release, status guard, settle/payments split + race codes, confirm (claim + idempotent replay + audits + `ORDER_RELEASED_TO_KITCHEN`), reject, queue `state`/`include`, POS audit metadata |
| `server/services/paymentProofs.ts` | guest proof view returns normalized `fulfillmentState` |
| `src/types/restaurant.ts` | `FulfillmentState`, order gate fields, queue `state`/`paymentRejected` |
| `src/services/api.ts` | gate mapping, `getManagerOrders({operational})`, `getPaymentVerifications({includeAwaiting})`, `alreadyConfirmed`, reject gate |
| `src/context/RestaurantContext.tsx` | mandatory payment step (`paymentStepOrder`/`orderAwaitingPayment`/`dismissPaymentStep`), SSE handlers + toasts/chimes for the two new events |
| `src/components/customer/CustomerLayout.tsx` | renders the payment step modal from the context |
| `src/components/customer/OrderTrackingDrawer.tsx` | gate-driven banners/buttons + required copy |
| `src/components/customer/TransferPaymentModal.tsx` | required copy + "no kitchen before confirmation" clause |
| `src/components/manager/KitchenDisplaySystem.tsx` | renders only `isOrderOperational` tickets, held count banner |
| `src/components/manager/LiveRestaurantScreen.tsx` | same predicate for the floor |
| `src/components/manager/PaymentVerificationPanel.tsx` | "Payment Verification" vs "awaiting guest payment" groups, `include=awaiting` |
| `src/components/manager/CashierPOSView.tsx` | waiting-for-payment hint (POS already excludes verification-pending) |
| `src/tests/payment-proof-ui.test.tsx`, `src/tests/cashier-payment.test.ts` | re-pinned to the new contracts |

## 10. Acceptance checklist

| Requirement | Status | Evidence |
|---|---|---|
| Explicit state machine; `PAYMENT_VERIFICATION_PENDING` never treated as confirmed | ✅ | `orderLifecycle.ts` + §7.2 policy tests |
| Server-side-only transitions | ✅ | §4 routes; client cannot send the gate; `PUT /status` 409 |
| Phone validated server-side (never trusted) | ✅ | existing `normalizeCustomerPhone` in the proof path (unchanged, reused) |
| Receipt upload: existing storage, private namespace, MIME + magic bytes, size limit, no path traversal, tenant isolation, no unauthorized access | ✅ | existing `paymentProofs`/storage reused; privacy assertions in §7.2 |
| Idempotent transactional confirm; concurrent double-confirm → exactly one success | ✅ | single conditional claim + `alreadyConfirmed` replay |
| Race/duplicate/refresh/reconnect consistency | ✅ | CAS everywhere, SSE + refetch (no polling), `ORDER_RELEASED_TO_KITCHEN` idempotent by state |
| Prisma transactions; payment and order status never diverge | ✅ | `releaseFields(now)` spread inside the payment claim statement |
| Audit: PAYMENT_SUBMITTED / CONFIRMED / REJECTED / ORDER_RELEASED_TO_KDS | ✅ | actions + explicit `paymentEvent` metadata (`ORDER_RELEASED_TO_KDS` is its own action) |
| Distinct SSE events; `order.created` not kitchen-operational at submission | ✅ | `ORDER_AWAITING_PAYMENT` vs `ORDER_RELEASED_TO_KITCHEN`; no `'ORDER_CREATED'` in the guest create path |
| KDS never renders unverified/rejected orders | ✅ | KDS + floor predicates; server `?operational` filter; `PUT /status` guard |
| Arabic UX copy (three required strings) | ✅ | context/tracker/modal tests |
| Cashier queue separates Verification vs Confirmed/Awaiting | ✅ | `state` field + two groups in the panel |
| No duplication of payment/order-status/upload/SSE/auth/tenant systems | ✅ | extended existing modules only |
| Extend existing endpoints, no new APIs/infrastructure | ✅ | §4 |
| Normalized schema + justified indexes | ✅ | §3 |
| Proper migration (no `db push`), reversible, data-preserving | ✅ | §3 (execution pending a DB, §7.4) |
| Unrelated features/branding/auth/deployment untouched | ✅ | only gate-related files changed; POS/waiter/sessions/QR/subscriptions/admin green |
| TS checks, lint, tests, build, migration validation, manual scenarios | ⚠️ | tests/lint/tsc/build verified; migration + live manual QA blocked by the sandbox (no DB, no Prisma engine) — commands below |
| 9-part report + checklist | ✅ | this document |

### Commands to finish verification where a database exists

```bash
npx prisma validate                     # schema well-formed
npm run db:migrate                      # applies the gate migration (npm start does the same)
psql "$DATABASE_URL" -c 'SELECT "fulfillmentState", count(*) FROM "Order" GROUP BY 1;'
npx vitest run src/tests/payment-proof-flow.integration.test.ts   # DB-gated suite
npx vitest run                          # expect 0 failures (production-hardening included)
npm run lint && npm run build
```

Manual QA (browser, two devices): submit → absent from KDS; upload receipt → queue row; confirm →
ticket appears without refresh + guest toast «تم تأكيد الدفع، وجارٍ تجهيز طلبك.»; reject → stays out
+ guest banner; double-confirm → one receipt + `alreadyConfirmed`; confirm while cancelling → one
winner; cash-collect a held bill at the POS → fresh KDS ticket.
