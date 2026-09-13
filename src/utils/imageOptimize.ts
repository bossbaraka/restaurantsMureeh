// ============================================================
// Client-side image optimization — the single shared pipeline
// every manager/admin upload runs through BEFORE the multipart
// upload to POST /api/uploads/image.
//
// Design rules:
//  - canvas.toBlob (binary) — never toDataURL base64 payloads.
//  - WebP output where the browser encoder supports it; JPEG
//    fallback; PNG preserved when real transparency exists.
//  - GIF passes through untouched (canvas would strip animation).
//  - Never upscale small images.
//  - If a re-encode would produce MORE bytes than the original
//    (already-optimized inputs), keep the original file.
//  - The server remains the security boundary: magic bytes,
//    size caps and tenant ownership are re-validated there. This
//    module only shrinks payloads.
// ============================================================

export type ImageKind =
  | 'logo'
  | 'cover'
  | 'gallery'
  | 'product'
  | 'category'
  | 'offer'
  | 'map'
  | 'general';

export interface ImageKindPolicy {
  /** Max width in px (aspect ratio preserved). */
  maxW: number;
  /** Max height in px (aspect ratio preserved). */
  maxH: number;
  /** Lossy encode quality 0..1 (WebP/JPEG). */
  quality: number;
}

/**
 * Per-kind upper bounds. These match the actual UI surfaces:
 * product cards render in a ~square frame, the cover hero is a
 * wide 16:10-ish banner, logos sit in fixed square boxes.
 */
export const IMAGE_KIND_POLICIES: Record<ImageKind, ImageKindPolicy> = {
  product: { maxW: 1200, maxH: 1200, quality: 0.82 },
  logo: { maxW: 1000, maxH: 1000, quality: 0.85 },
  cover: { maxW: 1600, maxH: 1000, quality: 0.82 },
  gallery: { maxW: 1600, maxH: 1200, quality: 0.8 },
  category: { maxW: 1400, maxH: 1400, quality: 0.82 },
  offer: { maxW: 1400, maxH: 1400, quality: 0.82 },
  map: { maxW: 1200, maxH: 1200, quality: 0.82 },
  general: { maxW: 1400, maxH: 1400, quality: 0.82 },
};

export function policyForKind(kind?: string): ImageKindPolicy {
  if (kind && (kind in IMAGE_KIND_POLICIES)) {
    return IMAGE_KIND_POLICIES[kind as ImageKind];
  }
  return IMAGE_KIND_POLICIES.general;
}

/**
 * Fit (srcW × srcH) inside the policy box, preserving aspect
 * ratio and NEVER upscaling. Pure + unit-testable.
 */
export function computeTargetSize(
  srcW: number,
  srcH: number,
  policy: ImageKindPolicy
): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(srcW));
  const safeH = Math.max(1, Math.round(srcH));
  const ratio = Math.min(1, policy.maxW / safeW, policy.maxH / safeH);
  return {
    width: Math.max(1, Math.round(safeW * ratio)),
    height: Math.max(1, Math.round(safeH * ratio)),
  };
}

export type OutputFormat = 'image/webp' | 'image/jpeg' | 'image/png' | 'image/gif';

/**
 * Decide the encode target. Pure + unit-testable.
 *  - GIF in → GIF out (animation must survive).
 *  - Transparent PNG in → PNG out (WebP encoder support for
 *    alpha varies; a flattened logo is a real regression).
 *  - Otherwise WebP when the encoder is available, JPEG fallback.
 */
export function pickOutputFormat(inputType: string, webpSupported: boolean, hasAlpha: boolean): OutputFormat {
  const mime = (inputType || '').toLowerCase();
  if (mime === 'image/gif') return 'image/gif';
  if (mime === 'image/png' && hasAlpha) return 'image/png';
  if (webpSupported) return 'image/webp';
  return 'image/jpeg';
}

export function extForFormat(format: OutputFormat): string {
  switch (format) {
    case 'image/webp': return 'webp';
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/gif': return 'gif';
  }
}

export interface OptimizedImage {
  blob: Blob;
  ext: string;
  /** True when the original file was kept as-is. */
  passthrough: boolean;
}

interface ImageDeps {
  createImageBitmap?: (file: Blob) => Promise<ImageBitmap>;
  createObjectURL?: (file: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  canvasSupported?: () => boolean;
  webpSupported?: () => boolean;
}

/** Probe canvas.toBlob WebP support once per page. */
let cachedWebpSupport: boolean | null = null;
export function canvasSupportsWebp(deps?: Pick<ImageDeps, 'canvasSupported'>): boolean {
  if (cachedWebpSupport !== null) return cachedWebpSupport;
  try {
    if (deps?.canvasSupported) {
      cachedWebpSupport = deps.canvasSupported();
      return cachedWebpSupport;
    }
    if (typeof document === 'undefined') {
      cachedWebpSupport = false;
      return false;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const probe = canvas.toDataURL('image/webp');
    cachedWebpSupport = probe.indexOf('data:image/webp') === 0;
    return cachedWebpSupport;
  } catch {
    cachedWebpSupport = false;
    return false;
  }
}

/** Cheap alpha probe: sample the corners + centre of the drawn bitmap. */
function detectAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const points: Array<[number, number]> = [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
      [Math.floor(w / 2), Math.floor(h / 2)],
    ];
    for (const [x, y] of points) {
      const pixel = ctx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data;
      if (pixel[3] < 250) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function decodeToBitmap(file: Blob, deps: ImageDeps): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (deps.createImageBitmap && typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await deps.createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
    } catch {
      /* fall through to <img> decode */
    }
  }
  const objectUrl = (deps.createObjectURL || URL.createObjectURL.bind(URL))(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('image-decode-failed'));
      node.src = objectUrl;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => (deps.revokeObjectURL || URL.revokeObjectURL.bind(URL))(objectUrl),
    };
  } catch (err) {
    (deps.revokeObjectURL || URL.revokeObjectURL.bind(URL))(objectUrl);
    throw err;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Optimize one user-selected image file for upload.
 *
 * Guarantees:
 *  - output never exceeds the kind's dimension policy (aspect preserved);
 *  - original is kept when re-encoding cannot reduce size (GIF, tiny
 *    already-optimized files);
 *  - throws only when the file is not a decodable image — callers show
 *    a friendly manager-facing message, never raw errors.
 */
export async function optimizeImageFile(
  file: File | Blob,
  kind: ImageKind | string | undefined,
  deps: ImageDeps = {}
): Promise<OptimizedImage> {
  const policy = policyForKind(kind);
  const inputType = (file as File).type || '';

  // Animated GIF: re-encoding would freeze the animation. Keep as-is;
  // the server still validates magic bytes + size.
  if (inputType === 'image/gif') {
    return { blob: file, ext: 'gif', passthrough: true };
  }

  const decoded = await decodeToBitmap(file, deps);
  try {
    const { width, height } = computeTargetSize(decoded.width, decoded.height, policy);
    if (typeof document === 'undefined') {
      return { blob: file, ext: extForFormat(pickOutputFormat(inputType, false, false)), passthrough: true };
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: file, ext: 'jpg', passthrough: true };
    ctx.drawImage(decoded.source, 0, 0, width, height);

    const hasAlpha = inputType === 'image/png' ? detectAlpha(ctx, width, height) : false;
    const webp = canvasSupportsWebp(deps);
    let format = pickOutputFormat(inputType, webp, hasAlpha);

    let blob = await canvasToBlob(canvas, format, policy.quality);
    // Encoder refused (older Safari WebP): degrade to JPEG, never fail
    // a valid upload because of a preferred format.
    if (!blob && format === 'image/webp') {
      format = hasAlpha ? 'image/png' : 'image/jpeg';
      blob = await canvasToBlob(canvas, format, policy.quality);
    }
    if (!blob) return { blob: file, ext: 'jpg', passthrough: true };

    // Never punish already-optimized inputs: if the re-encode grew the
    // payload and dimensions were untouched, ship the original.
    const untouchedDims = width === Math.round(decoded.width) && height === Math.round(decoded.height);
    if (untouchedDims && blob.size >= file.size) {
      return { blob: file, ext: extForFormat(format), passthrough: true };
    }
    return { blob, ext: extForFormat(format), passthrough: false };
  } finally {
    decoded.cleanup();
  }
}
