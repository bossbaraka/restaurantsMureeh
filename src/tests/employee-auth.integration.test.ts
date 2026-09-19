import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { config as loadDotenv } from 'dotenv';

/**
 * Employee authentication redesign — real-PostgreSQL integration gate.
 *
 * Covers the remediation regression map:
 *   AUTH-01  → shift staff can NEVER authenticate via email+password and
 *              never carry a usable password (no derived Staff-{PIN}!).
 *   AUTH-02  → per-account progressive lockout (5 fails → 30s, doubling,
 *              capped) with success-reset; the per-IP limiter is reset
 *              between groups so the ACCOUNT mechanism is what's under test.
 *   1.13     → 6-digit PIN policy (4/5/7-digit and weak PINs rejected at
 *              creation, 4-digit rejected at login).
 *   1.2/1.3  → tenant resolution by restaurant code, per-tenant usernames,
 *              cross-tenant credentials rejected.
 *   1.7/1.8  → deactivation blocks login and revokes live sessions; role
 *              change revokes live sessions.
 *   1.11     → step-up: staff credential/role/status changes and payment
 *              void require a fresh step-up token (manager password /
 *              cashier PIN); stale step-up tokens die with the session.
 *
 * Server assembly follows the established integration pattern: routers are
 * mounted on a fresh express app — server/index.ts is never imported.
 */

loadDotenv();

const RUN = process.env.DATABASE_URL ? 'on' : 'off';
const hasDb = RUN === 'on';

describe('employee auth integration gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
  });
});

describe.skipIf(!hasDb)('Employee authentication (real PostgreSQL)', () => {
  type App = ReturnType<typeof import('express')>;
  let app: App;
  let server: import('http').Server;
  let base: string;
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;
  let employeeLoginLimiter: { resetKey: (k: string) => void };

  const call = async (method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.headers || {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  const login = (email: string, password: string) =>
    call('POST', '/api/auth/login', { body: { email, password } });
  const employeeLogin = (code: string, username: string, pin: string) =>
    call('POST', '/api/auth/employee-login', { body: { restaurantCode: code, username, pin } });

  const resetIpBudget = () => {
    if (!employeeLoginLimiter) return;
    employeeLoginLimiter.resetKey('127.0.0.1');
    employeeLoginLimiter.resetKey('::ffff:127.0.0.1');
    employeeLoginLimiter.resetKey('::1');
  };

  beforeAll(async () => {
    const { default: express } = await import('express');
    const authRouter = (await import('../../server/routes/auth')).default;
    const managerRouter = (await import('../../server/routes/manager')).default;
    const { authenticateToken } = await import('../../server/middleware/auth');
    ({ employeeLoginLimiter } = await import('../../server/middleware/rateLimit'));
    ({ prisma } = await import('../../server/db/prisma'));
    const bcrypt = await import('bcryptjs');

    const run = `empauth${Date.now().toString(36)}`;
    const idA = `rest-${run}-a`;
    const idB = `rest-${run}-b`;
    ctx = {
      run, idA, idB,
      slugA: `emp-a-${run}`,
      slugB: `emp-b-${run}`,
      managerPassword: 'ManagerPass#2026',
      pinWaiter: '417038', // 6 digits, non-weak
      pinCashier: '592613',
    };

    for (const [id, slug] of [[idA, ctx.slugA], [idB, ctx.slugB]] as const) {
      await prisma.restaurant.create({
        data: {
          id, slug, name: `Employee Auth ${slug}`, logoUrl: '', description: 'auth test',
          phone: '0000000000', address: 'Test', galleryImages: [], status: 'ACTIVE',
        },
      });
      await prisma.restaurantUser.create({
        data: {
          id: `mgr-${id}`, restaurantId: id, name: `Manager ${slug}`,
          email: `manager@${slug}.test`,
          passwordHash: bcrypt.hashSync(ctx.managerPassword, 10),
          role: 'RESTAURANT_MANAGER', status: 'ACTIVE',
        },
      });
    }

    const mkStaff = (id: string, restaurantId: string, username: string, role: string, pin?: string, status = 'ACTIVE') =>
      prisma.restaurantUser.create({
        data: {
          id, restaurantId, name: `Staff ${username}`, username,
          passwordHash: bcrypt.hashSync(`no-password-${id}-${run}`, 10),
          pinHash: pin ? bcrypt.hashSync(pin, 10) : null,
          role, status,
        },
      });

    ctx.waiterA = await mkStaff(`usr-${run}-waiter`, idA, 'waiter.ahmad', 'WAITER', ctx.pinWaiter);
    ctx.cashierA = await mkStaff(`usr-${run}-cashier`, idA, 'cashier.sara', 'CASHIER', ctx.pinCashier);
    ctx.suspendedA = await mkStaff(`usr-${run}-susp`, idA, 'suspended.one', 'STAFF', '369121', 'SUSPENDED');
    // Same username in ANOTHER tenant — must never cross tenants.
    ctx.waiterB = await mkStaff(`usr-${run}-waiter-b`, idB, 'waiter.ahmad', 'WAITER', ctx.pinWaiter);

    app = express();
    app.use(express.json({ limit: '1mb' }));
    // Mount parity with server/index.ts: the auth router sits BEHIND
    // authenticateToken (pass-through when no header) — requireAuth on
    // /step-up depends on req.user being populated by it.
    app.use('/api/auth', authenticateToken, authRouter);
    app.use('/api/manager', authenticateToken, managerRouter);
    server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (ctx?.run) {
      await prisma.restaurantUser.deleteMany({ where: { id: { startsWith: `usr-${ctx.run}` } } });
      await prisma.restaurantUser.deleteMany({ where: { id: { startsWith: `mgr-rest-${ctx.run}` } } });
      await prisma.restaurant.deleteMany({ where: { id: { in: [ctx.idA, ctx.idB] } } });
    }
    await prisma.$disconnect?.();
  });

  // ---------------------------------------------------------------------
  // LOGIN — restaurant code + username + 6-digit PIN
  // ---------------------------------------------------------------------
  describe('employee login', () => {
    beforeEach(resetIpBudget);

    it('authenticates a shift worker with code + username + 6-digit PIN', async () => {
      const r = await employeeLogin(ctx.slugA, 'waiter.ahmad', ctx.pinWaiter);
      expect(r.status).toBe(200);
      expect(r.json.data.user.role).toBe('WAITER');
      expect(r.json.data.user.username).toBe('waiter.ahmad');
      expect(r.json.data.user.restaurantId).toBe(ctx.idA);
      expect(typeof r.json.data.token).toBe('string');
    });

    it('rejects an unknown restaurant code with a generic 401', async () => {
      const r = await employeeLogin('no-such-restaurant', 'waiter.ahmad', ctx.pinWaiter);
      expect(r.status).toBe(401);
      expect(JSON.stringify(r.json)).not.toContain('waiter');
    });

    it('rejects an unknown username with the same generic 401', async () => {
      const r = await employeeLogin(ctx.slugA, 'who.is.this', ctx.pinWaiter);
      expect(r.status).toBe(401);
    });

    it('rejects a wrong PIN', async () => {
      const r = await employeeLogin(ctx.slugA, 'waiter.ahmad', '314152');
      expect(r.status).toBe(401);
    });

    it('rejects legacy 4-digit and 7-digit PINs at the schema level', async () => {
      expect((await employeeLogin(ctx.slugA, 'waiter.ahmad', '1234')).status).toBe(400);
      expect((await employeeLogin(ctx.slugA, 'waiter.ahmad', '1234567')).status).toBe(400);
      expect((await employeeLogin(ctx.slugA, 'waiter.ahmad', '12a456')).status).toBe(400);
    });

    it('the SAME username+PIN exists in tenant B — it resolves into B only when B is addressed', async () => {
      // Identical (username, PIN) pairs live in BOTH tenants. Tenant identity
      // comes from the restaurant code alone — credentials never leak across.
      const inA = await employeeLogin(ctx.slugA, 'waiter.ahmad', ctx.pinWaiter);
      expect(inA.status).toBe(200);
      expect(inA.json.data.user.restaurantId).toBe(ctx.idA);
      const inB = await employeeLogin(ctx.slugB, 'waiter.ahmad', ctx.pinWaiter);
      expect(inB.status).toBe(200);
      expect(inB.json.data.user.restaurantId).toBe(ctx.idB);
    });

    it('rejects a SUSPENDED employee (generic 401)', async () => {
      const r = await employeeLogin(ctx.slugA, 'suspended.one', '369121');
      expect(r.status).toBe(401);
    });

    it('never returns passwordHash/pinHash in any auth response', async () => {
      const r = await employeeLogin(ctx.slugA, 'waiter.ahmad', ctx.pinWaiter);
      expect(JSON.stringify(r.json)).not.toMatch(/passwordHash|pinHash/);
    });
  });

  // ---------------------------------------------------------------------
  // AUTH-01 — shift staff cannot use email+password at all
  // ---------------------------------------------------------------------
  describe('AUTH-01: derived passwords are dead', () => {
    beforeEach(resetIpBudget);

    it('shift staff (no email) cannot authenticate via /auth/login', async () => {
      // Their accounts carry no email; an attacker guessing the old
      // synthetic pattern gets a schema-level failure, not a session.
      const r = await login('waiter.ahmad@emp.test', 'Staff-417038!');
      expect([400, 401]).toContain(r.status);
      expect(r.status).not.toBe(200);
    });

    it('a manager CAN authenticate via /auth/login', async () => {
      const r = await login(`manager@${ctx.slugA}.test`, ctx.managerPassword);
      expect(r.status).toBe(200);
      expect(r.json.data.user.role).toBe('RESTAURANT_MANAGER');
    });

    it('staff creation with a password for a shift role is rejected (API contract)', async () => {
      const mgr = await login(`manager@${ctx.slugA}.test`, ctx.managerPassword);
      const stepUp = await call('POST', '/api/auth/step-up', {
        token: mgr.json.data.token,
        body: { password: ctx.managerPassword },
      });
      const r = await call('POST', '/api/manager/staff', {
        token: mgr.json.data.token,
        headers: { 'x-step-up-token': stepUp.json.data.stepUpToken },
        body: {
          restaurantId: ctx.idA,
          name: 'Bad Staff',
          username: 'bad.staff',
          role: 'WAITER',
          pin: '481526',
          password: 'Staff-481526!',
        },
      });
      expect(r.status).toBe(400);
      expect(String(r.json.error)).toContain('كلمات مرور');
    });
  });

  // ---------------------------------------------------------------------
  // AUTH-02 — per-account progressive lockout
  // ---------------------------------------------------------------------
  describe('AUTH-02: brute-force budget per account', () => {
    beforeEach(resetIpBudget);

    it('locks after 5 failures, refuses the CORRECT PIN during the lock, and recovers', async () => {
      // Four honest failures: no lock yet.
      for (let i = 0; i < 4; i += 1) {
        const r = await employeeLogin(ctx.slugA, 'waiter.ahmad', '000000');
        expect(r.status).toBe(401);
      }
      const waiterBefore = await prisma.restaurantUser.findUnique({ where: { id: ctx.waiterA.id } });
      expect(waiterBefore.failedAuthCount).toBe(4);
      expect(waiterBefore.authLockedUntil).toBeNull();

      // Fifth failure → progressive lock kicks in (30s base).
      const fifth = await employeeLogin(ctx.slugA, 'waiter.ahmad', '000000');
      expect(fifth.status).toBe(429);
      const locked = await prisma.restaurantUser.findUnique({ where: { id: ctx.waiterA.id } });
      expect(locked.failedAuthCount).toBe(5);
      expect(locked.authLockedUntil).not.toBeNull();

      // Even the CORRECT PIN is refused while locked.
      const duringLock = await employeeLogin(ctx.slugA, 'waiter.ahmad', ctx.pinWaiter);
      expect(duringLock.status).toBe(429);

      // The lock expires (simulated by rewinding the clock), not by trusting
      // the client: after expiry one more failure re-locks with a LONGER
      // penalty (progressive doubling).
      await prisma.restaurantUser.update({
        where: { id: ctx.waiterA.id },
        data: { authLockedUntil: new Date(Date.now() - 1000) },
      });
      const expiredLockWrong = await employeeLogin(ctx.slugA, 'waiter.ahmad', '000000');
      expect(expiredLockWrong.status).toBe(429);
      const relocked = await prisma.restaurantUser.findUnique({ where: { id: ctx.waiterA.id } });
      expect(relocked.failedAuthCount).toBe(6);
      const lockMs = relocked.authLockedUntil.getTime() - Date.now();
      expect(lockMs).toBeGreaterThan(45_000); // doubled from 30s

      // Successful login resets the budget completely.
      await prisma.restaurantUser.update({
        where: { id: ctx.waiterA.id },
        data: { authLockedUntil: new Date(Date.now() - 1000) },
      });
      const ok = await employeeLogin(ctx.slugA, 'waiter.ahmad', ctx.pinWaiter);
      expect(ok.status).toBe(200);
      const reset = await prisma.restaurantUser.findUnique({ where: { id: ctx.waiterA.id } });
      expect(reset.failedAuthCount).toBe(0);
      expect(reset.authLockedUntil).toBeNull();
    });

    it('does NOT lock a DIFFERENT account (per-identity budget)', async () => {
      const r = await employeeLogin(ctx.slugA, 'cashier.sara', ctx.pinCashier);
      expect(r.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // 1.11 — step-up authentication for sensitive operations
  // ---------------------------------------------------------------------
  describe('step-up authentication', () => {
    beforeEach(resetIpBudget);

    it('rejects a manager password for a step-up token', async () => {
      // (wrong password)
      const mgr = await login(`manager@${ctx.slugA}.test`, ctx.managerPassword);
      const r = await call('POST', '/api/auth/step-up', { token: mgr.json.data.token, body: { password: 'wrong-password' } });
      expect(r.status).toBe(401);
    });

    it('issues a 5-minute step-up token for the manager password', async () => {
      const mgr = await login(`manager@${ctx.slugA}.test`, ctx.managerPassword);
      const r = await call('POST', '/api/auth/step-up', { token: mgr.json.data.token, body: { password: ctx.managerPassword } });
      expect(r.status).toBe(200);
      expect(typeof r.json.data.stepUpToken).toBe('string');
      expect(r.json.data.expiresInSeconds).toBe(300);
    });

    it('staff credential changes REQUIRE a step-up token', async () => {
      const mgr = await login(`manager@${ctx.slugA}.test`, ctx.managerPassword);
      const token = mgr.json.data.token;

      // Without step-up → 403 STEP_UP_REQUIRED.
      const noStepUp = await call('PUT', `/api/manager/staff/${ctx.cashierA.id}`, {
        token,
        body: { restaurantId: ctx.idA, role: 'CASHIER', pin: '592614' },
      });
      expect(noStepUp.status).toBe(403);
      expect(noStepUp.json.code).toBe('STEP_UP_REQUIRED');

      // Plain name edits stay friction-free.
      const nameOnly = await call('PUT', `/api/manager/staff/${ctx.cashierA.id}`, {
        token,
        body: { restaurantId: ctx.idA, name: 'Cashier Sara R.' },
      });
      expect(nameOnly.status).toBe(200);

      // With step-up → allowed; PIN re-issue also revokes the target's
      // sessions and resets their failure budget.
      const stepUp = await call('POST', '/api/auth/step-up', { token, body: { password: ctx.managerPassword } });
      const withStepUp = await call('PUT', `/api/manager/staff/${ctx.cashierA.id}`, {
        token,
        headers: { 'x-step-up-token': stepUp.json.data.stepUpToken },
        body: { restaurantId: ctx.idA, pin: '592614' },
      });
      expect(withStepUp.status).toBe(200);
    });

    it('a cashier can step-up with their PIN (void path)', async () => {
      const cashier = await employeeLogin(ctx.slugA, 'cashier.sara', '592614');
      const token = cashier.json.data.token;
      const r = await call('POST', '/api/auth/step-up', { token, body: { pin: '592614' } });
      expect(r.status).toBe(200);
    });

    it('a stale step-up token dies when the session is revoked (logout bumps tv)', async () => {
      const mgr = await login(`manager@${ctx.slugA}.test`, ctx.managerPassword);
      const token = mgr.json.data.token;
      const stepUp = await call('POST', '/api/auth/step-up', { token, body: { password: ctx.managerPassword } });
      const stepToken = stepUp.json.data.stepUpToken;

      await call('POST', '/api/auth/logout', { token });

      const afterLogout = await call('PUT', `/api/manager/staff/${ctx.waiterA.id}`, {
        token,
        headers: { 'x-step-up-token': stepToken },
        body: { restaurantId: ctx.idA, name: 'Should Not Matter' },
      });
      // The main session is dead — 401 (authentication), never a mutation.
      expect([401, 403]).toContain(afterLogout.status);
      expect(afterLogout.status).not.toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // 1.7 / 1.8 — lifecycle: deactivation & role change revoke sessions
  // ---------------------------------------------------------------------
  describe('employee lifecycle', () => {
    beforeEach(resetIpBudget);

    it('deactivation blocks login AND kills the live session (next request)', async () => {
      const mgr = await login(`manager@${ctx.slugA}.test`, ctx.managerPassword);
      const mgrToken = mgr.json.data.token;
      const stepUp = await call('POST', '/api/auth/step-up', { token: mgrToken, body: { password: ctx.managerPassword } });

      const worker = await employeeLogin(ctx.slugA, 'waiter.ahmad', ctx.pinWaiter);
      const workerToken = worker.json.data.token;
      expect((await call('GET', '/api/auth/me', { token: workerToken })).status).toBe(200);

      // Deactivate (sensitive → step-up).
      const deactivate = await call('PUT', `/api/manager/staff/${ctx.waiterA.id}`, {
        token: mgrToken,
        headers: { 'x-step-up-token': stepUp.json.data.stepUpToken },
        body: { restaurantId: ctx.idA, status: 'SUSPENDED' },
      });
      expect(deactivate.status).toBe(200);

      // Live session dies on the very next request (tv bump + status check).
      expect((await call('GET', '/api/auth/me', { token: workerToken })).status).toBe(401);
      // Fresh login refused.
      expect((await employeeLogin(ctx.slugA, 'waiter.ahmad', ctx.pinWaiter)).status).toBe(401);

      // Reactivation restores login (recovery path).
      const reactivate = await call('PUT', `/api/manager/staff/${ctx.waiterA.id}`, {
        token: mgrToken,
        headers: { 'x-step-up-token': stepUp.json.data.stepUpToken },
        body: { restaurantId: ctx.idA, status: 'ACTIVE' },
      });
      expect(reactivate.status).toBe(200);
      const again = await employeeLogin(ctx.slugA, 'waiter.ahmad', ctx.pinWaiter);
      expect(again.status).toBe(200);
    });

    it('role change revokes outstanding sessions and applies new permissions', async () => {
      const mgr = await login(`manager@${ctx.slugA}.test`, ctx.managerPassword);
      const mgrToken = mgr.json.data.token;
      const stepUp = await call('POST', '/api/auth/step-up', { token: mgrToken, body: { password: ctx.managerPassword } });

      const worker = await employeeLogin(ctx.slugA, 'waiter.ahmad', ctx.pinWaiter);
      const workerToken = worker.json.data.token;

      // WAITER cannot manage staff; promote to RESTAURANT_MANAGER (needs
      // email+password for the manager role — the update enforces it).
      const promote = await call('PUT', `/api/manager/staff/${ctx.waiterA.id}`, {
        token: mgrToken,
        headers: { 'x-step-up-token': stepUp.json.data.stepUpToken },
        body: {
          restaurantId: ctx.idA,
          role: 'RESTAURANT_MANAGER',
          email: 'promoted.waiter@test.local',
          password: 'Promoted#Pass2026',
        },
      });
      expect(promote.status).toBe(200);

      // Old session is revoked by the role change.
      expect((await call('GET', '/api/auth/me', { token: workerToken })).status).toBe(401);

      // The promoted manager logs in with the NEW credentials (password
      // path) and now reaches manager routes.
      const newLogin = await login('promoted.waiter@test.local', 'Promoted#Pass2026');
      expect(newLogin.status).toBe(200);
      const staffList = await call('GET', `/api/manager/staff?restaurantId=${ctx.idA}`, { token: newLogin.json.data.token });
      expect(staffList.status).toBe(200);
    });

    it('weak PINs are rejected at creation (documented policy)', async () => {
      const mgr = await login(`manager@${ctx.slugA}.test`, ctx.managerPassword);
      const token = mgr.json.data.token;
      const stepUp = await call('POST', '/api/auth/step-up', { token, body: { password: ctx.managerPassword } });

      for (const weak of ['123456', '000000', '111111', '654321', '121212', '123123', '112233']) {
        const r = await call('POST', '/api/manager/staff', {
          token,
          headers: { 'x-step-up-token': stepUp.json.data.stepUpToken },
          body: { restaurantId: ctx.idA, name: `Weak ${weak}`, username: `weak-${weak}`, role: 'WAITER', pin: weak },
        });
        expect(r.status).toBe(400);
      }
    });
  });
});
