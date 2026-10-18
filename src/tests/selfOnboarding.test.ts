import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FREE_PLAN,
  FREE_PLAN_ID,
  FREE_BILLING_PERIOD,
  isFreePlan,
  isTrialPlan,
  effectiveSubscriptionState,
  dueStatusTransition,
} from '../../server/services/plans';
import {
  SELF_ONBOARD_TABLE_COUNTS,
  selfOnboardSchema,
  registerSchema,
  onboardingVerifySchema,
} from '../../server/validation/schemas';
import {
  ProvisioningError,
  buildInitialTables,
  generateUniqueSlug,
  slugifyRestaurantName,
  isDisposableEmail,
  normalizeVerificationPhone,
  buildVerificationReference,
  computeRestaurantVerificationCode,
  verifyRestaurantActivationCode,
} from '../../server/services/restaurantProvisioning';

/**
 * Self-service onboarding — pure-rule suite (no DB required, runs in the
 * default `npm test` layer and in CI's DB-less unit job).
 *
 * Pins, in order: the permanent-free plan definition (never a trial), the
 * lifecycle rules for free rows (and the UNTOUCHED behavior of paid/trial
 * rows), the catalog triple equality (plans.ts ⇄ seed.ts ⇄ migration SQL),
 * the closed validation surface of the two new schemas, and the shared
 * provisioning conventions (slug rules + table numbering/QR format identical
 * to the admin onboarding and manager table-create paths).
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// ---------------------------------------------------------------
// 1. The permanent free plan
// ---------------------------------------------------------------
describe('permanent free plan definition', () => {
  it('is free, permanent, and NOT a trial', () => {
    expect(FREE_PLAN.id).toBe(FREE_PLAN_ID);
    expect(FREE_PLAN.billingPeriod).toBe(FREE_BILLING_PERIOD);
    expect(FREE_PLAN.priceMonthly).toBe(0);
    expect(FREE_PLAN.priceYearly).toBe(0);
    expect(isTrialPlan(FREE_PLAN)).toBe(false);
    expect(isFreePlan(FREE_PLAN)).toBe(true);
    expect(isFreePlan({ id: 'plan-trial-7d' })).toBe(false);
    expect(isTrialPlan({ id: FREE_PLAN_ID })).toBe(false);
    expect(isFreePlan(null)).toBe(false);
  });

  it('carries exactly the approved launch ceilings', () => {
    // 20 tables = the largest closed self-service choice; content limits
    // mirror Starter (6/35) so the free tier never exceeds a paid tier.
    expect(FREE_PLAN.maxTables).toBe(20);
    expect(FREE_PLAN.maxCategories).toBe(6);
    expect(FREE_PLAN.maxProducts).toBe(35);
    expect(FREE_PLAN.maxBranches).toBe(1);
  });

  it('grants only the core-ordering label — never a paid entitlement', () => {
    expect(FREE_PLAN.entitlements).toEqual(['CAN_USE_ADVANCED_FEATURES']);
    for (const paid of [
      'CAN_USE_ANALYTICS',
      'CAN_CUSTOM_BRANDING',
      'CAN_CREATE_BRANCH',
      'CAN_EXPORT_REPORTS',
      'CAN_PRIORITY_SUPPORT',
      'CAN_USE_CUSTOM_DOMAIN',
    ]) {
      expect(FREE_PLAN.entitlements).not.toContain(paid);
    }
  });

  it('is wired into the seed catalog and an idempotent data-only migration', () => {
    const seed = read('../../server/db/seed.ts');
    expect(seed).toContain('FREE_PLAN,');
    const migration = read(
      '../../prisma/migrations/20261018120000_add_plan_free/migration.sql'
    );
    expect(migration).toContain('ON CONFLICT ("id") DO NOTHING');
    // Never a schema change — data only.
    expect(migration).not.toMatch(/ALTER TABLE|CREATE TABLE|DROP /);
    // Values must match the TS definition exactly (catalog triple equality):
    // the VALUES tuple lines of the INSERT must read, in order:
    // id, name, nameEn, 0, 0, 'free', 20, 6, 35, 1, [CAN_USE_ADVANCED_FEATURES], description.
    const valuesBlock = [
      `    '${FREE_PLAN.id}',`,
      `    '${FREE_PLAN.name}',`,
      `    '${FREE_PLAN.nameEn}',`,
      '    0,',
      '    0,',
      `    '${FREE_PLAN.billingPeriod}',`,
      `    ${FREE_PLAN.maxTables},`,
      `    ${FREE_PLAN.maxCategories},`,
      `    ${FREE_PLAN.maxProducts},`,
      `    ${FREE_PLAN.maxBranches},`,
      "    ARRAY['CAN_USE_ADVANCED_FEATURES']::TEXT[],",
      `    '${FREE_PLAN.description}',`,
    ].join('\n');
    expect(migration).toContain(valuesBlock);
    expect(migration).toContain(`'${FREE_PLAN.description}'`);
    expect(migration).toContain(`'${FREE_PLAN.nameEn}'`);
    expect(migration).toContain(`'${FREE_PLAN.name}'`);
  });
});

// ---------------------------------------------------------------
// 2. Subscription lifecycle: free is perpetual; nothing else drifts
// ---------------------------------------------------------------
describe('subscription lifecycle rules for the free plan', () => {
  const past = new Date(Date.now() - 40 * 86_400_000).toISOString();

  it('keeps a free tenant entitled even with a past period end', () => {
    const state = effectiveSubscriptionState({
      status: 'ACTIVE',
      currentPeriodEnd: past,
      plan: { billingPeriod: 'free' },
    });
    expect(state.entitled).toBe(true);
    expect(state.effectiveStatus).toBe('ACTIVE');
    expect(state.daysPastDue).toBe(0);
  });

  it('honours the flattened billingPeriod form as well', () => {
    const state = effectiveSubscriptionState({
      status: 'ACTIVE',
      currentPeriodEnd: past,
      billingPeriod: 'free',
    });
    expect(state.entitled).toBe(true);
  });

  it('still respects terminal states on free rows (explicit cancel wins)', () => {
    const cancelled = effectiveSubscriptionState({
      status: 'CANCELLED',
      currentPeriodEnd: past,
      plan: { billingPeriod: 'free' },
    });
    expect(cancelled.entitled).toBe(false);
  });

  it('never expires a free row through the scheduler transitions', () => {
    expect(
      dueStatusTransition(
        { status: 'ACTIVE', currentPeriodEnd: past, plan: { billingPeriod: 'free' } },
        new Date()
      )
    ).toBeNull();
  });

  it('leaves paid and trial behavior byte-identical', () => {
    const withinGrace = new Date(Date.now() - 3 * 86_400_000).toISOString();
    // Paid ACTIVE within the grace window -> PAST_DUE but still entitled.
    const paid = effectiveSubscriptionState({
      status: 'ACTIVE',
      currentPeriodEnd: withinGrace,
      plan: { billingPeriod: 'monthly' },
    });
    expect(paid.effectiveStatus).toBe('PAST_DUE');
    expect(paid.entitled).toBe(true);
    // Paid beyond the 7-day grace -> cancelled (unchanged legacy rule).
    expect(
      effectiveSubscriptionState({
        status: 'ACTIVE',
        currentPeriodEnd: past,
        plan: { billingPeriod: 'monthly' },
      }).effectiveStatus
    ).toBe('CANCELLED');
    // Trial past its end -> cancelled immediately.
    const trial = effectiveSubscriptionState({
      status: 'TRIAL',
      currentPeriodEnd: past,
      trialEndsAt: past,
      plan: { billingPeriod: 'trial' },
    });
    expect(trial.effectiveStatus).toBe('CANCELLED');
    expect(trial.entitled).toBe(false);
    // Scheduler still moves paid rows.
    expect(
      dueStatusTransition({ status: 'ACTIVE', currentPeriodEnd: withinGrace }, new Date())
    ).toBe('PAST_DUE');
    // No subscription at all -> not entitled (FREE_LIMITS fallback).
    expect(effectiveSubscriptionState(null).entitled).toBe(false);
  });
});

// ---------------------------------------------------------------
// 3. Closed validation surface
// ---------------------------------------------------------------
describe('selfOnboardSchema', () => {
  it('accepts exactly 10, 15 and 20', () => {
    expect(SELF_ONBOARD_TABLE_COUNTS).toEqual([10, 15, 20]);
    for (const count of SELF_ONBOARD_TABLE_COUNTS) {
      const res = selfOnboardSchema.safeParse({ name: 'مطعم الياسمين', tablesCount: count });
      expect(res.success, `count ${count}`).toBe(true);
    }
  });

  it('rejects every other count and every wrong type', () => {
    for (const bad of [9, 11, 0, 500, 1.5, '10', 20.0001, null, undefined, [20]]) {
      const res = selfOnboardSchema.safeParse({ name: 'X Restaurant', tablesCount: bad });
      expect(res.success, `count ${String(bad)}`).toBe(false);
    }
  });

  it('rejects empty or oversized names', () => {
    expect(selfOnboardSchema.safeParse({ name: '   ', tablesCount: 10 }).success).toBe(false);
    expect(
      selfOnboardSchema.safeParse({ name: 'أ'.repeat(121), tablesCount: 10 }).success
    ).toBe(false);
  });

  it('rejects client-supplied privileged keys (.strict())', () => {
    for (const smuggled of [
      { planId: 'plan-pro' },
      { restaurantId: 'rest-other' },
      { logoUrl: 'https://evil.example/x.png' },
      { categories: [{ name: 'x' }] },
      { products: [{ name: 'x', price: 1 }] },
      { role: 'PLATFORM_ADMIN' },
      { status: 'SUSPENDED' },
      { slug: 'stolen-slug' },
      { tablesCount: 10, maxTables: 9999 },
    ]) {
      const res = selfOnboardSchema.safeParse({ name: 'Rest', ...smuggled });
      expect(res.success, JSON.stringify(smuggled)).toBe(false);
    }
  });
});

describe('registerSchema', () => {
  it('normalizes email and requires the platform password policy', () => {
    const res = registerSchema.parse({
      name: ' عمر ',
      email: ' Owner@Example.COM ',
      password: 'Str0ng-Pass!2026',
    });
    expect(res.email).toBe('owner@example.com');
    expect(
      registerSchema.safeParse({ name: 'O', email: 'o@e.com', password: 'short1!' }).success
    ).toBe(false); // < 8
    expect(
      registerSchema.safeParse({ name: 'O', email: 'o@e.com', password: 'password123' }).success
    ).toBe(false); // blocklisted
    expect(
      registerSchema.safeParse({ name: 'O', email: 'not-an-email', password: 'Str0ng-Pass!2026' })
        .success
    ).toBe(false);
  });

  it('rejects role/status/restaurantId smuggling and unknown keys', () => {
    for (const smuggled of [
      { role: 'PLATFORM_ADMIN' },
      { status: 'ACTIVE' },
      { restaurantId: 'rest-x' },
      { planId: 'plan-pro' },
      { email: 'a@b.c ', name2: 'x' },
    ]) {
      expect(
        registerSchema.safeParse({
          name: 'Owner',
          email: 'owner@venue.com',
          password: 'Str0ng-Pass!2026',
          ...smuggled,
        }).success,
        JSON.stringify(smuggled)
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------
// 4. Provisioning rules (slug + table builder)
// ---------------------------------------------------------------
describe('slugifyRestaurantName', () => {
  it('handles Latin names like the admin wizard does', () => {
    expect(slugifyRestaurantName('Orchid Fine Dining')).toBe('orchid-fine-dining');
    expect(slugifyRestaurantName('Café  Élégance!')).toBe('cafe-elegance');
    expect(slugifyRestaurantName('  --Weird___name??--  ')).toBe('weird-name');
  });

  it('yields an empty slug for purely Arabic names (caller falls back)', () => {
    expect(slugifyRestaurantName('مطعم الأوركيد الفاخر')).toBe('');
    expect(slugifyRestaurantName('مَطْعَم اليَاسمين')).toBe('');
  });

  it('caps length and never ends on a dash', () => {
    const long = slugifyRestaurantName('a'.repeat(120));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('-')).toBe(false);
  });
});

describe('generateUniqueSlug', () => {
  it('prefers the exact name slug', async () => {
    const taken = new Set<string>();
    const slug = await generateUniqueSlug('Orchid', async (s) => taken.has(s));
    expect(slug).toBe('orchid');
  });

  it('walks bounded numeric suffixes on collisions', async () => {
    const taken = new Set(['orchid', 'orchid-2', 'orchid-3']);
    const slug = await generateUniqueSlug('Orchid', async (s) => taken.has(s));
    expect(slug).toBe('orchid-4');
  });

  it('falls back to the restaurant-* family for Arabic-only names', async () => {
    let calls = 0;
    const slug = await generateUniqueSlug('مطعم الياسمين الفاخر', async () => {
      calls += 1;
      // 'restaurant' taken -> the loop moves to restaurant-2 … (bounded)
      return calls === 1;
    });
    expect(slug === 'restaurant-2' || slug === 'restaurant').toBe(true);
    expect(calls).toBeLessThanOrEqual(26); // bounded work, no infinite loop
  });

  it('throws a 409 ProvisioningError when even the random fallbacks clash', async () => {
    await expect(generateUniqueSlug('مطعم', async () => true)).rejects.toBeInstanceOf(
      ProvisioningError
    );
  });
});

describe('buildInitialTables', () => {
  it('produces exactly the requested closed counts with platform conventions', () => {
    for (const count of [10, 15, 20]) {
      const rows = buildInitialTables('rest-orchid', count);
      expect(rows).toHaveLength(count);
      expect(rows.map((r) => r.number)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
      expect(rows.every((r) => r.restaurantId === 'rest-orchid')).toBe(true);
      // ids/numbering match the admin onboarding + manager table-create pattern
      expect(rows[0].id).toBe('rest-orchid-T01');
      expect(count > 9 ? rows[9].id : rows[count - 1].id).toMatch(/-T10$/);
      expect(rows[0].name).toBe('طاولة 01');
      expect(rows[0].capacity).toBe(4);
      expect(rows[0].zone).toBe('MAIN_HALL');
      expect(rows[0].status).toBe('AVAILABLE');
      // QR tokens: opaque, `qr-` prefixed, unique per restaurant batch.
      const tokens = new Set(rows.map((r) => r.qrToken));
      expect(tokens.size).toBe(count);
      expect(rows.every((r) => /^qr-[0-9a-f-]{36}$/.test(r.qrToken))).toBe(true);
      // Deterministic uniqueness of numbers within the tenant.
      expect(new Set(rows.map((r) => r.number)).size).toBe(count);
    }
  });

  it('rejects any count outside 10/15/20 and an empty tenant', () => {
    for (const bad of [9, 11, 0, 500, 1.5, '10']) {
      expect(() => buildInitialTables('rest-x', bad as number)).toThrowError(ProvisioningError);
    }
    expect(() => buildInitialTables('', 10)).toThrowError(ProvisioningError);
  });
});

// ---------------------------------------------------------------
// 5. Triple Free Shield & Official Verification Gate (2026-10)
// ---------------------------------------------------------------
describe('Triple Free Shield — disposable email & phone validation', () => {
  it('blocks disposable and temporary email domains in registerSchema', () => {
    for (const disposable of [
      'bot@mailinator.com',
      'fake@10minutemail.com',
      'spam@yopmail.com',
      'temp@guerrillamail.com',
      'user@sub.tempmail.com',
      'throwaway@trashmail.com',
    ]) {
      expect(isDisposableEmail(disposable)).toBe(true);
      expect(
        registerSchema.safeParse({
          name: 'Fake Owner',
          email: disposable,
          password: 'Str0ng-Pass!2026',
        }).success,
        disposable
      ).toBe(false);
    }

    for (const legitimate of [
      'owner@gmail.com',
      'manager@mureeh.com',
      'info@al-yasmin-restaurant.ps',
    ]) {
      expect(isDisposableEmail(legitimate)).toBe(false);
      expect(
        registerSchema.safeParse({
          name: 'Real Owner',
          email: legitimate,
          password: 'Str0ng-Pass!2026',
        }).success,
        legitimate
      ).toBe(true);
    }
  });

  it('normalizes official verification phone numbers and rejects invalid ones', () => {
    expect(normalizeVerificationPhone('0599 123 456')).toBe('+970599123456');
    expect(normalizeVerificationPhone('+972-56-904-9704')).toBe('+972569049704');
    expect(normalizeVerificationPhone('00970599112233')).toBe('+970599112233');
    expect(normalizeVerificationPhone('0000000000')).toBeNull();
    expect(normalizeVerificationPhone('12345')).toBeNull();
    expect(normalizeVerificationPhone('<script>alert(1)</script>')).toBeNull();

    expect(
      selfOnboardSchema.safeParse({
        name: 'مطعم الياسمين',
        tablesCount: 15,
        phone: '+970 599 123 456',
      }).success
    ).toBe(true);

    expect(
      selfOnboardSchema.safeParse({
        name: 'مطعم الياسمين',
        tablesCount: 15,
        phone: '0000000000',
      }).success
    ).toBe(false);
  });

  it('generates deterministic 6-digit HMAC activation codes and verifies in constant time', () => {
    const ref = buildVerificationReference('rest-al-yasmin');
    expect(ref).toMatch(/^MRH-[A-Z0-9]{6}$/);

    const code = computeRestaurantVerificationCode('rest-al-yasmin', 'test-secret-key');
    expect(code).toMatch(/^\d{6}$/);
    expect(computeRestaurantVerificationCode('rest-al-yasmin', 'test-secret-key')).toBe(code);
    expect(computeRestaurantVerificationCode('rest-other', 'test-secret-key')).not.toBe(code);

    expect(verifyRestaurantActivationCode('rest-al-yasmin', code, 'test-secret-key')).toBe(true);
    expect(verifyRestaurantActivationCode('rest-al-yasmin', '000000', 'test-secret-key')).toBe(
      code === '000000'
    );
    expect(verifyRestaurantActivationCode('rest-al-yasmin', '12345', 'test-secret-key')).toBe(
      false
    );

    expect(onboardingVerifySchema.safeParse({ code }).success).toBe(true);
    expect(onboardingVerifySchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(onboardingVerifySchema.safeParse({ code, extra: 1 }).success).toBe(false);
  });

  it('separates restaurant registration from LoginModal into the standalone /onboard page', () => {
    const loginModal = read('../components/auth/LoginModal.tsx');
    const standaloneOnboard = read('../components/onboarding/OwnerSelfOnboarding.tsx');
    const landingPage = read('../components/common/SaaSLandingPage.tsx');

    // LoginModal is strictly for signing in (no REGISTER tab inside LoginModal)
    expect(loginModal).not.toContain('أنشئ مطعمك');
    expect(loginModal).toContain('اضغط لتدشين مطعمك');
    expect(loginModal).toContain("setViewMode('ONBOARDING')");

    // Standalone onboarding page handles all 4 steps including owner account registration
    expect(standaloneOnboard).toContain('1. حساب المالك');
    expect(standaloneOnboard).toContain('2. بيانات المطعم');
    expect(standaloneOnboard).toContain('3. الطاولات');
    expect(standaloneOnboard).toContain('4. بوابة التحقق');

    // SaaSLandingPage button navigates to the standalone ONBOARDING page
    expect(landingPage).toContain('اضغط لتدشين مطعمك');
    expect(landingPage).toContain("setViewMode('ONBOARDING')");
  });
});
