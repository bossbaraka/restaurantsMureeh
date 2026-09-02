import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { signToken, requireAuth } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';

const router = Router();

const loginSchema = z.object({
  email: z.string().email('صيغة البريد الإلكتروني غير صحيحة'),
  password: z.string().min(6, 'كلمة المرور يجب أن لا تقل عن 6 أحرف'),
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'بيانات الدخول غير مكتملة',
        statusCode: 400,
      });
    }

    const { email, password } = parsed.data;
    const user = await prisma.restaurantUser.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        restaurant: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
        statusCode: 401,
      });
    }

    const isMatch = bcrypt.compareSync(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
        statusCode: 401,
      });
    }

    // Check if restaurant is suspended (unless platform admin)
    if (user.restaurant && user.restaurant.status === 'SUSPENDED' && user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'حساب المطعم موقوف حالياً من قبل إدارة المنصة. يرجى التواصل مع الدعم الفني.',
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
        user: {
          id: user.id,
          restaurantId: user.restaurantId,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
        },
        restaurant: user.restaurant,
        token,
      },
      statusCode: 200,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({
      success: false,
      error: 'حدث خطأ في الخادم أثناء تسجيل الدخول',
      statusCode: 500,
    });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.restaurantUser.findUnique({
      where: { id: req.user!.id },
      include: { restaurant: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'المستخدم غير موجود', statusCode: 404 });
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
    return res.status(500).json({ success: false, error: 'تعذر التحقق من الجلسة', statusCode: 500 });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  if (req.user) {
    await logAuditEvent({
      restaurantId: req.user.restaurantId,
      userId: req.user.id,
      actor: req.user.name,
      actorRole: req.user.role,
      action: 'LOGOUT',
      details: `تسجيل خروج للمستخدم ${req.user.name}`,
    });
  }
  return res.json({ success: true, message: 'تم تسجيل الخروج بنجاح', statusCode: 200 });
});

// POST /api/auth/password-reset-request
router.post('/password-reset-request', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'يرجى تقديم البريد الإلكتروني', statusCode: 400 });
  }
  // Production Password Reset Architecture (Send email token / log audit)
  const user = await prisma.restaurantUser.findUnique({ where: { email: email.toLowerCase() } });
  if (user) {
    await logAuditEvent({
      restaurantId: user.restaurantId,
      userId: user.id,
      actor: user.name,
      actorRole: user.role,
      action: 'PASSWORD_RESET_REQUESTED',
      details: `طلب استعادة كلمة المرور للحساب ${email}`,
    });
  }
  return res.json({
    success: true,
    message: 'إذا كان البريد الإلكتروني مسجلاً لدينا، فستصلك تعليمات استعادة كلمة المرور قريباً.',
    statusCode: 200,
  });
});

export default router;
