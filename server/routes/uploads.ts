import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireManager, isPlatformUser } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { logAuditEvent } from '../services/audit';
import {
  getStorage,
  normalizeKind,
  keyBelongsToRestaurant,
} from '../services/storage';
import {
  sniffImage,
  MAX_IMAGE_BYTES,
  isWithinUploadSizeLimit,
} from '../services/storage/imageSniff';

const router = Router();

// Memory storage: the file is inspected BEFORE anything is persisted, so a
// rejected upload never leaves attacker-controlled bytes behind.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
    fields: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('الملف يجب أن يكون صورة بصيغة JPG أو PNG أو WEBP'));
    }
  },
});

/**
 * Resolve the tenant an upload/delete belongs to. Tenant users always act on
 * their own JWT restaurantId; platform admins may target a tenant explicitly
 * via query/body (mirroring the tenant-resolution convention in manager.ts).
 */
function resolveTenantId(req: Request): string | undefined {
  if (isPlatformUser(req)) {
    return (
      (req.query.restaurantId as string) ||
      (typeof req.body?.restaurantId === 'string' ? req.body.restaurantId : undefined) ||
      undefined
    );
  }
  return req.user?.restaurantId || undefined;
}

// POST /api/uploads/image — tenant image upload (managers only).
// Form fields: `image` (file), optional `kind` (logo|cover|gallery|product|…).
router.post(
  '/image',
  requireManager(),
  uploadLimiter,
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: 'لم يتم استلام أي صورة',
          statusCode: 400,
        });
      }

      // Size validation (defense-in-depth alongside the multer limit).
      if (!isWithinUploadSizeLimit(req.file.size)) {
        return res.status(400).json({
          success: false,
          error: `حجم الصورة يتجاوز الحد المسموح (${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`,
          statusCode: 400,
        });
      }

      // Magic-byte validation: MIME headers and filenames are attacker input.
      const sniffed = sniffImage(req.file.buffer);
      if (!sniffed) {
        return res.status(400).json({
          success: false,
          error: 'الملف ليس صورة حقيقية بصيغة JPG أو PNG أو WEBP أو GIF',
          statusCode: 400,
        });
      }

      const restaurantId = resolveTenantId(req);
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'restaurantId مطلوب لرفع الصورة',
          statusCode: 400,
        });
      }

      const kind = normalizeKind(req.body?.kind);

      const stored = await getStorage().upload({
        restaurantId,
        kind,
        buffer: req.file.buffer,
        mimeType: sniffed.mimeType,
        ext: sniffed.ext,
        size: req.file.size,
      });

      // Audit is best-effort: a logging failure must not fail the upload.
      await logAuditEvent({
        restaurantId,
        userId: req.user!.id,
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'IMAGE_UPLOADED',
        entity: 'Storage',
        entityId: stored.key,
        details: `رفع صورة (${kind}) بحجم ${stored.size} بايت`,
        metadata: { mimeType: stored.mimeType },
        ipAddress: req.ip,
      }).catch(() => undefined);

      // `url` is the permanent public URL the client persists in PostgreSQL;
      // `key` is the object key (needed for deletes and diagnostics).
      return res.json({
        success: true,
        data: {
          url: stored.url,
          pathUrl: stored.url,
          key: stored.key,
          filename: stored.key.split('/').pop(),
          size: stored.size,
          mimeType: stored.mimeType,
        },
        statusCode: 200,
      });
    } catch (err) {
      console.error('Image upload error:', err);
      return res.status(500).json({
        success: false,
        error: 'تعذر رفع الصورة إلى التخزين',
        statusCode: 500,
      });
    }
  }
);

// POST /api/uploads/delete — delete a previously uploaded image by URL.
// Body: { url }. Only the owning tenant (or a platform admin) may delete.
router.post('/delete', requireManager(), async (req: Request, res: Response) => {
  try {
    const { url } = (req.body ?? {}) as { url?: unknown };
    if (typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({
        success: false,
        error: 'url مطلوب لحذف الصورة',
        statusCode: 400,
      });
    }

    const storage = getStorage();
    const key = storage.keyFromUrl(url);

    // Not a URL this storage driver manages (external/CDN/legacy) — nothing
    // to delete; report success so callers can treat it as a no-op.
    if (!key) {
      return res.json({
        success: true,
        data: { deleted: false, key: null, reason: 'not-managed' },
        statusCode: 200,
      });
    }

    // Tenant isolation: a tenant can only delete files under its own folder.
    if (!isPlatformUser(req)) {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId || !keyBelongsToRestaurant(key, restaurantId)) {
        await logAuditEvent({
          restaurantId: req.user?.restaurantId ?? null,
          userId: req.user!.id,
          actor: req.user!.name,
          actorRole: req.user!.role,
          action: 'STORAGE_DELETE_DENIED',
          entity: 'Storage',
          entityId: key,
          details: `محاولة حذف ملف خارج نطاق المطعم: ${key}`,
          ipAddress: req.ip,
        }).catch(() => undefined);
        return res.status(403).json({
          success: false,
          error: 'غير مصرح لك بحذف هذا الملف',
          statusCode: 403,
        });
      }
    }

    await storage.delete(key);

    await logAuditEvent({
      restaurantId: req.user?.restaurantId ?? null,
      userId: req.user!.id,
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'IMAGE_DELETED',
      entity: 'Storage',
      entityId: key,
      details: `حذف صورة: ${key}`,
      ipAddress: req.ip,
    }).catch(() => undefined);

    return res.json({
      success: true,
      data: { deleted: true, key },
      statusCode: 200,
    });
  } catch (err) {
    console.error('Image delete error:', err);
    return res.status(500).json({
      success: false,
      error: 'تعذر حذف الصورة من التخزين',
      statusCode: 500,
    });
  }
});

export default router;
