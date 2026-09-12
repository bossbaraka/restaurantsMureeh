-- Step 1: Ensure column exists if not already present
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

-- Step 2: Set default for future inserts during rolling deploy
ALTER TABLE "Order" ALTER COLUMN "clientRequestId" SET DEFAULT gen_random_uuid()::text;

-- Step 3: Backfill every existing Order where clientRequestId IS NULL.
-- Uses a deterministic UUID v4 string based on restaurantId:id, preserving all existing orders.
-- md5 is built into PostgreSQL and requires no extensions.
UPDATE "Order"
SET "clientRequestId" =
  substr(md5("restaurantId" || ':' || "id"), 1, 8) || '-' ||
  substr(md5("restaurantId" || ':' || "id"), 9, 4) || '-4' ||
  substr(md5("restaurantId" || ':' || "id"), 14, 3) || '-8' ||
  substr(md5("restaurantId" || ':' || "id"), 18, 3) || '-' ||
  substr(md5("restaurantId" || ':' || "id"), 21, 12)
WHERE "clientRequestId" IS NULL;

-- In case any row still has NULL, backfill with gen_random_uuid()
UPDATE "Order"
SET "clientRequestId" = gen_random_uuid()::text
WHERE "clientRequestId" IS NULL;

-- Step 4: Enforce NOT NULL now that all rows are guaranteed non-null
ALTER TABLE "Order" ALTER COLUMN "clientRequestId" SET NOT NULL;

-- Step 5: Clean up any old global unique constraint if present
DROP INDEX IF EXISTS "Order_clientRequestId_key";

-- Step 6: Ensure tenant-scoped composite unique index exists
CREATE UNIQUE INDEX IF NOT EXISTS "Order_restaurantId_clientRequestId_key"
  ON "Order"("restaurantId", "clientRequestId");
