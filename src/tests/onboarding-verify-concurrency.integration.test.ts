import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { config as loadDotenv } from 'dotenv';

/**
 * POST /api/onboarding/verify — concurrency + fail-closed gate (F-01 follow-up
 * to PR #79, audit of merge cbeaa42).
 *
 * The sequential budget behaviour is pinned by
 * onboarding-verify-budget.integration.test.ts. THIS suite pins the three
 * properties the merged implementation did not guarantee:
 *
 *   1. The per-restaurant guessing budget cannot be overspent concurrently:
 *      a parallel burst of wrong codes yields exactly VERIFY_FAILURE_LIMIT
 *      counted 400s, 429 `VERIFICATION_LOCKED` for the rest, and exactly that
 *      many durable failure rows.
 *   2. Activation is exactly-once: a parallel burst of the CORRECT code
 *      performs one ONBOARDING→ACTIVE transition and writes one
 *      RESTAURANT_VERIFIED_AND_ACTIVATED row; every other caller observes the
 *      idempotent `alreadyVerified` contract.
 *   3. Fail-closed audit coupling: when the failure row cannot be persisted
 *      the request is a 500 (never a 400 "counted" rejection), and when the
 *      success row cannot be persisted the activation does not commit either
 *      (the restaurant stays ONBOARDING and the owner can retry).
 *   4. Read-after-lock visibility (F-01-E): with 4 failures already counted,
 *      a parallel burst counts exactly one more — the property that requires
 *      the explicitly pinned ReadCommitted isolation level.
 *   5. State gates hold end-to-end: SUSPENDED/MAINTENANCE tenants are refused
 *      with nothing counted, and after a platform approval /verify is the
 *      idempotent alreadyVerified with no fabricated activation rows.
 *
 * Plus the tenant-status transition guard: platform admins must not move an
 * already-activated (or suspended) restaurant back into ONBOARDING — there is
 * no product flow for re-quarantine, and doing so would resurrect codes from
 * a previous activation cycle. Manual approval (ONBOARDING→ACTIVE) and the
 * ACTIVE↔SUSPENDED toggle stay available.
 *
 * Failure injection uses a BEFORE INSERT trigger scoped to this run's tenant
 * ids, so parallel suites against the same disposable database are unaffected;
 * it is dropped in `finally`/`afterAll`.
 */

loadDotenv();

const hasDb = Boolean(process.env.DATABASE_URL);

describe('onboarding verify concurrency gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
  });
});

describe.skipIf(!hasDb)('Official Activation Code under concurrency (real PostgreSQL)', () => {
  type App = ReturnType<typeof import('express')>;
  let app: App;
  let server: import('http').Server;
  let base: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let selfOnboardLimiter: { resetKey: (k: string) => void };
  let jwtSecret = '';
  let provisioning: typeof import('../../server/services/restaurantProvisioning');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let signToken: (u: any) => string;

  const run = `vconc${Date.now().toString(36)}`;
  const restaurantIds: string[] = [];
  const userIds: string[] = [];
  let seq = 0;
  let platformToken = '';

  const FAILED = 'RESTAURANT_VERIFICATION_FAILED';
  const VERIFIED = 'RESTAURANT_VERIFIED_AND_ACTIVATED';
  const TRIGGER = 'mureeh_test_block_audit_ins';
  const TRIGGER_FN = 'mureeh_test_block_audit_fn';

  const verify = async (token: string, code: string) => {
    const res = await fetch(`${base}/api/onboarding/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  const setTenantStatus = async (restaurantId: string, status: string) => {
    const res = await fetch(`${base}/api/admin/restaurants/${restaurantId}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${platformToken}` },
      body: JSON.stringify({ status }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  const resetIpBudget = () => {
    if (!selfOnboardLimiter) return;
    for (const k of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) selfOnboardLimiter.resetKey(k);
  };

  async function tenantWithManager(
    restaurantStatus: 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED' | 'MAINTENANCE'
  ) {
    seq += 1;
    const id = `rest-${run}-${seq}`;
    const userId = `mgr-${run}-${seq}`;
    restaurantIds.push(id);
    userIds.push(userId);
    const bcrypt = await import('bcryptjs');
    const restaurant = await prisma.restaurant.create({
      data: {
        id,
        slug: `verify-conc-${run}-${seq}`,
        name: `Verify Concurrency ${seq}`,
        logoUrl: '',
        description: 'F-01 concurrency test',
        phone: '0000000000',
        address: 'Test',
        galleryImages: [],
        status: restaurantStatus,
      },
    });
    const user = await prisma.restaurantUser.create({
      data: {
        id: userId,
        restaurantId: id,
        name: `Owner ${seq}`,
        email: `owner-${seq}@${run}.test`,
        passwordHash: bcrypt.hashSync('OwnerPass#2026', 10),
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
      },
    });
    const token = signToken({
      id: user.id,
      restaurantId: user.restaurantId,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      tv: user.tokenVersion,
    });
    return { restaurant, user, token };
  }

  const currentCode = (restaurantId: string, now: number = Date.now()) =>
    provisioning.computeRestaurantVerificationCode(restaurantId, jwtSecret, now);

  const wrongCodeFor = (restaurantId: string) => {
    const taken = new Set([
      currentCode(restaurantId),
      currentCode(restaurantId, Date.now() - provisioning.VERIFICATION_CODE_WINDOW_MS),
      provisioning.computeLegacyRestaurantVerificationCode(restaurantId, jwtSecret),
    ]);
    for (const c of ['000000', '111111', '222222', '333333']) if (!taken.has(c)) return c;
    throw new Error('unreachable');
  };

  const auditRows = (restaurantId: string, action: string) =>
    prisma.auditLog.findMany({ where: { restaurantId, action } });

  /** Seed durable failure rows as if earlier wrong attempts had been counted. */
  async function seedFailures(restaurantId: string, userId: string, count: number) {
    await prisma.auditLog.createMany({
      data: Array.from({ length: count }, () => ({
        restaurantId,
        userId,
        actor: 'Seeded Owner',
        actorRole: 'RESTAURANT_MANAGER' as const,
        action: FAILED,
        entity: 'Restaurant',
        entityId: restaurantId,
        details: 'seeded failure (isolation test)',
      })),
    });
  }

  const statusOf = async (restaurantId: string) =>
    (await prisma.restaurant.findUnique({ where: { id: restaurantId } })).status;

  /** Make AuditLog inserts of `action` for ONE tenant raise inside PostgreSQL. */
  async function blockAuditInserts(restaurantId: string, action: string) {
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION ${TRIGGER_FN}() RETURNS trigger AS $fn$ ` +
        `BEGIN IF NEW."action" = '${action}' AND NEW."restaurantId" = '${restaurantId}' ` +
        `THEN RAISE EXCEPTION 'injected audit failure (test)'; END IF; RETURN NEW; END; $fn$ LANGUAGE plpgsql`
    );
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER} ON "AuditLog"`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${TRIGGER_FN}()`
    );
  }

  async function unblockAuditInserts() {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER} ON "AuditLog"`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TRIGGER_FN}()`).catch(() => {});
  }

  beforeAll(async () => {
    const { default: express } = await import('express');
    const onboardingRouter = (await import('../../server/routes/onboarding')).default;
    const adminRouter = (await import('../../server/routes/admin')).default;
    const auth = await import('../../server/middleware/auth');
    signToken = auth.signToken;
    ({ selfOnboardLimiter } = await import('../../server/middleware/rateLimit'));
    ({ prisma } = await import('../../server/db/prisma'));
    ({ config: { jwtSecret } } = await import('../../server/config'));
    provisioning = await import('../../server/services/restaurantProvisioning');

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/onboarding', auth.authenticateToken, onboardingRouter);
    app.use('/api/admin', auth.authenticateToken, adminRouter);
    server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;

    const bcrypt = await import('bcryptjs');
    const platformId = `platform-${run}`;
    userIds.push(platformId);
    const platform = await prisma.restaurantUser.create({
      data: {
        id: platformId,
        restaurantId: null,
        name: `Platform ${run}`,
        email: `platform@${run}.test`,
        passwordHash: bcrypt.hashSync('PlatformPass#2026', 10),
        role: 'PLATFORM_ADMIN',
        status: 'ACTIVE',
      },
    });
    platformToken = signToken({
      id: platform.id,
      restaurantId: null,
      name: platform.name,
      email: platform.email,
      role: platform.role,
      status: platform.status,
      tv: platform.tokenVersion,
    });
  });

  afterAll(async () => {
    if (prisma) await unblockAuditInserts();
    if (server) await new Promise((r) => server.close(r));
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { restaurantId: { in: restaurantIds } } }).catch(() => {});
      await prisma.restaurantUser.deleteMany({ where: { id: { in: userIds } } });
      await prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
      await prisma.$disconnect?.();
    }
  });

  beforeEach(resetIpBudget);

  it(
    'parallel wrong codes cannot overspend the budget: exactly 5 counted 400s, the rest 429, exactly 5 failure rows',
    { timeout: 60_000 },
    async () => {
      const { restaurant, token } = await tenantWithManager('ONBOARDING');
      const wrong = wrongCodeFor(restaurant.id);

      const BURST = 12;
      const results = await Promise.all(Array.from({ length: BURST }, () => verify(token, wrong)));

      const counted = results.filter((r) => r.status === 400 && r.json.code === 'INVALID_VERIFICATION_CODE');
      const locked = results.filter((r) => r.status === 429 && r.json.code === 'VERIFICATION_LOCKED');
      expect(counted).toHaveLength(5);
      expect(locked).toHaveLength(BURST - 5);
      // Every response is accounted for — no 200/500 leaks in either direction.
      expect(counted.length + locked.length).toBe(BURST);

      expect(await auditRows(restaurant.id, FAILED)).toHaveLength(5);
      expect(await statusOf(restaurant.id)).toBe('ONBOARDING');

      // Still locked afterwards, even for the correct code (no oracle).
      const after = await verify(token, currentCode(restaurant.id));
      expect(after.status).toBe(429);
      expect(after.json.code).toBe('VERIFICATION_LOCKED');
      expect(await auditRows(restaurant.id, FAILED)).toHaveLength(5);
    }
  );

  it(
    'parallel correct codes activate exactly once: one transition, one success row, the rest alreadyVerified',
    { timeout: 60_000 },
    async () => {
      const { restaurant, token } = await tenantWithManager('ONBOARDING');
      const code = currentCode(restaurant.id);

      const BURST = 6;
      const results = await Promise.all(Array.from({ length: BURST }, () => verify(token, code)));

      for (const r of results) {
        expect(r.status).toBe(200);
        expect(r.json.data.verified).toBe(true);
        expect(r.json.data.restaurant.status).toBe('ACTIVE');
      }
      const firstTime = results.filter((r) => r.json.data.alreadyVerified !== true);
      const repeats = results.filter((r) => r.json.data.alreadyVerified === true);
      expect(firstTime).toHaveLength(1);
      expect(repeats).toHaveLength(BURST - 1);

      expect(await auditRows(restaurant.id, VERIFIED)).toHaveLength(1);
      expect(await auditRows(restaurant.id, FAILED)).toHaveLength(0);
      expect(await statusOf(restaurant.id)).toBe('ACTIVE');
    }
  );

  it(
    'fail-closed: if the failure row cannot be persisted, a wrong code is a 500 — never an uncounted 400',
    { timeout: 60_000 },
    async () => {
      const { restaurant, token } = await tenantWithManager('ONBOARDING');
      const wrong = wrongCodeFor(restaurant.id);
      try {
        await blockAuditInserts(restaurant.id, FAILED);
        const r = await verify(token, wrong);
        expect(r.status).toBe(500);
        expect(r.json.success).toBe(false);
        expect(r.json.code).not.toBe('INVALID_VERIFICATION_CODE');
        // Honest accounting: the attempt was NOT recorded, and nothing claims it was.
        expect(await auditRows(restaurant.id, FAILED)).toHaveLength(0);
        expect(await statusOf(restaurant.id)).toBe('ONBOARDING');
      } finally {
        await unblockAuditInserts();
      }
      // Once persistence works again the same wrong code is counted normally.
      resetIpBudget();
      const retry = await verify(token, wrong);
      expect(retry.status).toBe(400);
      expect(retry.json.code).toBe('INVALID_VERIFICATION_CODE');
      expect(await auditRows(restaurant.id, FAILED)).toHaveLength(1);
    }
  );

  it(
    'fail-closed: if the success row cannot be persisted, activation rolls back with it (still ONBOARDING, retry works)',
    { timeout: 60_000 },
    async () => {
      const { restaurant, token } = await tenantWithManager('ONBOARDING');
      const code = currentCode(restaurant.id);
      try {
        await blockAuditInserts(restaurant.id, VERIFIED);
        const r = await verify(token, code);
        expect(r.status).toBe(500);
        expect(r.json.success).toBe(false);
        // Atomicity: no activation without its success record.
        expect(await statusOf(restaurant.id)).toBe('ONBOARDING');
        expect(await auditRows(restaurant.id, VERIFIED)).toHaveLength(0);
      } finally {
        await unblockAuditInserts();
      }
      resetIpBudget();
      const retry = await verify(token, currentCode(restaurant.id));
      expect(retry.status).toBe(200);
      expect(retry.json.data.verified).toBe(true);
      expect(await statusOf(restaurant.id)).toBe('ACTIVE');
      expect(await auditRows(restaurant.id, VERIFIED)).toHaveLength(1);
    }
  );

  it(
    'tenant status: an activated or suspended restaurant cannot be moved back to ONBOARDING; approval/toggle still work',
    { timeout: 60_000 },
    async () => {
      const active = await tenantWithManager('ACTIVE');
      const back = await setTenantStatus(active.restaurant.id, 'ONBOARDING');
      expect(back.status).toBe(409);
      expect(await statusOf(active.restaurant.id)).toBe('ACTIVE');

      const suspend = await setTenantStatus(active.restaurant.id, 'SUSPENDED');
      expect(suspend.status).toBe(200);
      expect(await statusOf(active.restaurant.id)).toBe('SUSPENDED');

      const backFromSuspended = await setTenantStatus(active.restaurant.id, 'ONBOARDING');
      expect(backFromSuspended.status).toBe(409);
      expect(await statusOf(active.restaurant.id)).toBe('SUSPENDED');

      const onboarding = await tenantWithManager('ONBOARDING');
      // No-op on a tenant already in quarantine is not a re-activation cycle.
      const noop = await setTenantStatus(onboarding.restaurant.id, 'ONBOARDING');
      expect(noop.status).toBe(200);
      expect(await statusOf(onboarding.restaurant.id)).toBe('ONBOARDING');

      // Manual platform approval (ONBOARDING→ACTIVE) remains available.
      const approve = await setTenantStatus(onboarding.restaurant.id, 'ACTIVE');
      expect(approve.status).toBe(200);
      expect(await statusOf(onboarding.restaurant.id)).toBe('ACTIVE');
    }
  );

  it(
    'isolation: with 4 failures already counted, a parallel burst counts exactly ONE more (reads after the lock see committed rows)',
    { timeout: 60_000 },
    async () => {
      // F-01-E: this pins the read-after-lock visibility the budget relies on.
      // Under ReadCommitted each statement sees the latest committed rows, so
      // serialized attempts observe each other's failures; a snapshot taken
      // before the lock wait (RepeatableRead) would let the whole burst read
      // "4" and overspend. The handler pins ReadCommitted explicitly.
      const { restaurant, user, token } = await tenantWithManager('ONBOARDING');
      await seedFailures(restaurant.id, user.id, 4);
      const wrong = wrongCodeFor(restaurant.id);

      const BURST = 4;
      const results = await Promise.all(Array.from({ length: BURST }, () => verify(token, wrong)));

      const counted = results.filter((r) => r.status === 400 && r.json.code === 'INVALID_VERIFICATION_CODE');
      const locked = results.filter((r) => r.status === 429 && r.json.code === 'VERIFICATION_LOCKED');
      expect(counted).toHaveLength(1);
      expect(locked).toHaveLength(BURST - 1);
      expect(counted.length + locked.length).toBe(BURST);
      expect(await auditRows(restaurant.id, FAILED)).toHaveLength(5);
      expect(await statusOf(restaurant.id)).toBe('ONBOARDING');
    }
  );

  it(
    'state gates: a SUSPENDED or MAINTENANCE tenant is refused end-to-end and nothing is counted or activated',
    { timeout: 60_000 },
    async () => {
      for (const status of ['SUSPENDED', 'MAINTENANCE'] as const) {
        const { restaurant, token } = await tenantWithManager(status);
        // Refused (auth tenant gate first, handler gate as defense in depth).
        const wrongRes = await verify(token, wrongCodeFor(restaurant.id));
        expect(wrongRes.status).toBe(403);
        expect(wrongRes.json.success).toBe(false);
        resetIpBudget();
        const rightRes = await verify(token, currentCode(restaurant.id));
        expect(rightRes.status).toBe(403);
        expect(rightRes.json.success).toBe(false);
        // No failure is written against the wrong code, so reaching a needed
        // state later can never mean these refusals consumed the budget.
        expect(await auditRows(restaurant.id, FAILED)).toHaveLength(0);
        expect(await auditRows(restaurant.id, VERIFIED)).toHaveLength(0);
        expect(await statusOf(restaurant.id)).toBe(status);
        resetIpBudget();
      }
    }
  );

  it(
    'race loser semantics: after platform approval, /verify is alreadyVerified and writes no activation or failure rows',
    { timeout: 60_000 },
    async () => {
      const { restaurant, token } = await tenantWithManager('ONBOARDING');
      const approve = await setTenantStatus(restaurant.id, 'ACTIVE');
      expect(approve.status).toBe(200);

      const withCode = await verify(token, currentCode(restaurant.id));
      expect(withCode.status).toBe(200);
      expect(withCode.json.data.alreadyVerified).toBe(true);
      expect(withCode.json.data.verified).toBe(true);

      resetIpBudget();
      const withWrong = await verify(token, wrongCodeFor(restaurant.id));
      expect(withWrong.status).toBe(200);
      expect(withWrong.json.data.alreadyVerified).toBe(true);

      // The admin approval left TENANT_STATUS_CHANGED, never a gate success;
      // /verify must not fabricate one after the fact.
      expect(await auditRows(restaurant.id, VERIFIED)).toHaveLength(0);
      expect(await auditRows(restaurant.id, FAILED)).toHaveLength(0);
      expect(await statusOf(restaurant.id)).toBe('ACTIVE');
    }
  );
});
