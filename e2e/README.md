# Employee functional & permission test harness

End-to-end verification of the staff roles against a **real PostgreSQL** and the
**real Express API** — no mocks: every assertion checks the HTTP result *and* the
resulting database rows. Nothing in here is imported by the product.

| File | What it proves |
|---|---|
| `employee-functional-test.mjs` | 703–704 assertions: authentication, the full permission matrix (endpoint × role), per-role scenarios (WAITER/STAFF/CASHIER/RESTAURANT_MANAGER), tenant isolation, data integrity, error handling / information disclosure, public + QR ordering, plan limits & entitlements, order-number allocation |
| `frontend-guard.check.tsx` | 6 behavioural permission checks on the real `AuthProvider` (role tampering in localStorage, boot re-verification, 401 session clearing) |
| `seed-test-data.mjs` | Deterministic fixtures: tenants A/B + a trial tenant C, one user per role, menus, tables, sessions, orders, payments, offers, plan catalog |

## 1. Prepare the database

Use a **throwaway** test database — the seed wipes only its own fixtures, but it
still refuses to run against a database it did not create.

```bash
export DATABASE_URL="postgresql://postgres@127.0.0.1:5432/mureeh_test?schema=public"
npm run db:migrate                 # idempotent migrations
node e2e/seed-test-data.mjs
```

## 2. Start the API server

```bash
cp e2e/server.env.example e2e/server.env    # first time only; thrown-away test values
set -a; . ./e2e/server.env; set +a
npx tsx server/index.ts                     # http://127.0.0.1:3001
```

## 3. Run the suites

```bash
DATABASE_URL="postgresql://postgres@127.0.0.1:5432/mureeh_test?schema=public" \
JWT_SECRET="employee-functional-test-secret-key-change-me-32chars-min" \
API_BASE="http://127.0.0.1:3001" \
npx tsx e2e/employee-functional-test.mjs            # exit 2 if any assertion fails

npm i --no-save --ignore-scripts jsdom @testing-library/react @testing-library/dom
npx vitest run --config e2e/vitest.guard.config.ts  # 6 frontend guard checks

npm test && npm run lint && npm run build           # repository regression
```

**Restart the API server between harness runs.** The login/PIN rate limiters are
in-process, so accumulated 429s would otherwise look like product failures.

## 4. Restricted-network environments (no access to binaries.prisma.sh)

On a normal machine `npx prisma generate` is enough and nothing below applies.

The project runs Prisma 6 with `engineType = "client"` (WASM engine bundled in
`@prisma/client`) and the official `@prisma/adapter-pg` driver adapter, so the
**runtime never needs a native Prisma engine**. `prisma generate` still verifies
the native engines are present in its cache, though — on restricted networks it
fails and the project `postinstall` falls back automatically:

    prisma generate || node scripts/prisma-engine-cache-seed.mjs && prisma generate

`scripts/prisma-engine-cache-seed.mjs` pre-seeds the fetch-engine cache with
placeholder binaries (never executed, since the client uses the WASM engine),
so generation and `npm install` succeed with no network access. Database
migrations use `server/db/deploy-migrations.ts`, which replicates
`prisma migrate deploy` with a direct SQL runner when the Prisma CLI cannot
download its schema engine — identical tracking table, checksums, transactions
and P3005 baselining.

## Caveats

- Fixture credentials (`Mureeh#Test2026`, the PINs, the test JWT secret) are
  throwaway test values. Never reuse them in a real deployment.
- Finding recorded by the suite: with a production build present in `dist/`, an
  unknown `GET /api/*` path is answered by the SPA fallback (`200 text/html`)
  instead of a JSON `404`. Non-`GET` methods still 404 correctly.
