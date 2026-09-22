/**
 * THEME PREVIEW — the customer menu, rendered through the production pipeline.
 * ===========================================================================
 *
 * WHY THIS REPLACES THE OLD PREVIEW
 * ---------------------------------
 * The previous preview read `editConfig` directly and re-implemented the
 * theme in inline styles: `linear-gradient(135deg, ${primary}, ${accent})`,
 * `${primary}22` for tints, hardcoded `bg-luxury-900` panels. It was a SECOND
 * THEME ENGINE. It could therefore disagree with the real menu — and it did:
 * it ignored mode-aware colour remapping and the semantic surface ladder
 * entirely, so a light theme previewed as dark panels.
 *
 * This component renders through the SAME path as production:
 *
 *     ThemeDraft -> toThemeConfig -> normalizeTheme -> buildSemanticTokens
 *                -> CustomerThemeProvider -> preview markup
 *
 * The markup below styles itself EXCLUSIVELY from `--m-*` tokens, exactly as
 * the customer components do after the Phase 4 migration. There is no colour
 * arithmetic here, which is what guarantees the preview cannot drift.
 *
 * ISOLATION
 * ---------
 * CustomerThemeProvider writes tokens onto its own scope element and never
 * touches <html>, so previewing a light restaurant theme inside the dark
 * manager dashboard changes nothing outside this box.
 */

import React from 'react';
import { UtensilsCrossed, Plus, Search, ShoppingBag } from 'lucide-react';
import { CustomerThemeProvider } from '../../theme/CustomerThemeProvider';
import { toThemeConfig, type ThemeDraft } from '../../theme/editorModel';
import type { SurfaceMode } from '../../theme/brandTheme';

interface ThemePreviewProps {
  draft: ThemeDraft;
  /** Preview a specific appearance; omit to follow the draft's own mode. */
  forceMode?: SurfaceMode;
  restaurantName?: string;
  currency?: string;
}

/**
 * THE production token scope, reusable by any preview fragment (the advanced
 * per-component samples below, or the full menu preview). It projects the
 * draft through `toThemeConfig` and hands it to `CustomerThemeProvider` — the
 * exact tail of the customer pipeline — so a fragment styled from `--m-*`
 * tokens cannot disagree with the real menu.
 */
export const ThemeTokensScope: React.FC<{
  draft: ThemeDraft;
  forceMode?: SurfaceMode;
  children?: React.ReactNode;
}> = ({ draft, forceMode, children }) => {
  const themeConfig = toThemeConfig(draft);
  const previewRestaurant = {
    theme: themeConfig,
    primaryColor: draft.primary,
    accentColor: draft.accent,
  } as never;
  return (
    <CustomerThemeProvider restaurant={previewRestaurant} forceMode={forceMode}>
      {children}
    </CustomerThemeProvider>
  );
};

/*
 * MINI SAMPLES — one tiny live preview per «تخصيص متقدم» group.
 *
 * Each sample styles itself EXCLUSIVELY from the canonical `--m-*` tokens
 * (same names the customer markup consumes), wrapped by the caller in
 * `ThemeTokensScope`. No colour arithmetic, no hex, no second engine.
 */

/** الأزرار — primary + secondary action buttons (colors.button.*). */
export const ButtonTokensSample: React.FC = () => (
  <div className="flex flex-wrap items-center gap-2" dir="rtl">
    <span
      className="px-3 py-1.5 text-[11px] font-bold"
      style={{
        // The shorthand (not background-image): --m-button-bg may be a gradient
        // OR a plain hex override — the shorthand paints both.
        background: 'var(--m-button-bg)',
        color: 'var(--m-button-text)',
        borderRadius: 'var(--m-radius-md)',
      }}
    >
      أضف للسلة
    </span>
    <span
      className="px-3 py-1.5 text-[11px] font-bold"
      style={{
        background: 'var(--m-button-secondary-bg)',
        color: 'var(--m-button-secondary-text)',
        borderRadius: 'var(--m-radius-md)',
        border: '1px solid var(--m-hairline)',
      }}
    >
      تفاصيل
    </span>
  </div>
);

/** البطاقات — the dish card material: background/border/radius/shadow (colors.card.*). */
export const CardTokensSample: React.FC = () => (
  <div
    className="p-3 max-w-[300px]"
    dir="rtl"
    style={{
      background: 'var(--m-card-bg)',
      border: '1px solid var(--m-card-border)',
      borderRadius: 'var(--m-card-radius)',
      boxShadow: 'var(--m-card-shadow)',
      fontFamily: 'var(--m-font)',
    }}
  >
    <div className="text-xs font-bold" style={{ color: 'var(--m-text)' }}>
      طبق اليوم
    </div>
    <div className="text-[10px] mt-0.5" style={{ color: 'var(--m-text-muted)' }}>
      يعكس هذه العينة الخلفية والحدود والزاوية والظل
    </div>
  </div>
);

/** الشارات — the product badge chip (colors.badge.*). */
export const BadgeTokensSample: React.FC = () => (
  <div dir="rtl">
    <span
      className="px-2.5 py-0.5 text-[10px] font-bold"
      style={{
        background: 'var(--m-badge-bg)',
        color: 'var(--m-badge-text)',
        borderRadius: 'var(--m-badge-radius)',
      }}
    >
      جديد
    </span>
  </div>
);

/** التصنيفات — inactive + active chips (colors.category.*), same contract as .menu-chip. */
export const CategoryTokensSample: React.FC = () => (
  <div className="flex flex-wrap items-center gap-2" dir="rtl">
    <span
      className="px-3 py-1.5 text-[11px] font-bold"
      style={{
        background: 'var(--m-chip-bg)',
        color: 'var(--m-chip-text)',
        borderRadius: 'var(--m-radius-full)',
        border: '1px solid var(--m-hairline)',
      }}
    >
      تصنيف عادي
    </span>
    <span
      className="px-3 py-1.5 text-[11px] font-bold"
      style={{
        // Active chip contract (identical to .menu-chip[data-active='true']):
        // the derived brand-gradient image layer is switched off automatically
        // when an explicit activeBg colour exists — see --category-active-image.
        backgroundImage: 'var(--m-chip-active-image)',
        backgroundColor: 'var(--m-chip-active-bg)',
        color: 'var(--m-chip-active-text)',
        borderRadius: 'var(--m-radius-full)',
      }}
    >
      تصنيف نشط
    </span>
  </div>
);

const SAMPLE_CATEGORIES = ['الكل', 'المشاوي', 'المقبلات', 'الحلويات'];
const SAMPLE_DISHES = [
  { name: 'مشاوي مشكلة', price: '85' },
  { name: 'سلطة الشيف', price: '32' },
];

export const ThemePreview: React.FC<ThemePreviewProps> = ({
  draft,
  forceMode,
  restaurantName = 'مطعمك',
  currency = '₪',
}) => {
  // The draft is projected through the real derivation, then handed to the
  // real provider in the shape it already accepts for a restaurant
  // (ThemeTokensScope owns that projection — same one the mini samples use).
  return (
    <ThemeTokensScope draft={draft} forceMode={forceMode}>
      <div
        dir="rtl"
        className="rounded-2xl overflow-hidden border"
        style={{
          background: 'var(--m-bg)',
          borderColor: 'var(--m-hairline)',
          fontFamily: 'var(--m-font)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 border-b"
          style={{ background: 'var(--m-surface)', borderColor: 'var(--m-hairline)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold"
              style={{ backgroundImage: 'var(--m-brand-fill)', color: 'var(--m-brand-ink)' }}
            >
              {restaurantName.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <div
                className="text-sm font-bold truncate"
                style={{ color: 'var(--m-text)', fontWeight: 'var(--m-font-heading-weight)' as never }}
              >
                {restaurantName}
              </div>
              <div className="text-[10px] truncate" style={{ color: 'var(--m-text-muted)' }}>
                قائمة الطعام
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Search className="w-4 h-4" style={{ color: 'var(--m-text-muted)' }} aria-hidden="true" />
            <ShoppingBag className="w-4 h-4" style={{ color: 'var(--m-brand-on-surface)' }} aria-hidden="true" />
          </div>
        </div>

        {/* Category rail */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 overflow-hidden border-b"
          style={{ background: 'var(--m-surface)', borderColor: 'var(--m-hairline)' }}
        >
          {SAMPLE_CATEGORIES.map((cat, i) => (
            <span
              key={cat}
              className="px-3 py-1.5 text-[11px] font-bold whitespace-nowrap"
              style={
                i === 0
                  ? {
                      backgroundImage: 'var(--m-chip-active-image)',
                      backgroundColor: 'var(--m-chip-active-bg)',
                      color: 'var(--m-chip-active-text)',
                      borderRadius: 'var(--m-radius-full)',
                    }
                  : {
                      background: 'var(--m-chip-bg)',
                      color: 'var(--m-chip-text)',
                      borderRadius: 'var(--m-radius-full)',
                      border: '1px solid var(--m-hairline)',
                    }
              }
            >
              {cat}
            </span>
          ))}
        </div>

        {/* Dish cards */}
        <div className="p-4 space-y-3">
          {SAMPLE_DISHES.map((dish) => (
            <div
              key={dish.name}
              className="flex items-center gap-3 p-2.5"
              style={{
                background: 'var(--m-card-bg)',
                border: '1px solid var(--m-card-border)',
                borderRadius: 'var(--m-card-radius)',
                boxShadow: 'var(--m-card-shadow)',
              }}
            >
              <div
                className="w-12 h-12 shrink-0 flex items-center justify-center"
                style={{
                  backgroundImage: 'var(--m-brand-fill)',
                  borderRadius: 'var(--m-radius-md)',
                  color: 'var(--m-brand-ink)',
                }}
              >
                <UtensilsCrossed className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold truncate" style={{ color: 'var(--m-text)' }}>
                  {dish.name}
                </div>
                <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--m-text-muted)' }}>
                  طبق مميز من مطبخنا
                </div>
                <div
                  className="text-[11px] font-bold mt-1"
                  style={{ color: 'var(--m-brand-on-surface)' }}
                >
                  {currency} {dish.price}
                </div>
              </div>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="w-7 h-7 flex items-center justify-center shrink-0"
                style={{
                  background: 'var(--m-button-bg)',
                  color: 'var(--m-button-text)',
                  borderRadius: 'var(--m-radius-md)',
                }}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {/* Buttons + badge */}
          <div className="flex items-center gap-2 pt-1">
            <span
              className="px-2.5 py-1 text-[10px] font-bold"
              style={{
                background: 'var(--m-badge-bg)',
                color: 'var(--m-badge-text)',
                borderRadius: 'var(--m-badge-radius)',
              }}
            >
              جديد
            </span>
            <span
              className="px-3 py-1.5 text-[11px] font-bold"
              style={{
                background: 'var(--m-button-secondary-bg)',
                color: 'var(--m-button-secondary-text)',
                borderRadius: 'var(--m-radius-md)',
                border: '1px solid var(--m-hairline)',
              }}
            >
              تفاصيل
            </span>
            <span
              className="px-3 py-1.5 text-[11px] font-bold"
              style={{
                backgroundImage: 'var(--m-button-bg)',
                color: 'var(--m-button-text)',
                borderRadius: 'var(--m-radius-md)',
              }}
            >
              أضف للسلة
            </span>
          </div>
        </div>
      </div>
    </ThemeTokensScope>
  );
};
