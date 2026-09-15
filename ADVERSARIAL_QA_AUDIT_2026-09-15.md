# ADVERSARIAL QA · SECURITY · SRE AUDIT — 2026-09-15

**Target:** `bossbaraka/restaurantsMureeh` — MÉRAR multi-tenant restaurant SaaS (commercial-release candidate)
**Baseline:** HEAD `6574a5c` (merge PR #36), audited branch `arena/01a0a609-restaurantsmureeh`
**Auditor role:** Principal QA Engineer + Security Engineer + SRE (hostile-review posture)
**Companion artifact:** `QA_ARCHITECTURE_MAP_2026-09-15.md` (produced first, per protocol)

> **Position statement.** This report treats prior in-repo audit reports, the README, and the test
> suite as *historical evidence, not proof*. Every claim below was re-verified against the current
> code and carries a file:line citation valid at `6574a5c`. Where a prior report says "fixed", the
> table in §3 records what the code actually does today. Nothing in this audit modified source code
> (RULE 1); the remediation roadmap in §7 is a *proposal* pending sign-off.

---

## 1) Scope, method, and hard limits of the evidence

**Covered (static, full-file reads):** Express bootstrap/config/middleware/all five route files
(`public.ts` 1605 LOC, `manager.ts` 3952 LOC, `auth.ts` 433, `admin.ts` 535, `uploads.ts` 240),
all services (`orderLifecycle`, `paymentProofs`, `plans`, `realtime`, `retention`, `storage/*`,
`audit`, `subscriptionLifecycle`, `utils/security|phone|datetime`), Prisma schema (586 lines,
15 models) + migration history, validation schemas (991 LOC), frontend core (`api.ts` 1796,
`AuthContext`, key parts of `RestaurantContext` 1885, `sse.ts`, entry orchestrator), key customer /
manager components (POS checkout, KDS, order management, waiter modal, payment verification),
deploy configs (`Dockerfile`, `render.yaml`, `docker-compose.yml`, `netlify.toml`, `vercel.json`),
CI (`.github/workflows/`, `docs/ci`), e2e/security test harnesses, and all historical reports.

**Verified dynamically in-sandbox:** `npm ci`, `npx vitest run` (649/650 passing — the one failure is
an environment artifact: `@prisma/client` engines cannot download here, `binaries.prisma.sh` is
network-blocked), `npx tsc -b` clean, `npx oxlint` 0 errors / 138 warnings, `npm run build` OK.

**NOT verifiable in this sandbox — confidence noted accordingly:**
1. **No PostgreSQL**: no live integration/E2E (`e2e/employee-functional-test.mjs`, `preview:gate`,
   `security-tests/api-security-smoke.mjs` all require a disposable DB). DB-concurrency claims
   (CAS transitions, partial unique indexes, transaction blocks) are verified *by code reading*,
   not by execution.
2. **No deployed environment**: headers/CSP/CORS behavior at the edge (Render fronting, Supabase
   storage) is judged from config files, not curl probes.
3. **Git history**: the purge of the old Supabase DB password from history remains an *operator*
   action (per `SECURITY_REMEDIATION_2026-09-09.md`); this sandbox cannot confirm the remote's
   history. Current tree is clean (C-01/C-02 re-verified).

**Tooling baseline (measured):** 677 tests (649 pass / 27 skip / 1 env-fail) · tsc clean ·
oxlint 0e/138w · build OK with a single 964.20 kB chunk (241.68 kB gzip).

---

## 2) Executive verdict

The codebase has genuinely absorbed three prior remediation waves (2026-09-07/08/09) and a payment-gate
hardening wave (2026-09-14): the historical criticals are **fixed in-tree**, tenant isolation is
consistently enforced per-route via `ownTenant()`, the payment-fraud class (unverified orders reaching
the kitchen) is closed server-side, authN re-validates against the DB on every request, and upload/
storage handling is defensively solid (magic-bytes on write *and* read).

It is **not release-ready** as-is. Three HIGH findings remain open, all in the operational/access-control
plane rather than in crypto or injection:

| # | Finding | Status |
|---|---|---|
| **H-01** | `qrToken` capability tokens are returned to **every** staff role via `GET /api/manager/tables` — the codebase's own design comment forbids exactly this on the public side | **OPEN** (historical M-01, severity re-evaluated upward) |
| **H-02** | Staff have **no order-cancellation and no payment-reversal path** anywhere (API or UI), while the schema, UI tabs and enum pretend one exists | **OPEN** (new) |
| **H-03** | KDS/POS/floor screens silently render only the **50 newest orders** (pagination default the client never overrides) — active orders older than the window become kitchen-invisible | **OPEN** (new) |

Plus 8 MEDIUM and 13 LOW/INFO items (§5–6), and a set of operator-run actions pending from the
previous remediation (history purge, secret rotation, cron wiring — §3, §6.4). Recommended gate:
**fix H-01/H-02/H-03 and M-4, M-6 before commercial onboarding of real tenants.**

---

## 3) Re-verification of historical findings (evidence vs. claims)

Legend: ✅ fixed-in-code · 🟡 partial · ❌ still open · ⚠️ operator-pending (not a code defect)

| Prior ID | Title | Verdict today | Current-code evidence |
|---|---|---|---|
| C-01 | Secrets committed in tree / `scratch/` | ✅ in tree · ⚠️ history purge is operator-pending | no `scratch/`, `.env.example` placeholders only; gitleaks workflow present (`.github/workflows/secret-scan.yml`) |
| C-02 | `Password123!` shipped credentials | ✅ | no literal anywhere in tracked tree; seed enforces strong env passwords (`server/db/seed.ts`, `assertStrongSeedPassword`) |
| C-03 | Destructive boot (db push/seed at startup) | ✅ | `package.json`/`Dockerfile` boot = `deploy-migrations.ts` → `prisma migrate deploy` only; demo seeds double-gated (`ALLOW_DEMO_SEED=1` **and** non-production). Note: `npm run db:push` still exists as a manual script — L-13 |
| H-04 | Stored branding injection (promo video / images) | ✅ | `brandingSchema` YouTube-allowlist (`isAllowedPromoVideoUrl`), asset-reference contract (`storage/resolve.ts`), embed-block on save (`api.ts`) |
| H-05 | No cash reconciliation at settle | ✅ | `tableSettleSchema` + pure `reconcileCashPayment` (CASH requires tendered ≥ total+tip; server-computed change) (`utils/security.ts`) |
| M-01 | Manager reads not role-gated; `qrToken` over-exposure | ❌ **OPEN → elevated to H-01** | `manager.ts:201` (`router.use(requireAuth)`), `:812` GET /tables (no role gate), `:837` (`qrToken: t.qrToken`) |
| M-02 | No pagination; unbounded in-memory aggregation; 1.5 s polling | ✅ (pagination/aggregation) · 🟡 residual H-03 | `parsePagination` caps (take ≤ 100, default 50) applied to `/manager/orders` (`manager.ts:375-415`); dashboard KPIs now SQL-aggregated + entitlement-gated (`manager.ts:208-260`); polling now 10 s (`RestaurantContext.tsx:590-602`) |
| M-03 | Uploads stored/returned as base64 data URIs | ✅ | object-storage pipeline + sniffing + `assetReference` contract; client blocks `data:` persistence |
| M-04 | SSE cap global only | ✅ | per-global/tenant/subject caps (`services/realtime.ts`) + `sseConnectionLimiter` |
| M-05 | Sequential guessable order ids | 🟡 still present (mitigated ceiling) | manual allocator with `MAX_ALLOCATABLE_NUM` clamp still in `public.ts:923-945`, `manager.ts:586-608` despite schema `@default(autoincrement())`; ids remain tenant-sequential |
| M-06 | `/auth/login` as PIN oracle | 🟡 bounded but open | dedicated PIN path has `pinLimiter` (10/15 min, failures counted); the PIN-swap scan inside `/auth/login` still parallel-bcrypts all tenant PIN holders per attempt (`auth.ts:340-370`) under only `loginLimiter` (20/15 min) |
| M-07 | No account lockout / MFA / working reset | ❌ mostly open (LOW-MED) | server-side *per-IP* limiters only; no per-account failure counter; `POST /auth/password-reset-request` returns 501 by design (`auth.ts:417-433`) |
| M-08 | Audit log lacks IP, no integrity/retention | 🟡 partial | `ipAddress` now recorded (`services/audit.ts`), user-agent absent, no integrity chain, no `AuditLog` retention policy |
| M-09 | `/api/health` fingerprints; SPA masks API 404s | ✅ | health is minimal (`index.ts:224-232`); API-miss 404 guard before SPA fallback (`index.ts:234-` ) |
| UX P0s (2026-09-11) | pinch-zoom blocked; waiter-call optimistic success; hardcoded "12–18 min"; manager tab before role | ✅ all | `index.html` documents unblocked zoom; `WaiterCallModal.tsx:81-93` success only after server ack; no estimate literal in src; role-based initial tab (`ManagerLayout.tsx:85-93`) |
| Payment-gate wave (2026-09-14) | confirm/reject 400s; kitchen-before-payment | ✅ | opcode `restaurantId` tolerated in strict schemas; `fulfillmentState` gate enforced in status transitions (`manager.ts:741-749`) and KDS filters on `operational` |
| C-05/DESIGN_QA items | — | ✅ covered above | — |

**Distrust check on the strongest historical defense — the security smoke suite**
(`security-tests/api-security-smoke.mjs`): it is genuinely adversarial (tenant-tamper probes,
removed-backdoor probes, token-redaction hygiene, mutation opt-in), but it requires a live disposable
instance; it was *not run* here, and it does **not** assert the H-01 invariant (it checks "Zero Tenant-B
bytes", not "role-inappropriately-shaped payload within Tenant-A").

---

## 4) HIGH findings

### H-01 — `qrToken` table capability exposed to every staff role (RBAC/BOPLA) — **OPEN**

**Evidence.**
`server/routes/manager.ts:201` mounts `requireAuth` for the entire router; `GET /tables`
(`:812-848`) has no role gate and returns `qrToken: t.qrToken` (`:837`) for **all** tables to
**any** authenticated staff role — WAITER, KITCHEN, CASHIER, STAFF.
The frontend fetches this for every logged-in user on load and **every 10 seconds**
(`RestaurantContext.tsx:421-440`, interval at `:597-601`).

**Why this is HIGH, not MEDIUM.** The codebase itself defines the threat model:
`public.ts:436-439` — *"qrToken is an opaque capability; publishing every table's token on a
public endpoint would let any guest enumerate and 'scan' any table without the physical card."*
Posture on the public side is correct (tokens omitted). But the *manager* endpoint leaks the same
capability to the least-privileged principals, and possession of `qrToken` is the *sole* credential
for anonymous guest capabilities:

- mint a 6-hour `TableSession` (`public.ts:518-530`, session expiry `:574`): place QR-gated orders,
  call waiters (`public.ts:1506+`), open the table's SSE stream (`public.ts:121,188-193`);
- observe a table's live order stream (`public.ts:637+` — session binding requires token+tableId,
  both of which the staff payload provides together);
- **bypass attribution**: those actions are attributable only to an anonymous session, not a staff
  account — the audit log records staff actions by user; guest actions are unattributed.

Blast radius: a single kitchen-staff JWT (weakest credential class, shared-device PIN culture)
yields every table's persistent secret; rotation exists (`POST /tables/:id/regenerate-qr`,
manager-only) but rotates *per printed card* and breaks all printed tents if done defensively.
A crafted-order is blunted by the payment gate (fake QR orders land in the cashier's
"awaiting payment" queue, never in KDS — verified `orderLifecycle.ts`), but waiter-spam,
table surveillance and audit-evasion are unblunted.

**Recommended remediation (proposed, not applied):** strip `qrToken` from the `/tables` list
payload (roles ≤ STAFF never need it); expose it only in a manager-only per-table endpoint or the
existing QR-management view; rotate on print. Regression test: staff-role GET /tables response must
contain no `qrToken` key.

### H-02 — No staff order-cancellation / payment-reversal path (business-logic dead-end) — **OPEN (new)**

**Evidence.** The staff status machine is `PENDING→PREPARING→READY→SERVED`, enforced server-side
by `nextStatus` (`manager.ts:754-770`) with CAS update; **no transition to `CANCELLED` exists for
staff** — `OrderStatus.CANCELLED` is unreachable via `PUT /manager/orders/:id/status` (the guard at
`:741` even anticipates CANCELLED and the map rejects it). Guest cancel (`public.ts:1101+`) is
restricted to `PENDING` + unpaid + owning session. `POST /manager/payments` marks PAID; there is
**no void/refund endpoint**. UI mirrors the void: `OrderManagement.tsx:142` renders a "الملغية"
(Cancelled) tab showing only guest-cancelled orders; no cancel button exists on any staff card
(`:324-360`).

**Impact.** Real venues produce error orders daily (wrong table, walk-outs after PREPARING,
double-entry). Today the only closure for a staff-entered mistake is to *settle it as paid* —
fabricating revenue in analytics/exports — or leave the table's session and open orders dangling
forever (blocking settlement flow and session cleanup). There is also no way to reverse an
erroneously confirmed transfer receipt; a cashier misclick on "confirm payment" is permanent.

**Recommended remediation:** add `CANCELLED` transitions for requireCashierOrManager (`PENDING`,
`PREPARING` → `CANCELLED`; NEVER from `SERVED`/`PAID` without a compensating void), a
payment `VOID` action writing an audit event + zeroing open-amount semantics, and UI affordances;
specify settlement/archival behavior for cancelled orders up-front. This is a data-integrity
feature, not merely UX.

### H-03 — Staff operational screens silently truncate to the 50 newest orders — **OPEN (new)**

**Evidence.** `GET /api/manager/orders` applies `parsePagination` (`manager.ts:382`) with
**default take = 50** (`utils/security.ts`) ordered `createdAt desc` (`manager.ts:412-413`).
The frontend `getManagerOrders` passes only `restaurantId` — no limit, no `operational` filter,
no pagination UI (`src/services/api.ts`); `refreshTenantData` fills the *single* `orders` array
consumed by KDS (`KitchenDisplaySystem.tsx:24-`), OrderManagement, POS open-bill logic
(`CashierPOSView.tsx:244+`), and the Live screen. Server-side filters exist (`operational=true|false`,
`manager.ts:385-395`) but **no client uses them**.

**Impact.** A venue with >50 orders since an order's creation (a busy shift: walk-ins + cancels
count) pushes any untouched active order off the window: it vanishes from the kitchen, the floor,
*and* the cashier's open-bill aggregation for that table — while the guest's tracker (session-scoped,
un-capped, `public.ts:655-668`) still shows it. Silent operational loss; no UI indicator signals
truncation. The 10-second polling loop faithfully refreshes the same truncated window.

**Recommended remediation:** server-side status-scoped queries per screen (KDS: `operational=true` +
status set; POS: open-payment set), raise/define explicit bounded windows with `hasMore` metadata
surfaced to the UI, and a hard invariant test: an order in {PENDING, PREPARING, READY} must always be
reachable by the staff screens regardless of total order count.

---

## 5) MEDIUM findings

### M-1 — Read surface is tenant-scoped but role-agnostic (companion to H-01)
`GET /api/manager/{orders, tables, menu/categories, menu/products, waiter-requests, offers}`
are all `requireAuth`-only (`manager.ts:375, 812, 1312, 1439, 1743, 2243`). KITCHEN-role tokens
read full order histories, waiter calls with guest notes, offer economics. Fix on the route edge:
map each read to a minimum role set; keep STAFF-floor needs (tables status, waiter calls) but drop
financial/operational detail per role. *(Priority folded into H-01's remediation.)*

### M-2 — PIN login CPU-amplification + oracle residue (historical M-06)
The PIN-swap branch inside `/auth/login` (`auth.ts:340-370`) parallel-`bcrypt.compare`s the supplied
PIN against **every ACTIVE PIN-holder of the tenant**; tenant scale ⇒ N bcrypts per request under
`loginLimiter` only (20/15 min/IP). Failed-attempt lockout for the dedicated PIN endpoint
(`pinLimiter` 10/15 min/IP) is per-IP — restaurant NAT means legitimate staff share budgets, while
IP rotation extends attacker budgets. Add per-account PIN failure counters + exponential backoff,
and consider single-round probing with per-candidate did-you-mean semantics removed.

### M-3 — Public catalog: unbounded include, no cache policy, live occupancy oracle
`GET /api/public/restaurants/:slug` (`public.ts:297-457`) deep-includes categories/products/
options/addOns/offers/all tables in one query per menu hit with **no `Cache-Control`/`ETag`**, while
exposing `tables[].status` publicly (resolvable via `GET /public/restaurants` slug discovery) — a
competitor (or rater) can poll live occupancy per venue at zero auth cost. Add short-cache +
conditional GET on the menu payload, and either drop table status from the public payload or
coarsen it; the tables array is only needed client-side for tent-card number display for the *bound*
table.

### M-4 — Privacy/retention features ship disabled; no scheduler wired in deploy manifests
Retention (archive + purge of receipt objects and customer phones — the *only PII* guests hand over)
runs only when `RETENTION_ENABLED=true` (`server/index.ts:448-477`); backups similarly
(`BACKUP_ENABLED`, `:480-504`). Neither `render.yaml` nor the Dockerfile sets these, and **no Render
cron job exists** for `subscriptions:expire`/`retention:cleanup` in any manifest. Default production
posture: transfer receipts and phone numbers persist forever, subscription downgrade rows never
persisted (entitlements *are* enforced lazily per-request — that part is safe). Wire RETENTION (or a
cron) into `render.yaml`; document proof-retention windows per tenant; treat as release-blocker for
commercial data-handling claims.

### M-5 — Idempotency asymmetry between POS and public order creation
POS create compares the logical content of a replayed `clientRequestId` and 409s on mismatch
(`manager.ts` POST /orders, ~:476-585); the public path (`public.ts:770-792`) 409s only on
tenant/table/session mismatch — same key + same session + *different items* silently returns the old
order with HTTP 200 and `replayed: true`. Current clients generate one stable id per
cart-fingerprint, so today's exposure is latent; but any future client that reissues ids (or a
proxy retry with a stale body) corrupts intent silently. Align the public replay check with the POS
content-compare.

### M-6 — No CI gate for tests/types/build
`.github/workflows/` contains only `secret-scan.yml`. Nothing runs `vitest`, `tsc -b`, `oxlint` or
`vite build` on PRs; the 27 skipped tests and the 138 lint warnings drift unobserved; a PR that
breaks `npm run build` merges green. Add a minimal CI workflow (install, prisma generate, tests,
tsc, build). *(Note `docs/ci/README.md` is stale — it claims the workflow is not installed; it is.)*

### M-7 — Domain state stored as free TEXT (app-level invariants only)
`Order.fulfillmentState` (and siblings like `paymentStatus`) are TEXT columns validated only in
application code, a documented deliberate choice (migration `20260914180000…`) for rollout safety.
Post-rollout, add a CHECK constraint / native enum or drift becomes a silent-corruption vector
(one fat-fingered SQL console statement orphans an order). Also: dead enum states —
`WaiterRequestStatus.CANCELLED` is unreachable (transition guard `manager.ts:1770-1775` rejects it).

### M-8 — Frontend payload: 964 kB single chunk, no code-splitting, no service-worker cache
`npm run build` emits one 964.20 kB JS (241.68 kB gzip). For a QR-first mobile product on venue
Wi-Fi this is first-load pain and update-churn (every deploy re-downloads all). Route-level
splitting (customer vs manager vs admin) and an HTTP cache strategy will pay for themselves on
day one; not a security issue but an SRE availability-of-experience concern at scale.

## 6) LOW / INFO findings

| # | Finding | Evidence / note |
|---|---|---|
| L-1 | Staff JWT persisted in `localStorage` — XSS ⇒ token theft | `AuthContext.tsx` boot restore; mitigated by CSP `script-src 'self'` + React escaping (no `dangerouslySetInnerHTML` in src), 24 h sessionless JWT with `tokenVersion` revocation. Consider httpOnly SameSite cookie for staff. |
| L-2 | CSP `style-src 'unsafe-inline'` | required by Tailwind runtime styles today; document or remove via build-time CSS |
| L-3 | Manual `numericId` allocator with clamp+retry+races (historical M-05) | `public.ts:923-945`, `manager.ts:586-608`; schema default autoincrement already exists — simplify by deleting the allocator |
| L-4 | Rate limiters are per-process in-memory | documented in `rateLimit.ts`; at >1 Render instance limits multiply/move — plan Redis store before horizontal scaling |
| L-5 | Client-side login lockout is cosmetic (5 tries/60 s component state) | `AuthContext.tsx`; server limiters are the real control — relabel UI copy so ops don't over-trust it |
| L-6 | `POST /auth/password-reset-request` = 501 — **no account-recovery path at all** for staff | `auth.ts:417-433`; deliberate until a mailer exists — operationally managers get locked out via support only; track as launch dependency |
| L-7 | Docs drift: README claims "46 tests"; `docs/SYSTEM-DESCRIPTION-AR.md` claims 294/704 figures; `docs/ci/README.md` stale | measured today: 677 tests (649 pass). Refresh after remediation; historical reports should carry "as-of" dates |
| L-8 | `startOfDayInTimezone` single-probe offset | `utils/datetime.ts` — offset sampled at local-midnight instant only; DST-transition days can mis-bucket an hour of orders in analytics/settlement windows (both helpers and retention business-day close consume it) |
| L-9 | SSE staff token can ride the query string (`?token=`) | `public.ts:122-125`; morgan redaction covers app logs (`index.ts` redact list includes `token`), but any URL-logging proxy in front learns the JWT. EventSource can't set headers; prefer cookie-based staff streams or short-lived one-time stream tickets |
| L-10 | `WaiterRequestStatus.CANCELLED` dead enum + restricted transitions | `manager.ts:1768-1775` — either implement guest/staff cancel or drop the state |
| L-11 | Hardcoded fallback tenant slug `mureeh` + legacy slug aliases (`marer`/`merar`) in client entry | `RestaurantContext.tsx:625-635`; production bundle should fail-closed on missing slug, not bind a default tenant |
| L-12 | No error telemetry anywhere | only `console.error`; no Sentry/APM hooks in server or web; commercial multi-tenant ops will be blind. Roadmap item |
| L-13 | `npm run db:push` still present | `package.json`; boot paths are clean (C-03 ✅) but the manual foot-gun remains — delete or gate it |
| INFO-1 | Guest order notes PUT editable while PENDING; waiter-request notes visible tenant-wide to staff | intended per code; note for privacy reviews (guest identifiers = name+phone on transfer receipts only, both under retention purge) |

### 6.4 Operator-run actions still pending (from `SECURITY_REMEDIATION_2026-09-09.md`) — ⚠️
1. Purge the historical Supabase DB password from **git history + remotes** (tree is clean now).
2. Rotate platform secrets (JWT secret, DB password) + bump `tokenVersion` fleet-wide post-rotation.
3. Wire retention/backups + `subscriptions:expire` cron into the Render blueprint (ties to M-4).
4. Confirm `CORS_ORIGIN` contains the static-site origin — a single missed value hard-fails the
   whole frontend in production (config validated fail-closed, which is correct).

---

## 7) Remediation roadmap (proposal — nothing applied)

**Wave A — release blockers (target ~3–5 days):**
1. H-01: remove `qrToken` from list payloads to non-manager roles; manager-only retrieval; rotate-on-print. Tests: response-shape RBAC regression (staff roles), smoke of QR-management manager view.
2. H-02: staff cancel transitions (`PENDING`/`PREPARING`→`CANCELLED`, requireCashierOrManager) + payment `VOID` + audit events + UI. Tests: illegal transitions matrix incl. PAID-order cancel refusal.
3. H-03: status-scoped server queries per screen + `hasMore` surfacing + invariant test "active order always visible".
4. M-4: `RETENTION_ENABLED` + cron in `render.yaml`; document receipt/phone retention per tenant.

**Wave B — hardening (1–2 weeks):** M-1 role-mapped reads; M-2 per-account PIN backoff; M-3 cache policy +
occupancy coarsening; M-5 replay content-compare on public path; M-6 CI workflow; M-7 CHECK constraints.

**Wave C — scale/ops (pre-scale milestones):** L-4 Redis limiter store; M-8 code-splitting; L-9 stream
tickets; L-12 telemetry; L-6 recovery mailer; L-3 allocator removal; L-11 fail-closed slug.

**Test-debt items:** unskip the 27 skipped suites where feasible (DB-dependent: keep the skip-guard
pattern, it's correct); keep `production-hardening.test.ts` running in CI where Prisma engines download.

---

## 8) What I attacked and could not reproduce (positive assurance)

- **Cross-tenant reads/writes** — every manager route enforces `ownTenant()` post-JWT; platform
  privileges checked via role set; public guest objects bound by (restaurantId, tableId) pairing with
  `getQrSession` + `sessionId` scoping on every order read (`public.ts:650-668`).
- **Payment fraud** — orders are kitchen-invisible until `fulfillmentState=RELEASED`; the cashier
  confirmation and release share one transaction; proof images live in a private namespace re-sniffed
  on read; guest views never receive the storage key or the submitter phone (`paymentProofs.ts`).
- **Replay/duplicate orders** — unique `(restaurantId, clientRequestId)` + content-aware POS replay +
  compare-and-set status transitions + idempotent confirm/reject ('alreadyConfirmed' tolerated).
- **Pricing manipulation** — totals computed from DB rows only; client prices ignored (`public.ts:794-860`);
  cash math certified by pure reconciler.
- **Upload abuse** — 5 MB cap, PNG/JPG/WEBP/GIF magic-byte sniff, SVG rejected, traversal-guarded keys,
  tenant-namespaced paths, private receipts never served from the public URL space.
- **AuthN weakening** — alg/iss/aud pinning, DB freshness per request (status, tokenVersion, tenant
  ACTIVE), logout revokes (tv bump), SSE re-verifies credentials at connect.
- **Tenant lifecycle abuse** — one-trial-per-tenant-ever (409/410), lazy entitlement gating,
  self-upgrade refused, plan limits enforced at create-time.
- **Injection classes** — Prisma parameterization throughout (no raw SQL in routes), zod `.strict()`
  bodies, CSV formula-injection defense, HTML escaping helpers for generated documents.

---

*End of audit. All line numbers verified against `6574a5c`. This document is evidence-only; no source
code was modified during its production (RULE 1).*
