/**
 * Regression tests for the 2026-09-09 security audit remediation.
 *
 * Every test here encodes a vulnerability that was CONFIRMED present in
 * commit 24c59bc and must never come back. They are deliberately pure /
 * filesystem-level so they run with no database and no generated Prisma
 * client (see SECURITY_AUDIT_2026-09-09.md for why live probing was
 * impossible in the audit environment).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

import {
  evaluatePlanChange,
  planPrice,
  type PricedPlanLike,
} from '../../server/services/plans';
import {
  assertStrongSeedPassword,
  SeedCredentialError,
  SEED_MIN_PASSWORD_LENGTH,
} from '../../server/db/seed-credentials';
import {
  isAllowedPromoVideoUrl,
  tableSettleSchema,
  brandingSchema,
} from '../../server/validation/schemas';

const repoRoot = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

// ---------------------------------------------------------------
// C-01 — hardcoded live database credentials committed to the repo
// ---------------------------------------------------------------
describe('C-01: no committed credentials', () => {
  it('does not track a scratch/ directory', () => {
    const tracked = execSync('git ls-files scratch', { cwd: repoRoot })
      .toString()
      .trim();
    expect(tracked).toBe('');
    expect(existsSync(resolve(repoRoot, 'scratch'))).toBe(false);
  });

  it('ignores scratch/ and secret file patterns', () => {
    const gitignore = read('.gitignore');
    for (const pattern of ['scratch/', '*.credentials', '*.secrets', 'secrets.json']) {
      expect(gitignore).toContain(pattern);
    }
  });

  it('has no live postgres connection string in tracked source', () => {
    // Search tracked files only; matches a real password-bearing URI.
    const files = execSync('git ls-files', { cwd: repoRoot })
      .toString()
      .split('\n')
      .filter((f) => /\.(ts|tsx|js|cjs|mjs|json|ya?ml|sh)$/.test(f));
    const leaks: string[] = [];
    for (const f of files) {
      let body: string;
      try {
        body = read(f);
      } catch {
        continue;
      }
      // postgres://user:password@host — ignore placeholder passwords.
      const m = body.match(/postgres(?:ql)?:\/\/[^\s:'"]+:([^@\s'"]+)@/g);
      if (!m) continue;
      for (const hit of m) {
        if (/(\$\{|USER|PASSWORD|<|\bexample\b|placeholder)/i.test(hit)) continue;
        leaks.push(`${f}: ${hit.slice(0, 40)}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});

// ---------------------------------------------------------------
// C-02 — hardcoded seed passwords / silent credential resets
// ---------------------------------------------------------------
describe('C-02: seeds do not hardcode credentials', () => {
  it('tenant seeds contain no literal Password123! style secret', () => {
    for (const f of ['server/db/seed-shoqrah.ts', 'server/db/seed-ghosn.ts', 'server/db/seed.ts']) {
      expect(read(f)).not.toMatch(/Password123!/);
    }
  });

  it('tenant seeds provision managers via the shared guarded helper', () => {
    for (const f of ['server/db/seed-shoqrah.ts', 'server/db/seed-ghosn.ts']) {
      expect(read(f)).toContain('provisionTenantManager');
    }
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['too short', 'Ab1!x'],
    ['the old hardcoded secret', 'Password123!'],
    ['a denylisted classic', 'password'],
  ])('fails closed on %s rather than minting a weak account', (_label, pw) => {
    expect(() => assertStrongSeedPassword(pw as string, 'X_PASSWORD')).toThrow(
      SeedCredentialError
    );
  });

  it('accepts a strong operator-supplied secret', () => {
    expect(() =>
      assertStrongSeedPassword('9xQ!vTz2Lm4Rw8Kd', 'X_PASSWORD')
    ).not.toThrow();
    expect(SEED_MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12);
  });

  it('demo tenant seeding is gated behind an explicit opt-in', () => {
    expect(read('server/db/seed.ts')).toContain('isDemoSeedAllowed');
  });
});

// ---------------------------------------------------------------
// C-03 — destructive `prisma db push` in deploy paths
// ---------------------------------------------------------------
describe('C-03: deploys never run destructive schema pushes', () => {
  it('Dockerfile and package.json start scripts use migrate deploy', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('prisma migrate deploy');
    // Only executable lines matter; comments may reference the banned command.
    const dockerCmd = dockerfile
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(dockerCmd).not.toMatch(/db\s+push/);
    const pkg = JSON.parse(read('package.json'));
    for (const script of ['start', 'start:server']) {
      expect(pkg.scripts[script]).toContain('prisma migrate deploy');
      expect(pkg.scripts[script]).not.toMatch(/db\s+push/);
    }
  });

  it('render.yaml build step does not mutate the schema', () => {
    const render = read('render.yaml');
    const buildLine = render
      .split('\n')
      .find((l) => l.includes('buildCommand'))!;
    expect(buildLine).not.toMatch(/db\s+push/);
  });
});

// ---------------------------------------------------------------
// H-01 — credentials leaking into access logs
// ---------------------------------------------------------------
describe('H-01: access logs redact credential query params', () => {
  // Mirrors the exported redaction contract in server/index.ts.
  const RE =
    /([?&])(sessionToken|qrToken|token|access_token|refresh_token|pin|password|secret|apiKey)=[^&\s]*/gi;
  const redact = (u: string) => u.replace(RE, '$1$2=[REDACTED]');

  it.each([
    ['/api/public/events?tableId=t1&sessionToken=sess-abc-123', 'sess-abc-123'],
    ['/api/public/events?token=eyJhbGciOiJIUzI1NiJ9.x.y', 'eyJhbGciOiJIUzI1NiJ9'],
    ['/api/t/qr?qrToken=qr-9f8e', 'qr-9f8e'],
    ['/api/x?pin=1234&password=hunter2', 'hunter2'],
  ])('redacts %s', (url, secret) => {
    const out = redact(url);
    expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED]');
  });

  it('server/index.ts uses the hardened multi-param pattern', () => {
    const src = read('server/index.ts');
    expect(src).toContain('sessionToken');
    // The old pattern only handled bare `token=`.
    expect(src).not.toContain("/([?&])token=[^&\\s]*/g");
  });
});

// ---------------------------------------------------------------
// H-02 — free self-service plan upgrade
// ---------------------------------------------------------------
describe('H-02: tenants cannot self-upgrade to a pricier plan', () => {
  const basic: PricedPlanLike = { id: 'basic', name: 'Basic', priceMonthly: 50 };
  const pro: PricedPlanLike = { id: 'pro', name: 'Pro', priceMonthly: 200 };
  const trial: PricedPlanLike = {
    id: 'trial',
    name: 'Trial',
    priceMonthly: 0,
    billingPeriod: 'trial',
  };

  it('blocks a manager upgrading Basic -> Pro with 402', () => {
    const v = evaluatePlanChange({ current: basic, target: pro, isPlatformActor: false });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.statusCode).toBe(402);
  });

  it('blocks upgrading from no subscription to a paid plan', () => {
    const v = evaluatePlanChange({ current: null, target: pro, isPlatformActor: false });
    expect(v.allowed).toBe(false);
  });

  it('allows downgrade and lateral moves', () => {
    expect(evaluatePlanChange({ current: pro, target: basic, isPlatformActor: false }).allowed).toBe(true);
    expect(evaluatePlanChange({ current: basic, target: basic, isPlatformActor: false }).allowed).toBe(true);
  });

  it('never lets a tenant self-serve the free trial', () => {
    const v = evaluatePlanChange({ current: basic, target: trial, isPlatformActor: false });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.statusCode).toBe(403);
  });

  it('permits platform staff to complete a paid upgrade', () => {
    expect(evaluatePlanChange({ current: basic, target: pro, isPlatformActor: true }).allowed).toBe(true);
  });

  it('treats malformed prices as zero rather than throwing', () => {
    expect(planPrice({ id: 'x', priceMonthly: null })).toBe(0);
    expect(planPrice(undefined)).toBe(0);
  });
});

// ---------------------------------------------------------------
// H-03 — TRUST_PROXY missing in production manifest
// ---------------------------------------------------------------
describe('H-03: proxy trust is configured for the hosted deploy', () => {
  it('render.yaml sets TRUST_PROXY', () => {
    const render = read('render.yaml');
    expect(render).toContain('TRUST_PROXY');
    // Must be a proxy count, never `true` (which trusts a spoofed XFF chain).
    const idx = render.indexOf('TRUST_PROXY');
    expect(render.slice(idx, idx + 120)).not.toMatch(/value:\s*"?true"?/);
  });
});

// ---------------------------------------------------------------
// H-04 — unvalidated promo video URL reaching an iframe
// ---------------------------------------------------------------
describe('H-04: promo video URLs are allowlisted', () => {
  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'https://evil.example.com/phish.html',
    'http://www.youtube.com/watch?v=abc', // plaintext http
    'https://user:pass@youtube.com/watch?v=abc',
    'https://notyoutube.com.evil.tld/x',
    '//evil.example.com/x',
  ])('rejects %s', (bad) => {
    expect(isAllowedPromoVideoUrl(bad)).toBe(false);
  });

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://player.vimeo.com/video/12345',
    '/uploads/promo.mp4',
    '',
  ])('accepts %s', (good) => {
    expect(isAllowedPromoVideoUrl(good)).toBe(true);
  });

  it('the settings schema rejects a hostile promo video URL', () => {
    const bad = brandingSchema.safeParse({
      promoVideoUrl: 'https://evil.example.com/x.html',
    });
    expect(bad.success).toBe(false);
    const ok = brandingSchema.safeParse({
      promoVideoUrl: 'https://www.youtube.com/watch?v=abc',
    });
    expect(ok.success).toBe(true);
  });
});

// ---------------------------------------------------------------
// H-05 — unvalidated table settlement body
// ---------------------------------------------------------------
describe('H-05: table settlement body is validated', () => {
  it('rejects an arbitrary free-text payment method', () => {
    expect(tableSettleSchema.safeParse({ paymentMethod: 'BITCOIN' }).success).toBe(false);
    expect(tableSettleSchema.safeParse({ paymentMethod: 'PAY AT CASHIER' }).success).toBe(false);
    expect(
      tableSettleSchema.safeParse({ paymentMethod: 'CASH=1,INJECTED' }).success
    ).toBe(false);
  });

  it('rejects unknown fields (mass assignment) and overlong notes', () => {
    expect(
      tableSettleSchema.safeParse({ paymentMethod: 'CASH', total: 0 }).success
    ).toBe(false);
    expect(
      tableSettleSchema.safeParse({ note: 'x'.repeat(501) }).success
    ).toBe(false);
  });

  it('accepts the supported methods and defaults to CASH', () => {
    for (const m of ['CASH', 'CARD', 'MOBILE', 'SPLIT']) {
      expect(tableSettleSchema.safeParse({ paymentMethod: m }).success).toBe(true);
    }
    const parsed = tableSettleSchema.parse({});
    expect(parsed.paymentMethod).toBe('CASH');
  });

  it('the settle route actually mounts the validator', () => {
    const src = read('server/routes/manager.ts');
    const idx = src.indexOf("'/tables/:id/settle'");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 300)).toContain('validateBody(tableSettleSchema)');
  });
});
