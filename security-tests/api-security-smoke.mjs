#!/usr/bin/env node
/**
 * Defensive black-box security REGRESSION suite for a DISPOSABLE Mureeh
 * environment running the HARDENED API (post 2026-09-07 remediation).
 *
 * What it verifies:
 *  - Tenant isolation holds even when restaurantId is tampered with. The
 *    hardened API resolves non-platform callers to their own JWT tenant, so
 *    a cross-tenant read may answer 200 (own data), 403 or 404 — the
 *    invariant is that ZERO Tenant-B bytes are ever returned.
 *  - The removed backdoors stay removed (demo login, magic PINs,
 *    hard-coded JWT fallback, QR bypasses, client-side pricing).
 *  - RBAC refuses privilege escalation and untrusted roles.
 *
 * Default mode sends read-only requests only. Mutating probes are disabled
 * unless --allow-mutations is passed AND SECURITY_TEST_DISPOSABLE=yes is set.
 * Do not point this program at production.
 */

import { createHmac } from 'node:crypto';

const REMOTE_ACK = 'I_UNDERSTAND_THIS_IS_A_NON_PRODUCTION_SECURITY_ENVIRONMENT';
const expectedTenantDenial = new Set([403, 404]);

function usage(message) {
  if (message) console.error(`\nError: ${message}\n`);
  console.error(`Usage:
  SECURITY_TEST_BASE_URL=http://127.0.0.1:3001 \\
  SECURITY_TEST_TOKEN_A='<Tenant-A JWT (any staff role)>' \\
  SECURITY_TEST_TENANT_A_ID='<Tenant-A ID>' \\
  SECURITY_TEST_TENANT_B_ID='<Tenant-B ID>' \\
  node security-tests/api-security-smoke.mjs

Optional checks (DISPOSABLE data only):
  SECURITY_TEST_DISPOSABLE=yes \\
  SECURITY_TEST_TABLE_B_ID='<Tenant-B table ID>' \\
  SECURITY_TEST_PRODUCT_B_ID='<Tenant-B product ID>' \\
  SECURITY_TEST_QR_SESSION_A='<valid Tenant-A table session token>' \\
  SECURITY_TEST_TABLE_A_ID='<Tenant-A table ID>' \\
  SECURITY_TEST_FOREIGN_PRODUCT_B_ID='<Tenant-B product ID>' \\
  node security-tests/api-security-smoke.mjs --allow-mutations

Remote targets are rejected unless SECURITY_TEST_REMOTE_ACK=${REMOTE_ACK}
This runner never prints bearer tokens or full response bodies.`);
  process.exit(2);
}

const rawBaseUrl = process.env.SECURITY_TEST_BASE_URL;
const tokenA = process.env.SECURITY_TEST_TOKEN_A;
const tenantA = process.env.SECURITY_TEST_TENANT_A_ID;
const tenantB = process.env.SECURITY_TEST_TENANT_B_ID;
const allowMutations = process.argv.includes('--allow-mutations');

if (!rawBaseUrl || !tokenA || !tenantA || !tenantB) {
  usage('SECURITY_TEST_BASE_URL, SECURITY_TEST_TOKEN_A, SECURITY_TEST_TENANT_A_ID and SECURITY_TEST_TENANT_B_ID are required.');
}

let baseUrl;
try {
  baseUrl = new URL(rawBaseUrl);
} catch {
  usage('SECURITY_TEST_BASE_URL is not a valid absolute URL.');
}

if (!['http:', 'https:'].includes(baseUrl.protocol)) {
  usage('Only http(s) targets are supported.');
}

const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (!localHosts.has(baseUrl.hostname) && process.env.SECURITY_TEST_REMOTE_ACK !== REMOTE_ACK) {
  usage('Remote execution needs the explicit non-production acknowledgement.');
}

const apiBase = baseUrl.toString().replace(/\/$/, '');
const authHeaders = { Authorization: `Bearer ${tokenA}` };
const failures = [];
let probes = 0;

function printResult(name, pass, detail) {
  const label = pass ? 'PASS' : 'FAIL';
  console.log(`${label.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures.push(name);
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchOptions = {
    method: options.method || 'GET',
    headers,
    redirect: 'manual',
  };
  if (options.rawBody !== undefined) {
    fetchOptions.body = options.rawBody;
  } else if (options.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${apiBase}${path}`, fetchOptions);
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}

async function tenantDenied(name, path, options = {}) {
  probes += 1;
  try {
    const response = await request(path, { ...options, headers: { ...authHeaders, ...(options.headers || {}) } });
    printResult(name, expectedTenantDenial.has(response.status), `HTTP ${response.status}; expected 403/404`);
  } catch (error) {
    printResult(name, false, `request error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function statusIs(name, path, statuses, options = {}) {
  probes += 1;
  try {
    const response = await request(path, options);
    printResult(name, statuses.has(response.status), `HTTP ${response.status}; expected ${[...statuses].join('/')}`);
  } catch (error) {
    printResult(name, false, `request error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Cross-tenant READ isolation: whatever the status (200 with own-tenant
// data, 403 or 404 depending on role/entitlement), Tenant-B identifiers
// must never appear in the response body.
async function tenantReadIsolated(name, path) {
  probes += 1;
  try {
    const response = await request(path, { headers: authHeaders });
    const serverError = response.status >= 500;
    const leaksB = response.text.includes(tenantB);
    const pass = !serverError && !leaksB;
    printResult(name, pass, `HTTP ${response.status}; Tenant-B bytes ${leaksB ? 'PRESENT' : 'absent'}`);
  } catch (error) {
    printResult(name, false, `request error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Hand-rolled HS256 JWT (no dependencies) for the fallback-secret probe.
function forgeJwt(payload, secret) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`;
  const sig = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

console.log(`Mureeh defensive security regression suite: ${apiBase}`);
console.log('Mode: read-only (except if explicit disposable mutation mode is enabled).\n');

// A valid token must resolve before interpreting authorization results.
await statusIs('Authentication: /api/auth/me accepts a valid bearer token', '/api/auth/me', new Set([200]), { headers: authHeaders });

// Tenant A must never observe Tenant B data merely by replacing
// restaurantId in query parameters.
const tenantEncoded = encodeURIComponent(tenantB);
for (const [name, path] of [
  ['Tenant isolation: dashboard stats', `/api/manager/dashboard/stats?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: orders', `/api/manager/orders?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: tables', `/api/manager/tables?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: menu categories', `/api/manager/menu/categories?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: menu products', `/api/manager/menu/products?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: waiter requests', `/api/manager/waiter-requests?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: CSV order export', `/api/manager/export/orders?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: staff directory', `/api/manager/staff?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: offers', `/api/manager/offers?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: subscription', `/api/manager/subscription?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: branches', `/api/manager/branches?restaurantId=${tenantEncoded}`],
  ['Tenant isolation: payment ledger', `/api/manager/payments?restaurantId=${tenantEncoded}`],
]) {
  await tenantReadIsolated(name, path);
}

// Unknown public slugs must not fall back to a different tenant's menu.
await statusIs('Public isolation: unknown restaurant slug is not remapped', '/api/public/restaurants/security-audit-no-such-slug', new Set([404]));

// QR bypass inputs must never resolve to a table (read-only resolver).
for (const badQr of ['default', '1', encodeURIComponent('rest-a-T01')]) {
  await statusIs(`QR security: '${decodeURIComponent(badQr)}' is not a valid QR token`, `/api/public/tables/qr/${badQr}`, new Set([404]));
}

// PIN login without a tenant scope must be rejected before any lookup.
// Uses a non-magic random PIN so even a vulnerable build performs no write.
await statusIs('AuthN: PIN login without restaurantId is rejected', '/api/auth/pin', new Set([400]), {
  method: 'POST',
  body: { pin: '0713' },
});

// A token minted with the retired hard-coded fallback secret must fail.
{
  const forged = forgeJwt(
    { id: 'security-audit', restaurantId: tenantA, role: 'RESTAURANT_MANAGER', status: 'ACTIVE' },
    'merar_luxury_saas_jwt_secret_key_production_2026'
  );
  await statusIs('AuthN: retired fallback-secret JWT is rejected', '/api/auth/me', new Set([401]), {
    headers: { Authorization: `Bearer ${forged}` },
  });
}

// Method tampering should never silently reach a state-changing handler.
await statusIs('Method tampering: PATCH has no implicit manager handler', '/api/manager/orders', new Set([404, 405]), {
  method: 'PATCH',
  headers: authHeaders,
});

// CORS is a browser boundary. An arbitrary hostile Origin must not receive a
// reflected allow-origin response combined with credentials.
probes += 1;
try {
  const hostileOrigin = 'https://security-audit.invalid';
  const response = await request('/api/health', { headers: { Origin: hostileOrigin } });
  const reflected = response.headers.get('access-control-allow-origin') === hostileOrigin;
  const credentials = response.headers.get('access-control-allow-credentials') === 'true';
  printResult('CORS: hostile Origin is not reflected with credentials', !(reflected && credentials), `HTTP ${response.status}`);
} catch (error) {
  printResult('CORS: hostile Origin is not reflected with credentials', false, `request error: ${error instanceof Error ? error.message : String(error)}`);
}

// Parser errors should expose a generic client-safe message, not a parser,
// filesystem, ORM, or stack detail. This check is read-only.
probes += 1;
try {
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    rawBody: '{not-valid-json',
  });
  const leaksParserDetail = /unexpected token|position \d+|syntaxerror|stack|prisma|postgres|\/home\//i.test(response.text);
  printResult('Error handling: malformed JSON receives a generic error', response.status === 400 && !leaksParserDetail, `HTTP ${response.status}`);
} catch (error) {
  printResult('Error handling: malformed JSON receives a generic error', false, `request error: ${error instanceof Error ? error.message : String(error)}`);
}

if (allowMutations) {
  if (process.env.SECURITY_TEST_DISPOSABLE !== 'yes') {
    usage('--allow-mutations requires SECURITY_TEST_DISPOSABLE=yes.');
  }

  const tableB = process.env.SECURITY_TEST_TABLE_B_ID;
  const productB = process.env.SECURITY_TEST_PRODUCT_B_ID;
  const sessionA = process.env.SECURITY_TEST_QR_SESSION_A;
  const tableA = process.env.SECURITY_TEST_TABLE_A_ID;
  const foreignProductB = process.env.SECURITY_TEST_FOREIGN_PRODUCT_B_ID || productB;
  if (!tableB || !productB || !sessionA || !tableA || !foreignProductB) {
    usage('Mutation mode requires SECURITY_TEST_TABLE_B_ID, SECURITY_TEST_PRODUCT_B_ID, SECURITY_TEST_QR_SESSION_A, SECURITY_TEST_TABLE_A_ID and SECURITY_TEST_FOREIGN_PRODUCT_B_ID (or PRODUCT_B_ID).');
  }

  console.log('\nDisposable mutation probes enabled. Targets must be resettable fixtures.');
  await tenantDenied('Tenant isolation mutation: update Tenant-B table', `/api/manager/tables/${encodeURIComponent(tableB)}`, {
    method: 'PUT',
    body: { restaurantId: tenantB, status: 'MAINTENANCE' },
  });
  await tenantDenied('Tenant isolation mutation: delete Tenant-B product', `/api/manager/menu/products/${encodeURIComponent(productB)}`, {
    method: 'DELETE',
    body: { restaurantId: tenantB },
  });

  // Cross-tenant creation: must be denied, or scoped to the caller's own
  // tenant (JWT-first resolution) — never land in Tenant B.
  probes += 1;
  try {
    const response = await request('/api/manager/tables', {
      method: 'POST',
      headers: authHeaders,
      body: { restaurantId: tenantB, tableNumber: 9999, capacity: 2, zone: 'MAIN_HALL' },
    });
    let landedInB = false;
    if (response.status === 201) {
      try {
        landedInB = JSON.parse(response.text)?.data?.table?.restaurantId === tenantB;
      } catch {
        landedInB = true;
      }
    }
    const pass = expectedTenantDenial.has(response.status) || (response.status === 201 && !landedInB);
    printResult('Tenant isolation mutation: create table cannot land in Tenant B', pass, `HTTP ${response.status}`);
  } catch (error) {
    printResult('Tenant isolation mutation: create table cannot land in Tenant B', false, `request error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Self-promotion: the caller's own user id (from /me) with a platform role.
  // Waiters/cashiers get 403 (RBAC); managers get 400 (role allow-list).
  probes += 1;
  try {
    const me = await request('/api/auth/me', { headers: authHeaders });
    const myId = JSON.parse(me.text)?.data?.user?.id;
    if (!myId) {
      printResult('RBAC: self-promotion is refused', false, 'could not resolve caller id');
    } else {
      const response = await request(`/api/manager/staff/${encodeURIComponent(myId)}`, {
        method: 'PUT',
        headers: authHeaders,
        body: { role: 'PLATFORM_ADMIN' },
      });
      const pass = response.status === 403 || response.status === 400;
      const leaksHash = /passwordHash|pinHash/.test(response.text);
      printResult('RBAC: self-promotion is refused without hash disclosure', pass && !leaksHash, `HTTP ${response.status}`);
    }
  } catch (error) {
    printResult('RBAC: self-promotion is refused without hash disclosure', false, `request error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Removed backdoors stay removed (assert rejection; create nothing).
  await statusIs('Backdoor: demo login is rejected', '/api/auth/login', new Set([401]), {
    method: 'POST',
    body: { email: 'demo@mureeh.com', password: 'demo' },
  });
  await statusIs('Backdoor: magic PIN is rejected', '/api/auth/pin', new Set([400, 401]), {
    method: 'POST',
    body: { pin: '9900', restaurantId: tenantA },
  });

  // A made-up QR capability must never be converted into a valid session for a
  // tenant supplied in the request body.
  await statusIs('QR security: invalid QR cannot create a Tenant-B session', '/api/public/tables/qr/security-audit-invalid-token/session', new Set([400, 403, 404]), {
    method: 'POST',
    body: { restaurantId: tenantB },
  });
  await statusIs("QR security: 'default' cannot open a session", '/api/public/tables/qr/default/session', new Set([400, 403, 404]), {
    method: 'POST',
    body: {},
  });

  // The public ordering API must reject a product from another tenant and must
  // not accept client-controlled pricing. This creates no order when secure.
  await statusIs('Order integrity: foreign product and zero client price are rejected', '/api/public/orders', new Set([400, 403, 404]), {
    method: 'POST',
    body: {
      restaurantId: tenantA,
      tableId: tableA,
      sessionToken: sessionA,
      items: [{ productId: foreignProductB, productName: 'security audit fixture', quantity: 1, unitPrice: 0, totalPrice: 0 }],
    },
  });

  // Upload filter: HTML disguised as an image must be rejected by content
  // (400, managers) or by role (403, non-managers) — never stored.
  probes += 1;
  try {
    const form = new FormData();
    form.append('image', new Blob(['<html><script>alert(1)</script></html>'], { type: 'text/html' }), 'audit.html');
    const response = await fetch(`${apiBase}/api/uploads/image`, {
      method: 'POST',
      headers: authHeaders,
      body: form,
    });
    await response.arrayBuffer();
    printResult('Uploads: disguised HTML is rejected', response.status === 400 || response.status === 403, `HTTP ${response.status}`);
  } catch (error) {
    printResult('Uploads: disguised HTML is rejected', false, `request error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\nCompleted ${probes} probe(s): ${failures.length === 0 ? 'all passed' : `${failures.length} failed`}.`);
if (failures.length > 0) {
  console.error('Failed checks:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
}
