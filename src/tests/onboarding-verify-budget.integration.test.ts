import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { config as loadDotenv } from 'dotenv';

/**
 * POST /api/onboarding/verify — guessing budget + rotating code (F-01 gate).
 *
 *   * 5 wrong codes within 15 min lock the RESTAURANT: the 6th attempt is 429
 *     `VERIFICATION_LOCKED` for a wrong AND for the correct code (no bypass,
 *     no oracle), and nothing is activated;
 *   * the budget is per restaurant — another tenant is unaffected;
 *   * the budget is durable (derived from audit rows): once the counted
 *     failures age out, the correct code activates the restaurant;
 *   * the per-IP selfOnboardLimiter still wraps the route;
 *   * rotating code: the previous window's code is accepted, a two-window-old
 *     code is not; legacy (v1) codes are accepted only for restaurants created
 *     before the cut-off;
 *   * API contract preserved: 400 `INVALID_VERIFICATION_CODE`, 200 payload with
 *     `verified` + `verificationReference`, `alreadyVerified` on repeat.
 *
 * Server assembly follows the established integration pattern: the onboarding
 * router is mounted on a fresh express app — server/index.ts is never imported.
 */

loadDotenv();

const hasDb = Boolean(process.env.DATABASE_URL);

describe('onboarding verify budget gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
  });
});

describe.skipIf(!hasDb)('Official Activation Code guessing budget (real PostgreSQL)', () => {
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

  const run = `vbudget${Date.now().toString(36)}`;
  const restaurantIds: string[] = [];
  const userIds: string[] = [];
  let seq = 0;

  const FAILED = 'RESTAURANT_VERIFICATION_FAILED';

  const verify = async (token: string, code: string) => {
    const res = await fetch(`${base}/api/onboarding/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    });
    return { status: res.status, headers: res.headers, json: await res.json().catch(() => ({})) };
  };

  const resetIpBudget = () => {
    if (!selfOnboardLimiter) return;
    for (const k of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) selfOnboardLimiter.resetKey(k);
  };

  /** An ONBOARDING restaurant with its (self-registered) manager token. */
  async function onboardingTenant(opts: { createdAt?: Date } = {}) {
    seq += 1;
    const id = `rest-${run}-${seq}`;
    const userId = `mgr-${run}-${seq}`;
    restaurantIds.push(id);
    userIds.push(userId);
    const bcrypt = await import('bcryptjs');
    const restaurant = await prisma.restaurant.create({
      data: {
        id,
        slug: `verify-budget-${run}-${seq}`,
        name: `Verify Budget ${seq}`,
        logoUrl: '',
        description: 'F-01 budget test',
        phone: '0000000000',
        address: 'Test',
        galleryImages: [],
        status: 'ONBOARDING',
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
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

  /** A 6-digit code that is NOT accepted for this restaurant right now. */
  const wrongCodeFor = (restaurantId: string) => {
    const taken = new Set([
      currentCode(restaurantId),
      currentCode(restaurantId, Date.now() - provisioning.VERIFICATION_CODE_WINDOW_MS),
      provisioning.computeLegacyRestaurantVerificationCode(restaurantId, jwtSecret),
    ]);
    for (const c of ['000000', '111111', '222222', '333333']) if (!taken.has(c)) return c;
    throw new Error('unreachable');
  };

  const failedRows = (restaurantId: string) =>
    prisma.auditLog.findMany({ where: { restaurantId, action: FAILED }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    const { default: express } = await import('express');
    const onboardingRouter = (await import('../../server/routes/onboarding')).default;
    const auth = await import('../../server/middleware/auth');
    signToken = auth.signToken;
    ({ selfOnboardLimiter } = await import('../../server/middleware/rateLimit'));
    ({ prisma } = await import('../../server/db/prisma'));
    ({ config: { jwtSecret } } = await import('../../server/config'));
    provisioning = await import('../../server/services/restaurantProvisioning');

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/onboarding', auth.authenticateToken, onboardingRouter);
    server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { restaurantId: { in: restaurantIds } } }).catch(() => {});
      await prisma.restaurantUser.deleteMany({ where: { id: { in: userIds } } });
      await prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
      await prisma.$disconnect?.();
    }
  });

  beforeEach(resetIpBudget);
  afterEach(() => vi.useRealTimers());

  it('wrong code → 400 INVALID_VERIFICATION_CODE and one durable failure row (contract unchanged)', async () => {
    const { restaurant, token } = await onboardingTenant();
    const r = await verify(token, wrongCodeFor(restaurant.id));
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_VERIFICATION_CODE');
    expect(r.json.success).toBe(false);
    expect(r.headers.get('ratelimit-policy')).toBeTruthy(); // per-IP limiter still mounted
    const rows = await failedRows(restaurant.id);
    expect(rows).toHaveLength(1);
    expect((await prisma.restaurant.findUnique({ where: { id: restaurant.id } })).status).toBe('ONBOARDING');
  });

  it('5 failures lock the restaurant: 6th attempt is 429 VERIFICATION_LOCKED even with the CORRECT code', async () => {
    const { restaurant, token } = await onboardingTenant();
    const wrong = wrongCodeFor(restaurant.id);
    for (let i = 0; i < 5; i += 1) {
      const r = await verify(token, wrong);
      expect(r.status).toBe(400);
      expect(r.json.code).toBe('INVALID_VERIFICATION_CODE');
    }
    const lockedWrong = await verify(token, wrong);
    expect(lockedWrong.status).toBe(429);
    expect(lockedWrong.json.code).toBe('VERIFICATION_LOCKED');
    expect(String(lockedWrong.json.error)).toContain('محاولات كثيرة');

    const lockedRight = await verify(token, currentCode(restaurant.id));
    expect(lockedRight.status).toBe(429);
    expect(lockedRight.json.code).toBe('VERIFICATION_LOCKED');
    expect(lockedRight.json.data).toBeUndefined();

    // Nothing activated, and attempts during the lock add no failure rows.
    expect((await prisma.restaurant.findUnique({ where: { id: restaurant.id } })).status).toBe('ONBOARDING');
    expect(await failedRows(restaurant.id)).toHaveLength(5);
  });

  it('the budget is per restaurant: a different tenant is not affected by another tenant’s failures', async () => {
    const a = await onboardingTenant();
    const b = await onboardingTenant();
    const wrongA = wrongCodeFor(a.restaurant.id);
    for (let i = 0; i < 5; i += 1) expect((await verify(a.token, wrongA)).status).toBe(400);
    expect((await verify(a.token, currentCode(a.restaurant.id))).status).toBe(429);

    const ok = await verify(b.token, currentCode(b.restaurant.id));
    expect(ok.status).toBe(200);
    expect(ok.json.data.verified).toBe(true);
    expect(ok.json.data.restaurant.status).toBe('ACTIVE');
    expect(ok.json.data.verificationReference).toBe(provisioning.buildVerificationReference(b.restaurant.id));
  });

  it('the lock expires with the window (durable rows age out) and the correct code then activates', async () => {
    const { restaurant, token } = await onboardingTenant();
    const wrong = wrongCodeFor(restaurant.id);
    for (let i = 0; i < 5; i += 1) expect((await verify(token, wrong)).status).toBe(400);
    expect((await verify(token, currentCode(restaurant.id))).status).toBe(429);

    // Age the counted failures past the 15-minute window (server clock decides).
    await prisma.auditLog.updateMany({
      where: { restaurantId: restaurant.id, action: FAILED },
      data: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
    const ok = await verify(token, currentCode(restaurant.id));
    expect(ok.status).toBe(200);
    expect(ok.json.data.verified).toBe(true);
    expect(ok.json.data.restaurant.status).toBe('ACTIVE');

    // Repeat after activation: idempotent `alreadyVerified` (unchanged contract).
    const again = await verify(token, '000000');
    expect(again.status).toBe(200);
    expect(again.json.data.alreadyVerified).toBe(true);
  });

  it('rotating code: the previous window’s code is accepted, a two-window-old code is refused', async () => {
    const W = provisioning.VERIFICATION_CODE_WINDOW_MS;
    const first = await onboardingTenant();
    const second = await onboardingTenant();
    const realNow = Date.now();
    const previous = currentCode(first.restaurant.id, realNow - W);
    const stale = currentCode(second.restaurant.id, realNow - 2 * W);
    const acceptedNow = (id: string) => new Set([currentCode(id, realNow), currentCode(id, realNow - W)]);

    // Only the clock is faked (sockets/timers stay real) — the route reads Date.now().
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(realNow);

    const okPrev = await verify(first.token, previous);
    expect(okPrev.status).toBe(200);
    expect(okPrev.json.data.restaurant.status).toBe('ACTIVE');

    if (!acceptedNow(second.restaurant.id).has(stale)) {
      const refused = await verify(second.token, stale);
      expect(refused.status).toBe(400);
      expect(refused.json.code).toBe('INVALID_VERIFICATION_CODE');
    }
  });

  it('legacy (v1) code: accepted only for a restaurant created before the cut-off', async () => {
    const legacyTenant = await onboardingTenant({
      createdAt: new Date(provisioning.LEGACY_VERIFICATION_CODE_CUTOFF.getTime() - 86_400_000),
    });
    const newTenant = await onboardingTenant({
      createdAt: new Date(provisioning.LEGACY_VERIFICATION_CODE_CUTOFF.getTime() + 86_400_000),
    });
    const legacyOld = provisioning.computeLegacyRestaurantVerificationCode(legacyTenant.restaurant.id, jwtSecret);
    const legacyNew = provisioning.computeLegacyRestaurantVerificationCode(newTenant.restaurant.id, jwtSecret);

    const okLegacy = await verify(legacyTenant.token, legacyOld);
    expect(okLegacy.status).toBe(200);
    expect(okLegacy.json.data.restaurant.status).toBe('ACTIVE');

    const W = provisioning.VERIFICATION_CODE_WINDOW_MS;
    const accepted = new Set([currentCode(newTenant.restaurant.id), currentCode(newTenant.restaurant.id, Date.now() - W)]);
    if (!accepted.has(legacyNew)) {
      const refused = await verify(newTenant.token, legacyNew);
      expect(refused.status).toBe(400);
      expect(refused.json.code).toBe('INVALID_VERIFICATION_CODE');
      expect((await prisma.restaurant.findUnique({ where: { id: newTenant.restaurant.id } })).status).toBe('ONBOARDING');
    }
  });
});
