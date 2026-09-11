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

// Upload durability guard — FAIL CLOSED in production.
//
// The previous implementation logged a warning and silently fell back from
// `supabase` to local filesystem storage when credentials were missing. On
// Render/Heroku-style hosts the local filesystem is EPHEMERAL, so that
// "graceful" fallback silently destroyed every uploaded logo/cover/dish image
// on the next restart/redeploy/instance replacement. A production boot with
// non-durable storage is a data-loss bug waiting to happen, so it is refused:
//
//   STORAGE_DRIVER=supabase + missing SUPABASE_URL / SERVICE_ROLE_KEY -> throw
//   STORAGE_DRIVER=local in production without an explicit persistent-volume
//   opt-in (STORAGE_ALLOW_LOCAL_IN_PROD=true)                       -> throw
//
// Development and test keep defaulting to local storage with no warnings.
let resolvedStorageDriver: 'local' | 'supabase' = storageDriver;

if (isProd) {
  if (resolvedStorageDriver === 'supabase') {
    const missing: string[] = [];
    if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (missing.length > 0) {
      throw new Error(
        `[STORAGE] STORAGE_DRIVER=supabase is selected but ${missing.join(' and ')} ` +
          'is missing. Refusing to start in production: falling back to local/ephemeral storage ' +
          'would silently lose uploaded images on restart or redeploy. Configure the Supabase ' +
          'credentials (and public bucket "restaurant-assets"), or set STORAGE_DRIVER=local with ' +
          'STORAGE_ALLOW_LOCAL_IN_PROD=true ONLY for a self-hosted deployment with a mounted ' +
          'persistent volume.'
      );
    }
  }

  if (resolvedStorageDriver === 'local' && env.STORAGE_ALLOW_LOCAL_IN_PROD !== 'true') {
    throw new Error(
      '[STORAGE] STORAGE_DRIVER=local is selected in production. Local filesystem storage is ' +
        'ephemeral on most hosts (images are lost on restart/redeploy/scale-out). Refusing to ' +
        'start. Set STORAGE_DRIVER=supabase with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or ' +
        'explicitly set STORAGE_ALLOW_LOCAL_IN_PROD=true for a self-hosted deployment that mounts ' +
        'a persistent volume at UPLOAD_DIR.'
    );
  }
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
  storageAllowLocalInProd: env.STORAGE_ALLOW_LOCAL_IN_PROD === 'true',
} as const;

export const JWT_ISSUER = 'mureeh-api';
export const JWT_AUDIENCE = 'mureeh-app';
export const JWT_ALGORITHM = 'HS256' as const;
