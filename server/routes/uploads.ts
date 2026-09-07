import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { requireManager } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';

const router = Router();

const uploadDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Memory storage: the file is inspected BEFORE anything touches disk,
// so rejected uploads never leave attacker-controlled bytes behind.
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

type SniffedImage = { ext: '.png' | '.jpg' | '.webp' | '.gif' } | null;

/** Verify magic bytes — MIME headers and extensions are attacker input. */
function sniffImage(buffer: Buffer): SniffedImage {
  if (buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ext: '.png' };
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: '.jpg' };
  }
  // WEBP: RIFF....WEBP
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ext: '.webp' };
  }
  // GIF: GIF87a / GIF89a
  const gifHeader = buffer.toString('ascii', 0, 6);
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return { ext: '.gif' };
  }
  return null;
}

// POST /api/uploads/image — tenant branding assets (managers only).
router.post(
  '/image',
  requireManager(),
  uploadLimiter,
  upload.single('image'),
  (req: Request, res: Response) => {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'لم يتم استلام أي صورة', statusCode: 400 });
    }

    const sniffed = sniffImage(req.file.buffer);
    if (!sniffed) {
      return res.status(400).json({
        success: false,
        error: 'الملف ليس صورة حقيقية بصيغة JPG أو PNG أو WEBP أو GIF',
        statusCode: 400,
      });
    }

    // Server-generated filename + server-verified extension: the client
    // controls neither the name nor the served content type.
    const filename = `img-${Date.now()}-${randomUUID().slice(0, 8)}${sniffed.ext}`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const imageUrl = `/uploads/${filename}`;
    return res.json({
      success: true,
      data: {
        url: imageUrl,
        filename,
        size: req.file.size,
      },
      statusCode: 200,
    });
  }
);

export default router;
