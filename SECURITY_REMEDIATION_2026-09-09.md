# Security Remediation Report — Mureeh Restaurant SaaS
**Date:** 2026-09-09
**Scope:** Remediation of the 8 CRITICAL/HIGH findings from `SECURITY_AUDIT_2026-09-09.md`
**Baseline commit:** `24c59bc`
**Branch:** `arena/01a086cc-restaurantsmureeh`

---

## 1. Executive summary

All **3 CRITICAL** and **5 HIGH** findings are remediated in code and covered by
regression tests.

| Metric | Before | After |
|---|---|---|
| CRITICAL open | 3 | **0** |
| HIGH open | 5 | **0** |
| Test suite | 98 pass / 1 skip | **141 pass / 1 skip** |
| Server type errors | 36 (pre-existing) | **36 — no new errors** |
| `npm audit --omit=dev` | 0 vulns | 0 vulns |
| Production build | OK | OK |

**Verdict change: 🔴 NO-GO → 🟡 CONDITIONAL GO.** The code defects are closed.
Go-live remains blocked on the **operator actions in §5**, which no code change
can perform — most importantly rotating the database credentials that were
published in Git history.

> **Important caveat on verification method.** `prisma generate` cannot run in
> the audit environment (`binaries.prisma.sh` is TLS-blocked), so there is no
> live database and no running server. Every fix below is verified by static
> analysis, type-checking, and pure unit tests. The behavioural fixes to
> **H-02** and **H-05** are proven at the decision-logic and schema layer, but
> have **not** been exercised end-to-end against a real database. Re-run the
> existing `security-tests/api-security-smoke.mjs` suite against a live staging
> deploy before production sign-off.

---

## 2. Regression test suite

New file: **`src/tests/security-remediation.test.ts`** — 43 tests, one or more
per finding. Designed to run with **no database and no Prisma client**.

**These tests were validated against the vulnerable baseline.** Running them
with imports repointed at the unmodified `24c59bc` source produced
**33 of 37 failing** (the suite at that time); against the fixed tree all pass.
They genuinely detect the vulnerabilities rather than merely asserting current
behaviour.

```
✓ src/tests/security-remediation.test.ts (43 tests)
  Test Files  10 passed (10)
       Tests  141 passed | 1 skipped (142)
```

---

## 3. CRITICAL findings

### C-01 — Live database superuser credentials committed to the repository
**CWE-798 · CVSS 9.8 · `scratch/*.cjs`**

Three tracked files contained a working Supabase superuser connection string,
granting full read/write/DROP over all tenant data to anyone with repo access.

**Fix**
- `git rm -r --cached scratch/` and deleted the directory (4 files). Verified no
  source file referenced it.
- `.gitignore` hardened: `scratch/`, `*.credentials`, `*.secrets`, `secrets.json`.
- `server/config.ts` now **throws in production** when `DATABASE_URL` is absent,
  so a missing secret fails closed instead of silently using a fallback.

**Regression test** — asserts `scratch` is untracked and absent, the ignore
patterns exist, and scans *every tracked file* for password-bearing
`postgres://` URIs (placeholders excluded).

**Residual risk — NOT closed by this change:** the credential remains in Git
history. See §5.

---

### C-02 — Hardcoded seed passwords and silent credential resets
**CWE-798 / CWE-284 · CVSS 9.1 · `server/db/seed*.ts`**

Both tenant seeds created manager accounts with the literal `Password123!`.
Worse, they used `upsert` with an `update` clause rewriting `passwordHash`,
`role`, and `status` — so **every deploy silently reverted an operator's
password rotation or account suspension**, re-arming the known password.

**Fix**
- New **`server/db/seed-credentials.ts`** — pure, Prisma-free credential
  primitives: `assertStrongSeedPassword` (min 12 chars + denylist including
  `password123!`), `readSeedCredentials`, `isDemoSeedAllowed`.
- New **`server/db/seed-utils.ts`** — `provisionTenantManager()`, the single
  provisioning path. Semantics:
  - credentials unset → **skip the account** (never a default password);
  - account absent → create from env;
  - account **already exists → left completely untouched**.
- Both tenant seeds now call it; all password literals removed.
- `seed.ts` validates `PLATFORM_ADMIN_PASSWORD` and gates demo tenants behind
  `isDemoSeedAllowed()` (never true in production).
- `provision-admins.ts` retains intentional overwrite but adds strength
  validation and bumps `tokenVersion` so **existing sessions are invalidated**
  when a password is rotated.

The credentials module is deliberately Prisma-free specifically so this logic is
testable without a database.

**Runtime verification**
```
REJECTED : missing      -> SeedCredentialError
REJECTED : empty        -> SeedCredentialError
REJECTED : short        -> SeedCredentialError
REJECTED : denylisted   -> SeedCredentialError
ACCEPTED : strong
```

**Functionality impact (action required):** seeds now need
`SHOQRAH_MANAGER_EMAIL/PASSWORD`, `GHOSN_MANAGER_EMAIL/PASSWORD`,
`PLATFORM_ADMIN_PASSWORD`, and `ALLOW_DEMO_SEED=1` for demo data. All are
documented in `.env.example`. **A seed run without them will skip account
creation rather than fail loudly** — intentional, but surprising if unread.

---

### C-03 — Destructive `prisma db push` in production deploy paths
**CWE-665 · CVSS 9.1 · `Dockerfile`, `package.json`, `render.yaml`**

Every production start ran `prisma db push`, which reconciles the database to
the schema **without migrations** — silently dropping columns/tables on drift.
A single deploy from a stale branch could destroy live tenant data.

**Fix** — all three now use `prisma migrate deploy` (forward-only, refuses to
apply destructive drift):
- `Dockerfile` CMD → `npx prisma migrate deploy && npx tsx server/index.ts`
- `package.json` `start` / `start:server`; added `db:migrate`
- `render.yaml` `buildCommand` → `npm ci && npx prisma generate` (build no
  longer touches the database at all)

`db:push` is retained as an explicit **local-development-only** script.

**Regression test** — asserts `migrate deploy` present and no `db push` in any
executable position (comments excluded).

---

## 4. HIGH findings

### H-01 — Session tokens leaked into access logs
**CWE-532 · CVSS 7.5 · `server/index.ts`**

The morgan redactor matched only `token=`. Because the pattern anchors on a
`?`/`&` boundary it did **not** match `sessionToken=` — the QR guest session
token, a live ~6-hour capability over a table's orders — which was written in
cleartext to every access log line.

**Fix** — redaction now matches the full parameter name across
`sessionToken`, `qrToken`, `token`, `access_token`, `refresh_token`, `pin`,
`password`, `secret`, `apiKey`, exported as `redactSensitiveUrl()`.

**Regression test** — 4 URL cases assert the secret is absent from output;
plus a guard that the old weak pattern has not returned.

---

### H-02 — Free self-service plan upgrade (privilege/billing escalation)
**CWE-639 / CWE-863 · CVSS 8.1 · `server/routes/manager.ts` → `PUT /subscription/plan`**

The endpoint accepted a client-supplied `planId` and applied it. With no payment
provider wired up, **any manager could `PUT` the Enterprise plan ID and receive
it for free**, unlocking multi-branch, analytics, exports, and custom domains.
The only guard was a trial-plan check.

**Fix** — new pure function `evaluatePlanChange()` in `server/services/plans.ts`
authorizes the **transition**, not just the target:
- price increase by a tenant → **402 Payment Required**, denial written to the
  audit log as `PLAN_CHANGE_DENIED`;
- downgrade / lateral → allowed;
- trial → platform-grant only (403);
- platform staff → always allowed (they complete paid upgrades once payment
  clears out-of-band).

The route now loads the current subscription and delegates the decision, using
the existing `isPlatformUser(req)` helper rather than duplicating the role list.

**Regression test** — 6 cases covering upgrade denial, no-subscription upgrade,
downgrade/lateral, trial self-serve, platform override, and malformed prices.

**Functionality impact:** self-service upgrades now fail with a clear Arabic
message directing the tenant to the platform. **If a paid upgrade flow is
expected to work today, this is a deliberate behaviour change** — upgrades must
be completed by platform staff until a payment provider is integrated.

---

### H-03 — `TRUST_PROXY` absent from the production manifest
**CWE-348 · CVSS 7.5 · `render.yaml`**

Render terminates TLS at a proxy, so without `TRUST_PROXY` every request's
`req.ip` resolved to the proxy address. Consequences: **all seven rate limiters
collapsed into a single global bucket** — one client could lock out every user,
including login — and audit logs recorded a useless IP for every actor.

**Fix**
- `render.yaml` sets `TRUST_PROXY: "1"` (exact proxy count — never `true`, which
  would trust a spoofed `X-Forwarded-For` chain) and `FRAME_ANCESTORS: "'self'"`.
- `server/index.ts` emits a loud startup warning when running in production with
  `TRUST_PROXY=0`, catching this misconfiguration on any future host.

**Regression test** — asserts `TRUST_PROXY` is present and is not `true`.

---

### H-04 — Unvalidated promo video / gallery URLs reaching an iframe
**CWE-79 / CWE-601 · CVSS 7.4 · `server/validation/schemas.ts`, `CustomerHero.tsx`**

`promoVideoUrl` was `z.string().max(1000)` — anything at all — and is rendered
into an `<iframe src>` (YouTube-like values) or `<video src>`. A malicious or
compromised manager could point the frame at attacker-controlled HTML rendered
inside the tenant's page for **every guest who scans a QR code**: PIN phishing,
fake payment prompts, clickjacking. `javascript:` and `data:text/html` were
equally unfiltered.

**Fix** — `isAllowedPromoVideoUrl()` enforces: HTTPS only (blocks `javascript:`,
`data:`, `vbscript:`, `file:`, plaintext HTTP), no embedded credentials, and a
**host allowlist** (YouTube incl. `-nocookie`, Vimeo) or an app-relative upload
path; protocol-relative `//evil` rejected. `galleryImages` now reuses the
existing `httpsUrl` validator instead of accepting free text.

**Regression test** — 7 hostile inputs rejected, 5 legitimate accepted, plus
schema-level assertions through `brandingSchema`.

---

### H-05 — Unvalidated table settlement body
**CWE-20 / CWE-915 · CVSS 7.1 · `POST /tables/:id/settle`**

The only settlement endpoint had **no `validateBody`** and read `paymentMethod`
and `note` straight off `req.body`. An arbitrary-length, arbitrary-content
string was written into the payment ledger — receipt forgery, log/CSV injection
into finance exports — and free-text values bypassed cash-vs-card
reconciliation entirely.

**Fix** — new `tableSettleSchema`, mounted on the route:
- `paymentMethod` constrained to the **canonical `PAYMENT_METHODS` enum**
  (`CASH`/`CARD`/`MOBILE`/`SPLIT`), reusing the same constant as the payments
  endpoint so settlement and reconciliation can never drift apart;
- `note` capped at 500 chars;
- `.strict()` rejects unknown fields (mass-assignment defence).

> During implementation I initially invented a *different* payment-method list.
> The regression test caught the mismatch against the existing
> `PAYMENT_METHODS` constant, and the schema was corrected to reuse it. Worth
> noting: `'PAY AT CASHIER'` is the Prisma column default but is **not** a
> member of that enum, so it is now rejected as an input value. Confirm this
> matches intended POS behaviour.

**Regression test** — rejects free-text methods, unknown fields, and overlong
notes; accepts the four valid methods; asserts the route actually mounts the
validator.

---

## 5. Operator actions still required (code cannot do these)

These are **blocking** for production sign-off.

1. **Rotate the Supabase database password immediately.** It is published in Git
   history and must be treated as fully compromised. Do this *first* — history
   rewriting is pointless while the credential is still valid.
2. **Purge Git history** with `git filter-repo` or BFG to remove `scratch/`,
   then force-push and have all clones re-cloned.
3. **Create a least-privilege `mureeh_app` database role** (no superuser, no
   DDL) and point `DATABASE_URL` at it.
4. **Rotate the two demo manager passwords** (`Password123!`) on any environment
   where the old seeds ran, and set the new env vars from `.env.example`.
5. **Invalidate exposed sessions** — bump `tokenVersion` for any account whose
   token may appear in historical access logs (H-01).
6. **Set `TRUST_PROXY`** on every non-Render environment to its real proxy count.
7. **Run `security-tests/api-security-smoke.mjs` against live staging** to
   confirm H-02 and H-05 behave correctly end-to-end with a real database.

---

## 6. Files changed

| File | Finding | Change |
|---|---|---|
| `.gitignore` | C-01 | ignore scratch/secret patterns |
| `server/config.ts` | C-01 | fail closed on missing prod `DATABASE_URL` |
| `server/db/seed-credentials.ts` | C-02 | **new** — Prisma-free credential validators |
| `server/db/seed-utils.ts` | C-02 | **new** — safe `provisionTenantManager` |
| `server/db/seed-shoqrah.ts`, `seed-ghosn.ts` | C-02 | literals removed |
| `server/db/seed.ts` | C-02 | validation + demo gating; no admin rewrite |
| `server/db/provision-admins.ts` | C-02 | strength check + `tokenVersion` bump |
| `Dockerfile`, `package.json`, `render.yaml` | C-03, H-03 | `migrate deploy`; `TRUST_PROXY` |
| `server/index.ts` | H-01, H-03 | log redaction; proxy warning |
| `server/services/plans.ts` | H-02 | `evaluatePlanChange` authorization |
| `server/routes/manager.ts` | H-02, H-05 | plan gate; settle validator |
| `server/validation/schemas.ts` | H-04, H-05 | video allowlist; settle schema |
| `.env.example` | C-02, H-03 | new variables documented |
| `src/tests/security-remediation.test.ts` | all | **new** — 43 regression tests |

---

## 7. Remaining findings (not in this pass)

The 9 MEDIUM, 6 LOW, and 5 INFO findings in `SECURITY_AUDIT_2026-09-09.md`
(P2/P3) are unchanged and still open. Highest-value next items: SSE
authentication hardening, upload content-type verification, and the CSP
`unsafe-inline` removal.
