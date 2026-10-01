import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useCustomerTheme } from '../../theme/CustomerThemeProvider';
import type { GuestAppearanceOverride } from '../../theme/guestAppearance';

/**
 * GUEST NIGHT/LIGHT TOGGLE — the in-menu appearance button.
 * ===========================================================================
 *
 * Before this control existed, the customer menu's appearance depended
 * ONLY on the tenant's stored mode and, when that mode is 'auto', on the
 * GUEST DEVICE's colour scheme. A guest had no direct say. This button
 * gives them one without touching the tenant theme at all.
 *
 * It is deliberately THIN. All resolution and persistence live in
 * CustomerThemeProvider (the single writer); this component only reads the
 * current override and asks for the next one. Because the override feeds
 * the same single-writer pipeline, flipping it re-themes the ENTIRE scope at
 * once — cards, chips, toolbar, backgrounds, typography weights — exactly
 * the "move together" behaviour the semantic-token engine guarantees.
 *
 * Three states, cycled in order: auto → light → dark → auto.
 *   auto  = follow the tenant mode / device (the pre-existing behaviour).
 *   light = force the light face.
 *   dark  = force the night face.
 * Returning to 'auto' hands control back to the restaurant/device chain.
 */
const ORDER: GuestAppearanceOverride[] = ['auto', 'light', 'dark'];

const META: Record<
  GuestAppearanceOverride,
  { label: string; title: string; Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }> }
> = {
  auto: { label: 'المظهر: تلقائي', title: 'المظهر تلقائي (يتبع إعداد المطعم/الجهاز) — اضغط للتبديل إلى الفاتح', Icon: Monitor },
  light: { label: 'المظهر: فاتح', title: 'المظهر فاتح — اضغط للتبديل إلى الليلي', Icon: Sun },
  dark: { label: 'المظهر: ليلي', title: 'المظهر ليلي — اضغط للرجوع إلى التلقائي', Icon: Moon },
};

export const CustomerModeToggle: React.FC = () => {
  const themeCtx = useCustomerTheme();

  // Outside a customer theme scope there is nothing to toggle — platform
  // surfaces own their own appearance via PlatformAppearanceProvider.
  if (!themeCtx) return null;

  const { appearanceOverride, setAppearanceOverride } = themeCtx;
  const next = ORDER[(ORDER.indexOf(appearanceOverride) + 1) % ORDER.length];
  const { label, title, Icon } = META[appearanceOverride];

  return (
    <button
      type="button"
      className="menu-toggle"
      data-on={appearanceOverride !== 'auto'}
      aria-label={label}
      title={title}
      onClick={() => setAppearanceOverride(next)}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="hidden xs:inline sm:inline">
        {appearanceOverride === 'auto' ? 'تلقائي' : appearanceOverride === 'light' ? 'فاتح' : 'ليلي'}
      </span>
    </button>
  );
};
