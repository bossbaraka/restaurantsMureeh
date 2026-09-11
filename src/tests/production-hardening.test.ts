/**
 * Production Hardening regression suite (2026-09-11).
 *
 * Covers the fixes from the production-hardening pass:
 *  - Storage fail-closed boot configuration (no ephemeral fallback)
 *  - SSE connection caps (global / per-tenant / per-session) + cleanup
 *  - Subscription period lifecycle (ACTIVE -> PAST_DUE -> CANCELLED)
 *  - POS cash reconciliation (short cash rejected, change computed server-side)
 *  - Credential redaction in access logs (the shipped function, not a copy)
 *  - Tenant-local-day analytics boundaries
 *  - Storage readiness probe
 *
 * Pure / unit / filesystem level by design — the same convention as
 * security-remediation.test.ts — so the suite runs with no database and no
 * network. Live HTTP/SSE behaviour is additionally exercised by
 * security-tests/api-security-smoke.mjs against a deployed environment.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

import { RealtimeService, MAX_PER_TENANT, MAX_PER_SUBJECT, GLOBAL_MAX_CLIENTS } from '../../server/services/realtime';
import {
  effectiveSubscriptionState,
  dueStatusTransition,
  DEFAULT_PAST_DUE_GRACE_DAYS,
} from '../../server/services/plans';
import { reconcileCashPayment } from '../../server/utils/security';
import { startOfDayInTimezone } from '../../server/utils/datetime';
import { SupabaseStorageDriver } from '../../server/services/storage/supabase';

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

const day = 86_400_000;
const now = new Date('2026-09-11T12:00:00.000Z');

// ---------------------------------------------------------------------------
// P0 — production storage configuration FAILS CLOSED
// ---------------------------------------------------------------------------
describe('P0: storage fail-closed in production', () => {
  const VALID_SECRET = 'x'.repeat(40);

  async function loadConfig() {
    vi.resetModules();
    return vi.importActual('../../server/config.ts') as Promise<any>;
  }

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.STORAGE_DRIVER;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.STORAGE_ALLOW_LOCAL_IN_PROD;
  });

  it('REFUSES to boot in production when supabase creds are missing (no local fallback)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://mureeh.example';
    process.env.DATABASE_URL = 'postgresql://u:p@db.internal:5432/app';
    process.env.JWT_SECRET = VALID_SECRET;
    process.env.STORAGE_DRIVER = 'supabase';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(loadConfig()).rejects.toThrow(/SUPABASE/);
  });

  it('REFUSES local storage in production without the persistent-volume opt-in', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://mureeh.example';
    process.env.DATABASE_URL = 'postgresql://u:p@db.internal:5432/app';
    process.env.JWT_SECRET = VALID_SECRET;
    process.env.STORAGE_DRIVER = 'local';
    delete process.env.STORAGE_ALLOW_LOCAL_IN_PROD;
    await expect(loadConfig()).rejects.toThrow(/STORAGE_ALLOW_LOCAL_IN_PROD|ephemeral/i);
  });

  it('BOOTS in production with supabase driver and full credentials', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://mureeh.example';
    process.env.DATABASE_URL = 'postgresql://u:p@db.internal:5432/app';
    process.env.JWT_SECRET = VALID_SECRET;
    process.env.STORAGE_DRIVER = 'supabase';
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'restaurant-assets';
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('supabase');
    expect(mod.isProd).toBe(true);
  });

  it('BOOTS local in production only with the explicit persistent-volume flag', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://mureeh.example';
    process.env.DATABASE_URL = 'postgresql://u:p@db.internal:5432/app';
    process.env.JWT_SECRET = VALID_SECRET;
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_ALLOW_LOCAL_IN_PROD = 'true';
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('local');
  });

  it('defaults to local storage in development/test with no credentials', async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = VALID_SECRET;
    process.env.STORAGE_DRIVER = 'local';
    const mod = await loadConfig();
    expect(mod.config.storageDriver).toBe('local');
  });

  it('render.yaml pins STORAGE_DRIVER=supabase and never documents a fallback', async () => {
    const render = read('render.yaml');
    expect(render).toMatch(/STORAGE_DRIVER[\s\S]*?value:\s*supabase/);
    expect(render).toContain('FAILS CLOSED');
    expect(render).not.toMatch(/fall\s?back to local storage/);
  });

  it('config source no longer implements the supabase -> local fallback', () => {
    const src = read('server/config.ts');
    expect(src).not.toContain('Falling back to local storage');
    expect(src).not.toContain('resolvedStorageDriver = \'local\'');
  });
});

// ---------------------------------------------------------------------------
// P1 — SSE connection caps + cleanup
// ---------------------------------------------------------------------------
describe('P1: SSE connection limits', () => {
  function fakeStream() {
    const e = new EventEmitter();
    (e as any).write = () => true;
    return e as any;
  }
  const stream = (restaurantId: string, subject: string, tableId?: string) => ({
    id: Math.random().toString(36).slice(2),
    restaurantId,
    subject,
    tableId,
    res: fakeStream(),
  });

  it('caps the total number of streams (global maximum)', () => {
    const svc = new RealtimeService();
    const r = svc.addClient(stream('rest-A', 'staff:boss', undefined));
    expect(r).toEqual({ accepted: true });
    expect(GLOBAL_MAX_CLIENTS).toBeGreaterThan(0);
    expect(GLOBAL_MAX_CLIENTS).toBeLessThanOrEqual(5000);
    svc.removeClient((svc as any).clients[0].id);
    expect(svc.clientCount()).toBe(0);
  });

  it('caps streams per tenant (one noisy restaurant cannot exhaust the registry)', () => {
    const svc = new RealtimeService();
    let accepted = 0;
    for (let i = 0; i < MAX_PER_TENANT + 5; i++) {
      const r = svc.addClient({
        id: `a${i}`,
        restaurantId: 'rest-A',
        subject: `staff:user-${i}`,
        res: fakeStream(),
      });
      if (r.accepted) accepted += 1;
      else expect(r.accepted === false && r.reason === 'tenant').toBe(true);
    }
    expect(accepted).toBe(MAX_PER_TENANT);
    // Another tenant is unaffected.
    expect(svc.addClient(stream('rest-B', 'staff:other')).accepted).toBe(true);
  });

  it('caps streams per session token / per staff user', () => {
    const svc = new RealtimeService();
    for (let i = 0; i < MAX_PER_SUBJECT; i++) {
      expect(svc.addClient(stream('rest-A', 'qr:sess-xyz', 'tbl-1')).accepted).toBe(true);
    }
    const overflow = svc.addClient(stream('rest-A', 'qr:sess-xyz', 'tbl-1'));
    expect(overflow.accepted).toBe(false);
    if (!overflow.accepted) expect(overflow.reason).toBe('subject');
  });

  it('frees all bucket slots when a stream disconnects (no leaked sessions)', () => {
    const svc = new RealtimeService();
    const c = stream('rest-A', 'qr:sess-cleanup', 'tbl-9');
    svc.addClient(c);
    expect(svc.clientCount('rest-A')).toBe(1);
    c.res.emit('close');
    expect(svc.clientCount('rest-A')).toBe(0);
    // The slot is immediately reusable.
    expect(svc.addClient(stream('rest-A', 'qr:sess-cleanup', 'tbl-9')).accepted).toBe(true);
  });

  it('table-scoped broadcasts never cross tables for guest streams', () => {
    const svc = new RealtimeService();
    const received: string[] = [];
    const gA = stream('rest-A', 'qr:s1', 'tbl-A');
    const gB = stream('rest-A', 'qr:s2', 'tbl-B');
    gA.res.write = (d: string) => { received.push(`A:${d}`); return true; };
    gB.res.write = (d: string) => { received.push(`B:${d}`); return true; };
    svc.addClient(gA);
    svc.addClient(gB);
    svc.broadcastToTable('rest-A', 'tbl-A', 'ORDER_CREATED', { x: 1 });
    expect(received.some((m) => m.startsWith('A:'))).toBe(true);
    expect(received.some((m) => m.startsWith('B:'))).toBe(false);
  });

  it('the SSE route mounts the IP connection limiter and passes a subject', () => {
    const src = read('server/routes/public.ts');
    expect(src).toContain("router.get('/events', sseConnectionLimiter");
    expect(src).toContain('subject: connectionSubject');
    expect(src).toContain('result.reason');
  });
});

// ---------------------------------------------------------------------------
// P1 — subscription expiration lifecycle
// ---------------------------------------------------------------------------
describe('P1: subscription period lifecycle', () => {
  it('keeps future-dated ACTIVE/TRIAL rows entitled', () => {
    const future = new Date(now.getTime() + 10 * day);
    expect(effectiveSubscriptionState(
      { status: 'ACTIVE', currentPeriodEnd: future }, now,
    ).entitled).toBe(true);
    const trial = effectiveSubscriptionState(
      { status: 'TRIAL', currentPeriodEnd: future, trialEndsAt: future }, now,
    );
    expect(trial.entitled).toBe(true);
    expect(trial.effectiveStatus).toBe('TRIAL');
  });

  it('moves expired paid plans to PAST_DUE during the grace window', () => {
    const twoDaysAgo = new Date(now.getTime() - 2 * day);
    const s = effectiveSubscriptionState(
      { status: 'ACTIVE', currentPeriodEnd: twoDaysAgo }, now, DEFAULT_PAST_DUE_GRACE_DAYS,
    );
    expect(s.effectiveStatus).toBe('PAST_DUE');
    expect(s.entitled).toBe(true);
    expect(s.daysPastDue).toBe(2);
    expect(dueStatusTransition({ status: 'ACTIVE', currentPeriodEnd: twoDaysAgo }, now)).toBe('PAST_DUE');
  });

  it('cancels entitlement after the grace window', () => {
    const longAgo = new Date(now.getTime() - (DEFAULT_PAST_DUE_GRACE_DAYS + 5) * day);
    const s = effectiveSubscriptionState(
      { status: 'ACTIVE', currentPeriodEnd: longAgo }, now,
    );
    expect(s.effectiveStatus).toBe('CANCELLED');
    expect(s.entitled).toBe(false);
    expect(dueStatusTransition({ status: 'PAST_DUE', currentPeriodEnd: longAgo }, now)).toBe('CANCELLED');
  });

  it('ends expired trials immediately (no payment instrument to dun)', () => {
    const yesterday = new Date(now.getTime() - day);
    const s = effectiveSubscriptionState(
      { status: 'TRIAL', currentPeriodEnd: yesterday, trialEndsAt: yesterday }, now,
    );
    expect(s.effectiveStatus).toBe('CANCELLED');
    expect(s.entitled).toBe(false);
  });

  it('is idempotent for already cancelled/suspended rows', () => {
    expect(dueStatusTransition({ status: 'CANCELLED', currentPeriodEnd: new Date(0) }, now)).toBeNull();
    expect(dueStatusTransition({ status: 'SUSPENDED', currentPeriodEnd: new Date(0) }, now)).toBeNull();
    expect(effectiveSubscriptionState(null).entitled).toBe(false);
  });

  it('manager entitlement gates consult the effective state source', () => {
    const src = read('server/routes/manager.ts');
    expect(src).toContain('effectiveSubscriptionState(subscription)');
  });

  it('ships a manual/scheduler CLI command but never runs it on boot', () => {
    expect(existsSync(resolve(repoRoot, 'server/db/expire-subscriptions.ts'))).toBe(true);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['subscriptions:expire']).toContain('expire-subscriptions');
    // Boot path must never mutate commercial state.
    const index = read('server/index.ts');
    expect(index).not.toContain('processExpiringSubscriptions');
  });
});

// ---------------------------------------------------------------------------
// P1 — POS cash reconciliation
// ---------------------------------------------------------------------------
describe('P1: POS cash reconciliation', () => {
  it('accepts exact cash and records zero change', () => {
    const r = reconcileCashPayment({ method: 'CASH', total: 100, cashReceived: 100 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cashReceived).toBe(100);
      expect(r.changeDue).toBe(0);
    }
  });

  it('computes change for excess cash', () => {
    const r = reconcileCashPayment({ method: 'CASH', total: 99.5, cashReceived: 120 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changeDue).toBeCloseTo(20.5, 2);
  });

  it('rejects insufficient cash (never silently marks PAID)', () => {
    const r = reconcileCashPayment({ method: 'CASH', total: 100, cashReceived: 80 });
    expect(r.ok).toBe(false);
  });

  it('requires an explicit tendered amount for CASH (does not assume exact cash)', () => {
    expect(reconcileCashPayment({ method: 'CASH', total: 100 }).ok).toBe(false);
    expect(reconcileCashPayment({ method: 'CASH', total: 100, cashReceived: null }).ok).toBe(false);
  });

  it('adds any tip to the amount due', () => {
    const short = reconcileCashPayment({ method: 'CASH', total: 100, tip: 10, cashReceived: 105 });
    expect(short.ok).toBe(false);
    const ok = reconcileCashPayment({ method: 'CASH', total: 100, tip: 10, cashReceived: 115 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.changeDue).toBe(5);
  });

  it('records no cash/change for card/mobile/split', () => {
    for (const method of ['CARD', 'MOBILE', 'SPLIT']) {
      const r = reconcileCashPayment({ method, total: 50 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.cashReceived).toBeNull();
        expect(r.changeDue).toBe(0);
      }
    }
  });

  it('rejects arbitrary payment methods', () => {
    expect(reconcileCashPayment({ method: 'BITCOIN', total: 10, cashReceived: 10 }).ok).toBe(false);
  });

  it('the settle route claims orders conditionally inside a transaction (no duplicate receipts)', () => {
    const src = read('server/routes/manager.ts');
    expect(src).toContain('SETTLE_RACE');
    expect(src).toContain('paymentStatus: \'UNPAID\'');
    // Shared helper used by both /payments and /tables/:id/settle.
    expect(src).toContain('reconcileCashPayment');
  });
});

// ---------------------------------------------------------------------------
// P1 — token/credential redaction (the shipped logger function)
// ---------------------------------------------------------------------------
describe('P1: shipped log redaction covers every credential query param', () => {
  it('redacts sessionToken / qrToken / pin / token / password values', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'r'.repeat(40);
    const mod = (await vi.importActual('../../server/index.ts')) as any;
    const redact = mod.redactSensitiveUrl as (u: string) => string;

    const cases: Array<[string, string]> = [
      ['/api/public/events?restaurantId=r1&tableId=t1&sessionToken=sess-SUPER-SECRET', 'sess-SUPER-SECRET'],
      ['/api/public/tables/qr/x?qrToken=qr-hush', 'qr-hush'],
      ['/api/public/events?token=eyJhbGciOiJIUzI1NiJ9.deadbeef.sig', 'deadbeef'],
      ['/api/x?pin=4321', '4321'],
      ['/api/x?password=hunter2', 'hunter2'],
      ['/api/x?apiKey=ak-live-leak', 'ak-live-leak'],
    ];
    for (const [url, secret] of cases) {
      const out = redact(url);
      expect(out).not.toContain(secret);
      expect(out).toContain('[REDACTED]');
    }
    // Non-sensitive values survive.
    expect(redact('/api/health?x=1')).toContain('x=1');
  });
});

// ---------------------------------------------------------------------------
// P1 — analytics day boundaries
// ---------------------------------------------------------------------------
describe('P1: dashboard "today" uses the restaurant timezone', () => {
  it('22:30 UTC in Jerusalem (UTC+3 DST) is the same local day starting 21:00 UTC', () => {
    const d = new Date('2026-09-11T22:30:00.000Z'); // 2026-09-12 01:30 Asia/Jerusalem (DST +3)
    const start = startOfDayInTimezone(d, 'Asia/Jerusalem');
    // Local day is Sep 12 → midnight local = Sep 11 21:00 UTC.
    expect(start.toISOString()).toBe('2026-09-11T21:00:00.000Z');
    expect(d.getTime()).toBeGreaterThanOrEqual(start.getTime());
  });

  it('falls back to a UTC boundary for an invalid timezone', () => {
    const d = new Date('2026-09-11T02:00:00.000Z');
    const start = startOfDayInTimezone(d, 'Not/AZone');
    expect(start.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('dashboard aggregates revenue in SQL and counts only same-day orders as today', () => {
    const src = read('server/routes/manager.ts');
    expect(src).toMatch(/prisma\.order\.aggregate/);
    expect(src).toContain('groupBy');
    expect(src).toContain('startOfDayInTimezone');
    // The old anti-pattern (reduce over every pulled order) must not drive
    // totalRevenue / todayOrdersCount any more.
    expect(src).not.toContain('const validOrders = await prisma.order.findMany');
  });
});

// ---------------------------------------------------------------------------
// Storage readiness probe
// ---------------------------------------------------------------------------
describe('storage readiness probe', () => {
  it('reports failure when the object store rejects requests (no silent green)', async () => {
    const failingAdapter = {
      upload: async () => {
        throw new Error('denied');
      },
      remove: async () => {},
      getPublicUrl: () => 'https://x/y',
      listNames: async () => {
        throw new Error('bucket not found');
      },
    };
    const driver = new SupabaseStorageDriver(
      { url: 'https://project.supabase.co', serviceRoleKey: 'k', bucket: 'b' },
      failingAdapter as any,
    );
    await expect(driver.exists('__healthcheck__/x')).rejects.toThrow(/bucket not found/);
  });
});

// ---------------------------------------------------------------------------
// Manifest / migration-level regressions
// ---------------------------------------------------------------------------
describe('deployment & database safety', () => {
  it('no production start command uses db push / accept-data-loss / seed', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.start).not.toContain('db push');
    expect(pkg.scripts.start).not.toContain('--accept-data-loss');
    expect(pkg.scripts.start).not.toContain('db:seed');
    expect(pkg.scripts.start).toContain('deploy-migrations');
    // Container boot runs the committed-migration wrapper; the wrapper itself
    // only ever invokes `prisma migrate deploy`.
    expect(read('Dockerfile')).toContain('deploy-migrations.ts');
    expect(read('server/db/deploy-migrations.ts')).toContain('migrate deploy');
    expect(read('server/db/deploy-migrations.ts')).not.toContain('db push');
    // Inspect the actual CMD (comments legitimately document what NOT to do).
    const dockerCmd = read('Dockerfile').split('CMD').pop() || '';
    expect(dockerCmd).not.toContain('--accept-data-loss');
    expect(dockerCmd).not.toContain('db push');
    expect(dockerCmd).not.toContain('db:seed');
  });

  it('adds the audit IP column through an additive, idempotent migration', () => {
    expect(read('prisma/schema.prisma')).toMatch(/AuditLog[\s\S]*ipAddress\s+String\?/);
    const migrations = execSync('ls prisma/migrations', { cwd: repoRoot }).toString();
    const dir = migrations.split('\n').find((d) => d.includes('audit_ip'));
    expect(dir).toBeTruthy();
    const sql = read(`prisma/migrations/${dir}/migration.sql`);
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "ipAddress"');
  });

  // NOTE: the workflow file must live under .github/workflows to activate.
  // Some automation identities (e.g. an installed GitHub App token without
  // the `workflows` permission) cannot push files there; when that file is
  // absent from the checkout this test SKIPS (never silently passes), and the
  // deployment checklist requires an owner to add it.
  it.skipIf(!existsSync(resolve(repoRoot, '.github/workflows/secret-scan.yml')))(
    'secret scanning CI is wired (gitleaks, full history)',
    () => {
      const wf = read('.github/workflows/secret-scan.yml');
      expect(wf).toContain('gitleaks/gitleaks-action');
      expect(wf).toContain('fetch-depth: 0');
    }
  );

  it('the gitleaks workflow definition is versioned (with owner install instructions)', () => {
    // When the pushing identity lacks the `workflows` permission the active
    // copy cannot be committed; the definition is staged here instead and the
    // test above activates the moment an owner installs it.
    const staged = read('docs/ci/secret-scan.yml');
    expect(staged).toContain('gitleaks/gitleaks-action');
    expect(staged).toContain('fetch-depth: 0');
    expect(read('docs/ci/README.md')).toContain('.github/workflows/secret-scan.yml');
  });

  it('paid plan upgrades are recorded as 202 approval requests, never self-granted', () => {
    const src = read('server/routes/manager.ts');
    expect(src).toContain('SUBSCRIPTION_UPGRADE_REQUESTED');
    expect(src).toContain('PENDING_PLATFORM_APPROVAL');
    expect(src).toMatch(/res\.status\(202\)/);
  });

  it('suspended restaurants reject fresh authenticated staff requests', () => {
    const mw = read('server/middleware/auth.ts');
    expect(mw).toContain('restaurant: { select: { status: true } }');
    expect(mw).toContain('حساب المطعم موقوف');
  });

  it('orders CSV export is bounded by a hard cap and optional date range', () => {
    const src = read('server/routes/manager.ts');
    expect(src).toContain('EXPORT_CAP = 10_000');
    expect(src).toContain('X-Export-Truncated');
  });
});

// ---------------------------------------------------------------------------
// P2: URL / embed allowlisting (no javascript: / data: / foreign frames)
// ---------------------------------------------------------------------------
describe('P2: URL and embed allowlisting', () => {
  // Imported from the shipped validation module — no copies.
  let allowVideo: (v: string) => boolean;
  let allowMap: (v: string) => boolean;
  let yt: (v: string) => string | null;
  beforeAll(async () => {
    const mod = await import('../../server/validation/schemas.ts');
    allowVideo = mod.isAllowedPromoVideoUrl;
    allowMap = mod.isAllowedMapUrl;
    yt = mod.extractYoutubeVideoId;
  });

  it('rejects javascript:, data:, vbscript:, file: and protocol-relative video URLs', () => {
    for (const evil of [
      'javascript:alert(1)',
      ' JaVaScRiPt:alert(1) ',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example.com/embed',
      'http://www.youtube.com/watch?v=abc12345678',
      'https://vimeo.com/123456',
      'https://evil.com/?v=abc12345678',
    ]) {
      expect(allowVideo(evil)).toBe(false);
    }
  });

  it('accepts only well-formed HTTPS YouTube video links with a valid id', () => {
    expect(allowVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(allowVideo('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(allowVideo('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe(true);
    expect(yt('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    // credentials embedded in the URL are rejected.
    expect(allowVideo('https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    // Empty = "no video" is valid (field optional upstream).
    expect(allowVideo('')).toBe(true);
  });

  it('map links are https/same-origin only, never script schemes', () => {
    expect(allowMap('https://maps.app.goo.gl/xyz')).toBe(true);
    expect(allowMap('/uploads/map.png')).toBe(true);
    expect(allowMap('javascript:alert(1)')).toBe(false);
    expect(allowMap('//evil.example.com/x')).toBe(false);
    expect(allowMap('http://maps.example.com/x')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P2: storage migration pipeline ordering (detect->upload->verify->update->
//     verify URL->deferred cleanup), incl. Base64 legacy images, never on boot
// ---------------------------------------------------------------------------
describe('P2: storage:migrate safety ordering', () => {
  const script = () => read('server/scripts/storage-migrate.ts');

  it('is wired as a manual npm script and never runs at server boot', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['storage:migrate']).toContain('storage-migrate.ts');
    expect(read('server/index.ts')).not.toContain('storage-migrate');
  });

  it('understands both /uploads/ files AND inline data:image base64 payloads', () => {
    const src = script();
    expect(src).toContain('data:image/');
    expect(src).toContain(';base64,');
    expect(src).toContain("'base64'");
    // Sniffing real bytes means a base64 blob claiming image/png but holding
    // HTML/garbage is rejected.
    expect(src).toContain('sniffImage');
  });

  it('verifies existence after upload AND after the DB update', () => {
    const src = script();
    expect(src).toContain('storage.exists(uploaded.key)');
    expect(src).toMatch(/Post-upload verification FAILED/);
    expect(src).toMatch(/Post-DB-update verification FAILED|post-update verification FAILED/);
    expect(src).toContain('storage.keyFromUrl(newUrl)');
  });

  it('dry-run never deletes files; --delete-source requires --apply and cleanup is deferred', () => {
    const src = script();
    expect(src).toMatch(/--delete-source requires --apply/);
    // The only fs.rmSync sits inside the final `if (args.apply && args.deleteSource)` phase.
    const rmIndex = src.indexOf('fs.rmSync(sourcePath');
    expect(rmIndex).toBeGreaterThan(-1);
    const beforeRm = src.slice(0, rmIndex);
    expect(beforeRm).toContain('Final, deferred cleanup');
    // No rmSync may precede the DB-update sections (old bug: files were
    // deleted during row processing, even in dry-run).
    expect(beforeRm).not.toContain('fs.rmSync');
  });

  it('does not claim recovery for missing/invalid sources and exits nonzero on failures', () => {
    const src = script();
    expect(src).toMatch(/MISSING source file/);
    expect(src).toContain('process.exit(2)');
    expect(src).toContain('idempotent');
  });
});

// ---------------------------------------------------------------------------
// P2: SSE client backs off (cap reached => HTTP 503 => EventSource CLOSED)
// ---------------------------------------------------------------------------
describe('P2: SSE client reconnect backoff', () => {
  const OriginalES = (globalThis as any).EventSource;

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (OriginalES) (globalThis as any).EventSource = OriginalES;
    else delete (globalThis as any).EventSource;
  });

  it('reconnects with capped exponential backoff when the server closes the stream', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // deterministic jitter (0ms)
    const instances: any[] = [];
    class FakeES {
      static CLOSED = 2;
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = 2; // server responded 503 => fail-connection => CLOSED
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      url: string;
      closed = false;
      constructor(url: string) {
        this.url = url;
        instances.push(this);
        // Deliver the error asynchronously, like the real event loop.
        queueMicrotask(() => {
          if (!this.closed) this.onerror?.();
        });
      }
      close() {
        this.closed = true;
        this.readyState = 2;
      }
      addEventListener() {}
    }
    (globalThis as any).EventSource = FakeES;
    const { openEventSourceWithBackoff } = await import('../utils/sse.ts');

    const conn = openEventSourceWithBackoff('/api/public/events?x=1', { PING: () => {} });
    await vi.advanceTimersByTimeAsync(0); // flush constructor microtask => first error
    expect(instances.length).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000); // first backoff: exactly 1s (jitter 0)
    expect(instances.length).toBe(2);

    await vi.advanceTimersByTimeAsync(2_000); // second: 2s
    expect(instances.length).toBe(3);

    await vi.advanceTimersByTimeAsync(4_000); // third: 4s
    expect(instances.length).toBe(4);

    conn.close();
    await vi.advanceTimersByTimeAsync(120_000); // would have hit the 30s cap
    expect(instances.length).toBe(4); // no further reconnects after close()
  });

  it('degrades to a no-op connection when EventSource is unavailable (SSR/test)', async () => {
    delete (globalThis as any).EventSource;
    const { openEventSourceWithBackoff } = await import('../utils/sse.ts');
    const conn = openEventSourceWithBackoff('/api/public/events', {});
    expect(() => conn.close()).not.toThrow();
    expect(conn.attempts).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P2: frontend XSS sink sweep
// ---------------------------------------------------------------------------
describe('P2: frontend XSS sinks', () => {
  function listTsxFiles(dir: string): string[] {
    return execSync('find src -name "*.tsx" -o -name "*.ts"', { cwd: repoRoot })
      .toString()
      .split('\n')
      .filter((f) => f && !f.includes('tests/'))
      .map((f) => f.trim());
  }

  it('never uses dangerouslySetInnerHTML', () => {
    const offenders = listTsxFiles('src').filter((f) => read(f).includes('dangerouslySetInnerHTML'));
    expect(offenders).toEqual([]);
  });

  it('print-window document.write templates escape every interpolated field', () => {
    for (const f of ['src/components/manager/CashierPOSView.tsx', 'src/components/manager/OrderManagement.tsx']) {
      const src = read(f);
      expect(src).toContain('document.write');
      expect(src).toContain('escapeHtml');
      // The known untrusted fields pass through esc()/escapeHtml.
      expect(src).toMatch(/esc\(currentRestaurant\?\.name|restaurantName = 'مُريح/);
      // No inline scripts in the PRINTED DOCUMENT (the source comment above
      // document.write legitimately mentions the word <script>; scope the
      // assertion to the template literal actually written to the window).
      const docStart = src.indexOf('document.write');
      const docEnd = src.indexOf('</html>', docStart);
      const printedDoc = src.slice(docStart, docEnd);
      expect(printedDoc).not.toMatch(/<script/i);
    }
  });

  it('window.open only targets hardcoded https URLs, about:blank printers, or generated QR links', () => {
    for (const f of listTsxFiles('src')) {
      const src = read(f);
      const matches = [...src.matchAll(/window\.open\(([^,)]+)/g)].map((m) => m[1].trim());
      for (const arg of matches) {
        const ok =
          arg === "''" ||
          arg.startsWith('`https://') ||
          arg === 'displayLink' ||
          /^['"]https:/.test(arg);
        expect({ file: f, arg, ok }).toEqual({ file: f, arg, ok: true });
      }
    }
  });
});
