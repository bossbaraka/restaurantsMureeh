// ============================================================
// Image validation by magic bytes — MIME headers, file extension
// and the client-supplied filename are all attacker-controlled
// and therefore never trusted. Only real raster images whose
// actual bytes match a known format are accepted.
//
// SVG is deliberately rejected: it is an XML document that can
// carry scripts, and serving it inline is an XSS vector.
// ============================================================

export interface SniffedImage {
  ext: '.png' | '.jpg' | '.webp' | '.gif';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}

export const IMAGE_ALLOWED_EXTENSIONS = ['.png', '.jpg', '.webp', '.gif'] as const;

/** Hard upload cap — mirrored by the multer middleware limit. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function isWithinUploadSizeLimit(size: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= MAX_IMAGE_BYTES;
}

/** Verify magic bytes. Returns null when the buffer is not a supported image. */
export function sniffImage(buffer: Buffer): SniffedImage | null {
  if (!buffer || buffer.length < 12) return null;

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
    return { ext: '.png', mimeType: 'image/png' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: '.jpg', mimeType: 'image/jpeg' };
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ext: '.webp', mimeType: 'image/webp' };
  }

  // GIF: GIF87a / GIF89a
  const gifHeader = buffer.toString('ascii', 0, 6);
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return { ext: '.gif', mimeType: 'image/gif' };
  }

  return null;
}
