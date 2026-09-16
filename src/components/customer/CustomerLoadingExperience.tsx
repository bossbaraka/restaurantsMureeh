import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ChefHat, Flame, Sparkles, UtensilsCrossed, Image as ImageIcon } from 'lucide-react';
import type { EntryInvalidReason, EntryPhase } from '../../services/customerEntry';
import './customerLoadingExperience.css';

// ============================================================================
// CustomerLoadingExperience — Premium guest loading & atmosphere experience.
//
// 1. RTL-first, restaurant-centric, and cinematic.
// 2. Three progressive visual stages:
//    01 — Restaurant: coverImage ("لحظات ونكون جاهزين" / "نجهّز تجربة المطعم لك")
//    02 — Atmosphere: galleryImages[0] ("نرتّب القائمة" / "نحمّل الأصناف والتفاصيل")
//    03 — Experience: galleryImages[1] / fallback ("خذ وقتك" / "كل شيء جاهز لتجربتك")
// 3. Preloads critical assets (logo, cover, gallery[0], gallery[1]) with a 3s timeout.
// 4. Smooth capped progress (starts >0, caps <100 until phase === 'READY').
// 5. Never shows broken-image UI; falls back gracefully to CSS 3D scene when no images exist.
// 6. Presentation only — owns no data fetching.
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
  /** Tenant identity when known (name, logo, cover, gallery). */
  restaurant?: IdentityLike | null;
  invalidReason?: EntryInvalidReason | null;
  /** Recovery action for RECOVERY state. */
  onRetry?: () => void;
  /** Called when visual loading (min duration + assets + READY) finishes. */
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
const STAGE_INTERVAL_MS = 1800;
const PRELOAD_TIMEOUT_MS = 3000;

/** Menu-shaped skeleton for loading states */
const MenuSkeleton: React.FC = () => (
  <div className="mload__skeleton hidden" aria-hidden="true">
    <div className="mload__sk-bar mload__sk-header" />
    <div className="mload__sk-cats">
      <div className="mload__sk-pill" />
      <div className="mload__sk-pill" />
    </div>
  </div>
);

/** Soft monogram used when the tenant logo is missing or fails to load */
const Monogram: React.FC<{ initial?: string }> = ({ initial = 'م' }) => (
  <div className="mload__monogram mload-brand__monogram" aria-hidden="true">
    <span>{initial}</span>
  </div>
);

// ----------------------------------------------------------------------------
// Fallback CSS 3D scene when the venue has no uploaded photography
// ----------------------------------------------------------------------------

const CUBE_FACES = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const;

interface Cube3DProps {
  size: string;
  tone?: 'gold' | 'glass' | 'deep';
  spin?: number;
  glyphs?: React.ReactNode[];
  className?: string;
}

const Cube3D: React.FC<Cube3DProps> = ({
  size,
  tone = 'glass',
  spin = 11,
  glyphs,
  className = '',
}) => (
  <span
    className={`mload__cube mload__cube--${tone} ${className}`.trim()}
    style={{ '--cube': size, '--spin': `${spin}s` } as React.CSSProperties}
  >
    {CUBE_FACES.map((face, i) => (
      <span key={face} className={`mload__cube-face mload__cube-face--${face}`}>
        {glyphs?.[i] ?? null}
      </span>
    ))}
  </span>
);

const FallbackLoadingScene: React.FC = () => (
  <div className="mload__scene" aria-hidden="true" style={{ minHeight: '260px' }}>
    <span className="mload__halo-glow" />
    <span className="mload__floor">
      <span className="mload__floor-grid" />
    </span>
    <span className="mload__shadow" />

    <span className="mload__ring mload__ring--wide">
      <span className="mload__ring-line" />
    </span>
    <span className="mload__ring mload__ring--tilt">
      <span className="mload__ring-line" />
      <span className="mload__ring-dot" />
    </span>
    <span className="mload__ring mload__ring--halo">
      <span className="mload__ring-line" />
      <span className="mload__ring-dot mload__ring-dot--gold" />
    </span>

    <span className="mload__sat mload__sat--a">
      <Cube3D
        size="26px"
        tone="gold"
        spin={13}
        glyphs={[
          <Sparkles size={13} strokeWidth={2.2} key="sparkles" />,
          <ChefHat size={13} strokeWidth={2.1} key="chef" />,
          <UtensilsCrossed size={13} strokeWidth={2.2} key="utensils" />,
          <Flame size={13} strokeWidth={2.2} key="flame" />,
        ]}
      />
    </span>
    <span className="mload__sat mload__sat--b">
      <Cube3D size="16px" tone="glass" spin={9} />
    </span>
  </div>
);

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
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(24);
  const [assetsReady, setAssetsReady] = useState(false);

  const mountTimeRef = useRef<number>(Date.now());
  const completionTriggeredRef = useRef<boolean>(false);

  const name = restaurant?.name || restaurant?.nameEn || '';
  const nameEn = restaurant?.nameEn || '';
  const initialChar = (nameEn.charAt(0) || name.charAt(0) || 'م').toUpperCase();
  const rawLogo = !logoBroken && restaurant?.logo ? restaurant.logo.trim() : '';

  // Extract restaurant photography
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

  // Determine valid, unfailed imagery
  const validCover = rawCover && !failedImages.has(rawCover) ? rawCover : '';
  const validGallery = useMemo(() => {
    return rawGallery.filter((url) => !failedImages.has(url));
  }, [rawGallery, failedImages]);

  const hasAnyImages = Boolean(validCover || validGallery.length > 0);

  // Define the 3 distinct visual stages
  const stages = useMemo(() => {
    // Stage 1: Restaurant (coverImage)
    const s1Img = validCover || validGallery[0] || '';
    // Stage 2: Atmosphere (galleryImages[0])
    const s2Img = validGallery[0] || validCover || '';
    // Stage 3: Experience (galleryImages[1] or fallback)
    const s3Img = validGallery[1] || validGallery[0] || validCover || '';

    return [
      {
        id: '01' as const,
        label: 'المطعم',
        title: 'لحظات ونكون جاهزين',
        secondary: 'نجهّز تجربة المطعم لك',
        image: s1Img,
      },
      {
        id: '02' as const,
        label: 'الأجواء',
        title: 'نرتّب القائمة',
        secondary: 'نحمّل الأصناف والتفاصيل',
        image: s2Img,
      },
      {
        id: '03' as const,
        label: 'التجربة',
        title: 'خذ وقتك',
        secondary: 'كل شيء جاهز لتجربتك',
        image: s3Img,
      },
    ];
  }, [validCover, validGallery]);

  // Cycle through the 3 stages during active loading
  useEffect(() => {
    if (!isLoading) return;
    const interval = window.setInterval(() => {
      setStageIndex((prev) => (prev + 1) % 3);
    }, STAGE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [isLoading]);

  // Progress animation:
  // - Starts at 24%
  // - Moves smoothly towards ~88% while loading
  // - Reaches 100% ONLY when phase is genuinely READY
  useEffect(() => {
    if (isReady) {
      setProgress(100);
      return;
    }

    if (!isLoading) return;

    const interval = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 88) return 88;
        return prev + Math.floor(Math.random() * 8 + 4);
      });
    }, 450);

    return () => window.clearInterval(interval);
  }, [isReady, isLoading]);

  // Completion hand-off to CustomerLayout once:
  // dataReady (isReady) + (assetsReady || timeout) + minimumVisualDuration
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

  const activeStage = stages[stageIndex];

  return (
    <div
      className="mload-root mload"
      dir="rtl"
      aria-live="polite"
      aria-busy={isLoading}
      data-phase={phase}
    >
      {/* Ambient background glows */}
      <div className="mload-backdrop" aria-hidden="true">
        <span className="mload-backdrop__glow mload-backdrop__glow--top" />
        <span className="mload-backdrop__glow mload-backdrop__glow--bottom" />
        <span className="mload-backdrop__vignette" />
      </div>

      <div className="mload-container">
        {isLoading && (
          <>
            {/* Restaurant Brand Header */}
            <div className="mload-brand">
              <div className="mload-brand__crest">
                {rawLogo ? (
                  <img
                    src={rawLogo}
                    alt={name || 'شعار المطعم'}
                    className="mload-brand__logo mload__logo"
                    onError={() => setLogoBroken(true)}
                  />
                ) : (
                  <Monogram initial={initialChar} />
                )}
              </div>
              <div className="mload-brand__text">
                {name && <div className="mload-brand__name">{name}</div>}
                {nameEn && <div className="mload-brand__name-en">{nameEn}</div>}
              </div>
            </div>

            {/* Atmosphere Photography Showcase or Fallback 3D Scene */}
            {hasAnyImages ? (
              <div className="mload-showcase">
                <div className="mload-slides">
                  {stages.map((st, idx) => (
                    <div
                      key={st.id}
                      className={`mload-slide ${idx === stageIndex ? 'mload-slide--active' : ''}`}
                    >
                      {st.image ? (
                        <img
                          src={st.image}
                          alt={st.label}
                          className="mload-slide__img"
                          loading="eager"
                        />
                      ) : (
                        <div className="w-full h-full bg-luxury-900/80 flex items-center justify-center text-luxury-600">
                          <ImageIcon className="w-12 h-12 stroke-1 opacity-40" />
                        </div>
                      )}
                      <div className="mload-slide__scrim" />
                    </div>
                  ))}
                </div>

                {/* Bottom Overlay with Stage Typography */}
                <div className="mload-overlay-info">
                  <div className="mload-stage-badge">
                    <span className="font-mono">{activeStage.id}</span>
                    <span>·</span>
                    <span>{activeStage.label}</span>
                  </div>
                  <h2 className="mload-overlay-title">{activeStage.title}</h2>
                  <p className="mload-overlay-sub">{activeStage.secondary}</p>
                </div>
              </div>
            ) : (
              <div className="mload-showcase flex items-center justify-center p-6">
                <FallbackLoadingScene />
                <div className="mload-overlay-info">
                  <h2 className="mload-overlay-title">{activeStage.title}</h2>
                  <p className="mload-overlay-sub">نجهّز لك التجربة...</p>
                </div>
              </div>
            )}

            {/* 3-Stage Pills Bar */}
            <div className="mload-stages-bar">
              {stages.map((st, idx) => (
                <div
                  key={st.id}
                  className={`mload-step-pill ${idx === stageIndex ? 'mload-step-pill--active' : ''}`}
                >
                  <span className="mload-step-pill__num">{st.id}</span>
                  <span>{st.label}</span>
                </div>
              ))}
            </div>

            {/* Smooth Progress Rail */}
            <div className="mload-progress-track" aria-hidden="true">
              <div
                className="mload-progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              >
                <div className="mload-progress-shine" />
              </div>
            </div>

            {/* Thumbnail previews for secondary images (if multi-image) */}
            {validGallery.length > 1 && (
              <div className="mload-previews" aria-hidden="true">
                {stages.map((st, idx) => (
                  <div
                    key={st.id}
                    onClick={() => setStageIndex(idx)}
                    className={`mload-preview-thumb ${idx === stageIndex ? 'mload-preview-thumb--active' : ''}`}
                  >
                    {st.image && <img src={st.image} alt="" />}
                  </div>
                ))}
              </div>
            )}

            {/* Hidden accessibility/fallback elements */}
            <MenuSkeleton />
            <div className="sr-only">نجهّز لك التجربة...</div>
          </>
        )}

        {/* Bounded Recovery State */}
        {phase === 'RECOVERY' && (
          <div className="mload-card">
            <div className="mload-card__icon" aria-hidden="true">☕</div>
            <h2 className="mload-card__title">يبدو أن التجربة تحتاج إلى لحظة إضافية.</h2>
            <p className="mload-card__sub">لا تقلق، كل شيء محفوظ. جرّب مرة أخرى الآن.</p>
            {onRetry && (
              <button
                type="button"
                className="mload-retry-btn mload__retry"
                onClick={onRetry}
              >
                إعادة المحاولة
              </button>
            )}
          </div>
        )}

        {/* Permanent Invalid State */}
        {phase === 'INVALID' && (
          <div className="mload-card">
            <div className="mload-card__icon" aria-hidden="true">🪑</div>
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
