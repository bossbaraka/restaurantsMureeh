-- AlterTable
-- Tracks the last successful sign-in per staff/manager account. Both
-- /api/auth/login and /api/auth/pin write this column; the /pin route does so
-- without a catch guard, so on databases missing the column every staff PIN
-- login died with a 500 after the password check had already passed.
-- Nullable + IF NOT EXISTS keeps the migration idempotent on environments
-- where the column may already have been pushed out-of-band.
ALTER TABLE "RestaurantUser" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
