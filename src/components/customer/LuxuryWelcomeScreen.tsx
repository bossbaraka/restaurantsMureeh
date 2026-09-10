import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import {
  ArrowLeft,
  MapPin,
  Sparkles,
  MessageCircle,
  Star,
  Quote,
  X,
  Flame,
  QrCode,
  ShieldCheck,
  UtensilsCrossed,
} from 'lucide-react';
import { optimizeImageUrl } from './ProductImage';
import { soundFX } from '../../utils/audio';
import { formatPrice } from '../../utils/formatting';
import type { Category, Product } from '../../types/restaurant';
import {
  buildSplashPalette,
  rgbaCss,
  useBrandTheme,
  type SplashPalette,
} from '../../theme/brandTheme';

/**
 * QR Welcome Screen — the first thing a guest sees after scanning the table QR.
 *
 * Theme contract
 * --------------
 * This screen is painted ONLY from the tenant brand tokens (`--brand-*`,
 * produced by `useBrandTheme`) plus the shared `luxury-*` dark canvas. It never
 * hardcodes a tenant colour: a restaurant that brands itself emerald, magenta
 * or near-black gets an emerald, magenta or silver splash. The canvas is also
 * the SAME `#0A0B0D` the menu behind it is drawn on (`--welcome-canvas`), so
 * dismissing the splash into the menu has no colour jump.
 *
 * Every themed colour therefore lives in `src/index.css` (`.welcome-*`), and the
 * only place raw RGB is computed in JS is the particle canvas, which cannot read
 * CSS variables mid-frame.
 */

interface LuxuryWelcomeScreenProps {
  onDismiss: () => void;
  /**
   * Stage to open on. Defaults to the intro animation; exposed so the showcase
   * can be reached directly (and asserted in tests) without waiting on timers.
   */
  initialStep?: WelcomeStep;
  /**
   * Open with the QR already morphed into the wordmark. Lets the signature
   * moment's end state be reached directly (and asserted) without a drag.
   */
  initialQrMaterialized?: boolean;
}

export type WelcomeStep = 'NETWORKING' | 'LOGO_REVEAL' | 'WELCOME_SHOWCASE';

/** Kept in the same order as the progress segments rendered in the header. */
const WELCOME_STAGES = ['NETWORKING', 'LOGO_REVEAL', 'WELCOME_SHOWCASE'] as const;

/** Stage timings — the splash must never feel like a wall the guest has to wait out. */
const NETWORKING_MS = 2200;
const TAP_HINT_MS = 1100;
const DISMISS_MS = 320;
/** Reviews stay on screen long enough to actually be read. */
const REVIEW_INTERVAL_MS = 6000;

/** Human labels for the three beats, shown next to the progress segments. */
const STAGE_LABELS: Record<WelcomeStep, { index: string; label: string }> = {
  NETWORKING: { index: '01', label: 'EXPERIENCE' },
  LOGO_REVEAL: { index: '02', label: 'DISCOVER' },
  WELCOME_SHOWCASE: { index: '03', label: 'CONNECT' },
};

/**
 * Per-venue framing. The venue kind is tenant data (`Restaurant.businessType`),
 * so the same splash speaks the guest's language: a café guest is told about
 * quick ordering, a restaurant guest about their table.
 */
const VENUE_COPY = {
  RESTAURANT: {
    tagline: 'اطلب من طاولتك، ونادِ النادل بلمسة واحدة',
    chip: 'تجربة طاولة',
  },
  CAFE: {
    tagline: 'اطلب بسرعة، واستلم طلبك دون انتظار في الطابور',
    chip: 'طلب سريع',
  },
  BAKERY: {
    tagline: 'تصفّح منتجاتنا الطازجة واطلبها للاستلام',
    chip: 'استلام سريع',
  },
} as const;

/** Evening sessions get a warmer, dimmer ambience. */
function isNightSession(hour: number = new Date().getHours()): boolean {
  return hour >= 19 || hour < 6;
}

interface CustomerReview {
  id: string;
  author: string;
  badge: string;
  rating: number;
  comment: string;
}

const CURATED_REVIEWS: CustomerReview[] = [
  {
    id: 'rev-1',
    author: 'سارة القحطاني',
    badge: 'ضيف معتمد · تجربة غداء',
    rating: 5,
    comment: 'تجربة ضيافة استثنائية بكل المقاييس. جودة الأطباق والتقديم تفوق التوقعات، وأجواء المكان غاية في الرقي.',
  },
  {
    id: 'rev-2',
    author: 'م. أحمد الشريف',
    badge: 'زائر دائم · جلسة مسائية',
    rating: 5,
    comment: 'الخدمة الرقمية سريعة جداً وطلب الطعام من الطاولة بلمسة واحدة مريح للغاية. المذاق أصيل والقهوة ممتازة.',
  },
  {
    id: 'rev-3',
    author: 'د. خلود اليافعي',
    badge: 'ضيف معتمد · عشاء عائلي',
    rating: 5,
    comment: 'اهتمام فائق بأدق التفاصيل من لحظة مسح الباركود حتى استلام الطلب. بالتأكيد سأكرر الزيارة مراراً.',
  },
];

const DEFAULT_GALLERY_PHOTOS = [
  {
    id: 'g-1',
    title: 'أجواء الضيافة والاسترخاء',
    url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80',
    tag: 'أجواء المكان ✨',
  },
  {
    id: 'g-2',
    title: 'المشروبات والقهوة المختصة',
    url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80',
    tag: 'قهوة مختصة ☕',
  },
  {
    id: 'g-3',
    title: 'أطباق فاخرة محضرة بعناية',
    url: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80',
    tag: 'مذاق فريد 🌿',
  },
  {
    id: 'g-4',
    title: 'عصائر ومنعشات طازجة',
    url: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=800&q=80',
    tag: 'طازج ولذيذ 🔥',
  },
];

/**
 * Samples a glyph into target points so the particle field can converge into
 * the restaurant's actual initial instead of a random blob at the centre.
 *
 * Rendered once into a throwaway 220px canvas and read back with
 * `willReadFrequently` (software path — far cheaper than a GPU readback for a
 * one-shot sample). Returns centre-relative offsets so the caller can place the
 * shape anywhere. Empty result (SSR, blank char) => caller falls back to a
 * cluster, so the reveal degrades instead of breaking.
 */
function sampleGlyphPoints(
  char: string,
  span: number,
  maxPoints: number
): Array<{ x: number; y: number }> {
  if (typeof document === 'undefined' || !char) return [];
  const canvas = document.createElement('canvas');
  const SIZE = 220;
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(SIZE * 0.7)}px Georgia, 'Times New Roman', serif`;
  ctx.fillText(char, SIZE / 2, SIZE / 2);

  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const found: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < SIZE; y += 3) {
    for (let x = 0; x < SIZE; x += 3) {
      if (data[(y * SIZE + x) * 4 + 3] > 128) {
        found.push({ x: (x / SIZE - 0.5) * span, y: (y / SIZE - 0.5) * span });
      }
    }
  }

  if (found.length <= maxPoints) return found;
  const stride = found.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, i) => found[Math.floor(i * stride)]);
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// Decorative starfield
// ---------------------------------------------------------------------------

/**
 * Deterministic (mulberry32) star placement.
 *
 * `Math.random()` during render would reshuffle the sky on every re-render and
 * produce different markup on the server than in the browser, so the field is
 * generated once from a fixed seed.
 */
function makeStars(count: number, seed = 20260910) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: +(next() * 100).toFixed(2),
    top: +(next() * 100).toFixed(2),
    size: 7 + Math.round(next() * 12),
    drift: 9 + Math.round(next() * 12),
    twinkle: +(2.4 + next() * 3).toFixed(2),
    // Negative delay: stars start mid-animation instead of all pulsing in sync.
    delay: -(next() * 9).toFixed(2),
  }));
}

const STAR_FIELD = makeStars(24);

/**
 * Slowly drifting, twinkling stars behind the content.
 * Coloured with `--brand-primary-strong`, so the default gold tenant gets gold
 * stars and every other restaurant gets stars in its own brand colour.
 */
const WelcomeStarField: React.FC<{ density?: number; className?: string }> = ({
  density = STAR_FIELD.length,
  className = '',
}) => (
  <div className={`welcome-stars ${className}`.trim()} aria-hidden="true">
    {STAR_FIELD.slice(0, density).map((star) => (
      <span
        key={star.id}
        className="welcome-star"
        style={{
          left: `${star.left}%`,
          top: `${star.top}%`,
          animationDuration: `${star.drift}s`,
          animationDelay: `${star.delay}s`,
        }}
      >
        <Star
          className="welcome-star__glyph fill-current"
          style={{
            width: star.size,
            height: star.size,
            animationDuration: `${star.twinkle}s`,
            animationDelay: `${star.delay}s`,
          }}
        />
      </span>
    ))}
  </div>
);

/**
 * Pseudo-3D menu device.
 *
 * The tilt is written straight to CSS custom properties on the stage element
 * (no React state), throttled to one write per animation frame: a pointermove
 * that re-rendered this subtree would drop frames on a mid-range phone. Only
 * `transform` and a gradient position change, so it stays on the compositor.
 *
 * `touch-action: pan-y` keeps vertical page scrolling working — the guest can
 * still scroll past the device, while a horizontal drag tilts it.
 */
/**
 * Samples a whole string into target points (same technique as the monogram,
 * but laid out as a line of text so the particles can rebuild a wordmark).
 */
function sampleTextPoints(
  text: string,
  boxWidth: number,
  boxHeight: number,
  maxPoints: number
): Array<{ x: number; y: number }> {
  if (typeof document === 'undefined' || !text) return [];
  const canvas = document.createElement('canvas');
  const W = 520;
  const H = 90;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(H * 0.52)}px Georgia, 'Times New Roman', serif`;
  ctx.fillText(text, W / 2, H / 2);

  const data = ctx.getImageData(0, 0, W, H).data;
  const found: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 3) {
      if (data[(y * W + x) * 4 + 3] > 128) {
        found.push({
          x: (x / W - 0.5) * boxWidth,
          y: (y / H - 0.5) * boxHeight,
        });
      }
    }
  }
  if (found.length <= maxPoints) return found;
  const stride = found.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, i) => found[Math.floor(i * stride)]);
}

/**
 * Deterministic QR-style module matrix.
 *
 * Deliberately NOT a scannable code: this square exists to be destroyed. The
 * real, scannable QR is the printed tent card on the table. Seeded from the
 * table token so the pattern is stable for a given table instead of reshuffling
 * on every mount.
 */
function buildQrMatrix(token: string, size = 25): boolean[][] {
  let seed = 0;
  for (let i = 0; i < token.length; i++) seed = (seed * 31 + token.charCodeAt(i)) | 0;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const grid = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => rand() > 0.52)
  );

  // Finder patterns in three corners — what makes it read as a QR at a glance.
  const stamp = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const ring = x === 0 || x === 6 || y === 0 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        const on = ring || core;
        const gy = oy + y;
        const gx = ox + x;
        if (gy < size && gx < size) grid[gy][gx] = on;
      }
    }
  };
  stamp(0, 0);
  stamp(size - 7, 0);
  stamp(0, size - 7);
  return grid;
}

type QrPhase = 'IDLE' | 'DISSOLVING' | 'FORMING' | 'DONE';

interface QrMorphProps {
  token: string;
  palette: SplashPalette;
  reducedMotion: boolean;
  /** Fired once the wordmark has assembled and the menu should take over. */
  onMaterialize: () => void;
}

/**
 * §13 — the signature moment: QR → particles → wordmark → menu.
 *
 * The guest drags across the code and it comes apart module by module; the
 * freed modules fly up and rebuild themselves as the wordmark. The rAF loop
 * runs ONLY while the interaction is live, so an idle splash costs nothing.
 */
const QrMorphCanvas: React.FC<QrMorphProps> = ({
  token,
  palette,
  reducedMotion,
  onMaterialize,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef<QrPhase>('IDLE');
  const dissolveRef = useRef(0);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const materializedRef = useRef(false);

  const particlesRef = useRef<
    Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      threshold: number;
      freed: boolean;
      tx: number;
      ty: number;
      alpha: number;
    }>
  >([]);

  const dimsRef = useRef({ w: 0, h: 0, cell: 0, ox: 0, oy: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    const w = parent?.clientWidth || 280;
    const h = parent?.clientHeight || 280;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const grid = buildQrMatrix(token);
    const size = grid.length;
    const cell = Math.floor((Math.min(w, h) * 0.72) / size);
    const ox = (w - cell * size) / 2;
    const oy = (h - cell * size) / 2;
    dimsRef.current = { w, h, cell, ox, oy };

    const targets = sampleTextPoints('MUREEH MENU', w * 0.92, h * 0.5, 420);
    let t = 0;
    particlesRef.current = [];
    grid.forEach((row, gy) => {
      row.forEach((on, gx) => {
        if (!on) return;
        const target = targets[t % Math.max(1, targets.length)];
        t += 1;
        particlesRef.current.push({
          x: ox + gx * cell + cell / 2,
          y: oy + gy * cell + cell / 2,
          vx: 0,
          vy: 0,
          size: Math.max(1.6, cell * 0.5),
          threshold: Math.random(),
          freed: false,
          tx: target ? w / 2 + target.x : w / 2,
          ty: target ? h / 2 + target.y : h / 2,
          alpha: 1,
        });
      });
    });

    if (reducedMotion) {
      // Guests who asked for less motion get the wordmark, not the flight.
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = rgbaCss(palette.glow, 0.95);
      ctx.font = `800 ${Math.round(h * 0.14)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('MUREEH MENU', w / 2, h / 2);
      if (!materializedRef.current) {
        materializedRef.current = true;
        onMaterialize();
      }
      return;
    }

    // Idle frame: the intact code, waiting to be dragged apart.
    ctx.fillStyle = rgbaCss(palette.link, 0.85);
    grid.forEach((row, gy) => {
      row.forEach((on, gx) => {
        if (on) ctx.fillRect(ox + gx * cell, oy + gy * cell, cell * 0.86, cell * 0.86);
      });
    });

    const loop = () => {
      rafRef.current = null;
      const phase = phaseRef.current;
      if (phase === 'IDLE' || phase === 'DONE') return;

      ctx.clearRect(0, 0, w, h);
      const dissolve = dissolveRef.current;
      let settled = 0;

      for (const p of particlesRef.current) {
        if (!p.freed && dissolve > p.threshold) p.freed = true;

        if (!p.freed) {
          ctx.fillStyle = rgbaCss(palette.link, 0.85);
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size * 0.86, p.size * 0.86);
          continue;
        }

        if (phase === 'DISSOLVING') {
          // Freed modules lift and scatter before the wordmark calls them in.
          p.vy -= 0.16;
          p.vx += (Math.random() - 0.5) * 0.3;
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.98;
          p.vy *= 0.98;
        } else {
          p.x += (p.tx - p.x) * 0.09;
          p.y += (p.ty - p.y) * 0.09;
          if (Math.abs(p.tx - p.x) < 1.2 && Math.abs(p.ty - p.y) < 1.2) settled += 1;
        }

        ctx.shadowBlur = 6;
        ctx.shadowColor = rgbaCss(palette.glow, 0.7);
        ctx.fillStyle = rgbaCss(palette.shades[1], Math.min(1, p.alpha));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      const allFreed = particlesRef.current.every((p) => p.freed);
      if (phase === 'DISSOLVING' && allFreed && dissolve >= 1) {
        phaseRef.current = 'FORMING';
      } else if (
        phase === 'FORMING' &&
        settled > particlesRef.current.length * 0.86 &&
        !materializedRef.current
      ) {
        materializedRef.current = true;
        phaseRef.current = 'DONE';
        onMaterialize();
      }

      if (phaseRef.current !== 'DONE') rafRef.current = requestAnimationFrame(loop);
    };

    const start = () => {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
    };

    const handlePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const last = lastPointRef.current;
      if (event.type === 'pointerdown') {
        lastPointRef.current = { x, y };
        if (phaseRef.current === 'IDLE') phaseRef.current = 'DISSOLVING';
        start();
        return;
      }
      if (last && phaseRef.current !== 'DONE') {
        const dist = Math.hypot(x - last.x, y - last.y);
        // ~1.5 canvas widths of drag completes the dissolve.
        dissolveRef.current = Math.min(1, dissolveRef.current + dist / (w * 1.5));
        if (phaseRef.current === 'IDLE') phaseRef.current = 'DISSOLVING';
        start();
      }
      lastPointRef.current = { x, y };
    };

    canvas.addEventListener('pointerdown', handlePointer);
    canvas.addEventListener('pointermove', handlePointer);
    canvas.addEventListener('pointerup', handlePointer);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointer);
      canvas.removeEventListener('pointermove', handlePointer);
      canvas.removeEventListener('pointerup', handlePointer);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [token, palette, reducedMotion, onMaterialize]);

  return (
    <canvas
      ref={canvasRef}
      className="welcome-qr block h-full w-full cursor-grab touch-none active:cursor-grabbing"
      role="img"
      aria-label="اسحب إصبعك على الرمز ليتحوّل إلى القائمة الرقمية"
    />
  );
};

export interface MenuDeviceProps {
  restaurantName: string;
  restaurantNameEn: string;
  monogram: string;
  logoImg: string;
  tableNumStr: string | null;
  currency: string;
  defaultLanguage: 'ar' | 'en';
  products: Product[];
  categories: Category[];
  expanded: boolean;
  reducedMotion: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}

export const WelcomeMenuDevice: React.FC<MenuDeviceProps> = ({
  restaurantName,
  restaurantNameEn,
  monogram,
  logoImg,
  tableNumStr,
  currency,
  defaultLanguage,
  products,
  categories,
  expanded,
  reducedMotion,
  onExpand,
  onCollapse,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [lang, setLang] = useState<'ar' | 'en'>(defaultLanguage);
  const [activeCat, setActiveCat] = useState('all');

  const clamp01 = (v: number) => Math.min(1, Math.max(-1, v));

  const applyTilt = () => {
    rafRef.current = null;
    const el = stageRef.current;
    if (!el) return;
    const { x, y } = pointerRef.current;
    // ±7° / ±5°: enough to read as an object in space, never as a game.
    el.style.setProperty('--tilt-y', `${(x * 7).toFixed(2)}deg`);
    el.style.setProperty('--tilt-x', `${(-y * 5).toFixed(2)}deg`);
    el.style.setProperty('--glare-x', `${(50 + x * 28).toFixed(1)}%`);
    el.style.setProperty('--glare-y', `${(50 - y * 28).toFixed(1)}%`);
  };

  const scheduleTilt = () => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(applyTilt);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || expanded) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerRef.current = {
      x: clamp01(((event.clientX - rect.left) / rect.width) * 2 - 1),
      y: clamp01(((event.clientY - rect.top) / rect.height) * 2 - 1),
    };
    scheduleTilt();
  };

  const resetTilt = () => {
    pointerRef.current = { x: 0, y: 0 };
    setDragging(false);
    scheduleTilt();
  };

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const shown = useMemo(() => {
    const scoped =
      activeCat === 'all' ? products : products.filter((p) => p.categoryId === activeCat);
    // Featured first, then catalogue order; Array#sort is stable.
    return [...scoped]
      .sort((a, b) => Number(!!b.isFeatured) - Number(!!a.isFeatured))
      .slice(0, expanded ? 8 : 3);
  }, [products, activeCat, expanded]);

  const label = (p: Product) => (lang === 'en' ? p.nameEn || p.name : p.name);

  return (
    <div
      ref={stageRef}
      className={`welcome-device-stage ${dragging ? 'welcome-device-stage--dragging' : ''}`}
      onPointerMove={handlePointerMove}
      onPointerDown={() => !reducedMotion && setDragging(true)}
      onPointerUp={resetTilt}
      onPointerCancel={resetTilt}
      onPointerLeave={resetTilt}
    >
      <div
        className={`welcome-device ${expanded ? 'welcome-device--expanded' : ''}`}
      >
        <button
          type="button"
          onClick={expanded ? onCollapse : onExpand}
          aria-expanded={expanded}
          aria-label={expanded ? 'تصغير قائمة المطعم' : `توسيع قائمة ${restaurantName}`}
          className="welcome-device__frame group block w-full cursor-pointer text-right focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <span className="welcome-device__screen block">
            {/* Screen content */}
            <span className="welcome-device__ui block">
              {/* Title bar */}
              <span className="flex items-center gap-2 border-b border-[var(--brand-line)] px-3 py-2.5">
                <span className="welcome-device__logo flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                  {logoImg ? (
                    <img src={logoImg} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="welcome-monogram font-serif text-sm font-black">
                      {monogram}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-bold text-luxury-50">
                    {lang === 'en' && restaurantNameEn ? restaurantNameEn : restaurantName}
                  </span>
                  {tableNumStr && (
                    <span className="block text-[9px] font-mono text-[var(--brand-primary-strong)]">
                      طاولة {tableNumStr}
                    </span>
                  )}
                </span>
                <span
                  role="button"
                  tabIndex={expanded ? 0 : -1}
                  aria-label="تبديل لغة القائمة"
                  onClick={(e) => {
                    if (!expanded) return;
                    e.stopPropagation();
                    setLang((l) => (l === 'ar' ? 'en' : 'ar'));
                  }}
                  onKeyDown={(e) => {
                    if (expanded && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      e.stopPropagation();
                      setLang((l) => (l === 'ar' ? 'en' : 'ar'));
                    }
                  }}
                  className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold transition-opacity ${
                    expanded ? 'opacity-100' : 'pointer-events-none opacity-40'
                  } border-[var(--brand-line-strong)] text-[var(--brand-primary-strong)]`}
                >
                  {lang === 'ar' ? 'EN' : 'ع'}
                </span>
              </span>

              {/* Categories — only once expanded */}
              {expanded && categories.length > 0 && (
                <span className="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-[var(--brand-line)] px-3 py-2">
                  {[{ id: 'all', name: 'الكل', nameEn: 'All' }, ...categories].map((c) => (
                    <span
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveCat(c.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          setActiveCat(c.id);
                        }
                      }}
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${
                        activeCat === c.id
                          ? 'brand-fill border-transparent'
                          : 'border-[var(--brand-line)] text-luxury-300'
                      }`}
                    >
                      {lang === 'en' ? c.nameEn || c.name : c.name}
                    </span>
                  ))}
                </span>
              )}

              {/* Dishes */}
              <span className="block space-y-1.5 px-3 py-2.5">
                {shown.length === 0 && (
                  <span className="block py-4 text-center text-[10px] text-luxury-400">
                    لا توجد أصناف في هذا القسم بعد
                  </span>
                )}
                {shown.map((p) => (
                  <span
                    key={p.id}
                    className="welcome-device__row flex items-center gap-2.5 rounded-xl px-1.5 py-1.5"
                  >
                    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-black/30">
                      {p.image && (
                        <img
                          src={optimizeImageUrl(p.image, 120, 70)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-bold text-luxury-100">
                        {label(p)}
                      </span>
                      {p.isFeatured && (
                        <span className="block text-[9px] font-semibold text-[var(--brand-primary-strong)]">
                          الأكثر طلباً
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] font-black text-[var(--brand-primary-strong)]" dir="ltr">
                      {formatPrice(p.price, currency)}
                    </span>
                  </span>
                ))}
              </span>
            </span>

            {/* Specular highlight that travels with the pointer */}
            <span className="welcome-device__glare" aria-hidden="true" />
          </span>
        </button>
      </div>

      {/* Cast shadow sits on the STAGE, not inside the rotated device, so it
          stays on the floor and shifts opposite the tilt instead of tilting
          along with the object. */}
      <span className="welcome-device__shadow" aria-hidden="true" />
    </div>
  );
};

export const LuxuryWelcomeScreen: React.FC<LuxuryWelcomeScreenProps> = ({
  onDismiss,
  initialStep = 'NETWORKING',
  initialQrMaterialized = false,
}) => {
  const { currentRestaurant, activeTableId, products, categories } = useRestaurant();

  // Read once: it never changes for the lifetime of a page, and reading it in an
  // effect would cost a second render just to reveal the CTA.
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  const [step, setStep] = useState<WelcomeStep>(initialStep);
  const [isDismissing, setIsDismissing] = useState(false);
  const [activeReviewIndex, setActiveReviewIndex] = useState(0);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  // Guests who asked for less motion get the CTA immediately — nothing to wait for.
  const [showTapHint, setShowTapHint] = useState(() => initialStep !== 'LOGO_REVEAL' || reducedMotion);
  const [reviewPaused, setReviewPaused] = useState(false);
  /** The menu device grows toward the guest, shows the real menu, then settles. */
  const [menuExpanded, setMenuExpanded] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);
  /** §13 — set once the dragged-apart QR has rebuilt itself as the wordmark. */
  const [qrMaterialized, setQrMaterialized] = useState(initialQrMaterialized);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const convergingRef = useRef(false);
  const resumeReviewRotationRef = useRef<number | null>(null);

  // Tenant palette -> the same `--brand-*` custom properties the menu consumes,
  // so the splash and the menu behind it can never drift apart.
  const theme = useBrandTheme(currentRestaurant?.primaryColor, currentRestaurant?.accentColor);
  const palette = useMemo(() => buildSplashPalette(theme), [theme]);

  // Extract clean table number
  const tableNumStr = useMemo(() => {
    if (!activeTableId) return null;
    const digits = activeTableId.replace(/\D+/g, '');
    if (!digits) return activeTableId;
    const n = parseInt(digits, 10);
    return n < 10 ? `0${n}` : String(n);
  }, [activeTableId]);

  const restName = currentRestaurant?.name || 'مطعم مريح';
  const restNameEn = currentRestaurant?.nameEn || '';
  const rawCoverImg =
    currentRestaurant?.coverImage ||
    'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1600&q=85';
  const coverImg = optimizeImageUrl(rawCoverImg, 1280, 70);
  const logoImg = currentRestaurant?.logo ? optimizeImageUrl(currentRestaurant.logo, 240, 85) : '';
  /** Monogram fallback when the tenant has not uploaded a logo yet. */
  const monogram = (restNameEn.charAt(0) || restName.charAt(0) || 'M').toUpperCase();
  const dishCount = products?.length ?? 0;
  const stageIndex = WELCOME_STAGES.indexOf(step as (typeof WELCOME_STAGES)[number]);
  const activeReview = CURATED_REVIEWS[activeReviewIndex] ?? CURATED_REVIEWS[0];
  // Venue kind is tenant data; unknown/older rows fall back to RESTAURANT.
  const venueCopy = VENUE_COPY[currentRestaurant?.businessType ?? 'RESTAURANT'];
  const stageLabel = STAGE_LABELS[step] ?? STAGE_LABELS.NETWORKING;
  const night = isNightSession();

  // Build curated gallery images from restaurant & products
  const galleryImages = useMemo(() => {
    const list: Array<{ id: string; title: string; url: string; tag: string }> = [];

    if (currentRestaurant?.coverImage) {
      list.push({
        id: 'cover',
        title: restName,
        url: currentRestaurant.coverImage,
        tag: 'الواجهة الرئيسية ✦',
      });
    }

    if (currentRestaurant?.galleryImages && currentRestaurant.galleryImages.length > 0) {
      currentRestaurant.galleryImages.forEach((img, idx) => {
        list.push({
          id: `custom-g-${idx}`,
          title: `أجواء ${restName}`,
          url: img,
          tag: 'أجواء المطعم ✨',
        });
      });
    }

    // Add signature dishes with photos
    if (products && products.length > 0) {
      products
        .filter((p) => p.image && p.image.trim().length > 10 && !p.image.includes('placeholder'))
        .slice(0, 4)
        .forEach((p) => {
          list.push({
            id: p.id,
            title: p.name,
            url: p.image,
            tag: p.badge || (p.isFeatured ? 'مختارات الشيف ✦' : 'الأكثر طلباً 🔥'),
          });
        });
    }

    if (list.length >= 4) return list.slice(0, 4);
    return [...list, ...DEFAULT_GALLERY_PHOTOS].slice(0, 4);
  }, [currentRestaurant, products, restName]);

  // ---------------------------------------------------------------------------
  // Canvas particle network + logo reveal animation (tenant-coloured)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (step === 'WELCOME_SHOWCASE') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const parent = canvas.parentElement;
    let width = parent?.clientWidth || window.innerWidth;
    let height = parent?.clientHeight || window.innerHeight;

    // Crisp on retina without paying for a 3x backing store.
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

    // Density follows the viewport: a phone does not need a desktop's 64 nodes,
    // and the link pass is O(n²).
    const buildParticles = () => {
      const count = Math.max(26, Math.min(64, Math.round((width * height) / 16000)));
      // Sample the tenant's initial ONCE per particle count so every particle
      // owns a point of the glyph — that is what makes the field assemble into
      // a letter rather than a cloud.
      const glyph = sampleGlyphPoints(monogram, Math.min(width, height) * 0.34, count);
      return Array.from({ length: count }, (_, i) => {
        const target = glyph[i];
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 1.4,
          vy: (Math.random() - 0.5) * 1.4,
          radius: Math.random() * 2.5 + 1.0,
          alpha: Math.random() * 0.6 + 0.35,
          shade: palette.shades[Math.floor(Math.random() * palette.shades.length)],
          // Centre-relative offsets, so a resize keeps the shape intact. A
          // glyph point when sampling worked, a small cluster otherwise.
          offsetX: target ? target.x : (Math.random() - 0.5) * 64,
          offsetY: target ? target.y : (Math.random() - 0.5) * 64,
        };
      });
    };

    let particles = buildParticles();

    const resize = () => {
      const nextWidth = parent?.clientWidth || window.innerWidth;
      const nextHeight = parent?.clientHeight || window.innerHeight;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = buildParticles();
    };

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const handleResize = () => resize();
    window.addEventListener('resize', handleResize);

    // Battery: stop drawing when the guest switches tabs mid-splash.
    const handleVisibility = () => {
      if (document.hidden) {
        if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      } else if (!animationFrameIdRef.current) {
        animationFrameIdRef.current = requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    let pulsePhase = 0;
    const glowColor = rgbaCss(palette.glow, 0.9);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const isConverging = convergingRef.current;

      // Subtle pulse rings behind the medallion while "connecting".
      if (!isConverging) {
        pulsePhase += 0.018;
        for (let r = 1; r <= 3; r++) {
          const radius = 55 + r * 55 + Math.sin(pulsePhase + r) * 12;
          const alpha =
            Math.max(0, 0.1 - r * 0.024) * (0.5 + 0.5 * Math.sin(pulsePhase * 1.5 + r));
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.strokeStyle = rgbaCss(palette.link, alpha);
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      // Connection lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distSq = dx * dx + dy * dy;
          const maxDist = isConverging ? 90 : 130;

          if (distSq < maxDist * maxDist) {
            const dist = Math.sqrt(distSq);
            const lineAlpha = (1 - dist / maxDist) * (isConverging ? 0.42 : 0.2);
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = rgbaCss(palette.link, lineAlpha);
            ctx.lineWidth = isConverging ? 1 : 0.7;
            ctx.stroke();
          }
        }
      }

      // Particles
      for (const p of particles) {
        if (isConverging) {
          p.x += (centerX + p.offsetX - p.x) * 0.07;
          p.y += (centerY + p.offsetY - p.y) * 0.07;
          p.alpha = Math.min(1, p.alpha + 0.004);
        } else {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;
        }

        if (p.radius > 2) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = glowColor;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = rgbaCss(p.shade, p.alpha);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    const render = () => {
      draw();
      animationFrameIdRef.current = requestAnimationFrame(render);
    };

    // Guests who asked for less motion get one composed frame instead of a
    // loop; the CSS layer already neutralises its own animations for them.
    if (reducedMotion) {
      draw();
    } else {
      animationFrameIdRef.current = requestAnimationFrame(render);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    };
  }, [step, palette, reducedMotion, monogram]);

  // ---------------------------------------------------------------------------
  // Stage timings: NETWORKING -> LOGO_REVEAL -> tap hint
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (step !== 'NETWORKING') return;
    const timer = setTimeout(() => {
      convergingRef.current = true;
      setStep('LOGO_REVEAL');
    }, reducedMotion ? 600 : NETWORKING_MS);
    return () => clearTimeout(timer);
  }, [step, reducedMotion]);

  useEffect(() => {
    // Under reduced motion the hint is already visible from the initial state.
    if (step !== 'LOGO_REVEAL' || reducedMotion) return;
    // Delay the hint so the guest first watches the logo assemble, then sees the CTA.
    const timer = setTimeout(() => setShowTapHint(true), TAP_HINT_MS);
    return () => clearTimeout(timer);
  }, [step, reducedMotion]);

  // ---------------------------------------------------------------------------
  // Auto-rotating reviews (paused while the guest is reading / interacting)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (step !== 'WELCOME_SHOWCASE' || reviewPaused) return;
    const interval = setInterval(() => {
      setActiveReviewIndex((prev) => (prev + 1) % CURATED_REVIEWS.length);
    }, REVIEW_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [step, reviewPaused]);

  // Lock the page behind the overlay, and release it on unmount.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(
    () => () => {
      if (resumeReviewRotationRef.current) window.clearTimeout(resumeReviewRotationRef.current);
    },
    []
  );

  const handleEnterShowcase = () => {
    if (step === 'WELCOME_SHOWCASE') return;
    soundFX.playTap();
    convergingRef.current = true;
    setStep('WELCOME_SHOWCASE');
  };

  const handleStartBrowsing = () => {
    if (isDismissing) return;
    soundFX.playChime();
    setIsDismissing(true);
    const delay = reducedMotion ? 0 : DISMISS_MS;
    if (delay === 0) {
      onDismiss();
      return;
    }
    setTimeout(onDismiss, delay);
  };

  // The device pulls back on its own so the splash can never trap the guest
  // inside a preview they did not mean to open.
  const collapseMenuDevice = () => {
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
    setMenuExpanded(false);
  };

  const expandMenuDevice = () => {
    soundFX.playTap();
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    setMenuExpanded(true);
    collapseTimerRef.current = window.setTimeout(collapseMenuDevice, 9000);
  };

  useEffect(
    () => () => {
      if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    },
    []
  );

  // §8 — scroll is a timeline, not just a translation. One rAF-throttled read
  // per event writes a SINGLE custom property; parallax and the progress rail
  // both consume it in CSS, so scrolling triggers no React render at all.
  const handleScroll = () => {
    if (reducedMotion) return;
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = shellRef.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
      el.style.setProperty('--scroll', progress.toFixed(4));
    });
  };

  useEffect(
    () => () => {
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    },
    []
  );

  const handleReviewSelect = (idx: number) => {
    soundFX.playTap();
    setActiveReviewIndex(idx);
    setReviewPaused(true);
    if (resumeReviewRotationRef.current) window.clearTimeout(resumeReviewRotationRef.current);
    // Resume auto-rotate after a while so the carousel never stalls for good.
    resumeReviewRotationRef.current = window.setTimeout(() => setReviewPaused(false), 12000);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    if (lightboxImage) {
      setLightboxImage(null);
      return;
    }
    handleStartBrowsing();
  };

  const stageAnnouncement =
    step === 'NETWORKING'
      ? `جارٍ الاتصال بـ ${restName}`
      : step === 'LOGO_REVEAL'
        ? `${restName} — اضغط الدخول لعرض القائمة`
        : `مرحباً بك في ${restName}${tableNumStr ? ` — طاولة ${tableNumStr}` : ''}`;

  return (
    <div
      ref={shellRef}
      onScroll={handleScroll}
      className={`welcome-shell fixed inset-0 z-50 flex flex-col text-luxury-100 select-none overflow-y-auto transition-opacity duration-300 ${
        night ? 'welcome-shell--night' : ''
      } ${isDismissing ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label={`شاشة الترحيب في ${restName}`}
      onKeyDown={handleKeyDown}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {stageAnnouncement}
      </span>

      {/* ================================================================= */}
      {/* STAGE 1 & 2: Secure-link animation & tenant logo reveal            */}
      {/* ================================================================= */}
      {step !== 'WELCOME_SHOWCASE' && (
        <div className="relative flex min-h-full flex-col items-center justify-between px-6 py-5">
          {/* Themed particle canvas + ambient aura + drifting stars */}
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-0" aria-hidden="true" />
          <div className="welcome-aura pointer-events-none absolute inset-0 z-0" aria-hidden="true" />
          <WelcomeStarField className="z-0" />

          {/* Top bar: stage progress + skip */}
          <div className="relative z-10 flex w-full items-center justify-between gap-3">
            <div className="welcome-progress" aria-hidden="true">
              <span className="welcome-progress__label">
                <span className="welcome-progress__index">{stageLabel.index}</span>
                {stageLabel.label}
              </span>
              {WELCOME_STAGES.map((stage, idx) => (
                <span
                  key={stage}
                  className={`welcome-progress__seg ${idx === stageIndex ? 'welcome-progress__seg--active' : ''}`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={handleStartBrowsing}
              className="welcome-chip cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur-md transition-all hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95"
            >
              تخطي للمنيو مباشرة
            </button>
          </div>

          {/* Centre stage */}
          <div className="relative z-10 my-auto flex w-full max-w-sm flex-col items-center px-4 text-center">
            {step === 'NETWORKING' ? (
              <div className="animate-in fade-in space-y-6 duration-500">
                {/* Scanning medallion */}
                <div className="welcome-medallion mx-auto flex h-24 w-24 items-center justify-center rounded-3xl">
                  <span className="absolute inset-0 animate-ping rounded-3xl border border-[rgb(var(--brand-primary-strong-rgb)/0.25)] [animation-duration:2.4s]" />
                  <QrCode className="h-9 w-9 text-[var(--brand-primary-strong)]" />
                </div>

                <div className="space-y-2.5">
                  <h2 className="font-serif text-2xl font-bold tracking-wide text-luxury-50">
                    أهلاً بك في {restName}
                  </h2>
                  <p className="text-xs leading-relaxed text-luxury-300">
                    جارٍ إنشاء الاتصال الرقمي الآمن بطاولتك وتحميل القائمة
                  </p>
                  {tableNumStr && (
                    <span className="welcome-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px]">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      طاولة {tableNumStr}
                    </span>
                  )}
                </div>

                {/* Connecting dots */}
                <div className="flex items-center gap-2" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--brand-primary-strong)] [animation-duration:1s]"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              /* LOGO_REVEAL — the medallion is a real button, so an eager tap is
                 never swallowed while the hint is still fading in. */
              <div className="animate-in zoom-in-90 fade-in w-full space-y-6 duration-700">
                <button
                  type="button"
                  onClick={handleEnterShowcase}
                  aria-label={`الدخول إلى قائمة ${restName}`}
                  className="group mx-auto block cursor-pointer rounded-[2rem] transition-transform duration-500 focus-visible:outline-2 focus-visible:outline-offset-4 active:scale-[0.97]"
                >
                  <span className="welcome-medallion relative mx-auto flex h-32 w-32 items-center justify-center overflow-hidden rounded-[1.75rem] sm:h-36 sm:w-36">
                    {logoImg ? (
                      <img
                        src={logoImg}
                        alt={restName}
                        className="h-full w-full p-2 object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="eager"
                        decoding="async"
                      />
                    ) : (
                      <span className="welcome-monogram font-serif text-5xl font-black sm:text-6xl">
                        {monogram}
                      </span>
                    )}
                  </span>
                </button>

                <div className="space-y-1.5">
                  <h2 className="font-serif text-3xl font-black tracking-tight text-luxury-50 sm:text-4xl">
                    {restName}
                  </h2>
                  {restNameEn && (
                    <p className="text-[11px] font-serif font-semibold uppercase tracking-[0.28em] text-[var(--brand-primary-strong)]">
                      {restNameEn}
                    </p>
                  )}
                </div>

                {/* Tap hint — revealed a beat after the logo settles */}
                <div
                  className={`pt-1 transition-all duration-700 ${
                    showTapHint
                      ? 'translate-y-0 opacity-100'
                      : 'pointer-events-none translate-y-3 opacity-0'
                  }`}
                >
                  <button
                    type="button"
                    onClick={handleEnterShowcase}
                    className="welcome-cta inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-full px-7 py-3 text-sm font-bold transition-all active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <span className="relative z-10">المس للدخول إلى القائمة</span>
                    <ArrowLeft className="relative z-10 h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Platform watermark */}
          <div className="relative z-10 text-center text-[10px] tracking-[0.2em] text-luxury-500">
            MUREEH · منصة الضيافة الرقمية
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STAGE 3: Restaurant welcome showcase                               */}
      {/* ================================================================= */}
      {step === 'WELCOME_SHOWCASE' && (
        <div className="animate-in fade-in relative z-10 flex min-h-screen w-full flex-col justify-between duration-500">
          {/* Ambient cover art on the shared dark canvas */}
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
            <img
              src={coverImg}
              alt=""
              loading="eager"
              decoding="async"
              className="welcome-parallax h-full w-full object-cover object-center opacity-[0.16] blur-sm"
            />
            <div className="welcome-scrim absolute inset-0" />
            <div className="welcome-aura absolute inset-0 opacity-70" />
            <WelcomeStarField />
          </div>

          {/* Header: table session + location */}
          <header className="relative z-10 mx-auto flex w-full max-w-xl items-center justify-between gap-2 px-4 pt-4 text-xs sm:px-6">
            {tableNumStr ? (
              <div className="welcome-chip inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 shadow-md backdrop-blur-md">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                <span className="font-semibold text-luxury-100">طاولة</span>
                <span className="welcome-chip__value rounded-md bg-black/25 px-1.5 font-mono text-sm font-black">
                  {tableNumStr}
                </span>
                <span className="text-[10px] font-medium text-emerald-400">● متصل</span>
              </div>
            ) : (
              <div className="welcome-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 backdrop-blur-md">
                <Sparkles className="h-3.5 w-3.5" />
                <span>جلسة ضيافة مباشرة</span>
              </div>
            )}

            {currentRestaurant?.address && (
              <div className="hidden max-w-[190px] truncate items-center gap-1 rounded-full border border-white/5 bg-black/25 px-2.5 py-1 text-[11px] text-luxury-300 backdrop-blur-md xs:flex">
                <MapPin className="h-3 w-3 shrink-0 text-[var(--brand-primary-strong)]" />
                <span className="truncate">{currentRestaurant.address}</span>
              </div>
            )}

            {/* Beat 03 keeps the same indicator as beats 01/02, so the guest
                always knows where they are in the sequence. */}
            <div className="welcome-progress" aria-hidden="true">
              <span className="welcome-progress__label">
                <span className="welcome-progress__index">{stageLabel.index}</span>
                {stageLabel.label}
              </span>
              {WELCOME_STAGES.map((stage, idx) => (
                <span
                  key={stage}
                  className={`welcome-progress__seg ${idx === stageIndex ? 'welcome-progress__seg--active' : ''}`}
                >
                  {idx === WELCOME_STAGES.length - 1 && (
                    <span className="welcome-progress__fill" />
                  )}
                </span>
              ))}
            </div>
          </header>

          {/* Main content */}
          <main className="relative z-10 mx-auto w-full max-w-xl flex-1 space-y-5 px-4 py-5 sm:px-6">
            {/* 1. Identity */}
            <div className="space-y-3 pt-1 text-center">
              <div className="welcome-medallion relative mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl sm:h-24 sm:w-24">
                {logoImg ? (
                  <img
                    src={logoImg}
                    alt={restName}
                    className="h-full w-full p-1 object-cover"
                    loading="eager"
                    decoding="async"
                  />
                ) : (
                  <span className="welcome-monogram font-serif text-3xl font-black">{monogram}</span>
                )}
              </div>

              <div className="space-y-1">
                <h2 className="font-serif text-2xl font-black leading-snug tracking-tight text-luxury-50 sm:text-3xl">
                  {restName}
                </h2>
                {restNameEn && (
                  <p className="text-[11px] font-serif font-semibold uppercase tracking-[0.22em] text-[var(--brand-primary-strong)]">
                    {restNameEn}
                  </p>
                )}
              </div>

              <p className="mx-auto max-w-md pt-1 text-xs leading-relaxed text-luxury-300 sm:text-sm">
                {currentRestaurant?.description ||
                  `أهلاً وسهلاً بكم في ${restName}، حيث نحرص على أن تكون كل زيارة تجربة طعام استثنائية تستحق أن تُتذكر.`}
              </p>

              {/* Venue-specific framing — a café guest is not told about tables */}
              <p className="welcome-venue-tagline mx-auto max-w-sm pt-0.5 text-[11px] font-semibold">
                {venueCopy.tagline}
              </p>

              {/* Real catalogue facts instead of decorative filler */}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <span className="welcome-chip welcome-chip--solid inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold">
                  {venueCopy.chip}
                </span>
                <span className="welcome-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold">
                  <UtensilsCrossed className="h-3.5 w-3.5" />
                  {dishCount > 0 ? `${dishCount} صنف في القائمة` : 'قائمة قيد التحضير'}
                </span>
                {categories.length > 0 && (
                  <span className="welcome-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold">
                    <Flame className="h-3.5 w-3.5" />
                    {categories.length} أقسام
                  </span>
                )}
              </div>
            </div>

            {/* 2. Interactive menu device — the product is the hero object.
                Rendered outside the backdrop so the dimmed layer never sits
                inside a transformed ancestor (a fixed child of a transformed
                element would be positioned against the element, not the page). */}
            {menuExpanded && (
              <div
                className="welcome-device-backdrop absolute inset-0 z-20"
                onClick={collapseMenuDevice}
                aria-hidden="true"
              />
            )}
            <div className={`relative ${menuExpanded ? 'z-30' : 'z-10'}`}>
              <WelcomeMenuDevice
                restaurantName={restName}
                restaurantNameEn={restNameEn}
                monogram={monogram}
                logoImg={logoImg}
                tableNumStr={tableNumStr}
                currency={currentRestaurant?.currency || '₪'}
                defaultLanguage={currentRestaurant?.language === 'en' ? 'en' : 'ar'}
                products={products || []}
                categories={categories || []}
                expanded={menuExpanded}
                reducedMotion={reducedMotion}
                onExpand={expandMenuDevice}
                onCollapse={collapseMenuDevice}
              />
              <p className="welcome-device-hint pt-3 text-center text-[10px] font-semibold">
                {menuExpanded ? 'المس في أي مكان للعودة' : 'حرّك إصبعك على الجهاز — والمسّه ليفتح القائمة'}
              </p>
            </div>

            {/* 3. §13 signature moment — drag the QR apart, it rebuilds as the
                wordmark, and the menu materialises out of the same particles. */}
            <section
              className="welcome-qr-section relative mx-auto w-full max-w-[300px] text-center"
              aria-label="تحوّل رمز QR إلى القائمة الرقمية"
            >
              <div className="welcome-qr-stage relative mx-auto aspect-square w-full max-w-[260px]">
                {qrMaterialized ? (
                  <div className="animate-in fade-in zoom-in-95 flex h-full w-full flex-col items-center justify-center gap-2 duration-700">
                    <span className="welcome-wordmark font-serif text-2xl font-black tracking-[0.18em]">
                      MUREEH
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.42em] text-[var(--brand-primary-strong)]">
                      MENU
                    </span>
                    <span className="pt-1 text-[10px] text-luxury-400">
                      رمز واحد يفتح تجربة كاملة
                    </span>
                  </div>
                ) : (
                  <QrMorphCanvas
                    token={tableNumStr || currentRestaurant?.slug || 'mureeh'}
                    palette={palette}
                    reducedMotion={reducedMotion}
                    onMaterialize={() => setQrMaterialized(true)}
                  />
                )}
              </div>
              {!qrMaterialized && (
                <p className="welcome-device-hint pt-2 text-[10px] font-semibold">
                  اسحب إصبعك على الرمز
                </p>
              )}
            </section>

            {/* 4. Gallery — shown before the reviews */}
            <section className="space-y-2.5 text-right" aria-label={`صور من ${restName}`}>
              <div className="flex items-center justify-between px-1">
                <h3 className="flex items-center gap-1.5 font-serif text-xs font-bold text-luxury-200">
                  <Flame className="h-3.5 w-3.5 text-[var(--brand-primary-strong)]" />
                  <span>صور من أجواء وضيافة {restName}</span>
                </h3>
                <span className="text-[10px] text-luxury-500">المس أي صورة للتكبير</span>
              </div>

              {/* Asymmetric editorial grid */}
              <div className="grid grid-cols-2 gap-2">
                {galleryImages[0] && (
                  <button
                    type="button"
                    onClick={() => setLightboxImage(galleryImages[0].url)}
                    aria-label={`تكبير صورة: ${galleryImages[0].title}`}
                    className="welcome-tile group col-span-2 h-44 cursor-pointer rounded-2xl sm:h-52"
                  >
                    <img
                      src={optimizeImageUrl(galleryImages[0].url, 800, 80)}
                      alt={galleryImages[0].title}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="welcome-tile__scrim absolute inset-0" />
                    <span className="absolute inset-x-3 bottom-3 z-10 flex items-end justify-between gap-2">
                      <span className="truncate text-xs font-bold text-white drop-shadow">
                        {galleryImages[0].title}
                      </span>
                      <span className="welcome-chip shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur-md">
                        {galleryImages[0].tag}
                      </span>
                    </span>
                  </button>
                )}

                {galleryImages.slice(1, 4).map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLightboxImage(item.url)}
                    aria-label={`تكبير صورة: ${item.title}`}
                    className={`welcome-tile group cursor-pointer rounded-2xl ${
                      idx === 0 ? 'col-span-2 h-36 sm:h-40' : 'h-28 sm:h-36'
                    }`}
                  >
                    <img
                      src={optimizeImageUrl(item.url, 500, 75)}
                      alt={item.title}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="welcome-tile__scrim absolute inset-0" />
                    <span className="absolute inset-x-2.5 bottom-2 z-10 block text-right">
                      <span className="block truncate text-[10px] font-bold text-white drop-shadow">
                        {item.title}
                      </span>
                      <span className="text-[9px] font-medium text-[var(--brand-primary-strong)]">
                        {item.tag}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* 5. Guest reviews — below the gallery — auto-rotating, with a visible timer */}
            <section
              className="welcome-card rounded-2xl p-4 text-right shadow-lg"
              aria-label="آراء ضيوف المطعم"
              onMouseEnter={() => setReviewPaused(true)}
              onMouseLeave={() => setReviewPaused(false)}
              onFocusCapture={() => setReviewPaused(true)}
              onBlurCapture={() => setReviewPaused(false)}
            >
              <div className="flex items-center justify-between border-b border-[var(--brand-line)] pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 text-[var(--brand-primary-strong)]">
                    {Array.from({ length: activeReview.rating }).map((_, i) => (
                      <Star
                        key={i}
                        className="h-3.5 w-3.5 fill-[rgb(var(--brand-primary-strong-rgb)/0.85)]"
                      />
                    ))}
                  </div>
                  <span className="font-mono text-xs font-bold text-luxury-50">4.9 / 5.0</span>
                </div>
                <span className="text-[11px] text-[var(--brand-muted)]">من آراء ضيوفنا الكرام</span>
              </div>

              <div
                className="relative min-h-[84px] space-y-2 pt-3"
                role="group"
                aria-live="polite"
                aria-atomic="true"
              >
                <Quote className="absolute -top-0.5 right-0 h-5 w-5 text-[rgb(var(--brand-primary-strong-rgb)/0.35)]" />
                <p
                  key={activeReview.id}
                  className="animate-in fade-in pr-6 text-xs italic leading-relaxed text-luxury-200 duration-500"
                >
                  &ldquo;{activeReview.comment}&rdquo;
                </p>
                <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
                  <span className="font-bold text-[var(--brand-primary-strong)]">
                    — {activeReview.author}
                  </span>
                  <span className="text-[10px] text-luxury-500">{activeReview.badge}</span>
                </div>
              </div>

              {/* Dots double as the auto-advance timer */}
              <div className="flex items-center justify-center gap-2 pt-3">
                {CURATED_REVIEWS.map((review, idx) => (
                  <button
                    key={review.id}
                    type="button"
                    onClick={() => handleReviewSelect(idx)}
                    aria-label={`عرض التقييم ${idx + 1} من ${CURATED_REVIEWS.length}`}
                    aria-current={idx === activeReviewIndex}
                    className={`welcome-dot cursor-pointer rounded-full transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      idx === activeReviewIndex ? 'welcome-dot--active' : ''
                    }`}
                  >
                    {idx === activeReviewIndex && (
                      <span
                        key={`${activeReview.id}-${reviewPaused}`}
                        className={`welcome-dot__timer ${reviewPaused ? 'welcome-dot__timer--paused' : ''}`}
                        style={{ animationDuration: `${REVIEW_INTERVAL_MS}ms` }}
                      />
                    )}
                  </button>
                ))}
              </div>
            </section>
          </main>

          {/* Sticky CTA */}
          <footer className="welcome-footer-scrim relative z-10 mx-auto w-full max-w-xl space-y-3 px-4 pb-6 pt-4 sm:px-6">
            <button
              type="button"
              onClick={handleStartBrowsing}
              className="welcome-cta group flex min-h-[54px] w-full cursor-pointer items-center justify-center gap-3 rounded-2xl px-6 py-4 text-sm font-black transition-all active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 sm:text-base"
            >
              <span className="relative z-10">ابدأ التصفح واستكشف القائمة</span>
              <ArrowLeft className="relative z-10 h-5 w-5 transition-transform group-hover:-translate-x-1" />
            </button>

            <div className="flex items-center justify-between px-1 text-[11px] text-luxury-500">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>مدعوم بـ</span>
                <span className="font-bold tracking-wide text-luxury-200">MUREEH</span>
              </div>
              <a
                href="https://t.me/Mureeh_tech_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-luxury-300 transition-colors hover:text-luxury-50 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <MessageCircle className="h-3.5 w-3.5 text-[var(--brand-primary-strong)]" />
                <span>الدعم الفني</span>
              </a>
            </div>
          </footer>

          {/* Lightbox */}
          {lightboxImage && (
            <div
              className="animate-in fade-in fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-4 backdrop-blur-xl duration-200"
              onClick={() => setLightboxImage(null)}
              role="dialog"
              aria-modal="true"
              aria-label="معاينة الصورة"
            >
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="absolute left-4 top-4 z-10 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label="إغلاق المعاينة"
              >
                <X className="h-5 w-5" />
              </button>
              <div
                className="relative max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--brand-line-strong)] shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={optimizeImageUrl(lightboxImage, 1400, 85)}
                  alt={restName}
                  className="mx-auto max-h-[75vh] w-full bg-black object-contain"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
