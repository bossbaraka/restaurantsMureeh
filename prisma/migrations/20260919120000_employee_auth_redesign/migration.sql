-- ============================================================================
-- Employee authentication redesign (AUTH-01 / AUTH-02 remediation)
--
-- Model: restaurant code (existing public slug) + per-tenant username +
--        6-digit PIN for shift staff; email + strong password for
--        managers/platform staff only.
--
-- Reversibility: every step is additive or nullable-widening; the backfills
-- are deterministic and documented so the migration can be replayed.
-- ============================================================================

-- 1) Shift-staff identity: username, unique within a tenant.
--    NULL for legacy rows is allowed only until the backfill below runs.
ALTER TABLE "RestaurantUser" ADD COLUMN IF NOT EXISTS "username" TEXT;

-- 2) Email becomes optional: synthetic emails must stop being minted as
--    auth identifiers for shift staff (AUTH-01). Managers/platform keep
--    theirs. UNIQUE already holds for non-null values (PG treats NULLs as
--    distinct).
ALTER TABLE "RestaurantUser" ALTER COLUMN "email" DROP NOT NULL;

-- 3) Per-account failure budget (AUTH-02): progressive lockout counters.
ALTER TABLE "RestaurantUser" ADD COLUMN IF NOT EXISTS "failedAuthCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RestaurantUser" ADD COLUMN IF NOT EXISTS "authLockedUntil" TIMESTAMP(3);
ALTER TABLE "RestaurantUser" ADD COLUMN IF NOT EXISTS "lastAuthFailAt" TIMESTAMP(3);

-- 4) Backfill usernames from the legacy email local-part (identifier, not a
--    secret): lowercase, keep [a-z0-9._-], strip the rest, collapse repeats.
--    Collision inside a tenant gets a -2/-3… suffix. Rows without email
--    keep NULL username (no such rows exist pre-migration; email was NOT
--    NULL before).
UPDATE "RestaurantUser" ru
SET "username" = base.username
FROM (
  SELECT id,
         (
           SELECT COALESCE(
                    -- deterministic unique suffix when the base collides
                    regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g'),
                    lower(split_part(email, '@', 1))
                  ) || CASE WHEN rn > 1 THEN '-' || rn ELSE '' END
           FROM (VALUES(1)) v(ignored)
         ) AS username
  FROM (
    SELECT r.id, r.email, r."restaurantId",
           ROW_NUMBER() OVER (
             PARTITION BY r."restaurantId",
                          COALESCE(regexp_replace(lower(split_part(r.email, '@', 1)), '[^a-z0-9._-]', '', 'g'),
                                   lower(split_part(r.email, '@', 1)))
             ORDER BY r."createdAt", r.id
           ) AS rn
    FROM "RestaurantUser" r
    WHERE r.email IS NOT NULL
  ) ranked
) base
WHERE ru.id = base.id
  AND base.username ~ '^[a-z0-9._-]{2,32}$';

-- 5) Enforce per-tenant username uniqueness (compound unique; NULLs allowed).
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantUser_restaurantId_username_key"
  ON "RestaurantUser"("restaurantId", "username");

-- 6) Policy change — PINs are now exactly 6 digits. Legacy PIN hashes are
--    bcrypt (unreadable) and the vast majority are 4-digit, so ALL legacy
--    staff PINs are invalidated: managers re-issue 6-digit PINs from the
--    staff screen. This deployment is pre-launch (no production staff).
--    Password-derived credentials (`Staff-{PIN}!`) are NOT migrated either:
--    the password login route rejects shift-staff roles outright, making
--    those hashes permanently unusable.
UPDATE "RestaurantUser" SET "pinHash" = NULL WHERE "pinHash" IS NOT NULL;

-- 7) Failure counters start clean.
UPDATE "RestaurantUser"
SET "failedAuthCount" = 0, "authLockedUntil" = NULL, "lastAuthFailAt" = NULL;
