# Mureeh security regression tests

> **Safety gate:** use this only against a disposable local/staging environment with synthetic tenants. Do **not** run it against production or customer data. The runner rejects a remote target unless an explicit non-production acknowledgement is supplied, and its mutation tests are opt-in.

## What it tests

`api-security-smoke.mjs` is a black-box regression suite for the real HTTP API, written for the **hardened** build (post 2026-09-07 remediation). It verifies the tenant-isolation invariant: a non-platform User A from Tenant A must never observe Tenant B data, no matter how `restaurantId` is tampered with. The hardened API resolves non-platform callers to their own JWT tenant, so a cross-tenant read may answer `200` (own-tenant data), `403` or `404` depending on role and entitlement — the suite asserts the invariant that matters: **zero Tenant-B bytes in any response**.

It also covers session validation, public-slug isolation, QR-token strictness, retired-secret JWT rejection, PIN tenant scoping, removed-backdoor checks, RBAC escalation refusal, method tampering, CORS, upload content filtering, and malformed-JSON error hygiene.

The default mode is **read-only**. It sends no order, no upload, no update, and no deletion request.

### Required test fixture

Create a dedicated test database with:

- Tenant A and a non-platform user (`RESTAURANT_MANAGER`, `WAITER`, etc.), whose JWT is `SECURITY_TEST_TOKEN_A` and whose tenant is `SECURITY_TEST_TENANT_A_ID`.
- Tenant B, whose ID is `SECURITY_TEST_TENANT_B_ID`.
- At least one private operational record for B (order, table, waiter request, staff user, payment) so a leak is detectable.
- A valid Tenant-A table session only when executing the opt-in mutation section.

Never use a platform-admin JWT: cross-tenant access is intentionally permitted for that role.

## Run: read-only isolation and API tests

```bash
SECURITY_TEST_BASE_URL=http://127.0.0.1:3001 \
SECURITY_TEST_TOKEN_A='JWT_FOR_NON_PLATFORM_USER_A' \
SECURITY_TEST_TENANT_A_ID='tenant-a-id' \
SECURITY_TEST_TENANT_B_ID='tenant-b-id' \
node security-tests/api-security-smoke.mjs
```

The process exits non-zero if a security expectation fails. It deliberately does not print bearer tokens or response bodies.

## Run: disposable mutation tests

The following probes can cause a write **only when a vulnerability exists**, so they are intentionally unavailable unless both the CLI option and environment acknowledgement are supplied. Point them only at data that can be discarded and reset.

```bash
SECURITY_TEST_BASE_URL=http://127.0.0.1:3001 \
SECURITY_TEST_TOKEN_A='JWT_FOR_NON_PLATFORM_USER_A' \
SECURITY_TEST_TENANT_A_ID='tenant-a-id' \
SECURITY_TEST_TENANT_B_ID='tenant-b-id' \
SECURITY_TEST_TABLE_A_ID='tenant-a-table-id' \
SECURITY_TEST_QR_SESSION_A='valid-tenant-a-table-session' \
SECURITY_TEST_TABLE_B_ID='tenant-b-table-id' \
SECURITY_TEST_PRODUCT_B_ID='tenant-b-product-id' \
SECURITY_TEST_FOREIGN_PRODUCT_B_ID='tenant-b-product-id' \
SECURITY_TEST_DISPOSABLE=yes \
node security-tests/api-security-smoke.mjs --allow-mutations
```

For a non-local staging host, explicitly acknowledge that it is not production:

```bash
SECURITY_TEST_REMOTE_ACK=I_UNDERSTAND_THIS_IS_A_NON_PRODUCTION_SECURITY_ENVIRONMENT
```

## Full test-case matrix

| ID | Actor / change | Endpoint or operation | Expected secure result |
|---|---|---|---|
| TI-01 | User A changes `restaurantId` to B | `GET /api/manager/dashboard/stats` | own-tenant data only; zero B bytes (status `200`/`403`/`404` by role) |
| TI-02 | User A changes `restaurantId` to B | `GET /api/manager/orders`, `/tables`, `/menu/*` | own-tenant data only; zero B bytes |
| TI-03 | User A changes `restaurantId` to B | `GET /waiter-requests`, `/export/orders`, `/staff`, `/offers`, `/subscription`, `/branches`, `/payments` | denied (`403`/`404`) or own-tenant data; zero B bytes |
| TI-04 | User A changes B resource ID | Update B table / delete B product | `403`/`404`, no write |
| TI-05 | User A requests a create under B | `POST /api/manager/tables` with B ID | `403`/`404`, or `201` scoped to Tenant A — never a B row |
| TI-06 | Anonymous user supplies a table number, table ID, `default`, or invalid QR | `POST /api/public/tables/qr/:token/session` | `400`/`403`/`404`; no session or fallback table |
| TI-07 | Tenant-A table session submits Tenant-B product / client price `0` | `POST /api/public/orders` | `400`; no order created |
| TI-08 | Customer session changes `orderId` / `tableId` | cancel or notes API | `403`/`404` unless the order belongs to the same session |
| TI-09 | A waiter/cashier calls a manager-only endpoint | Staff, branding, plan, menu, table settlement | `403` |
| TI-10 | A tenant manager attempts a platform role field | `PUT /api/manager/staff/:id` `{ role: "PLATFORM_ADMIN" }` | `403`/`400`; role unchanged |
| AU-01 | Valid bearer token | `GET /api/auth/me` and logout | `200`; logout invalidates active session(s) |
| AU-02 | Password/PIN brute force | repeated login/PIN/reset requests | `429` according to documented per-account/IP limits |
| AU-03 | Token after user suspension/password reset/logout | protected manager endpoint | `401`/`403` immediately or after a very short access-token TTL |
| API-01 | Unknown slug | `GET /api/public/restaurants/:slug` | `404`, never another tenant’s data |
| API-02 | Unknown HTTP method | `PATCH /api/manager/orders` | `404`/`405`, no side effect |
| API-03 | Malformed JSON / oversized body | auth and manager endpoints | generic `400`/`413`, no stack/ORM/path detail |
| API-04 | Extra privileged fields | staff/onboarding/branding body | reject unknown fields (`400`) and ignore no privileged field silently |
| XSS-01 | HTML in product name / restaurant name / order note | print invoice/receipt and normal render | literal text only; no executable markup |
| UP-01 | `.html`/`.svg` filename with fake `image/*` MIME | `POST /api/uploads/image` then GET returned URL | upload rejected or re-encoded safe raster; never `text/html`/active SVG |
| SSE-01 | Table A session listens to live stream | `/api/public/events` while Table B generates an event | no B order/table/waiter/payment event or metadata |
| FIN-01 | Cash amount less than total, duplicate concurrent payment, orders from another table | `POST /api/manager/payments` | `400`/`409`; payment state and receipt remain consistent |
| PLAN-01 | Any non-owner changes to Enterprise or exceeds limits | plan/branch/table/product APIs | `403` or approved billing flow; server enforces plan limits |

## CI recommendation

1. Provision a PostgreSQL database dedicated to CI, never a shared or production `DATABASE_URL`.
2. Seed two synthetic tenants through controlled fixtures.
3. Generate non-platform User-A and platform-admin tokens inside the CI job.
4. Run the read-only suite on every pull request; run the mutation suite against an ephemeral database after each deployment.
5. Make every `TI-*`, `AU-*`, `XSS-*`, `UP-*`, `SSE-*`, and `FIN-*` assertion a release gate.
6. Add a teardown that deletes the entire ephemeral database, not individual customer-like rows.
