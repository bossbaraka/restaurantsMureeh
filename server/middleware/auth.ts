import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { TenantRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  restaurantId: string | null;
  name: string;
  email: string;
  role: TenantRole;
  status: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'merar_luxury_saas_jwt_secret_key_production_2026';

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      restaurantId: user.restaurantId,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'انتهت صلاحية جلسة الدخول. يرجى إعادة تسجيل الدخول.',
      statusCode: 401,
    });
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'يجب تسجيل الدخول أولاً للوصول إلى هذه الخاصية',
      statusCode: 401,
    });
  }
  next();
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== 'PLATFORM_ADMIN' && req.user.role !== 'SUPER_ADMIN')) {
    return res.status(403).json({
      success: false,
      error: 'غير مصرح لك بالوصول. صلاحيات المشرف العام على المنصة مطلوبة.',
      statusCode: 403,
    });
  }
  next();
}

export function requireTenantAccess(getRestaurantId: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'تسجيل الدخول مطلوب',
        statusCode: 401,
      });
    }

    // Super Admin / Platform Admin can manage all restaurants
    if (req.user.role === 'PLATFORM_ADMIN' || req.user.role === 'SUPER_ADMIN') {
      return next();
    }

    const targetRestaurantId = getRestaurantId(req);
    if (!targetRestaurantId || req.user.restaurantId !== targetRestaurantId) {
      return res.status(403).json({
        success: false,
        error: 'غير مصرح لك بالوصول لبيانات هذا المطعم (Tenant Isolation Violation)',
        statusCode: 403,
      });
    }

    next();
  };
}
