import { describe, expect, it, vi } from 'vitest';
import {
  SOCIAL_FORMATS,
  computeLayout,
  drawMenuPoster,
  extensionForMime,
  getFormat,
  isRecordingSupported,
  pickVideoMime,
  posterFilename,
  rowHeightFor,
  wrapText,
  type PosterCtx,
  type PosterInput,
} from '../utils/socialExport';

/** Records every paint call so assertions can inspect what was drawn. */
interface DrawCall {
  op: string;
  text?: string;
  font?: string;
  fillStyle?: string;
  x?: number;
  y?: number;
}

function createStubCtx(width = 1080, height = 1920) {
  const calls: DrawCall[] = [];
  let font = '400 16px sans-serif';
  let fillStyle = '#000';

  const ctx = {
    canvas: { width, height },
    direction: 'ltr',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    globalAlpha: 1,
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string | CanvasGradient) {
      fillStyle = String(value);
    },
    strokeStyle: '#000',
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    quadraticCurveTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn((text: string, x: number, y: number) => {
      calls.push({ op: 'fillText', text, font, fillStyle, x, y });
    }),
    // One unit per character keeps wrapping arithmetic predictable.
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() }) as unknown as CanvasGradient),
  };

  return { ctx: ctx as unknown as PosterCtx, calls };
}

const dish = (id: string, name: string, price: number, extra: Partial<PosterInput['section']['dishes'][number]> = {}) => ({
  id,
  name,
  price,
  ...extra,
});

const input = (dishes: ReturnType<typeof dish>[], overrides: Partial<PosterInput> = {}): PosterInput => ({
  restaurantName: 'مطعم الديوان',
  restaurantNameEn: 'Diwan Restaurant',
  tagline: 'مطبخ شامي أصيل',
  primaryColor: '#D4AF37',
  accentColor: '#C5A880',
  currency: '₪',
  section: { name: 'المشاوي', nameEn: 'Grills', dishes },
  sectionIndex: 2,
  sectionCount: 5,
  note: 'الأسعار تشمل ضريبة القيمة المضافة',
  url: 'https://mureeh.app/r/diwan?view=display',
  ...overrides,
});

describe('SOCIAL_FORMATS', () => {
  it('ships the ratios the platforms actually accept', () => {
    const byId = Object.fromEntries(SOCIAL_FORMATS.map((f) => [f.id, f]));
    expect(byId.story).toMatchObject({ ratio: '9:16', width: 1080, height: 1920 });
    expect(byId.reel).toMatchObject({ ratio: '9:16', width: 1080, height: 1920 });
    expect(byId.post).toMatchObject({ ratio: '4:5', width: 1080, height: 1350 });
    expect(byId.square).toMatchObject({ ratio: '1:1', width: 1080, height: 1080 });
  });

  it('falls back to the story format for an unknown id', () => {
    expect(getFormat('story').id).toBe('story');
    expect(getFormat('nonsense' as 'story').id).toBe('story');
  });
});

describe('computeLayout', () => {
  it('keeps every dish when there is room', () => {
    const format = getFormat('story');
    const layout = computeLayout(input([dish('p1', 'كباب', 74), dish('p2', 'ريش', 118)]), format);
    expect(layout.hiddenCount).toBe(0);
    expect(layout.visibleDishes).toBe(2);
    expect(layout.rowHeight).toBe(rowHeightFor(format));
  });

  it('truncates a long section instead of overflowing the canvas', () => {
    const format = getFormat('square'); // least vertical room
    const many = Array.from({ length: 40 }, (_, i) => dish(`p${i}`, `طبق ${i}`, 10 + i));
    const layout = computeLayout(input(many), format);

    expect(layout.visibleDishes).toBeLessThan(40);
    expect(layout.hiddenCount).toBe(40 - layout.visibleDishes);
    // Everything that stays visible must fit inside the canvas.
    expect(layout.visibleDishes * layout.rowHeight).toBeLessThanOrEqual(format.height);
  });
});

describe('drawMenuPoster', () => {
  it('paints the full canvas, then the identity, section and every visible dish', () => {
    const { ctx, calls } = createStubCtx();
    const format = getFormat('story');
    drawMenuPoster(
      ctx,
      input([
        dish('p1', 'كباب حلبي', 74, { description: 'كباب مشوي مع دبس الرمان' }),
        dish('p2', 'منسف الديوان', 89, { isFeatured: true }),
      ]),
      format
    );

    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.text);
    expect(texts).toContain('مطعم الديوان');
    expect(texts).toContain('المشاوي');
    expect(texts).toContain('كباب حلبي');
    expect(texts).toContain('منسف الديوان');
    // 2 / 5 counter, so a viewer knows the clip is not the whole menu.
    expect(texts).toContain('2 / 5');
    // Prices are formatted with the tenant currency.
    expect(texts.some((t) => t?.includes('74'))).toBe(true);
    expect(texts.some((t) => t?.includes('₪'))).toBe(true);
    // The platform is credited on the asset itself.
    expect(texts.some((t) => t?.includes('منصة مريح'))).toBe(true);

    // Background is painted edge to edge before anything is drawn on it.
    const firstRect = (ctx.fillRect as unknown as { mock: { calls: number[][] } }).mock.calls[0];
    expect(firstRect).toEqual([0, 0, format.width, format.height]);
    // RTL canvas, matching the on-screen board.
    expect(ctx.direction).toBe('rtl');
  });

  it('never paints a dish that did not fit, and says how many were cut', () => {
    const { ctx, calls } = createStubCtx(1080, 1080);
    const format = getFormat('square');
    const many = Array.from({ length: 40 }, (_, i) => dish(`p${i}`, `طبق رقم ${i}`, 10 + i));
    const data = input(many);
    const layout = computeLayout(data, format);

    drawMenuPoster(ctx, data, format);

    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.text || '');
    expect(texts).toContain('طبق رقم 0');
    expect(texts).not.toContain(`طبق رقم ${layout.visibleDishes}`);
    expect(texts.some((t) => t.includes(`+${layout.hiddenCount} أطباق أخرى`))).toBe(true);
  });

  it('drops the slide-in offset once the animation has finished', () => {
    const started = createStubCtx();
    const finished = createStubCtx();
    const data = input([dish('p1', 'كباب', 74)]);

    drawMenuPoster(started.ctx, { ...data, progress: 0 }, getFormat('story'));
    drawMenuPoster(finished.ctx, { ...data, progress: 1 }, getFormat('story'));

    const offsetOf = (c: ReturnType<typeof createStubCtx>) =>
      (c.ctx.translate as unknown as { mock: { calls: number[][] } }).mock.calls.at(-1)?.[1];
    expect(offsetOf(started)).toBeGreaterThan(0);
    expect(offsetOf(finished)).toBe(0);
    expect(started.ctx.globalAlpha).toBeLessThan(1);
    expect(finished.ctx.globalAlpha).toBe(1);
  });

  it('draws a photo only when the caller supplied a loaded bitmap', () => {
    const withImage = createStubCtx();
    const without = createStubCtx();
    const format = getFormat('story');
    const bitmap = { width: 200, height: 200 } as unknown as CanvasImageSource;

    drawMenuPoster(withImage.ctx, input([dish('p1', 'كباب', 74, { image: bitmap })]), format);
    drawMenuPoster(without.ctx, input([dish('p1', 'كباب', 74)]), format);

    expect(withImage.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(without.ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe('wrapText', () => {
  it('keeps lines inside the width and caps the line count', () => {
    const { ctx } = createStubCtx();
    // 10px per character, so maxWidth 60 holds 6 characters.
    expect(wrapText(ctx, 'كلمة أولى هنا', 60, 1)).toHaveLength(1);
    expect(wrapText(ctx, 'واحدة اثنين ثلاثة', 60, 2).length).toBeLessThanOrEqual(2);
    expect(wrapText(ctx, '', 60)).toEqual([]);
  });

  it('marks a truncated block with an ellipsis', () => {
    const { ctx } = createStubCtx();
    const lines = wrapText(ctx, 'الوصف طويل جداً ويتجاوز السطر المحدد', 60, 2);
    expect(lines.at(-1)).toContain('…');
  });
});

describe('posterFilename', () => {
  it('produces a filesystem-safe name carrying the ratio', () => {
    const name = posterFilename(input([]), getFormat('story'));
    expect(name).toBe('mureeh-diwan-restaurant-1080x1920.png');
    expect(name).not.toMatch(/[\\/:*?"<>|\s]/);
  });

  it('falls back to "menu" when the tenant has no latin name', () => {
    const name = posterFilename(input([], { restaurantNameEn: '', restaurantName: 'مطعم' }), getFormat('post'));
    expect(name).toContain('mureeh-');
    expect(name.endsWith('-1080x1350.png')).toBe(true);
    // Arabic letters are word characters for the slug, so nothing collapses.
    expect(name.startsWith('mureeh-مطعم')).toBe(true);
  });
});

describe('video support detection', () => {
  it('picks the first container the browser can record', () => {
    expect(pickVideoMime(['video/webm;codecs=vp9', 'video/webm'], () => true)).toBe('video/webm;codecs=vp9');
    expect(pickVideoMime(['video/webm;codecs=vp9', 'video/webm'], (m) => m === 'video/webm')).toBe('video/webm');
    expect(pickVideoMime(['video/webm'], () => false)).toBeNull();
  });

  it('maps the container to a file extension', () => {
    expect(extensionForMime('video/webm;codecs=vp9')).toBe('webm');
    expect(extensionForMime('video/mp4')).toBe('mp4');
  });

  it('reports recording as unsupported without MediaRecorder', () => {
    // Node has no MediaRecorder / HTMLCanvasElement, which is exactly the
    // degraded case the UI has to handle.
    expect(isRecordingSupported()).toBe(false);
  });
});
