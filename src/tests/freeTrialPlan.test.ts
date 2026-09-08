import { describe, expect, it } from 'vitest';
import {
  FREE_TRIAL_DAYS,
  FREE_TRIAL_PLAN,
  FREE_TRIAL_PLAN_ID,
  TRIAL_BILLING_PERIOD,
  TRIAL_ENTITLEMENTS,
  evaluateTrialActivation,
  isTrialPlan,
  trialDaysFor,
  trialDaysRemaining,
  trialWindow,
  withTrialMeta,
} from '../../server/services/plans';
import { daysUntil } from '../utils/formatting';

const DAY = 86_400_000;
const PAID_STARTER = {
  id: 'plan-starter',
  billingPeriod: 'monthly',
  maxTables: 15,
  maxCategories: 6,
  maxProducts: 35,
};

describe('the free trial plan definition', () => {
  it('is free, lasts 7 days and is marked as a trial in the catalog', () => {
    expect(FREE_TRIAL_PLAN.priceMonthly).toBe(0);
    expect(FREE_TRIAL_PLAN.priceYearly).toBe(0);
    expect(FREE_TRIAL_PLAN.billingPeriod).toBe(TRIAL_BILLING_PERIOD);
    expect(FREE_TRIAL_DAYS).toBe(7);
    expect(isTrialPlan(FREE_TRIAL_PLAN)).toBe(true);
  });

  it('grants only the core ordering entitlement', () => {
    expect(TRIAL_ENTITLEMENTS).toEqual(['CAN_USE_ADVANCED_FEATURES']);
    expect(FREE_TRIAL_PLAN.entitlements).toEqual(TRIAL_ENTITLEMENTS);

    // Everything a paid plan adds stays locked during the trial.
    const locked = [
      'CAN_USE_ANALYTICS',
      'CAN_CUSTOM_BRANDING',
      'CAN_CREATE_BRANCH',
      'CAN_EXPORT_REPORTS',
      'CAN_UNLIMITED_TABLES',
      'CAN_PRIORITY_SUPPORT',
      'CAN_USE_CUSTOM_DOMAIN',
    ];
    for (const key of locked) {
      expect(FREE_TRIAL_PLAN.entitlements, `${key} must stay locked`).not.toContain(key);
    }
  });

  it('caps usage below the cheapest paid plan', () => {
    expect(FREE_TRIAL_PLAN.maxTables).toBeLessThan(PAID_STARTER.maxTables);
    expect(FREE_TRIAL_PLAN.maxCategories).toBeLessThan(PAID_STARTER.maxCategories);
    expect(FREE_TRIAL_PLAN.maxProducts).toBeLessThan(PAID_STARTER.maxProducts);
  });
});

describe('trial plan detection', () => {
  it('recognizes the trial by id or by billing period, and nothing else', () => {
    expect(isTrialPlan({ id: FREE_TRIAL_PLAN_ID })).toBe(true);
    expect(isTrialPlan({ id: 'plan-x', billingPeriod: TRIAL_BILLING_PERIOD })).toBe(true);
    expect(isTrialPlan(PAID_STARTER)).toBe(false);
    expect(isTrialPlan(null)).toBe(false);
    expect(isTrialPlan(undefined)).toBe(false);
  });

  it('exposes the trial length to clients instead of hardcoding it', () => {
    expect(trialDaysFor(FREE_TRIAL_PLAN)).toBe(7);
    expect(trialDaysFor(PAID_STARTER)).toBe(0);
    expect(withTrialMeta(FREE_TRIAL_PLAN).trialDays).toBe(7);
    expect(withTrialMeta(PAID_STARTER).trialDays).toBe(0);
  });
});

describe('the 7-day window', () => {
  it('spans exactly seven days from activation', () => {
    const from = new Date('2026-09-08T12:00:00.000Z');
    const { start, end } = trialWindow(from);
    expect(start.toISOString()).toBe('2026-09-08T12:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(7 * DAY);
  });

  it('counts whole days remaining and never goes negative', () => {
    const now = Date.parse('2026-09-08T12:00:00.000Z');
    expect(trialDaysRemaining(new Date(now + 6.5 * DAY).toISOString(), now)).toBe(7);
    expect(trialDaysRemaining(new Date(now + 3 * DAY).toISOString(), now)).toBe(3);
    expect(trialDaysRemaining(new Date(now - DAY).toISOString(), now)).toBe(0);
    expect(trialDaysRemaining(null, now)).toBe(0);
    expect(daysUntil(new Date(now + 2 * DAY).toISOString(), now)).toBe(2);
    expect(daysUntil(undefined, now)).toBe(0);
  });
});

describe('one free trial per tenant, granted by the platform admin', () => {
  it('allows a brand new tenant', () => {
    expect(evaluateTrialActivation(null)).toEqual({ allowed: true });
    expect(evaluateTrialActivation(undefined)).toEqual({ allowed: true });
  });

  it('allows a paying tenant that never trialed', () => {
    expect(evaluateTrialActivation({ planId: 'plan-pro', status: 'ACTIVE', trialEndsAt: null })).toEqual({
      allowed: true,
    });
  });

  it('refuses while a trial is still running', () => {
    const verdict = evaluateTrialActivation({
      planId: FREE_TRIAL_PLAN_ID,
      status: 'TRIAL',
      trialEndsAt: new Date(Date.now() + 4 * DAY).toISOString(),
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.statusCode).toBe(409);
      expect(verdict.reason).toContain('4');
    }
  });

  it('refuses a tenant that already consumed its trial', () => {
    const verdict = evaluateTrialActivation({
      planId: 'plan-starter',
      status: 'ACTIVE',
      trialEndsAt: new Date(Date.now() - 30 * DAY).toISOString(),
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.statusCode).toBe(410);
      expect(verdict.reason).toContain('مسبقاً');
    }
  });
});
