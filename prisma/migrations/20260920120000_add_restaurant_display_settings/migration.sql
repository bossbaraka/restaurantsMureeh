-- ============================================================================
-- Display screen settings (شاشة العرض — the read-only signage board)
--
-- Purely additive and idempotent (IF NOT EXISTS), following the convention of
-- 20260911000000_add_map_image and 20260919180000_add_restaurant_contact_channels:
--   * `displayBackgroundMode` and `displayFont` are NOT NULL TEXT columns with
--     defaults, so every existing row keeps exactly today's behaviour (themed
--     brand canvas + the derived identity font) without a data update;
--   * `displayBackgroundImageUrl` is nullable — NULL means "no backdrop
--     uploaded", and the board then falls back to the themed canvas;
--   * no enum, no index, no constraint: these are display settings read once
--     per board/catalog fetch from the restaurant's own row (already reached
--     through the unique `slug`), never a query dimension;
--   * databases where the columns were pushed out-of-band are untouched.
--
-- What these columns are: how the venue's own read-only board looks —
--   displayBackgroundMode     : 'theme' | 'image'
--   displayBackgroundImageUrl : stable asset reference (never a blob:/data: URI)
--   displayFont               : 'auto' | 'tajawal' | 'cairo' | 'amiri' | 'cormorant'
--
-- What they are NOT: an ordering surface. The board stays read-only — these
-- settings only paint it. Scope is the RESTAURANT (tenant), never a Branch.
-- ============================================================================

-- Background source of the board ('theme' = the venue's brand canvas).
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "displayBackgroundMode" TEXT NOT NULL DEFAULT 'theme';

-- Optional backdrop photo (stable storage reference, resolved on read).
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "displayBackgroundImageUrl" TEXT;

-- Display face of the board ('auto' = derived identity font).
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "displayFont" TEXT NOT NULL DEFAULT 'auto';
