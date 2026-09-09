# MUREEH — COMPREHENSIVE SECURITY AUDIT & PENETRATION TEST

**Date:** 2026-09-09
**Target:** `bossbaraka/restaurantsMureeh` @ `24c59bc` (branch `arena/01a086cc-restaurantsmureeh`)
**Scope:** Full stack — React SPA, Express/Node API, Prisma ORM, PostgreSQL, deployment configuration
**Methodology:** Defensive white-box source audit + static analysis + dependency audit + unit/integration test execution. **No destructive actions. No production data modified, deleted, or migrated.**

> **Note on the previous audit.** The repository contains `SECURITY_AUDIT_2026-09-07.md` and `SECURITY_FIXES_APPLIED_2026-09-07.md`. Every claim in those documents was **re-verified independently against the current code** rather than trusted. The vast majority of the 2026-09-07 application-layer fixes are genuinely present and correctly implemented (see §Verified Controls). However, this audit found **new CRITICAL issues introduced after that remediation**, and **two claimed fixes that are contradicted by the current repository state**.

---

## EXECUTIVE SUMMARY

The **application layer** of Mureeh is, on the whole, in good shape. Authentication, JWT handling, RBAC, tenant isolation, server-side pricing, input validation and file-upload hardening are implemented to a standard well above average for a product of this size. There is no SQL injection surface, no raw SQL, no `eval`, and zero known-vulnerable dependencies.

The **repository and deployment layer is where this platform is compromised.** The single most severe finding is not a subtle logic flaw — it is **live production database credentials committed to source control in three tracked files**, granting direct superuser-equivalent access to the Supabase PostgreSQL instance, completely bypassing every application-layer control described above. Chained with a boot-time destructive migration and hardcoded demo manager passwords, this produces a realistic path to full platform compromise.

### Verdict

> ### 🔴 **NO-GO for production until P0 items are closed.**
>
> The application code does not need a rewrite. The credentials need **immediate rotation**, git history needs scrubbing, and three deployment/seed defects need fixing. These are hours of work, not weeks.

### Overall Security Score: **58 / 100**

| Domain | Score | Notes |
|---|---:|---|
| Authentication | 82 | Strong: no fallback secret, tv-revocation, timing-flattened login. Weak: no MFA, no reset flow. |
| Authorization / RBAC | 85 | Consistent per-row ownership checks. Gap: read endpoints not role-gated. |
| Multi-Tenant Isolation | 88 | **Strongest area.** JWT-first tenant resolution; client `restaurantId` never trusted. |
| API Security | 70 | Good validation/rate limits. Gaps: no pagination, unbounded reads, one unvalidated body. |
| Database Security | 45 | Schema is sound; **credentials exposed in git**. |
| Prisma Security | 90 | Fully parameterized, no raw SQL, safe `select` projections. |
| JWT | 88 | HS256 pinned, iss/aud, DB re-validation, revocation. |
| CORS / Headers | 85 | Fail-closed allow-list, full CSP. |
| File Upload | 88 | Magic-byte sniffing, server-generated names, manager-only. |
| XSS | 80 | React + explicit escaping on print paths. Gap: unvalidated URL fields. |
| QR Security | 90 | Opaque CSPRNG capability tokens, exact match only. |
| Business Logic | 62 | Server-side pricing is excellent; subscription/settle logic is weak. |
| Frontend Security | 75 | No secrets shipped; token in `localStorage` (CSP-mitigated). |
| Infrastructure | 38 | Destructive boot command, proxy misconfig, seed-on-boot. |
| **Secrets Management** | **10** | **Live DB credentials in three tracked files.** |
| Dependency Security | 95 | `npm audit`: **0 vulnerabilities**. |

### Findings by severity

| Severity | Count |
|---|---:|
| 🔴 CRITICAL | 3 |
| 🟠 HIGH | 5 |
| 🟡 MEDIUM | 9 |
| 🔵 LOW | 6 |
| ⚪ INFO | 5 |

---

## 1. ARCHITECTURE MAP & TRUST BOUNDARIES

```
┌───────────────────────────────────────────────────────────────────┐
│ UNTRUSTED ZONE — attacker-controlled                              │
│  QR guest (anonymous) · Staff browser · Platform admin browser    │
│  React 19 SPA (Vite) · localStorage: merar_auth_token             │
└───────────────────────────┬───────────────────────────────────────┘
                            │  TB-1: Network / HTTPS
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│ EDGE — server/index.ts                                            │
│  helmet (CSP, frameguard deny) · CORS fail-closed allow-list      │
│  express.json 1mb · morgan (redacts ?token=) · static /uploads    │
└───────────────────────────┬───────────────────────────────────────┘
                            │  TB-2: Authentication
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│ AUTH — server/middleware/auth.ts                                  │
│  authenticateToken: HS256 pinned + iss/aud + DB re-check          │
│  (status ACTIVE, tokenVersion match) → req.user                   │
└───────────────────────────┬───────────────────────────────────────┘
                            │  TB-3: Authorization (RBAC)
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│ RBAC — requireAuth / requireManager / requireCashierOrManager /   │
│        requireServiceStaff / requirePlatformAdmin                 │
└───────────────────────────┬───────────────────────────────────────┘
                            │  TB-4: Tenant isolation  ★ critical
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│ TENANCY — getTenantId() JWT-first · ownTenant() per-row check     │
│  Non-platform actors ALWAYS resolve to their own JWT tenant       │
└───────────────────────────┬───────────────────────────────────────┘
                            │  TB-5: Validation (zod .strict())
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│ BUSINESS LOGIC — server-side re-pricing · plan limits · entitle-  │
│  ments · payment ledger · realtime SSE (table-scoped)             │
└───────────────────────────┬───────────────────────────────────────┘
                            │  TB-6: Data access  ⚠️ BYPASSED BY C-01
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│ Prisma 5.22 (parameterized, no raw SQL) → PostgreSQL (Supabase)   │
└───────────────────────────────────────────────────────────────────┘
```

**Trust boundary assessment**

| # | Boundary | Status | Comment |
|---|---|---|---|
| TB-1 | Network | ⚠️ PARTIAL | HTTPS terminated at Render; `TRUST_PROXY` not set in `render.yaml` (H-03) |
| TB-2 | Authentication | ✅ PASS | No fallback secret; fail-closed at boot |
| TB-3 | RBAC | ⚠️ PARTIAL | Writes gated; reads not role-gated (M-01) |
| TB-4 | Tenant isolation | ✅ PASS | Strongest control in the system |
| TB-5 | Validation | ⚠️ PARTIAL | One route without `validateBody` (M-03) |
| TB-6 | Data access | 🔴 **FAIL** | **Bypassed entirely by C-01 — direct DB access** |

**Component inventory:** Frontend `src/` (React 19, Vite 8, Tailwind) · Backend `server/` (Express 5) · Routes: `auth.ts`, `public.ts`, `manager.ts` (2,387 LOC), `admin.ts`, `uploads.ts` · Middleware: `auth.ts`, `rateLimit.ts` · Services: `realtime.ts` (SSE), `audit.ts`, `plans.ts`, `backup.ts` · Validation: `schemas.ts` (625 LOC zod) · DB: `prisma/schema.prisma` (15 models) · **No webhooks, no payment gateway, no third-party API integrations, no cron jobs, no WebSockets** (`ws` and `@supabase/*` are declared but unused — see I-04).

---

## 2. CRITICAL FINDINGS

### 🔴 C-01 — Live production database credentials committed to source control

| Field | Value |
|---|---|
| **Severity** | **CRITICAL** |
| **CVSS 4.0** | **9.8** (`AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H`) |
| **CWE** | CWE-798 (Hard-coded Credentials), CWE-540 (Source Code Info Leak), CWE-312 (Cleartext Storage) |
| **OWASP** | A07:2021 Identification & Authentication Failures; A02 Cryptographic Failures |
| **Files** | `scratch/test-conn.cjs:19-20`, `scratch/test-encoded.cjs:19-20`, `scratch/seed-shoqrah.cjs:9-11` |
| **Status** | **All three files are tracked in git** (`git ls-files scratch/` confirms) |

**Evidence** (credential redacted here; present in cleartext in the repo):

```js
// scratch/test-conn.cjs:19
await test('direct-5432',
  'postgresql://postgres.uhfdkcaxftcctnitqjvo:1611****aka@db.uhfdkcaxftcctnitqjvo.supabase.co:5432/postgres?sslmode=require');

// scratch/seed-shoqrah.cjs:7-12 — automatic fallback to the live DB
const connectionUrls = [
  process.env.DATABASE_URL,
  'postgresql://postgres.uhfdkcaxftcctnitqjvo:1611****aka@db.uhfdkcaxftcctnitqjvo.supabase.co:5432/postgres?sslmode=require',
  'postgresql://postgres.uhfdkcaxftcctnitqjvo:1611****aka@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require',
  'postgresql://postgres.uhfdkcaxftcctnitqjvo:1611****aka@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?pgbouncer=true&sslmode=require'
].filter(Boolean);
```

Three distinct endpoints are exposed (direct 5432, pooler 6543, pooler 5432), the Supabase project ref `uhfdkcaxftcctnitqjvo` is disclosed, and the account is `postgres` — the **Supabase superuser**, not a least-privilege application role.

**Root cause.** Throwaway connectivity-debugging scripts were committed instead of being kept local. `.gitignore` covers `.env` and `.env.*` but nothing in `scratch/`. `seed-shoqrah.cjs` goes further than leaking: it *actively falls back* to the hardcoded production URL when `DATABASE_URL` is unset, so simply running it locally writes to production.

**Attack scenario.**
1. Attacker obtains repo read access (fork, contractor, leaked laptop, accidental public flip, CI log, or any clone that already exists).
2. `psql 'postgresql://postgres.uhfd…@db.…supabase.co:5432/postgres'` — direct connection.
3. Every application control is now irrelevant. Attacker reads **all tenants'** restaurants, users, `passwordHash`/`pinHash`, orders, payments, audit logs; writes arbitrary rows; grants themselves `PLATFORM_ADMIN`; or drops the database.
4. Because `RestaurantUser.passwordHash` is bcrypt cost-12, hashes resist cracking — but the attacker does not need to crack anything: they can simply `UPDATE` a hash to one they control, or insert a new `PLATFORM_ADMIN` row.

**Impact.** Total loss of confidentiality, integrity and availability across **every tenant**. This is a full platform compromise and a reportable data breach.

**Remediation (P0 — do in this order, today):**

1. **Rotate first, clean second.** In the Supabase dashboard → *Settings → Database → Reset database password*. The exposed credential must be assumed compromised the moment it entered git.
2. **Delete the files:**
   ```bash
   git rm -r --cached scratch/
   printf '\n# Local debugging scratch — never commit\nscratch/\n' >> .gitignore
   git commit -m "security: remove committed database credentials and scratch scripts"
   ```
3. **Purge history** (the credential remains in every past commit until then):
   ```bash
   git filter-repo --path scratch/ --invert-paths   # or BFG --delete-folders scratch
   git push --force-with-lease origin <branch>
   ```
   Coordinate with all clone holders; consider the repo permanently tainted if it was ever public.
4. **Create a least-privilege application role** and stop using `postgres`:
   ```sql
   CREATE ROLE mureeh_app LOGIN PASSWORD '<new-strong-secret>';
   GRANT CONNECT ON DATABASE postgres TO mureeh_app;
   GRANT USAGE ON SCHEMA public TO mureeh_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mureeh_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mureeh_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mureeh_app;
   -- deliberately NOT granted: CREATE, DROP, superuser, replication
   ```
   Point `DATABASE_URL` at `mureeh_app`. Note this requires removing `prisma db push` from the runtime path (see C-03) since the app role can no longer alter schema — which is the correct outcome.
5. **Restrict network access** in Supabase → *Network Restrictions*: allow only Render's egress ranges.
6. **Review Supabase audit logs** for connections from unexpected IPs since the commit date.
7. **Add a pre-commit secret scanner** (`gitleaks protect --staged`) and a CI job (`gitleaks detect`) to make recurrence impossible.

**Regression test:** CI job that fails the build if `gitleaks detect --no-git -s .` reports any finding, plus a grep assertion that no `postgresql://` URL containing an `@` host appears outside `.env.example`.

**Affects existing functionality?** No. The `scratch/` scripts are developer throwaways with no runtime references (verified: nothing in `server/` or `src/` imports them). Rotating the password requires updating the Render/Supabase env var — a config change, not a code change.

---

### 🔴 C-02 — Hardcoded demo-tenant manager credentials, force-reset on every seed run

| Field | Value |
|---|---|
| **Severity** | **CRITICAL** |
| **CVSS 4.0** | **9.1** (`AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:L`) |
| **CWE** | CWE-798 (Hard-coded Credentials), CWE-1392 (Default Credentials) |
| **OWASP** | A07:2021 Identification & Authentication Failures |
| **Files** | `server/db/seed-shoqrah.ts:167-185`, `server/db/seed-ghosn.ts:320-338`, invoked by `server/db/seed.ts:132-133` |
| **Endpoint** | `POST /api/auth/login` |

**Evidence:**

```ts
// server/db/seed-shoqrah.ts:167
const managerEmail = 'manager@shoqrah.com';
await prisma.restaurantUser.upsert({
  where: { email: managerEmail },
  update: {                                   // ← runs on EVERY seed
    restaurantId: restaurant.id,
    passwordHash: bcrypt.hashSync('Password123!', 12),
    role: 'RESTAURANT_MANAGER',
    status: 'ACTIVE',                         // ← un-suspends a disabled account
  },
  create: { /* … same password … */ },
});
```

Identical pattern at `server/db/seed-ghosn.ts:320` for `manager@ghosncafe.com`. Both tenants are provisioned with an **`ACTIVE` `plan-pro` subscription valid for 365 days** (`seed-shoqrah.ts:154-164`).

**Two compounding defects:**

1. **Guessable credentials on a live tenant.** `manager@shoqrah.com` / `Password123!` is a first-guess credential-stuffing hit. It grants full `RESTAURANT_MANAGER` authority over the Shoqrah tenant: read/modify menu, prices, staff, branding, orders, the POS payment ledger, and the ability to create further staff accounts.

2. **`update` clause makes remediation self-reverting.** Because `upsert.update` unconditionally rewrites `passwordHash`, `role` and `status`, an operator who responsibly changes the password or suspends the account has that change **silently reverted on the next seed run**. Combined with C-03 (seed runs on every container boot), the weak password is *restored every single deploy*.

**Direct contradiction of documented state.** `server/db/seed.ts:14-17` claims:

> *"Restaurants (tenants) are NEVER seeded here — each tenant is created exclusively through the real onboarding flow … so there is no mock/demo tenant data anywhere in the system."*

Lines 132-133 of that same file then call `seedShoqrahCafe()` and `seedGhosnCafe()`. Note also that the platform admin in the same file (`seed.ts:22-26`) correctly reads from `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD` env vars and throws if absent — the demo seeds simply ignore that established pattern. `git log` shows both seeds arrived in `24c59bc`, i.e. **after** the 2026-09-07 hardening that removed demo backdoors.

**Attack scenario.** Attacker enumerates tenants via the public catalog (`GET /api/public/restaurants/shoqrah` → 200, tenant confirmed) → tries `manager@shoqrah.com` / `Password123!` → authenticated as manager. `loginLimiter` (20 failures / 15 min) does not help: this succeeds on attempt one. From there: exfiltrate the customer order history, tamper with menu prices, mint a new manager account for persistence, or pivot to the payment ledger.

**Remediation (P0):**

If Shoqrah and Ghosn are **real customers**, they must be onboarded through `POST /api/admin/onboard-restaurant` like every other tenant. If they are **demos**, they must not use a memorable shared password and must not exist in production.

```ts
// server/db/seed-shoqrah.ts — replace the manager block
const managerEmail = process.env.SHOQRAH_MANAGER_EMAIL?.trim().toLowerCase();
const managerPassword = process.env.SHOQRAH_MANAGER_PASSWORD;

if (managerEmail && managerPassword) {
  if (managerPassword.length < 12) {
    throw new Error('SHOQRAH_MANAGER_PASSWORD must be at least 12 characters');
  }
  await prisma.restaurantUser.upsert({
    where: { email: managerEmail },
    // Never rewrite credentials, role or status for an existing account:
    // an operator's password change / suspension must survive re-seeding.
    update: { restaurantId: restaurant.id },
    create: {
      restaurantId: restaurant.id,
      name: 'مدير الشقرة كافيه',
      email: managerEmail,
      passwordHash: await bcrypt.hash(managerPassword, 12),
      role: 'RESTAURANT_MANAGER',
      status: 'ACTIVE',
    },
  });
} else {
  console.warn('⚠️ Shoqrah manager not provisioned (env credentials absent) — menu data only.');
}
```

Apply the same change to `seed-ghosn.ts`. Then **immediately rotate the passwords of both live accounts** and audit `AuditLog` for `LOGIN` events on those two user IDs from unrecognised IPs.

**Regression test:**
```ts
it('never hardcodes credentials in seeds', async () => {
  const files = ['server/db/seed-shoqrah.ts', 'server/db/seed-ghosn.ts', 'server/db/seed.ts'];
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    expect(src).not.toMatch(/bcrypt\.hashSync\(\s*['"][^'"]+['"]/);
    expect(src).not.toMatch(/Password123|password123|admin123/i);
  }
});
it('seed update clause never rewrites passwordHash/role/status', async () => {
  const src = await readFile('server/db/seed-shoqrah.ts', 'utf8');
  const update = src.slice(src.indexOf('update: {'), src.indexOf('create: {'));
  expect(update).not.toMatch(/passwordHash|role:|status:/);
});
```

**Affects existing functionality?** The two demo managers can no longer log in with the old password — intended. Menu/table/category seeding is untouched.

---

### 🔴 C-03 — Container boots with `prisma db push --accept-data-loss` and re-seeds production

| Field | Value |
|---|---|
| **Severity** | **CRITICAL** |
| **CVSS 4.0** | **8.6** (`AV:N/AC:H/AT:P/PR:N/UI:N/VC:L/VI:H/VA:H`) |
| **CWE** | CWE-16 (Configuration), CWE-1188 (Insecure Default), CWE-665 (Improper Initialization) |
| **OWASP** | A05:2021 Security Misconfiguration; A08 Software & Data Integrity Failures |
| **Files** | `Dockerfile:35`; also `package.json:9-10`, `render.yaml:5` |

**Evidence:**

```dockerfile
# Dockerfile:35
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npm run db:seed && npx tsx server/index.ts"]
```
```json
// package.json:9-10
"start":        "npx prisma db push && tsx server/index.ts",
"start:server": "prisma db push && tsx server/index.ts",
```
```yaml
# render.yaml:5
buildCommand: npm ci && npx prisma generate && npx prisma db push
```

**This directly contradicts both the in-code comment and the fixes document.** `server/index.ts:290-292` states:

> *"NOTE: schema migrations are applied by the deploy pipeline (`prisma migrate deploy`). The server NEVER runs `db push` on boot: `--accept-data-loss` on a production database is a data-loss gun."*

And `SECURITY_FIXES_APPLIED_2026-09-07.md` §H-07 claims *"إزالة `db push --accept-data-loss` من الإقلاع والسكربتات"* ("removed from boot and scripts"). **It was not removed** — it is present in the Dockerfile CMD, and plain `db push` remains in both `start` scripts and the Render build command. A committed migration exists (`prisma/migrations/20260908104200_init/`), so `prisma migrate deploy` is the available correct path and is simply not being used.

**Three distinct failure modes:**

1. **Silent destructive schema reconciliation.** `--accept-data-loss` authorises Prisma to `DROP COLUMN`/`DROP TABLE` to force the DB to match `schema.prisma`. Any drift — a hotfix column, a rolled-back deploy running an older schema, a manual index — is destroyed without confirmation. On container restart. Unattended.
2. **Credential reset on every boot.** `npm run db:seed` → `seedDatabase()` → the C-02 upserts. Every restart (crash-loop, autoscale, redeploy) resets both demo managers to `Password123!` and re-`ACTIVE`s them. It also rewrites the entire `Plan` catalogue (`seed.ts:88-96`), reverting any pricing/limit/entitlement changes made through the admin portal.
3. **Boot-time coupling to seed secrets.** `seedDatabase()` throws if `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD` are absent (`seed.ts:24-26`), meaning the container **cannot start** without long-lived admin credentials mounted into the runtime environment — expanding secret exposure for no operational benefit.

**Attack scenario.** No attacker is strictly required — a crash-loop is sufficient to reset credentials and revert plan pricing. An attacker who can induce a restart (resource-exhaustion via the unpaginated endpoints in M-04, or simply waiting for a routine deploy) gets `Password123!` re-armed on demand, defeating any manual password rotation performed under C-02.

**Remediation (P0):**

```dockerfile
# Dockerfile:35 — run migrations, never push; never seed at runtime
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx server/index.ts"]
```
```json
// package.json — remove db push from the runtime path
"start":        "prisma migrate deploy && tsx server/index.ts",
"start:server": "prisma migrate deploy && tsx server/index.ts",
"db:migrate":   "prisma migrate deploy",
"db:push":      "prisma db push",
```
```yaml
# render.yaml — build must not touch the database schema
buildCommand: npm ci && npx prisma generate
startCommand: npm run start:server
```

Seeding becomes a deliberate, one-time operator action via Render Shell (`npm run db:seed` for a brand-new database, `npm run db:provision-admins` for credential rotation — the latter already exists and is the correct tool). Once C-01's least-privilege role is in place, the app role will lack DDL rights, making accidental schema mutation structurally impossible; run `migrate deploy` as a separate job with an elevated migration role.

**Regression test:**
```ts
it('no deployment artifact runs db push or seeds at runtime', async () => {
  const docker = await readFile('Dockerfile', 'utf8');
  expect(docker).not.toMatch(/accept-data-loss/);
  expect(docker).not.toMatch(/db:seed/);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  for (const s of ['start', 'start:server']) {
    expect(pkg.scripts[s]).not.toMatch(/db push/);
  }
  const render = await readFile('render.yaml', 'utf8');
  expect(render).not.toMatch(/db push/);
});
```

**Affects existing functionality?** Deploys now require a committed migration for schema changes (correct practice; the workflow is `prisma migrate dev` locally → commit → `migrate deploy` in CI). First deploy after this change must confirm the migration baseline matches the live schema (`prisma migrate resolve --applied 20260908104200_init` if needed).

---

## 3. HIGH FINDINGS

### 🟠 H-01 — QR `sessionToken` transmitted in URL query string and written to access logs

| | |
|---|---|
| **CVSS 4.0** | 7.1 · **CWE-598** (Sensitive Query String), CWE-532 (Log Exposure) · OWASP A09 |
| **File** | `server/routes/public.ts:46`; log config `server/index.ts:97-102` |
| **Endpoint** | `GET /api/public/events?restaurantId=…&tableId=…&sessionToken=…` |

`server/index.ts:97` installs a morgan token that redacts **only** `token=`:

```js
morgan.token('url', (req) => (req.originalUrl || req.url || '')
  .replace(/([?&])token=[^&\s]*/g, '$1token=[REDACTED]'));
```

The SSE endpoint reads `req.query.sessionToken` (`public.ts:46`), which is **not** matched by that regex — `sessionToken=sess-<uuid>` is written verbatim into `combined` access logs. The same capability also lands in reverse-proxy logs, browser history and any `Referer` header.

That token is a **bearer capability**: possession alone authorises reading the table's live order stream (`public.ts:90-94`), cancelling its orders and calling its waiter (`public.ts:739`, `public.ts:806`, `public.ts:860`). It is valid for 6 hours (`public.ts:355`).

**Attack scenario.** Anyone with log read access (support engineer, log-aggregation vendor, compromised Render account, leaked log bundle) replays a captured `sessionToken` within the 6-hour window to hijack another diner's table session — reading their orders and cancelling them.

**Fix.** Extend the redaction to every credential-bearing parameter:

```js
const SENSITIVE_QS = /([?&])(token|sessionToken|qrToken|pin|password)=[^&\s]*/gi;
morgan.token('url', (req) =>
  (req.originalUrl || req.url || '').replace(SENSITIVE_QS, '$1$2=[REDACTED]'));
```

Longer term, prefer the `Last-Event-ID` header or a short-lived single-use ticket exchanged for the stream, since `EventSource` cannot set headers. Also shorten `TableSession.expiresAt` from 6h to ~2h and rotate on settle (settle already closes sessions — `manager.ts:747-757` — which is good).

**Test:** assert the morgan token output for `/api/public/events?sessionToken=sess-abc` contains `[REDACTED]` and not `sess-abc`.

---

### 🟠 H-02 — Self-service plan upgrade grants a paid subscription with no payment

| | |
|---|---|
| **CVSS 4.0** | 6.9 · **CWE-840** (Business Logic Errors), CWE-602 · OWASP API6:2023 |
| **File** | `server/routes/manager.ts:1838-1908` |
| **Endpoint** | `PUT /api/manager/subscription/plan` |

```ts
const subscription = await prisma.subscription.upsert({
  where: { restaurantId },
  create: { restaurantId, planId, status: 'ACTIVE',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000) },
  update: { planId },                     // ← immediate, unconditional
});
```

Any `RESTAURANT_MANAGER` can `PUT {"planId":"plan-enterprise"}` and instantly receive Enterprise entitlements (`CAN_CREATE_BRANCH`, `CAN_USE_ANALYTICS`, `CAN_EXPORT_REPORTS`, `CAN_USE_CUSTOM_DOMAIN`, 999 tables/categories/products) for 30 days at zero cost, repeatable indefinitely. There is no payment gateway, no invoice, no admin approval, and no `PAST_DUE` enforcement anywhere in the codebase.

The guards that *are* present are correct as far as they go — the free trial is properly restricted to platform admins (`manager.ts:1848-1855`, one-per-tenant via `evaluateTrialActivation`), and downgrade is blocked when existing data exceeds the target plan's limits (`manager.ts:1857-1874`). The gap is purely that **upgrades are free**.

**Impact:** direct revenue loss; entitlement model is advisory only. Given `plan-enterprise` is priced at 850/month, this is a material finding for the business even though it does not breach confidentiality.

**Fix.** Until a payment provider exists, make paid-plan changes an admin-approved action:

```ts
// Tenant-initiated upgrades create a request; only platform admins activate.
if (!isPlatformUser(req)) {
  await logAuditEvent({ restaurantId, userId: req.user!.id, actor: req.user!.name,
    actorRole: req.user!.role, action: 'PLAN_CHANGE_REQUESTED',
    entity: 'Subscription', entityId: restaurantId,
    details: `طلب ترقية إلى الباقة ${plan.name}` });
  return res.status(202).json({ success: false,
    error: 'تم استلام طلب الترقية. سيتواصل فريق المنصة لإتمام الاشتراك والدفع.',
    statusCode: 202 });
}
// platform admin path continues to the upsert unchanged
```

When a gateway is integrated, activate only from a **signature-verified webhook** (see §Webhook Security), never from a client request. Also add a scheduled job to move subscriptions past `currentPeriodEnd` to `PAST_DUE` and degrade entitlements — currently nothing ever expires a subscription.

**Affects existing functionality?** Managers can no longer self-upgrade; platform admins retain full control. The frontend `SubscriptionView` should surface the 202 as "request received".

---

### 🟠 H-03 — `TRUST_PROXY` unset on Render: all rate limiting collapses to a single shared bucket

| | |
|---|---|
| **CVSS 4.0** | 6.5 · **CWE-348** (Use of Less Trusted Source), CWE-307 · OWASP A05 |
| **Files** | `render.yaml:7-40` (no `TRUST_PROXY` entry); `server/config.ts:26`, `server/index.ts:27` |

`config.ts:26` defaults `TRUST_PROXY` to `0`, and `.env.example:23` documents `TRUST_PROXY=0` with the note *"Render/Nginx = 1"*. But `render.yaml` — the actual production manifest — **declares no `TRUST_PROXY` variable at all**, so the deployed service runs with `app.set('trust proxy', 0)` behind Render's load balancer.

Consequence: `req.ip` resolves to the **proxy's** address for every request. `express-rate-limit` keys on `req.ip`, so all seven limiters (`loginLimiter`, `pinLimiter`, `publicOrderLimiter`, `waiterCallLimiter`, `qrSessionLimiter`, `uploadLimiter`, `onboardLimiter`) share **one global bucket**:

- **Availability:** a single attacker exhausts `pinLimiter` (10 failures / 15 min) and **locks out staff PIN login platform-wide**. Same for login: 20 failed attempts globally blocks all tenants' managers for 15 minutes. Trivial, cheap DoS.
- **Audit integrity:** `AuditLog` records the proxy IP for every event, so `LOGIN` and `TENANT_ACCESS_DENIED` entries cannot attribute an actor.

The defaulting logic itself is sound (fail-safe-by-default is the right call for a directly exposed server); the defect is that the production manifest never overrides it.

**Fix:**
```yaml
# render.yaml — under the restaurant-api service envVars
      - key: TRUST_PROXY
        value: "1"
      - key: FRAME_ANCESTORS
        value: "'self'"
```
Add a boot-time warning to catch this class of misconfiguration:
```ts
// server/index.ts, after app.set('trust proxy', …)
if (isProd && config.trustProxy === 0) {
  console.warn('⚠️ TRUST_PROXY=0 in production — if a reverse proxy is in front of this ' +
               'service, ALL rate limits share one bucket and audit IPs are wrong.');
}
```
Set to the exact number of proxies (Render = 1); never a boolean `true`, which would trust an attacker-supplied `X-Forwarded-For` chain.

For multi-instance deployments, the in-memory limiter store is also per-process (correctly documented at `rateLimit.ts:7-10`) — move to a Redis store before horizontal scaling.

**Test:** integration test asserting that with `TRUST_PROXY=1`, two requests carrying different `X-Forwarded-For` values receive independent `RateLimit-Remaining` counters.

---

### 🟠 H-04 — Unvalidated URL fields (`promoVideoUrl`, `galleryImages`) reach `<iframe>`/`<video>` sinks

| | |
|---|---|
| **CVSS 4.0** | 6.3 · **CWE-20**, CWE-79, CWE-1021 (UI Redress) · OWASP A03 |
| **Files** | `server/validation/schemas.ts:455-456` (schema) → `src/components/customer/CustomerHero.tsx:63,71` (sink) |
| **Endpoint** | `PUT /api/manager/branding` |

`brandingSchema` validates `logo` and `coverImage` with the `httpsUrl()` helper (`schemas.ts:59-77`, which enforces `http:`/`https:`/relative/`data:image/`), but `promoVideoUrl` and `galleryImages` are validated only for **length**:

```ts
promoVideoUrl: z.string().trim().max(1000).optional().or(z.literal('')),
galleryImages: z.array(z.string().trim().max(1000)).max(30).optional(),
```

Both flow to the public customer menu unfiltered:

```tsx
// CustomerHero.tsx:61-74
{promoVideo.includes('youtube.com') || promoVideo.includes('youtu.be') ? (
  <iframe src={`${promoVideo.replace('watch?v=', 'embed/')}?autoplay=1&muted=0`}
          allow="autoplay; encrypted-media" allowFullScreen />
) : (
  <video src={promoVideo} controls autoPlay />
)}
```

A malicious or compromised tenant manager sets `promoVideoUrl` to `https://evil.test/x?a=youtube.com` — the naive `.includes()` check passes and an **attacker-controlled origin is framed inside the restaurant's menu page**, served from the platform's own domain. Every diner scanning that restaurant's QR loads it. Uses: pixel-perfect phishing overlay ("session expired, re-enter card"), drive-by content, or clickjacking of the ordering UI.

The blast radius is bounded by three existing controls, which is why this is High and not Critical: CSP `frameAncestors` limits who can frame *Mureeh*, `objectSrc: 'none'` and `scriptSrc: 'self'` prevent script execution in the parent document, and React 19 neutralises `javascript:` URLs. But CSP `defaultSrc: 'self'` does **not** currently constrain `frame-src`/`media-src` to a safe list — `frame-src` falls back to `default-src 'self'`, which would actually block the cross-origin iframe at runtime… **only if** the CSP is being applied to the SPA response. Since the SPA is served by `express.static` under the same helmet middleware, the iframe should be blocked in a correctly configured deployment — making this defence-in-depth. It must still be fixed, because the validation gap is real and any CSP relaxation (e.g. adding YouTube to `frame-src`, which the product will need) immediately makes it exploitable.

**Fix — validate at the boundary and allow-list the embed host:**

```ts
// server/validation/schemas.ts
const EMBED_HOSTS = new Set([
  'www.youtube.com', 'youtube.com', 'youtu.be',
  'www.youtube-nocookie.com', 'player.vimeo.com', 'vimeo.com',
]);

const embedUrl = (label: string) =>
  z.string().trim().max(1000)
    .refine((v) => {
      if (!v) return true;
      try {
        const u = new URL(v);
        if (u.protocol !== 'https:') return false;
        return EMBED_HOSTS.has(u.hostname) || /\.(mp4|webm|ogg)$/i.test(u.pathname);
      } catch { return false; }
    }, { message: `${label} يجب أن يكون رابط يوتيوب/فيميو أو ملف فيديو MP4 عبر HTTPS` })
    .optional().or(z.literal(''));

// in brandingSchema:
promoVideoUrl: embedUrl('رابط الفيديو التعريفي'),
galleryImages: z.array(httpsUrl('رابط الصورة').unwrap()).max(30).optional(),
```

Harden the sink too — parse the host instead of substring-matching, and sandbox the frame:

```tsx
const embed = useMemo(() => {
  try {
    const u = new URL(promoVideo);
    if (u.protocol !== 'https:') return null;
    if (u.hostname.endsWith('youtube.com'))
      return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${u.searchParams.get('v')}` };
    if (u.hostname === 'youtu.be')
      return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed${u.pathname}` };
    return { kind: 'video', src: u.toString() };
  } catch { return null; }
}, [promoVideo]);
// …
{embed?.kind === 'iframe' && (
  <iframe src={embed.src} sandbox="allow-scripts allow-same-origin allow-presentation"
          referrerPolicy="no-referrer" allow="autoplay; encrypted-media" allowFullScreen />
)}
```

And tighten CSP explicitly rather than relying on `default-src` fallback:
```ts
frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
mediaSrc: ["'self'", 'https:', 'blob:', 'data:'],
```

---

### 🟠 H-05 — `POST /api/manager/tables/:id/settle` has no body validation and bypasses cash reconciliation

| | |
|---|---|
| **CVSS 4.0** | 6.1 · **CWE-20**, CWE-840 · OWASP API3:2023 |
| **File** | `server/routes/manager.ts:651-800` |

Every other mutating manager route is wrapped in `validateBody(...)`. This one is not:

```ts
router.post('/tables/:id/settle', requireCashierOrManager(), async (req, res) => {
  const { paymentMethod, note } = req.body as { paymentMethod?: string; note?: string };
  const paidMethod = paymentMethod || 'CASH';
```

Two consequences:

1. **Unvalidated ledger writes.** `paymentMethod` is written straight into `Payment.method` (`manager.ts:704`) and `Order.paymentMethod` (`manager.ts:692`). The sibling `POST /api/manager/payments` route correctly constrains this to `z.enum(['CASH','CARD','MOBILE','SPLIT'])` via `paymentCreateSchema`. Here, any string up to the 1 MB body limit is persisted — corrupting financial reporting, breaking the `METHOD_LABELS` lookup in the POS UI, and injecting arbitrary text into printed receipts (escaped at render, so not XSS, but still attacker-controlled content on a customer-facing document). `note` is likewise unbounded.

2. **Cash reconciliation bypass.** `POST /api/manager/payments` enforces that a `CASH` payment records sufficient tendered cash (`manager.ts:2258-2266`) — a deliberate control from the previous remediation. The settle route marks **all** unpaid orders on the table `PAID` (`manager.ts:684-697`) with `cashReceived: total` assumed and **no such check**. A cashier can zero out a table's outstanding balance through the settle path without ever reconciling cash, and the audit trail records a clean settlement.

Tenant isolation on this route is correct (`ownTenant` check at `manager.ts:657`), so this is an integrity/fraud issue rather than a cross-tenant one.

**Fix:**

```ts
// server/validation/schemas.ts
export const tableSettleSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS).optional().default('CASH'),
  cashReceived: moneySchema.optional(),
  note: optionalText(500),
}).strict();

// server/routes/manager.ts:651
router.post('/tables/:id/settle',
  requireCashierOrManager(),
  validateBody(tableSettleSchema),
  async (req, res) => {
    const { paymentMethod, cashReceived, note } = req.body as {
      paymentMethod: 'CASH'|'CARD'|'MOBILE'|'SPLIT'; cashReceived?: number; note?: string };
    // … after computing `total` from unpaidOrders:
    if (paymentMethod === 'CASH') {
      if (cashReceived === undefined || !Number.isFinite(cashReceived) || cashReceived < total) {
        return res.status(400).json({ success: false,
          error: 'مبلغ المقبوض النقدي مطلوب ويجب ألا يقل عن قيمة الفاتورة', statusCode: 400 });
      }
    }
```

Also wrap the settle path's four sequential writes (`order.updateMany`, `table.update`, `tableSession.updateMany`, `waiterRequest.updateMany` at `manager.ts:724-770`) in the existing `prisma.$transaction` alongside the payment create, so a mid-sequence failure cannot leave orders `PAID` while the table stays `OCCUPIED`.

**Affects existing functionality?** The POS "settle table" button must now send `cashReceived` for cash settlements — a small frontend change in `CashierPOSView`, mirroring what the `/payments` flow already does.

---

## 4. MEDIUM FINDINGS

### 🟡 M-01 — Manager read endpoints are not role-gated (horizontal over-exposure within a tenant)
**CVSS 5.4 · CWE-285 · OWASP API5:2023 · `server/routes/manager.ts:141, 249, 543, 846, 969, 1257, 1676`**

`router.use(requireAuth)` (`manager.ts:133`) is the only gate on several reads. Write routes correctly add `requireManager()` / `requireCashierOrManager()`, but these do not:

| Endpoint | Line | Exposes to any authenticated staff (incl. `WAITER`, `KITCHEN`, `STAFF`) |
|---|---|---|
| `GET /dashboard/stats` | 141 | Total revenue, AOV, order counts, popular products, **subscription & plan details** |
| `GET /orders` | 249 | Full order history with totals |
| `GET /tables` | 543 | All tables **including `qrToken`** |
| `GET /menu/categories` | 846 | Menu structure |
| `GET /menu/products` | 969 | Full menu with cost-relevant fields |
| `GET /waiter-requests` | 1257 | All requests |
| `GET /offers` | 1676 | All offers |

Tenant isolation holds throughout (`getTenantId` is JWT-first, and `ownTenant` is checked on most of these), so this is **not** a cross-tenant leak. The issue is least-privilege within a tenant: a kitchen tablet account can read the restaurant's complete financial position. `GET /tables` leaking `qrToken` (`manager.ts:568`) is the sharpest edge — a departing waiter can retain every table's QR capability token and later mint guest sessions remotely; note that `POST /tables/:id/regenerate-qr` is correctly manager-only, so rotation is available as a response.

**Fix:** apply `requireServiceStaff()` to operational reads (`/orders`, `/tables`, `/waiter-requests`, menu reads — KDS and waiters legitimately need these) and `requireManager()` to commercially sensitive ones (`/dashboard/stats`, `/offers`). Strip `qrToken` from the `GET /tables` projection for non-managers:

```ts
const isMgr = req.user!.role === 'RESTAURANT_MANAGER' || isPlatformUser(req);
const formatted = tables.map((t) => ({ /* … */ ...(isMgr ? { qrToken: t.qrToken } : {}) }));
```

---

### 🟡 M-02 — No pagination on any list endpoint; unbounded in-memory aggregation
**CVSS 5.3 · CWE-770 (Resource Allocation w/o Limits), CWE-400 · OWASP API4:2023 · `manager.ts:141-247, 249-297`; `admin.ts:24-97`**

`GET /dashboard/stats` loads **every non-cancelled order with all its items** into Node memory (`manager.ts:161-166`) and separately **every order item ever created** (`manager.ts:188-192`) to compute popular products in JS. `GET /orders` (`manager.ts:256`) returns the tenant's entire order history with no `take`/`skip`. `GET /admin/overview` loads every order across **all tenants** (`admin.ts:48-51`).

`GET /payments` is the only endpoint with a cap (`take: 500`, `manager.ts:2176`) — the correct pattern, applied nowhere else.

Compounding factor: the SPA polls `refreshTenantData()` **every 1.5 seconds** (`src/context/RestaurantContext.tsx:357`) = 40 req/min per open dashboard, and there is deliberately no general rate limiter (documented as a trade-off in `rateLimit.ts`). A busy tenant with a year of orders plus a handful of open dashboards will OOM the single Node process, taking down **all tenants** (shared process). Combined with C-03, an OOM restart re-runs the destructive `db push` + seed.

**Fix:** add cursor pagination and push aggregation into PostgreSQL:
```ts
const take = Math.min(Number(req.query.limit) || 50, 200);
const orders = await prisma.order.findMany({
  where: { restaurantId }, take, skip: Number(req.query.offset) || 0,
  orderBy: { createdAt: 'desc' }, include: { items: true, table: true },
});
// popular products — let the DB do it
const popular = await prisma.orderItem.groupBy({
  by: ['productNameSnapshot'],
  where: { order: { restaurantId, status: { not: 'CANCELLED' } } },
  _sum: { quantity: true, totalPrice: true },
  orderBy: { _sum: { quantity: 'desc' } }, take: 5,
});
// revenue — aggregate, don't materialise
const rev = await prisma.order.aggregate({
  where: { restaurantId, status: { not: 'CANCELLED' } },
  _sum: { total: true }, _count: true, _avg: { total: true },
});
```
Scope dashboard stats to a date window (the field is named `todayOrdersCount` but currently counts *all* orders — a correctness bug as well). Reduce polling to 5–10 s and lean on the existing SSE channel for immediacy.

---

### 🟡 M-03 — Uploaded images returned and stored as base64 data URIs
**CVSS 4.8 · CWE-400 · `server/routes/uploads.ts:100-113`; consumed at `src/components/manager/BrandingSettingsView.tsx:143,179`**

The upload handler writes the file to `uploads/` **and** returns the entire image inline:
```ts
const base64Data = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
return res.json({ data: { url: base64Data, pathUrl: `/uploads/${filename}`, … } });
```
The client uses `data.url` (the base64 blob), which is then persisted into `Restaurant.logoUrl` / `coverImageUrl` / `galleryImages[]` / `Product.imageUrl` — all `String` columns. A 5 MB upload becomes ~6.7 MB of base64 in a **database row**, then ships in full on every public menu fetch (`GET /api/public/restaurants/:slug`) to every diner. With 30 gallery images the payload becomes enormous; row size will also hit PostgreSQL TOAST limits.

The `httpsUrl()` validator explicitly permits `data:image/` (`schemas.ts:66`), so this passes validation by design. Files are also written to disk and **never garbage-collected** — replaced logos accumulate indefinitely (disk exhaustion on the `uploads_data` volume).

**Fix:** return only `pathUrl` and have the client store the path (`absoluteAssetUrl` already resolves it correctly). Remove `data:image/` from `httpsUrl()` once the client is migrated. Add an orphan-sweep job comparing `uploads/` against referenced URLs. Consider `sharp` re-encoding to strip EXIF (geolocation in staff-uploaded photos) and normalise dimensions.

---

### 🟡 M-04 — SSE connection cap is global, not per-tenant or per-IP
**CVSS 4.7 · CWE-770 · `server/services/realtime.ts:12, 15-23`**

`MAX_CLIENTS = 2000` is a single process-wide ceiling. A single anonymous attacker holding one valid QR session (freely obtainable — scan any public QR) opens 2,000 concurrent `EventSource` connections and **starves every other tenant's real-time updates**; subsequent legitimate connections get `503` (`public.ts:107-109`). `qrSessionLimiter` caps session *creation* at 120/15 min but one session token can be reused for unlimited streams.

Secondary: `broadcastToRestaurant` and `broadcastToTable` iterate the full client array on every event — O(n) per broadcast, O(n·m) under load.

**Fix:** per-tenant and per-connection-source caps, plus an index:
```ts
private static readonly MAX_CLIENTS = 2000;
private static readonly MAX_PER_TENANT = 200;
private static readonly MAX_PER_SESSION = 3;
private byTenant = new Map<string, Set<string>>();

public addClient(c: Client & { sessionKey?: string }): boolean {
  if (this.clients.length >= RealtimeService.MAX_CLIENTS) return false;
  const tenantSet = this.byTenant.get(c.restaurantId) ?? new Set();
  if (tenantSet.size >= RealtimeService.MAX_PER_TENANT) return false;
  if (c.sessionKey &&
      this.clients.filter((x) => x.sessionKey === c.sessionKey).length >= RealtimeService.MAX_PER_SESSION)
    return false;
  // …
}
```
Add a heartbeat (`:\n\n` every 30 s) to reap half-open connections — currently only the `close` event removes clients (`realtime.ts:20-22`), so dropped mobile connections linger until TCP timeout.

---

### 🟡 M-05 — Sequential, guessable order identifiers
**CVSS 4.3 · CWE-340 (Predictable Identifiers) · `public.ts:583-610`, `manager.ts:363-390`**

Order IDs are `#1001`, `#1002`, … derived from `max(numericId) + 1`. They are not secrets in the current design (every read path is tenant- or session-scoped, verified), so this is **not** presently an IDOR. But: `POST /api/public/orders/:orderId/cancel` takes the order ID in the path, and its defence rests entirely on the `sessionToken` body check (`public.ts:739-743`). Guessability removes one layer, discloses per-tenant order volume to any diner, and leaks business metrics on printed receipts.

The allocation logic is also fragile: `findMany(take:100)` + `count` + a 25-attempt retry loop + a `Math.random()` fallback (`public.ts:614`). Under concurrency this is a lot of machinery to work around not having a per-tenant sequence.

**Fix:** keep `numericId` (an `autoincrement()` column already exists) as the human-facing receipt number, but make the primary key a UUID:
```prisma
model Order {
  id        String @id @default(uuid())
  numericId Int    @default(autoincrement())
  @@unique([restaurantId, numericId])
}
```
Display `numericId` in the UI; use `id` in URLs. This removes the retry loop entirely.

---

### 🟡 M-06 — `POST /api/auth/login` doubles as an unrestricted staff-PIN oracle
**CVSS 4.6 · CWE-307 · `server/routes/auth.ts:72-98`**

When `pin` is supplied alongside valid credentials, the handler loads **every active PIN-holder in the tenant** and bcrypt-compares against each (`auth.ts:73-88`). Two issues:

- **CPU amplification:** one request triggers *N* bcrypt(cost 10) comparisons. A tenant with 40 staff = 40 hashes ≈ 4 s of CPU on the single-threaded event loop, per request. `loginLimiter` has `skipSuccessfulRequests: true` (`rateLimit.ts:33`), so an attacker with *one* valid credential pair can loop with a wrong PIN — each attempt fails the PIN check but the *request* pattern means the limiter counts it (it's a 401, so it does count) — still, 20 requests × 40 hashes stalls the loop for ~80 s.
- **Cross-role identity switch:** a low-privileged staff member who knows any colleague's PIN and any valid account password can assume that colleague's identity, since the loop matches PINs across the whole tenant rather than binding to the authenticated user.

The dedicated `POST /api/auth/pin` route is tighter (`pinLimiter` at 10/15 min, tenant-scoped, platform roles excluded) — this secondary path in `/login` is the weaker duplicate.

**Fix:** apply `pinLimiter` to `/login` as well when a `pin` is present, and bound the candidate set:
```ts
if (pin && user.restaurantId) {
  const candidates = await prisma.restaurantUser.findMany({
    where: { restaurantId: user.restaurantId, status: 'ACTIVE',
             pinHash: { not: null }, role: { notIn: ['PLATFORM_ADMIN','SUPER_ADMIN'] } },
    take: 100, include: { restaurant: true },
  });
```
Better: deprecate the `pin`-in-`/login` path entirely and route staff switching through `/api/auth/pin`, which already does this correctly.

---

### 🟡 M-07 — No account lockout, no MFA, and no working password-reset path
**CVSS 4.4 · CWE-307, CWE-308 · `server/routes/auth.ts:44, 364-377`**

`loginLimiter` is IP-based only (and currently global — see H-03). There is no per-account failure counter, so distributed credential stuffing against a known email is unthrottled from a botnet. No MFA/TOTP exists for `PLATFORM_ADMIN`, the highest-value role on the platform.

`POST /api/auth/password-reset-request` returns `501` (`auth.ts:364-377`). This is an honest and defensible choice — far better than a fake success — but it means the only recovery path is a manager or platform admin resetting the password, which is itself the C-02 weak point.

**Fix:** add a `failedLoginCount` + `lockedUntil` pair on `RestaurantUser` with exponential backoff (5 failures → 1 min, doubling to 15 min), reset on success. Prioritise TOTP for `PLATFORM_ADMIN`/`SUPER_ADMIN`. Implement reset properly when a mailer exists: single-use token, **store only `sha256(token)`**, 15-minute expiry, invalidate on use, bump `tokenVersion` on completion (the revocation mechanism already exists and works).

---

### 🟡 M-08 — Audit log lacks IP/user-agent and has no integrity protection or retention policy
**CVSS 4.0 · CWE-778 (Insufficient Logging), CWE-117 · OWASP A09 · `server/services/audit.ts:1-32`, `prisma/schema.prisma` (AuditLog)**

The audit service is genuinely good in coverage — `TENANT_ACCESS_DENIED` is recorded on every cross-tenant attempt (`manager.ts:76-86`), and logins, payments, staff changes and plan changes are all captured. Gaps:

- **No `ipAddress` / `userAgent`** columns, so a denied cross-tenant attempt cannot be attributed to a source (worsened by H-03, which makes even `req.ip` useless).
- **Fully mutable** by the application role — an attacker with DB access (C-01) or an app-level RCE erases their trail. No append-only constraint, no hash chaining.
- **No retention or rotation.** `AuditLog` grows unbounded; `GET /admin/audit-logs` hard-caps at 100 rows (`admin.ts:432-439`) with no pagination or filtering, so older events are effectively unreachable through the UI.
- **`details` is free-form interpolated Arabic text** including user-controlled names (e.g. `manager.ts:1219`), so log entries can contain newlines — a log-forging vector for anyone parsing the table as text.

**Fix:** add `ipAddress String?` and `userAgent String?`; populate from `req.ip` / `req.get('user-agent')` (after H-03 is fixed). Sanitise `details` with `.replace(/[\r\n]+/g, ' ')`. Ship logs to an external append-only sink (Sentry/Datadog — `SENTRY_DSN` is already reserved in `.env.example` but unused). Add pagination + `restaurantId`/`action`/date filters to `GET /admin/audit-logs`. Define a retention window (e.g. 12 months) with archival.

---

### 🟡 M-09 — `GET /api/health` fingerprints the stack; SPA fallback masks API 404s
**CVSS 3.7 · CWE-200 · `server/index.ts:170-177, 199-207`**

```ts
res.status(200).json({ status:'healthy', version:'2.0.0', database:'PostgreSQL 17' });
```
Unauthenticated, it discloses the exact application version and database engine version — free reconnaissance for CVE matching. Separately, the Express 5 catch-all (`app.get('/{*splat}')`, `index.ts:200`) returns `index.html` for **any** unmatched GET, so a typo'd API path yields `200 text/html` instead of a JSON `404`, complicating client error handling and monitoring.

**Fix:** reduce the public health payload to `{ status: 'healthy' }`; expose version/DB detail only on an authenticated `/api/admin/health`. Register the SPA fallback so it never shadows the API:
```ts
app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) =>
  res.sendFile(path.join(frontendDistPath, 'index.html')));
```

---

## 5. LOW FINDINGS

| ID | Finding | CWE | Location | Fix |
|---|---|---|---|---|
| **L-01** | **JWT in `localStorage`** — readable by any XSS. Mitigated by strict CSP (`scriptSrc: 'self'`) and no `dangerouslySetInnerHTML` anywhere, so exploitability is low today. | CWE-922 | `src/services/api.ts:44` | Move to `HttpOnly; Secure; SameSite=Strict` cookie + CSRF token; or accept with documented rationale. Requires SSE re-work (cookies do flow with `EventSource`, which would also fix H-01). |
| **L-02** | **7-day JWT lifetime** (`JWT_EXPIRES_IN=7d`) is long for a POS handling payments. Revocation via `tokenVersion` exists and works, limiting impact. | CWE-613 | `.env.example:9`, `config.ts:23` | Reduce to 8–12 h (a shift); add refresh-token rotation for longer sessions. |
| **L-03** | **`crossOriginResourcePolicy: 'cross-origin'`** globally relaxes CORP for all responses, not just `/uploads`. | CWE-942 | `server/index.ts:34-36` | Keep helmet default (`same-site`) globally; set `Cross-Origin-Resource-Policy: cross-origin` only in the `/uploads` `setHeaders` callback. |
| **L-04** | **`styleSrc: 'unsafe-inline'`** in CSP permits injected inline styles (CSS exfiltration, UI redress). Required by Tailwind's runtime style injection. | CWE-1021 | `server/index.ts:41` | Adopt nonce-based styles when the build allows; low priority given `scriptSrc` is strict. |
| **L-05** | **`backup.ts` hardcodes `-h localhost -U postgres -d restaurant_saas`**, which does not match the Supabase deployment; the function is also never called from anywhere in the app. Correctly refuses to run without `DB_PASSWORD` and chmods output `0600`. | CWE-1188 | `server/services/backup.ts:20-27` | Derive host/user/db by parsing `DATABASE_URL`, or delete the module and rely on Supabase PITR. Document which is authoritative. |
| **L-06** | **Frontend slug fallback to `'mureeh'`** — an unrecognised/absent slug silently loads a specific tenant's menu rather than erroring. Legacy `merar`/`marer` aliases also remain. | CWE-1188 | `src/context/RestaurantContext.tsx:372-376` | Render an explicit "restaurant not found" state; drop the hardcoded default and legacy aliases. |

---

## 6. INFORMATIONAL

- **I-01 — No SQL injection surface.** Zero occurrences of `$queryRaw`/`$executeRaw`/`$queryRawUnsafe`/`$executeRawUnsafe` in `server/` (the only match repo-wide is `$queryRaw\`SELECT 1\`` in `src/tests/production.test.ts:82`, a static connectivity probe with no interpolation). All access goes through Prisma's parameterized query builder. **Document this as a deliberate control.**
- **I-02 — No command injection.** No `eval`, `new Function`, `execSync`, or shell `exec`. The single `child_process` use (`backup.ts:22`) is `execFile` with an argv array and no shell — the correct pattern.
- **I-03 — No SSRF surface.** The backend makes no outbound HTTP requests. URL fields are stored and rendered client-side only (see H-04); no server-side fetch, image-import, or URL-preview functionality exists.
- **I-04 — Unused dependencies increase supply-chain surface.** `ws`, `@supabase/supabase-js`, `@supabase/server`, and `qrcode` (server-side) have **zero imports** in `server/` or `src/`. `@supabase/server` is a notably obscure package. Remove them: `npm rm ws @supabase/supabase-js @supabase/server @types/ws`.
- **I-05 — Dependency health is excellent.** `npm audit --omit=dev` → **0 vulnerabilities**. Stack is current (React 19.2, Express 5.2, Prisma 5.22, zod 4.5, helmet 8.3, Vite 8.2). Consider Prisma 6.x on its own schedule (major upgrade — test migrations first). Full test suite: **98 passed, 1 skipped, 9 files**.

---

## 7. VERIFIED CONTROLS (working as intended)

These were independently confirmed against current code and should be preserved under regression test:

| Control | Evidence |
|---|---|
| **No JWT fallback secret** | `config.ts:20-22` — zod requires ≥32 chars; `throw` at `config.ts:33-40` refuses boot. No `\|\| 'secret'` pattern anywhere. |
| **JWT algorithm/iss/aud pinning** | `auth.ts:96-100` — `algorithms:['HS256']`, `issuer`, `audience` all enforced on verify. Blocks `alg:none` and algorithm confusion. |
| **Immediate token revocation** | `RestaurantUser.tokenVersion` compared per request (`auth.ts:121-123`); incremented on logout (`auth.ts:233`), password/PIN/role/status change (`manager.ts:1607`). |
| **Per-request account re-validation** | `auth.ts:107-125` — DB lookup confirms `status === 'ACTIVE'` on every call; suspensions take effect instantly. |
| **Tenant isolation (JWT-first)** | `getTenantId()` (`manager.ts:52-62`) ignores client `restaurantId` for non-platform users; `ownTenant()` (`manager.ts:64-70`) re-checks every row. Applied consistently across ~38 manager routes. |
| **Server-side pricing** | `public.ts:466-560` — every unit price, size modifier and add-on price re-read from DB; client `unitPrice`/`totalPrice` accepted by schema (`schemas.ts:330-336`) but never used. Snapshots taken from DB. |
| **Mass-assignment protection** | All 30+ zod schemas use `.strict()`; unknown keys rejected. No `data: req.body` anywhere — every Prisma write enumerates fields explicitly. |
| **Privilege-escalation prevention** | `TENANT_ASSIGNABLE_ROLES` (`schemas.ts:86-92`) excludes `PLATFORM_ADMIN`/`SUPER_ADMIN`; platform accounts shielded from tenant managers (`manager.ts:1546-1548`); self role/status change blocked (`manager.ts:1563-1569`); last-manager protection (`manager.ts:1572-1590`). |
| **QR capability tokens** | `generateQrToken()` / `generateSessionToken()` use `randomUUID()` (`utils/security.ts:13-19`); no IDs embedded; exact-match lookup only (`public.ts:311`); caller hints must agree (`public.ts:326-332`); rotation closes live sessions (`manager.ts:817-820`). |
| **QR session binding** | Cancel/notes require the session to own the exact order (`public.ts:741`, `public.ts:807`); token travels in POST body, not URL. |
| **File upload hardening** | Memory storage → magic-byte sniff (`uploads.ts:36-68`) → server-generated filename and extension (`uploads.ts:103`); `requireManager()` + `uploadLimiter`; static serving adds `nosniff` + `CSP: sandbox` + forced download for non-images (`index.ts:120-138`). |
| **Payment race protection** | Conditional `updateMany` claim on `paymentStatus:'UNPAID'` inside `$transaction`, count-checked, returning `409` on lost race (`manager.ts:2288-2308`). |
| **Cash reconciliation** (on `/payments`) | Insufficient tendered cash rejected (`manager.ts:2258-2266`). |
| **CORS fail-closed** | Exact allow-list (`index.ts:59-75`); production boot refused when `CORS_ORIGIN` empty (`config.ts:52-56`). No wildcard-with-credentials. |
| **CSP + security headers** | Full directive set incl. `objectSrc:'none'`, `baseUri`, `formAction`, `frameAncestors`; `frameguard: deny` (`index.ts:32-53`). Helmet supplies HSTS, `X-Content-Type-Options`, `Referrer-Policy`. |
| **XSS defence on print paths** | `escapeHtml()` (`utils/security.ts:43-50` server, `utils/formatting.ts` client) applied to every interpolated value in both `document.write` sinks (`OrderManagement.tsx:34-40`, `CashierPOSView.tsx:262-296`); no inline `<script>`. |
| **CSV injection neutralised** | `safeCsvCell()` prefixes `= + - @` with `'` (`utils/security.ts:26-29`); BOM for Arabic; sanitised filename (`manager.ts:1372-1375`). |
| **Error hygiene** | Production 5xx responses collapse to `'Internal Server Error'` (`index.ts:241-245`); malformed JSON returns a generic 400 (`index.ts:227-236`). No stack traces or Prisma internals leaked. |
| **User-enumeration hardening** | Pre-computed `DUMMY_HASH` compared when the account is absent (`auth.ts:21, 61-62`); identical error message for unknown user and wrong password. |
| **Password policy** | bcrypt cost 12 for passwords, 10 for PINs; ≥8 chars; common-password blocklist (`schemas.ts:36-54`). |
| **Plan limits enforced server-side** | `getPlanLimits()` + counts before create for tables/categories/products (`manager.ts:92-111`, enforced at `manager.ts:606`, `manager.ts:869`, `manager.ts:1074`); entitlement gates on export/branding/branches. |
| **Free trial cannot be self-granted** | `isTrialPlan` rejected in the manager route (`manager.ts:1848-1855`); one-per-tenant enforced by `evaluateTrialActivation` (`plans.ts:126-152`). |
| **SSE authorisation** | Staff path fully verifies JWT + freshness + tenant match (`public.ts:54-88`); guest path requires a live QR session (`public.ts:90-94`); table-scoped broadcast (`realtime.ts:42-54`). |
| **Schema integrity** | FKs with explicit `onDelete` (`Cascade`/`SetNull`) on all relations; `@@unique([restaurantId, number])` on `Table`; unique `slug`, `email`, `qrToken`, `sessionToken`, `receiptNumber`; indexes on every `restaurantId` and hot query path. |
| **Secrets hygiene (app code)** | `.gitignore` covers `.env`/`.env.*` with `!.env.example`; `render.yaml` uses `sync: false` for all secrets; `.env.example` contains only placeholders. *(Undermined entirely by C-01 in `scratch/`.)* |

---

## 8. ATTACK PATH ANALYSIS

### AP-1 — Repository access → total platform compromise *(realistic, no application flaw needed)*
```
Read access to repo (fork / contractor / stale clone / CI log)
  └─ C-01: read scratch/test-conn.cjs
      └─ psql postgres://postgres:…@db.<ref>.supabase.co:5432/postgres
          ├─ SELECT * FROM "RestaurantUser"   → all tenants' hashes, emails, PINs
          ├─ SELECT * FROM "Payment","Order"  → complete financial history
          ├─ UPDATE "RestaurantUser" SET role='PLATFORM_ADMIN' WHERE id=<attacker>
          │     └─ log in through the normal UI → full platform admin
          └─ DELETE / DROP                     → total availability loss
```
**Every application-layer control is bypassed.** Likelihood: **High** · Impact: **Critical** · **This is the path that must be closed first.**

### AP-2 — Public tenant enumeration → demo credential → tenant takeover → persistence
```
GET /api/public/restaurants/shoqrah          → 200, tenant exists
  └─ C-02: POST /api/auth/login {manager@shoqrah.com, Password123!}  → 200 + JWT
      ├─ GET  /api/manager/dashboard/stats   → revenue, plan, subscription
      ├─ GET  /api/manager/tables            → M-01: every table's qrToken
      │     └─ mint guest sessions remotely, forever (no rotation triggered)
      ├─ POST /api/manager/staff             → create attacker-owned manager (persistence)
      ├─ PUT  /api/manager/subscription/plan → H-02: free Enterprise entitlements
      └─ PUT  /api/manager/branding          → H-04: hostile iframe on the public menu
                                                → phish every diner who scans the QR
Operator resets the password
  └─ C-03: next container restart re-seeds → Password123! restored → re-entry
```
Likelihood: **High** · Impact: **High** · Note the **self-healing property** of the attack: C-03 defeats manual remediation of C-02.

### AP-3 — Log access → QR session hijack
```
Access to access logs (support / log vendor / compromised Render account)
  └─ H-01: sessionToken=sess-<uuid> logged verbatim
      └─ Within 6h: GET /api/public/events?…&sessionToken=…  → read victim's live orders
                    POST /api/public/orders/:id/cancel        → cancel their food
```
Likelihood: Medium · Impact: Medium

### AP-4 — Availability chain
```
H-03: TRUST_PROXY unset → all rate limits share one bucket
  ├─ 10 bad PINs        → staff PIN login locked out PLATFORM-WIDE (15 min)
  └─ 20 bad logins      → all managers locked out PLATFORM-WIDE (15 min)
M-02: unpaginated /dashboard/stats + 1.5 s polling → OOM the single Node process
  └─ C-03: restart runs `db push --accept-data-loss` + re-seed
      → schema drift destroyed, plan catalogue reverted, demo passwords restored
```
Likelihood: Medium · Impact: High

---

## 9. OWASP MAPPING

### OWASP Top 10 (2021)
| Rank | Category | Status | Findings |
|---|---|---|---|
| A01 | Broken Access Control | 🟡 PARTIAL | M-01 (read gating). Tenant isolation itself: **PASS** |
| A02 | Cryptographic Failures | 🔴 FAIL | **C-01** (cleartext DB creds in VCS), L-01, L-02 |
| A03 | Injection | 🟢 PASS | No SQLi (I-01), no cmd injection (I-02). H-04 = validation gap, CSP-mitigated |
| A04 | Insecure Design | 🟡 PARTIAL | H-02 (no payment gate), M-05, M-07 (no MFA/lockout) |
| A05 | Security Misconfiguration | 🔴 FAIL | **C-03**, H-03, M-09, L-03, L-04 |
| A06 | Vulnerable Components | 🟢 PASS | 0 vulnerabilities; I-04 (unused deps) |
| A07 | Auth Failures | 🔴 FAIL | **C-01**, **C-02**, M-06, M-07 |
| A08 | Software/Data Integrity | 🔴 FAIL | **C-03** (destructive boot), H-05, M-08 |
| A09 | Logging & Monitoring | 🟡 PARTIAL | H-01, M-08 |
| A10 | SSRF | 🟢 N/A | No server-side outbound requests (I-03) |

### OWASP API Security Top 10 (2023)
| Rank | Category | Status | Findings |
|---|---|---|---|
| API1 | Broken Object Level Auth (BOLA) | 🟢 PASS | Per-row `ownTenant()` on every route; verified across all 38 manager endpoints |
| API2 | Broken Authentication | 🔴 FAIL | C-01, C-02, M-06, M-07 |
| API3 | Broken Object Property Level Auth | 🟡 PARTIAL | H-05 (no body validation), M-01 (`qrToken` over-exposure) |
| API4 | Unrestricted Resource Consumption | 🟠 WEAK | M-02, M-04, M-06, H-03 |
| API5 | Broken Function Level Auth | 🟡 PARTIAL | M-01 |
| API6 | Unrestricted Access to Sensitive Business Flows | 🟠 WEAK | **H-02** (free plan upgrade), H-05 |
| API7 | SSRF | 🟢 N/A | I-03 |
| API8 | Security Misconfiguration | 🔴 FAIL | C-03, H-03 |
| API9 | Improper Inventory Management | 🟡 PARTIAL | I-04, M-09; `scratch/` shipped in repo |
| API10 | Unsafe Consumption of 3rd-Party APIs | 🟢 N/A | No third-party API consumption |

---

## 10. SECURITY TEST MATRIX

| # | Category | Test | Result | Sev | Evidence |
|---|---|---|---|---|---|
| 1 | Secrets | DB credentials in VCS | 🔴 **FAIL** | CRIT | `scratch/test-conn.cjs:19`, `test-encoded.cjs:19`, `seed-shoqrah.cjs:9-11` (all `git ls-files` tracked) |
| 2 | Secrets | JWT fallback secret | ✅ PASS | — | `config.ts:20-22,33-40` — boot refused |
| 3 | Secrets | `.env` committed | ✅ PASS | — | only `.env.example`; `.gitignore` correct |
| 4 | AuthN | Hardcoded demo credentials | 🔴 **FAIL** | CRIT | `seed-shoqrah.ts:173`, `seed-ghosn.ts:326` — `Password123!` |
| 5 | AuthN | Demo/backdoor login bypass | ✅ PASS | — | removed; no `demo@` provisioning, no magic PINs |
| 6 | AuthN | JWT `alg:none` / confusion | ✅ PASS | — | `auth.ts:96-100` pins HS256 |
| 7 | AuthN | Missing iss/aud validation | ✅ PASS | — | `auth.ts:98-99` |
| 8 | AuthN | Token revocation on logout | ✅ PASS | — | `tokenVersion` increment, `auth.ts:233` |
| 9 | AuthN | Suspended user keeps access | ✅ PASS | — | per-request DB status check, `auth.ts:117-119` |
| 10 | AuthN | User enumeration via timing | ✅ PASS | — | `DUMMY_HASH`, `auth.ts:21,61` |
| 11 | AuthN | Brute-force / lockout | ⚠️ WARN | MED | IP-only limiter; no per-account lockout (M-07) |
| 12 | AuthN | PIN oracle amplification | ⚠️ WARN | MED | `auth.ts:73-88` (M-06) |
| 13 | AuthN | MFA for platform admin | ⚠️ WARN | MED | not implemented (M-07) |
| 14 | AuthZ | Self-escalation to PLATFORM_ADMIN | ✅ PASS | — | `TENANT_ASSIGNABLE_ROLES`, `schemas.ts:86-92` |
| 15 | AuthZ | Tenant mgr edits platform account | ✅ PASS | — | `manager.ts:1546-1548` |
| 16 | AuthZ | Self role/status change | ✅ PASS | — | `manager.ts:1563-1569` |
| 17 | AuthZ | Last-manager removal | ✅ PASS | — | `manager.ts:1572-1590` |
| 18 | AuthZ | Read endpoints role-gated | ⚠️ WARN | MED | M-01 — 7 endpoints |
| 19 | AuthZ | Write endpoints role-gated | ✅ PASS | — | `requireManager`/`requireCashierOrManager` throughout |
| 20 | Tenancy | `?restaurantId=B` on manager reads | ✅ PASS | — | `getTenantId()` JWT-first, `manager.ts:52-62` |
| 21 | Tenancy | Body `restaurantId=B` on writes | ✅ PASS | — | ignored for non-platform actors |
| 22 | Tenancy | Cross-tenant order status update | ✅ PASS | — | `manager.ts:494-498` |
| 23 | Tenancy | Cross-tenant table settle | ✅ PASS | — | `manager.ts:657` |
| 24 | Tenancy | Cross-tenant product→category | ✅ PASS | — | `manager.ts:1063-1067`, `manager.ts:1188-1193` |
| 25 | Tenancy | Cross-tenant branch/table assign | ✅ PASS | — | `manager.ts:2131-2143` |
| 26 | Tenancy | Cross-tenant CSV export | ✅ PASS | — | `manager.ts:1330` |
| 27 | Tenancy | Cross-tenant SSE subscribe | ✅ PASS | — | `public.ts:76-88` |
| 28 | Injection | SQL injection (raw queries) | ✅ PASS | — | none in `server/` (I-01) |
| 29 | Injection | Command injection | ✅ PASS | — | `execFile` argv only (I-02) |
| 30 | Injection | CSV formula injection | ✅ PASS | — | `safeCsvCell()` |
| 31 | Injection | Prototype pollution | ✅ PASS | — | zod `.strict()`; no deep merge |
| 32 | XSS | Stored XSS via product name | ✅ PASS | — | React escaping + `escapeHtml` on print |
| 33 | XSS | `dangerouslySetInnerHTML` | ✅ PASS | — | zero occurrences |
| 34 | XSS | `document.write` sinks escaped | ✅ PASS | — | `OrderManagement.tsx:34-40`, `CashierPOSView.tsx:262-296` |
| 35 | XSS | Unvalidated URL → iframe/video | ⚠️ WARN | HIGH | H-04 |
| 36 | QR | `?qr=default` bypass | ✅ PASS | — | exact match only, `public.ts:311` |
| 37 | QR | Table-ID / number as token | ✅ PASS | — | `public.ts:311` |
| 38 | QR | Token entropy | ✅ PASS | — | `randomUUID()`, no `Math.random` |
| 39 | QR | Cross-restaurant QR reuse | ✅ PASS | — | `public.ts:326-332` |
| 40 | QR | Session token in URL/logs | 🟠 **FAIL** | HIGH | H-01 |
| 41 | BizLogic | Client-supplied price honoured | ✅ PASS | — | DB re-pricing, `public.ts:466-560` |
| 42 | BizLogic | Negative qty / overflow | ✅ PASS | — | int 1-50, `schemas.ts:315` |
| 43 | BizLogic | Foreign product in order | ✅ PASS | — | `public.ts:459-464` |
| 44 | BizLogic | Free plan upgrade | 🟠 **FAIL** | HIGH | H-02 |
| 45 | BizLogic | Trial self-grant | ✅ PASS | — | `manager.ts:1848-1855` |
| 46 | BizLogic | Plan limit bypass | ✅ PASS | — | server-side counts |
| 47 | BizLogic | Cash reconciliation (`/payments`) | ✅ PASS | — | `manager.ts:2258-2266` |
| 48 | BizLogic | Cash reconciliation (`/settle`) | 🟠 **FAIL** | HIGH | H-05 |
| 49 | BizLogic | Double-payment race | ✅ PASS | — | conditional claim + 409 |
| 50 | Upload | Non-image (HTML/SVG) upload | ✅ PASS | — | magic bytes, `uploads.ts:36-68` |
| 51 | Upload | Path traversal in filename | ✅ PASS | — | server-generated name |
| 52 | Upload | Executable served from origin | ✅ PASS | — | `nosniff` + `CSP: sandbox` + attachment |
| 53 | Upload | Size / rate limits | ✅ PASS | — | 5 MB, 60/hr |
| 54 | Upload | Storage bloat (base64) | ⚠️ WARN | MED | M-03 |
| 55 | API | Mass assignment | ✅ PASS | — | `.strict()` everywhere; no `data: req.body` |
| 56 | API | Body validation coverage | ⚠️ WARN | HIGH | H-05 — `/settle` missing |
| 57 | API | Pagination / unbounded reads | ⚠️ WARN | MED | M-02 |
| 58 | API | Request size limit | ✅ PASS | — | 1 MB JSON |
| 59 | API | Error message leakage | ✅ PASS | — | `index.ts:241-245` |
| 60 | CORS | Wildcard with credentials | ✅ PASS | — | exact allow-list |
| 61 | CORS | Fail-open in production | ✅ PASS | — | boot refused, `config.ts:52-56` |
| 62 | Headers | CSP present | ✅ PASS | — | `index.ts:37-51` |
| 63 | Headers | `frame-ancestors` / frameguard | ✅ PASS | — | `deny` |
| 64 | Infra | Destructive migration on boot | 🔴 **FAIL** | CRIT | C-03 — `Dockerfile:35` |
| 65 | Infra | Seed on every boot | 🔴 **FAIL** | CRIT | C-03 |
| 66 | Infra | `TRUST_PROXY` in production | 🟠 **FAIL** | HIGH | H-03 — absent from `render.yaml` |
| 67 | Infra | DB publicly exposed | ⚠️ WARN | HIGH | Supabase network restrictions unverified (C-01 §5) |
| 68 | Infra | Least-privilege DB user | 🔴 **FAIL** | CRIT | `postgres` superuser (C-01 §4) |
| 69 | Infra | DB SSL/TLS | ✅ PASS | — | `sslmode=require` in all connection strings |
| 70 | Deps | Known vulnerabilities | ✅ PASS | — | `npm audit` → 0 |
| 71 | Deps | Unused packages | ⚠️ WARN | INFO | I-04 |
| 72 | SSE | Unauthenticated subscribe | ✅ PASS | — | `public.ts:96-98` |
| 73 | SSE | Connection limits | ⚠️ WARN | MED | M-04 — global only |
| 74 | Logging | Denied access audited | ✅ PASS | — | `manager.ts:76-86` |
| 75 | Logging | IP / user-agent captured | ⚠️ WARN | MED | M-08 |

**Totals: 48 PASS · 8 FAIL · 19 WARN**

---

## 11. REMEDIATION ROADMAP

### 🔴 P0 — Immediate (before any further production traffic)

| # | Action | Finding | Effort |
|---|---|---|---|
| 1 | **Rotate the Supabase database password** | C-01 | 5 min |
| 2 | `git rm -r --cached scratch/`, add to `.gitignore`, commit | C-01 | 10 min |
| 3 | Purge `scratch/` from git history (`filter-repo`/BFG), force-push, notify clone holders | C-01 | 1 h |
| 4 | Create least-privilege `mureeh_app` role; repoint `DATABASE_URL`; stop using `postgres` | C-01 | 45 min |
| 5 | Enable Supabase network restrictions (Render egress only); review connection logs for anomalies | C-01 | 30 min |
| 6 | Rotate `manager@shoqrah.com` / `manager@ghosncafe.com` passwords; audit their `LOGIN` history | C-02 | 20 min |
| 7 | Move seed manager credentials to env; make `upsert.update` never rewrite `passwordHash`/`role`/`status` | C-02 | 45 min |
| 8 | `Dockerfile` → `prisma migrate deploy && tsx server/index.ts`; drop `--accept-data-loss` and `db:seed` | C-03 | 20 min |
| 9 | Remove `db push` from `package.json` start scripts and `render.yaml` build | C-03 | 15 min |
| 10 | Install `gitleaks` pre-commit hook + CI secret-scan job | C-01 | 30 min |

**Total: ~4.5 hours.**

### 🟠 P1 — High (within one week)

| # | Action | Finding |
|---|---|---|
| 11 | Redact `sessionToken`/`qrToken`/`pin` from access logs; shorten session TTL to 2 h | H-01 |
| 12 | Gate paid plan changes behind platform-admin approval (202 request flow) | H-02 |
| 13 | Set `TRUST_PROXY=1` and `FRAME_ANCESTORS` in `render.yaml`; add boot-time warning | H-03 |
| 14 | Validate `promoVideoUrl`/`galleryImages` (host allow-list); sandbox iframe; add `frameSrc`/`mediaSrc` to CSP | H-04 |
| 15 | Add `validateBody(tableSettleSchema)` + cash reconciliation to `/tables/:id/settle`; wrap writes in a transaction | H-05 |
| 16 | Role-gate the 7 manager read endpoints; strip `qrToken` for non-managers | M-01 |

### 🟡 P2 — Medium (within one month)

| # | Action | Finding |
|---|---|---|
| 17 | Pagination on all list endpoints; move aggregation to SQL (`groupBy`/`aggregate`); scope stats to a date window | M-02 |
| 18 | Return `pathUrl` instead of base64; drop `data:image/` from `httpsUrl()`; add orphan-file sweep | M-03 |
| 19 | Per-tenant / per-session SSE caps + heartbeat reaping | M-04 |
| 20 | UUID primary keys for `Order`; keep `numericId` as the display receipt number | M-05 |
| 21 | Apply `pinLimiter` to `/login` when `pin` present; bound candidate set; deprecate the dual path | M-06 |
| 22 | Per-account lockout with exponential backoff; TOTP for platform admins | M-07 |
| 23 | Add `ipAddress`/`userAgent` to `AuditLog`; sanitise `details`; external append-only sink; paginate `/admin/audit-logs`; retention policy | M-08 |
| 24 | Trim `/api/health`; scope SPA fallback so it never shadows `/api/*` | M-09 |
| 25 | Remove unused deps (`ws`, `@supabase/*`); reconcile `backup.ts` with the real deployment or delete it | I-04, L-05 |

### 🔵 P3 — Low (backlog)

| # | Action | Finding |
|---|---|---|
| 26 | Evaluate `HttpOnly` cookie auth (also resolves H-01 cleanly) | L-01 |
| 27 | Reduce JWT TTL to 8–12 h; add refresh rotation | L-02 |
| 28 | Scope `crossOriginResourcePolicy` to `/uploads` only | L-03 |
| 29 | Nonce-based CSP for styles | L-04 |
| 30 | Remove hardcoded `'mureeh'` slug fallback and legacy aliases | L-06 |
| 31 | Wire `SENTRY_DSN` (reserved in `.env.example`, currently unused) | M-08 |
| 32 | Automate `security-tests/api-security-smoke.mjs` in CI against an ephemeral tenant | — |

---

## 12. FINAL VERIFICATION — do the fixes hold?

A second-pass review of each CRITICAL and HIGH remediation, checking that it closes the issue without opening a new one.

**C-01 (credentials).** Rotation invalidates the leaked secret; history purge removes the artefact; the least-privilege role means even a future leak cannot execute DDL or read `pg_shadow`. *New risk introduced?* The app role loses DDL rights, which **breaks `prisma db push`** — but C-03 removes that from the runtime path anyway, so the two fixes are mutually reinforcing. Migrations must run as a separate elevated job in CI. *Tenant isolation:* unchanged (application-layer). *Verified:* no code imports `scratch/`, so deletion is inert.

**C-02 (demo credentials).** Env-sourced credentials + a non-rewriting `update` clause means an operator's password change survives re-seeding. *New risk?* If the env vars are unset the managers are not provisioned — the `else` branch warns loudly rather than failing silently, and menu data still seeds. *Regression check:* `create` still sets `role: 'RESTAURANT_MANAGER'`, never a platform role, so no escalation path is introduced. *Authorization re-check:* these accounts remain ordinary tenant managers bound by `ownTenant()`.

**C-03 (boot command).** `migrate deploy` is additive-only and refuses to apply a migration that would lose data without an explicit migration file. Removing `db:seed` from boot stops credential/plan-catalogue reversion. *New risk?* A deploy with an un-applied migration will now fail fast instead of silently mutating the schema — the correct failure mode. Requires baselining the existing `20260908104200_init` migration on first deploy (`prisma migrate resolve --applied`). *Availability:* boot no longer requires `PLATFORM_ADMIN_*` secrets, reducing runtime secret exposure.

**H-01 (log redaction).** The widened regex covers every credential-bearing query parameter. *New risk?* Redaction is display-only and cannot affect routing or authorisation. *Residual:* the token still traverses the URL (browser history, `Referer`); the cookie migration in L-01 is the complete fix, tracked as P3.

**H-02 (plan gating).** Returning 202 for tenant-initiated changes preserves the audit trail while removing the free grant. *New risk?* Platform admins retain the direct path — verified `isPlatformUser(req)` is the same helper used consistently elsewhere and derives from the DB-validated JWT role, not a client claim. *Tenant isolation:* the `restaurantId` still resolves via `getTenantId()`, so an admin cannot accidentally upgrade the wrong tenant without passing an explicit `restaurantId`.

**H-03 (`TRUST_PROXY=1`).** Restores per-client rate-limit keying and correct audit IPs. *New risk?* Setting the value too high would let a client spoof `X-Forwarded-For`; `1` matches Render's single proxy exactly, and `config.ts:26` already caps the value at 5 and rejects negatives. Must be re-verified if a CDN is added in front (then `2`).

**H-04 (URL validation).** Host allow-list at the API boundary plus a parsing sink means a hostile origin can no longer be framed. *New risk?* Tenants using a self-hosted MP4 on a custom CDN would be rejected by the host allow-list — the `.mp4|.webm|.ogg` path check preserves that case over HTTPS. *XSS re-check:* `sandbox` without `allow-top-navigation` prevents the frame from navigating the parent; `referrerPolicy="no-referrer"` stops session-URL leakage (relevant given H-01).

**H-05 (settle validation).** `validateBody` + cash check brings `/settle` to parity with `/payments`. *New risk?* The POS UI must now send `cashReceived`; without the frontend change, cash settlements return 400 — deploy both together. *Integrity re-check:* wrapping the four writes in `$transaction` removes the partial-settlement window where orders read `PAID` while the table remained `OCCUPIED`. *Authorization:* `requireCashierOrManager()` + `ownTenant()` unchanged.

**Cross-cutting confirmation.** None of the proposed fixes touches `getTenantId()`, `ownTenant()`, `authenticateToken`, or the zod schemas' `.strict()` posture — the four load-bearing controls. Tenant isolation, authentication, and mass-assignment protection are therefore unaffected by this remediation programme.

---

## 13. CONCLUSION

Mureeh's **application security engineering is good**. The tenant-isolation model (JWT-first resolution with per-row ownership verification) is implemented consistently across roughly 38 manager endpoints and is the platform's strongest asset. Server-side re-pricing, `.strict()` zod validation, magic-byte upload sniffing, HS256-pinned JWTs with `tokenVersion` revocation, and fail-closed CORS are all correct. There is no SQL injection surface and no vulnerable dependency. Whoever performed the 2026-09-07 remediation did real work, and most of it holds up under independent scrutiny.

The platform is nonetheless **not fit for production today**, for reasons that sit almost entirely *outside* the application code:

1. **Live database credentials are in the repository** (C-01), rendering every control above bypassable by anyone with repo access.
2. **Hardcoded demo manager passwords** (C-02) provide a first-guess path into a live tenant.
3. **The container's boot command re-arms defect #2 and can destroy schema on every restart** (C-03) — and directly contradicts both the code comment above it and the previous remediation report.

The gap between what the documentation claims and what the deployment artefacts actually do is the most important lesson here: `SECURITY_FIXES_APPLIED_2026-09-07.md` asserts that `db push --accept-data-loss` was removed from boot and scripts, and `seed.ts` asserts that no demo tenants exist. Neither is true of the current tree. **Security documentation must be verified against artefacts in CI**, not maintained by hand — the regression tests specified in C-02 and C-03 do exactly that and should be merged alongside the fixes.

**The P0 list is approximately 4.5 hours of work.** Once complete, and with the P1 items scheduled, this platform's security posture would move from **58/100 to an estimated 85/100** and be defensible for production use with real tenant data.

---

*Audit performed defensively against source. No production data was read, modified, migrated, or deleted. No destructive testing was executed. The exposed credential was identified by static analysis and was **not** used to connect to any database.*
