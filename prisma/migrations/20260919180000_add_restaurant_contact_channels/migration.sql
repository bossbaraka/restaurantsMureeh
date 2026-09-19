-- ============================================================================
-- Restaurant contact channels & reservations — WhatsApp number + social links
--
-- Purely additive and idempotent (IF NOT EXISTS), following the convention of
-- 20260911000000_add_map_image and 20260917120000_add_restaurant_transfer_details:
--   * every column is nullable TEXT — no existing row is modified, no default
--     is backfilled and no data is dropped, so tenants that never fill these in
--     keep exactly today's behaviour (the guest menu hides the section, the
--     Live Menu hides the reservation CTA);
--   * no enum, no index, no constraint: these are display/contact settings read
--     once per guest catalog fetch from the restaurant's own row (already
--     reached through the unique `slug`), never a query dimension;
--   * databases where the columns were pushed out-of-band are untouched.
--
-- What these columns are: the venue's own public contact surface —
--   whatsappNumber : canonical E.164 (`+` + digits). Drives the ONE interaction
--                    allowed on the read-only Live Menu («احجز طاولتك»), which
--                    composes a reservation request and opens WhatsApp.
--   instagramUrl / facebookUrl / tiktokUrl / youtubeUrl / websiteUrl :
--                    the guest menu's «تواصل معنا» section. HTTPS-only,
--                    credential-free, host-allowlisted per platform by
--                    `socialLinkSchema` in server/validation/schemas.ts.
--
-- What they are NOT: a reservation store. Nothing here records a booking —
-- the Live Menu hands the request to WhatsApp and the RESTAURANT confirms it.
-- Scope is the RESTAURANT (tenant), never a Branch.
-- ============================================================================

-- Reservation / contact channel.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "whatsappNumber" TEXT;

-- Social profiles (all optional; a venue publishes only what it actually has).
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "instagramUrl" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "facebookUrl" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "tiktokUrl" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "youtubeUrl" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "websiteUrl" TEXT;
