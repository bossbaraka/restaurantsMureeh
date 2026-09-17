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
  // Public origin of this API service (https://api.example.com). Used to
  // absolutize driver-relative asset URLs (local driver: /uploads/{key})
  // in API responses so a guest on a different frontend origin
  // (Netlify/Vercel SPA + Render API split deployment) can still load
  // the tenant's images. Empty = same-origin deployment, relative URLs.
  APP_URL: z.string().min(0).default(''),
  // Uploaded assets (logo/cover/gallery/dish images).
  // - `local`  → process filesystem under UPLOAD_DIR (dev/test only; refused
  //              in production unless explicitly opted-in, see below).
  // - `supabase` → persistent Supabase Storage bucket (S3-compatible API).
  // - `object` → alias for `supabase`, to match generic deployment naming.
  // Optional: when unset, `supabase` is inferred if SUPABASE_URL and
  // SUPABASE_SERVICE_ROLE_KEY are both present; otherwise `local`.
  STORAGE_DRIVER: z.enum(['local', 'supabase', 'object']).optional(),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  // PRIVATE namespace for transfer-receipt images (never statically served).
  PRIVATE_UPLOAD_DIR: z.string().min(1).default('./private-uploads'),
  SUPABASE_URL: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('restaurant-assets'),
  // PRIVATE (non-public) bucket for transfer receipts. Created automatically
  // with the service-role key on boot when it does not exist yet.
  SUPABASE_PRIVATE_BUCKET: z.string().min(1).default('payment-proofs'),
  // Explicit opt-out for SELF-HOSTED deployments with a mounted persistent
  // volume. Without this, `local` storage is refused in production because
  // it would otherwise silently store images on an ephemeral filesystem.
  STORAGE_ALLOW_LOCAL_IN_PROD: z
    .enum(['true', 'false'])
    .default('false'),
  // ------------------------------------------------------------------
  // Daily archive / retention of TEMPORARY operational data only.
  // Financial order + payment records are never deleted by this feature.
  // ------------------------------------------------------------------
  // Hours added to the tenant-local midnight before a business session is
  // considered closed. Venues serving past midnight (e.g. 02:30) keep a whole
  // calendar day inside ONE session with the default 6h grace window.
  RETENTION_ARCHIVE_GRACE_HOURS: z.coerce.number().min(0).max(23).default(6),
  // How long the private receipt image and the optional guest phone stay
  // readable AFTER the order was archived. 0 is refused: a destructive
  // cleanup without a retention window is a data-loss bug.
  RETENTION_PROOF_HOURS: z.coerce.number().min(1).max(24 * 365).default(48),
  // Safety bound on how many orders one sweep may touch (bounded work per run).
  RETENTION_BATCH_SIZE: z.coerce.number().int().min(1).max(5000).default(500),
  // Opt-in in-process scheduler (same pattern as BACKUP_ENABLED). Off by
  // default: the supported automation is the `retention:cleanup` CLI driven by
  // an external scheduler / Render cron job.
  RETENTION_ENABLED: z.enum(['true', 'false']).default('false'),
  RETENTION_INTERVAL_HOURS: z.coerce.number().min(1).max(168).default(6),
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

// ------------------------------------------------------------
// Production infrastructure detection — NOT derived from NODE_ENV.
//
// The storage guard at the bottom of this file is what keeps tenant images
// alive across a restart, and it used to be keyed on `NODE_ENV === 'production'`
// alone. That is only sound when the operator remembered to set NODE_ENV: a
// Render service with NODE_ENV unset (this file's default is `development`) or
// overridden in the dashboard booted happily on the ephemeral filesystem and
// lost every uploaded logo/cover/gallery image on the next redeploy.
//
// Render injects its own variables into every service at build AND run time,
// whatever NODE_ENV says (platform "Default Environment Variables": RENDER is
// always "true", plus RENDER_SERVICE_ID / RENDER_EXTERNAL_HOSTNAME). Those are
// the only names used here — read from the environment, never defaulted, so a
// host that does not set them keeps its current behaviour.
// ------------------------------------------------------------
const platformVar = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/** True when the process is known to run on Render (ephemeral filesystem). */
export const isRenderInfra =
  platformVar(process.env.RENDER) === 'true' ||
  platformVar(process.env.RENDER_SERVICE_ID) !== '' ||
  platformVar(process.env.RENDER_EXTERNAL_HOSTNAME) !== '';

/** True when uploaded assets MUST live on durable storage. */
export const isProductionInfra = isProd || isRenderInfra;

// `object` is a generic alias; the concrete implemented driver is `supabase`.
// Resolution order:
//   1. explicit STORAGE_DRIVER                          -> honoured as-is
//   2. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY present -> supabase
//   3. otherwise                                        -> local (existing default)
// (2) closes the Render gap where credentials were configured but the
// driver variable was not, which silently wrote uploads to the ephemeral
// filesystem and lost them on the next restart/redeploy.
const explicitStorageDriver =
  env.STORAGE_DRIVER === 'object' ? ('supabase' as const) : env.STORAGE_DRIVER;
const storageDriver: 'local' | 'supabase' =
  explicitStorageDriver ??
  (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'local');

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
// The guard fires on `isProductionInfra` — NODE_ENV=production OR a
// platform-injected production indicator (Render) — so a mis-set or absent
// NODE_ENV can no longer downgrade a live deployment to ephemeral uploads.
//
// Development and test keep defaulting to local storage with no warnings.
let resolvedStorageDriver: 'local' | 'supabase' = storageDriver;

if (isProductionInfra) {
  const where = isRenderInfra
    ? 'production (detected as a Render service via RENDER/RENDER_SERVICE_ID, regardless of NODE_ENV)'
    : 'production';

  if (resolvedStorageDriver === 'supabase') {
    const missing: string[] = [];
    if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (missing.length > 0) {
      throw new Error(
        `[STORAGE] STORAGE_DRIVER=supabase is selected but ${missing.join(' and ')} ` +
          `is missing. Refusing to start in ${where}: falling back to local/ephemeral storage ` +
          'would silently lose uploaded images on restart or redeploy. Configure the Supabase ' +
          'credentials (and public bucket "restaurant-assets"), or set STORAGE_DRIVER=local with ' +
          'STORAGE_ALLOW_LOCAL_IN_PROD=true ONLY for a self-hosted deployment with a mounted ' +
          'persistent volume.'
      );
    }
  }

  if (resolvedStorageDriver === 'local') {
    // The persistent-volume opt-in is honoured for SELF-HOSTED production only:
    // Render gives a web service no persistent disk, so `local` there always
    // loses uploads on the next redeploy — no flag can make it safe.
    const selfHostedPersistentVolume =
      env.STORAGE_ALLOW_LOCAL_IN_PROD === 'true' && !isRenderInfra;
    if (!selfHostedPersistentVolume) {
      throw new Error(
        `[STORAGE] STORAGE_DRIVER=local is selected in ${where}. Local filesystem storage is ` +
          'ephemeral on most hosts (images are lost on restart/redeploy/scale-out). Refusing to ' +
          'start. Set STORAGE_DRIVER=supabase with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY' +
          (isRenderInfra
            ? ' (Render has no persistent disk, so STORAGE_ALLOW_LOCAL_IN_PROD is ignored there).'
            : ', or explicitly set STORAGE_ALLOW_LOCAL_IN_PROD=true for a self-hosted ' +
              'deployment that mounts a persistent volume at UPLOAD_DIR.')
      );
    }
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
  privateUploadDir: env.PRIVATE_UPLOAD_DIR,
  appUrl: env.APP_URL.replace(/\/+$/, ''),
  supabaseUrl: env.SUPABASE_URL,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseBucket: env.SUPABASE_STORAGE_BUCKET,
  supabasePrivateBucket: env.SUPABASE_PRIVATE_BUCKET,
  storageAllowLocalInProd: env.STORAGE_ALLOW_LOCAL_IN_PROD === 'true',
  // Retention of temporary operational data (never of financial history).
  archiveGraceHours: env.RETENTION_ARCHIVE_GRACE_HOURS,
  proofRetentionHours: env.RETENTION_PROOF_HOURS,
  retentionBatchSize: env.RETENTION_BATCH_SIZE,
  retentionEnabled: env.RETENTION_ENABLED === 'true',
  retentionIntervalHours: env.RETENTION_INTERVAL_HOURS,
} as const;

export const JWT_ISSUER = 'mureeh-api';
export const JWT_AUDIENCE = 'mureeh-app';
export const JWT_ALGORITHM = 'HS256' as const;
