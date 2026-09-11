-- Nullable for existing/POS orders; customer submissions provide a UUID.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_clientRequestId_key"
  ON "Order"("clientRequestId");

-- Preparation estimates are optional restaurant data, never a fabricated default.
ALTER TABLE "Order" ALTER COLUMN "estimatedPrepMinutes" DROP DEFAULT;
