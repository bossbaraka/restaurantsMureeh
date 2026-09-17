import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ChefHat, Flame, Sparkles, UtensilsCrossed, Image as ImageIcon } from 'lucide-react';
import type { EntryInvalidReason, EntryPhase } from '../../services/customerEntry';
import './customerLoadingExperience.css';

// ============================================================================
// CustomerLoadingExperience — Premium guest loading & atmosphere experience.
//
// 1. RTL-first, restaurant-centric, and cinematic.
// 2. Four beats that mirror the REAL entry milestones — the animation tells
//    the guest what the system is doing, it never fakes progress:
//    01 — الاتصال: connecting to the restaurant (INITIALIZING/VALIDATING_QR/RETRYING)
//    02 — الهوية: the venue's identity is known (identity payload / LOADING_RESTAURANT)
//    03 — المنيو: preparing the menu (LOADING_CATALOG)
//    04 — جاهز: everything is ready (READY), held for the hand-off window.
// 3. Preloads critical assets (logo, cover, gallery[0], gallery[1]) with a 3s timeout.
// 4. Progress is derived from those beats: monotonic, and 100% only when READY.
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
const PRELOAD_TIMEOUT_MS = 3000;

/**
 * The four beats of the hand-off. Each beat is a REAL milestone of the entry
 * state machine — never a decorative timer — so the animation says exactly
 * what is happening: connecting → the venue's identity → the menu → ready.
 * The progress rail is derived from the same beats, so it can never run ahead
 * of the work and never reaches 100% before the data is genuinely READY.
 */
interface LoadingBeat {
  id: string;
  label: string;
  title: string;
  secondary: string;
  /** Progress percentage this beat honestly represents. */
  progress: number;
}

const LOADING_BEATS: readonly LoadingBeat[] = [
  { id: '01', label: 'الاتصال', title: 'نتواصل مع المطعم', secondary: 'نفتح اتصالاً آمناً بطاولتك', progress: 28 },
  { id: '02', label: 'الهوية', title: 'نتعرف على المكان', secondary: 'نرتّب لك الشعار والأجواء', progress: 52 },
  { id: '03', label: 'المنيو', title: 'نحضّر لك المنيو', secondary: 'نرتّب الأصناف والتفاصيل', progress: 78 },
  { id: '04', label: 'جاهز', title: 'كل شيء جاهز', secondary: 'القائمة بين يديك الآن', progress: 100 },
];

/**
 * Which beat a phase belongs to. `hasIdentity` lets the QR path surface the
 * venue beat as soon as the session returns the tenant identity (that path
 * never passes through LOADING_RESTAURANT).
 */
function beatForPhase(phase: EntryPhase, hasIdentity: boolean): number {
  if (phase === 'READY') return 3;
  if (phase === 'LOADING_CATALOG') return 2;
  if (phase === 'LOADING_RESTAURANT') return 1;
  return hasIdentity ? 1 : 0;
}

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
  const [assetsReady, setAssetsReady] = useState(false);

  const mountTimeRef = useRef<number>(Date.now());
  const completionTriggeredRef = useRef<boolean>(false);

  const name = restaurant?.name || restaurant?.nameEn || '';
  const nameEn = restaurant?.nameEn || '';
  const initialChar = (nameEn.charAt(0) || name.charAt(0) || 'م').toUpperCase();
  const rawLogo = !logoBroken && restaurant?.logo ? restaurant.logo.trim() : '';

  // Latched forward-only beat, derived from the real phase: a transient
  // RETRYING must never drag the animation (or the progress rail) backwards,
  // and the very first paint already shows the correct beat.
  const targetBeat = beatForPhase(phase, Boolean(name));
  const [beat, setBeat] = useState(targetBeat);
  if (targetBeat > beat) setBeat(targetBeat);

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

  // One image per beat, best-first: the venue's own photography is the hero,
  // and the final beat reuses the strongest shot so the hand-off is seamless.
  const beatImages = useMemo(() => {
    const s1 = validCover || validGallery[0] || '';
    const s2 = validGallery[0] || validCover || '';
    const s3 = validGallery[1] || validGallery[0] || validCover || '';
    return [s1, s2, s3, s1];
  }, [validCover, validGallery]);

  const activeBeat = LOADING_BEATS[beat];
  // Smooth, monotonic progress: it moves to the beat's honest value and only
  // reaches 100% when the phase is genuinely READY.
  const progress = isReady ? 100 : Math.min(88, activeBeat.progress);

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
        {/* The final beat (READY) stays on screen during the hand-off window
            — assets + minimum visual duration — so the journey ends on
            "جاهز" instead of cutting to a blank canvas. */}
        {(isLoading || isReady) && (
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

            {/* Connection signal — a calm cue that we are reaching the
                restaurant; it settles when everything is ready. */}
            <div
              className="mload-signal"
              data-state={isReady ? 'ready' : 'connecting'}
              aria-hidden="true"
            >
              <span className="mload-signal__dot" />
              <span className="mload-signal__dot" />
              <span className="mload-signal__dot" />
            </div>

            {/* Atmosphere Photography Showcase or Fallback 3D Scene */}
            {hasAnyImages ? (
              <div className="mload-showcase">
                <div className="mload-slides">
                  {LOADING_BEATS.map((beatDef, idx) => (
                    <div
                      key={beatDef.id}
                      className={`mload-slide ${idx === beat ? 'mload-slide--active' : ''}`}
                    >
                      {beatImages[idx] ? (
                        <img
                          src={beatImages[idx]}
                          alt={beatDef.label}
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

                {/* Bottom Overlay with Beat Typography — remounts per beat so
                    the copy fades in softly instead of snapping. */}
                <div className="mload-overlay-info" key={activeBeat.id}>
                  <div className="mload-stage-badge">
                    <span className="font-mono">{activeBeat.id}</span>
                    <span>·</span>
                    <span>{activeBeat.label}</span>
                  </div>
                  <h2 className="mload-overlay-title">{activeBeat.title}</h2>
                  <p className="mload-overlay-sub">{activeBeat.secondary}</p>
                </div>
              </div>
            ) : (
              <div className="mload-showcase flex items-center justify-center p-6">
                <FallbackLoadingScene />
                <div className="mload-overlay-info" key={activeBeat.id}>
                  <div className="mload-stage-badge">
                    <span className="font-mono">{activeBeat.id}</span>
                    <span>·</span>
                    <span>{activeBeat.label}</span>
                  </div>
                  <h2 className="mload-overlay-title">{activeBeat.title}</h2>
                  <p className="mload-overlay-sub">نجهّز لك التجربة...</p>
                </div>
              </div>
            )}

            {/* Hand-off rail — the guest's place in the four real beats */}
            <div className="mload-stages-bar">
              {LOADING_BEATS.map((beatDef, idx) => (
                <div
                  key={beatDef.id}
                  className={`mload-step-pill ${idx === beat ? 'mload-step-pill--active' : ''} ${
                    idx < beat ? 'mload-step-pill--done' : ''
                  }`}
                  data-state={idx < beat ? 'done' : idx === beat ? 'active' : 'idle'}
                >
                  <span className="mload-step-pill__num">{beatDef.id}</span>
                  <span>{beatDef.label}</span>
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

            {/* Decorative thumbnails of the venue's own photography — they
                follow the beats, they are not controls. */}
            {validGallery.length > 1 && (
              <div className="mload-previews" aria-hidden="true">
                {beatImages.slice(0, 3).map((src, idx) => (
                  <div
                    key={idx}
                    className={`mload-preview-thumb ${
                      idx === Math.min(beat, 2) ? 'mload-preview-thumb--active' : ''
                    }`}
                  >
                    {src && <img src={src} alt="" />}
                  </div>
                ))}
              </div>
            )}

            {/* Hidden accessibility/fallback elements + the polite status line */}
            <MenuSkeleton />
            <div className="sr-only">نجهّز لك التجربة...</div>
            <div className="sr-only">
              {activeBeat.title} — {activeBeat.secondary}
            </div>
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
