-- Central Theme Management (Platform → Restaurant → Branch)
-- Single table serves all scopes:
--   restaurantId=NULL, branchId=NULL => Platform Default (single row enforced by partial unique index)
--   restaurantId=X, branchId=NULL    => Restaurant Theme
--   restaurantId=X, branchId=Y       => Branch Override (optional, on demand)

CREATE TABLE IF NOT EXISTS "Theme" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT,
  "branchId" TEXT,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- Unique per scope (restaurant+branch). NULL handling: PostgreSQL treats NULL != NULL,
-- so platform default needs separate partial unique index below.
CREATE UNIQUE INDEX IF NOT EXISTS "Theme_restaurantId_branchId_key" ON "Theme"("restaurantId", "branchId");

CREATE INDEX IF NOT EXISTS "Theme_restaurantId_idx" ON "Theme"("restaurantId");
CREATE INDEX IF NOT EXISTS "Theme_branchId_idx" ON "Theme"("branchId");

-- Enforce single Platform Default row (restaurantId IS NULL AND branchId IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "theme_platform_default_unique" ON "Theme" ((true)) WHERE "restaurantId" IS NULL AND "branchId" IS NULL;

-- FKs (IF NOT EXISTS safe)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Theme_restaurantId_fkey') THEN
    ALTER TABLE "Theme" ADD CONSTRAINT "Theme_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Theme_branchId_fkey') THEN
    ALTER TABLE "Theme" ADD CONSTRAINT "Theme_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
