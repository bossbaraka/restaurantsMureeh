-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('RESTAURANT', 'CAFE', 'BAKERY');

-- AlterTable
-- Existing tenants keep working: the column lands with a default, so the
-- guest-facing QR experience has a defined venue kind from the first render.
ALTER TABLE "Restaurant" ADD COLUMN "businessType" "BusinessType" NOT NULL DEFAULT 'RESTAURANT';

-- CreateIndex
CREATE INDEX "Restaurant_businessType_idx" ON "Restaurant"("businessType");
