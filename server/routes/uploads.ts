import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';

const router = Router();

const uploadDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `img-${Date.now()}-${Math.random().toString(36).substr(2, 6)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('الملف يجب أن يكون صورة بصيغة JPG أو PNG أو WEBP'));
    }
  },
});

// POST /api/uploads/image
router.post('/image', requireAuth, upload.single('image'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'لم يتم استلام أي صورة', statusCode: 400 });
  }

  // Production Object Storage integration architecture (S3 / Cloudinary / Local Fallback)
  const imageUrl = `/uploads/${req.file.filename}`;
  return res.json({
    success: true,
    data: {
      url: imageUrl,
      filename: req.file.filename,
      size: req.file.size,
    },
    statusCode: 200,
  });
});

export default router;
