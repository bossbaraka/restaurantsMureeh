-- Permanent FREE plan for self-service restaurant onboarding (2026-10).
--
-- DATA-ONLY migration: no table/column changes. `plan-free` is inserted
-- idempotently and NEVER overwritten — an operator edit of the catalog row
-- survives every deploy (re-running `npm run db:seed` remains the deliberate
-- sync path, same as every other plan in the catalog).
--
-- The values MUST match server/services/plans.ts (FREE_PLAN) and the seed;
-- src/tests/freePlan.test.ts pins this triple equality in both directions.
INSERT INTO "Plan" (
    "id", "name", "nameEn",
    "priceMonthly", "priceYearly",
    "billingPeriod",
    "maxTables", "maxCategories", "maxProducts", "maxBranches",
    "entitlements", "description", "status", "isPopular"
)
VALUES (
    'plan-free',
    'الخطة المجانية الدائمة',
    'Permanent Free Plan',
    0,
    0,
    'free',
    20,
    6,
    35,
    1,
    ARRAY['CAN_USE_ADVANCED_FEATURES']::TEXT[],
    'خطة مجانية دائمة للمطاعم التي تُسجّل ذاتياً: منيو رقمي كامل وطلبات QR حتى 20 طاولة.',
    'ACTIVE',
    false
)
ON CONFLICT ("id") DO NOTHING;
