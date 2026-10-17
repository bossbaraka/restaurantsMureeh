import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LAUNCH_OFFER, PLAN_PRICING, getPlanDiscountPercent, isLaunchOfferActive } from '../../shared/plan-pricing';
import { withCurrentPlanPricing } from '../../server/services/planPricing';
import { evaluatePlanChange } from '../../server/services/plans';

const asDate = (value: string) => new Date(value);

const starterRow = {
  id: 'plan-starter',
  priceMonthly: PLAN_PRICING.starter.priceMonthly,
  priceYearly: PLAN_PRICING.starter.priceYearly,
  promoPriceMonthly: PLAN_PRICING.starter.promoPriceMonthly,
  promoPriceYearly: PLAN_PRICING.starter.promoPriceYearly,
  promoStartsAt: asDate(LAUNCH_OFFER.startsAt),
  promoEndsAt: asDate(LAUNCH_OFFER.endsAt),
};

describe('launch offer pricing', () => {
  it('uses attractive local launch prices while preserving the regular catalog prices', () => {
    expect(PLAN_PRICING.starter).toEqual({
      priceMonthly: 300,
      priceYearly: 3000,
      promoPriceMonthly: 129,
      promoPriceYearly: 1290,
    });
    expect(PLAN_PRICING.pro).toMatchObject({
      priceMonthly: 550,
      priceYearly: 5500,
      promoPriceMonthly: 249,
      promoPriceYearly: 2490,
    });
    expect(PLAN_PRICING.enterprise).toMatchObject({
      priceMonthly: 850,
      priceYearly: 8500,
      promoPriceMonthly: 499,
      promoPriceYearly: 4990,
    });
  });

  it('activates at the configured start and expires exactly at the end', () => {
    const startsAt = Date.parse(LAUNCH_OFFER.startsAt);
    const endsAt = Date.parse(LAUNCH_OFFER.endsAt);
    expect(isLaunchOfferActive(startsAt - 1)).toBe(false);
    expect(isLaunchOfferActive(startsAt)).toBe(true);
    expect(isLaunchOfferActive(endsAt - 1)).toBe(true);
    expect(isLaunchOfferActive(endsAt)).toBe(false);
    expect(LAUNCH_OFFER.endsAtLabelAr).toBe('31 كانون الأول 2026');
  });

  it('returns the promotional price only inside the saved database window', () => {
    const start = Date.parse(LAUNCH_OFFER.startsAt);
    const end = Date.parse(LAUNCH_OFFER.endsAt);

    expect(withCurrentPlanPricing(starterRow, start - 1)).toMatchObject({
      priceMonthly: 300,
      priceYearly: 3000,
      standardPriceMonthly: 300,
      standardPriceYearly: 3000,
      isPromotionActive: false,
    });
    expect(withCurrentPlanPricing(starterRow, start)).toMatchObject({
      priceMonthly: 129,
      priceYearly: 1290,
      standardPriceMonthly: 300,
      standardPriceYearly: 3000,
      isPromotionActive: true,
    });
    expect(withCurrentPlanPricing(starterRow, end)).toMatchObject({
      priceMonthly: 300,
      priceYearly: 3000,
      isPromotionActive: false,
    });
  });

  it('fails closed for malformed, zero, or non-discount promotional prices', () => {
    expect(
      withCurrentPlanPricing({ ...starterRow, promoPriceMonthly: 300 }, Date.parse(LAUNCH_OFFER.startsAt))
        .isPromotionActive,
    ).toBe(false);
    expect(
      withCurrentPlanPricing({ ...starterRow, promoEndsAt: null }, Date.parse(LAUNCH_OFFER.startsAt))
        .isPromotionActive,
    ).toBe(false);
  });

  it('communicates the selected launch discount against the existing Mureeh rates', () => {
    expect(getPlanDiscountPercent(PLAN_PRICING.starter)).toBe(57);
    expect(getPlanDiscountPercent(PLAN_PRICING.pro)).toBe(55);
    expect(getPlanDiscountPercent(PLAN_PRICING.enterprise)).toBe(41);
  });

  it('does not let a promotional price bypass the self-service paid-upgrade guard', () => {
    const verdict = evaluatePlanChange({
      current: { id: 'plan-starter', priceMonthly: PLAN_PRICING.starter.priceMonthly },
      target: { id: 'plan-pro', priceMonthly: PLAN_PRICING.pro.priceMonthly },
      isPlatformActor: false,
    });
    expect(verdict).toMatchObject({ allowed: false, statusCode: 402 });

    const managerRoutes = readFileSync(
      fileURLToPath(new URL('../../server/routes/manager.ts', import.meta.url)),
      'utf8',
    );
    const planChangeRoute = managerRoutes.slice(managerRoutes.indexOf("'/subscription/plan'"));
    expect(planChangeRoute).toContain('const targetQuote = withCurrentPlanPricing(plan)');
    expect(planChangeRoute).toContain('current: currentSubscription?.plan ?? null');
    expect(planChangeRoute).toContain('target: plan');
    expect(planChangeRoute).toContain('targetPriceMonthly: targetQuote.priceMonthly');

    const subscriptionRoute = managerRoutes.slice(
      managerRoutes.indexOf("router.get('/subscription'"),
      managerRoutes.indexOf("router.put(\n  '/subscription/plan'"),
    );
    expect(subscriptionRoute).toContain('standardPriceMonthly: subscription.plan.priceMonthly');
    expect(subscriptionRoute).toContain('isPromotionActive: false');
  });
});
