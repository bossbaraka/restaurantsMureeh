/**
 * Free Trial Plan — single source of truth
 * ========================================
 * The platform offers a free 7-day plan with deliberately limited
 * entitlements. It is NEVER self-serve: a restaurant can only get it through
 * the platform admin (`POST /api/admin/restaurants/:id/activate-trial`) or by
 * the admin picking it during onboarding.
 *
 * This module is intentionally dependency-free (no Prisma) so the rules can be
 * unit-tested and imported from routes, the seed and the manager guard.
 */

export const FREE_TRIAL_PLAN_ID = 'plan-trial-7d';

/** Length of the free trial window, in days. */
export const FREE_TRIAL_DAYS = 7;

/** Marks a plan as the free trial in the catalog (`Plan.billingPeriod`). */
export const TRIAL_BILLING_PERIOD = 'trial';

/**
 * What the free trial unlocks: the core digital menu + QR ordering flow only.
 * Analytics, custom branding, multi-branch, exports and custom domains stay
 * locked until the tenant upgrades to a paid plan.
 */
export const TRIAL_ENTITLEMENTS: string[] = ['CAN_USE_ADVANCED_FEATURES'];

export interface TrialPlanDefinition {
  id: string;
  name: string;
  nameEn: string;
  priceMonthly: number;
  priceYearly: number;
  billingPeriod: string;
  maxTables: number;
  maxCategories: number;
  maxProducts: number;
  entitlements: string[];
  description: string;
  isPopular: boolean;
}

export const FREE_TRIAL_PLAN: TrialPlanDefinition = {
  id: FREE_TRIAL_PLAN_ID,
  name: 'الباقة التجريبية المجانية',
  nameEn: 'Free 7-Day Trial',
  priceMonthly: 0,
  priceYearly: 0,
  billingPeriod: TRIAL_BILLING_PERIOD,
  // Tight limits: enough to run a real service, small enough to push an upgrade.
  maxTables: 8,
  maxCategories: 3,
  maxProducts: 15,
  entitlements: [...TRIAL_ENTITLEMENTS],
  description:
    'تجربة مجانية لمدة 7 أيام بصلاحيات محدودة (8 طاولات، 3 تصنيفات، 15 طبقاً). تُنشَّط حصرياً من قِبل إدارة المنصة.',
  isPopular: false,
};

/** Minimal shape this module needs from a plan row. */
export interface PlanLike {
  id: string;
  billingPeriod?: string | null;
}

/** Minimal shape this module needs from a subscription row. */
export interface SubscriptionLike {
  planId?: string | null;
  status?: string | null;
  trialEndsAt?: Date | string | null;
}

export function isTrialPlan(plan?: PlanLike | null): boolean {
  if (!plan) return false;
  return plan.id === FREE_TRIAL_PLAN_ID || plan.billingPeriod === TRIAL_BILLING_PERIOD;
}

/** Trial length for a plan, in days (0 for every paid plan). */
export function trialDaysFor(plan?: PlanLike | null): number {
  return isTrialPlan(plan) ? FREE_TRIAL_DAYS : 0;
}

/** Attaches `trialDays` to a plan row so clients never hardcode the length. */
export function withTrialMeta<T extends PlanLike>(plan: T): T & { trialDays: number } {
  return { ...plan, trialDays: trialDaysFor(plan) };
}

export function toTime(value?: Date | string | null): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** The trial billing window, starting now. */
export function trialWindow(
  from: Date = new Date(),
  days: number = FREE_TRIAL_DAYS
): { start: Date; end: Date } {
  const start = new Date(from.getTime());
  const end = new Date(start.getTime() + days * 86_400_000);
  return { start, end };
}

/** Whole days left on a trial (never negative). */
export function trialDaysRemaining(
  trialEndsAt?: Date | string | null,
  now: number = Date.now()
): number {
  const end = toTime(trialEndsAt);
  if (end === null) return 0;
  return Math.max(0, Math.ceil((end - now) / 86_400_000));
}

export type TrialActivationVerdict =
  | { allowed: true }
  | { allowed: false; statusCode: 409 | 410; reason: string };

/**
 * One free trial per tenant, ever. The nullable `Subscription.trialEndsAt` is
 * the marker: once it has been set, the tenant has consumed its trial —
 * whether it is still running or already expired.
 */
export function evaluateTrialActivation(
  subscription?: SubscriptionLike | null
): TrialActivationVerdict {
  if (!subscription) return { allowed: true };

  const endsAt = toTime(subscription.trialEndsAt);

  if (endsAt !== null && endsAt > Date.now()) {
    const days = trialDaysRemaining(subscription.trialEndsAt);
    return {
      allowed: false,
      statusCode: 409,
      reason: `الفترة التجريبية نشطة بالفعل لهذا المطعم (يتبقى ${days} ${days === 1 ? 'يوم' : 'أيام'})`,
    };
  }

  if (endsAt !== null) {
    return {
      allowed: false,
      statusCode: 410,
      reason: 'استهلك هذا المطعم فترته التجريبية المجانية مسبقاً — يلزم الاشتراك بباقة مدفوعة',
    };
  }

  return { allowed: true };
}
