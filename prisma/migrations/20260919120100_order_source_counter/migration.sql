-- ============================================================================
-- Walk-in / counter orders (P1-A remediation)
--
-- The POS used to send tableId='__WALKIN__' which violated the Order→Table
-- FK and returned a 500. Proper domain representation instead:
--   * tableId becomes nullable  (counter orders have no table);
--   * orderSource records where the order came from:
--       'TABLE'   — QR/table service (default; every pre-existing row);
--       'COUNTER' — POS walk-in (tableId NULL).
-- Receipts, payments, settlement, reporting and tenant scoping are keyed on
-- restaurantId/orderId and are unaffected. The settlement path already
-- special-cases walk-in (manager.ts /tables settle route).
--
-- Reversible: drop the column and restore NOT NULL (no counter rows exist
-- until the POS creates them; if any exist, they must be re-homed first).
-- ============================================================================

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderSource" TEXT NOT NULL DEFAULT 'TABLE';

ALTER TABLE "Order" ALTER COLUMN "tableId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "Order_orderSource_idx" ON "Order"("orderSource");
