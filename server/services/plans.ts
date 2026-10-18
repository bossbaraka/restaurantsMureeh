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
 * Permanent FREE plan (self-service onboarding, 2026-10).
 *
 * This is deliberately NOT the 7-day trial: no `trialEndsAt`, no expiry.
 * A tenant on `plan-free` is entitled forever (subject to the ordinary
 * CANCELLED/SUSPENDED subscription states and platform tenant suspension),
 * within the plan's usage ceilings. `billingPeriod: 'free'` is the marker
 * consumed by the subscription lifecycle so a free row can never drift into
 * PAST_DUE/CANCELLED through period-end rules.
 */
export const FREE_PLAN_ID = 'plan-free';
export const FREE_BILLING_PERIOD = 'free';

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
  maxBranches: number;
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
  // A trial tenant is a single venue — no branches, so the platform never
  // absorbs multi-location cost during a free window.
  maxBranches: 1,
  entitlements: [...TRIAL_ENTITLEMENTS],
  description:
    'تجربة مجانية لمدة 7 أيام بصلاحيات محدودة (8 طاولات، 3 تصنيفات، 15 طبقاً). تُنشَّط حصرياً من قِبل إدارة المنصة.',
  isPopular: false,
};

/**
 * What the free plan unlocks: the core digital menu + QR ordering flow,
 * forever. It carries EXACTLY the same entitlement keys as the trial and
 * Starter (verified: no server route gates on CAN_USE_ADVANCED_FEATURES;
 * it is the catalog's "core ordering" label in the manager's subscription
 * screen). Analytics, custom branding, exports, branches and custom domains
 * stay locked — those keys are the ones actually enforced server-side.
 */
export const FREE_PLAN: TrialPlanDefinition = {
  id: FREE_PLAN_ID,
  name: 'الخطة المجانية الدائمة',
  nameEn: 'Permanent Free Plan',
  priceMonthly: 0,
  priceYearly: 0,
  billingPeriod: FREE_BILLING_PERIOD,
  // Ceilings approved for the self-service launch tier: 20 tables (the
  // largest initial table choice), and the Starter catalog content limits
  // so the free tier never exceeds a paid tier.
  maxTables: 20,
  maxCategories: 6,
  maxProducts: 35,
  maxBranches: 1,
  entitlements: [...TRIAL_ENTITLEMENTS],
  description:
    'خطة مجانية دائمة للمطاعم التي تُسجّل ذاتياً: منيو رقمي كامل وطلبات QR حتى 20 طاولة.',
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

/**
 * Permanent free plan? Independent of the trial on purpose: a free row must
 * never be treated as expiring, and a trial must never be promoted to free.
 */
export function isFreePlan(plan?: PlanLike | null): boolean {
  if (!plan) return false;
  return plan.id === FREE_PLAN_ID || plan.billingPeriod === FREE_BILLING_PERIOD;
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

// ============================================================
// Self-service plan-change authorization (audit H-02)
// ------------------------------------------------------------
// A tenant manager must never be able to grant themselves a more
// expensive plan by POSTing a planId: there is no payment provider in
// this deployment, so an "upgrade" would be a free entitlement grant
// (Enterprise = multi-branch, analytics, exports, custom domain).
//
// Rule: tenants may move to a plan costing the same or less (downgrade /
// lateral). Anything that increases the price is a commercial action that
// only platform staff can complete, after payment is settled out-of-band.
// ============================================================

export interface PricedPlanLike extends PlanLike {
  name?: string;
  priceMonthly?: number | null;
}

export type PlanChangeVerdict =
  | { allowed: true; kind: 'downgrade' | 'lateral' | 'platform-override' }
  | { allowed: false; statusCode: 402 | 403; reason: string };

/** Monthly price of a plan, defaulting to 0 for malformed rows. */
export function planPrice(plan?: PricedPlanLike | null): number {
  const price = Number(plan?.priceMonthly ?? 0);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

/**
 * Decides whether an actor may switch a tenant from `current` to `target`.
 *
 * Platform staff always pass (they complete paid upgrades manually once
 * payment clears). Tenant actors may never increase spend.
 */
export function evaluatePlanChange(params: {
  current?: PricedPlanLike | null;
  target: PricedPlanLike;
  isPlatformActor: boolean;
}): PlanChangeVerdict {
  const { current, target, isPlatformActor } = params;

  if (isPlatformActor) return { allowed: true, kind: 'platform-override' };

  // The free trial is a platform grant, never self-service.
  if (isTrialPlan(target)) {
    return {
      allowed: false,
      statusCode: 403,
      reason: `الباقة التجريبية المجانية (${FREE_TRIAL_DAYS} أيام) تُنشَّط حصرياً من قِبل إدارة المنصة`,
    };
  }

  const currentPrice = planPrice(current);
  const targetPrice = planPrice(target);

  if (targetPrice > currentPrice) {
    return {
      allowed: false,
      statusCode: 402,
      reason:
        'ترقية الباقة تتطلب إتمام الدفع عبر إدارة المنصة. تم تسجيل طلبك وسيتم التواصل معك لإتمام الاشتراك.',
    };
  }

  return {
    allowed: true,
    kind: targetPrice === currentPrice ? 'lateral' : 'downgrade',
  };
}

// ============================================================
// Subscription period lifecycle (audit P1-15)
// ------------------------------------------------------------
// A subscription row must not stay ACTIVE forever past its
// `currentPeriodEnd`. No payment gateway exists in this deployment, so this
// module models the lifecycle as PURE rules that are (a) enforced lazily on
// every entitlement read (no cron required) and (b) persisted by a callable
// service (`subscriptionLifecycle.processExpiringSubscriptions`) that a
// scheduled Render Cron Job can invoke later.
//
//   ACTIVE past period end            -> PAST_DUE  (grace window)
//   PAST_DUE past the grace window    -> CANCELLED (free limits)
//   TRIAL past trial/period end       -> CANCELLED (no payment on file)
// ============================================================

/** Default grace days between period end and full entitlement downgrade. */
export const DEFAULT_PAST_DUE_GRACE_DAYS = 7;

export interface EffectiveSubscriptionInput {
  status?: string | null;
  currentPeriodEnd?: Date | string | null;
  trialEndsAt?: Date | string | null;
  /**
   * The bound plan's billingPeriod. Two accepted shapes (no call-site
   * reshaping): the nested `plan` relation as loaded by every consumer
   * (`include`/`select: { plan: { billingPeriod } }`), or a flattened field
   * for direct callers. 'free' marks the permanent self-service plan, which
   * must be entitled regardless of any period-end value on the row.
   */
  billingPeriod?: string | null;
  plan?: { billingPeriod?: string | null } | null;
}

/**
 * True when a subscription input carries the permanent-free marker. The
 * period-end arithmetic below must never expire such a row; terminal states
 * (CANCELLED / SUSPENDED) still win, because those are explicit actions.
 */
function isFreeSubscription(sub: EffectiveSubscriptionInput): boolean {
  const period = sub.billingPeriod ?? sub.plan?.billingPeriod ?? null;
  return period === FREE_BILLING_PERIOD;
}

export interface EffectiveSubscriptionState {
  /** Effective status after applying period-end rules (read-only view). */
  effectiveStatus: 'ACTIVE' | 'TRIAL' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED';
  /** Whether paid plan limits/entitlements are still in force right now. */
  entitled: boolean;
  /** Whole days left on the current window (negative when overdue). */
  daysRemaining: number;
  /** Whole days past due since period end (0 before expiry). */
  daysPastDue: number;
}

/**
 * Compute the *effective* state of a subscription at instant `now`.
 *
 * Returns the stored status unchanged for future-dated periods. After expiry:
 * trials end immediately (CANCELLED — no payment method to dun), paid ACTIVE
 * subscriptions enter a finite PAST_DUE grace and then become CANCELLED.
 */
export function effectiveSubscriptionState(
  sub: EffectiveSubscriptionInput | null | undefined,
  now: Date | number = new Date(),
  graceDays: number = DEFAULT_PAST_DUE_GRACE_DAYS
): EffectiveSubscriptionState {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const dayMs = 86_400_000;

  if (!sub || !sub.status) {
    return { effectiveStatus: 'CANCELLED', entitled: false, daysRemaining: 0, daysPastDue: 0 };
  }

  if (sub.status === 'SUSPENDED' || sub.status === 'CANCELLED') {
    return {
      effectiveStatus: sub.status as 'SUSPENDED' | 'CANCELLED',
      entitled: false,
      daysRemaining: 0,
      daysPastDue: 0,
    };
  }

  // Permanent free plan: entitled forever, no expiry arithmetic. Placed AFTER
  // the terminal-state block so an explicit cancel/suspend still takes effect.
  // Paid plans and trials fall through untouched — this branch is new-only.
  if (isFreeSubscription(sub)) {
    return { effectiveStatus: 'ACTIVE', entitled: true, daysRemaining: 0, daysPastDue: 0 };
  }

  const isTrial = sub.status === 'TRIAL';
  const endMs = toTime(isTrial ? sub.trialEndsAt ?? sub.currentPeriodEnd : sub.currentPeriodEnd);

  if (endMs === null) {
    // No defined window: trust explicit ACTIVE rows created out of band,
    // never trials (a trial without an end is invalid).
    return {
      effectiveStatus: (sub.status as 'ACTIVE') || 'ACTIVE',
      entitled: !isTrial,
      daysRemaining: 0,
      daysPastDue: 0,
    };
  }

  const daysRemaining = Math.ceil((endMs - nowMs) / dayMs);
  const daysPastDue = Math.max(0, Math.floor((nowMs - endMs) / dayMs));

  if (nowMs <= endMs) {
    return {
      effectiveStatus: isTrial ? 'TRIAL' : 'ACTIVE',
      entitled: true,
      daysRemaining,
      daysPastDue: 0,
    };
  }

  if (isTrial) {
    // No payment instrument on file — no grace extension for trials.
    return { effectiveStatus: 'CANCELLED', entitled: false, daysRemaining: 0, daysPastDue };
  }

  if (daysPastDue <= graceDays) {
    return { effectiveStatus: 'PAST_DUE', entitled: true, daysRemaining: 0, daysPastDue };
  }
  return { effectiveStatus: 'CANCELLED', entitled: false, daysRemaining: 0, daysPastDue };
}

/**
 * Persisted status transition a scheduler should write for an expired row.
 * Returns null when the subscription needs no transition at `now`.
 */
export function dueStatusTransition(
  sub: EffectiveSubscriptionInput & { status?: string | null },
  now: Date | number = new Date(),
  graceDays: number = DEFAULT_PAST_DUE_GRACE_DAYS
): 'PAST_DUE' | 'CANCELLED' | null {
  const stored = (sub.status || '').toUpperCase();
  if (stored === 'CANCELLED' || stored === 'SUSPENDED') return null;
  // The scheduler must never expire a permanent-free row (belt AND braces:
  // self-onboard also persists a normal period, so the arithmetic would be
  // the only thing that could ever touch it).
  if (isFreeSubscription(sub)) return null;

  const state = effectiveSubscriptionState(sub, now, graceDays);
  if (state.effectiveStatus === 'PAST_DUE' && stored !== 'PAST_DUE') return 'PAST_DUE';
  if (state.effectiveStatus === 'CANCELLED' && stored !== 'CANCELLED') return 'CANCELLED';
  return null;
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
