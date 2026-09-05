import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import dotenv from 'dotenv';

import { authenticateToken } from './middleware/auth';
import authRoutes from './routes/auth';
import publicRoutes from './routes/public';
import managerRoutes from './routes/manager';
import adminRoutes from './routes/admin';
import uploadRoutes from './routes/uploads';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);

// Security & Performance Middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: (origin, callback) => {
    // السماح بالطلبات التي لا تحتوي على origin (مثل طلبات curl أو الصحة /api/health)
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));
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
