import React, { useState } from 'react';
import { ChefHat, Coffee, Flame, Sparkles, UtensilsCrossed, Clock3 } from 'lucide-react';
import type { EntryInvalidReason, EntryPhase } from '../../services/customerEntry';

// ============================================================
// CustomerLoadingExperience — the premium guest-facing layer for
// every non-READY entry state. Presentation ONLY:
//
//   - owns no fetching, no sessions, no QR logic, no storage;
//   - renders whatever the entry state machine tells it to render;
//   - recovery is a single `onRetry` callback upward.
//
// States:
//   INITIALIZING / VALIDATING_QR / LOADING_* / RETRYING → loader + skeleton
//   RECOVERY → calm customer-safe retry card
//   INVALID  → minimal friendly invalid state (QR or venue)
//
// Visual language: a cinematic deep-navy stage where the venue's own logo
// floats as the core of a 3D orbit system. Every shape (rings, cubes,
// dust, the receding floor grid) is real CSS 3D — no canvas, no WebGL, no
// images, no animation loop in JS, and no extra dependency. Motion is
// `prefers-reduced-motion` aware: the stage stays composed but still, and
// every animation is owned by the scoped `.mload-*` block in src/index.css.
// ============================================================

interface IdentityLike {
  name?: string;
  nameEn?: string;
  logo?: string;
}

export interface CustomerLoadingExperienceProps {
  phase: EntryPhase;
  /** Tenant identity when known (logo/name reveal while loading). */
  restaurant?: IdentityLike | null;
  invalidReason?: EntryInvalidReason | null;
  /** Recovery action — required for RECOVERY to be actionable. */
  onRetry?: () => void;
}

const LOADING_PHASES: ReadonlySet<EntryPhase> = new Set([
  'INITIALIZING',
  'VALIDATING_QR',
  'LOADING_RESTAURANT',
  'LOADING_CATALOG',
  'RETRYING',
]);

/** Menu-shaped skeleton: header bar, category pills, product cards. */
const MenuSkeleton: React.FC = () => (
  <div className="mload__skeleton" aria-hidden="true">
    <div className="mload__sk-bar mload__sk-header" />
    <div className="mload__sk-cats">
      <div className="mload__sk-pill" />
      <div className="mload__sk-pill" />
      <div className="mload__sk-pill" />
    </div>
    {[0, 1].map((i) => (
      <div className="mload__sk-card" key={i}>
        <div className="mload__sk-bar mload__sk-line-lg" />
        <div className="mload__sk-bar mload__sk-line-md" />
        <div className="mload__sk-bar mload__sk-line-sm" />
      </div>
    ))}
  </div>
);

/** Soft monogram used when the tenant logo is missing or fails to load. */
const Monogram: React.FC = () => (
  <div className="mload__monogram" aria-hidden="true">
    <span>م</span>
  </div>
);

// ------------------------------------------------------------------
// 3D primitives — six real CSS faces per cube, rotated in a shared
// perspective. Purely decorative: every cube lives inside an
// `aria-hidden` scene.
// ------------------------------------------------------------------

const CUBE_FACES = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const;

interface Cube3DProps {
  /** Edge length as a CSS length, e.g. "26px". */
  size: string;
  tone?: 'gold' | 'glass' | 'deep';
  /** Seconds per full turn — each cube gets its own rhythm. */
  spin?: number;
  /** Optional glyphs for the four upright faces, so the spin reads. */
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

/**
 * The loading stage: a receding light-grid floor, two gyroscope orbit
 * rings, a handful of tumbling cubes and rising dust — arranged around
 * the (centred, outside this scene) tenant plate.
 */
const LoadingScene: React.FC = () => (
  <div className="mload__scene" aria-hidden="true">
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

    <span className="mload__drift mload__drift--1">
      <Cube3D size="13px" tone="glass" spin={15} />
    </span>
    <span className="mload__drift mload__drift--2">
      <Cube3D size="10px" tone="deep" spin={18} />
    </span>
    <span className="mload__drift mload__drift--3">
      <Cube3D size="8px" tone="gold" spin={12} />
    </span>

    <span className="mload__spark mload__spark--1" />
    <span className="mload__spark mload__spark--2" />
    <span className="mload__spark mload__spark--3" />
    <span className="mload__spark mload__spark--4" />
  </div>
);

type LoadingStage = 'RESTAURANT' | 'COFFEE' | 'TIME';

const LoadingOrbit: React.FC<{ stage: LoadingStage; logo: string; name: string; onLogoError: () => void }> = ({
  stage,
  logo,
  name,
  onLogoError,
}) => (
  <div className="mload__orbit" aria-hidden="true">
    <div className={`mload__orbit-item mload__orbit-item--restaurant ${stage === 'RESTAURANT' ? 'is-active' : ''}`}>
      {logo ? <img src={logo} alt="" onError={onLogoError} /> : <UtensilsCrossed size={30} />}
      <span>{name || 'Restaurant'}</span>
    </div>
    <div className={`mload__orbit-item mload__orbit-item--coffee ${stage === 'COFFEE' ? 'is-active' : ''}`}>
      <Coffee size={30} />
      <span>Brewing</span>
    </div>
    <div className={`mload__orbit-item mload__orbit-item--time ${stage === 'TIME' ? 'is-active' : ''}`}>
      <Clock3 size={30} />
      <span>Ready</span>
    </div>
    <span className="mload__orbit-core" />
  </div>
);

/** Three short, warm lines that cross-fade under the status — CSS only. */
const PacingLines: React.FC = () => (
  <div className="mload__poems" aria-hidden="true">
    <span className="mload__poem mload__poem--1">لحظات وتبدأ التجربة</span>
    <span className="mload__poem mload__poem--2">نُحضّر لك القائمة بعناية</span>
    <span className="mload__poem mload__poem--3">الجمال يستحق ثوانٍ من الانتظار</span>
  </div>
);

export const CustomerLoadingExperience: React.FC<CustomerLoadingExperienceProps> = ({
  phase,
  restaurant,
  invalidReason,
  onRetry,
}) => {
  const [logoBroken, setLogoBroken] = useState(false);
  const isLoading = LOADING_PHASES.has(phase);
  const logo = !logoBroken && restaurant?.logo ? restaurant.logo : '';
  const name = restaurant?.name || restaurant?.nameEn || '';
  const loadingStage: LoadingStage =
    phase === 'LOADING_CATALOG' || phase === 'RETRYING'
      ? 'TIME'
      : phase === 'LOADING_RESTAURANT'
        ? 'COFFEE'
        : 'RESTAURANT';
  const stageCopy = {
    RESTAURANT: ['Preparing your experience', 'بنحضّرلك تجربتك'],
    COFFEE: ['Brewing the experience', 'بنحضّرلك كل التفاصيل'],
    TIME: ['Just a moment', 'لحظات ونكون جاهزين'],
  }[loadingStage];

  return (
    <div className="mload" dir="rtl" aria-live="polite" aria-busy={isLoading}>
      <div className="mload__backdrop" aria-hidden="true">
        <span className="mload__glow mload__glow--a" />
        <span className="mload__glow mload__glow--b" />
        <span className="mload__beam" />
        <span className="mload__floor-haze" />
        <span className="mload__vignette" />
      </div>

      <div className="mload__inner">
        {isLoading && (
          <>
            <div className="mload__stage" data-loading-stage={loadingStage}>
              <LoadingScene />
              <LoadingOrbit stage={loadingStage} logo={logo} name={name} onLogoError={() => setLogoBroken(true)} />
              <div className="mload__core">
                {logo ? (
                  <img
                    src={logo}
                    alt={name ? `${name}` : 'شعار المطعم'}
                    className="mload__logo"
                    onError={() => setLogoBroken(true)}
                  />
                ) : (
                  <Monogram />
                )}
              </div>
            </div>

            <div className="mload__headline">
              {name && <div className="mload__name">{name}</div>}
              <div className="mload__status">
                <span>{stageCopy[0]}</span>
                <span className="mload__status-ar">{stageCopy[1]}</span>
              </div>
            </div>

            <div className="mload__rail" aria-hidden="true">
              <span className="mload__rail-fill" />
              <span className="mload__rail-shine" />
            </div>

            <PacingLines />
            <MenuSkeleton />
          </>
        )}

        {phase === 'RECOVERY' && (
          <div className="mload__card">
            <div className="mload__card-icon" aria-hidden="true">☕</div>
            <h2 className="mload__card-title">يبدو أن التجربة تحتاج إلى لحظة إضافية.</h2>
            <p className="mload__card-sub">لا تقلق، كل شيء محفوظ. جرّب مرة أخرى الآن.</p>
            {onRetry && (
              <button type="button" className="mload__retry" onClick={onRetry}>
                إعادة المحاولة
              </button>
            )}
          </div>
        )}

        {phase === 'INVALID' && (
          <div className="mload__card">
            <div className="mload__card-icon" aria-hidden="true">🪑</div>
            {invalidReason === 'restaurant' ? (
              <>
                <h2 className="mload__card-title">هذا المطعم غير متاح حالياً.</h2>
                <p className="mload__card-sub">يرجى مراجعة طاقم المكان.</p>
              </>
            ) : (
              <>
                <h2 className="mload__card-title">يبدو أن رمز الطاولة غير صالح.</h2>
                <p className="mload__card-sub">امسح الرمز الموجود على طاولتك لفتح القائمة.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerLoadingExperience;
