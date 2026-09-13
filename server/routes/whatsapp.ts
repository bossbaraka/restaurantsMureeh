import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  requireAuth,
  requireManager,
  isPlatformUser,
} from '../middleware/auth';
import { prisma } from '../db/prisma';
import {
  getSafeWhatsAppConfig,
  upsertWhatsAppIntegration,
  getWhatsAppProviderForRestaurant,
} from '../services/whatsapp/configService';
import { logAuditEvent } from '../services/audit';
import { normalizePhoneNumber, redactPhone } from '../services/whatsapp/phone';
import { getAllTemplateMappings } from '../services/whatsapp/templateRegistry';
import { config } from '../config';
import { whatsappConfigLimiter, whatsappTestLimiter } from '../middleware/rateLimit';

const router = Router();

router.use(requireAuth);
router.use(whatsappConfigLimiter);

// Tenant resolution helper
function getTenantId(req: Request): string | undefined {
  if (isPlatformUser(req)) {
    return (req.query.restaurantId as string) || req.body?.restaurantId || req.user?.restaurantId || undefined;
  }
  return req.user?.restaurantId || undefined;
}

function ownTenant(req: Request, restaurantId: string | null | undefined): boolean {
  return !!restaurantId && (isPlatformUser(req) || req.user!.restaurantId === restaurantId);
}

function deny(req: Request, res: Response, msg = 'غير مصرح لك بالوصول لبيانات هذا المطعم') {
  if (req.user) {
    logAuditEvent({
      restaurantId: req.user.restaurantId,
      userId: req.user.id,
      actor: req.user.name,
      actorRole: req.user.role,
      action: 'TENANT_ACCESS_DENIED',
      details: `محاولة وصول مرفوضة عبر ${req.method} ${req.path}: ${msg}`,
      ipAddress: req.ip,
    }).catch(() => undefined);
  }
  return res.status(403).json({ success: false, error: msg, statusCode: 403 });
}

// Validation schemas
const whatsappConfigSchema = z
  .object({
    restaurantId: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    phoneNumberId: z.string().trim().max(100).optional().or(z.literal('')),
    wabaId: z.string().trim().max(100).optional().or(z.literal('')),
    accessToken: z.string().trim().max(500).optional().or(z.literal('')),
    displayPhoneNumber: z.string().trim().max(30).optional().or(z.literal('')),
    status: z.enum(['PENDING', 'ACTIVE', 'DISABLED', 'FAILED']).optional(),
    metadata: z.any().optional(),
  })
  .strict();

const testMessageSchema = z
  .object({
    restaurantId: z.string().min(1).optional(),
    to: z.string().trim().min(7).max(30),
    templateName: z.string().trim().max(100).optional(),
    languageCode: z.string().trim().max(10).optional(),
    variables: z.array(z.string().max(1024)).max(10).optional(),
  })
  .strict();

/**
 * GET /api/manager/whatsapp
 * Get WhatsApp integration config for restaurant (safe, no secrets)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: 'restaurantId is required', statusCode: 400 });
    }
    if (!ownTenant(req, restaurantId)) return deny(req, res);

    const safeConfig = await getSafeWhatsAppConfig(restaurantId);

    if (!safeConfig) {
      return res.json({
        success: true,
        data: {
          config: null,
          message: 'لم يتم إعداد واتساب لهذا المطعم بعد',
          globalEnabled: config.whatsappEnabled,
          templates: getAllTemplateMappings().map((t) => ({
            eventType: t.eventType,
            templateName: t.templateName,
            languageCode: t.languageCode,
            description: t.description,
            descriptionAr: t.descriptionAr,
            example: t.example,
          })),
        },
        statusCode: 200,
      });
    }

    return res.json({
      success: true,
      data: {
        config: safeConfig,
        templates: getAllTemplateMappings().map((t) => ({
          eventType: t.eventType,
          templateName: t.templateName,
          languageCode: t.languageCode,
          description: t.description,
          descriptionAr: t.descriptionAr,
          example: t.example,
        })),
      },
      statusCode: 200,
    });
  } catch (err) {
    console.error('Get WhatsApp config error:', err);
    return res.status(500).json({ success: false, error: 'تعذر استرجاع إعدادات واتساب', statusCode: 500 });
  }
});

/**
 * PUT /api/manager/whatsapp
 * Update WhatsApp integration config (manager only)
 */
router.put('/', requireManager(), async (req: Request, res: Response) => {
  try {
    const parsed = whatsappConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(400).json({
        success: false,
        error: issue ? `${issue.message} (${issue.path.join('.')})` : 'بيانات غير صالحة',
        statusCode: 400,
      });
    }

    const restaurantId = getTenantId(req);
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: 'restaurantId is required', statusCode: 400 });
    }
    if (!ownTenant(req, restaurantId)) return deny(req, res);

    const { enabled, phoneNumberId, wabaId, accessToken, displayPhoneNumber, status, metadata } = parsed.data;

    // Validate displayPhoneNumber if provided
    if (displayPhoneNumber) {
      const normalized = normalizePhoneNumber(displayPhoneNumber);
      if (!normalized) {
        return res.status(400).json({ success: false, error: 'رقم الهاتف للعرض غير صالح', statusCode: 400 });
      }
    }

    // If enabling, require at least phoneNumberId and accessToken (or global fallback)
    if (enabled === true) {
      const hasPhoneId = phoneNumberId || (await prisma.whatsAppIntegration.findUnique({ where: { restaurantId } }))?.phoneNumberId || config.whatsappPhoneNumberId;
      const hasToken = accessToken || (await prisma.whatsAppIntegration.findUnique({ where: { restaurantId } }))?.accessToken || config.whatsappAccessToken;
      if (!hasPhoneId) {
        return res.status(400).json({ success: false, error: 'phoneNumberId مطلوب لتفعيل واتساب', statusCode: 400 });
      }
      if (!hasToken) {
        return res.status(400).json({ success: false, error: 'accessToken مطلوب لتفعيل واتساب', statusCode: 400 });
      }
    }

    const updated = await upsertWhatsAppIntegration(restaurantId, {
      enabled,
      phoneNumberId: phoneNumberId || undefined,
      wabaId: wabaId || undefined,
      accessToken: accessToken || undefined,
      displayPhoneNumber: displayPhoneNumber || undefined,
      status: status as any,
      metadata,
    });

    await logAuditEvent({
      restaurantId,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'WHATSAPP_CONFIG_UPDATED',
      entity: 'WhatsAppIntegration',
      entityId: restaurantId,
      details: `تم تحديث إعدادات واتساب للمطعم ${restaurantId} — enabled=${updated.enabled} phoneId=${updated.phoneNumberId ? '***' : 'none'}`,
      ipAddress: req.ip,
    });

    return res.json({ success: true, data: { config: updated }, statusCode: 200 });
  } catch (err) {
    console.error('Update WhatsApp config error:', err);
    return res.status(500).json({ success: false, error: 'تعذر تحديث إعدادات واتساب', statusCode: 500 });
  }
});

/**
 * POST /api/manager/whatsapp/test
 * Send test WhatsApp message (manager only)
 */
router.post('/test', requireManager(), whatsappTestLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = testMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(400).json({
        success: false,
        error: issue ? `${issue.message} (${issue.path.join('.')})` : 'بيانات غير صالحة',
        statusCode: 400,
      });
    }

    const restaurantId = getTenantId(req);
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: 'restaurantId is required', statusCode: 400 });
    }
    if (!ownTenant(req, restaurantId)) return deny(req, res);

    const { to, templateName, languageCode, variables } = parsed.data;

    const normalizedTo = normalizePhoneNumber(to);
    if (!normalizedTo) {
      return res.status(400).json({ success: false, error: 'رقم الهاتف المستلم غير صالح، استخدم صيغة دولية مثل +970599123456', statusCode: 400 });
    }

    const provider = await getWhatsAppProviderForRestaurant(restaurantId);
    if (!provider) {
      return res.status(400).json({ success: false, error: 'إعدادات واتساب غير مكتملة أو غير مفعلة', statusCode: 400 });
    }

    // Default to order_ready template for testing if not specified
    const testTemplate = templateName || 'order_ready';
    const testLang = languageCode || 'ar';
    const testVars = variables || ['عميل تجريبي', '#9999'];

    try {
      const result = await provider.sendTemplate({
        to: normalizedTo,
        templateName: testTemplate,
        languageCode: testLang,
        variables: testVars,
      });

      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'WHATSAPP_TEST_SENT',
        entity: 'WhatsAppIntegration',
        entityId: restaurantId,
        details: `تم إرسال رسالة واتساب تجريبية إلى ${redactPhone(normalizedTo)} template=${testTemplate} msgId=${result.messageId}`,
        ipAddress: req.ip,
      });

      // Create a notification log for the test
      await prisma.notificationLog.create({
        data: {
          restaurantId,
          channel: 'WHATSAPP',
          eventType: 'ORDER_READY',
          recipientPhone: to,
          recipientPhoneE164: normalizedTo,
          templateName: testTemplate,
          providerMessageId: result.messageId,
          status: 'SENT',
          metadata: {
            test: true,
            templateLanguage: testLang,
            variables: testVars,
          },
        },
      }).catch(() => {});

      return res.json({
        success: true,
        data: {
          messageId: result.messageId,
          to: redactPhone(normalizedTo),
          template: testTemplate,
        },
        statusCode: 200,
      });
    } catch (sendErr: any) {
      console.error('[WhatsApp Test] Send failed', sendErr);
      return res.status(400).json({
        success: false,
        error: `فشل إرسال الرسالة التجريبية: ${sendErr?.message || 'خطأ غير معروف'}`,
        statusCode: 400,
      });
    }
  } catch (err) {
    console.error('WhatsApp test error:', err);
    return res.status(500).json({ success: false, error: 'تعذر إرسال الرسالة التجريبية', statusCode: 500 });
  }
});

/**
 * GET /api/manager/whatsapp/logs
 * Get notification logs for restaurant (paginated)
 */
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const restaurantId = getTenantId(req);
    if (!restaurantId) {
      return res.status(400).json({ success: false, error: 'restaurantId is required', statusCode: 400 });
    }
    if (!ownTenant(req, restaurantId)) return deny(req, res);

    const take = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const skip = parseInt(req.query.offset as string) || 0;

    const logs = await prisma.notificationLog.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        order: {
          select: { id: true, numericId: true, status: true },
        },
      },
    });

    // Redact phone numbers in response
    const safeLogs = logs.map((log) => ({
      id: log.id,
      restaurantId: log.restaurantId,
      orderId: log.orderId,
      order: log.order,
      channel: log.channel,
      eventType: log.eventType,
      recipientPhone: log.recipientPhoneE164 ? redactPhone(log.recipientPhoneE164) : redactPhone(log.recipientPhone),
      templateName: log.templateName,
      providerMessageId: log.providerMessageId,
      status: log.status,
      failureReason: log.failureReason,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
    }));

    return res.json({ success: true, data: safeLogs, statusCode: 200 });
  } catch (err) {
    console.error('Get WhatsApp logs error:', err);
    return res.status(500).json({ success: false, error: 'تعذر استرجاع سجل الإشعارات', statusCode: 500 });
  }
});

export default router;
