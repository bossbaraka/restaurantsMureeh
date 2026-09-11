-- Add without a default first so existing rows can be backfilled predictably.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

-- Preserve every existing order while assigning a stable UUID-shaped key.
-- md5 is built into PostgreSQL, so this needs no database extension.
UPDATE "Order"
SET "clientRequestId" =
  substr(md5("restaurantId" || ':' || "id"), 1, 8) || '-' ||
  substr(md5("restaurantId" || ':' || "id"), 9, 4) || '-4' ||
  substr(md5("restaurantId" || ':' || "id"), 14, 3) || '-8' ||
  substr(md5("restaurantId" || ':' || "id"), 18, 3) || '-' ||
  substr(md5("restaurantId" || ':' || "id"), 21, 12)
WHERE "clientRequestId" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "clientRequestId" SET NOT NULL;
-- Keep order creation compatible during rolling deploys where an older app
-- process does not yet send the new column.
ALTER TABLE "Order" ALTER COLUMN "clientRequestId" SET DEFAULT gen_random_uuid()::text;

-- Replace an earlier global request-id constraint if this migration is being
-- applied during a rolling correction. Dropping the index does not alter rows.
DROP INDEX IF EXISTS "Order_clientRequestId_key";

-- The same UUID may be used independently by different tenants; uniqueness
-- is enforced only within the authoritative restaurant boundary.
CREATE UNIQUE INDEX IF NOT EXISTS "Order_restaurantId_clientRequestId_key"
  ON "Order"("restaurantId", "clientRequestId");

-- Preparation estimates are optional restaurant data, never a fabricated default.
ALTER TABLE "Order" ALTER COLUMN "estimatedPrepMinutes" DROP DEFAULT;
