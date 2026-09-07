import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';
import { signToken, requireAuth } from '../middleware/auth';
import {
  loginLimiter,
  pinLimiter,
  passwordResetLimiter,
} from '../middleware/rateLimit';
import {
  validateBody,
  loginSchema,
  pinLoginSchema,
} from '../validation/schemas';
import { logAuditEvent } from '../services/audit';

const router = Router();

// A pre-computed bcrypt hash used to flatten login timing when the
// account does not exist (user-enumeration hardening).
const DUMMY_HASH = bcrypt.hashSync('mureeh-dummy-credential', 10);

function publicUserShape(user: {
  id: string;
  restaurantId: string | null;
  name: string;
  email: string;
  role: string;
  avatar: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    restaurantId: user.restaurantId,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    createdAt: user.createdAt,
  };
}

// POST /api/auth/login — credential login, real accounts only.
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
      const normalizedEmail = email.toLowerCase();

      const user = await prisma.restaurantUser.findUnique({
        where: { email: normalizedEmail },
        include: { restaurant: true },
      });

      // Uniform response + uniform work factor: unknown accounts cost
      // the same as a failed password so timing reveals nothing.
      const hashToCheck = user ? user.passwordHash : DUMMY_HASH;
      const isMatch = await bcrypt.compare(password, hashToCheck);
      if (!user || !isMatch) {
        return res.status(401).json({
          success: false,
          error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
          statusCode: 401,
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

      const token = signToken({
        id: user.id,
        restaurantId: user.restaurantId,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        tv: user.tokenVersion,
      });

      await prisma.restaurantUser.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      await logAuditEvent({
        restaurantId: user.restaurantId,
        userId: user.id,
        actor: user.name,
        actorRole: user.role,
        action: 'LOGIN',
        details: `تسجيل دخول ناجح للمستخدم ${user.name} (${user.email})`,
      });

      return res.json({
        success: true,
        data: {
          user: publicUserShape(user),
          restaurant: user.restaurant,
          token,
        },
        statusCode: 200,
      });
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
        error: 'حدث خطأ في الخادم أثناء تسجيل الدخول',
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
          role: user.role,
          avatar: user.avatar,
        },
        restaurant: user.restaurant,
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

// POST /api/auth/pin — staff PIN login, strictly tenant-scoped.
// restaurantId is REQUIRED: the same PIN in two venues must never
// authenticate against the wrong tenant.
router.post(
  '/pin',
  pinLimiter,
  validateBody(pinLoginSchema),
  async (req: Request, res: Response) => {
    try {
      const { pin, restaurantId } = req.body as {
        pin: string;
        restaurantId: string;
      };

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true, status: true },
      });
      if (!restaurant || restaurant.status !== 'ACTIVE') {
        return res.status(401).json({
          success: false,
          error: 'رمز PIN غير صحيح. يرجى مراجعة مدير المطعم.',
          statusCode: 401,
        });
      }

      // Tenant-scoped candidates only. Platform admins must use
      // password login — never a staff PIN.
      const candidates = await prisma.restaurantUser.findMany({
        where: {
          status: 'ACTIVE',
          restaurantId,
          pinHash: { not: null },
          role: { notIn: ['PLATFORM_ADMIN', 'SUPER_ADMIN'] },
        },
        include: { restaurant: true },
      });

      let user: (typeof candidates)[number] | undefined;
      for (const candidate of candidates) {
        if (
          candidate.pinHash &&
          (await bcrypt.compare(pin, candidate.pinHash))
        ) {
          user = candidate;
          break;
        }
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'رمز PIN غير صحيح. يرجى مراجعة مدير المطعم.',
          statusCode: 401,
        });
      }

      const token = signToken({
        id: user.id,
        restaurantId: user.restaurantId,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        tv: user.tokenVersion,
      });

      await prisma.restaurantUser.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      await logAuditEvent({
        restaurantId: user.restaurantId,
        userId: user.id,
        actor: user.name,
        actorRole: user.role,
        action: 'STAFF_PIN_LOGIN',
        details: `تسجيل دخول ناجح برمز PIN للمستخدم ${user.name} (${user.email})`,
      });

      return res.json({
        success: true,
        data: {
          user: publicUserShape(user),
          restaurant: user.restaurant,
          token,
        },
        statusCode: 200,
      });
    } catch (err) {
      console.error('PIN login error:', err);
      return res.status(500).json({
        success: false,
        error: 'حدث خطأ في الخادم أثناء تسجيل الدخول برمز PIN',
        statusCode: 500,
      });
    }
  }
);

// POST /api/auth/password-reset-request — NOT IMPLEMENTED.
// There is no email delivery in this deployment, so a "success"
// response would be a lie that trains users to wait for mail that
// never arrives. Re-enable with a real token-mailer before launch.
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
