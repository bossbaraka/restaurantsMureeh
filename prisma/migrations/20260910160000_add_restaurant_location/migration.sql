-- AlterTable
-- Store the venue's real map location so the customer-facing map renders the
-- restaurant's actual position instead of the platform default. All three are
-- nullable so existing tenants keep working without a backfill, and
-- IF NOT EXISTS keeps the migration idempotent on environments where the
-- columns were already pushed out-of-band.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "mapUrl" TEXT;
