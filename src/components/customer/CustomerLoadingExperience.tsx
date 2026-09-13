import React, { useState } from 'react';
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
// Visual language: Mureeh deep-navy palette, CSS-only motion,
// `prefers-reduced-motion` respected in src/index.css (.mload-*).
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

  return (
    <div className="mload" dir="rtl" aria-live="polite" aria-busy={isLoading}>
      <div className="mload__glow mload__glow--a" aria-hidden="true" />
      <div className="mload__glow mload__glow--b" aria-hidden="true" />

      <div className="mload__inner">
        {isLoading && (
          <>
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
            {name && <div className="mload__name">{name}</div>}
            <div className="mload__status">نجهّز لك التجربة...</div>
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
