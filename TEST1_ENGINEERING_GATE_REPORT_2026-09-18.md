# MUREEH — TEST 1: ENGINEERING & REGRESSION GATE REPORT

**Repository:** `bossbaraka/restaurantsMureeh` (main @ `62b2f31`, PR #44 merge)
**Audit date:** 2026-09-18
**Scope:** Engineering integrity + regression + build + automated-test quality only. No UI redesign, no refactors, no business-logic changes, no fixes applied.
**Auditor environment note:** This sandbox blocks `binaries.prisma.sh`, so `npm install`'s postinstall (`prisma generate`) cannot download the native query engine. The repo's own documented workaround (`e2e/README.md` §4: WASM client + `e2e/patch-prisma-client.cjs` + pg driver adapter) was used, and an **embedded PostgreSQL 17** was booted so that every DB-gated suite actually executed instead of skipping. Zero product files were modified (see §8).

---

## TEST 1 RESULT

# ENGINEERING GATE: CONDITIONAL PASS

**Build:** PASS · **Lint:** FAIL · **Automated Tests (default `npm test`):** 850 passed / 0 failed / 46 skipped · **Automated Tests (full DB coverage):** 887 passed / 9 failed / 0 skipped — all 9 failures are defects in the *tests*, not the product.

The product core is demonstrably stable (17/17 migrations apply cleanly to a fresh PostgreSQL 17; tenant isolation, payment atomicity, idempotency and fulfillment-gate invariants all **pass against a real database**; server-side pricing; compare-and-set state machines). What is **not** stable is the quality-gate infrastructure around it: the lint gate is red, three of the repo's own harnesses fail on main, the DB-gated regression net has provably never been executed green, and nothing (no CI) enforces any of it. Proceed to TEST 2 **with mandatory pre-conditions** (§7).

---

## 1. ARCHITECTURE MAP (as verified from source)

| Layer | Implementation |
|---|---|
| Frontend | React 19 SPA, Vite 8, Tailwind. Entry `index.html → src/main.tsx → App.tsx`; view-mode state machine (CUSTOMER / MANAGER / ADMIN / ONBOARDING / PLATFORM_ADMIN / SPLIT_PREVIEW / KITCHEN_KDS / SAAS_LANDING / LIVE_SCREEN). Two god-files: `RestaurantContext.tsx` (2,027 lines), `api.ts` (1,936 lines). |
| Backend | Single Express 5 service (`server/index.ts`, 522 lines) serving API + SPA fallback + `/uploads` static. Routers: `auth` (433), `public` (1,709 — guest QR flow, SSE, orders, proofs), `manager` (4,580 — POS, KDS, menu, staff, payments, analytics), `admin` (550), `uploads` (240). |
| DB access | Prisma 5.22 / PostgreSQL. Singleton in `server/db/prisma.ts`. 17 migrations (2026-09-08 → 2026-09-17), applied at boot by `deploy-migrations.ts` (`prisma migrate deploy` + P3005 baselining). **No `db push` anywhere in the boot path.** |
| AuthN/AuthZ | JWT HS256 (issuer/audience pinned, 12 h), `tokenVersion` revocation, per-request user + tenant status revalidation, staff PIN login, RBAC (`requireRole`, `requireTenantAccess`, platform bypass), QR guest sessions (`guestSessionAuthorization` — INTERACTION vs ORDER_TRACKING capabilities, fail-closed predicates). No refresh tokens (documented roadmap). |
| Validation | Zod (`server/validation/schemas.ts`, 1,162 lines); order schema **strips client prices** (`price: z.unknown()` — "priced ONLY from the DB menu"). |
| Realtime | Server-Sent Events only (`services/realtime.ts`): in-memory registry with global/tenant/subject caps; table-scoped broadcasts. `ws` dependency is **unused**. |
| Storage | Driver abstraction local / Supabase (`services/storage/*`): tenant-scoped keys, image magic-byte sniffing, private namespace for transfer receipts, fail-closed durability guards in `config.ts` (refuses ephemeral storage on Render). |
| Money | Fulfillment gate (`orderLifecycle`), payment ledger (`Payment`, void-marking), receipt numbers per-tenant, conditional claims for double-payment prevention. |
| Testing | Vitest 4 (60 files / 896 tests, no coverage config) + out-of-band harnesses: `e2e/employee-functional-test.mjs` (641 HTTP+DB checks), `e2e/frontend-guard.check.tsx` (6 checks), `e2e/live-preview` UI gate, `security-tests/api-security-smoke.mjs`. |
| Build/deploy | `tsc -b && vite build` → `dist/`; Render (2-service: API + static), Dockerfile + docker-compose, Netlify/Vercel static configs. |
| CI | **`secret-scan.yml` (gitleaks) only.** Nothing runs build, lint, or tests. |

## 2. INSTALLATION & BUILD

| Command | Result | Notes |
|---|---|---|
| `npm install` | ✅ (in sandbox: postinstall `prisma generate` fails **only** because binaries.prisma.sh is network-blocked; packages install fine, 0 audit vulnerabilities) | On a normal network this is a non-issue. |
| `npm run build` | ✅ PASS, exit 0, ~11 s | `tsc -b` (app only) + `vite build`; 1,936 modules. |
| `npm run lint` | ❌ **FAIL, exit 1** | **2 errors, 147 warnings** (oxlint). |
| `npx tsc -p tsconfig.server-check.json` | ❌ 140 diagnostics, **not wired to any script/CI** | Server code is outside every type gate. |

Build warnings classified:
- **P2 — single 998.5 kB JS chunk** (gzip 250.7 kB), no code splitting, for a QR-first mobile experience.
- **P2 — `tsconfig.app.json` has `"strict": false`**, and `src/tests` is *excluded* from it — neither the server nor the tests are type-checked by anything.
- P3 — Dockerfile copies the builder's full `node_modules` over the `npm ci --omit=dev` layer (dev deps ship in the production image).

Lint errors (the two hard failures, both `react-hooks(rules-of-hooks)`):
- `src/components/customer/CustomerLayout.tsx:328` — `useState` called after the `if (displayMode) return <DisplayMenu />` early return (line 323).
- `src/components/customer/CustomerLayout.tsx:332` — same for `useEffect`.
- Latent risk: `displayMode` is frozen per mount (`useState(isDisplayModeUrl)`), so hook order is stable *today*; any refactor or remount-with-different-URL path turns this into a runtime crash of the customer QR flow. **The lint gate being red on main went unnoticed because no CI runs it.**

## 3. AUTOMATED TEST SUITE — EXECUTED RESULTS

| Suite | Command / gate | Result | Duration |
|---|---|---|---|
| Unit/static/jsdom (default) | `npm test` (no `DATABASE_URL`) | **850 passed / 0 failed / 46 skipped**, exit 0 | 20.7 s |
| Full DB coverage | `vitest run` + real PostgreSQL 17 + `SAAS_E2E_SEED=1 SAAS_E2E_MUTATE=1` | **887 passed / 9 failed / 0 skipped**, exit 1 | 26.6–27.2 s |
| Employee functional (real API + DB) | `e2e/employee-functional-test.mjs` | **626 passed / 15 failed** of 641, exit 2 | 23.2 s |
| Frontend guard | `vitest --config e2e/vitest.guard.config.ts` (needs manually-installed deps) | **6/6 passed** | 1.1 s |
| Live-preview payment gate | `npm run preview:gate` | **0/1 — FAILED** | 7.7 s |
| Migrations | 17 migration SQL files applied in order to fresh PG 17 | **17/17 applied cleanly** | <1 s |

**The 46 silently-skipped tests (default run):** all DB-gated via `describe.skipIf(!process.env.DATABASE_URL)` — full skips: `product-image-persistence.integration` (10), `theme-image-persistence.integration` (10), `prismaPostgresValidation` (3); partial: `payment-proof-flow.integration` (9), `payment-receipt-scope.integration` (7), `transfer-details.integration` (6), `production` (1 opt-in mutation). Plus opt-in flags `SAAS_E2E_SEED` / `SAAS_E2E_MUTATE`.

**The 9 failures under full DB coverage — all test-code defects, not product defects:**

1. **8 × `product-image-persistence.integration.test.ts`** — the suite reads `body.id` from the create-product response, but the router returns `{ success, data: { id, … } }` (verified by standalone repro: POST `/api/manager/menu/products` → 201 with `data.id`; server-side persistence and URL/key contract behave correctly). Every failure cascades from `id: undefined`. **This suite has evidently never passed against a database.**
2. **1 × `transfer-details.integration.test.ts` test 6** — the test's SQL-statement parser splits the migration on `;` then discards any chunk that *starts with* a comment line; the shipped migration interleaves comments with 3 of its 7 `ADD COLUMN` statements, so the test counts 4 and fails. The migration itself is correct — all 7 columns exist and sibling tests 1–5 pass against the migrated DB.

**The 15 employee-harness failures — stale expectations vs. deliberately hardened product rules** (verified in source): monotonic waiter-request transitions (`manager.ts:2121` rejects RESOLVED→ACKNOWLEDGED), monotonic order transitions (`manager.ts:959` rejects PENDING→READY), and the tightened image-reference contract (create with `image: '/uploads/x.png'` → 400 by design; external https URLs still accepted — verified 201). Product behavior is correct per its own specs/tests; the flagship harness was not updated.

**Live-preview failure:** `order-lifecycle.check.tsx` times out waiting for the mandatory payment step (`لا يبدأ المطبخ بتحضير الطلب قبل تأكيد الدفع`) — the order is created and tracked as AWAITING_PAYMENT, but the payment modal never becomes reachable; the rendered screen shows the welcome/guide overlays stacked over the menu. **Potential real regression in the customer payment flow (or harness drift after the 2026-09-16 welcome-gate/guide UX change). Must be triaged in TEST 2.**

### Coverage quality — traced to implementation

| Area | Verdict | Evidence |
|---|---|---|
| Authentication | ✅ behavioral | staffLogin/auth flows; employee harness login+PIN+lockout; rate-limited PIN route |
| Authorization | ✅ behavioral | 641-check permission matrix (endpoint × role) + frontend guard on real `AuthProvider` |
| Tenant isolation | ✅ **real DB** | `prismaPostgresValidation` passed against PG; cross-tenant probes in employee harness |
| QR entry / table sessions | ✅ | customerEntry/customerSession + real QR session creation over HTTP |
| Product customization | 🟡 partial | options/add-ons priced server-side (verified in `public.ts`); no dedicated behavioral suite for customizations |
| Cart / order creation | ✅ **real DB** | idempotency (`restaurantId_clientRequestId`), replay-safe resubmission, server-side pricing |
| Order lifecycle | ✅ | fulfillment-gate suites + opt-in mutation test (passed with `SAAS_E2E_MUTATE=1`) |
| KDS | 🟡 partial | static + UI tests pass; the *live* KDS scene is inside the **failing** live-preview gate |
| Waiter requests | ✅ behavioral (HTTP) | employee harness; serialization/retry covered |
| Cashier/POS | ✅ **real DB** | `payment-receipt-scope` suite: per-tenant receipts, P2002 rollback, concurrent claim |
| Payments / duplicate prevention | ✅ **real DB** | `payment-proof-flow` suite: atomic confirm, no double processing, rejection semantics, retention purge |
| Branches | 🟡 partial | plan `maxBranches` limits tested (largely static); branch CRUD in employee harness |
| Subscriptions | 🟡 partial | `saas`/`freeTrialPlan`/`planLimits` — mostly static source assertions |
| Analytics | ❌ weak | no dedicated suite found for `AnalyticsView` / analytics routes |
| SSE / realtime | 🟡 partial | registry unit-tested; end-to-end SSE exercised only by the **failing** live-preview harness |
| Storage | ✅ behavioral | local driver round-trips, supabase driver mocked, sniffing, tenant key ownership |
| Audit logs | 🟡 partial | audit service used; assertions largely static |
| Backup / retention | ✅ partial-behavioral | real `pg_dump` snapshot test passed; retention sweep unit-tested with mocks + DB suite |

## 4. TEST QUALITY AUDIT — misleading-confidence findings

- **TW-1 (P1): 25 of 60 test files are static source-text assertions** (`readFileSync` + `expect(source).toContain('…')`) — e.g. `release-gate.test.ts`, `cashier-payment.test.ts`, `planLimits.test.ts`. They can pass while the feature is broken (string present, logic dead) and fail on harmless refactors. They document intent; they do not verify behavior.
- **TW-2 (P1): DB-gated suites skip silently without `DATABASE_URL`** — and when finally executed (this audit), 9 of them fail. The image-persistence regression net has a hole exactly where recent hardening happened.
- **TW-3 (P2): `production.test.ts` asserts seeded state (plan catalog, platform admin) but only skips on *connectivity*, not on *seed absence*** — with a DB attached but `SAAS_E2E_SEED` unset, 2 tests hard-fail instead of skipping (vacuous `expect(true).toBe(true)` skip stubs elsewhere).
- **TW-4 (P2): the employee functional harness is stale** (15 red checks) and cannot run from a clean checkout (needs a live server + DB + env file).
- **TW-5 (P2): the frontend guard harness requires dependencies that are not in `devDependencies`** (`jsdom`, `@testing-library/*`) — documented in e2e/README but invisible to `npm ci`.
- **TW-6 (P2): the live-preview UI gate fails on main** (see §3) — the only end-to-end UI check of the payment flow is red.
- **TW-7 (P3): no coverage tooling/thresholds configured**; `vitest.config.ts` is minimal (setup file only).

## 5. REGRESSION ANALYSIS — hot zones for TEST 2/3

1. **Customer QR → payment modal** (live-preview failure; welcome-gate/guide overlays vs. payment modal interplay) — highest-priority disambiguation.
2. **Conditional hooks in `CustomerLayout.tsx`** — latent crash in the customer flow.
3. **Image-reference contract** — validation was tightened; manager UI must never send legacy `/uploads/…` or blob/data payloads (product verified OK; harness fixtures drifted).
4. **Monotonic order/waiter state machines** — POS/KDS/waiter flows must send single-step transitions (employee harness expectations stale).
5. **Money as `Float`** across `Order`, `Payment`, `OrderItem`, `Plan` — `roundMoney()` mitigates at order creation, but a Float payment ledger is a reconciliation risk.
6. **`docker-compose.yml` cannot boot the app** (see F-07) — config-only regression.
7. **Single-instance assumptions**: in-memory rate limiting + SSE registry — correct for one Render instance, silently wrong if scaled to >1.
8. **Order-ID allocation**: human-readable `#N` string as PK, allocated latest+1 with retry-on-P2002 (correct but error-log-noisy under bursts; `numericId` autoincrement exists but is not the PK).

## 6. DATABASE INTEGRITY (schema + migrations, unmodified)

- **Migrations coherent:** 17/17 apply in order to a fresh PostgreSQL 17; additive/idempotent style (`IF NOT EXISTS`), no destructive operations; P3005 baselining handled at deploy.
- **Schema ↔ migrations consistent** (all 7 transfer columns verified present and exercised by passing tests).
- Relations/FKs correct with intentional `Cascade`/`SetNull` choices; tenant ownership (`restaurantId`) on every tenant table with the right indexes (`restaurantId`, status, composite `[restaurantId, paymentStatus]`, `[restaurantId, fulfillmentState]`, `archivedAt`).
- **F-09 (P2): monetary values are `Float`** — unsafe representation for a payment ledger (`Payment.subtotal/tax/total/cashReceived/changeDue/tip`, `Order.*`, `OrderItem.priceSnapshot/totalPrice`, `Plan.price*`). Should be `Decimal`/integer minor units in a future migration (not done — audit only).
- P3: `Payment.tableId` is a free string (`__WALKIN__` sentinel) with no FK; `Order.cancelledByUserId` has no FK to `RestaurantUser`; `RestaurantUser.status` is a loose `String` while sibling statuses are enums; redundant `@@index([email])` next to `@unique` email.

## 7. CRITICAL FINDINGS REGISTER

| ID | Sev | Location | Finding | Blocker? |
|---|---|---|---|---|
| F-01 | **P1** | `src/components/customer/CustomerLayout.tsx:328,332` | Rules-of-hooks violations (hooks after `displayMode` early return) → `npm run lint` **exit 1** on main; latent customer-flow crash | **Yes (release)** |
| F-02 | **P1** | `src/tests/product-image-persistence.integration.test.ts` (8), `transfer-details.integration.test.ts` (1) | DB-gated regression tests broken when actually run (`body.id` vs `data.id`; SQL parser drops comment-prefixed statements) — suites never executed green | **Yes (release)** |
| F-03 | **P1** | `.github/workflows/` | CI runs **only** gitleaks — no build/lint/test enforcement; red lint shipped unnoticed | **Yes (release)** |
| F-04 | **P1** | `e2e/live-preview/order-lifecycle.check.tsx` | Repo's own payment-gate UI harness fails on main (mandatory payment step unreachable) — possible product regression in customer payment flow | **Yes (release — triage in TEST 2)** |
| F-05 | P2 | `src/tests/production.test.ts` | Seed-dependent assertions hard-fail on unseeded DB (skip logic covers connectivity only) | No |
| F-06 | P2 | `e2e/employee-functional-test.mjs` | 15 stale expectations vs. hardened monotonic transitions + image contract | No |
| F-07 | P2 | `docker-compose.yml` | App service sets `NODE_ENV=production` with no `STORAGE_DRIVER=supabase` creds and no `STORAGE_ALLOW_LOCAL_IN_PROD=true` → fail-closed storage guard **refuses to boot** despite the mounted `uploads` volume | No (config) |
| F-08 | P2 | `server/index.ts` | No SIGTERM/graceful shutdown — in-flight requests and SSE cut on Render redeploys; DB pool not drained | No |
| F-09 | P2 | `prisma/schema.prisma` | Monetary values as `Float` across order/payment/plan ledger | No (pre-launch debt) |
| F-10 | P2 | `tsconfig*.json`, `package.json` | Server + tests outside every type gate; frontend compiles with `strict: false`; 140 unwired server diagnostics | No |
| F-11 | P2 | `src/tests/*` (25 files) | Static source-string tests masquerading as regression coverage | No |
| F-12 | P2 | `e2e/vitest.guard.config.ts` users | Guard harness needs out-of-repo deps (`jsdom`, `@testing-library/*`) — not in `devDependencies` | No |
| F-13 | P2 | `server/middleware/rateLimit.ts`, `services/realtime.ts` | In-memory limiters/SSE registry — single-instance only (documented; breaks silently if scaled) | No |
| F-14 | P3 | `vite build` output | 998.5 kB single chunk, no code splitting (mobile QR-first product) | No |
| F-15 | P3 | `package.json` | Dead deps (`ws`, `@types/ws`, `@supabase/server`); legacy aliases (`authMiddleware`, `adminOnboardLimiter`); README claims "46 tests" (actual: 896) | No |
| F-16 | P3 | `Dockerfile` | Builder `node_modules` (incl. devDeps) copied over the `--omit=dev` layer | No |
| F-17 | P3 | `server/routes/public.ts:1066` | Order `#N` PK allocation logs `prisma:error` on every collision retry (correct, but noisy ops signal) | No |

No P0 product-breaking defect was demonstrated: build succeeds, and every core invariant (tenant isolation, payment atomicity/duplicate prevention, idempotent ordering, fulfillment gate, retention) **passed against a real PostgreSQL**.

## 8. AUDIT-ONLY MODIFICATIONS (disclosed, per instructions)

No product, test, or config file was edited. Untracked scaffolding created to execute the audit (all outside git, disposable):
- `e2e/prisma/schema.prisma` — throwaway WASM-client schema copy (exact step documented in the repo's own `e2e/README.md` §4).
- `e2e/server.env` — throwaway test env from `e2e/server.env.example` (localhost DB only, no secrets).
- `node_modules/.prisma/client` regenerated + `e2e/patch-prisma-client.cjs` applied (repo-documented harness step; `node_modules` is gitignored).
- Embedded PostgreSQL 17 + migration runner + one standalone repro script lived in `/tmp` (outside the repo) and were shut down after the audit.

## 9. RELEASE GATE DECISION

**CONDITIONAL PASS — proceed to TEST 2 (functional/security validation),** based on: build PASS, default suite green, and verified-correct core behavior against a real database. **Pre-conditions tracked as release blockers:** fix F-01 (lint gate), fix F-02 (9 broken DB tests), add CI running build+lint+test (F-03), and triage the live-preview payment-flow failure (F-04) as the first item of TEST 2.

---

```
ENGINEERING_GATE=CONDITIONAL_PASS
BUILD=PASS
LINT=FAIL
TESTS=850_PASSED_0_FAILED_46_SKIPPED_DEFAULT;887_PASSED_9_FAILED_0_SKIPPED_WITH_REAL_DB
CRITICAL_BLOCKERS=4
NEXT_GATE=TEST_2
```
