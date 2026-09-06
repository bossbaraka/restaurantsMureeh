import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

import { authenticateToken } from './middleware/auth';
import authRoutes from './routes/auth';
import publicRoutes from './routes/public';
import managerRoutes from './routes/manager';
import adminRoutes from './routes/admin';
import uploadRoutes from './routes/uploads';

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 3001);

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// ============================================================
// SECURITY
// ============================================================

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  })
);

// ============================================================
// PERFORMANCE
// ============================================================

app.use(compression());

app.use(
  express.json({
    limit: '10mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '10mb',
  })
);

app.use(
  morgan(
    process.env.NODE_ENV === 'production'
      ? 'combined'
      : 'dev'
  )
);

// ============================================================
// STATIC UPLOADS
// ============================================================

const uploadsPath = path.resolve(
  process.cwd(),
  'uploads'
);

app.use(
  '/uploads',
  express.static(uploadsPath)
);

// ============================================================
// PUBLIC API ROUTES
// ============================================================

app.use('/api/auth', authRoutes);

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
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    database: 'PostgreSQL 17',
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
// ERROR HANDLER
// ============================================================

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Server error:', err);

    const statusCode =
      Number(err?.status) || 500;

    res.status(statusCode).json({
      success: false,
      error:
        err?.message ||
        'Internal Server Error',
      statusCode,
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

if (process.env.NODE_ENV !== 'test') {
  if (process.env.DATABASE_URL) {
    try {
      console.log('🔄 Syncing PostgreSQL database schema with Prisma...');
      const { execSync } = await import('child_process');
      execSync('npx prisma db push --skip-generate --accept-data-loss', { stdio: 'inherit' });
      console.log('✅ Database schema successfully synced with PostgreSQL!');
    } catch (err) {
      console.warn('⚠️ Database schema sync notice:', err);
    }
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
