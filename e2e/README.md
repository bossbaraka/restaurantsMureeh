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

## 4. Sandbox-only: generating the Prisma client

On a normal machine `npx prisma generate` is enough and nothing below applies.
Two sandbox limitations need a workaround:

1. `binaries.prisma.sh` is unreachable, so the native query/schema engines cannot
   be downloaded.
2. The product schema does not enable the `driverAdapters` preview feature, so a
   WASM-only client (which requires a driver adapter) must be generated from a
   copy of the schema that does.

```bash
# a) add the preview feature to a throwaway copy of the schema
node -e "const fs=require('fs');fs.mkdirSync('e2e/prisma',{recursive:true});\
fs.writeFileSync('e2e/prisma/schema.prisma',fs.readFileSync('prisma/schema.prisma','utf8')\
.replace('provider = \"prisma-client-js\"','provider = \"prisma-client-js\"\n  previewFeatures = [\"driverAdapters\"]\n  output = \"./../../node_modules/.prisma/client\"'))"

# b) point Prisma at dummy engine files so it never downloads
mkdir -p /tmp/dummy-engine
head -c 4096 /dev/urandom > /tmp/dummy-engine/libquery_engine-debian-openssl-3.0.x.so.node
head -c 4096 /dev/urandom > /tmp/dummy-engine/schema-engine
head -c 4096 /dev/urandom > /tmp/dummy-engine/query-engine
chmod +x /tmp/dummy-engine/*

PRISMA_QUERY_ENGINE_LIBRARY=/tmp/dummy-engine/libquery_engine-debian-openssl-3.0.x.so.node \
PRISMA_SCHEMA_ENGINE_BINARY=/tmp/dummy-engine/schema-engine \
PRISMA_MIGRATION_ENGINE_BINARY=/tmp/dummy-engine/schema-engine \
PRISMA_QUERY_ENGINE_BINARY=/tmp/dummy-engine/query-engine \
PRISMA_CLIENT_FORCE_WASM=1 npx prisma generate --schema e2e/prisma/schema.prisma

# c) inject the pg driver adapter into the generated client
npm i --no-save --ignore-scripts @prisma/adapter-pg@5.22.0 pg@8.11.3
node e2e/patch-prisma-client.cjs
```

Always install with `--ignore-scripts` in the sandbox: the project's
`postinstall` runs `prisma generate` (without the overrides above) and would
overwrite the working client. Re-run step (c) after any install — `--no-save`
installs are pruned by the next `npm install`.

## Caveats

- `patch-prisma-client.cjs` only touches the **generated** artifact
  (`node_modules/.prisma/client/index.js`); it never changes `src/` or `server/`.
- Fixture credentials (`Mureeh#Test2026`, the PINs, the test JWT secret) are
  throwaway test values. Never reuse them in a real deployment.
- Finding recorded by the suite: with a production build present in `dist/`, an
  unknown `GET /api/*` path is answered by the SPA fallback (`200 text/html`)
  instead of a JSON `404`. Non-`GET` methods still 404 correctly.
