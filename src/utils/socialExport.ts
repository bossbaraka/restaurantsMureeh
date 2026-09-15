import { buildBrandTokens, hslToCss, parseColor, rgbToHex } from '../theme/brandTheme';
import { formatPrice } from './formatting';

/**
 * Social Export
 * =============
 * Turns the read-only display board into assets that are ready to publish:
 *   - a PNG poster at story / reel / post / square ratios, and
 *   - a short WebM clip that walks through the menu sections.
 *
 * Everything is drawn with the 2D canvas API from the tenant's own brand
 * colors, so the export matches the on-screen board and needs no server,
 * no headless browser and no third-party screenshot library. The drawing
 * function takes the context as an argument, which keeps it unit-testable
 * without a DOM.
 */

export interface SocialFormat {
  id: 'story' | 'reel' | 'post' | 'square';
  /** Arabic label shown in the picker. */
  label: string;
  ratio: string;
  width: number;
  height: number;
}

/** Ratios the major platforms actually accept. */
export const SOCIAL_FORMATS: SocialFormat[] = [
  { id: 'story', label: 'ستوري', ratio: '9:16', width: 1080, height: 1920 },
  { id: 'reel', label: 'ريلز', ratio: '9:16', width: 1080, height: 1920 },
  { id: 'post', label: 'منشور', ratio: '4:5', width: 1080, height: 1350 },
  { id: 'square', label: 'مربع', ratio: '1:1', width: 1080, height: 1080 },
];

export const getFormat = (id: SocialFormat['id']): SocialFormat =>
  SOCIAL_FORMATS.find((f) => f.id === id) || SOCIAL_FORMATS[0]!;

export interface PosterDish {
  id: string;
  name: string;
  nameEn?: string;
  description?: string;
  price: number;
  badge?: string;
  isFeatured?: boolean;
  /** Pre-loaded bitmap; the caller drops anything that failed to load. */
  image?: CanvasImageSource;
}

export interface PosterSection {
  name: string;
  nameEn?: string;
  dishes: PosterDish[];
}

export interface PosterInput {
  restaurantName: string;
  restaurantNameEn?: string;
  tagline?: string;
  primaryColor?: string;
  accentColor?: string;
  currency: string;
  section: PosterSection;
  /** 1-based position, for the "2 / 5" counter. */
  sectionIndex: number;
  sectionCount: number;
  note?: string;
  url?: string;
  /** 0..1 — drives the slide-in used by the clip recorder. */
  progress?: number;
}

/** The slice of CanvasRenderingContext2D the poster actually uses. */
export interface PosterCtx {
  canvas: { width: number; height: number };
  direction: string;
  textAlign: string;
  textBaseline: string;
  font: string;
  fillStyle: string | CanvasGradient;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  drawImage(image: CanvasImageSource, x: number, y: number, w: number, h: number): void;
  measureText(text: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
}

export interface PosterLayout {
  /** How many dishes of this section fit before we start truncating. */
  visibleDishes: number;
  /** Dishes that had to be cut, reported as "+N أطباق أخرى". */
  hiddenCount: number;
  rowHeight: number;
}

const FONT_STACK = "Tajawal, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const font = (weight: number, px: number) => `${weight} ${Math.round(px)}px ${FONT_STACK}`;
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function roundRectPath(ctx: PosterCtx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Greedy RTL-agnostic word wrap; returns at most `maxLines` lines. */
export function wrapText(ctx: PosterCtx, text: string, maxWidth: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    // The last visible line becomes the ellipsis carrier.
    const last = lines[maxLines - 1]!;
    const rest = words.slice(last.split(/\s+/).length).join(' ');
    if (rest) lines[maxLines - 1] = `${last.replace(/\s+\S+$/, '')}…`;
  }
  return lines;
}

/** Row height scales with the canvas so a 1:1 post is not a shrunken story. */
export function rowHeightFor(format: SocialFormat): number {
  return Math.round(Math.min(format.width, format.height) * 0.115);
}

/** How many dishes fit in the space left after header, title and footer. */
export function computeLayout(input: PosterInput, format: SocialFormat): PosterLayout {
  const rowHeight = rowHeightFor(format);
  const reserved = Math.round(format.height * 0.34);
  const available = Math.max(rowHeight, format.height - reserved);
  const total = input.section.dishes.length;
  const visibleDishes = Math.max(1, Math.min(total, Math.floor(available / rowHeight)));
  return { visibleDishes, hiddenCount: Math.max(0, total - visibleDishes), rowHeight };
}

/**
 * Paints one menu poster. Pure with respect to the context: no DOM access,
 * no globals, so it can be driven by a stub in tests or by a recorder loop.
 */
export function drawMenuPoster(ctx: PosterCtx, input: PosterInput, format: SocialFormat): void {
  const { width: W, height: H } = format;
  const tokens = buildBrandTokens(input.primaryColor, input.accentColor);
  const pad = Math.round(W * 0.062);
  const progress = input.progress === undefined ? 1 : easeOut(input.progress);

  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // ---- canvas ----
  const bg = ctx.createLinearGradient(0, 0, W * 0.35, H);
  bg.addColorStop(0, '#0a0b0d');
  bg.addColorStop(0.55, tokens.soft);
  bg.addColorStop(1, '#07080a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Brand glow, top-right, the same corner the on-screen board lights up.
  const glow = ctx.createLinearGradient(W, 0, W * 0.45, H * 0.55);
  glow.addColorStop(0, hslToCss(45, 0.6, 0.5, 0.22));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const accentRgb = parseColor(tokens.primaryStrong);
  const accentCss = accentRgb ? rgbToHex(accentRgb) : tokens.primaryStrong;

  let y = Math.round(H * 0.075);

  // ---- header ----
  const crest = Math.round(W * 0.088);
  ctx.fillStyle = accentCss;
  roundRectPath(ctx, W - pad - crest, y, crest, crest, crest * 0.3);
  ctx.fill();
  // A two-ring plate so the crest reads as dining, not an empty box.
  ctx.strokeStyle = '#0a0b0d';
  ctx.lineWidth = Math.max(3, crest * 0.075);
  const cx = W - pad - crest / 2;
  const cy = y + crest / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, crest * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, crest * 0.14, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'right';
  ctx.fillStyle = '#fffaf0';
  ctx.font = font(900, W * 0.062);
  ctx.fillText(input.restaurantName, W - pad - crest - Math.round(crest * 0.45), y + crest * 0.62);

  const subParts = [input.restaurantNameEn, input.tagline].filter(Boolean) as string[];
  if (subParts.length) {
    ctx.fillStyle = tokens.muted;
    ctx.font = font(600, W * 0.028);
    const sub = wrapText(ctx, subParts.join(' · '), W - pad * 2 - crest, 1)[0] || '';
    ctx.fillText(sub, W - pad - crest - Math.round(crest * 0.45), y + crest * 1.02);
  }

  y += Math.round(crest * 1.5);

  // hairline
  ctx.strokeStyle = tokens.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();

  y += Math.round(H * 0.055);

  // ---- section title ----
  ctx.fillStyle = accentCss;
  ctx.font = font(900, W * 0.058);
  ctx.fillText(input.section.name, W - pad, y);

  if (input.section.nameEn) {
    ctx.fillStyle = tokens.muted;
    ctx.font = font(700, W * 0.024);
    ctx.fillText(input.section.nameEn.toUpperCase(), W - pad, y + Math.round(W * 0.038));
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = tokens.muted;
  ctx.font = font(800, W * 0.026);
  ctx.fillText(`${input.sectionIndex} / ${input.sectionCount}`, pad, y);
  ctx.textAlign = 'right';

  y += Math.round(H * 0.055);

  // ---- dishes ----
  const layout = computeLayout(input, format);
  const dishes = input.section.dishes.slice(0, layout.visibleDishes);
  const rowH = layout.rowHeight;
  const priceFont = font(900, W * 0.045);
  const nameFont = font(800, W * 0.041);
  const descFont = font(500, W * 0.027);

  ctx.save();
  ctx.translate(0, Math.round((1 - progress) * rowH * 0.6));
  ctx.globalAlpha = progress;

  dishes.forEach((dish, i) => {
    const rowY = y + i * rowH;

    // card
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    roundRectPath(ctx, pad, rowY, W - pad * 2, rowH - Math.round(rowH * 0.14), rowH * 0.18);
    ctx.fill();
    ctx.strokeStyle = tokens.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const innerPad = Math.round(rowH * 0.2);
    let textRight = W - pad - innerPad;

    // photo (only when the caller managed to load it without tainting)
    if (dish.image) {
      const size = rowH - Math.round(rowH * 0.14) - innerPad;
      const imgX = pad + innerPad;
      const imgY = rowY + innerPad / 2;
      ctx.save();
      roundRectPath(ctx, imgX, imgY, size, size, size * 0.22);
      ctx.fill();
      ctx.drawImage(dish.image, imgX, imgY, size, size);
      ctx.restore();
    }

    // price, measured first so the name never collides with it
    ctx.font = priceFont;
    const priceText = formatPrice(dish.price, input.currency);
    const priceWidth = ctx.measureText(priceText).width;
    const priceX = pad + innerPad + (dish.image ? rowH * 0.86 : 0);
    ctx.fillStyle = accentCss;
    ctx.textAlign = 'left';
    ctx.fillText(priceText, priceX, rowY + rowH * 0.52);
    ctx.textAlign = 'right';

    const maxTextWidth = W - pad * 2 - innerPad * 2 - priceWidth - (dish.image ? rowH * 0.86 : 0);

    // name + badges
    ctx.font = nameFont;
    const name = dish.name;
    const nameWidth = ctx.measureText(name).width;
    ctx.fillStyle = '#fffaf0';
    ctx.fillText(name, textRight, rowY + rowH * 0.42);

    const badge = dish.badge || (dish.isFeatured ? 'مميز' : '');
    if (badge && nameWidth + priceWidth < maxTextWidth) {
      ctx.font = font(800, W * 0.021);
      const badgeWidth = ctx.measureText(badge).width + Math.round(W * 0.022);
      const badgeX = textRight - nameWidth - Math.round(W * 0.016) - badgeWidth;
      ctx.fillStyle = accentCss;
      roundRectPath(ctx, badgeX, rowY + rowH * 0.2, badgeWidth, rowH * 0.26, rowH * 0.13);
      ctx.fill();
      ctx.fillStyle = '#0a0b0d';
      ctx.textAlign = 'center';
      ctx.fillText(badge, badgeX + badgeWidth / 2, rowY + rowH * 0.385);
      ctx.textAlign = 'right';
    }

    // description
    if (dish.description) {
      ctx.font = descFont;
      ctx.fillStyle = 'rgba(246,241,228,0.66)';
      const lines = wrapText(ctx, dish.description, maxTextWidth, 1);
      if (lines[0]) ctx.fillText(lines[0], textRight, rowY + rowH * 0.7);
    }

    // dotted leader between the text block and the price
    ctx.strokeStyle = tokens.line;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    const leaderY = rowY + rowH * 0.86;
    ctx.moveTo(priceX + priceWidth + innerPad * 0.5, leaderY);
    ctx.lineTo(Math.max(priceX + priceWidth + innerPad, textRight - Math.max(nameWidth, maxTextWidth * 0.35)), leaderY);
    ctx.stroke();
    ctx.setLineDash([]);

    void textRight;
  });

  ctx.restore();

  let footY = y + dishes.length * rowH + Math.round(rowH * 0.35);

  if (layout.hiddenCount > 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = tokens.muted;
    ctx.font = font(700, W * 0.028);
    ctx.fillText(`+${layout.hiddenCount} أطباق أخرى في القائمة`, W / 2, footY);
    footY += Math.round(rowH * 0.45);
    ctx.textAlign = 'right';
  }

  // ---- footer ----
  const footLine = Math.max(footY, H - Math.round(H * 0.11));
  ctx.strokeStyle = tokens.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, footLine);
  ctx.lineTo(W - pad, footLine);
  ctx.stroke();

  ctx.textAlign = 'right';
  ctx.fillStyle = tokens.muted;
  ctx.font = font(600, W * 0.025);
  const credit = `مُدار بواسطة منصة مريح MUREEH${input.url ? ` · ${input.url.replace(/^https?:\/\//, '')}` : ''}`;
  ctx.fillText(wrapText(ctx, credit, W - pad * 2, 1)[0] || credit, W - pad, footLine + Math.round(H * 0.035));

  if (input.note) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(246,241,228,0.5)';
    ctx.font = font(600, W * 0.022);
    ctx.fillText(wrapText(ctx, input.note, W - pad * 2, 1)[0] || input.note, pad, footLine + Math.round(H * 0.035));
  }
}

/** Stable, filesystem-safe name for a downloaded poster. */
export function posterFilename(input: PosterInput, format: SocialFormat, ext = 'png'): string {
  const slug = (input.restaurantNameEn || input.restaurantName)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `mureeh-${slug || 'menu'}-${format.width}x${format.height}.${ext}`;
}

const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

/** First container/codec this browser can actually record. */
export function pickVideoMime(
  candidates: string[] = MIME_CANDIDATES,
  isSupported: (mime: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
): string | null {
  for (const mime of candidates) {
    if (isSupported(mime)) return mime;
  }
  return null;
}

export const extensionForMime = (mime: string): string => (mime.includes('mp4') ? 'mp4' : 'webm');

export const isRecordingSupported = (): boolean =>
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
  pickVideoMime() !== null;

/**
 * Loads an image for the poster. Returns null instead of throwing when the
 * host sends no CORS headers — a failed image must never block the export,
 * and a tainted canvas would make toBlob() throw later.
 */
export function loadPosterImage(src?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src || typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function loadPosterImages(dishes: { id: string; image?: string }[]): Promise<Map<string, CanvasImageSource>> {
  const map = new Map<string, CanvasImageSource>();
  const entries = await Promise.all(
    dishes.filter((d) => d.image).map(async (d) => [d.id, await loadPosterImage(d.image)] as const)
  );
  for (const [id, img] of entries) {
    if (img) map.set(id, img);
  }
  return map;
}

/** Renders a poster to an offscreen canvas ready for toBlob()/captureStream(). */
export function renderPosterCanvas(input: PosterInput, format: SocialFormat): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = format.width;
  canvas.height = format.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذر إنشاء لوحة الرسم في هذا المتصفح');
  drawMenuPoster(ctx as unknown as PosterCtx, input, format);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('تعذر توليد الصورة — قد تكون صور الأطباق محمية من النسخ'));
    }, type);
  });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export interface ClipOptions {
  format: SocialFormat;
  /** Seconds each section stays on screen. */
  secondsPerSection?: number;
  fps?: number;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

export interface ClipResult {
  blob: Blob;
  mime: string;
  filename: string;
  durationSeconds: number;
}

/**
 * Records the poster animation into a video file. Uses the canvas capture
 * stream, so the clip is produced entirely on the client and is uploadable
 * to reels/stories as-is.
 */
export async function recordMenuClip(inputs: PosterInput[], options: ClipOptions): Promise<ClipResult> {
  const { format } = options;
  const secondsPerSection = options.secondsPerSection ?? 3.5;
  const fps = options.fps ?? 30;
  if (inputs.length === 0) throw new Error('لا توجد أقسام لتسجيلها');

  const mime = pickVideoMime();
  if (!mime) throw new Error('متصفحك لا يدعم تسجيل الفيديو — جرّب Chrome أو Edge');

  const canvas = renderPosterCanvas(inputs[0]!, format);
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const ctx = canvas.getContext('2d') as unknown as PosterCtx;
  const totalMs = inputs.length * secondsPerSection * 1000;
  const startedAt = performance.now();

  recorder.start(250);

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new Error('تم إيقاف التسجيل'));
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const frame = () => {
      const elapsed = performance.now() - startedAt;
      const ratio = Math.min(1, elapsed / totalMs);
      options.onProgress?.(ratio);

      const index = Math.min(inputs.length - 1, Math.floor(elapsed / (secondsPerSection * 1000)));
      const intoSection = (elapsed - index * secondsPerSection * 1000) / (secondsPerSection * 1000);
      // Slide in over the first 18% of each section, then hold.
      const input = { ...inputs[index]!, progress: Math.min(1, intoSection / 0.18) };
      drawMenuPoster(ctx, input, format);

      if (elapsed >= totalMs) {
        options.signal?.removeEventListener('abort', onAbort);
        resolve();
        return;
      }
      if (options.signal?.aborted) {
        options.signal.removeEventListener('abort', onAbort);
        reject(new Error('تم إيقاف التسجيل'));
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  recorder.stop();
  await done;

  const blob = new Blob(chunks, { type: mime });
  const ext = extensionForMime(mime);
  const slug = (inputs[0]!.restaurantNameEn || inputs[0]!.restaurantName)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return {
    blob,
    mime,
    filename: `mureeh-${slug || 'menu'}-${format.width}x${format.height}.${ext}`,
    durationSeconds: Math.round(totalMs / 100) / 10,
  };
}
