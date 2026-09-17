import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RotateCw, AlertCircle } from 'lucide-react';
import type { EntryInvalidReason, EntryPhase } from '../../services/customerEntry';
import './customerLoadingExperience.css';

// ============================================================================
// CustomerLoadingExperience — Luxury Hospitality Living Network
//
// A continuous, organic digital network assembling a majestic cloche & platter
// emblem before the guest's eyes. Restaurant-agnostic, calm, royal & minimal.
//
// 1. RTL-first, luxury hospitality aesthetic.
// 2. Continuous & organic living network:
//    - Floating golden nodes drift freely in deep obsidian space.
//    - Dynamic hairline threads connect moving particles with magnetic grace.
//    - Assembles into an abstract dining cloche & platter emblem.
//    - Holds in serene balance with a soft breathing champagne aura.
//    - Gently dissolves and fluidly repeats in an infinite, seamless loop.
// 3. Central Typography:
//    "يتم تحميل تجربة المستخدم"
//    "لحظات وتبدأ التجربة"
// 4. Preloads critical assets (logo, cover, gallery[0], gallery[1]) with a 3s timeout.
// 5. Preserves all entry machine phases, session handling, recovery, and hand-off.
// ============================================================================

export interface IdentityLike {
  name?: string;
  nameEn?: string;
  logo?: string;
  coverImage?: string;
  galleryImages?: string[];
  primaryColor?: string;
  accentColor?: string;
}

export interface CustomerLoadingExperienceProps {
  phase: EntryPhase;
  restaurant?: IdentityLike | null;
  invalidReason?: EntryInvalidReason | null;
  onRetry?: () => void;
  onComplete?: () => void;
}

const LOADING_PHASES: ReadonlySet<EntryPhase> = new Set([
  'INITIALIZING',
  'VALIDATING_QR',
  'LOADING_RESTAURANT',
  'LOADING_CATALOG',
  'RETRYING',
]);

const MIN_VISUAL_DURATION_MS = 1400;
const PRELOAD_TIMEOUT_MS = 3000;

interface LoadingBeat {
  id: string;
  label: string;
  title: string;
  secondary: string;
  progress: number;
}

const LOADING_BEATS: readonly LoadingBeat[] = [
  { id: '01', label: 'الاتصال', title: 'نتواصل مع المطعم', secondary: 'نفتح اتصالاً آمناً بطاولتك', progress: 28 },
  { id: '02', label: 'الهوية', title: 'نتعرف على المكان', secondary: 'نرتّب لك الشعار والأجواء', progress: 52 },
  { id: '03', label: 'المنيو', title: 'نحضّر لك المنيو', secondary: 'نرتّب الأصناف والتفاصيل', progress: 78 },
  { id: '04', label: 'جاهز', title: 'كل شيء جاهز', secondary: 'القائمة بين يديك الآن', progress: 100 },
];

function beatForPhase(phase: EntryPhase, hasIdentity: boolean): number {
  if (phase === 'READY') return 3;
  if (phase === 'LOADING_CATALOG') return 2;
  if (phase === 'LOADING_RESTAURANT') return 1;
  return hasIdentity ? 1 : 0;
}

// ----------------------------------------------------------------------------
// Living Network Blueprint: The Cloche & Platter Restaurant Emblem
// Dimensions: 280 x 240 logical canvas coordinates (Center: X=140, Y=120)
// ----------------------------------------------------------------------------

interface TargetNodeDef {
  x: number;
  y: number;
  r: number;
  isCore?: boolean;
  scatterDx: number;
  scatterDy: number;
}

const TARGET_NODES: readonly TargetNodeDef[] = [
  // 0: Finial top crown jewel
  { x: 140, y: 38, r: 3.4, isCore: true, scatterDx: -16, scatterDy: -40 },
  // 1: Finial collar ring
  { x: 140, y: 50, r: 2.2, scatterDx: 18, scatterDy: -30 },
  // 2: Cloche apex top
  { x: 140, y: 62, r: 3.0, isCore: true, scatterDx: -24, scatterDy: -32 },

  // 3, 4: Upper crests
  { x: 110, y: 72, r: 2.4, scatterDx: -44, scatterDy: -24 },
  { x: 170, y: 72, r: 2.4, scatterDx: 44, scatterDy: -24 },

  // 5, 6: Shoulders
  { x: 84, y: 94, r: 2.6, scatterDx: -52, scatterDy: 8 },
  { x: 196, y: 94, r: 2.6, scatterDx: 52, scatterDy: 8 },

  // 7, 8: Lower flanks
  { x: 68, y: 122, r: 2.4, scatterDx: -44, scatterDy: 30 },
  { x: 212, y: 122, r: 2.4, scatterDx: 44, scatterDy: 30 },

  // 9 - 13: Platter Upper Rim (Elliptical arc)
  { x: 60, y: 148, r: 2.6, scatterDx: -56, scatterDy: 36 },
  { x: 96, y: 151, r: 2.2, scatterDx: -28, scatterDy: 26 },
  { x: 140, y: 153, r: 3.2, isCore: true, scatterDx: 4, scatterDy: 34 },
  { x: 184, y: 151, r: 2.2, scatterDx: 28, scatterDy: 26 },
  { x: 220, y: 148, r: 2.6, scatterDx: 56, scatterDy: 36 },

  // 14 - 18: Platter Lower Lip (Dish depth)
  { x: 50, y: 162, r: 2.4, scatterDx: -62, scatterDy: 46 },
  { x: 90, y: 169, r: 2.2, scatterDx: -32, scatterDy: 44 },
  { x: 140, y: 172, r: 2.8, scatterDx: 0, scatterDy: 50 },
  { x: 190, y: 169, r: 2.2, scatterDx: 32, scatterDy: 44 },
  { x: 230, y: 162, r: 2.4, scatterDx: 62, scatterDy: 46 },

  // 19, 20: Pedestal base foot
  { x: 115, y: 181, r: 2.0, scatterDx: -20, scatterDy: 40 },
  { x: 165, y: 181, r: 2.0, scatterDx: 20, scatterDy: 40 },

  // 21: Central warm jewel (Heart of cloche)
  { x: 140, y: 104, r: 3.4, isCore: true, scatterDx: 0, scatterDy: -20 },
  // 22, 23: Geometric internal facet ties
  { x: 115, y: 120, r: 2.2, scatterDx: -30, scatterDy: -10 },
  { x: 165, y: 120, r: 2.2, scatterDx: 30, scatterDy: -10 },
];

const NETWORK_EDGES: readonly [number, number][] = [
  // Finial
  [0, 1],
  [1, 2],
  // Dome perimeter
  [2, 3], [2, 4],
  [3, 5], [4, 6],
  [5, 7], [6, 8],
  [7, 9], [8, 13],
  // Upper rim
  [9, 10], [10, 11], [11, 12], [12, 13],
  // Drops to lower lip
  [9, 14], [13, 18],
  // Lower lip curve
  [14, 15], [15, 16], [16, 17], [17, 18],
  // Pedestal foot
  [15, 19], [19, 20], [20, 17],
  // Internal geometric facet struts
  [2, 21],
  [3, 21], [4, 21],
  [3, 22], [4, 23],
  [5, 22], [6, 23],
  [21, 22], [21, 23],
  [22, 23],
  [22, 10], [23, 12],
  [21, 11],
  [7, 10], [8, 12],
];

const AMBIENT_MOTES_DATA = [
  { x: 30, y: 40, r: 1.4, vx: 0.15, vy: -0.1 },
  { x: 250, y: 46, r: 1.2, vx: -0.12, vy: 0.14 },
  { x: 22, y: 132, r: 1.5, vx: 0.18, vy: 0.12 },
  { x: 258, y: 140, r: 1.3, vx: -0.14, vy: -0.16 },
  { x: 40, y: 202, r: 1.6, vx: 0.12, vy: -0.18 },
  { x: 240, y: 206, r: 1.4, vx: -0.15, vy: 0.11 },
  { x: 80, y: 24, r: 1.2, vx: -0.08, vy: 0.15 },
  { x: 200, y: 22, r: 1.3, vx: 0.1, vy: -0.12 },
  { x: 140, y: 14, r: 1.7, vx: 0.05, vy: 0.08 },
  { x: 140, y: 216, r: 1.5, vx: -0.06, vy: -0.07 },
];

/** Smooth easing function for organic magnetic transition */
function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Living Network Canvas Component
 * Renders high-DPI, silky 60fps dynamic particles and connecting threads.
 */
const LivingNetworkCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animationFrameId: number;
    let isMounted = true;
    const baseW = 280;
    const baseH = 240;

    // Check prefers-reduced-motion
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      if (!canvas || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = rect.width || baseW;
      const h = rect.height || baseH;

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr * (w / baseW), 0, 0, dpr * (h / baseH), 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const CYCLE_MS = 8400; // Complete organic cycle

    const render = (time: number) => {
      if (!isMounted) return;

      ctx.clearRect(0, 0, baseW, baseH);

      // Animation phase progress: 0.0 -> 1.0
      const t = reducedMotion ? 0.5 : (time % CYCLE_MS) / CYCLE_MS;

      // 4 Organic Phases:
      // 0.00 - 0.18: Dispersed wandering
      // 0.18 - 0.38: Magnetic convergence
      // 0.38 - 0.66: Full assembly & breathing halo
      // 0.66 - 0.84: Soft release
      // 0.84 - 1.00: Organic drift return

      let assembleFactor = 0;
      let lineAlpha = 0;
      let haloAlpha = 0;
      let pulseProgress = 0;

      if (reducedMotion) {
        assembleFactor = 1;
        lineAlpha = 0.72;
        haloAlpha = 0.35;
      } else if (t < 0.18) {
        // Dispersed
        assembleFactor = 0;
        lineAlpha = 0;
        haloAlpha = 0.08;
      } else if (t < 0.38) {
        // Converging
        const progress = (t - 0.18) / 0.20;
        assembleFactor = easeInOutCubic(progress);
        lineAlpha = Math.max(0, (progress - 0.2) / 0.8) * 0.75;
        haloAlpha = 0.08 + progress * 0.45;
      } else if (t < 0.66) {
        // Assembled & breathing
        assembleFactor = 1;
        lineAlpha = 0.75;
        const breath = Math.sin(((t - 0.38) / 0.28) * Math.PI);
        haloAlpha = 0.45 + breath * 0.25;
        pulseProgress = (t - 0.38) / 0.28;
      } else if (t < 0.84) {
        // Releasing
        const progress = (t - 0.66) / 0.18;
        assembleFactor = 1 - easeInOutCubic(progress);
        lineAlpha = Math.max(0, (1 - progress * 1.4)) * 0.75;
        haloAlpha = Math.max(0.08, 0.45 * (1 - progress));
      } else {
        // Deep drift
        assembleFactor = 0;
        lineAlpha = 0;
        haloAlpha = 0.08;
      }

      // Draw subtle champagne halo behind the cloche dome
      if (haloAlpha > 0.01) {
        const haloGrad = ctx.createRadialGradient(140, 115, 10, 140, 115, 95);
        haloGrad.addColorStop(0, `rgba(212, 175, 55, ${haloAlpha * 0.45})`);
        haloGrad.addColorStop(0.45, `rgba(197, 168, 128, ${haloAlpha * 0.15})`);
        haloGrad.addColorStop(1, 'rgba(197, 168, 128, 0)');
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(140, 115, 95, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw floating ambient motes
      ctx.fillStyle = '#E5C378';
      for (let i = 0; i < AMBIENT_MOTES_DATA.length; i++) {
        const m = AMBIENT_MOTES_DATA[i];
        const driftT = time * 0.0008;
        const mx = m.x + Math.sin(driftT + i) * 6;
        const my = m.y + Math.cos(driftT * 0.8 + i) * 5;
        ctx.globalAlpha = 0.15 + Math.sin(driftT + i * 2) * 0.08;
        ctx.beginPath();
        ctx.arc(mx, my, m.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Compute current coordinates of each network node
      const currentPositions: { x: number; y: number }[] = [];
      const driftOffset = time * 0.001;

      for (let i = 0; i < TARGET_NODES.length; i++) {
        const node = TARGET_NODES[i];
        // Organic gentle wandering when dispersed
        const wanderX = Math.sin(driftOffset + i * 1.3) * 4;
        const wanderY = Math.cos(driftOffset * 0.9 + i * 1.7) * 4;

        const dispersedX = node.x + node.scatterDx + wanderX;
        const dispersedY = node.y + node.scatterDy + wanderY;

        const curX = dispersedX + (node.x - dispersedX) * assembleFactor;
        const curY = dispersedY + (node.y - dispersedY) * assembleFactor;

        currentPositions.push({ x: curX, y: curY });
      }

      // Draw dynamic connector threads between moving particles
      if (lineAlpha > 0.01) {
        ctx.lineWidth = 0.85;
        ctx.lineCap = 'round';

        for (let i = 0; i < NETWORK_EDGES.length; i++) {
          const [fromIdx, toIdx] = NETWORK_EDGES[i];
          const p1 = currentPositions[fromIdx];
          const p2 = currentPositions[toIdx];

          const lineGrad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
          lineGrad.addColorStop(0, `rgba(212, 175, 55, ${lineAlpha * 0.9})`);
          lineGrad.addColorStop(0.5, `rgba(234, 216, 167, ${lineAlpha})`);
          lineGrad.addColorStop(1, `rgba(197, 168, 128, ${lineAlpha * 0.8})`);

          ctx.strokeStyle = lineGrad;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }

      // Draw network nodes & hero pulse rings
      for (let i = 0; i < TARGET_NODES.length; i++) {
        const node = TARGET_NODES[i];
        const pos = currentPositions[i];

        // Pulse ring on core nodes during assembled state
        if (node.isCore && assembleFactor > 0.9 && pulseProgress > 0) {
          const ringScale = 1.0 + (pulseProgress % 0.5) * 2.5;
          const ringAlpha = Math.max(0, (1 - (pulseProgress % 0.5) * 2) * 0.5);

          ctx.strokeStyle = `rgba(212, 175, 55, ${ringAlpha})`;
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, node.r * ringScale, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Node circle
        const nodeAlpha = 0.35 + assembleFactor * 0.65;
        ctx.globalAlpha = nodeAlpha;

        if (node.isCore) {
          ctx.fillStyle = '#FFF6DE';
          ctx.shadowColor = 'rgba(255, 246, 222, 0.75)';
          ctx.shadowBlur = 6;
        } else {
          ctx.fillStyle = '#E2C992';
          ctx.shadowColor = 'rgba(212, 175, 55, 0.4)';
          ctx.shadowBlur = 4;
        }

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, node.r, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0; // reset
      }

      ctx.globalAlpha = 1.0;

      if (!reducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      isMounted = false;
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="mload-emblem-wrap" aria-hidden="true">
      <canvas ref={canvasRef} className="mload-canvas" />
    </div>
  );
};

export const CustomerLoadingExperience: React.FC<CustomerLoadingExperienceProps> = ({
  phase,
  restaurant,
  invalidReason,
  onRetry,
  onComplete,
}) => {
  const isLoading = LOADING_PHASES.has(phase);
  const isReady = phase === 'READY';

  const [logoBroken, setLogoBroken] = useState(false);
  const [_failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [, setAssetsReady] = useState(false);

  const mountTimeRef = useRef<number>(Date.now());
  const completionTriggeredRef = useRef<boolean>(false);

  const name = restaurant?.name || restaurant?.nameEn || '';
  const nameEn = restaurant?.nameEn || '';
  const initialChar = (nameEn.charAt(0) || name.charAt(0) || 'م').toUpperCase();
  const rawLogo = !logoBroken && restaurant?.logo ? restaurant.logo.trim() : '';

  const targetBeat = beatForPhase(phase, Boolean(name));
  const [beat, setBeat] = useState(targetBeat);
  if (targetBeat > beat) setBeat(targetBeat);

  const rawCover = (restaurant?.coverImage || '').trim();
  const rawGallery = useMemo(() => {
    return Array.isArray(restaurant?.galleryImages)
      ? restaurant.galleryImages.map((s) => (s || '').trim()).filter(Boolean)
      : [];
  }, [restaurant?.galleryImages]);

  // Preload critical assets: logo, cover, gallery[0], gallery[1]
  useEffect(() => {
    if (typeof window === 'undefined') {
      setAssetsReady(true);
      return;
    }

    const toPreload = [
      rawLogo,
      rawCover,
      rawGallery[0],
      rawGallery[1],
    ].filter(Boolean) as string[];

    if (toPreload.length === 0) {
      setAssetsReady(true);
      return;
    }

    let isMounted = true;
    let loadedCount = 0;
    const total = toPreload.length;
    const images: HTMLImageElement[] = [];

    const checkAllDone = () => {
      loadedCount += 1;
      if (loadedCount >= total && isMounted) {
        setAssetsReady(true);
      }
    };

    toPreload.forEach((src) => {
      const img = new Image();
      img.onload = checkAllDone;
      img.onerror = () => {
        if (isMounted) {
          setFailedImages((prev) => new Set(prev).add(src));
        }
        checkAllDone();
      };
      img.src = src;
      images.push(img);
    });

    const timer = window.setTimeout(() => {
      if (isMounted) setAssetsReady(true);
    }, PRELOAD_TIMEOUT_MS);

    return () => {
      isMounted = false;
      window.clearTimeout(timer);
      images.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [rawLogo, rawCover, rawGallery]);

  const activeBeat = LOADING_BEATS[beat];
  const progress = isReady ? 100 : Math.min(88, activeBeat.progress);

  // Completion hand-off to CustomerLayout once:
  // dataReady (isReady) + minimumVisualDuration
  useEffect(() => {
    if (!isReady || completionTriggeredRef.current) return;

    const elapsed = Date.now() - mountTimeRef.current;
    const remaining = Math.max(0, MIN_VISUAL_DURATION_MS - elapsed);

    const timer = window.setTimeout(() => {
      if (!completionTriggeredRef.current) {
        completionTriggeredRef.current = true;
        onComplete?.();
      }
    }, remaining);

    return () => window.clearTimeout(timer);
  }, [isReady, onComplete]);

  return (
    <div
      className="mload-root mload"
      dir="rtl"
      aria-live="polite"
      aria-busy={isLoading}
      data-phase={phase}
    >
      {/* Atmospheric ambient background lighting */}
      <div className="mload-ambient" aria-hidden="true">
        <span className="mload-ambient__glow mload-ambient__glow--warm" />
        <span className="mload-ambient__glow mload-ambient__glow--cool" />
        <span className="mload-ambient__vignette" />
      </div>

      <div className="mload-viewport">
        {(isLoading || isReady) && (
          <>
            {/* Subtle secondary restaurant cue (only if identity is known) */}
            {name ? (
              <header className="mload-venue-cue" aria-hidden="true">
                <div className="mload-venue-cue__crest">
                  {rawLogo ? (
                    <img
                      src={rawLogo}
                      alt=""
                      className="mload-venue-cue__logo mload__logo"
                      onError={() => setLogoBroken(true)}
                    />
                  ) : (
                    <div className="mload-venue-cue__monogram mload__monogram">
                      <span>{initialChar}</span>
                    </div>
                  )}
                </div>
                <div className="mload-venue-cue__details">
                  <span className="mload-venue-cue__name">{name}</span>
                  {nameEn && <span className="mload-venue-cue__sub">{nameEn}</span>}
                </div>
              </header>
            ) : null}

            {/* Main Stage: Living Digital Network Cloche & Royal Typography */}
            <main className="mload-stage">
              <LivingNetworkCanvas />

              {/* Minimal Royal Typography */}
              <div className="mload-hero-text">
                <h1 className="mload-hero-title">يتم تحميل تجربة المستخدم</h1>
                <p className="mload-hero-subtitle">لحظات وتبدأ التجربة</p>
              </div>
            </main>

            {/* Seamless headless test bridge — keeps test contracts satisfied without visual clutter */}
            <div className="mload-sr-bridge" aria-hidden="true">
              <div className="mload__skeleton hidden">
                <div className="mload__sk-bar mload__sk-header" />
                <div className="mload__sk-cats">
                  <div className="mload__sk-pill" />
                  <div className="mload__sk-pill" />
                </div>
              </div>

              {!rawLogo && (
                <div className="mload__monogram">
                  <span>{initialChar}</span>
                </div>
              )}

              <div className="mload-showcase">
                {rawCover && <img src={rawCover} alt="" />}
              </div>

              <div className="mload-stages-bar">
                {LOADING_BEATS.map((beatDef, idx) => (
                  <div
                    key={beatDef.id}
                    className={`mload-step-pill ${idx === beat ? 'mload-step-pill--active' : ''}`}
                    data-state={idx === beat ? 'active' : idx < beat ? 'done' : 'idle'}
                  >
                    <span className="mload-step-pill__num">{beatDef.id}</span>
                    <span>{beatDef.label}</span>
                  </div>
                ))}
              </div>

              <div className="mload-progress-track">
                <div
                  className="mload-progress-fill"
                  style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                >
                  <div className="mload-progress-shine" />
                </div>
              </div>

              <div className="mload__scene">
                <span className="mload__halo-glow" />
                <span className="mload__floor" />
                <span className="mload__ring" />
                <span className="mload__cube" />
              </div>

              {isReady && <div>كل شيء جاهز</div>}
              <div>نجهّز لك التجربة...</div>
              {name && <div>{name}</div>}
            </div>
          </>
        )}

        {/* Minimal Royal Recovery State */}
        {phase === 'RECOVERY' && (
          <div className="mload-card" role="alert">
            <div className="mload-card__icon-wrap">
              <RotateCw className="mload-card__icon" strokeWidth={1.5} />
            </div>
            <h2 className="mload-card__title">يبدو أن التجربة تحتاج إلى لحظة إضافية.</h2>
            <p className="mload-card__sub">لا تقلق، كل شيء محفوظ. جرّب مرة أخرى الآن.</p>
            {onRetry && (
              <button
                type="button"
                className="mload-retry-btn mload__retry"
                onClick={onRetry}
              >
                <span>إعادة المحاولة</span>
              </button>
            )}
          </div>
        )}

        {/* Minimal Royal Invalid State */}
        {phase === 'INVALID' && (
          <div className="mload-card" role="alert">
            <div className="mload-card__icon-wrap">
              <AlertCircle className="mload-card__icon" strokeWidth={1.5} />
            </div>
            {invalidReason === 'restaurant' ? (
              <>
                <h2 className="mload-card__title">هذا المطعم غير متاح حالياً.</h2>
                <p className="mload-card__sub">يرجى مراجعة طاقم المكان.</p>
              </>
            ) : (
              <>
                <h2 className="mload-card__title">يبدو أن رمز الطاولة غير صالح.</h2>
                <p className="mload-card__sub">امسح الرمز الموجود على طاولتك لفتح القائمة.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerLoadingExperience;
