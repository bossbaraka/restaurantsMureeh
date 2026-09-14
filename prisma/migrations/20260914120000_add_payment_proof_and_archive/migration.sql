-- ============================================================================
-- Transfer payment proof + daily archive / retention markers (Order)
--
-- Purely additive: every column is nullable, no existing row is modified and
-- no financial data is dropped. `paymentStatus` stays a TEXT column (values
-- UNPAID | PENDING_VERIFICATION | PAID) so the migration cannot fail on
-- existing data and older application processes keep working.
--
-- IF NOT EXISTS keeps the migration idempotent on databases where the columns
-- were pushed out-of-band (same convention as 20260911130000_add_audit_ip).
-- ============================================================================

-- Optional guest phone (operational, purged by the retention sweep).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;

-- Private storage object key for the transfer receipt image. Never a public
-- URL: the object lives in the private storage namespace and is only reachable
-- through an authenticated, tenant-checked API route.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentProofPath" TEXT;

-- Rejection marker (the order itself returns to UNPAID).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentRejectedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentRejectionReason" TEXT;

-- Daily-archive + retention markers. Financial history is never removed.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "retentionPurgedAt" TIMESTAMP(3);

-- Indexes justified by two real query patterns:
--   1. the cashier verification queue  → (restaurantId, paymentStatus)
--   2. the retention sweep             → (archivedAt) across all tenants
CREATE INDEX IF NOT EXISTS "Order_restaurantId_paymentStatus_idx"
  ON "Order"("restaurantId", "paymentStatus");

CREATE INDEX IF NOT EXISTS "Order_archivedAt_idx"
  ON "Order"("archivedAt");
