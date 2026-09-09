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
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),
  CORS_ORIGIN: z.string().default(''),
  // Number of trusted reverse proxies in front of Express (Render/Nginx = 1).
  // Keep 0 for direct exposure so client IPs cannot be spoofed via headers.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  // CSP frame-ancestors value for the API/SPA responses.
  FRAME_ANCESTORS: z.string().min(1).default("'self'"),
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

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,
  trustProxy: env.TRUST_PROXY,
  frameAncestors: env.FRAME_ANCESTORS,
} as const;

export const JWT_ISSUER = 'mureeh-api';
export const JWT_AUDIENCE = 'mureeh-app';
export const JWT_ALGORITHM = 'HS256' as const;
