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
// PERFORMANCE & BODY PARSING
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
// PUBLIC API
// ============================================================

// Authentication
app.use('/api/auth', authRoutes);

// Public restaurant/menu/events/table endpoints
app.use('/api/public', publicRoutes);

// ============================================================
// PROTECTED API
// ============================================================

// Manager
app.use(
  '/api/manager',
  authenticateToken,
  managerRoutes
);

// Admin
app.use(
  '/api/admin',
  authenticateToken,
  adminRoutes
);

// Uploads
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
    `📦 React frontend found: ${frontendDistPath}`
  );

  // Serve Vite static assets
  app.use(
    express.static(frontendDistPath, {
      index: false,
    })
  );

  // React Router fallback
  //
  // Express 5:
  // /{*splat} matches "/" and all nested routes.
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(
      path.join(frontendDistPath, 'index.html')
    );
  });
} else {
  console.warn(
    `⚠️ React build not found: ${frontendDistPath}`
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
// CENTRAL ERROR HANDLER
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
  app.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        `🚀 MÉRAR SaaS Server listening on port ${PORT}`
      );

      console.log(
        `❤️ Health endpoint: /api/health`
      );

      console.log(
        `🌐 Frontend: /`
      );
    }
  );
}

export default app;  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header
      // e.g. curl, server-to-server requests, health checks
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
// Static Uploads
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
// Public API Routes
// ============================================================

// Authentication routes
// Login / Register / etc.
app.use('/api/auth', authRoutes);

// Public restaurant/menu/events/table routes
app.use('/api/public', publicRoutes);

// ============================================================
// Protected API Routes
// ============================================================

// Manager routes require authentication
app.use(
  '/api/manager',
  authenticateToken,
  managerRoutes
);

// Admin routes require authentication
app.use(
  '/api/admin',
  authenticateToken,
  adminRoutes
);

// Upload routes require authentication
app.use(
  '/api/uploads',
  authenticateToken,
  uploadRoutes
);

// ============================================================
// Health Check
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
// React Frontend
// ============================================================

const frontendDistPath = path.resolve(
  process.cwd(),
  'dist'
);

// Only serve the React application if the build exists
if (fs.existsSync(frontendDistPath)) {
  console.log(
    `📦 Serving React frontend from: ${frontendDistPath}`
  );

  // Serve Vite generated static files
  app.use(
    express.static(frontendDistPath, {
      index: false,
    })
  );

  // React SPA fallback
  //
  // Express 5 syntax:
  // /{*splat}
  //
  // This allows React Router routes such as:
  // /login
  // /dashboard
  // /restaurant/abc
  // /admin
  // etc.
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(
      path.join(frontendDistPath, 'index.html')
    );
  });
} else {
  console.warn(
    `⚠️ React frontend build not found at: ${frontendDistPath}`
  );
}

// ============================================================
// 404 Handler
// ============================================================

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint Not Found',
    statusCode: 404,
  });
});

// ============================================================
// Centralized Error Handling
// ============================================================

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Server error:', err);

    const statusCode = err.status || 500;

    res.status(statusCode).json({
      success: false,
      error:
        process.env.NODE_ENV === 'production'
          ? err.message || 'Internal Server Error'
          : err.message || 'Internal Server Error',
      statusCode,
    });
  }
);

// ============================================================
// Start Server
// ============================================================

if (process.env.NODE_ENV !== 'test') {
  app.listen(
    Number(PORT),
    '0.0.0.0',
    () => {
      console.log(
        `🚀 MÉRAR SaaS Server listening on http://0.0.0.0:${PORT}`
      );

      console.log(
        `🌐 Frontend: http://0.0.0.0:${PORT}/`
      );

      console.log(
        `❤️ Health: http://0.0.0.0:${PORT}/api/health`
      );
    }
  );
}

export default app;}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Static uploads serving
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

// Attach Auth Token Middleware
app.use(authenticateToken);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    database: 'PostgreSQL 17',
  });
});

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint Not Found', statusCode: 404 });
});

// Centralized Error Handling Middleware (Never leak stack traces in production)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal Server Error',
    statusCode,
  });
});

// تعديل السطر الخاص بالاستماع في نهاية ملف server/index.ts
if (process.env.NODE_ENV !== 'test') {
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🚀 MÉRAR SaaS API Server listening on http://0.0.0.0:${PORT}`);
  });
}

export default app;
