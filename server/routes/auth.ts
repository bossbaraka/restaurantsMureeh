import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';
import type { TenantRole } from '@prisma/client';
import { config } from '../config';
import {
  getStorage,
  assetNormalizerFor,
  assetUrlResolverFor,
  resolveRestaurantAssets,
} from '../services/storage';
import { signToken, signStepUpToken, requireAuth } from '../middleware/auth';
import {
  loginLimiter,
  employeeLoginLimiter,
  stepUpLimiter,
  passwordResetLimiter,
} from '../middleware/rateLimit';
import {
  validateBody,
  loginSchema,
  employeeLoginSchema,
  stepUpSchema,
} from '../validation/schemas';
import { logAuditEvent } from '../services/audit';

const router = Router();

// A pre-computed bcrypt hash used to flatten login timing when the
// account does not exist (user-enumeration hardening).
const DUMMY_HASH = bcrypt.hashSync('mureeh-dummy-credential', 10);

// Roles allowed on the email+password route. Shift staff (WAITER / KITCHEN /
// CASHIER / STAFF) MUST use /api/auth/employee-login — their accounts carry
// no usable password, so password auth for them is rejected outright
// (AUTH-01: legacy `Staff-{PIN}!` derived passwords are dead on this route).
const PASSWORD_LOGIN_ROLES = new Set([
  'RESTAURANT_MANAGER',
  'PLATFORM_ADMIN',
  'SUPER_ADMIN',
]);

// Shift roles served by /api/auth/employee-login.
const EMPLOYEE_LOGIN_ROLES = new Set(['WAITER', 'KITCHEN', 'CASHIER', 'STAFF']);

// ============================================================
// Per-account failure budget (AUTH-02 remediation).
//
// The per-IP rate limiters alone cannot stop distributed guessing of short
// PINs. This is a layered, NON-permanent lock:
//   * first 4 failures   → no lock (honest typos during a busy shift);
//   * 5th failure        → 30 s lock;
//   * each further fail  → doubles (60 s, 120 s, 240 s, 480 s …);
//   * hard cap           → 15 minutes (never permanent);
//   * any SUCCESS         → counters reset.
// A manager can always unlock early by re-issuing credentials from the staff
// screen (that update also revokes sessions). Lock status is only revealed
// after 5 failures on that exact identity — existence probing costs an
// attacker their per-IP budget first.
// ============================================================
const LOCK_THRESHOLD = 5;
const LOCK_BASE_MS = 30_000;
const LOCK_CAP_MS = 15 * 60_000;

function lockDurationMs(failedCount: number): number {
  if (failedCount < LOCK_THRESHOLD) return 0;
  const exp = failedCount - LOCK_THRESHOLD;
  return Math.min(LOCK_BASE_MS * 2 ** exp, LOCK_CAP_MS);
}

function lockRemainingSeconds(authLockedUntil: Date | null): number {
  if (!authLockedUntil) return 0;
  return Math.max(0, Math.ceil((authLockedUntil.getTime() - Date.now()) / 1000));
}

function publicUserShape(user: {
  id: string;
  restaurantId: string | null;
  name: string;
  email: string | null;
  role: string;
  username: string | null;
  avatar: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    restaurantId: user.restaurantId,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    avatar: user.avatar,
    createdAt: user.createdAt,
  };
}

// Resolve a persisted restaurant row's image fields through the single
// asset contract so login/me responses carry renderable URLs (plus the
// stable storage paths). Platform staff (no tenant) pass through as null.
let authAssetContract: {
  normalizer: ReturnType<typeof assetNormalizerFor>;
  toUrl: (key: string) => string;
} | null = null;
function publicRestaurantShape(
  restaurant: {
    logoUrl: string;
    coverImageUrl: string | null;
    mapImageUrl: string | null;
    galleryImages: string[];
  } | null | undefined
) {
  if (!restaurant) return null;
  if (!authAssetContract) {
    const storage = getStorage();
    authAssetContract = {
      normalizer: assetNormalizerFor(storage),
      toUrl: assetUrlResolverFor(storage, config.appUrl),
    };
  }
  return resolveRestaurantAssets(
    restaurant,
    authAssetContract.normalizer,
    authAssetContract.toUrl
  );
}

async function issueSession(
  req: Request,
  user: {
    id: string;
    restaurantId: string | null;
    name: string;
    email: string | null;
    username: string | null;
    role: TenantRole;
    status: string;
    tokenVersion: number;
    avatar: string | null;
    createdAt: Date;
  },
  restaurant: Parameters<typeof publicRestaurantShape>[0],
  auditAction: string
) {
  const token = signToken({
    id: user.id,
    restaurantId: user.restaurantId,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    tv: user.tokenVersion,
  });

  // Safely attempt non-fatal lastLoginAt update
  await prisma.restaurantUser
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => {});

  // Safely attempt audit logging
  await logAuditEvent({
    restaurantId: user.restaurantId,
    userId: user.id,
    actor: user.name,
    actorRole: user.role,
    action: auditAction,
    details: `تسجيل دخول ناجح للمستخدم ${user.name} (${user.email || user.username || user.id})`,
    ipAddress: req.ip,
  }).catch(() => {});

  return {
    success: true as const,
    data: {
      user: publicUserShape(user),
      restaurant: publicRestaurantShape(restaurant),
      token,
    },
    statusCode: 200 as const,
  };
}

async function recordAuthFailure(
  req: Request,
  user: { id: string; restaurantId: string | null; name: string; role: TenantRole },
  failedAuthCount: number,
  context: string
) {
  const nextCount = failedAuthCount + 1;
  const lockMs = lockDurationMs(nextCount);
  const lockedUntil = lockMs > 0 ? new Date(Date.now() + lockMs) : null;
  await prisma.restaurantUser
    .update({
      where: { id: user.id },
      data: {
        failedAuthCount: nextCount,
        lastAuthFailAt: new Date(),
        ...(lockedUntil ? { authLockedUntil: lockedUntil } : {}),
      },
    })
    .catch(() => {});
  await logAuditEvent({
    restaurantId: user.restaurantId,
    userId: user.id,
    actor: user.name,
    actorRole: user.role,
    action: 'LOGIN_FAILED',
    details: `محاولة دخول فاشلة (${context}) — المحاولات: ${nextCount}${lockedUntil ? ' — تم قفل الحساب مؤقتاً' : ''}`,
    ipAddress: req.ip,
  }).catch(() => {});
  return lockedUntil;
}

async function clearAuthFailures(userId: string) {
  await prisma.restaurantUser
    .update({
      where: { id: userId },
      data: {
        failedAuthCount: 0,
        authLockedUntil: null,
        lastAuthFailAt: null,
      },
    })
    .catch(() => {});
}

// POST /api/auth/login — email + strong password. Manager and platform
// roles ONLY. Demo accounts and hard-coded password overrides were
// permanently removed long ago (C-01); since the 2026-09 redesign, shift
// staff cannot use this route at all.
router.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as {
        email: string;
        password: string;
      };

      let user = await prisma.restaurantUser.findUnique({
        where: { email },
        include: { restaurant: true },
      });

      // Password comparison: bcrypt compare against user hash or dummy hash
      // (DUMMY_HASH) for timing attack prevention (uniform work factor).
      const hashToCheck = user ? user.passwordHash : DUMMY_HASH;
      const isMatch = await bcrypt.compare(password, hashToCheck);

      if (!user || !isMatch) {
        if (user) {
          await recordAuthFailure(req, user, user.failedAuthCount, 'بريد/كلمة مرور');
        }
        return res.status(401).json({
          success: false,
          error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
          statusCode: 401,
        });
      }

      // Shift staff never authenticate here — their accounts have no usable
      // password by policy (AUTH-01). The message intentionally tells them
      // where to go: they already proved knowledge of the (legacy) secret.
      if (!PASSWORD_LOGIN_ROLES.has(user.role)) {
        return res.status(403).json({
          success: false,
          error:
            'حسابات الموظفين تستخدم دخول الموظفين (رمز المطعم + اسم المستخدم + رمز PIN)',
          statusCode: 403,
        });
      }

      // Per-account progressive lock (checked AFTER the password proof so a
      // locked manager still gets the lock message, not a generic 401).
      const lockRemaining = lockRemainingSeconds(user.authLockedUntil);
      if (lockRemaining > 0) {
        return res.status(429).json({
          success: false,
          error: `محاولات دخول كثيرة لهذا الحساب. حاول مجدداً بعد ${lockRemaining} ثانية أو راجع مدير المطعم.`,
          statusCode: 429,
        });
      }

      if (user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
        return res.status(403).json({
          success: false,
          error: 'حساب المستخدم موقوف حالياً. يرجى التواصل مع إدارة المنظومة.',
          statusCode: 403,
        });
      }

      // Suspended restaurants cannot be used (platform staff exempt).
      if (
        user.restaurant &&
        user.restaurant.status !== 'ACTIVE' &&
        user.role !== 'SUPER_ADMIN' &&
        user.role !== 'PLATFORM_ADMIN'
      ) {
        return res.status(403).json({
          success: false,
          error:
            'حساب المطعم موقوف حالياً من قبل إدارة المنصة. يرجى التواصل مع الدعم الفني.',
          statusCode: 403,
        });
      }

      await clearAuthFailures(user.id);
      const payload = await issueSession(req, user, user.restaurant, 'LOGIN');
      return res.json(payload);
    } catch (err: unknown) {
      console.error('Login error:', err);
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'P2022'
      ) {
        return res.status(500).json({
          success: false,
          error:
            'جاري مزامنة هيكل قاعدة البيانات على الخادم. يرجى إعادة المحاولة خلال لحظات.',
          statusCode: 500,
        });
      }
      return res.status(500).json({
        success: false,
        error: 'حدث خطأ في الخادم أثناء تسجيل الدخول. يرجى التأكد من بيانات الدخول.',
        statusCode: 500,
      });
    }
  }
);

// POST /api/auth/employee-login — shift staff (WAITER / KITCHEN / CASHIER /
// STAFF): restaurant code + username + 6-digit PIN.
//
// Tenant resolution is server-side ONLY (from the public slug — an
// identifier, not a secret). The client never supplies a restaurantId.
// A username valid in Restaurant A can never authenticate into Restaurant B.
router.post(
  '/employee-login',
  employeeLoginLimiter,
  validateBody(employeeLoginSchema),
  async (req: Request, res: Response) => {
    try {
      const { restaurantCode, username, pin } = req.body as {
        restaurantCode: string;
        username: string;
        pin: string;
      };

      const restaurant = await prisma.restaurant.findUnique({
        where: { slug: restaurantCode },
      });

      // Unknown code / suspended venue → same generic failure as bad
      // credentials (no tenant-existence oracle; the slug is public anyway).
      if (!restaurant || restaurant.status !== 'ACTIVE') {
        await bcrypt.compare(pin, DUMMY_HASH);
        return res.status(401).json({
          success: false,
          error: 'رمز المطعم أو اسم المستخدم أو رمز PIN غير صحيح',
          statusCode: 401,
        });
      }

      const user = await prisma.restaurantUser.findUnique({
        where: {
          restaurantId_username: {
            restaurantId: restaurant.id,
            username,
          },
        },
        include: { restaurant: true },
      });

      // Generic failure for: unknown username, platform/manager role (they
      // use password login), no PIN issued yet, or inactive account.
      const eligible =
        !!user &&
        EMPLOYEE_LOGIN_ROLES.has(user.role) &&
        !!user.pinHash &&
        user.status === 'ACTIVE';

      if (!eligible) {
        if (user) {
          await recordAuthFailure(req, user, user.failedAuthCount, 'دخول موظف');
        } else {
          await bcrypt.compare(pin, DUMMY_HASH);
        }
        return res.status(401).json({
          success: false,
          error: 'رمز المطعم أو اسم المستخدم أو رمز PIN غير صحيح',
          statusCode: 401,
        });
      }

      // Per-account progressive lock — checked after resolving the account
      // but BEFORE the bcrypt work, so locked accounts fail fast.
      const lockRemaining = lockRemainingSeconds(user.authLockedUntil);
      if (lockRemaining > 0) {
        return res.status(429).json({
          success: false,
          error: `محاولات دخول كثيرة لهذا الحساب. حاول مجدداً بعد ${lockRemaining} ثانية أو راجع مدير المطعم.`,
          statusCode: 429,
        });
      }

      const isMatch = await bcrypt.compare(pin, user.pinHash!);
      if (!isMatch) {
        const lockedUntil = await recordAuthFailure(
          req,
          user,
          user.failedAuthCount,
          'دخول موظف (PIN)'
        );
        if (lockedUntil) {
          return res.status(429).json({
            success: false,
            error: `رمز PIN غير صحيح، وتم قفل الحساب مؤقتاً (${Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)} ثانية) بسبب المحاولات المتكررة.`,
            statusCode: 429,
          });
        }
        return res.status(401).json({
          success: false,
          error: 'رمز المطعم أو اسم المستخدم أو رمز PIN غير صحيح',
          statusCode: 401,
        });
      }

      await clearAuthFailures(user.id);
      const payload = await issueSession(
        req,
        user,
        user.restaurant,
        'EMPLOYEE_PIN_LOGIN'
      );
      return res.json(payload);
    } catch (err: unknown) {
      console.error('Employee login error:', err);
      return res.status(500).json({
        success: false,
        error: 'حدث خطأ في الخادم أثناء تسجيل دخول الموظف',
        statusCode: 500,
      });
    }
  }
);

// POST /api/auth/step-up — fresh re-verification for sensitive operations
// (payment void, staff credential/role/status changes, staff deletion).
// Managers/platform: current password. Shift staff: current PIN. Returns a
// 5-minute step-up token bound to the user's CURRENT tokenVersion.
router.post(
  '/step-up',
  requireAuth,
  stepUpLimiter,
  validateBody(stepUpSchema),
  async (req: Request, res: Response) => {
    try {
      const { password, pin } = req.body as {
        password?: string;
        pin?: string;
      };
      if (!password && !pin) {
        return res.status(400).json({
          success: false,
          error: 'أدخل كلمة المرور أو رمز PIN لتأكيد الهوية',
          statusCode: 400,
        });
      }

      const user = await prisma.restaurantUser.findUnique({
        where: { id: req.user!.id },
      });
      if (!user || user.status !== 'ACTIVE') {
        return res.status(401).json({
          success: false,
          error: 'الحساب غير متاح',
          statusCode: 401,
        });
      }

      const lockRemaining = lockRemainingSeconds(user.authLockedUntil);
      if (lockRemaining > 0) {
        return res.status(429).json({
          success: false,
          error: `محاولات كثيرة. حاول مجدداً بعد ${lockRemaining} ثانية.`,
          statusCode: 429,
        });
      }

      let verified = false;
      if (password && user.passwordHash) {
        verified = await bcrypt.compare(password, user.passwordHash);
      } else if (pin && user.pinHash) {
        verified = await bcrypt.compare(pin, user.pinHash);
      }

      if (!verified) {
        await recordAuthFailure(req, user, user.failedAuthCount, 'تأكيد هوية');
        await logAuditEvent({
          restaurantId: user.restaurantId,
          userId: user.id,
          actor: user.name,
          actorRole: user.role,
          action: 'STEP_UP_FAILED',
          details: 'فشل تأكيد الهوية لإجراء حساس',
          ipAddress: req.ip,
        }).catch(() => {});
        return res.status(401).json({
          success: false,
          error: 'كلمة المرور أو رمز PIN غير صحيح',
          statusCode: 401,
        });
      }

      await clearAuthFailures(user.id);
      const stepUpToken = signStepUpToken({ id: user.id, tv: user.tokenVersion });
      await logAuditEvent({
        restaurantId: user.restaurantId,
        userId: user.id,
        actor: user.name,
        actorRole: user.role,
        action: 'STEP_UP_VERIFIED',
        details: 'تم تأكيد الهوية لإجراء حساس',
        ipAddress: req.ip,
      }).catch(() => {});

      return res.json({
        success: true,
        data: {
          stepUpToken,
          expiresInSeconds: 300,
        },
        statusCode: 200,
      });
    } catch (err: unknown) {
      console.error('Step-up error:', err);
      return res.status(500).json({
        success: false,
        error: 'تعذر تأكيد الهوية',
        statusCode: 500,
      });
    }
  }
);

// GET /api/auth/me — current session identity (fresh from DB).
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.restaurantUser.findUnique({
      where: { id: req.user!.id },
      include: { restaurant: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'المستخدم غير موجود',
        statusCode: 404,
      });
    }

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          restaurantId: user.restaurantId,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
          avatar: user.avatar,
        },
        restaurant: publicRestaurantShape(user.restaurant),
      },
      statusCode: 200,
    });
  } catch (err) {
    console.error('Auth /me error:', err);
    return res.status(500).json({
      success: false,
      error: 'تعذر التحقق من الجلسة',
      statusCode: 500,
    });
  }
});

// POST /api/auth/logout — revokes the current token server-side by
// bumping the account token version, then the client drops its copy.
// (All-device revocation: per-device revocation needs server-side
// sessions — documented in the auth architecture report, deliberately
// not in scope of this remediation.)
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    if (req.user) {
      await prisma.restaurantUser.update({
        where: { id: req.user.id },
        data: { tokenVersion: { increment: 1 } },
      });
      await logAuditEvent({
        restaurantId: req.user.restaurantId,
        userId: req.user.id,
        actor: req.user.name,
        actorRole: req.user.role,
        action: 'LOGOUT',
        details: `تسجيل خروج للمستخدم ${req.user.name}`,
        ipAddress: req.ip,
      });
    }
    return res.json({
      success: true,
      message: 'تم تسجيل الخروج بنجاح',
      statusCode: 200,
    });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({
      success: false,
      error: 'تعذر تسجيل الخروج',
      statusCode: 500,
    });
  }
});

// POST /api/auth/password-reset-request — NOT IMPLEMENTED.
// There is no email delivery in this deployment, so a "success"
// response would be a lie that trains users to wait for mail that
// never arrives. Managers reset staff credentials from the staff
// screen (audited); platform staff recovery is documented in ops.
router.post(
  '/password-reset-request',
  passwordResetLimiter,
  (_req: Request, res: Response) => {
    return res.status(501).json({
      success: false,
      error:
        'استعادة كلمة المرور عبر البريد غير مفعّلة بعد. يرجى مراجعة مدير المطعم لإعادة تعيين كلمة المرور.',
      statusCode: 501,
    });
  }
);

export default router;
