-- AlterTable
-- Static map/location image for the guest-facing "location" view. Replaces
-- the embedded Google Maps frame with an uploadable image so venues no longer
-- depend on an external map provider. Nullable and IF NOT EXISTS keeps this
-- idempotent on environments where the column was already pushed out-of-band.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "mapImageUrl" TEXT;
