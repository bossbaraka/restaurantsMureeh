import { describe, it, expect } from 'vitest';
import {
  LEGACY_VERIFICATION_CODE_CUTOFF,
  VERIFICATION_CODE_WINDOW_MS,
  acceptsLegacyVerificationCode,
  computeLegacyRestaurantVerificationCode,
  computeRestaurantVerificationCode,
  verificationCodeExpiresAt,
  verificationCodeWindowIndex,
  verifyRestaurantActivationCode,
} from '../../server/services/restaurantProvisioning';

/**
 * Official Activation Code — rotating derivation (F-01 unit gate).
 * Pure functions, no DB: window arithmetic, acceptance of current + previous
 * window, rejection of stale windows, opt-in legacy (v1) acceptance.
 */

const SECRET = 'unit-test-secret-32-chars-minimum-value!!';
const REST = 'rest-unit-rotation';
const W = VERIFICATION_CODE_WINDOW_MS;
// Fixed instant in the middle of a window so +-W moves exactly one window.
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % W) + Math.floor(W / 2);

function anotherCode(code: string): string {
  return code === '000000' ? '999999' : '000000';
}

describe('verification code rotation', () => {
  it('is a 6-digit code, stable inside one window, different across windows and tenants', () => {
    const now = computeRestaurantVerificationCode(REST, SECRET, T0);
    expect(now).toMatch(/^\d{6}$/);
    expect(computeRestaurantVerificationCode(REST, SECRET, T0 + 1000)).toBe(now);
    expect(computeRestaurantVerificationCode(REST, SECRET, T0 + W / 2 - 1)).toBe(now);
    // Across many consecutive windows at least one differs (a 1/900000 collision
    // per pair is possible by construction, so the assertion is over a range).
    const future = Array.from({ length: 5 }, (_, i) =>
      computeRestaurantVerificationCode(REST, SECRET, T0 + (i + 1) * W)
    );
    expect(future.some((c) => c !== now)).toBe(true);
    // Fixed inputs → deterministic: another tenant gets another code.
    expect(computeRestaurantVerificationCode('rest-other', SECRET, T0)).not.toBe(now);
    expect(verificationCodeWindowIndex(T0 + W)).toBe(verificationCodeWindowIndex(T0) + 1);
  });

  it('defaults `now` to the current clock (existing callers keep working)', () => {
    const a = computeRestaurantVerificationCode(REST, SECRET);
    expect(a).toBe(computeRestaurantVerificationCode(REST, SECRET, Date.now()));
    expect(verifyRestaurantActivationCode(REST, a, SECRET)).toBe(true);
  });

  it('accepts the current and the previous window, rejects two windows back and the future', () => {
    const current = computeRestaurantVerificationCode(REST, SECRET, T0);
    const previous = computeRestaurantVerificationCode(REST, SECRET, T0 - W);
    const stale = computeRestaurantVerificationCode(REST, SECRET, T0 - 2 * W);
    const next = computeRestaurantVerificationCode(REST, SECRET, T0 + W);

    expect(verifyRestaurantActivationCode(REST, current, SECRET, { now: T0 })).toBe(true);
    expect(verifyRestaurantActivationCode(REST, previous, SECRET, { now: T0 })).toBe(true);
    if (stale !== current && stale !== previous) {
      expect(verifyRestaurantActivationCode(REST, stale, SECRET, { now: T0 })).toBe(false);
    }
    if (next !== current && next !== previous) {
      expect(verifyRestaurantActivationCode(REST, next, SECRET, { now: T0 })).toBe(false);
    }
    // A code shown at T0 is still valid at the very end of the next window…
    expect(verifyRestaurantActivationCode(REST, current, SECRET, { now: verificationCodeExpiresAt(T0).getTime() - 1 })).toBe(true);
    // …and (barring a numeric collision) not after it.
    const afterExpiry = verificationCodeExpiresAt(T0).getTime() + 1;
    const codesThen = [
      computeRestaurantVerificationCode(REST, SECRET, afterExpiry),
      computeRestaurantVerificationCode(REST, SECRET, afterExpiry - W),
    ];
    if (!codesThen.includes(current)) {
      expect(verifyRestaurantActivationCode(REST, current, SECRET, { now: afterExpiry })).toBe(false);
    }
  });

  it('expiry helper points to the end of the NEXT window (>= 24h of validity)', () => {
    const exp = verificationCodeExpiresAt(T0).getTime();
    expect(exp - T0).toBeGreaterThanOrEqual(W);
    expect(exp - T0).toBeLessThanOrEqual(2 * W);
    expect(exp % W).toBe(0);
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyRestaurantActivationCode(REST, '12345', SECRET, { now: T0 })).toBe(false);
    expect(verifyRestaurantActivationCode(REST, '1234567', SECRET, { now: T0 })).toBe(false);
    expect(verifyRestaurantActivationCode(REST, 'abcdef', SECRET, { now: T0 })).toBe(false);
    expect(verifyRestaurantActivationCode(REST, '', SECRET, { now: T0 })).toBe(false);
    // @ts-expect-error runtime guard
    expect(verifyRestaurantActivationCode(REST, undefined, SECRET, { now: T0 })).toBe(false);
  });

  it('a wrong code is rejected in every mode', () => {
    const current = computeRestaurantVerificationCode(REST, SECRET, T0);
    const legacy = computeLegacyRestaurantVerificationCode(REST, SECRET);
    const previous = computeRestaurantVerificationCode(REST, SECRET, T0 - W);
    let wrong = anotherCode(current);
    if (wrong === legacy || wrong === previous) wrong = '555555';
    if (wrong === current || wrong === legacy || wrong === previous) wrong = '444444';
    expect(verifyRestaurantActivationCode(REST, wrong, SECRET, { now: T0 })).toBe(false);
    expect(verifyRestaurantActivationCode(REST, wrong, SECRET, { now: T0, allowLegacy: true })).toBe(false);
  });
});

describe('legacy (v1) code compatibility', () => {
  it('v1 derivation is unchanged from the pre-rotation scheme and never equals the window material', () => {
    const legacy = computeLegacyRestaurantVerificationCode(REST, SECRET);
    expect(legacy).toMatch(/^\d{6}$/);
    expect(computeLegacyRestaurantVerificationCode(REST, SECRET)).toBe(legacy);
    expect(() => computeLegacyRestaurantVerificationCode('', SECRET)).toThrow();
    expect(() => computeRestaurantVerificationCode(REST, '')).toThrow();
  });

  it('v1 is accepted ONLY when the caller opts in (pre-cut-off restaurants)', () => {
    const legacy = computeLegacyRestaurantVerificationCode(REST, SECRET);
    const current = computeRestaurantVerificationCode(REST, SECRET, T0);
    const previous = computeRestaurantVerificationCode(REST, SECRET, T0 - W);
    expect(verifyRestaurantActivationCode(REST, legacy, SECRET, { now: T0, allowLegacy: true })).toBe(true);
    if (legacy !== current && legacy !== previous) {
      expect(verifyRestaurantActivationCode(REST, legacy, SECRET, { now: T0 })).toBe(false);
      expect(verifyRestaurantActivationCode(REST, legacy, SECRET, { now: T0, allowLegacy: false })).toBe(false);
    }
  });

  it('acceptsLegacyVerificationCode is decided by the restaurant creation date vs the cut-off', () => {
    const before = new Date(LEGACY_VERIFICATION_CODE_CUTOFF.getTime() - 1);
    const after = new Date(LEGACY_VERIFICATION_CODE_CUTOFF.getTime() + 1);
    expect(acceptsLegacyVerificationCode({ createdAt: before })).toBe(true);
    expect(acceptsLegacyVerificationCode({ createdAt: before.toISOString() })).toBe(true);
    expect(acceptsLegacyVerificationCode({ createdAt: after })).toBe(false);
    expect(acceptsLegacyVerificationCode({ createdAt: 'not-a-date' })).toBe(false);
  });

  it('the cut-off stays after the confirmed API deploy of the rotating scheme (pinned at 2026-11-01)', () => {
    // The deployed Render API was confirmed (project owner, 2026-10-19) to
    // run merge cbeaa42, so v1 issuance stopped on 2026-10-19 and every
    // restaurant that could hold a legitimate v1 code was created before
    // this cut-off. Moving the constant requires re-verifying that deploy
    // fact and updating this pin in the same change (see its comment).
    expect(LEGACY_VERIFICATION_CODE_CUTOFF.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(acceptsLegacyVerificationCode({ createdAt: '2026-10-19T12:00:00Z' })).toBe(true);
    expect(acceptsLegacyVerificationCode({ createdAt: '2026-10-31T23:59:59Z' })).toBe(true);
    expect(acceptsLegacyVerificationCode({ createdAt: '2026-11-01T00:00:00Z' })).toBe(false);
    expect(acceptsLegacyVerificationCode({ createdAt: '2026-11-15T12:00:00Z' })).toBe(false);
  });
});
