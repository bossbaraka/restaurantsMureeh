-- Bump the Starter plan table ceiling from 15 to 20 as requested. The seed is
-- the source of truth for fresh deployments; this keeps existing databases in
-- lock-step without a re-seed. The WHERE guard only raises the cap, so a
-- tenant that was already granted more than 20 keeps their higher allowance.
UPDATE "Plan" SET "maxTables" = 20 WHERE "id" = 'plan-starter' AND "maxTables" < 20;
