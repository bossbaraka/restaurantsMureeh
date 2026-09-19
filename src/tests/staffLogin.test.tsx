import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Regression coverage for "staff cannot log in". Three independent root
 * causes were found and fixed; this test pins each fix so it cannot silently
 * regress:
 *
 *  1. The Prisma schema was missing `RestaurantUser.lastLoginAt`, while the
 *     /auth/pin route writes it WITHOUT a catch guard — Prisma threw a
 *     client-side validation error and EVERY staff PIN login died with a 500
 *     after the password check had already passed.
 *  2. Logged-out workers on the public landing page had no tenant directory
 *     (it loads post-auth), so the PIN tab could never pick a restaurant and
 *     refused to submit with "اختر المطعم أولاً".
 *  3. The PIN pad auto-submitted at exactly 4 digits, so workers whose
 *     manager assigned a 5–6 digit PIN (schema allows 4–10) could never type
 *     it and locked themselves out through repeated 401s.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const schema = read('../../prisma/schema.prisma');
const authRoutes = read('../../server/routes/auth.ts');
const loginModal = read('../components/auth/LoginModal.tsx');

describe('staff PIN login — server schema parity', () => {
  it('declares RestaurantUser.lastLoginAt so the PIN route write cannot 500', () => {
    const userModel = schema.match(/model RestaurantUser \{[\s\S]*?\n\}/)?.[0] || '';
    expect(userModel).toContain('lastLoginAt');
    expect(userModel).toMatch(/lastLoginAt\s+DateTime\?/);
  });

  it('ships a migration that adds the column idempotently', () => {
    const migrationsDir = fileURLToPath(new URL('../../prisma/migrations', import.meta.url));
    const folders = readdirSync(migrationsDir).sort();
    // Newer migrations (e.g. restaurant geo/media) may land after it, so we
    // assert presence rather than "latest" — the column migration must still
    // exist with an idempotent ADD COLUMN IF NOT EXISTS.
    expect(folders).toContain('20260910143000_add_last_login_at');

    const sql = readFileSync(`${migrationsDir}/20260910143000_add_last_login_at/migration.sql`, 'utf8');
    expect(sql).toMatch(/ALTER TABLE "RestaurantUser" ADD COLUMN IF NOT EXISTS "lastLoginAt"/);
  });

  it('keeps the intent: employee login still records the login timestamp', () => {
    // 2026-09 auth redesign: the legacy 4-digit /auth/pin route was replaced
    // by /auth/employee-login (restaurant code + username + 6-digit PIN).
    // Both login routes share issueSession(), which performs the
    // lastLoginAt write — the original 500 regression cannot recur silently.
    expect(authRoutes).toContain("'/employee-login'");
    expect(authRoutes).toContain('issueSession');
    const issueSessionFn = authRoutes.match(/async function issueSession\([\s\S]*?\n\}/)?.[0] || '';
    expect(issueSessionFn).toContain('lastLoginAt');
    // The legacy 4-digit PIN route is gone entirely.
    expect(authRoutes).not.toContain("'/pin'");
  });
});

describe('employee login — client entry paths (2026-09 redesign)', () => {
  it('lets a logged-out worker identify their venue by restaurant code input', () => {
    expect(loginModal).toContain('restaurantCodeInput');
    expect(loginModal).toContain('WORKER_REST_CODE_KEY');
    expect(loginModal).toContain('رمز المطعم');
  });

  it('collects a per-tenant username next to the restaurant code', () => {
    expect(loginModal).toContain('usernameInput');
    expect(loginModal).toContain('WORKER_USERNAME_KEY');
    expect(loginModal).toContain('اسم المستخدم');
  });

  it('exposes NO public restaurant dropdown (tenant listing removed from login)', () => {
    expect(loginModal).not.toContain('tenantsList.map');
    expect(loginModal).not.toContain('<select');
  });

  it('never auto-submits the PIN pad at 4 digits (5–6 digit PINs must be typable)', () => {
    const keyPress = loginModal.match(/const handlePinKeyPress =[\s\S]*?\};/)?.[0] || '';
    expect(keyPress).not.toContain('handlePinSubmit');
  });
});
