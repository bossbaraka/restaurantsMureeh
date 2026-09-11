-- AlterTable
-- Records the client IP (as resolved by Express behind the configured trusted
-- proxy hop count) for security-relevant audit events: logins, payment
-- receipts, plan changes and denied cross-tenant attempts. Nullable so the
-- column is purely additive and older rows stay valid; IF NOT EXISTS keeps the
-- migration idempotent on databases where the column was pushed out-of-band.
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
