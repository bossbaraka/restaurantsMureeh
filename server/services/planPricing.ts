/**
 * Resolve the plan price a client should show at this moment.
 *
 * The database retains the ordinary list price. The launch amount is exposed
 * only during the plan's own start/end window, so expired offers automatically
 * fall back to the regular catalog price without a cron job or a destructive
 * price rewrite.
 */
export interface PlanPricingLike {
  priceMonthly: number;
  priceYearly: number;
  promoPriceMonthly?: number | null;
  promoPriceYearly?: number | null;
  promoStartsAt?: Date | string | null;
  promoEndsAt?: Date | string | null;
}

export interface CurrentPlanPricing {
  standardPriceMonthly: number;
  standardPriceYearly: number;
  isPromotionActive: boolean;
}

function timestamp(value?: Date | string | null): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function withCurrentPlanPricing<T extends PlanPricingLike>(
  plan: T,
  now: number = Date.now(),
): T & CurrentPlanPricing {
  const standardPriceMonthly = Number(plan.priceMonthly) || 0;
  const standardPriceYearly = Number(plan.priceYearly) || 0;
  const promoPriceMonthly = Number(plan.promoPriceMonthly);
  const promoPriceYearly = Number(plan.promoPriceYearly);
  const startsAt = timestamp(plan.promoStartsAt);
  const endsAt = timestamp(plan.promoEndsAt);
  const hasValidPromoPrices =
    Number.isFinite(promoPriceMonthly) &&
    Number.isFinite(promoPriceYearly) &&
    promoPriceMonthly > 0 &&
    promoPriceYearly > 0 &&
    promoPriceMonthly < standardPriceMonthly &&
    promoPriceYearly < standardPriceYearly;
  const isPromotionActive =
    Number.isFinite(now) &&
    startsAt !== null &&
    endsAt !== null &&
    startsAt < endsAt &&
    now >= startsAt &&
    now < endsAt &&
    hasValidPromoPrices;

  return {
    ...plan,
    priceMonthly: isPromotionActive ? promoPriceMonthly : standardPriceMonthly,
    priceYearly: isPromotionActive ? promoPriceYearly : standardPriceYearly,
    standardPriceMonthly,
    standardPriceYearly,
    isPromotionActive,
  };
}
