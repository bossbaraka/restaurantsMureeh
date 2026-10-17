/**
 * Public SaaS plan prices and the 2026 Palestine launch offer.
 *
 * Keep this file dependency-free: it is shared by the marketing UI, the
 * database seed, and pricing tests. The database retains the standard prices;
 * the promotion columns carry the temporary launch rates.
 */
export interface PlanPriceDefinition {
  priceMonthly: number;
  priceYearly: number;
  promoPriceMonthly: number;
  promoPriceYearly: number;
}

export const PLAN_PRICING = {
  starter: {
    priceMonthly: 300,
    priceYearly: 3000,
    promoPriceMonthly: 129,
    promoPriceYearly: 1290,
  },
  pro: {
    priceMonthly: 550,
    priceYearly: 5500,
    promoPriceMonthly: 249,
    promoPriceYearly: 2490,
  },
  enterprise: {
    priceMonthly: 850,
    priceYearly: 8500,
    promoPriceMonthly: 499,
    promoPriceYearly: 4990,
  },
} as const satisfies Record<string, PlanPriceDefinition>;

/** Offer runs through the end of 31 Dec 2026 in Palestine (UTC+02:00 then). */
export const LAUNCH_OFFER = {
  startsAt: '2026-10-17T00:00:00.000Z',
  endsAt: '2026-12-31T22:00:00.000Z',
  endsAtLabelAr: '31 كانون الأول 2026',
  labelAr: 'عرض الإطلاق',
} as const;

export type BillingPeriod = 'monthly' | 'yearly';

export function isLaunchOfferActive(now: number = Date.now()): boolean {
  const startsAt = Date.parse(LAUNCH_OFFER.startsAt);
  const endsAt = Date.parse(LAUNCH_OFFER.endsAt);
  return Number.isFinite(now) && now >= startsAt && now < endsAt;
}

export function getDisplayedPlanPrice(
  pricing: PlanPriceDefinition,
  period: BillingPeriod,
  now: number = Date.now(),
): number {
  if (isLaunchOfferActive(now)) {
    return period === 'monthly' ? pricing.promoPriceMonthly : pricing.promoPriceYearly;
  }
  return period === 'monthly' ? pricing.priceMonthly : pricing.priceYearly;
}

export function getPlanDiscountPercent(pricing: PlanPriceDefinition): number {
  return Math.round((1 - pricing.promoPriceMonthly / pricing.priceMonthly) * 100);
}
