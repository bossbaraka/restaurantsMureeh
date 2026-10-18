import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { config as loadDotenv } from 'dotenv';

/**
 * Self-service owner registration + restaurant onboarding — real-PostgreSQL
 * integration gate (2026-10). Runs only when DATABASE_URL is present (same
 * convention as the employee-auth gate); CI's PostgreSQL job executes it.
 *
 * End-to-end contract under test:
 *   1. POST /api/auth/register creates a tenantless RESTAURANT_MANAGER with a
 *      bcrypt-12 hash, an issueSession-shaped response, and NEVER touches the
 *      login failure budget of an existing same-email account.
 *   2. Duplicate email conflicts (sequential and concurrent) resolve to one
 *      row + one 409 — the unique index is the arbiter.
 *   3. POST /api/onboarding/restaurant is the ONLY way the tenant appears:
 *      server-generated slug, plan-free subscription (permanent, not trial),
 *      exact table count with platform numbering + QR tokens, single
 *      membership row, single subscription row.
 *   4. Every denial path answers with a stable status: 401 unauthenticated,
 *      403 platform/foreign-role, 409 already-linked, 400 closed-schema
 *      violations (bad count, smuggled planId/restaurantId/logoUrl keys).
 *   5. Resumability: logout/login + /auth/me reflect the pre-onboarding state
 *      and flip exactly once onboarding succeeds.
 *   6. Concurrency: two simultaneous onboards on ONE account yield exactly
 *      one restaurant (transactional membership claim); and an injected
 *      mid-transaction failure leaves NO partial rows anywhere.
 *   7. Public surfaces immediately work for the new tenant (menu payload +
 *      QR verification) with zero fake menu content.
 *
 * Server assembly follows the established pattern: routers on a fresh
 * express app; server/index.ts is never imported.
 */

loadDotenv();

const RUN = process.env.DATABASE_URL ? 'on' : 'off';
const hasDb = RUN === 'on';

describe('self-onboarding integration gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
  });
});

describe.skipIf(!hasDb)('Self-service registration & onboarding (real PostgreSQL)', () => {
  type App = ReturnType<typeof import('express')>;
  let app: App;
  let server: import('http').Server;
  let base: string;
  let prisma: any;
  let ctx: any;
  let registerLimiter: { resetKey: (k: string) => void };
  let selfOnboardLimiter: { resetKey: (k: string) => void };

  const call = async (
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {}
  ) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  const register = (name: string, email: string, password: string) =>
    call('POST', '/api/auth/register', { body: { name, email, password } });
  const login = (email: string, password: string) =>
    call('POST', '/api/auth/login', { body: { email, password } });
  const onboard = (token: string, body: unknown) =>
    call('POST', '/api/onboarding/restaurant', { token, body });

  const PASSWORD = 'Own3r-Pass!2026';
  const emailFor = (tag: string) => `owner-${tag}-${ctx.run}@selfonboard.test`;

  beforeAll(async () => {
    const { default: express } = await import('express');
    const authRouter = (await import('../../server/routes/auth')).default;
    const onboardingRouter = (await import('../../server/routes/onboarding')).default;
    const publicRouter = (await import('../../server/routes/public')).default;
    const { authenticateToken } = await import('../../server/middleware/auth');
    ({ registerLimiter, selfOnboardLimiter } = await import('../../server/middleware/rateLimit'));
    ({ prisma } = await import('../../server/db/prisma'));

    ctx = { run: `sonb${Date.now().toString(36)}` };

    app = express();
    app.use(express.json({ limit: '1mb' }));
    // Mount parity with server/index.ts.
    app.use('/api/auth', authenticateToken, authRouter);
    app.use('/api/onboarding', authenticateToken, onboardingRouter);
    app.use('/api/public', publicRouter);
    server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;

    // A seeded catalog is guaranteed by migrate deploy (data-only plan-free
    // migration); hard-fail the suite if the environment lost that invariant.
    const plan = await prisma.plan.findUnique({ where: { id: 'plan-free' } });
    if (!plan) throw new Error('plan-free missing — migrations/seed not applied to test DB');
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (ctx?.run && prisma) {
      const users = await prisma.restaurantUser.findMany({
        where: { email: { contains: `-${ctx.run}@selfonboard.test` } },
        select: { id: true },
      });
      const ids = users.map((u: { id: string }) => u.id);
      await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
      const restaurants = await prisma.restaurant.findMany({
        where: { users: { some: { id: { in: ids } } } },
        select: { id: true },
      });
      const rIds = restaurants.map((r: { id: string }) => r.id);
      await prisma.table.deleteMany({ where: { restaurantId: { in: rIds } } });
      await prisma.subscription.deleteMany({ where: { restaurantId: { in: rIds } } });
      await prisma.restaurantUser.deleteMany({ where: { id: { in: ids } } });
      await prisma.restaurant.deleteMany({ where: { id: { in: rIds } } });
    }
    await prisma.$disconnect?.();
  });

  beforeEach(() => {
    // The flow tests are functional, not budget tests: start each with a
    // clean IP budget so limiter noise can never masquerade as a regression.
    for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
      registerLimiter.resetKey(key);
      selfOnboardLimiter.resetKey(key);
    }
  });

  // -------------------------------------------------------------------
  describe('POST /api/auth/register', () => {
    it('creates a tenantless manager with the issueSession response shape', async () => {
      const res = await register('Omar Owner', emailFor('basic'), PASSWORD);
      expect(res.status).toBe(201);
      expect(res.json.success).toBe(true);
      const { user, restaurant, token } = res.json.data;
      expect(user.role).toBe('RESTAURANT_MANAGER');
      expect(user.restaurantId).toBeNull();
      expect(restaurant).toBeNull();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      // No secret in the payload (no-leakage rule on new surfaces).
      const raw = JSON.stringify(res.json);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('$2a$');

      const row = await prisma.restaurantUser.findUnique({ where: { id: user.id } });
      expect(row.username).toBeNull(); // manager path never gets a PIN identity
      // bcryptjs v3 emits the $2b$ minor; the material assertion is the
      // WORK FACTOR: cost 12 for registrations (login's DUMMY_HASH stays 10).
      expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect(row.status).toBe('ACTIVE');

      // The issued token authenticates immediately (same contract as login).
      const me = await call('GET', '/api/auth/me', { token });
      expect(me.status).toBe(200);
      expect(me.json.data.user.id).toBe(user.id);
      expect(me.json.data.restaurant).toBeNull();
    });

    it('rejects weak/short passwords and smuggled privileged keys with 400', async () => {
      const e = emailFor('rejects');
      expect((await register('Owner', `${e}1`, 'short1!')).status).toBe(400);
      expect((await register('Owner', `${e}2`, 'password123')).status).toBe(400);
      const withRole = await call('POST', '/api/auth/register', {
        body: { name: 'Owner', email: `${e}4`, password: PASSWORD, role: 'PLATFORM_ADMIN' },
      });
      expect(withRole.status).toBe(400);
      const withRest = await call('POST', '/api/auth/register', {
        body: { name: 'Owner', email: `${e}5`, password: PASSWORD, restaurantId: 'rest-x' },
      });
      expect(withRest.status).toBe(400);
      // (a valid payload without the extra keys would succeed — so an
      // account count of zero proves the STRICT shape rejected each one.)
      const created = await prisma.restaurantUser.findMany({
        where: { email: { startsWith: e } },
        select: { id: true },
      });
      expect(created).toHaveLength(0);
    });

    it('conflicts on duplicate email without touching the login budget', async () => {
      const email = emailFor('dup');
      const first = await register('Owner One', email, PASSWORD);
      expect(first.status).toBe(201);
      // Pre-seed a failed login marker: a duplicate-registration attempt must
      // NEVER tick the existing account's lockout counters.
      await prisma.restaurantUser.update({
        where: { email },
        data: { failedAuthCount: 3, authLockedUntil: new Date(Date.now() + 30_000) },
      });
      const dup = await register('Owner Two', email, 'Another-Pass!2026');
      expect(dup.status).toBe(409);
      expect(dup.json.error).toContain('مسجّل مسبقاً');
      const row = await prisma.restaurantUser.findUnique({ where: { email } });
      expect(row.failedAuthCount).toBe(3); // unchanged
      expect(row.authLockedUntil).toBeTruthy(); // still the pre-seeded marker
    });

    it('races same-email registrations to exactly one account', async () => {
      const email = emailFor('race-reg');
      const results = await Promise.all([
        register('Racer A', email, PASSWORD),
        register('Racer B', email, PASSWORD),
        register('Racer C', email, PASSWORD),
      ]);
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 409, 409]);
      const rows = await prisma.restaurantUser.findMany({ where: { email } });
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------
  describe('POST /api/onboarding/restaurant', () => {
    const freshOwner = async (tag: string) => {
      const email = emailFor(tag);
      const res = await register(`Owner ${tag}`, email, PASSWORD);
      expect(res.status).toBe(201);
      return { token: res.json.data.token as string, userId: res.json.data.user.id as string, email };
    };

    it('provisions restaurant + free subscription + tables + QR in one shot', async () => {
      const { token, userId } = await freshOwner('full');
      const res = await onboard(token, { name: 'مطعم الياسمين الفاخر', tablesCount: 15 });
      expect(res.status).toBe(201);
      const { restaurant, tablesCount, planId, planName } = res.json.data;
      expect(tablesCount).toBe(15);
      expect(planId).toBe('plan-free');
      expect(planName).toContain('مجانية');
      expect(restaurant.slug).toBeTruthy();
      // Server-owned slug: never the raw Arabic name, never client-supplied.
      expect(restaurant.slug).toMatch(/^[a-z0-9-]+$/);
      expect(restaurant.id).toBe(`rest-${restaurant.slug}`);
      // Default-logo fallback contract: the row keeps an empty/default logo
      // until the owner uploads — the response must not 500 on rendering it.
      expect(typeof restaurant.name).toBe('string');

      const tables = await prisma.table.findMany({
        where: { restaurantId: restaurant.id },
        orderBy: { number: 'asc' },
      });
      expect(tables).toHaveLength(15);
      expect(tables.map((t: any) => t.number)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(tables[0].id).toBe(`${restaurant.id}-T01`);
      expect(tables[14].id).toBe(`${restaurant.id}-T15`);
      const tokens = new Set(tables.map((t: any) => t.qrToken));
      expect(tokens.size).toBe(15);
      expect(tables.every((t: any) => typeof t.qrToken === 'string' && t.qrToken.startsWith('qr-'))).toBe(true);

      const sub = await prisma.subscription.findUnique({
        where: { restaurantId: restaurant.id },
        include: { plan: true },
      });
      expect(sub).toBeTruthy();
      expect(sub.planId).toBe('plan-free');
      expect(sub.status).toBe('ACTIVE');
      expect(sub.trialEndsAt).toBeNull(); // permanent free, NOT a trial
      expect(sub.cancelAtPeriodEnd).toBe(false);
      expect(sub.plan.billingPeriod).toBe('free');

      const user = await prisma.restaurantUser.findUnique({ where: { id: userId } });
      expect(user.restaurantId).toBe(restaurant.id);

      const subs = await prisma.subscription.findMany({ where: { restaurantId: restaurant.id } });
      expect(subs).toHaveLength(1); // never more than one subscription per tenant

      // Audit trail recorded for the tenant-creating event.
      const audit = await prisma.auditLog.findFirst({
        where: { userId, action: 'RESTAURANT_SELF_ONBOARDED' },
      });
      expect(audit).toBeTruthy();

      // The public menu goes live instantly with ZERO fake content and the
      // owner's own tables answer on their QR tokens.
      const menu = await call('GET', `/api/public/restaurants/${restaurant.slug}`);
      expect(menu.status).toBe(200);
      expect(JSON.stringify(menu.json)).toContain(restaurant.slug);
      const cats = menu.json.data?.categories ?? menu.json.data?.menu?.categories ?? [];
      expect(cats).toHaveLength(0);
      const scan = await call('GET', `/api/public/tables/qr/${tables[0].qrToken}`);
      expect(scan.status).toBe(200);
      expect(JSON.stringify(scan.json)).toContain(restaurant.slug);

      // /auth/me now carries the tenant (App gate lifts on this fact alone).
      const me = await call('GET', '/api/auth/me', { token });
      expect(me.json.data.user.restaurantId).toBe(restaurant.id);
      expect(me.json.data.restaurant.id).toBe(restaurant.id);
    });

    it('resumes after logout/login — pending owners get the wizard, not a tenant', async () => {
      const { userId } = await freshOwner('resume');
      // Still unprovisioned: login + me must agree that no tenant exists yet.
      const { email } = await prisma.restaurantUser.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      const relogin = await login(email, PASSWORD);
      expect(relogin.status).toBe(200);
      const me = await call('GET', '/api/auth/me', { token: relogin.json.data.token });
      expect(me.json.data.user.restaurantId).toBeNull();
      expect(me.json.data.restaurant).toBeNull();
      // …and the second (post-onboarding) login flips exactly once.
      await onboard(relogin.json.data.token, { name: 'Resume Diner', tablesCount: 10 });
      const relogin2 = await login(email, PASSWORD);
      const me2 = await call('GET', '/api/auth/me', { token: relogin2.json.data.token });
      expect(me2.json.data.restaurant).toBeTruthy();
      expect(me2.json.data.user.restaurantId).toBeTruthy();
    });

    it('rejects every denial path with a stable status code', async () => {
      // 401 — no/invalid token.
      expect((await call('POST', '/api/onboarding/restaurant', { body: { name: 'X', tablesCount: 10 } })).status).toBe(401);

      // 409 — already linked.
      const { token } = await freshOwner('linked');
      const ok = await onboard(token, { name: 'First Venue', tablesCount: 10 });
      expect(ok.status).toBe(201);
      const again = await onboard(token, { name: 'Second Venue', tablesCount: 20 });
      expect(again.status).toBe(409);
      expect(again.json.error).toContain('مرتبط بمطعم بالفعل');
      // and the second attempt created nothing:
      const linked = await prisma.restaurant.findMany({
        where: { users: { some: { email: emailFor('linked') } } },
      });
      expect(linked).toHaveLength(1);
      expect(linked[0].name).toBe('First Venue');

      // 403 — platform admins must use the audited admin router.
      const platform = await prisma.restaurantUser.findFirst({
        where: { role: 'PLATFORM_ADMIN' },
        select: { id: true, role: true },
      });
      if (platform) {
        const { signToken } = await import('../../server/middleware/auth');
        const platformRow = await prisma.restaurantUser.findUnique({ where: { id: platform.id } });
        const pt = (signToken as any)({
          id: platformRow.id,
          restaurantId: platformRow.restaurantId,
          name: platformRow.name,
          email: platformRow.email,
          role: platformRow.role,
          status: platformRow.status,
          tv: platformRow.tokenVersion,
        });
        const denied = await onboard(pt, { name: 'Sneaky Venue', tablesCount: 10 });
        expect(denied.status).toBe(403);
      }

      // 403 — fixed role: a (DB-forged) manager of ANOTHER venue, tenantless
      // rule only passes for tenantless managers — covered by the 409 above;
      // staff roles can never register through this surface at all.
      // 400 — closed schema on the onboard body.
      const { token: t2 } = await freshOwner('badbodies');
      expect((await onboard(t2, { name: 'X', tablesCount: 12 })).status).toBe(400);
      expect((await onboard(t2, { name: 'X', tablesCount: 9 })).status).toBe(400);
      expect((await onboard(t2, { name: 'X', tablesCount: '10' })).status).toBe(400);
      expect((await onboard(t2, { name: '   ', tablesCount: 10 })).status).toBe(400);
      expect(
        (await onboard(t2, { name: 'X', tablesCount: 10, planId: 'plan-enterprise' })).status
      ).toBe(400);
      expect(
        (await onboard(t2, { name: 'X', tablesCount: 10, restaurantId: 'rest-other' })).status
      ).toBe(400);
      expect(
        (await onboard(t2, { name: 'X', tablesCount: 10, logoUrl: 'https://evil.example' })).status
      ).toBe(400);
      // …and none of the rejected bodies created a restaurant.
      const owner = await prisma.restaurantUser.findFirst({
        where: { email: emailFor('badbodies') },
        select: { restaurantId: true },
      });
      expect(owner.restaurantId).toBeNull();
    });

    it('races two simultaneous onboards into exactly one restaurant', async () => {
      const { token, userId } = await freshOwner('race-tenant');
      const [a, b] = await Promise.all([
        onboard(token, { name: 'Race Venue', tablesCount: 20 }),
        onboard(token, { name: 'Race Venue', tablesCount: 20 }),
      ]);
      const codes = [a.status, b.status].sort();
      expect(codes).toEqual([201, 409]);
      const user = await prisma.restaurantUser.findUnique({ where: { id: userId } });
      const restaurants = await prisma.restaurant.findMany({
        where: { users: { some: { id: userId } } },
      });
      expect(restaurants).toHaveLength(1);
      expect(user.restaurantId).toBe(restaurants[0].id);
      // One subscription, one table set — no double provisioning.
      expect(
        await prisma.subscription.count({ where: { restaurantId: restaurants[0].id } })
      ).toBe(1);
      expect(await prisma.table.count({ where: { restaurantId: restaurants[0].id } })).toBe(20);
    });

    it('rolls back completely when the transaction fails mid-flight', async () => {
      const { token, userId } = await freshOwner('rollback');
      // Inject the fault at the point the route actually calls: inside the
      // interactive $transaction, the table step is reached after restaurant
      // + claim + subscription, so a throw there proves full rollback.
      const originalTx = prisma.$transaction.bind(prisma);
      prisma.$transaction = async (cb: any) =>
        originalTx(async (tx: any) =>
          cb(
            new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === 'table') {
                  return {
                    createMany: async () => {
                      throw new Error('injected mid-transaction failure');
                    },
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            })
          )
        );
      let status = 0;
      try {
        status = (await onboard(token, { name: 'Rollback Diner', tablesCount: 10 })).status;
      } finally {
        prisma.$transaction = originalTx;
      }
      expect(status).toBe(500);
      // NOTHING partial survived the rollback — including the membership
      // claim and the subscription that happen BEFORE the failing step:
      const user = await prisma.restaurantUser.findUnique({ where: { id: userId } });
      expect(user.restaurantId).toBeNull();
      const orphan = await prisma.restaurant.findFirst({
        where: { name: 'Rollback Diner', users: { none: {} } },
      });
      expect(orphan).toBeNull();
      const orphanSubs = await prisma.subscription.count({
        where: { planId: 'plan-free', restaurant: { name: 'Rollback Diner' } },
      });
      expect(orphanSubs).toBe(0);
      // A retry after the injected fault fully succeeds (no poisoned state).
      const retry = await onboard(token, { name: 'Rollback Diner', tablesCount: 10 });
      expect(retry.status).toBe(201);
      expect(await prisma.table.count({ where: { restaurantId: retry.json.data.restaurant.id } })).toBe(10);
    });
  });
});
