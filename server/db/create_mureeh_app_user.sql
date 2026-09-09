-- -----------------------------------------------------------------------------
-- Provision Restricted Database Application User: mureeh_app
-- -----------------------------------------------------------------------------
-- Purpose: Create an unprivileged application database user for runtime backend operations.
-- Security Guarantees:
--   - NO SUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION
--   - Cannot perform DDL operations (CREATE TABLE, DROP TABLE, ALTER TABLE, etc.)
--   - Granted standard DML permissions (SELECT, INSERT, UPDATE, DELETE) only.
-- -----------------------------------------------------------------------------

-- 1. Create the application user with a strong password (replace 'SECURE_APP_PASSWORD_HERE')
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'mureeh_app') THEN
        CREATE USER mureeh_app WITH PASSWORD 'SECURE_APP_PASSWORD_HERE' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
END
$$;

-- 2. Revoke default public schema privileges
REVOKE ALL ON SCHEMA public FROM mureeh_app;

-- 3. Grant schema usage
GRANT USAGE ON SCHEMA public TO mureeh_app;

-- 4. Grant DML privileges on all existing tables & views in public schema
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mureeh_app;

-- 5. Grant usage & select on all existing sequences
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mureeh_app;

-- 6. Set default privileges so tables/sequences created in the future by migration tools (Prisma) automatically grant DML to mureeh_app
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mureeh_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mureeh_app;

-- -----------------------------------------------------------------------------
-- Production Usage Instructions:
-- -----------------------------------------------------------------------------
-- 1. Run this script using your PostgreSQL administrative (DDL/owner) user:
--    psql -U postgres -d restaurant_saas -f server/db/create_mureeh_app_user.sql
--
-- 2. Point runtime DATABASE_URL in environment secrets / .env to mureeh_app:
--    DATABASE_URL="postgresql://mureeh_app:YOUR_SECURE_PASSWORD@localhost:5432/restaurant_saas?schema=public"
-- -----------------------------------------------------------------------------
