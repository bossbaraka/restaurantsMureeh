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

const app = express();

const PORT = config.port;

// Only trust proxy headers when explicitly deployed behind proxies
// (Render/Nginx = 1). Never enable blindly: spoofed X-Forwarded-For
// would poison rate-limit keys and audit IPs.
app.set('trust proxy', config.trustProxy);

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

// Staff SSE streams authenticate via `?token=` (EventSource cannot set
// headers) — redact it so bearer tokens never land in access logs.
morgan.token('url', (req) =>
  (req.originalUrl || req.url || '').replace(
    /([?&])token=[^&\s]*/g,
    '$1token=[REDACTED]'
  )
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
  'uploads'
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

  app.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        `🚀 MÉRAR SaaS Server listening on port ${PORT}`
      );
    }
  );
}

export default app;
