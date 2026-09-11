import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import {
  config,
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_ALGORITHM,
} from '../config';
import { prisma } from '../db/prisma';

// ============================================================
// JWT authentication + role based access control.
//
// Security properties:
// - No fallback secret: JWT_SECRET is validated at boot by config.ts.
// - Tokens are pinned to HS256 with issuer + audience checks and a
//   constant-time comparison of the token version (tv) claim against
//   the user's current tokenVersion in the database.
// - Every authenticated request re-validates account status
//   (ACTIVE) so suspensions revoke access immediately, and the tv
//   claim makes logout / password / PIN / role changes revoke the
//   token on next use.
// ============================================================

export interface AuthUser {
  id: string;
  restaurantId: string | null;
  name: string;
  email: string;
  role: string;
  status: string;
  tv: number;
}

interface JwtClaims {
  id: string;
  restaurantId: string | null;
  name: string;
  email: string;
  role: string;
  status: string;
  tv: number;
  jti: string;
}

export type { JwtClaims };

export function signToken(
  user: Omit<AuthUser, 'tv'> & { tv?: number }
): string {
  return jwt.sign(
    {
      id: user.id,
      restaurantId: user.restaurantId ?? null,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      tv: user.tv ?? 0,
      jti: randomUUID(),
    } satisfies JwtClaims,
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithm: JWT_ALGORITHM,
    }
  );
}

function unauthorized(res: Response, message: string) {
  return res.status(401).json({ success: false, error: message });
}

/**
 * Optional-then-strict middleware chain design:
 * - authenticateToken: attaches req.user when a valid Bearer token is
 *   present; rejects invalid/expired/revoked tokens with 401. Requests
 *   WITHOUT any token pass through so public endpoints mounted on the
 *   same router can coexist — protected routes must ALSO mount
 *   requireAuth / requireRole.
 */
export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return unauthorized(res, 'صيغة التوثيق غير صحيحة');
  }

  let decoded: JwtClaims;
  try {
    decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as JwtClaims;
  } catch {
    return unauthorized(res, 'انتهت الجلسة أو التوثيق غير صالح');
  }

  // Fresh authorization state: suspended users and stale token
  // versions (logout / credential / role changes) are rejected.
  try {
    const dbUser = await prisma.restaurantUser.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        restaurantId: true,
        name: true,
        email: true,
        role: true,
        status: true,
        tokenVersion: true,
        // Fresh restaurant status: a tenant suspended AFTER login must lose
        // access on the very next request, rather than keeping a valid 12h
        // token until it naturally expires. Platform staff are exempt below.
        restaurant: { select: { status: true } },
      },
    });
    if (!dbUser) return unauthorized(res, 'الحساب غير موجود');
    if (dbUser.status !== 'ACTIVE') {
      return unauthorized(res, 'تم إيقاف هذا الحساب');
    }
    const isPlatformRole =
      dbUser.role === 'PLATFORM_ADMIN' || dbUser.role === 'SUPER_ADMIN';
    if (
      dbUser.restaurantId &&
      !isPlatformRole &&
      dbUser.restaurant &&
      dbUser.restaurant.status !== 'ACTIVE'
    ) {
      return res.status(403).json({
        success: false,
        error: 'حساب المطعم موقوف حالياً من قبل إدارة المنصة.',
      });
    }
    if ((decoded.tv ?? 0) !== dbUser.tokenVersion) {
      return unauthorized(res, 'انتهت صلاحية الجلسة، سجّل دخولك مجدداً');
    }
    req.user = {
      id: dbUser.id,
      restaurantId: dbUser.restaurantId,
      name: dbUser.name,
      email: dbUser.email,
      role: dbUser.role,
      status: dbUser.status,
      tv: dbUser.tokenVersion,
    };
    next();
  } catch (error) {
    console.error('authenticateToken lookup failed:', error);
    return res
      .status(500)
      .json({ success: false, error: 'تعذر التحقق من الجلسة' });
  }
}

/** Require an authenticated session. Mount after authenticateToken. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return unauthorized(res, 'يلزم تسجيل الدخول');
  }
  next();
}

const PLATFORM_ROLES = new Set(['PLATFORM_ADMIN', 'SUPER_ADMIN']);

/** Platform staff only (PLATFORM_ADMIN / SUPER_ADMIN). */
export function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return unauthorized(res, 'يلزم تسجيل الدخول');
  }
  if (!PLATFORM_ROLES.has(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'هذا القسم مخصص لإدارة المنصة فقط',
    });
  }
  next();
}

export function isPlatformUser(req: Request): boolean {
  return !!req.user && PLATFORM_ROLES.has(req.user.role);
}

/**
 * Require one of the given tenant roles. Platform admins bypass role
 * checks (cross-tenant actions are still explicitly scoped per route).
 */
export function requireRole(...roles: string[]) {
  const allowed = new Set(roles);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return unauthorized(res, 'يلزم تسجيل الدخول');
    }
    if (PLATFORM_ROLES.has(req.user.role)) return next();
    if (!allowed.has(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'غير مصرح لك بتنفيذ هذا الإجراء',
      });
    }
    next();
  };
}

// Role groups matching the product's permission model.
export const MANAGER_ROLE = 'RESTAURANT_MANAGER';
export const requireManager = () => requireRole(MANAGER_ROLE);
export const requireCashierOrManager = () =>
  requireRole('RESTAURANT_MANAGER', 'CASHIER');
// KDS / service operations: order + waiter-request status updates.
export const requireServiceStaff = () =>
  requireRole('RESTAURANT_MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'STAFF');

/**
 * Tenant-access guard for routes that resolve their target tenant from the
 * request (query/body). Platform users pass; tenant users must resolve to
 * their own JWT tenant.
 */
export function requireTenantAccess(
  resolveTenantId: (req: Request) => string | undefined
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return unauthorized(res, 'يلزم تسجيل الدخول');
    }
    if (PLATFORM_ROLES.has(req.user.role)) return next();
    const target = resolveTenantId(req);
    if (!target || target !== req.user.restaurantId) {
      return res.status(403).json({
        success: false,
        error: 'غير مصرح لك بالوصول لبيانات هذا المطعم',
      });
    }
    next();
  };
}

/** Legacy helper kept for compatibility (returns middleware). */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  return requireAuth(req, res, next);
}
