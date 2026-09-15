-- ============================================================================
-- Staff order cancellation + payment void (audit H-02 remediation)
--
-- Purely additive and idempotent (IF NOT EXISTS), following the established
-- convention of 20260914120000_add_payment_proof_and_archive and
-- 20260914180000_add_order_fulfillment_gate:
--   * No existing row changes meaning: every new column is nullable and rows
--     created before this migration keep working exactly as before.
--   * Order.cancelledAt / cancelReason / cancelledByUserId record the staff
--     cancellation marker. `status` keeps being the single operational truth
--     (CANCELLED); these columns answer when/why/by whom. NO deletion of
--     orders — financial history is preserved (retention policy unchanged).
--   * Payment.voidedAt / voidReason / voidedByUserId mark a reversed ledger
--     receipt. The receipt row is NEVER deleted or edited in amount; voiding
--     is a marker so the ledger stays auditable, and the covered orders are
--     reverted to UNPAID/AWAITING_PAYMENT by the application transaction in
--     the same unit of work.
-- ============================================================================

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "cancelledByUserId" TEXT;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "voidReason" TEXT;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "voidedByUserId" TEXT;

-- Idempotent-claim index for the void compare-and-set (fast voidedAt: null probes).
CREATE INDEX IF NOT EXISTS "Payment_restaurantId_voidedAt_idx" ON "Payment"("restaurantId", "voidedAt");

-- Cancelled orders stay queryable per tenant (recent-cancellation views).
CREATE INDEX IF NOT EXISTS "Order_restaurantId_cancelledAt_idx" ON "Order"("restaurantId", "cancelledAt");
