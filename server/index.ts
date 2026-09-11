import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';

// Imported FIRST: validates the environment and refuses to boot on
// missing/weak security configuration (no silent fallbacks).
import { config, isProd, allowedOrigins } from './config';

import { authenticateToken } from './middleware/auth';
import authRoutes from './routes/auth';
import publicRoutes from './routes/public';
import managerRoutes from './routes/manager';
import adminRoutes from './routes/admin';
import uploadRoutes from './routes/uploads';
import { verifyStorageReady } from './services/storage';

/** Probe object storage twice with a short delay to ride out deploy-time DNS/network blips. */
async function verifyStorageReadyWithRetry(): Promise<{ ok: boolean; error?: string }> {
  let last: { ok: boolean; error?: string } = { ok: false, error: 'not attempted' };
  for (const delayMs of [0, 1500]) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    last = await verifyStorageReady();
    if (last.ok) return last;
  }
  return last;
}

const app = express();

const PORT = config.port;

// Only trust proxy headers when explicitly deployed behind proxies
// (Render/Nginx = 1). Never enable blindly: spoofed X-Forwarded-For
// would poison rate-limit keys and audit IPs.
app.set('trust proxy', config.trustProxy);

// Misconfiguration alarm (audit H-03): behind a reverse proxy with
// TRUST_PROXY=0, req.ip resolves to the proxy for every request, so every
// rate limiter shares ONE bucket (a single client can lock out the whole
// platform) and audit IPs are meaningless. Warn loudly rather than fail —
// a directly-exposed deployment legitimately uses 0.
if (isProd && config.trustProxy === 0) {
  console.warn(
    '⚠️ TRUST_PROXY=0 in production. If this service runs behind a reverse ' +
      'proxy/load balancer (Render, Nginx, Cloudflare), set TRUST_PROXY to the ' +
      'number of trusted proxies (Render = 1). Otherwise rate limiting is ' +
      'global-bucketed and audit client IPs are wrong.'
  );
}

// ============================================================
// SECURITY HEADERS
// ============================================================

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: [config.frameAncestors],
      },
    },
    // Uploaded files are images only; still deny framing of the app.
    frameguard: { action: 'deny' },
  })
);

// Fail-closed CORS: exact allow-list match or no CORS headers at all.
// Same-origin traffic (the shipped SPA + API on one host) and
// non-browser clients are unaffected by CORS.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Unknown origin: deny CORS headers without breaking the request
      // itself (the browser enforces the denial for credentialed calls).
      callback(null, false);
    },
    credentials: true,
  })
);

// ============================================================
// PERFORMANCE / PARSING
// ============================================================

app.use(compression());

// 1MB is plenty for JSON APIs (menu payloads are paged client-side);
// the 10MB legacy limit invited trivial payload bombs.
app.use(
  express.json({
    limit: '1mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '256kb',
  })
);

// Credential-bearing query parameters must never reach access logs
// (audit H-01). Staff SSE streams authenticate via `?token=` and QR guest
// streams via `?sessionToken=` (EventSource cannot set headers), and a
// leaked sessionToken is a live 6-hour capability over a table's orders.
//
// The previous pattern only matched `token=`, which — because it is
// anchored on a `?`/`&` boundary — did NOT match `sessionToken=`.
// Matching the full parameter name explicitly closes that gap.
const SENSITIVE_QUERY_PARAMS =
  /([?&])(sessionToken|qrToken|token|access_token|refresh_token|pin|password|secret|apiKey)=[^&\s]*/gi;

export function redactSensitiveUrl(url: string): string {
  return url.replace(SENSITIVE_QUERY_PARAMS, '$1$2=[REDACTED]');
}

morgan.token('url', (req) =>
  redactSensitiveUrl(req.originalUrl || req.url || '')
);

app.use(
  morgan(
    process.env.NODE_ENV === 'production'
      ? 'combined'
      : 'dev'
  )
);

// ============================================================
// STATIC UPLOADS (images only, never executable)
// ============================================================

const uploadsPath = path.resolve(
  process.cwd(),
  config.uploadDir
);

app.use(
  '/uploads',
  express.static(uploadsPath, {
    dotfiles: 'deny',
    index: false,
    // Defense in depth: even if a non-image file ever lands here, the
    // browser must treat it as an inert download, never active content.
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; sandbox"
      );
      if (!/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(filePath)) {
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="download"'
        );
      }
    },
  })
);

// ============================================================
// PUBLIC API ROUTES
// ============================================================

app.use('/api/auth', authenticateToken, authRoutes);

app.use('/api/public', publicRoutes);

// ============================================================
// PROTECTED API ROUTES
// ============================================================

app.use(
  '/api/manager',
  authenticateToken,
  managerRoutes
);

app.use(
  '/api/admin',
  authenticateToken,
  adminRoutes
);

app.use(
  '/api/uploads',
  authenticateToken,
  uploadRoutes
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/api/health', (_req, res) => {
  // Minimal fingerprint: version/database details are not exposed to
  // unauthenticated callers (CWE-200). Internal detailed health should
  // be behind authentication if ever needed.
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// REACT FRONTEND
// ============================================================

const frontendDistPath = path.resolve(
  process.cwd(),
  'dist'
);

if (fs.existsSync(frontendDistPath)) {
  console.log(
    `📦 React frontend found at: ${frontendDistPath}`
  );

  app.use(
    express.static(frontendDistPath, {
      index: false,
    })
  );

  // Express 5 SPA fallback
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(
      path.join(
        frontendDistPath,
        'index.html'
      )
    );
  });
} else {
  console.warn(
    `⚠️ React frontend build not found at: ${frontendDistPath}`
  );
}

// ============================================================
// 404 HANDLER
// ============================================================

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint Not Found',
    statusCode: 404,
  });
});

// ============================================================
// ERROR HANDLER (never leak internals in production)
// ============================================================

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Server error:', err);

    // Malformed JSON bodies get a generic 400 — never the parser's
    // internal diagnostics (CWE-209).
    if (
      err?.type === 'entity.parse.failed' ||
      (err instanceof SyntaxError && Number(err?.status) === 400)
    ) {
      return res.status(400).json({
        success: false,
        error: 'طلب غير صالح: تعذر قراءة البيانات المرسلة',
        statusCode: 400,
      });
    }

    // Oversized JSON bodies (almost always an image pasted as base64 text
    // instead of uploaded through POST /api/uploads/image). The 1MB cap
    // stays — this only turns the cryptic parser error into actionable
    // Arabic guidance instead of leaking `request entity too large`.
    if (
      err?.type === 'entity.too.large' ||
      Number(err?.status) === 413
    ) {
      return res.status(413).json({
        success: false,
        error:
          'حجم البيانات المرسلة كبير جداً — لا تلصق الصور كنص داخل الحقول. ارفع الصورة عبر زر الرفع من جهازك ثم اضغط حفظ.',
        statusCode: 413,
      });
    }

    const statusCode =
      Number(err?.status) || 500;

    const message =
      statusCode >= 500 && isProd
        ? 'Internal Server Error'
        : err?.message || 'Internal Server Error';

    // Multer upload errors → clean 400 responses.
    if (err?.name === 'MulterError' || err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: err?.message || 'فشل رفع الملف',
        statusCode: 400,
      });
    }

    res.status(statusCode).json({
      success: false,
      error: message,
      statusCode,
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

if (process.env.NODE_ENV !== 'test') {
  // NOTE: schema migrations are applied by the deploy pipeline
  // (`prisma migrate deploy`). The server NEVER runs `db push` on boot:
  // `--accept-data-loss` on a production database is a data-loss gun.
  if (!config.databaseUrl) {
    console.warn(
      '⚠️ DATABASE_URL is not set — API routes requiring the database will fail until it is configured.'
    );
  }

  const server = app.listen(
    PORT,
    '0.0.0.0',
    async () => {
      console.log(
        `🚀 MÉRAR SaaS Server listening on port ${PORT}`
      );

      // Keep-Alive for Render free tier (prevents 15-minute inactivity spin-down)
      const keepAliveUrl = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
      if (process.env.KEEP_ALIVE !== 'false' && keepAliveUrl) {
        const pingTarget = `${keepAliveUrl.replace(/\/+$/, '')}/api/health`;
        const intervalMins = Number(process.env.KEEP_ALIVE_INTERVAL_MINUTES) || 10;
        const intervalMs = Math.max(2, Math.min(14, intervalMins)) * 60 * 1000;
        console.log(`🔄 Keep-Alive enabled: pinging ${pingTarget} every ${intervalMins}m to prevent Render 15-min idle sleep`);
        
        // First ping after 2 minutes, then every intervalMs
        setTimeout(() => {
          const doPing = async () => {
            try {
              const res = await fetch(pingTarget, { signal: AbortSignal.timeout(15_000) });
              if (res.ok) {
                console.log(`💓 Keep-Alive ping ok (${res.status})`);
              }
            } catch (err: any) {
              console.warn(`⚠️ Keep-Alive ping failed: ${err?.message}`);
            }
          };
          void doPing();
          setInterval(() => void doPing(), intervalMs);
        }, 2 * 60 * 1000);
      }

      // Object storage readiness: credentials/bucket policy mistakes must be
      // visible in the deploy logs immediately rather than surfacing as the
      // first failed tenant upload hours later. The result is non-fatal after
      // retries (a transient Supabase outage must not crash-loop the API, and
      // missing credentials already fail the boot earlier in config.ts).
      const storageReady = config.storageDriver === 'local'
        ? { ok: true }
        : await verifyStorageReadyWithRetry();
      if (!storageReady.ok) {
        console.error(
          `❌ [STORAGE] Object storage "${config.supabaseBucket}" is NOT reachable at boot ` +
            `(${storageReady.error}). Image uploads will fail until this is fixed — check ` +
            'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and that the public bucket exists.'
        );
      } else {
        console.log(
          `✅ [STORAGE] Driver "${config.storageDriver}" ready (bucket "${config.supabaseBucket}", persistent=${config.storageDriver === 'supabase'}).`
        );
      }

      // Opt-in scheduled database backups (crash/restart resilience). Off by
      // default; enable with BACKUP_ENABLED=true and DB_PASSWORD. Backups are
      // written to ./backups (chmod 600) — mount a persistent volume there or
      // ship the .sql dumps off-instance, otherwise a disk failure takes the
      // backups down with the server. Failures are logged loudly (never silent).
      if (process.env.BACKUP_ENABLED === 'true') {
        const backupHours = Math.max(
          1,
          Number(process.env.BACKUP_INTERVAL_HOURS) || 24
        );
        const backupMs = backupHours * 60 * 60 * 1000;
        const runBackup = async () => {
          const { createDatabaseBackup } = await import('./services/backup');
          const result = await createDatabaseBackup();
          if (!result.success) {
            // A backup that fails quietly is worse than no backup: operators
            // must see the failure on every interval (DATABASE_URL/password
            // drift, missing pg_dump, full disk). The credential itself is
            // never printed — the service returns stderr only.
            console.error(
              `❌ [BACKUP] Scheduled database backup FAILED: ${result.error || 'unknown error'}. ` +
                'Backups must ship off-instance or target a mounted persistent volume.'
            );
          }
        };
        console.log(
          `💾 Scheduled backups enabled: every ${backupHours}h to ./backups (DB_PASSWORD must be set; ` +
            'mount a persistent volume at ./backups or the dumps are lost on redeploy).'
        );
        setInterval(() => void runBackup(), backupMs).unref();
      }
    }
  );

  // Prevent 502 race conditions behind Render/reverse proxy
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

export default app;
