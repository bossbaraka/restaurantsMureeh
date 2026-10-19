import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { config as loadDotenv } from 'dotenv';

/**
 * POST /api/auth/login — per-account lock ordering (F-02 regression gate).
 *
 * The per-account progressive lock (AUTH-02) must be evaluated BEFORE the
 * password proof, exactly like /employee-login and /step-up already do:
 *
 *   * while the account is locked the answer is the same 429 for a wrong AND
 *     for the correct password — the lock must not double as a password
 *     oracle, and no session is ever issued during the lock;
 *   * attempts made during the lock do NOT inflate `failedAuthCount`
 *     (no remote lock extension);
 *   * unknown e-mails keep the generic 401 (the DUMMY_HASH timing path is
 *     untouched) — lock state is never revealed for non-existent accounts;
 *   * the per-IP loginLimiter still wraps the route (no bypass path).
 *
 * Server assembly follows the established integration pattern: the auth
 * router is mounted on a fresh express app — server/index.ts is never imported.
 */

loadDotenv();

const hasDb = Boolean(process.env.DATABASE_URL);

describe('login lockout integration gate', () => {
  it('runs DB integration only when DATABASE_URL is set', () => {
    expect(typeof hasDb).toBe('boolean');
  });
});

describe.skipIf(!hasDb)('Manager login lock ordering (real PostgreSQL)', () => {
  type App = ReturnType<typeof import('express')>;
  let app: App;
  let server: import('http').Server;
  let base: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let loginLimiter: { resetKey: (k: string) => void };

  const run = `loginlock${Date.now().toString(36)}`;
  const restaurantId = `rest-${run}`;
  const managerId = `mgr-${run}`;
  const email = `manager@${run}.test`;
  const password = 'ManagerPass#2026';
  const LOCK_MESSAGE_PREFIX = 'محاولات دخول كثيرة لهذا الحساب. حاول مجدداً بعد';
  const GENERIC_401 = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';

  const login = async (mail: string, pwd: string) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: mail, password: pwd }),
    });
    return {
      status: res.status,
      headers: res.headers,
      json: await res.json().catch(() => ({})),
    };
  };

  const resetIpBudget = () => {
    if (!loginLimiter) return;
    for (const k of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) loginLimiter.resetKey(k);
  };

  const readUser = () => prisma.restaurantUser.findUnique({ where: { id: managerId } });

  const setLockState = (failedAuthCount: number, authLockedUntil: Date | null) =>
    prisma.restaurantUser.update({
      where: { id: managerId },
      data: { failedAuthCount, authLockedUntil, lastAuthFailAt: authLockedUntil ? new Date() : null },
    });

  beforeAll(async () => {
    const { default: express } = await import('express');
    const authRouter = (await import('../../server/routes/auth')).default;
    const { authenticateToken } = await import('../../server/middleware/auth');
    ({ loginLimiter } = await import('../../server/middleware/rateLimit'));
    ({ prisma } = await import('../../server/db/prisma'));
    const bcrypt = await import('bcryptjs');

    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        slug: `login-lock-${run}`,
        name: `Login Lock ${run}`,
        logoUrl: '',
        description: 'lock ordering test',
        phone: '0000000000',
        address: 'Test',
        galleryImages: [],
        status: 'ACTIVE',
      },
    });
    await prisma.restaurantUser.create({
      data: {
        id: managerId,
        restaurantId,
        name: `Manager ${run}`,
        email,
        passwordHash: bcrypt.hashSync(password, 10),
        role: 'RESTAURANT_MANAGER',
        status: 'ACTIVE',
      },
    });

    app = express();
    app.use(express.json({ limit: '1mb' }));
    // Mount parity with server/index.ts (auth router behind authenticateToken).
    app.use('/api/auth', authenticateToken, authRouter);
    server = await new Promise<import('http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    await prisma.auditLog?.deleteMany?.({ where: { userId: managerId } }).catch(() => {});
    await prisma.restaurantUser.deleteMany({ where: { id: managerId } });
    await prisma.restaurant.deleteMany({ where: { id: restaurantId } });
    await prisma.$disconnect?.();
  });

  beforeEach(async () => {
    resetIpBudget();
    await setLockState(0, null);
  });

  it('locked account + WRONG password → 429 lock message, counter NOT inflated', async () => {
    const lockedUntil = new Date(Date.now() + 60_000);
    await setLockState(5, lockedUntil);

    const r = await login(email, 'definitely-wrong-password');
    expect(r.status).toBe(429);
    expect(String(r.json.error)).toContain(LOCK_MESSAGE_PREFIX);
    expect(r.json.data).toBeUndefined();

    const after = await readUser();
    expect(after.failedAuthCount).toBe(5);
    expect(new Date(after.authLockedUntil).getTime()).toBe(lockedUntil.getTime());
  });

  it('locked account + CORRECT password → the SAME 429 (no password oracle), no token issued', async () => {
    await setLockState(5, new Date(Date.now() + 60_000));

    const wrong = await login(email, 'definitely-wrong-password');
    const right = await login(email, password);
    expect(wrong.status).toBe(429);
    expect(right.status).toBe(429);
    expect(right.json.data?.token).toBeUndefined();
    // Identical error template for both answers (only the countdown may differ).
    expect(String(right.json.error)).toContain(LOCK_MESSAGE_PREFIX);
    expect(String(wrong.json.error)).toContain(LOCK_MESSAGE_PREFIX);

    const after = await readUser();
    expect(after.failedAuthCount).toBe(5);
  });

  it('unknown e-mail keeps the generic 401 (no lock state for non-existent accounts)', async () => {
    const r = await login(`nobody-${run}@example.test`, 'whatever-password');
    expect(r.status).toBe(401);
    expect(r.json.error).toBe(GENERIC_401);
  });

  it('wrong password on an UNLOCKED account still counts and answers 401', async () => {
    const r = await login(email, 'definitely-wrong-password');
    expect(r.status).toBe(401);
    expect(r.json.error).toBe(GENERIC_401);
    const after = await readUser();
    expect(after.failedAuthCount).toBe(1);
    expect(after.authLockedUntil).toBeNull();
  });

  it('5 failures lock the account; attempts during the lock do not extend it; expiry + correct password resets', async () => {
    for (let i = 0; i < 4; i += 1) {
      expect((await login(email, 'definitely-wrong-password')).status).toBe(401);
    }
    const fifth = await login(email, 'definitely-wrong-password');
    expect([401, 429]).toContain(fifth.status); // the locking attempt itself
    const locked = await readUser();
    expect(locked.failedAuthCount).toBe(5);
    expect(locked.authLockedUntil).not.toBeNull();
    const lockedUntilMs = new Date(locked.authLockedUntil).getTime();

    // During the lock: wrong AND correct are both refused, nothing is counted.
    expect((await login(email, 'definitely-wrong-password')).status).toBe(429);
    expect((await login(email, password)).status).toBe(429);
    const stillLocked = await readUser();
    expect(stillLocked.failedAuthCount).toBe(5);
    expect(new Date(stillLocked.authLockedUntil).getTime()).toBe(lockedUntilMs);

    // Expiry is decided by the server clock, not the client.
    await prisma.restaurantUser.update({
      where: { id: managerId },
      data: { authLockedUntil: new Date(Date.now() - 1000) },
    });
    const ok = await login(email, password);
    expect(ok.status).toBe(200);
    expect(typeof ok.json.data?.token).toBe('string');
    const reset = await readUser();
    expect(reset.failedAuthCount).toBe(0);
    expect(reset.authLockedUntil).toBeNull();
  });

  it('expired lock + wrong password re-locks with a LONGER penalty (progressive budget intact)', async () => {
    await setLockState(5, new Date(Date.now() - 1000));
    const r = await login(email, 'definitely-wrong-password');
    expect(r.status).toBe(401);
    const relocked = await readUser();
    expect(relocked.failedAuthCount).toBe(6);
    expect(new Date(relocked.authLockedUntil).getTime() - Date.now()).toBeGreaterThan(45_000);
  });

  it('the per-IP loginLimiter still wraps the route (RateLimit policy headers present)', async () => {
    const r = await login(email, 'definitely-wrong-password');
    expect(r.status).toBe(401);
    expect(r.headers.get('ratelimit-policy')).toBeTruthy();
  });
});
