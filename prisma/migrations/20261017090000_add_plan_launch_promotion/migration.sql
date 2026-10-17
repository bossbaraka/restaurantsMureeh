-- Temporary launch pricing for the public SaaS plans.
-- Standard prices remain untouched in priceMonthly/priceYearly; the API only
-- exposes the promotional rates while the configured window is active.
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "promoPriceMonthly" DOUBLE PRECISION;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "promoPriceYearly" DOUBLE PRECISION;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "promoStartsAt" TIMESTAMP(3);
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "promoEndsAt" TIMESTAMP(3);

-- Backfill existing catalog rows so a deployed database has the offer even
-- before the next seed run. Re-running this migration is safe and data-safe.
UPDATE "Plan"
SET "promoPriceMonthly" = 129,
    "promoPriceYearly" = 1290,
    "promoStartsAt" = TIMESTAMP '2026-10-17 00:00:00',
    "promoEndsAt" = TIMESTAMP '2026-12-31 22:00:00'
WHERE "id" = 'plan-starter';

UPDATE "Plan"
SET "promoPriceMonthly" = 249,
    "promoPriceYearly" = 2490,
    "promoStartsAt" = TIMESTAMP '2026-10-17 00:00:00',
    "promoEndsAt" = TIMESTAMP '2026-12-31 22:00:00'
WHERE "id" = 'plan-pro';

UPDATE "Plan"
SET "promoPriceMonthly" = 499,
    "promoPriceYearly" = 4990,
    "promoStartsAt" = TIMESTAMP '2026-10-17 00:00:00',
    "promoEndsAt" = TIMESTAMP '2026-12-31 22:00:00'
WHERE "id" = 'plan-enterprise';
