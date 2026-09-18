-- ============================================================================
-- Customer transfer payment details (Restaurant) — the venue's receiving side
--
-- Purely additive and idempotent (IF NOT EXISTS), following the convention of
-- 20260911000000_add_map_image, 20260914120000_add_payment_proof_and_archive
-- and 20260915120000_staff_cancel_and_payment_void:
--   * every column is nullable TEXT — no existing row is modified, no default
--     is backfilled and no data is dropped, so tenants that never fill these in
--     keep exactly today's behaviour (the guest modal shows a safe fallback);
--   * no enum, no index, no constraint: these are display settings read once
--     per guest catalog fetch by the restaurant's own row (already reached
--     through the unique `slug`), never a query dimension;
--   * databases where the columns were pushed out-of-band are untouched.
--
-- What these columns are: where the guest sends the money when he pays by
-- transfer, per channel (BANK | WALLET) plus optional shared instructions.
--
-- What they are NOT: financial data. Nothing here is read by the settlement
-- path, the fulfillment gate, the Payment ledger or the cashier's verify /
-- reject decision — the cashier still verifies the money against the guest's
-- receipt (Order.paymentProofPath + customerName/customerPhone), never against
-- these strings. Scope is the RESTAURANT (tenant), never a Branch.
-- ============================================================================

-- BANK channel: bank name, IBAN / account number, account holder name.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "transferBankName" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "transferBankAccount" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "transferBankAccountHolder" TEXT;

-- WALLET channel: wallet name, wallet phone / account id, account holder name.
-- `transferWalletNumber` is deliberately free-form (bounded and character-
-- restricted by the API, not normalized as a customer phone): wallet
-- identifiers are not always phone numbers.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "transferWalletName" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "transferWalletNumber" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "transferWalletAccountHolder" TEXT;

-- Optional instructions shown to the guest under both channels.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "transferInstructions" TEXT;
