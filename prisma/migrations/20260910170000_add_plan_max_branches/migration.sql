-- AlterTable
-- Add a hard ceiling on the number of branches a tenant plan may run. Every
-- branch carries real hosting/QR/print cost, so plans are bounded instead of
-- "unlimited". The column is added with a neutral default and then backfilled
-- per plan so existing deployments match the seed catalog without re-seeding.
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "maxBranches" INTEGER NOT NULL DEFAULT 3;

-- Per-plan branch ceilings: trial/starter = single venue, pro = 3, enterprise = 10.
UPDATE "Plan" SET "maxBranches" = 1 WHERE "id" = 'plan-trial-7d';
UPDATE "Plan" SET "maxBranches" = 1 WHERE "id" = 'plan-starter';
UPDATE "Plan" SET "maxBranches" = 3 WHERE "id" = 'plan-pro';
UPDATE "Plan" SET "maxBranches" = 10 WHERE "id" = 'plan-enterprise';

-- Clamp the old "999 = unlimited" sentinel on the enterprise plan to real
-- ceilings so no tenant can grow platform spend without bound.
UPDATE "Plan"
SET "maxTables" = 200, "maxCategories" = 40, "maxProducts" = 500
WHERE "id" = 'plan-enterprise' AND "maxTables" = 999;

-- Drop the dead "unlimited tables" entitlement everywhere (it was never
-- enforced and contradicted bounded spend).
UPDATE "Plan"
SET "entitlements" = array_remove("entitlements", 'CAN_UNLIMITED_TABLES')
WHERE "entitlements" @> ARRAY['CAN_UNLIMITED_TABLES'];
