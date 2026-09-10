import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// ============================================================
// Central environment validation — the server refuses to boot
// when security-critical configuration is missing or weak.
// There is intentionally NO fallback JWT secret: a missing or
// short JWT_SECRET must fail closed, never silently downgrade
// to a hard-coded key (CWE-321).
// ============================================================

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters (256-bit recommended)'),
  // Short-lived access tokens (12h) — refresh rotation roadmap in H-02.
  // Previous default was 7d; shortened to limit exposure window after theft (H-01).
  JWT_EXPIRES_IN: z.string().min(1).default('12h'),
  CORS_ORIGIN: z.string().default(''),
  // Number of trusted reverse proxies in front of Express (Render/Nginx = 1).
  // Keep 0 for direct exposure so client IPs cannot be spoofed via headers.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  // CSP frame-ancestors value for the API/SPA responses.
  FRAME_ANCESTORS: z.string().min(1).default("'self'"),
  // Uploaded assets (logo/cover/gallery/dish images).
  // - `local`  → process filesystem under UPLOAD_DIR (dev/test only; refused
  //              in production unless explicitly opted-in, see below).
  // - `supabase` → persistent Supabase Storage bucket (S3-compatible API).
  // - `object` → alias for `supabase`, to match generic deployment naming.
  STORAGE_DRIVER: z
    .enum(['local', 'supabase', 'object'])
    .default('local'),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  SUPABASE_URL: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('restaurant-assets'),
  // Explicit opt-out for SELF-HOSTED deployments with a mounted persistent
  // volume. Without this, `local` storage is refused in production because
  // it would otherwise silently store images on an ephemeral filesystem.
  STORAGE_ALLOW_LOCAL_IN_PROD: z
    .enum(['true', 'false'])
    .default('false'),
});

const parsed = envSchema.safeParse(process.env);

// Rule 4: the database connection string comes from the environment ONLY.
// There is intentionally no `process.env.DATABASE_URL || '<literal>'`
// anywhere in this codebase — a missing URL must fail closed in production
// rather than silently connecting to a hard-coded (and historically
// committed) production database. See audit finding C-01.

if (!parsed.success) {
  console.error('❌ Invalid environment configuration — refusing to start:');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  throw new Error('Invalid environment configuration');
}

const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

// `object` is a generic alias; the concrete implemented driver is `supabase`.
const storageDriver =
  env.STORAGE_DRIVER === 'object' ? ('supabase' as const) : env.STORAGE_DRIVER;

export const allowedOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Fail closed: a production API must never reflect arbitrary origins.
if (isProd && allowedOrigins.length === 0) {
  throw new Error(
    'CORS_ORIGIN must be configured with exact production origin(s). Refusing to start.'
  );
}

// Fail closed: a production API without a database is not "degraded", it is
// broken — and booting anyway invites a fallback connection string being
// added later "to make it work". Development/test may run without a DB so
// the pure-logic test suite keeps working offline.
if (isProd && !env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required in production and must be supplied by the environment ' +
      '(no in-source fallback). Refusing to start.'
  );
}

// Upload durability guard. Object storage is the recommended production path.
// If Supabase credentials are not yet supplied or STORAGE_DRIVER=local is used in production,
// log a clear warning and fall back to local storage rather than crashing the boot process.
let resolvedStorageDriver: 'local' | 'supabase' = storageDriver;

if (resolvedStorageDriver === 'supabase') {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      '⚠️  [STORAGE] WARNING: STORAGE_DRIVER=supabase was configured, but SUPABASE_URL or ' +
        'SUPABASE_SERVICE_ROLE_KEY is missing. Falling back to local storage driver to prevent crash. ' +
        'Note: uploaded images will not persist across redeployments until Supabase credentials are provided.'
    );
    resolvedStorageDriver = 'local';
  }
}

if (resolvedStorageDriver === 'local' && isProd && env.STORAGE_ALLOW_LOCAL_IN_PROD !== 'true') {
  console.warn(
    '⚠️  [STORAGE] WARNING: STORAGE_DRIVER=local is active in production without STORAGE_ALLOW_LOCAL_IN_PROD=true. ' +
      'Uploaded files are stored on an ephemeral filesystem and will be lost on redeploy/restart. ' +
      'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (and STORAGE_DRIVER=supabase) for persistent object storage.'
  );
}

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,
  trustProxy: env.TRUST_PROXY,
  frameAncestors: env.FRAME_ANCESTORS,
  storageDriver: resolvedStorageDriver,
  uploadDir: env.UPLOAD_DIR,
  supabaseUrl: env.SUPABASE_URL,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseBucket: env.SUPABASE_STORAGE_BUCKET,
} as const;

export const JWT_ISSUER = 'mureeh-api';
export const JWT_AUDIENCE = 'mureeh-app';
export const JWT_ALGORITHM = 'HS256' as const;
