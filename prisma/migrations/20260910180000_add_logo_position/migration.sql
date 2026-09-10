-- AlterTable
-- Add logo framing controls so a manager can make an awkwardly-cropped logo
-- appear regularly: `logoFit` (cover = crop-to-fill, contain = show whole)
-- and `logoPosition` (CSS object-position anchor). Both default to the
-- previous behaviour (cover, centered) so existing logos are unchanged until
-- their owner adjusts them. IF NOT EXISTS keeps this idempotent.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "logoFit" TEXT NOT NULL DEFAULT 'cover';
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "logoPosition" TEXT NOT NULL DEFAULT '50% 50%';
