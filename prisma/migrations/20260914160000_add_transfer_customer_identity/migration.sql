-- ============================================================================
-- Transfer payment proof — guest identity on the order (Order)
--
-- Purely additive: both columns are nullable, no existing row is modified, no
-- financial data is dropped and no enum is introduced. Databases that already
-- have the columns (pushed out-of-band) are untouched — same idempotent
-- convention as 20260914120000_add_payment_proof_and_archive.
--
--   customerName    → the name typed on the transfer notice, so the cashier can
--                     match the receipt to the order (operational PII: purged
--                     by the retention sweep together with the phone).
--   transferChannel → BANK | WALLET, a display hint for the cashier. Never a
--                     financial value and never used for settlement.
-- ============================================================================

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "transferChannel" TEXT;
