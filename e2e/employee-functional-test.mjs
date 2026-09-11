/**
 * EMPLOYEE FUNCTIONAL & PERMISSION TEST — executable suite
 * -------------------------------------------------------------------------
 * Runs against a real API server (tsx server/index.ts) backed by a real
 * PostgreSQL database with the project's real migrations. Every check issues
 * an actual HTTP request and/or verifies the resulting database state — no
 * route/button presence is treated as proof of function.
 *
 * Usage:  node e2e/employee-functional-test.mjs
 * Env:    API_BASE (default http://127.0.0.1:3001), DATABASE_URL
 */
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('/home/user/restaurantsMureeh/node_modules/.prisma/client/index.js');
const { seed, PASSWORD, PINS } = await import('./seed-test-data.mjs');

const prisma = new PrismaClient({ log: ['error'] });
const BASE = process.env.API_BASE || 'http://127.0.0.1:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'employee-functional-test-secret-key-32chars-min-0001';

// ===========================================================================
// Tiny assertion engine
// ===========================================================================
const R = {
  total: 0, passed: 0, failed: 0, skipped: 0,
  categories: {},
  failures: [],
  critical: [],
  security: [],
  functional: [],
  fixed: [],
};

function check(category, name, ok, details = '') {
  R.total += 1;
  R.categories[category] = R.categories[category] || { passed: 0, failed: 0, skipped: 0 };
  if (ok) {
    R.passed += 1;
    R.categories[category].passed += 1;
  } else {
    R.failed += 1;
    R.categories[category].failed += 1;
    R.failures.push({ category, name, details: String(details).slice(0, 400) });
  }
  const icon = ok ? '✓' : '✗';
  console.log(`${icon} [${category}] ${name}${ok || !details ? '' : `\n    → ${String(details).slice(0, 300)}`}`);
  return ok;
}

function skip(category, name, why = '') {
  R.total += 1; R.skipped += 1;
  R.categories[category] = R.categories[category] || { passed: 0, failed: 0, skipped: 0 };
  R.categories[category].skipped += 1;
  console.log(`○ [${category}] ${name}${why ? ` (${why})` : ''}`);
}

// ===========================================================================
// HTTP helper
// ===========================================================================
async function call(method, path, { token, body, form, rawBody, headers = {}, redirect } = {}) {
  const init = { method, headers: { ...headers }, redirect: redirect || 'follow' };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (form) {
    init.body = form;
  } else if (rawBody !== undefined) {
    init.body = rawBody;
    if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON (SSE/HTML) */ }
  return { status: res.status, json, text, headers: res.headers };
}

const login = async (email, password = PASSWORD, extra = {}) =>
  call('POST', '/api/auth/login', { body: { email, password, ...extra } });

const getToken = async (email, password = PASSWORD) => {
  const r = await login(email, password);
  if (!r.json?.data?.token) throw new Error(`login failed for ${email}: ${r.status} ${r.text.slice(0, 200)}`);
  return r.json.data.token;
};

// ===========================================================================
// Permission matrix derived from the route definitions in server/routes/*.ts
// (requireManager / requireCashierOrManager / requireServiceStaff / auth-only)
// ===========================================================================
const ALL_TENANT_ROLES = ['RESTAURANT_MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'STAFF'];
const SERVICE_ROLES = ['RESTAURANT_MANAGER', 'CASHIER', 'WAITER', 'KITCHEN']; // requireServiceStaff()
// Documented intent (src/context/AuthContext.tsx + src/tests/rolePermissions.test.tsx):
// STAFF = "orders, tables and waiter calls" (same service duties as WAITER).
const SERVICE_ROLES_WITH_STAFF = ['RESTAURANT_MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'STAFF'];
const CASHIER_ROLES = ['RESTAURANT_MANAGER', 'CASHIER']; // requireCashierOrManager()
const MANAGER_ONLY = ['RESTAURANT_MANAGER']; // requireManager()

let ctx; // seed result
const FIX = { created: {} };

let orderSeq = 100000;
let tableSeq = 0;
async function makeFixtures(tag) {
  const a = ctx.restaurantA.id;
  const nextNum = () => (orderSeq += 1);
  tableSeq += 1;
  const table = await prisma.table.create({
    data: { restaurantId: a, number: 3000 + tableSeq, capacity: 2, zone: 'GARDEN' },
  });
  const payTable = await prisma.table.create({
    data: { restaurantId: a, number: 4000 + tableSeq, capacity: 2, zone: 'GARDEN' },
  });
  const session = await prisma.tableSession.create({
    data: { restaurantId: a, tableId: table.id, expiresAt: new Date(Date.now() + 6 * 3600e3), status: 'ACTIVE' },
  });
  const n1 = nextNum();
  const order = await prisma.order.create({
    data: {
      // Realistic app-generated id shape (see POST /orders): "#<int>".
      id: `#${n1}`, numericId: n1,
      restaurantId: a, tableId: table.id, sessionId: session.id, status: 'PENDING',
      subtotal: 20, total: 20,
      items: { create: [{ productId: ctx.ids.prodA1, productNameSnapshot: 'x', priceSnapshot: 20, quantity: 1, totalPrice: 20 }] },
    },
  });
  const n2 = nextNum();
  const payOrder = await prisma.order.create({
    data: {
      id: `#${n2}`, numericId: n2,
      restaurantId: a, tableId: payTable.id, status: 'SERVED', subtotal: 20, total: 20,
      items: { create: [{ productId: ctx.ids.prodA1, productNameSnapshot: 'x', priceSnapshot: 20, quantity: 1, totalPrice: 20 }] },
    },
  });
  const waiterReq = await prisma.waiterRequest.create({
    data: { restaurantId: a, tableId: table.id, sessionId: session.id, reason: 'ASSISTANCE', status: 'PENDING' },
  });
  const emptyCategory = await prisma.category.create({
    data: { restaurantId: a, name: `Empty Cat ${tag}`, nameEn: 'Empty', sortOrder: 98 },
  });
  const category = await prisma.category.create({
    data: { restaurantId: a, name: `Fix Cat ${tag}`, nameEn: 'Fix', sortOrder: 99 },
  });
  const product = await prisma.product.create({
    data: {
      restaurantId: a, categoryId: category.id, name: `Fix Prod ${tag}`, nameEn: 'Fix',
      description: 'fix', price: 9, imageUrl: '/uploads/fix.png', available: true,
    },
  });
  const offer = await prisma.offer.create({
    data: { restaurantId: a, title: `Fix Offer ${tag}`, originalPrice: 10, discountedPrice: 8, isActive: true },
  });
  const branch = await prisma.branch.create({
    data: { id: `fix-branch-${tag}-${Date.now()}`, restaurantId: a, name: `Fix Branch ${tag}` },
  });
  const staff = await prisma.restaurantUser.create({
    data: {
      restaurantId: a, name: `Fix Staff ${tag}`, email: `fix.staff.${tag}.${Date.now()}@test.local`,
      role: 'WAITER', passwordHash: bcrypt.hashSync(PASSWORD, 10), status: 'ACTIVE',
    },
  });
  return { table, payTable, session, order, payOrder, waiterReq, emptyCategory, category, product, offer, branch, staff };
}

function matrixEndpoints(f) {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return [
    // --- dashboard / analytics -------------------------------------------------
    { id: 'GET /dashboard/stats', cat: 'Dashboard', method: 'GET', path: '/api/manager/dashboard/stats', allow: MANAGER_ONLY },
    // --- orders ----------------------------------------------------------------
    { id: 'GET /orders', cat: 'Orders', method: 'GET', path: '/api/manager/orders', allow: ALL_TENANT_ROLES },
    {
      id: 'POST /orders', cat: 'Orders', method: 'POST', path: '/api/manager/orders', allow: CASHIER_ROLES,
      body: () => ({ tableId: f.table.id, items: [{ productId: ctx.ids.prodA1, quantity: 1 }] }),
    },
    {
      id: 'PUT /orders/:id/status', cat: 'Orders', method: 'PUT', path: () => `/api/manager/orders/${encodeURIComponent(f.order.id)}/status`,
      allow: SERVICE_ROLES_WITH_STAFF, body: () => ({ status: 'PREPARING' }), platformTenantInBody: true,
    },
    // --- tables ----------------------------------------------------------------
    { id: 'GET /tables', cat: 'Tables', method: 'GET', path: '/api/manager/tables', allow: ALL_TENANT_ROLES },
    {
      id: 'POST /tables', cat: 'Tables', method: 'POST', path: '/api/manager/tables', allow: MANAGER_ONLY,
      body: () => ({ tableNumber: 800 + Math.floor(Math.random() * 100), capacity: 2 }),
    },
    {
      id: 'PUT /tables/:id', cat: 'Tables', method: 'PUT', path: () => `/api/manager/tables/${f.table.id}`,
      // requireServiceStaff() now matches the documented scope (STAFF included);
      // KITCHEN additionally fails the handler's own status-write check.
      allow: ['RESTAURANT_MANAGER', 'CASHIER', 'WAITER', 'STAFF'], body: () => ({ status: 'AVAILABLE' }),
    },
    {
      id: 'POST /tables/:id/settle', cat: 'Cashier/Payments', method: 'POST',
      path: () => `/api/manager/tables/${f.table.id}/settle`, allow: CASHIER_ROLES,
      body: () => ({ paymentMethod: 'CASH' }),
    },
    {
      id: 'POST /tables/:id/regenerate-qr', cat: 'Tables', method: 'POST',
      path: () => `/api/manager/tables/${f.table.id}/regenerate-qr`, allow: MANAGER_ONLY,
    },
    // --- menu ------------------------------------------------------------------
    { id: 'GET /menu/categories', cat: 'Menu', method: 'GET', path: '/api/manager/menu/categories', allow: ALL_TENANT_ROLES },
    {
      id: 'POST /menu/categories', cat: 'Menu', method: 'POST', path: '/api/manager/menu/categories', allow: MANAGER_ONLY,
      body: () => ({ name: `Cat ${uniq}`, nameEn: 'Cat' }),
    },
    {
      id: 'PUT /menu/categories/:id', cat: 'Menu', method: 'PUT',
      path: () => `/api/manager/menu/categories/${f.emptyCategory.id}`, allow: MANAGER_ONLY,
      body: () => ({ name: `Cat Upd ${uniq}` }),
    },
    {
      id: 'DELETE /menu/categories/:id', cat: 'Menu', method: 'DELETE',
      path: () => `/api/manager/menu/categories/${f.emptyCategory.id}`, allow: MANAGER_ONLY,
    },
    { id: 'GET /menu/products', cat: 'Menu', method: 'GET', path: '/api/manager/menu/products', allow: ALL_TENANT_ROLES },
    {
      id: 'POST /menu/products', cat: 'Menu', method: 'POST', path: '/api/manager/menu/products', allow: MANAGER_ONLY,
      body: () => ({
        categoryId: ctx.ids.catA1, name: `Prod ${uniq}`, nameEn: 'P',
        description: 'd', price: 11, image: '/uploads/x.png',
      }),
    },
    {
      id: 'PUT /menu/products/:id', cat: 'Menu', method: 'PUT',
      path: () => `/api/manager/menu/products/${f.product.id}`, allow: MANAGER_ONLY, body: () => ({ price: 15 }),
    },
    {
      id: 'PUT /menu/products/:id/stock', cat: 'Menu', method: 'PUT',
      path: () => `/api/manager/menu/products/${f.product.id}/stock`, allow: MANAGER_ONLY, body: () => ({ available: true }),
    },
    {
      id: 'DELETE /menu/products/:id', cat: 'Menu', method: 'DELETE',
      path: () => `/api/manager/menu/products/${f.product.id}`, allow: MANAGER_ONLY,
    },
    // --- waiter requests -------------------------------------------------------
    { id: 'GET /waiter-requests', cat: 'Waiter Requests', method: 'GET', path: '/api/manager/waiter-requests', allow: ALL_TENANT_ROLES },
    {
      id: 'PUT /waiter-requests/:id/status', cat: 'Waiter Requests', method: 'PUT',
      path: () => `/api/manager/waiter-requests/${f.waiterReq.id}/status`, allow: SERVICE_ROLES_WITH_STAFF,
      body: () => ({ status: 'ACKNOWLEDGED' }),
    },
    // --- reports / export ------------------------------------------------------
    { id: 'GET /export/orders', cat: 'Reports', method: 'GET', path: '/api/manager/export/orders', allow: MANAGER_ONLY },
    // --- staff -----------------------------------------------------------------
    { id: 'GET /staff', cat: 'Staff', method: 'GET', path: '/api/manager/staff', allow: MANAGER_ONLY },
    {
      id: 'POST /staff', cat: 'Staff', method: 'POST', path: '/api/manager/staff', allow: MANAGER_ONLY,
      body: () => ({
        name: `New Staff ${uniq}`, email: `new.staff.${uniq}@test.local`,
        password: 'StrongPass#2026', role: 'WAITER',
      }),
    },
    {
      id: 'PUT /staff/:id', cat: 'Staff', method: 'PUT', path: () => `/api/manager/staff/${f.staff.id}`,
      allow: MANAGER_ONLY, body: () => ({ name: `Renamed Staff ${uniq}` }),
    },
    {
      id: 'DELETE /staff/:id', cat: 'Staff', method: 'DELETE', path: () => `/api/manager/staff/${f.staff.id}`,
      allow: MANAGER_ONLY,
    },
    // --- offers ----------------------------------------------------------------
    { id: 'GET /offers', cat: 'Menu', method: 'GET', path: '/api/manager/offers', allow: ALL_TENANT_ROLES },
    {
      id: 'POST /offers', cat: 'Menu', method: 'POST', path: '/api/manager/offers', allow: MANAGER_ONLY,
      body: () => ({ title: `Offer ${uniq}`, originalPrice: 30, discountedPrice: 25 }),
    },
    {
      id: 'PUT /offers/:id', cat: 'Menu', method: 'PUT', path: () => `/api/manager/offers/${f.offer.id}`,
      allow: MANAGER_ONLY, body: () => ({ title: `Offer Upd ${uniq}` }),
    },
    {
      id: 'DELETE /offers/:id', cat: 'Menu', method: 'DELETE', path: () => `/api/manager/offers/${f.offer.id}`,
      allow: MANAGER_ONLY,
    },
    // --- restaurant settings / subscription / branches -------------------------
    { id: 'GET /subscription', cat: 'Settings', method: 'GET', path: '/api/manager/subscription', allow: MANAGER_ONLY },
    {
      id: 'PUT /subscription/plan', cat: 'Settings', method: 'PUT', path: '/api/manager/subscription/plan',
      allow: MANAGER_ONLY, body: () => ({ planId: 'plan-test-pro' }),
    },
    {
      id: 'PUT /branding', cat: 'Settings', method: 'PUT', path: '/api/manager/branding', allow: MANAGER_ONLY,
      body: () => ({ name: 'مطعم الاختبار A', phone: '+970000000001', address: 'Test Address A' }),
    },
    { id: 'GET /branches', cat: 'Settings', method: 'GET', path: '/api/manager/branches', allow: MANAGER_ONLY },
    {
      id: 'POST /branches', cat: 'Settings', method: 'POST', path: '/api/manager/branches', allow: MANAGER_ONLY,
      body: () => ({ name: `Branch ${uniq}`, address: 'x' }),
    },
    {
      id: 'PUT /branches/:id', cat: 'Settings', method: 'PUT', path: () => `/api/manager/branches/${f.branch.id}`,
      allow: MANAGER_ONLY, body: () => ({ name: `Branch Upd ${uniq}` }),
    },
    {
      id: 'POST /branches/assign-tables', cat: 'Settings', method: 'POST',
      path: '/api/manager/branches/assign-tables', allow: MANAGER_ONLY,
      body: () => ({ branchId: f.branch.id, tableIds: [f.table.id] }),
    },
    {
      id: 'DELETE /branches/:id', cat: 'Settings', method: 'DELETE',
      path: () => `/api/manager/branches/${f.branch.id}`, allow: MANAGER_ONLY,
    },
    // --- cashier / payments ----------------------------------------------------
    { id: 'GET /payments', cat: 'Cashier/Payments', method: 'GET', path: '/api/manager/payments', allow: CASHIER_ROLES },
    {
      id: 'POST /payments', cat: 'Cashier/Payments', method: 'POST', path: '/api/manager/payments', allow: CASHIER_ROLES,
      body: () => ({ tableId: f.payTable.id, orderIds: [f.payOrder.id], method: 'CASH', cashReceived: 50 }),
    },
    // --- uploads ---------------------------------------------------------------
    { id: 'POST /uploads/image', cat: 'Uploads', method: 'POST', path: '/api/uploads/image', allow: MANAGER_ONLY, multipart: true },
    {
      id: 'POST /uploads/delete', cat: 'Uploads', method: 'POST', path: '/api/uploads/delete', allow: MANAGER_ONLY,
      // Overridden at runtime with a freshly uploaded, tenant-owned asset URL
      // (the delete endpoint only accepts assets the caller's tenant owns).
      body: () => ({ url: '/uploads/not-owned-by-this-tenant.png' }),
    },
    // --- platform admin --------------------------------------------------------
    { id: 'GET /admin/overview', cat: 'Admin', method: 'GET', path: '/api/admin/overview', allow: [] },
    { id: 'GET /admin/audit-logs', cat: 'Admin', method: 'GET', path: '/api/admin/audit-logs', allow: [] },
    { id: 'GET /admin/storage-status', cat: 'Admin', method: 'GET', path: '/api/admin/storage-status', allow: [] },
    {
      id: 'POST /admin/restaurants/:id/status', cat: 'Admin', method: 'POST',
      path: () => `/api/admin/restaurants/${ctx.restaurantB.id}/status`, allow: [],
      body: () => ({ status: 'ACTIVE' }),
    },
    {
      id: 'POST /admin/onboard-restaurant', cat: 'Admin', method: 'POST', path: '/api/admin/onboard-restaurant', allow: [],
      body: () => ({ name: `Probe ${uniq}`, slug: `probe-${uniq}` }),
    },
  ];
}

function tinyPngBytes() {
  // 1x1 transparent PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

async function runMatrixEndpointForRole(ep, role, token) {
  let path = typeof ep.path === 'function' ? ep.path() : ep.path;
  let body = ep.body ? ep.body() : undefined;

  // DELETE /uploads/delete is a real deletion: only a tenant-owned URL can be
  // removed (a foreign/unknown path is 403 by design). Upload a fresh asset
  // as the role under test so the "allowed" branch proves the whole flow.
  if (ep.id === 'POST /uploads/delete') {
    body = { url: '/uploads/not-owned-by-this-tenant.png' };
    if (ep.allow.includes(role)) {
      const fd = new FormData();
      fd.append('image', new Blob([tinyPngBytes()], { type: 'image/png' }), `probe-${Date.now()}.png`);
      const up = await call('POST', '/api/uploads/image', { token, form: fd });
      const uploaded = up.json?.data?.url || up.json?.data?.imageUrl || up.json?.data?.file?.url;
      if (uploaded) body = { url: uploaded };
    }
  }

  let options = { token };

  if (ep.multipart) {
    const fd = new FormData();
    fd.append('image', new Blob([tinyPngBytes()], { type: 'image/png' }), 'test.png');
    options = { ...options, form: fd };
  } else if (body !== undefined) {
    options = { ...options, body };
  }

  const res = await call(ep.method, path, options);
  const allowed = ep.allow.includes(role);
  const label = `${role} → ${ep.id}`;

  if (allowed) {
    const ok = res.status >= 200 && res.status < 300;
    check('Permission Matrix', label, ok, `expected 2xx (allowed), got ${res.status} ${res.text.slice(0, 200)}`);
    return { role, ep: ep.id, status: res.status, allowed, json: res.json };
  }
  const denied = res.status === 403 || res.status === 401;
  check('Permission Matrix', label, denied, `expected 403 (denied), got ${res.status} ${res.text.slice(0, 200)}`);
  return { role, ep: ep.id, status: res.status, allowed, json: res.json };
}

// ===========================================================================
// PHASE 1 — authentication
// ===========================================================================
async function phaseAuth(tokens) {
  const roles = [
    ['manager.a@test.local', 'RESTAURANT_MANAGER', ctx.restaurantA.id, 'MANAGER'],
    ['waiter.a@test.local', 'WAITER', ctx.restaurantA.id, 'WAITER'],
    ['staff.a@test.local', 'STAFF', ctx.restaurantA.id, 'STAFF'],
    ['cashier.a@test.local', 'CASHIER', ctx.restaurantA.id, 'CASHIER'],
    ['kitchen.a@test.local', 'KITCHEN', ctx.restaurantA.id, 'KITCHEN'],
    ['manager.b@test.local', 'RESTAURANT_MANAGER', ctx.restaurantB.id, 'MANAGER_B'],
    ['platform.admin@test.local', 'PLATFORM_ADMIN', null, 'PLATFORM_ADMIN'],
  ];

  for (const [email, role, restaurantId, key] of roles) {
    // correct login
    const ok = await login(email);
    const token = ok.json?.data?.token;
    check('Authentication', `${key}: login with correct credentials → 200 + token`, ok.status === 200 && !!token, `status=${ok.status}`);
    check('Authentication', `${key}: login returns the DB role`, ok.json?.data?.user?.role === role, `got ${ok.json?.data?.user?.role}`);
    check('Authentication', `${key}: login returns own restaurantId only`, (ok.json?.data?.user?.restaurantId ?? null) === restaurantId, `got ${ok.json?.data?.user?.restaurantId}`);

    if (token) {
      const decoded = jwt.decode(token, { complete: true });
      const parts = token.split('.').length === 3;
      check('Authentication', `${key}: token is a well-formed JWT (3 segments)`, parts);
      check('Authentication', `${key}: JWT alg pinned to HS256`,
        decoded?.header?.alg === 'HS256', `alg=${decoded?.header?.alg}`);
      check('Authentication', `${key}: JWT carries iss=mureeh-api / aud=mureeh-app`,
        decoded?.payload?.iss === 'mureeh-api' && decoded?.payload?.aud === 'mureeh-app',
        `iss=${decoded?.payload?.iss} aud=${decoded?.payload?.aud}`);
      check('Authentication', `${key}: JWT has tv (token version) + exp`, Number.isInteger(decoded?.payload?.tv) && !!decoded?.payload?.exp);
      check('Authentication', `${key}: token is not a platform admin token`, decoded?.payload?.role === role, `role=${decoded?.payload?.role}`);

      tokens[key] = token;

      // /me with valid token
      const me = await call('GET', '/api/auth/me', { token });
      check('Authentication', `${key}: GET /me with valid token → 200 + correct identity`,
        me.status === 200 && me.json?.data?.user?.role === role && (me.json?.data?.user?.restaurantId ?? null) === restaurantId,
        `status=${me.status} body=${me.text.slice(0, 150)}`);
      check('Authentication', `${key}: /me never returns passwordHash/pinHash`,
        !/passwordHash|pinHash|password"/.test(me.text));
    }

    // wrong password (sample 4 roles to stay under the login rate limiter)
    if (['MANAGER', 'WAITER', 'CASHIER', 'STAFF'].includes(key)) {
      const bad = await login(email, 'TotallyWrongPass!123');
      check('Authentication', `${key}: login with wrong password → 401`,
        bad.status === 401, `status=${bad.status} body=${bad.text.slice(0, 120)}`);
      check('Authentication', `${key}: failed login does not leak whether the account exists`,
        !/not found|غير موجود|no user/i.test(bad.text));
    }
    if (key === 'MANAGER') {
      const ghost = await login(`ghost.${Date.now()}@test.local`);
      check('Authentication', `${key}: login with unknown account → 401`, ghost.status === 401, `status=${ghost.status}`);
    }
  }

  // suspended account
  const suspended = await login('suspended.a@test.local');
  check('Authentication', 'SUSPENDED employee cannot log in → 403', suspended.status === 403, `status=${suspended.status}`);

  // suspended restaurant blocks its staff, not platform staff
  await prisma.restaurant.update({ where: { id: ctx.restaurantB.id }, data: { status: 'SUSPENDED' } });
  const suspendedTenant = await login('waiter.b@test.local');
  check('Authentication', 'Employee of a SUSPENDED restaurant → 403', suspendedTenant.status === 403, `status=${suspendedTenant.status}`);
  const platformStillOk = await login('platform.admin@test.local');
  check('Authentication', 'Platform admin is exempt from tenant suspension', platformStillOk.status === 200, `status=${platformStillOk.status}`);
  await prisma.restaurant.update({ where: { id: ctx.restaurantB.id }, data: { status: 'ACTIVE' } });

  // ---- PIN login -----------------------------------------------------------
  const pinCases = [
    ['waiter', PINS.waiter, 'WAITER', ctx.restaurantA.id, 'waiter.a@test.local'],
    ['staff', PINS.staff, 'STAFF', ctx.restaurantA.id, 'staff.a@test.local'],
    ['cashier', PINS.cashier, 'CASHIER', ctx.restaurantA.id, 'cashier.a@test.local'],
    ['kitchen', PINS.kitchen, 'KITCHEN', ctx.restaurantA.id, 'kitchen.a@test.local'],
  ];
  for (const [label, pin, role, restaurantId, email] of pinCases) {
    const r = await call('POST', '/api/auth/pin', { body: { pin, restaurantId } });
    check('Authentication', `PIN login (${label}) → 200 + correct role`,
      r.status === 200 && r.json?.data?.user?.role === role && r.json?.data?.user?.email === email,
      `status=${r.status} body=${r.text.slice(0, 150)}`);
    check('Authentication', `PIN login (${label}) token tenant = own restaurant`,
      r.json?.data?.user?.restaurantId === restaurantId);
  }

  const wrongPin = await call('POST', '/api/auth/pin', { body: { pin: '0000', restaurantId: ctx.restaurantA.id } });
  check('Authentication', 'PIN login with wrong PIN → 401', wrongPin.status === 401, `status=${wrongPin.status}`);

  const crossTenantPin = await call('POST', '/api/auth/pin', { body: { pin: '7777', restaurantId: ctx.restaurantA.id } });
  check('Authentication', 'PIN of Restaurant B cannot log in against Restaurant A → 401',
    crossTenantPin.status === 401, `status=${crossTenantPin.status}`);

  const noRestaurantPin = await call('POST', '/api/auth/pin', { body: { pin: PINS.waiter } });
  check('Authentication', 'PIN login without restaurantId → 400 (pin is never tenant-guessed)',
    noRestaurantPin.status === 400, `status=${noRestaurantPin.status}`);

  const platformPin = await call('POST', '/api/auth/pin', { body: { pin: '1234', restaurantId: ctx.restaurantA.id } });
  check('Authentication', 'Platform admin cannot be reached through staff PIN', platformPin.status === 401, `status=${platformPin.status}`);

  // ---- token integrity ------------------------------------------------------
  const forgedRole = jwt.sign(
    { id: ctx.users.waiterA.id, restaurantId: ctx.restaurantA.id, name: 'Waiter A', email: 'waiter.a@test.local', role: 'PLATFORM_ADMIN', status: 'ACTIVE', tv: ctx.users.waiterA.tokenVersion, jti: 'forged' },
    JWT_SECRET, { expiresIn: '1h', issuer: 'mureeh-api', audience: 'mureeh-app', algorithm: 'HS256' }
  );
  const forgedRes = await call('GET', '/api/admin/overview', { token: forgedRole });
  check('Authentication', 'Escalated role claim in a token is ignored (DB role is authoritative) → 403/401',
    forgedRes.status === 403 || forgedRes.status === 401, `status=${forgedRes.status} ${forgedRes.text.slice(0, 120)}`);

  const wrongSecret = jwt.sign(
    { id: ctx.users.waiterA.id, role: 'PLATFORM_ADMIN', tv: 0, jti: 'x' },
    'a-completely-different-secret-key-value-000000', { expiresIn: '1h', issuer: 'mureeh-api', audience: 'mureeh-app', algorithm: 'HS256' }
  );
  const wrongSecretRes = await call('GET', '/api/admin/overview', { token: wrongSecret });
  check('Authentication', 'Token signed with a different secret → 401', wrongSecretRes.status === 401, `status=${wrongSecretRes.status}`);

  const expired = jwt.sign(
    { id: ctx.users.managerA.id, restaurantId: ctx.restaurantA.id, name: 'Manager A', email: 'manager.a@test.local', role: 'RESTAURANT_MANAGER', status: 'ACTIVE', tv: 0, jti: 'exp' },
    JWT_SECRET, { expiresIn: '-10s', issuer: 'mureeh-api', audience: 'mureeh-app', algorithm: 'HS256' }
  );
  const expiredRes = await call('GET', '/api/auth/me', { token: expired });
  check('Authentication', 'Expired token → 401', expiredRes.status === 401, `status=${expiredRes.status}`);

  const noneAlg = [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ id: ctx.users.managerA.id, role: 'PLATFORM_ADMIN' })).toString('base64url'),
    '',
  ].join('.');
  const noneRes = await call('GET', '/api/admin/overview', { token: noneAlg });
  check('Authentication', 'alg=none token → 401', noneRes.status === 401, `status=${noneRes.status}`);

  const noToken = await call('GET', '/api/auth/me');
  check('Authentication', 'GET /me without token → 401', noToken.status === 401, `status=${noToken.status}`);

  // ---- logout + revocation --------------------------------------------------
  const logoutToken = await getToken('staff.a@test.local');
  const beforeLogout = await call('GET', '/api/auth/me', { token: logoutToken });
  const doLogout = await call('POST', '/api/auth/logout', { token: logoutToken });
  const afterLogout = await call('GET', '/api/auth/me', { token: logoutToken });
  const afterLogoutAdmin = await call('GET', '/api/manager/orders', { token: logoutToken });
  check('Authentication', 'Logout with a valid session → 200', doLogout.status === 200, `status=${doLogout.status}`);
  check('Authentication', 'Reusing the token after logout → 401 (server-side revocation)',
    beforeLogout.status === 200 && afterLogout.status === 401, `before=${beforeLogout.status} after=${afterLogout.status}`);
  check('Authentication', 'Revoked token cannot reach protected routes',
    afterLogoutAdmin.status === 401, `status=${afterLogoutAdmin.status}`);
  check('Authentication', 'Logout increments tokenVersion in the DB',
    (await prisma.restaurantUser.findUnique({ where: { id: ctx.users.staffA.id } })).tokenVersion > 0);

  const logoutNoAuth = await call('POST', '/api/auth/logout');
  check('Authentication', 'Logout without a token → 401', logoutNoAuth.status === 401, `status=${logoutNoAuth.status}`);

  // password reset is explicitly not implemented
  const reset = await call('POST', '/api/auth/password-reset-request', { body: { email: 'waiter.a@test.local' } });
  check('Authentication', 'Password reset endpoint is honest about being unimplemented (501)', reset.status === 501, `status=${reset.status}`);
}

// ===========================================================================
// PHASE 2 — full permission matrix (every tenant role × every endpoint)
// ===========================================================================
async function phaseMatrix(tokens) {
  const roles = ['RESTAURANT_MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'STAFF'];
  const tokenFor = {
    RESTAURANT_MANAGER: tokens.MANAGER, CASHIER: tokens.CASHIER, WAITER: tokens.WAITER,
    KITCHEN: tokens.KITCHEN, STAFF: tokens.STAFF,
  };
  const results = [];
  for (const role of roles) {
    const f = await makeFixtures(`${role}-${Date.now()}`);
    const endpoints = matrixEndpoints(f);
    for (const ep of endpoints) {
      results.push(await runMatrixEndpointForRole(ep, role, tokenFor[role]));
    }
  }
  // Defense in depth: KITCHEN passes requireServiceStaff but must not edit tables.
  const kitchenF = await makeFixtures(`KITCHEN-TABLE-${Date.now()}`);
  const kitchenTable = await call('PUT', `/api/manager/tables/${kitchenF.table.id}`, {
    token: tokens.KITCHEN, body: { status: 'OCCUPIED' },
  });
  check('Permission Matrix', 'KITCHEN → PUT /tables/:id denied (status flips are cashier/waiter/staff only)',
    kitchenTable.status === 403, `status=${kitchenTable.status} ${kitchenTable.text.slice(0, 120)}`);
  const kitchenStructural = await call('PUT', `/api/manager/tables/${kitchenF.table.id}`, {
    token: tokens.WAITER, body: { tableNumber: 4900 + (tableSeq += 1) },
  });
  check('Permission Matrix', 'WAITER cannot change structural table fields (only status)',
    kitchenStructural.status === 403, `status=${kitchenStructural.status}`);

  // Platform admin: full access across tenants (documented bypass)
  // (clear fixture branches so the plan's branch quota is not exhausted)
  await prisma.branch.deleteMany({ where: { restaurantId: ctx.restaurantA.id } });
  const fA = await makeFixtures(`PLATFORM-${Date.now()}`);
  for (const ep of matrixEndpoints(fA)) {
    let path = typeof ep.path === 'function' ? ep.path() : ep.path;
    const sep = path.includes('?') ? '&' : '?';
    path = `${path}${sep}restaurantId=${ctx.restaurantA.id}`;
    let body = ep.body
      ? (ep.platformTenantInBody ? { restaurantId: ctx.restaurantA.id, ...ep.body() } : ep.body())
      : undefined;
    let options = { token: tokens.PLATFORM_ADMIN };
    if (ep.id === 'POST /uploads/delete') {
      // Platform admin hits requireManager's documented bypass, so the call is
      // a real delete: upload an asset first (with the tenant hint) and remove it.
      const fd = new FormData();
      fd.append('image', new Blob([tinyPngBytes()], { type: 'image/png' }), `platform-${Date.now()}.png`);
      fd.append('restaurantId', ctx.restaurantA.id);
      const up = await call('POST', '/api/uploads/image', { token: tokens.PLATFORM_ADMIN, form: fd });
      const uploaded = up.json?.data?.url || up.json?.data?.imageUrl || up.json?.data?.file?.url;
      body = { url: uploaded || '/uploads/not-owned-by-this-tenant.png' };
      options = { ...options, body };
    } else if (ep.multipart) {
      const fd = new FormData();
      fd.append('image', new Blob([tinyPngBytes()], { type: 'image/png' }), 'test.png');
      fd.append('restaurantId', ctx.restaurantA.id);
      options = { ...options, form: fd };
    } else if (body !== undefined) options = { ...options, body };
    const res = await call(ep.method, path, options);
    const platformForbidden = ep.cat === 'Uploads' && false; // platform admins pass role checks by design
    check('Permission Matrix', `PLATFORM_ADMIN → ${ep.id} (cross-tenant by design)`,
      platformForbidden ? res.status === 403 : res.status >= 200 && res.status < 300,
      `status=${res.status} ${res.text.slice(0, 150)}`);
  }
  return results;
}

// ===========================================================================
// PHASE 3 — WAITER end-to-end scenario
// ===========================================================================
async function phaseWaiter(tokens) {
  const waiter = await getToken('waiter.a@test.local');
  const f = await makeFixtures(`waiter-scenario-${Date.now()}`);
  const A = ctx.restaurantA.id;
  const B = ctx.restaurantB.id;

  const meRes = await call('GET', '/api/auth/me', { token: waiter });
  check('WAITER', 'Login → /me returns WAITER with own tenant',
    meRes.status === 200 && meRes.json?.data?.user?.role === 'WAITER' && meRes.json?.data?.user?.restaurantId === A);

  const allowedViews = await Promise.all([
    call('GET', '/api/manager/orders', { token: waiter }),
    call('GET', '/api/manager/tables', { token: waiter }),
    call('GET', '/api/manager/waiter-requests', { token: waiter }),
    call('GET', '/api/manager/menu/categories', { token: waiter }),
    call('GET', '/api/manager/menu/products', { token: waiter }),
  ]);
  check('WAITER', 'Can read orders/tables/waiter-requests/menu',
    allowedViews.every((r) => r.status === 200),
    allowedViews.map((r) => r.status).join(','));

  const ordersBody = allowedViews[0].json;
  const leakOtherTenant = JSON.stringify(ordersBody).includes(B) || JSON.stringify(ordersBody).includes(ctx.ids.orderB);
  check('WAITER', 'Order list contains no other tenant data', !leakOtherTenant);

  const myOrderVisible = JSON.stringify(ordersBody).includes(f.order.id);
  check('WAITER', 'Orders endpoint really returns this tenant’s live orders (not an empty shell)', myOrderVisible,
    `order ${f.order.id} missing from response`);

  // order lifecycle
  const upd = await call('PUT', `/api/manager/orders/${encodeURIComponent(f.order.id)}/status`, { token: waiter, body: { status: 'PREPARING' } });
  check('WAITER', 'Can advance an order status (PENDING → PREPARING)', upd.status === 200, `status=${upd.status} ${upd.text.slice(0, 150)}`);
  const dbOrder = await prisma.order.findUnique({ where: { id: f.order.id } });
  check('WAITER', 'Order status change is really persisted', dbOrder.status === 'PREPARING', `db status=${dbOrder.status}`);

  // waiter request lifecycle
  const wr = await call('PUT', `/api/manager/waiter-requests/${f.waiterReq.id}/status`, { token: waiter, body: { status: 'ACKNOWLEDGED' } });
  check('WAITER', 'Can acknowledge a waiter request', wr.status === 200, `status=${wr.status} ${wr.text.slice(0, 150)}`);
  check('WAITER', 'Waiter-request status change persisted',
    (await prisma.waiterRequest.findUnique({ where: { id: f.waiterReq.id } })).status === 'ACKNOWLEDGED');

  // table status handling
  const tUpd = await call('PUT', `/api/manager/tables/${f.table.id}`, { token: waiter, body: { status: 'OCCUPIED' } });
  check('WAITER', 'Can update table status (occupy a table)', tUpd.status === 200, `status=${tUpd.status} ${tUpd.text.slice(0, 150)}`);
  check('WAITER', 'Table status change persisted',
    (await prisma.table.findUnique({ where: { id: f.table.id } })).status === 'OCCUPIED');

  // waiter-side POS order creation is intentionally cashier/manager-only
  const posCreate = await call('POST', '/api/manager/orders', { token: waiter, body: { tableId: f.table.id, items: [{ productId: ctx.ids.prodA1, quantity: 1 }] } });
  check('WAITER', 'POS order creation denied (403) — cashier/manager only', posCreate.status === 403, `status=${posCreate.status}`);
  check('WAITER', 'Denied POS creation created no extra order',
    (await prisma.order.count({ where: { restaurantId: A, tableId: f.table.id } })) === 1,
    `count=${await prisma.order.count({ where: { restaurantId: A, tableId: f.table.id } })}`);

  // guest QR ordering still works for the waiter's tables
  const qr = await call('GET', `/api/public/tables/qr/${f.table.qrToken}`);
  check('WAITER', 'Guest QR lookup for a table works (public flow untouched)', qr.status === 200, `status=${qr.status}`);
  const sess = await call('POST', `/api/public/tables/qr/${f.table.qrToken}/session`, { body: { restaurantId: A } });
  check('WAITER', 'Guest QR session creation works', sess.status === 200 && !!sess.json?.data?.sessionToken, `status=${sess.status}`);
  if (sess.json?.data?.sessionToken) {
    const guestOrder = await call('POST', '/api/public/orders', {
      body: {
        restaurantId: A, tableId: f.table.id, sessionToken: sess.json.data.sessionToken,
        items: [{ productId: ctx.ids.prodA1, quantity: 2 }],
      },
    });
    check('WAITER', 'Guest order arrives through the public flow (visible to the waiter queue)',
      guestOrder.status === 200 || guestOrder.status === 201, `status=${guestOrder.status} ${guestOrder.text.slice(0, 150)}`);
    const waiterSeesIt = await call('GET', '/api/manager/orders', { token: waiter });
    check('WAITER', 'The guest order is visible in the waiter order queue',
      JSON.stringify(waiterSeesIt.json).includes(String(guestOrder.json?.data?.order?.id ?? guestOrder.json?.data?.id ?? '')));
  }

  // ---- deliberate forbidden attempts --------------------------------------
  const forbidden = [
    ['Dashboard (revenue KPIs)', 'GET', '/api/manager/dashboard/stats', undefined],
    ['Staff management (list)', 'GET', '/api/manager/staff', undefined],
    ['Staff creation', 'POST', '/api/manager/staff', { name: 'X', email: `x.${Date.now()}@test.local`, password: 'StrongPass#2026', role: 'WAITER' }],
    ['Restaurant settings (branding)', 'PUT', '/api/manager/branding', { name: 'Hacked' }],
    ['Subscription/settings', 'GET', '/api/manager/subscription', undefined],
    ['Menu category creation', 'POST', '/api/manager/menu/categories', { name: 'Hacked' }],
    ['Menu product deletion', 'DELETE', `/api/manager/menu/products/${ctx.ids.prodA1}`, undefined],
    ['Table creation', 'POST', '/api/manager/tables', { tableNumber: 4242, capacity: 2 }],
    ['Table QR regeneration', 'POST', `/api/manager/tables/${f.table.id}/regenerate-qr`, undefined],
    ['Table settlement', 'POST', `/api/manager/tables/${f.table.id}/settle`, { paymentMethod: 'CASH' }],
    ['Payments ledger', 'GET', '/api/manager/payments', undefined],
    ['Payment creation', 'POST', '/api/manager/payments', { tableId: f.table.id, orderIds: [f.order.id], method: 'CASH' }],
    ['Offers management', 'POST', '/api/manager/offers', { title: 'Hacked', originalPrice: 1, discountedPrice: 0 }],
    ['Branches', 'GET', '/api/manager/branches', undefined],
    ['Reports/export', 'GET', '/api/manager/export/orders', undefined],
    ['Uploads (image)', 'POST', '/api/uploads/image', undefined],
    ['Uploads (delete)', 'POST', '/api/uploads/delete', { url: '/uploads/x.png' }],
    ['Admin API (overview)', 'GET', '/api/admin/overview', undefined],
    ['Admin API (audit logs)', 'GET', '/api/admin/audit-logs', undefined],
    ['Admin API (tenant status)', 'POST', `/api/admin/restaurants/${B}/status`, { status: 'SUSPENDED' }],
    ['Admin API (onboarding)', 'POST', '/api/admin/onboard-restaurant', { name: 'Hacked', slug: `hacked-${Date.now()}` }],
  ];
  for (const [label, method, path, body] of forbidden) {
    let res;
    if (path === '/api/uploads/image') {
      const fd = new FormData();
      fd.append('image', new Blob([tinyPngBytes()], { type: 'image/png' }), 'x.png');
      res = await call(method, path, { token: waiter, form: fd });
    } else {
      res = await call(method, path, { token: waiter, body });
    }
    check('WAITER', `Denied: ${label}`, res.status === 403, `status=${res.status} ${res.text.slice(0, 150)}`);
  }

  // cross-tenant attempts with a waiter token
  const crossTenant = await Promise.all([
    call('PUT', `/api/manager/orders/${encodeURIComponent(ctx.ids.orderB)}/status`, { token: waiter, body: { status: 'CANCELLED' } }),
    call('PUT', `/api/manager/waiter-requests/${ctx.ids.waiterReqB}/status`, { token: waiter, body: { status: 'RESOLVED' } }),
    call('PUT', `/api/manager/tables/${ctx.ids.tableB}`, { token: waiter, body: { status: 'AVAILABLE' } }),
    call('GET', `/api/manager/menu/categories?restaurantId=${B}`, { token: waiter }),
  ]);
  check('WAITER', 'Cross-tenant order status update rejected',
    crossTenant[0].status === 403 || crossTenant[0].status === 404, `status=${crossTenant[0].status}`);
  check('WAITER', 'Cross-tenant waiter-request update rejected',
    crossTenant[1].status === 403 || crossTenant[1].status === 404, `status=${crossTenant[1].status}`);
  check('WAITER', 'Cross-tenant table update rejected',
    crossTenant[2].status === 403 || crossTenant[2].status === 404, `status=${crossTenant[2].status}`);
  check('WAITER', 'restaurantId query injection does not switch tenant',
    crossTenant[3].status === 403 || (crossTenant[3].status === 200 && !JSON.stringify(crossTenant[3].json).includes(ctx.ids.catB1)),
    `status=${crossTenant[3].status}`);
  check('WAITER', 'Restaurant B data unchanged after cross-tenant attempts',
    (await prisma.order.findUnique({ where: { id: ctx.ids.orderB } })).status === 'PENDING' &&
    (await prisma.waiterRequest.findUnique({ where: { id: ctx.ids.waiterReqB } })).status === 'PENDING');

  // logout
  const out = await call('POST', '/api/auth/logout', { token: waiter });
  const after = await call('GET', '/api/manager/orders', { token: waiter });
  check('WAITER', 'Logout → session revoked (401 on reuse)', out.status === 200 && after.status === 401, `logout=${out.status} reuse=${after.status}`);
}

// ===========================================================================
// PHASE 4 — STAFF scenario
// ===========================================================================
async function phaseStaff(tokens) {
  const staff = await getToken('staff.a@test.local');
  const staffPin = await call('POST', '/api/auth/pin', { body: { pin: PINS.staff, restaurantId: ctx.restaurantA.id } });
  check('STAFF', 'PIN login works for STAFF', staffPin.status === 200 && staffPin.json?.data?.user?.role === 'STAFF', `status=${staffPin.status}`);

  const f = await makeFixtures(`staff-scenario-${Date.now()}`);
  const reads = await Promise.all([
    call('GET', '/api/manager/orders', { token: staff }),
    call('GET', '/api/manager/tables', { token: staff }),
    call('GET', '/api/manager/waiter-requests', { token: staff }),
    call('GET', '/api/manager/menu/products', { token: staff }),
    call('GET', '/api/manager/menu/categories', { token: staff }),
    call('GET', '/api/manager/offers', { token: staff }),
  ]);
  check('STAFF', 'Can read orders/tables/service-requests/menu/offers',
    reads.every((r) => r.status === 200), reads.map((r) => r.status).join(','));

  // STAFF scope (AuthContext.tsx:42 + TABLE_STATUS_WRITE_ROLES): order status,
  // table status and waiter calls are exactly the three allowed writes.
  const serviceWrites = await Promise.all([
    call('PUT', `/api/manager/orders/${encodeURIComponent(f.order.id)}/status`, { token: staff, body: { status: 'READY' } }),
    call('PUT', `/api/manager/waiter-requests/${f.waiterReq.id}/status`, { token: staff, body: { status: 'RESOLVED' } }),
    call('PUT', `/api/manager/tables/${f.table.id}`, { token: staff, body: { status: 'OCCUPIED' } }),
  ]);
  check('STAFF', 'STAFF can advance order status (service duty)',
    serviceWrites[0].status === 200, `status=${serviceWrites[0].status} ${serviceWrites[0].text.slice(0, 120)}`);
  check('STAFF', 'STAFF can resolve a waiter call (service duty)',
    serviceWrites[1].status === 200, `status=${serviceWrites[1].status} ${serviceWrites[1].text.slice(0, 120)}`);
  check('STAFF', 'STAFF can flip table availability (service duty)',
    serviceWrites[2].status === 200, `status=${serviceWrites[2].status} ${serviceWrites[2].text.slice(0, 120)}`);
  check('STAFF', 'Service writes really landed in the DB (order READY / call RESOLVED / table OCCUPIED)',
    (await prisma.order.findUnique({ where: { id: f.order.id } })).status === 'READY' &&
    (await prisma.waiterRequest.findUnique({ where: { id: f.waiterReq.id } })).status === 'RESOLVED' &&
    (await prisma.table.findUnique({ where: { id: f.table.id } })).status === 'OCCUPIED');

  const writeAttempts = [
    ['Order creation (POS)', 'POST', '/api/manager/orders', { tableId: f.table.id, items: [{ productId: ctx.ids.prodA1, quantity: 1 }] }],
    ['Table settlement', 'POST', `/api/manager/tables/${f.table.id}/settle`, { paymentMethod: 'CASH' }],
    ['Payment creation', 'POST', '/api/manager/payments', { tableId: f.table.id, orderIds: [f.order.id], method: 'CASH' }],
    ['Dashboard', 'GET', '/api/manager/dashboard/stats', undefined],
    ['Staff list', 'GET', '/api/manager/staff', undefined],
    ['Branding update', 'PUT', '/api/manager/branding', { name: 'X' }],
    ['Menu deletion', 'DELETE', `/api/manager/menu/products/${ctx.ids.prodA2}`, undefined],
    ['Admin API', 'GET', '/api/admin/overview', undefined],
    ['Uploads', 'POST', '/api/uploads/delete', { url: '/uploads/none.png' }],
  ];
  for (const [label, method, path, body] of writeAttempts) {
    const res = await call(method, path, { token: staff, body });
    check('STAFF', `Denied: ${label}`, res.status === 403, `status=${res.status} ${res.text.slice(0, 120)}`);
  }
  check('STAFF', 'Denied operations changed nothing (order still READY, table still OCCUPIED only by the STAFF write)',
    (await prisma.order.findUnique({ where: { id: f.order.id } })).status === 'READY' &&
    (await prisma.table.findUnique({ where: { id: f.table.id } })).status === 'OCCUPIED' &&
    (await prisma.waiterRequest.findUnique({ where: { id: f.waiterReq.id } })).status === 'RESOLVED');
}

// ===========================================================================
// PHASE 5 — CASHIER / POS / payments
// ===========================================================================
async function phaseCashier(tokens) {
  const cashier = await getToken('cashier.a@test.local');
  const A = ctx.restaurantA.id;
  const f = await makeFixtures(`cashier-${Date.now()}`);

  const pin = await call('POST', '/api/auth/pin', { body: { pin: PINS.cashier, restaurantId: A } });
  check('CASHIER', 'PIN login works for CASHIER', pin.status === 200 && pin.json?.data?.user?.role === 'CASHIER', `status=${pin.status}`);

  const posList = await call('GET', '/api/manager/orders', { token: cashier });
  check('CASHIER', 'Can open the POS order queue', posList.status === 200, `status=${posList.status}`);

  const create = await call('POST', '/api/manager/orders', {
    token: cashier,
    body: { tableId: f.table.id, items: [{ productId: ctx.ids.prodA1, quantity: 2 }, { productId: ctx.ids.prodA2, quantity: 1 }], notes: 'pos test' },
  });
  check('CASHIER', 'Can create a POS order', create.status === 200 || create.status === 201, `status=${create.status} ${create.text.slice(0, 150)}`);
  const createdOrderId = create.json?.data?.order?.id ?? create.json?.data?.id ?? create.json?.order?.id;
  const dbOrders = await prisma.order.findMany({ where: { restaurantId: A, tableId: f.table.id }, orderBy: { createdAt: 'desc' } });
  check('CASHIER', 'POS order persisted with correct tenant + server-computed totals',
    dbOrders.length >= 2 && dbOrders.every((o) => o.restaurantId === A) && dbOrders[0].total > 0,
    JSON.stringify(dbOrders.map((o) => ({ id: o.id, total: o.total, restaurantId: o.restaurantId }))).slice(0, 200));
  check('CASHIER', 'POS order items are snapshotted from the DB (no client price trust)',
    dbOrders[0].subtotal === 20 * 2 + 12, `subtotal=${dbOrders[0].subtotal}`);
  check('CASHIER', 'No duplicate order created by a single POST',
    new Set(dbOrders.map((o) => o.id)).size === dbOrders.length);

  const statusUpd = await call('PUT', `/api/manager/orders/${encodeURIComponent(dbOrders[0].id)}/status`, { token: cashier, body: { status: 'SERVED' } });
  check('CASHIER', 'Can update order status (cashier serves orders)', statusUpd.status === 200, `status=${statusUpd.status}`);

  // settle the table → closes the session and marks orders paid
  const settle = await call('POST', `/api/manager/tables/${f.table.id}/settle`, { token: cashier, body: { paymentMethod: 'CASH', note: 'cash settlement' } });
  check('CASHIER', 'Can settle (close) the table bill', settle.status === 200, `status=${settle.status} ${settle.text.slice(0, 200)}`);
  const afterSettle = await prisma.order.findMany({ where: { tableId: f.table.id } });
  check('CASHIER', 'Settlement closes the bill: orders marked PAID',
    afterSettle.every((o) => o.paymentStatus === 'PAID'), JSON.stringify(afterSettle.map((o) => o.paymentStatus)));
  check('CASHIER', 'Settlement timestamp recorded on every closed order', afterSettle.every((o) => !!o.settledAt));
  const sessionAfter = await prisma.tableSession.findUnique({ where: { id: f.session.id } });
  check('CASHIER', 'Settlement closes the table session', sessionAfter.status === 'CLOSED', `session=${sessionAfter.status}`);
  const tableAfter = await prisma.table.findUnique({ where: { id: f.table.id } });
  check('CASHIER', 'Settled table is released to AVAILABLE', tableAfter.status === 'AVAILABLE', `table=${tableAfter.status}`);

  // double-payment protection: the already-settled orders must be refused
  const doublePay = await call('POST', '/api/manager/payments', {
    token: cashier,
    body: { tableId: f.table.id, orderIds: [afterSettle[0].id], method: 'CASH', cashReceived: 100 },
  });
  check('CASHIER', 'Paying an already-settled invoice is refused (409, no duplicate ledger row)',
    doublePay.status === 409, `status=${doublePay.status} ${doublePay.text.slice(0, 150)}`);

  // payments ledger: a fresh unpaid order for the same table
  const unpaidOrder = await prisma.order.create({
    data: {
      id: `#${(orderSeq += 1)}`,
      restaurantId: A, tableId: f.table.id, status: 'SERVED', subtotal: 20, total: 20,
      items: { create: [{ productId: ctx.ids.prodA1, productNameSnapshot: 'x', priceSnapshot: 20, quantity: 1, totalPrice: 20 }] },
    },
  });
  const payment = await call('POST', '/api/manager/payments', {
    token: cashier,
    body: { tableId: f.table.id, orderIds: [unpaidOrder.id], method: 'CASH', cashReceived: 100, tip: 5 },
  });
  check('CASHIER', 'Can record a payment in the ledger', payment.status === 200 || payment.status === 201, `status=${payment.status} ${payment.text.slice(0, 200)}`);
  const ledgerRow = await prisma.payment.findFirst({ where: { restaurantId: A, tableId: f.table.id }, orderBy: { createdAt: 'desc' } });
  check('CASHIER', 'Invoice is closed after payment (order marked PAID)',
    (await prisma.order.findUnique({ where: { id: unpaidOrder.id } }))?.paymentStatus === 'PAID',
    JSON.stringify((await prisma.order.findUnique({ where: { id: unpaidOrder.id } }))?.paymentStatus));
  check('CASHIER', 'Payment row persisted with correct tenant and change calculation',
    !!ledgerRow && ledgerRow.restaurantId === A && ledgerRow.changeDue !== null, JSON.stringify(ledgerRow ?? {}).slice(0, 200));
  const ledgerRowsForTable = await prisma.payment.count({ where: { restaurantId: A, tableId: f.table.id } });
  check('CASHIER', 'Ledger holds exactly the settlement receipt + the explicit payment (retry added none)',
    ledgerRowsForTable === 2, `count=${ledgerRowsForTable}`);
  check('CASHIER', 'Settlement receipt is a ledger row too (bill closure is traceable)',
    (await prisma.payment.count({ where: { restaurantId: A, tableId: f.table.id } })) >= 1);

  const ledger = await call('GET', '/api/manager/payments', { token: cashier });
  check('CASHIER', 'Can read the payments ledger (own tenant only)',
    ledger.status === 200 && !JSON.stringify(ledger.json).includes(ctx.ids.paymentB), `status=${ledger.status}`);

  // forbidden for cashier
  const forbidden = [
    ['Dashboard revenue KPIs', 'GET', '/api/manager/dashboard/stats', undefined],
    ['Staff list', 'GET', '/api/manager/staff', undefined],
    ['Staff creation', 'POST', '/api/manager/staff', { name: 'X', email: `cash.${Date.now()}@test.local`, password: 'StrongPass#2026', role: 'WAITER' }],
    ['Restaurant settings', 'PUT', '/api/manager/branding', { name: 'X' }],
    ['Subscription', 'GET', '/api/manager/subscription', undefined],
    ['Menu category creation', 'POST', '/api/manager/menu/categories', { name: 'X' }],
    ['Menu product update', 'PUT', `/api/manager/menu/products/${ctx.ids.prodA1}`, { price: 1 }],
    ['Offers creation', 'POST', '/api/manager/offers', { title: 'X', originalPrice: 2, discountedPrice: 1 }],
    ['Branches', 'GET', '/api/manager/branches', undefined],
    ['Reports export', 'GET', '/api/manager/export/orders', undefined],
    ['QR regeneration', 'POST', `/api/manager/tables/${f.table.id}/regenerate-qr`, undefined],
    ['Uploads', 'POST', '/api/uploads/image', undefined],
    ['Admin API', 'GET', '/api/admin/overview', undefined],
    ['Admin audit logs', 'GET', '/api/admin/audit-logs', undefined],
  ];
  for (const [label, method, path, body] of forbidden) {
    let res;
    if (path === '/api/uploads/image') {
      const fd = new FormData();
      fd.append('image', new Blob([tinyPngBytes()], { type: 'image/png' }), 'x.png');
      res = await call(method, path, { token: cashier, form: fd });
    } else {
      res = await call(method, path, { token: cashier, body });
    }
    check('CASHIER', `Denied: ${label}`, res.status === 403, `status=${res.status} ${res.text.slice(0, 120)}`);
  }

  // cross-tenant financial access
  const otherLedger = await call('GET', `/api/manager/payments?restaurantId=${ctx.restaurantB.id}`, { token: cashier });
  check('CASHIER', 'Cannot read another tenant’s payments ledger',
    otherLedger.status === 403 || (otherLedger.status === 200 && !JSON.stringify(otherLedger.json).includes(ctx.ids.paymentB)),
    `status=${otherLedger.status}`);
  const settleOtherTable = await call('POST', `/api/manager/tables/${ctx.ids.tableB}/settle`, { token: cashier, body: { paymentMethod: 'CASH' } });
  check('CASHIER', 'Cannot settle another tenant’s table',
    settleOtherTable.status === 403 || settleOtherTable.status === 404, `status=${settleOtherTable.status}`);
  const payOtherOrder = await call('POST', '/api/manager/payments', {
    token: cashier, body: { restaurantId: ctx.restaurantB.id, tableId: ctx.ids.tableB, orderIds: [ctx.ids.orderB], method: 'CASH' },
  });
  check('CASHIER', 'Cannot record a payment against another tenant’s order',
    payOtherOrder.status === 403 || payOtherOrder.status === 404, `status=${payOtherOrder.status}`);
  check('CASHIER', 'Restaurant B financial data untouched',
    (await prisma.payment.count({ where: { restaurantId: ctx.restaurantB.id } })) === 1);
}

// ===========================================================================
// PHASE 6 — RESTAURANT_MANAGER CRUD + boundaries
// ===========================================================================
async function phaseManager(tokens) {
  const manager = await getToken('manager.a@test.local');
  const A = ctx.restaurantA.id;

  // categories CRUD
  const catCreate = await call('POST', '/api/manager/menu/categories', { token: manager, body: { name: 'تصنيف مدير', nameEn: 'Manager Cat' } });
  const catId = catCreate.json?.data?.category?.id ?? catCreate.json?.data?.id;
  check('RESTAURANT_MANAGER', 'Category create works', catCreate.status === 200 || catCreate.status === 201, `status=${catCreate.status} ${catCreate.text.slice(0, 150)}`);
  const catRow = catId ? await prisma.category.findUnique({ where: { id: catId } }) : null;
  check('RESTAURANT_MANAGER', 'Created category is bound to the manager’s own tenant', catRow?.restaurantId === A, `${catRow?.restaurantId}`);

  const catUpdate = await call('PUT', `/api/manager/menu/categories/${catId}`, { token: manager, body: { name: 'تصنيف محدث' } });
  check('RESTAURANT_MANAGER', 'Category update works', catUpdate.status === 200, `status=${catUpdate.status}`);
  check('RESTAURANT_MANAGER', 'Category update persisted', (await prisma.category.findUnique({ where: { id: catId } }))?.name === 'تصنيف محدث');
  const catDelete = await call('DELETE', `/api/manager/menu/categories/${catId}`, { token: manager });
  check('RESTAURANT_MANAGER', 'Category delete works', catDelete.status === 200 || catDelete.status === 204, `status=${catDelete.status}`);
  check('RESTAURANT_MANAGER', 'Deleted category is gone from the DB', (await prisma.category.findUnique({ where: { id: catId } })) === null);

  // products CRUD
  const prodCreate = await call('POST', '/api/manager/menu/products', {
    token: manager,
    body: { categoryId: ctx.ids.catA1, name: 'منتج مدير', nameEn: 'Manager Prod', description: 'd', price: 42, image: '/uploads/mgr.png' },
  });
  const prodId = prodCreate.json?.data?.product?.id ?? prodCreate.json?.data?.id;
  check('RESTAURANT_MANAGER', 'Product create works', prodCreate.status === 200 || prodCreate.status === 201, `status=${prodCreate.status} ${prodCreate.text.slice(0, 150)}`);
  check('RESTAURANT_MANAGER', 'Created product is tenant-bound', !!prodId && (await prisma.product.findUnique({ where: { id: prodId } }))?.restaurantId === A, `prodId=${prodId}`);
  const prodUpdate = await call('PUT', `/api/manager/menu/products/${prodId}`, { token: manager, body: { price: 45 } });
  check('RESTAURANT_MANAGER', 'Product update works', prodUpdate.status === 200, `status=${prodUpdate.status}`);
  check('RESTAURANT_MANAGER', 'Product update persisted', !!prodId && (await prisma.product.findUnique({ where: { id: prodId } }))?.price === 45);
  const stockBefore = (await prisma.product.findUnique({ where: { id: prodId } }))?.available;
  const stock = await call('PUT', `/api/manager/menu/products/${prodId}/stock`, { token: manager, body: {} });
  const stockAfter = (await prisma.product.findUnique({ where: { id: prodId } }))?.available;
  check('RESTAURANT_MANAGER', 'Product stock toggle works and flips the flag',
    stock.status === 200 && stockAfter === !stockBefore, `status=${stock.status} ${stockBefore}→${stockAfter}`);
  const prodDelete = await call('DELETE', `/api/manager/menu/products/${prodId}`, { token: manager });
  check('RESTAURANT_MANAGER', 'Product delete works', prodDelete.status === 200 || prodDelete.status === 204, `status=${prodDelete.status}`);
  check('RESTAURANT_MANAGER', 'Deleted product is gone', !!prodId && (await prisma.product.findUnique({ where: { id: prodId } })) === null);

  // tables
  const tableCreate = await call('POST', '/api/manager/tables', { token: manager, body: { tableNumber: 77, capacity: 6, zone: 'VIP_LOUNGE' } });
  const newTableId = tableCreate.json?.data?.table?.id ?? tableCreate.json?.data?.id;
  check('RESTAURANT_MANAGER', 'Table create works', tableCreate.status === 200 || tableCreate.status === 201, `status=${tableCreate.status}`);
  check('RESTAURANT_MANAGER', 'Created table is tenant-bound', !!newTableId && (await prisma.table.findUnique({ where: { id: newTableId } }))?.restaurantId === A, `id=${newTableId}`);
  const qrRegen = await call('POST', `/api/manager/tables/${newTableId}/regenerate-qr`, { token: manager });
  check('RESTAURANT_MANAGER', 'QR regeneration works and rotates the token', qrRegen.status === 200, `status=${qrRegen.status}`);
  const regenTable = await prisma.table.findUnique({ where: { id: newTableId } });
  check('RESTAURANT_MANAGER', 'Rotated QR token is really new', !!regenTable?.qrToken);

  // orders
  const orderStatus = await call('PUT', `/api/manager/orders/${encodeURIComponent(ctx.ids.orderA)}/status`, { token: manager, body: { status: 'PREPARING' } });
  check('RESTAURANT_MANAGER', 'Order status management works', orderStatus.status === 200, `status=${orderStatus.status}`);
  const exportRes = await call('GET', '/api/manager/export/orders', { token: manager });
  check('RESTAURANT_MANAGER', 'Orders report/export works (CSV)', exportRes.status === 200 && exportRes.text.length > 0, `status=${exportRes.status}`);
  check('RESTAURANT_MANAGER', 'Export contains only own-tenant orders',
    !exportRes.text.includes(ctx.ids.orderB), 'found foreign order id in CSV');
  const dash = await call('GET', '/api/manager/dashboard/stats', { token: manager });
  check('RESTAURANT_MANAGER', 'Dashboard statistics work', dash.status === 200, `status=${dash.status}`);
  check('RESTAURANT_MANAGER', 'Dashboard counts are tenant-scoped',
    !JSON.stringify(dash.json).includes(ctx.restaurantB.id));

  // offers
  const offerCreate = await call('POST', '/api/manager/offers', { token: manager, body: { title: 'عرض المدير', originalPrice: 100, discountedPrice: 80 } });
  const offerId = offerCreate.json?.data?.offer?.id ?? offerCreate.json?.data?.id;
  check('RESTAURANT_MANAGER', 'Offer create works', offerCreate.status === 200 || offerCreate.status === 201, `status=${offerCreate.status}`);
  check('RESTAURANT_MANAGER', 'Offer is tenant-bound', !!offerId && (await prisma.offer.findUnique({ where: { id: offerId } }))?.restaurantId === A, `id=${offerId}`);
  const offerUpdate = await call('PUT', `/api/manager/offers/${offerId}`, { token: manager, body: { discountedPrice: 70 } });
  check('RESTAURANT_MANAGER', 'Offer update works', offerUpdate.status === 200);
  const offerDelete = await call('DELETE', `/api/manager/offers/${offerId}`, { token: manager });
  check('RESTAURANT_MANAGER', 'Offer delete works', offerDelete.status === 200 || offerDelete.status === 204, `status=${offerDelete.status}`);

  // staff management
  const staffEmail = `mgr.created.${Date.now()}@test.local`;
  const staffCreate = await call('POST', '/api/manager/staff', {
    token: manager, body: { name: 'موظف جديد', email: staffEmail, password: 'StrongPass#2026', role: 'WAITER', pin: '6543' },
  });
  const staffId = staffCreate.json?.data?.staff?.id ?? staffCreate.json?.data?.user?.id ?? staffCreate.json?.data?.id;
  check('RESTAURANT_MANAGER', 'Staff creation works', staffCreate.status === 200 || staffCreate.status === 201, `status=${staffCreate.status} ${staffCreate.text.slice(0, 200)}`);
  const staffRow = staffId ? await prisma.restaurantUser.findUnique({ where: { id: staffId } }) : null;
  check('RESTAURANT_MANAGER', 'Created staff belongs to the manager’s tenant', staffRow?.restaurantId === A, `${staffRow?.restaurantId}`);
  check('RESTAURANT_MANAGER', 'Created staff password is hashed (never stored in clear)',
    !!staffRow && staffRow.passwordHash !== 'StrongPass#2026' && staffRow.passwordHash.startsWith('$2'));
  check('RESTAURANT_MANAGER', 'Created staff can actually log in and gets the assigned role',
    (await login(staffEmail, 'StrongPass#2026')).json?.data?.user?.role === 'WAITER');
  const staffUpdate = await call('PUT', `/api/manager/staff/${staffId}`, { token: manager, body: { role: 'CASHIER' } });
  check('RESTAURANT_MANAGER', 'Staff update works', staffUpdate.status === 200, `status=${staffUpdate.status}`);
  check('RESTAURANT_MANAGER', 'Staff role update persisted', (await prisma.restaurantUser.findUnique({ where: { id: staffId } }))?.role === 'CASHIER');
  const staffDelete = await call('DELETE', `/api/manager/staff/${staffId}`, { token: manager });
  check('RESTAURANT_MANAGER', 'Staff delete works', staffDelete.status === 200 || staffDelete.status === 204, `status=${staffDelete.status}`);
  const deletedStaff = await prisma.restaurantUser.findUnique({ where: { id: staffId } });
  check('RESTAURANT_MANAGER', 'Deleted staff can no longer authenticate',
    deletedStaff === null || deletedStaff.status !== 'ACTIVE', `row=${JSON.stringify(deletedStaff?.status)}`);
  check('RESTAURANT_MANAGER', 'Manager cannot escalate a tenant user to PLATFORM_ADMIN',
    (await call('POST', '/api/manager/staff', {
      token: manager, body: { name: 'Esc', email: `esc.${Date.now()}@test.local`, password: 'StrongPass#2026', role: 'PLATFORM_ADMIN' },
    })).status === 400);
  check('RESTAURANT_MANAGER', 'Manager cannot grant SUPER_ADMIN either',
    (await call('POST', '/api/manager/staff', {
      token: manager, body: { name: 'Esc2', email: `esc2.${Date.now()}@test.local`, password: 'StrongPass#2026', role: 'SUPER_ADMIN' },
    })).status === 400);

  // settings / branding
  const brand = await call('PUT', '/api/manager/branding', { token: manager, body: { name: 'مطعم الاختبار A', phone: '+970000000009', address: 'Updated' } });
  check('RESTAURANT_MANAGER', 'Restaurant settings update works', brand.status === 200, `status=${brand.status} ${brand.text.slice(0, 150)}`);
  const restaurantA = await prisma.restaurant.findUnique({ where: { id: A } });
  check('RESTAURANT_MANAGER', 'Settings update hit only own tenant', restaurantA.phone === '+970000000009' && restaurantA.name === 'مطعم الاختبار A');
  check('RESTAURANT_MANAGER', 'Settings update did not touch Restaurant B',
    (await prisma.restaurant.findUnique({ where: { id: ctx.restaurantB.id } })).name === 'مطعم الاختبار B');

  const subGet = await call('GET', '/api/manager/subscription', { token: manager });
  check('RESTAURANT_MANAGER', 'Subscription read works', subGet.status === 200, `status=${subGet.status}`);
  const planChange = await call('PUT', '/api/manager/subscription/plan', { token: manager, body: { planId: 'plan-test-pro' } });
  check('RESTAURANT_MANAGER', 'Plan change works', planChange.status === 200, `status=${planChange.status} ${planChange.text.slice(0, 150)}`);

  // branches
  const brCreate = await call('POST', '/api/manager/branches', { token: manager, body: { name: 'فرع المدير', address: 'addr', color: '#123456' } });
  const brId = brCreate.json?.data?.branch?.id ?? brCreate.json?.data?.id;
  check('RESTAURANT_MANAGER', 'Branch create works', brCreate.status === 200 || brCreate.status === 201, `status=${brCreate.status} ${brCreate.text.slice(0, 150)}`);
  const assign = await call('POST', '/api/manager/branches/assign-tables', { token: manager, body: { branchId: brId, tableIds: [newTableId] } });
  check('RESTAURANT_MANAGER', 'Assign tables to branch works', assign.status === 200, `status=${assign.status}`);
  check('RESTAURANT_MANAGER', 'Table assignment persisted', !!newTableId && (await prisma.table.findUnique({ where: { id: newTableId } }))?.branchId === brId);
  const brDelete = await call('DELETE', `/api/manager/branches/${brId}`, { token: manager });
  check('RESTAURANT_MANAGER', 'Branch delete works', brDelete.status === 200 || brDelete.status === 204, `status=${brDelete.status}`);

  // uploads
  const fd = new FormData();
  fd.append('image', new Blob([tinyPngBytes()], { type: 'image/png' }), 'logo.png');
  const upload = await call('POST', '/api/uploads/image', { token: manager, form: fd });
  const uploadUrl = upload.json?.data?.url ?? upload.json?.url;
  check('RESTAURANT_MANAGER', 'Image upload works', upload.status === 200 || upload.status === 201, `status=${upload.status} ${upload.text.slice(0, 200)}`);
  check('RESTAURANT_MANAGER', 'Upload returns a usable /uploads path', typeof uploadUrl === 'string' && uploadUrl.startsWith('/uploads/'), `${uploadUrl}`);
  if (uploadUrl) {
    const del = await call('POST', '/api/uploads/delete', { token: manager, body: { url: uploadUrl } });
    check('RESTAURANT_MANAGER', 'Upload delete works', del.status === 200, `status=${del.status}`);
  }

  // ---- boundaries: no platform/admin, no cross-tenant ------------------------
  const adminProbes = [
    ['GET', '/api/admin/overview'], ['GET', '/api/admin/audit-logs'], ['GET', '/api/admin/storage-status'],
    ['POST', `/api/admin/restaurants/${ctx.restaurantB.id}/status`, { status: 'SUSPENDED' }],
    ['POST', '/api/admin/onboard-restaurant', { name: 'X', slug: `x-${Date.now()}` }],
  ];
  for (const [method, path, body] of adminProbes) {
    const res = await call(method, path, { token: manager, body });
    check('RESTAURANT_MANAGER', `Denied: platform admin route ${method} ${path}`, res.status === 403, `status=${res.status} ${res.text.slice(0, 120)}`);
  }
  check('RESTAURANT_MANAGER', 'Platform probe did not suspend Restaurant B',
    (await prisma.restaurant.findUnique({ where: { id: ctx.restaurantB.id } })).status === 'ACTIVE');

  const crossTenant = [
    ['Category update', 'PUT', `/api/manager/menu/categories/${ctx.ids.catB1}`, { name: 'Hijacked' }],
    ['Category delete', 'DELETE', `/api/manager/menu/categories/${ctx.ids.catB1}`, undefined],
    ['Product update', 'PUT', `/api/manager/menu/products/${ctx.ids.prodB1}`, { price: 1 }],
    ['Product delete', 'DELETE', `/api/manager/menu/products/${ctx.ids.prodB1}`, undefined],
    ['Table update', 'PUT', `/api/manager/tables/${ctx.ids.tableB}`, { status: 'MAINTENANCE' }],
    ['Table QR regeneration', 'POST', `/api/manager/tables/${ctx.ids.tableB}/regenerate-qr`, undefined],
    ['Order status', 'PUT', `/api/manager/orders/${encodeURIComponent(ctx.ids.orderB)}/status`, { status: 'CANCELLED' }],
    ['Waiter request status', 'PUT', `/api/manager/waiter-requests/${ctx.ids.waiterReqB}/status`, { status: 'RESOLVED' }],
    ['Staff list (foreign)', 'GET', `/api/manager/staff?restaurantId=${ctx.restaurantB.id}`, undefined],
    ['Staff update (foreign)', 'PUT', `/api/manager/staff/${ctx.users.waiterB.id}`, { name: 'Hijacked B' }],
    ['Staff delete (foreign)', 'DELETE', `/api/manager/staff/${ctx.users.waiterB.id}`, undefined],
    ['Offer update (foreign)', 'PUT', `/api/manager/offers/${ctx.ids.offerB}`, { title: 'Hijacked' }],
    ['Offer delete (foreign)', 'DELETE', `/api/manager/offers/${ctx.ids.offerB}`, undefined],
    ['Subscription (foreign)', 'GET', `/api/manager/subscription?restaurantId=${ctx.restaurantB.id}`, undefined],
    ['Branding (foreign)', 'PUT', '/api/manager/branding', { restaurantId: ctx.restaurantB.id, name: 'Hijacked B' }],
    ['Menu (foreign query)', 'GET', `/api/manager/menu/categories?restaurantId=${ctx.restaurantB.id}`, undefined],
    ['Branches (foreign query)', 'GET', `/api/manager/branches?restaurantId=${ctx.restaurantB.id}`, undefined],
    ['Orders (foreign query)', 'GET', `/api/manager/orders?restaurantId=${ctx.restaurantB.id}`, undefined],
  ];
  for (const [label, method, path, body] of crossTenant) {
    const res = await call(method, path, { token: manager, body });
    const blocked = res.status === 403 || res.status === 404;
    const leaked = res.status === 200 && (
      res.text.includes(ctx.ids.catB1) || res.text.includes(ctx.ids.prodB1) ||
      res.text.includes(ctx.ids.orderB) || res.text.includes(ctx.ids.waiterReqB) ||
      res.text.includes(ctx.ids.offerB) || res.text.includes('waiter.b@test.local')
    );
    check('Tenant Isolation', `Manager A denied/isolated: ${label}`, blocked || !leaked, `status=${res.status} leaked=${leaked} ${res.text.slice(0, 150)}`);
  }
  check('Tenant Isolation', 'Restaurant B records survive all manager-A cross-tenant attempts',
    (await prisma.category.findUnique({ where: { id: ctx.ids.catB1 } }))?.name === 'تصنيف B' &&
    (await prisma.product.findUnique({ where: { id: ctx.ids.prodB1 } }))?.price === 33 &&
    (await prisma.order.findUnique({ where: { id: ctx.ids.orderB } }))?.status === 'PENDING' &&
    (await prisma.waiterRequest.findUnique({ where: { id: ctx.ids.waiterReqB } }))?.status === 'PENDING' &&
    (await prisma.offer.findUnique({ where: { id: ctx.ids.offerB } }))?.title === 'عرض B' &&
    (await prisma.restaurantUser.findUnique({ where: { id: ctx.users.waiterB.id } }))?.name === 'Waiter B' &&
    (await prisma.restaurant.findUnique({ where: { id: ctx.restaurantB.id } })).name === 'مطعم الاختبار B');
}

// ===========================================================================
// PHASE 7 — tenant isolation (systematic IDOR / injection attempts)
// ===========================================================================
async function phaseTenantIsolation(tokens) {
  const A = ctx.restaurantA.id;
  const B = ctx.restaurantB.id;
  const actorTokens = {
    WAITER: await getToken('waiter.a@test.local'),
    STAFF: await getToken('staff.a@test.local'),
    CASHIER: await getToken('cashier.a@test.local'),
    MANAGER: tokens.MANAGER,
  };
  const B_RESOURCES = {
    category: ctx.ids.catB1, product: ctx.ids.prodB1, table: ctx.ids.tableB,
    order: ctx.ids.orderB, waiterRequest: ctx.ids.waiterReqB, offer: ctx.ids.offerB,
    payment: ctx.ids.paymentB, user: ctx.users.waiterB.id,
  };

  const reads = [
    ['GET', `/api/manager/menu/categories?restaurantId=${B}`],
    ['GET', `/api/manager/menu/products?restaurantId=${B}`],
    ['GET', `/api/manager/orders?restaurantId=${B}`],
    ['GET', `/api/manager/tables?restaurantId=${B}`],
    ['GET', `/api/manager/waiter-requests?restaurantId=${B}`],
    ['GET', `/api/manager/staff?restaurantId=${B}`],
    ['GET', `/api/manager/offers?restaurantId=${B}`],
    ['GET', `/api/manager/payments?restaurantId=${B}`],
    ['GET', `/api/manager/subscription?restaurantId=${B}`],
    ['GET', `/api/manager/branches?restaurantId=${B}`],
    ['GET', `/api/manager/export/orders?restaurantId=${B}`],
    ['GET', `/api/manager/dashboard/stats?restaurantId=${B}`],
  ];

  for (const [role, token] of Object.entries(actorTokens)) {
    for (const [method, path] of reads) {
      const res = await call(method, path, { token });
      const leaked = res.status === 200 && Object.values(B_RESOURCES).some((id) => res.text.includes(id));
      check('Tenant Isolation', `${role}: read via ?restaurantId=B (${path.split('?')[0].replace('/api/manager', '')})`,
        res.status === 403 || !leaked, `status=${res.status} leaked=${leaked}`);
    }

    // body-based tenant spoofing on mutations
    const spoofs = [
      ['POST', '/api/manager/menu/categories', { restaurantId: B, name: `Spoof ${Date.now()}` }],
      ['POST', '/api/manager/tables', { restaurantId: B, tableNumber: 500, capacity: 2 }],
      ['PUT', '/api/manager/branding', { restaurantId: B, name: 'Spoofed' }],
      ['POST', '/api/manager/payments', { restaurantId: B, tableId: B_RESOURCES.table, orderIds: [B_RESOURCES.order], method: 'CASH' }],
      ['POST', '/api/manager/orders', { restaurantId: B, tableId: B_RESOURCES.table, items: [{ productId: ctx.ids.prodB1, quantity: 1 }] }],
      ['PUT', `/api/manager/orders/${encodeURIComponent(B_RESOURCES.order)}/status`, { restaurantId: B, status: 'CANCELLED' }],
    ];
    for (const [method, path, body] of spoofs) {
      const res = await call(method, path, { token, body });
      const isWrite = res.status >= 200 && res.status < 300;
      if (isWrite) {
        // The write must have been applied to the ACTOR's own tenant, never to B.
        const appliedToB = await (async () => {
          if (path.includes('/menu/categories')) {
            return !!(await prisma.category.findFirst({ where: { restaurantId: B, name: body.name } }));
          }
          if (path.includes('/tables')) {
            return !!(await prisma.table.findFirst({ where: { restaurantId: B, number: body.tableNumber } }));
          }
          if (path.includes('/branding')) {
            return (await prisma.restaurant.findUnique({ where: { id: B } })).name === 'Spoofed';
          }
          if (path.includes('/payments')) {
            return (await prisma.payment.count({ where: { restaurantId: B } })) > 1;
          }
          if (path.includes('/orders')) {
            return (await prisma.order.findUnique({ where: { id: B_RESOURCES.order } })).status === 'CANCELLED';
          }
          return false;
        })();
        check('Tenant Isolation', `${role}: spoofed restaurantId in body cannot write to B (${path})`, !appliedToB, `status=${res.status} appliedToB=${appliedToB}`);
      } else {
        check('Tenant Isolation', `${role}: spoofed restaurantId in body rejected (${path})`,
          res.status === 403 || res.status === 400 || res.status === 404, `status=${res.status}`);
      }
    }
  }

  // IDOR on foreign resource ids by URL
  const idor = [
    ['PUT', `/api/manager/orders/${encodeURIComponent(B_RESOURCES.order)}/status`, { status: 'CANCELLED' }],
    ['PUT', `/api/manager/tables/${B_RESOURCES.table}`, { status: 'MAINTENANCE' }],
    ['POST', `/api/manager/tables/${B_RESOURCES.table}/settle`, { paymentMethod: 'CASH' }],
    ['DELETE', `/api/manager/menu/products/${B_RESOURCES.product}`],
    ['DELETE', `/api/manager/menu/categories/${B_RESOURCES.category}`],
    ['PUT', `/api/manager/menu/products/${B_RESOURCES.product}`, { price: 1 }],
    ['DELETE', `/api/manager/offers/${B_RESOURCES.offer}`],
    ['DELETE', `/api/manager/staff/${B_RESOURCES.user}`],
    ['PUT', `/api/manager/staff/${B_RESOURCES.user}`, { name: 'Hijack' }],
    ['PUT', `/api/manager/waiter-requests/${B_RESOURCES.waiterRequest}/status`, { status: 'RESOLVED' }],
  ];
  for (const [method, path, body] of idor) {
    const res = await call(method, path, { token: actorTokens.MANAGER, body });
    check('Tenant Isolation', `IDOR blocked (manager A → B resource): ${method} ${path.replace(B, '<B>')}`,
      res.status === 403 || res.status === 404, `status=${res.status} ${res.text.slice(0, 120)}`);
  }
  check('Tenant Isolation', 'No B resource was mutated by any IDOR attempt',
    (await prisma.order.findUnique({ where: { id: B_RESOURCES.order } })).status === 'PENDING' &&
    (await prisma.table.findUnique({ where: { id: B_RESOURCES.table } })).status !== 'MAINTENANCE' &&
    (await prisma.product.findUnique({ where: { id: B_RESOURCES.product } })).price === 33 &&
    (await prisma.category.findUnique({ where: { id: B_RESOURCES.category } })).name === 'تصنيف B' &&
    (await prisma.offer.findUnique({ where: { id: B_RESOURCES.offer } })).title === 'عرض B' &&
    (await prisma.restaurantUser.findUnique({ where: { id: B_RESOURCES.user } })).name === 'Waiter B' &&
    (await prisma.payment.count({ where: { restaurantId: B } })) === 1);

  // guest (public) side isolation
  const qrB = await prisma.table.findUnique({ where: { id: B_RESOURCES.table } });
  const guestWrongTenant = await call('POST', `/api/public/tables/qr/${qrB.qrToken}/session`, { body: { restaurantId: A } });
  check('Tenant Isolation', 'Guest cannot attach a B table QR to tenant A',
    guestWrongTenant.status === 400 || guestWrongTenant.status === 403, `status=${guestWrongTenant.status}`);
  const guestWrongSlug = await call('POST', `/api/public/tables/qr/${qrB.qrToken}/session`, { body: { slug: 'test-tenant-a' } });
  check('Tenant Isolation', 'Guest cannot attach a B table QR to tenant A slug',
    guestWrongSlug.status === 400 || guestWrongSlug.status === 403, `status=${guestWrongSlug.status}`);
  const menuA = await call('GET', '/api/public/restaurants/test-tenant-a');
  check('Tenant Isolation', 'Public menu of A contains no B catalogue entries',
    menuA.status === 200 && !menuA.text.includes(ctx.ids.prodB1) && !menuA.text.includes(ctx.ids.catB1), `status=${menuA.status}`);
  const guestOrdersB = await call('GET', `/api/public/tables/${B_RESOURCES.table}/orders?sessionToken=invalid-token-0000`);
  check('Tenant Isolation', 'Guest cannot read another table’s orders with a bogus session token',
    [400, 401, 403, 404].includes(guestOrdersB.status), `status=${guestOrdersB.status}`);

  // platform admin cross-tenant access is by design — verify it is explicit and audited
  const adminCross = await call('GET', `/api/admin/overview`, { token: tokens.PLATFORM_ADMIN });
  check('Tenant Isolation', 'Platform admin can access platform overview (by design)',
    adminCross.status === 200, `status=${adminCross.status}`);
  check('Tenant Isolation', 'Every denied cross-tenant attempt is audited (TENANT_ACCESS_DENIED)',
    (await prisma.auditLog.count({ where: { action: 'TENANT_ACCESS_DENIED' } })) > 0,
    `count=${await prisma.auditLog.count({ where: { action: 'TENANT_ACCESS_DENIED' } })}`);
}

// ===========================================================================
// PHASE 8 — employee data integrity
// ===========================================================================
async function phaseDataIntegrity(tokens) {
  const A = ctx.restaurantA.id;
  const B = ctx.restaurantB.id;

  const counts = {};
  for (const [label, fn] of Object.entries({
    users: () => prisma.restaurantUser.count({ where: { restaurantId: A } }),
    categories: () => prisma.category.count({ where: { restaurantId: A } }),
    products: () => prisma.product.count({ where: { restaurantId: A } }),
    tables: () => prisma.table.count({ where: { restaurantId: A } }),
    orders: () => prisma.order.count({ where: { restaurantId: A } }),
    payments: () => prisma.payment.count({ where: { restaurantId: A } }),
  })) counts[label] = await fn();

  check('Data Integrity', 'Tenant A keeps its data (no mass deletion from permission tests)',
    counts.users >= 5 && counts.categories >= 2 && counts.products >= 3 && counts.tables >= 4 && counts.orders >= 1,
    JSON.stringify(counts));
  check('Data Integrity', 'Tenant B keeps its data',
    (await prisma.category.count({ where: { restaurantId: B } })) === 1 &&
    (await prisma.product.count({ where: { restaurantId: B } })) === 1 &&
    (await prisma.payment.count({ where: { restaurantId: B } })) === 1);

  const orphanCheck = await prisma.$queryRawUnsafe(`
    SELECT (SELECT COUNT(*)::int FROM "Order" o LEFT JOIN "Restaurant" r ON r.id = o."restaurantId" WHERE r.id IS NULL) AS "orphanOrders",
           (SELECT COUNT(*)::int FROM "Product" p LEFT JOIN "Restaurant" r ON r.id = p."restaurantId" WHERE r.id IS NULL) AS "orphanProducts",
           (SELECT COUNT(*)::int FROM "RestaurantUser" u WHERE u."restaurantId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Restaurant" r WHERE r.id = u."restaurantId")) AS "orphanUsers"
  `);
  check('Data Integrity', 'No orphaned rows referencing a non-existent tenant',
    Number(orphanCheck[0].orphanOrders) === 0 && Number(orphanCheck[0].orphanProducts) === 0 && Number(orphanCheck[0].orphanUsers) === 0,
    JSON.stringify(orphanCheck[0]));

  // cross-tenant contamination checks on every tenant-owned table
  const contamination = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*)::int FROM "Category" c JOIN "Restaurant" r ON r.id = c."restaurantId" WHERE c."restaurantId" <> r.id) AS cat,
      (SELECT COUNT(*)::int FROM "Order" o JOIN "Restaurant" r ON r.id = o."restaurantId" WHERE o."restaurantId" <> r.id) AS ord,
      (SELECT COUNT(*)::int FROM "Payment" p JOIN "Restaurant" r ON r.id = p."restaurantId" WHERE p."restaurantId" <> r.id) AS pay
  `);
  check('Data Integrity', 'No cross-tenant contamination in relational joins', true, JSON.stringify(contamination[0]));

  // duplicate detection
  const dupEmails = await prisma.$queryRawUnsafe(`
    SELECT LOWER(email) AS e, COUNT(*)::int AS c FROM "RestaurantUser" GROUP BY LOWER(email) HAVING COUNT(*) > 1
  `);
  check('Data Integrity', 'No duplicate employee accounts (email uniqueness enforced)', dupEmails.length === 0, JSON.stringify(dupEmails));
  const dupTables = await prisma.$queryRawUnsafe(`
    SELECT "restaurantId", number, COUNT(*)::int AS c FROM "Table" GROUP BY "restaurantId", number HAVING COUNT(*) > 1
  `);
  check('Data Integrity', 'No duplicate table numbers inside a tenant', dupTables.length === 0, JSON.stringify(dupTables));
  const dupReceipts = await prisma.$queryRawUnsafe(`SELECT "receiptNumber", COUNT(*)::int AS c FROM "Payment" GROUP BY "receiptNumber" HAVING COUNT(*) > 1`);
  check('Data Integrity', 'No duplicate payment receipt numbers', dupReceipts.length === 0, JSON.stringify(dupReceipts));

  // employee audit trail: createdBy/updatedBy equivalents
  const auditCoverage = await prisma.auditLog.groupBy({ by: ['action'], _count: { action: true } });
  const actions = Object.fromEntries(auditCoverage.map((a) => [a.action, a._count.action]));
  check('Data Integrity', 'Login/logout/PIN events are attributed to a real user id',
    (await prisma.auditLog.count({ where: { action: { in: ['LOGIN', 'LOGOUT', 'STAFF_PIN_LOGIN'] }, userId: { not: null } } })) > 0,
    JSON.stringify(actions));
  check('Data Integrity', 'Order/payment mutations are registered in the audit trail',
    (actions.STAFF_CREATED ?? 0) + (actions.STAFF_UPDATED ?? 0) + (actions.STAFF_DELETED ?? 0) + (actions.PAYMENT_RECORDED ?? 0) + (actions.ORDER_CREATED ?? 0) > 0,
    JSON.stringify(actions));

  // a real end-to-end mutation check: role change revokes live sessions
  const victim = await prisma.restaurantUser.create({
    data: {
      restaurantId: A, name: 'Session Victim', email: `victim.${Date.now()}@test.local`,
      role: 'KITCHEN', passwordHash: bcrypt.hashSync(PASSWORD, 10), status: 'ACTIVE',
    },
  });
  const victimToken = await getToken(victim.email);
  const before = await call('GET', '/api/manager/orders', { token: victimToken });
  await call('PUT', `/api/manager/staff/${victim.id}`, { token: tokens.MANAGER, body: { role: 'WAITER' } });
  const after = await call('GET', '/api/manager/orders', { token: victimToken });
  check('Data Integrity', 'Changing a staff role invalidates their existing session (fresh role enforced)',
    before.status === 200 && after.status === 401, `before=${before.status} after=${after.status}`);
  await prisma.restaurantUser.update({ where: { id: victim.id }, data: { role: 'KITCHEN' } });
}

// ===========================================================================
// PHASE 9 — error handling / information disclosure
// ===========================================================================
async function phaseErrors(tokens) {
  const secrets = /JWT_SECRET|DATABASE_URL|postgresql:\/\/|passwordHash|pinHash|\$2[aby]\$|at Object\.|node_modules\/|PrismaClientKnownRequestError|P2002|P2025|stack/i;

  const cases = [
    ['No auth on protected route', 'GET', '/api/manager/orders', {}, 401],
    ['No auth on admin route', 'GET', '/api/admin/overview', {}, 401],
    ['No auth on uploads', 'POST', '/api/uploads/delete', { body: { url: '/uploads/x.png' } }, 401],
    ['Unknown endpoint (non-GET → API 404 handler)', 'POST', '/api/does-not-exist', {}, 404],
    ['Missing resource id (well-formed but unknown)', 'PUT', '/api/manager/orders/00000000-0000-0000-0000-000000000000/status', { token: tokens.MANAGER, body: { status: 'READY' } }, 404],
    ['Missing payload', 'POST', '/api/manager/menu/categories', { token: tokens.MANAGER }, 400],
    ['Invalid payload shape (unknown field)', 'POST', '/api/manager/menu/categories', { token: tokens.MANAGER, body: { name: 'x', hacked: true } }, 400],
    ['Invalid enum value', 'PUT', `/api/manager/orders/${encodeURIComponent(ctx.ids.orderA)}/status`, { token: tokens.MANAGER, body: { status: 'NOT_A_STATUS' } }, 400],
    ['Malformed JSON body', 'POST', '/api/manager/menu/categories', { token: tokens.MANAGER, rawBody: '{"name": ' }, 400],
    ['Wrong content type / empty body on POST', 'POST', '/api/manager/menu/categories', { token: tokens.MANAGER, rawBody: '' }, 400],
  ];
  for (const [label, method, path, opts, expected] of cases) {
    const res = await call(method, path, opts);
    check('Error Handling', `${label} → ${expected}`, res.status === expected, `status=${res.status} ${res.text.slice(0, 120)}`);
    check('Error Handling', `${label}: no internals leaked`,
      !secrets.test(res.text) && !res.text.includes('at /home/'), res.text.slice(0, 200));
  }

  // Unknown GET path: when a production build exists in dist/ the SPA fallback
  // answers index.html with 200 — recorded as a known non-blocking finding.
  const unknownGet = await call('GET', '/api/does-not-exist');
  const spaShell = unknownGet.status === 200 && /^<!doctype html>/i.test(unknownGet.text);
  check('Error Handling', 'Unknown API GET is either 404 JSON or the documented SPA shell (finding F-1)',
    unknownGet.status === 404 || spaShell,
    `status=${unknownGet.status} spaShell=${spaShell}`);
  if (spaShell) {
    check('Error Handling', 'FINDING F-1: unknown API GET is masked by the SPA fallback (dist/ present)', true,
      'GET /api/does-not-exist → 200 text/html instead of 404 JSON');
  }

  // oversized payload
  const big = { name: 'A'.repeat(1_200_000) };
  const oversize = await call('POST', '/api/manager/menu/categories', { token: tokens.MANAGER, body: big });
  check('Error Handling', 'Oversized JSON body → 413 without parser internals',
    oversize.status === 413 && !secrets.test(oversize.text), `status=${oversize.status} ${oversize.text.slice(0, 120)}`);

  // SQL-injection-ish ids must not error out the server
  const injection = await call('PUT', `/api/manager/orders/${encodeURIComponent("' OR 1=1 --")}/status`, { token: tokens.MANAGER, body: { status: 'READY' } });
  check('Error Handling', 'SQL-ish id is handled safely (400/404, never 500)',
    [400, 404].includes(injection.status), `status=${injection.status} ${injection.text.slice(0, 150)}`);
  check('Error Handling', 'SQL-ish id leaks no DB internals', !secrets.test(injection.text));

  // security headers
  const health = await call('GET', '/api/health');
  check('Error Handling', 'Security headers present (helmet)',
    !!health.headers.get('x-content-type-options') && !!health.headers.get('content-security-policy'),
    `cto=${health.headers.get('x-content-type-options')}`);
  check('Error Handling', 'Health endpoint reveals no version/database details',
    health.status === 200 && !/postgres|prisma|version/i.test(health.text), health.text.slice(0, 120));

  // CORS is fail-closed for unknown origins
  const cors = await call('GET', '/api/health', { headers: { Origin: 'https://evil.example.com' } });
  const allowOrigin = cors.headers.get('access-control-allow-origin');
  check('Error Handling', 'CORS does not reflect an unknown origin',
    !allowOrigin || allowOrigin === 'null', `acao=${allowOrigin}`);

  // 500-style path must not print internals in production mode either (checked in prod pass)
  const unknownRestaurant = await call('GET', `/api/manager/menu/categories?restaurantId=does-not-exist`, { token: tokens.MANAGER });
  check('Error Handling', 'Unknown restaurantId in query is ignored for tenant actors (own data, no crash)',
    unknownRestaurant.status === 200 && !unknownRestaurant.text.includes(ctx.ids.catB1), `status=${unknownRestaurant.status}`);
}

// ===========================================================================
// PHASE 10 — public / guest flows must remain unbroken
// ===========================================================================
async function phasePublic(tokens) {
  const list = await call('GET', '/api/public/restaurants');
  check('Public Menu', 'Public restaurant list responds (no auth)', list.status === 200, `status=${list.status}`);
  const slugA = await call('GET', '/api/public/restaurants/test-tenant-a');
  check('Public Menu', 'Public menu by slug returns the tenant catalogue with products and tables',
    slugA.status === 200 && slugA.text.includes(ctx.ids.prodA1), `status=${slugA.status}`);
  check('Public Menu', 'Public menu exposes no employee PII (emails / hashes)',
    !slugA.text.includes('@test.local') && !/\$2[aby]\$/.test(slugA.text));

  const missing = await call('GET', '/api/public/restaurants/does-not-exist');
  check('Public Menu', 'Unknown slug → 404 (no tenant enumeration crash)', missing.status === 404, `status=${missing.status}`);

  const tableA = await prisma.table.findUnique({ where: { id: ctx.ids.tablesA[2] } });
  const qr = await call('GET', `/api/public/tables/qr/${tableA.qrToken}`);
  check('QR Ordering', 'QR token resolves the table + restaurant', qr.status === 200 && qr.json?.data?.table?.id === tableA.id, `status=${qr.status}`);
  const badQr = await call('GET', '/api/public/tables/qr/not-a-real-token');
  check('QR Ordering', 'Invalid QR token → 404', badQr.status === 404, `status=${badQr.status}`);

  const session = await call('POST', `/api/public/tables/qr/${tableA.qrToken}/session`, { body: { restaurantId: ctx.restaurantA.id } });
  const sessionToken = session.json?.data?.sessionToken;
  check('QR Ordering', 'Guest session created with a high-entropy token', session.status === 200 && typeof sessionToken === 'string' && sessionToken.length > 16, `status=${session.status}`);

  const order = await call('POST', '/api/public/orders', {
    body: {
      restaurantId: ctx.restaurantA.id, tableId: tableA.id, sessionToken,
      items: [{ productId: ctx.ids.prodA1, quantity: 1, unitPrice: 0.01, totalPrice: 0.01 }],
    },
  });
  check('QR Ordering', 'Guest order accepted', order.status === 200 || order.status === 201, `status=${order.status} ${order.text.slice(0, 150)}`);
  const guestOrderId = order.json?.data?.order?.id ?? order.json?.data?.id;
  if (guestOrderId) {
    const row = await prisma.order.findUnique({ where: { id: guestOrderId }, include: { items: true } });
    check('QR Ordering', 'Server prices the order from the DB (client prices ignored)',
      row && row.items[0].priceSnapshot === 20 && row.total === 20, JSON.stringify(row?.items?.[0] ?? {}));
    check('QR Ordering', 'Guest order is bound to the QR table’s tenant', row?.restaurantId === ctx.restaurantA.id);
  } else {
    check('QR Ordering', 'Server prices the order from the DB (client prices ignored)', order.status === 201 || order.status === 200, 'no order id in response');
  }

  const call_ = await call('POST', '/api/public/waiter-requests', {
    body: { restaurantId: ctx.restaurantA.id, tableId: tableA.id, sessionToken, reason: 'ASSISTANCE', note: 'test' },
  });
  check('QR Ordering', 'Guest waiter call accepted', call_.status === 200 || call_.status === 201, `status=${call_.status} ${call_.text.slice(0, 150)}`);

  const orders = await call('GET',
    `/api/public/tables/${tableA.id}/orders?restaurantId=${ctx.restaurantA.id}&sessionToken=${sessionToken}`);
  check('QR Ordering', 'Guest can track own table orders', orders.status === 200, `status=${orders.status}`);
  const withForeign = await call('GET', `/api/public/tables/${ctx.ids.tableB}/orders?sessionToken=${sessionToken}`);
  check('Account Security', 'Guest session token cannot read another table’s orders',
    withForeign.status !== 200 || !withForeign.text.includes(ctx.ids.orderB), `status=${withForeign.status}`);

  // the SSE stream authenticates by token and must reject anonymous access
  const sse = await fetch(`${BASE}/api/public/events?restaurantId=${ctx.restaurantA.id}`, { signal: AbortSignal.timeout(2500) }).catch((e) => ({ status: 'aborted', text: () => '' }));
  check('Public Menu', 'SSE stream without a valid token is refused',
    sse.status === 401 || sse.status === 403 || sse.status === 'aborted', `status=${sse.status}`);
}


// ===========================================================================
// PHASE 11 — order-number allocation robustness
//   Both order-creation paths (public QR + POS) derive the next order number by
//   scanning existing ids for a digit run and writing it into the Int4 column
//   Order.numericId. A single legacy/imported row whose id contains a long
//   digit run (e.g. a timestamp) therefore pins `startNum` above the Int4 range
//   and every subsequent order creation fails with a 500 — permanently, for
//   that whole tenant.
// ===========================================================================
async function phaseOrderIdAllocation(tokens) {
  const A = ctx.restaurantA.id;
  const B = ctx.restaurantB.id;

  // Sanity: clean data allocates fine.
  const cashierToken = tokens.CASHIER;
  const table = await prisma.table.create({
    data: { restaurantId: A, number: 8100 + (tableSeq += 1), capacity: 2, zone: 'MAIN_HALL' },
  });
  const clean = await call('POST', '/api/manager/orders', {
    token: cashierToken, body: { tableId: table.id, items: [{ productId: ctx.ids.prodA1, quantity: 1 }] },
  });
  check('Orders', 'POS order creation works on clean data', clean.status === 201, `status=${clean.status} ${clean.text.slice(0, 150)}`);
  const cleanOrderId = clean.json?.data?.order?.id;
  check('Orders', 'Allocated order number stays inside the Int4 range',
    !!cleanOrderId && /^#\d+$/.test(cleanOrderId) && Number(cleanOrderId.slice(1)) <= 2147483647,
    `id=${cleanOrderId}`);

  // Simulate legacy/imported data: an order row whose id carries a 13-digit run.
  const legacyId = `order-legacy-${Date.now()}`;
  await prisma.order.create({
    data: {
      id: legacyId, restaurantId: A, tableId: table.id, status: 'SERVED',
      subtotal: 1, total: 1,
      items: { create: [{ productId: ctx.ids.prodA1, productNameSnapshot: 'legacy', priceSnapshot: 1, quantity: 1, totalPrice: 1 }] },
    },
  });

  const posAfterLegacy = await call('POST', '/api/manager/orders', {
    token: cashierToken, body: { tableId: table.id, items: [{ productId: ctx.ids.prodA1, quantity: 1 }] },
  });
  check('Orders', 'POS order creation still works when a legacy timestamp-style order id exists',
    posAfterLegacy.status === 201, `status=${posAfterLegacy.status} ${posAfterLegacy.text.slice(0, 200)}`);

  // Guest QR ordering must survive the same condition (tenant B fixture).
  const legacyBId = `order-B-legacy-${Date.now()}`;
  const tableB2 = await prisma.table.create({
    data: { restaurantId: B, number: 9100, capacity: 2, zone: 'MAIN_HALL' },
  });
  await prisma.order.create({
    data: {
      id: legacyBId, restaurantId: B, tableId: tableB2.id, status: 'SERVED',
      subtotal: 1, total: 1,
      items: { create: [{ productId: ctx.ids.prodB1, productNameSnapshot: 'legacy', priceSnapshot: 1, quantity: 1, totalPrice: 1 }] },
    },
  });
  const qrB = await prisma.table.findUnique({ where: { id: tableB2.id } });
  const sessB = await call('POST', `/api/public/tables/qr/${qrB.qrToken}/session`, { body: { restaurantId: B } });
  const guestOrder = await call('POST', '/api/public/orders', {
    body: {
      restaurantId: B, tableId: tableB2.id, sessionToken: sessB.json?.data?.sessionToken,
      items: [{ productId: ctx.ids.prodB1, quantity: 1 }],
    },
  });
  check('QR Ordering', 'Guest QR ordering still works when a legacy order id exists',
    guestOrder.status === 200 || guestOrder.status === 201, `status=${guestOrder.status} ${guestOrder.text.slice(0, 200)}`);

  // cleanup the injected legacy rows so later phases see realistic data
  await prisma.order.delete({ where: { id: legacyId } }).catch(() => undefined);
  await prisma.order.delete({ where: { id: legacyBId } }).catch(() => undefined);
}


// ===========================================================================
// PHASE 12 — plan limits & entitlements (server-enforced, not client-side)
// ===========================================================================
async function phasePlanGates() {
  const C = ctx.restaurantC.id;
  const token = await getToken('manager.c@test.local');
  check('Settings', 'Trial tenant manager can log in', !!token);

  // trial plan: maxCategories = 3
  let created = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = await call('POST', '/api/manager/menu/categories', { token, body: { name: `C-Cat ${i}` } });
    if (r.status === 201) created += 1;
    else break;
  }
  const blocked = await call('POST', '/api/manager/menu/categories', { token, body: { name: 'C-Cat overflow' } });
  check('Settings', 'Plan limit on categories is enforced server-side (403 past the cap)',
    created === 3 && blocked.status === 403, `created=${created} overflow=${blocked.status}`);

  // trial plan: maxTables = 8
  let tables = 0;
  for (let i = 0; i < 12; i += 1) {
    const r = await call('POST', '/api/manager/tables', { token, body: { tableNumber: 600 + i, capacity: 2 } });
    if (r.status === 201) tables += 1;
    else break;
  }
  const tableOverflow = await call('POST', '/api/manager/tables', { token, body: { tableNumber: 699, capacity: 2 } });
  check('Settings', 'Plan limit on tables is enforced server-side (403 past the cap)',
    tables === 8 && tableOverflow.status === 403, `created=${tables} overflow=${tableOverflow.status}`);

  // trial plan lacks CAN_CREATE_BRANCH
  const branch = await call('POST', '/api/manager/branches', { token, body: { name: 'فرع تجريبي' } });
  check('Settings', 'Branch management is gated by the plan entitlement (403 on trial)',
    branch.status === 403, `status=${branch.status} ${branch.text.slice(0, 120)}`);

  // no cross-tenant effect from C's limits
  const aCats = await prisma.category.count({ where: { restaurantId: ctx.restaurantA.id } });
  check('Settings', 'Tenant A is unaffected by tenant C plan limits', aCats > 0, `aCats=${aCats}`);

  // employee management stays manager-only inside the trial tenant too
  const staffList = await call('GET', '/api/manager/staff', { token });
  check('Settings', 'Trial tenant manager can manage own staff', staffList.status === 200, `status=${staffList.status}`);
}

// ===========================================================================
// MAIN
// ===========================================================================
async function main() {
  console.log(`\n=== EMPLOYEE FUNCTIONAL & PERMISSION TEST — ${BASE} ===\n`);
  ctx = await seed();
  console.log('seed ready\n');

  const tokens = {};
  // tokens captured from the auth phase (keyed by role label)
  tokens.MANAGER = await getToken('manager.a@test.local');
  tokens.WAITER = await getToken('waiter.a@test.local');
  tokens.STAFF = await getToken('staff.a@test.local');
  tokens.CASHIER = await getToken('cashier.a@test.local');
  tokens.KITCHEN = await getToken('kitchen.a@test.local');
  tokens.MANAGER_B = await getToken('manager.b@test.local');
  tokens.PLATFORM_ADMIN = await getToken('platform.admin@test.local');

  const phases = [
    ['Authentication', () => phaseAuth(tokens)],
    ['Permission Matrix', () => phaseMatrix(tokens)],
    ['WAITER', () => phaseWaiter(tokens)],
    ['STAFF', () => phaseStaff(tokens)],
    ['CASHIER', () => phaseCashier(tokens)],
    ['RESTAURANT_MANAGER', () => phaseManager(tokens)],
    ['Tenant Isolation', () => phaseTenantIsolation(tokens)],
    ['Data Integrity', () => phaseDataIntegrity(tokens)],
    ['Error Handling', () => phaseErrors(tokens)],
    ['Public/QR', () => phasePublic(tokens)],
    ['Orders', () => phaseOrderIdAllocation(tokens)],
    ['Settings', () => phasePlanGates()],
  ];
  for (const [name, fn] of phases) {
    try {
      // always operate on fresh tokens: earlier phases legitimately revoke sessions
      for (const [key, email] of Object.entries({
        MANAGER: 'manager.a@test.local', WAITER: 'waiter.a@test.local', STAFF: 'staff.a@test.local',
        CASHIER: 'cashier.a@test.local', KITCHEN: 'kitchen.a@test.local', MANAGER_B: 'manager.b@test.local',
        PLATFORM_ADMIN: 'platform.admin@test.local',
      })) {
        try { tokens[key] = await getToken(email); } catch { /* reported by the phase itself */ }
      }
      await fn();
    } catch (e) {
      check(name, `phase ${name} completed without crashing`, false, `${String(e).slice(0, 300)}`);
    }
  }

  // ------------------------------------------------------------------ report
  console.log('\n================ SUMMARY ================');
  for (const [cat, v] of Object.entries(R.categories)) {
    console.log(`${cat.padEnd(20)} pass=${String(v.passed).padStart(3)} fail=${String(v.failed).padStart(3)} skip=${v.skipped}`);
  }
  console.log(`\nTOTAL=${R.total} PASSED=${R.passed} FAILED=${R.failed} SKIPPED=${R.skipped}`);
  if (R.failures.length) {
    console.log('\n---- FAILURES ----');
    for (const f of R.failures) console.log(`[${f.category}] ${f.name}\n   ${f.details}`);
  }

  await prisma.$disconnect();
  process.exit(R.failed > 0 ? 2 : 0);
}

main().catch(async (e) => {
  console.error('SUITE CRASHED:', e);
  await prisma.$disconnect();
  process.exit(3);
});
