-- ============================================================================
-- Fulfillment gate — the payment authorization boundary (Order)
--
-- Purely additive and deliberately backward compatible:
--   * `fulfillmentState` is a TEXT column (same convention as paymentStatus),
--     NOT NULL with DEFAULT 'RELEASED', so every existing row keeps the exact
--     operational behaviour it has today and an older application process that
--     still INSERTs orders without the column continues to work unchanged.
--   * `releasedAt` is nullable (the gate marker; set when a payment is
--     verified / collected).
--   * The backfill only records WHEN the already-operational legacy rows became
--     operational; it changes no financial value and touches no other column.
--
-- IF NOT EXISTS keeps the migration idempotent on databases where the columns
-- were pushed out-of-band (same convention as 20260914120000_add_payment_proof_and_archive).
--
-- Values: AWAITING_PAYMENT | PAYMENT_VERIFICATION_PENDING | PAYMENT_REJECTED
--         | RELEASED   (application-level; no enum, so no lock-heavy type DDL)
-- ============================================================================

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "fulfillmentState" TEXT NOT NULL DEFAULT 'RELEASED';

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3);

-- Legacy rows predate the gate and are therefore already operational; their
-- settlement time (or, failing that, their creation time) is the honest
-- "operational since" value. Bounded by the table, and only fills NULLs.
UPDATE "Order"
   SET "releasedAt" = COALESCE("settledAt", "createdAt")
 WHERE "releasedAt" IS NULL
   AND "fulfillmentState" = 'RELEASED';

-- Operational screens + the cashier's waiting-for-payment list both query
-- (restaurantId, fulfillmentState).
CREATE INDEX IF NOT EXISTS "Order_restaurantId_fulfillmentState_idx"
  ON "Order"("restaurantId", "fulfillmentState");
