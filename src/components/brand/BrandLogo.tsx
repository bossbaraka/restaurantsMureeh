import React from 'react';

/**
 * MUREEH (مُريح - منصة مريح للخدمات الإلكترونية) visual identity — single source of truth.
 * Color Palette extracted directly from Mureeh's official brand guidelines:
 * - Deep Royal Navy: #003865 / #004B87
 * - Electric Ocean Blue: #0072BC / #009FE3
 * - Cyan & Sky Blue Highlights: #38BDF8 / #7DD3FC / #E0F2FE
 */

export const BRAND_MARK_URL = '/favicon.svg';

export const BRAND_GRADIENT =
  'linear-gradient(135deg, #040D1A 0%, #003865 40%, #0072BC 85%, #009FE3 100%)';

export const BRAND_TEXT_GRADIENT =
  'linear-gradient(90deg, #FFFFFF 0%, #E0F2FE 20%, #38BDF8 50%, #009FE3 80%, #0072BC 100%)';

export const BRAND_COLORS = {
  navyDeep: '#040D1A',
  navy: '#003865',
  royal: '#004B87',
  electric: '#0072BC',
  sky: '#009FE3',
  cyan: '#38BDF8',
  ice: '#E0F2FE',
};

interface BrandLogoProps {
  /** height/width of the square mark in px */
  size?: number;
  showWordmark?: boolean;
  subtitle?: string;
  className?: string;
}

export const BrandMark: React.FC<{ size?: number; className?: string }> = ({
  size = 36,
  className = '',
}) => (
  <span
    className={`relative inline-flex items-center justify-center rounded-2xl ring-1 ring-sky-400/30 shadow-lg shrink-0 overflow-hidden ${className}`}
    style={{
      width: size,
      height: size,
      background:
        'radial-gradient(120% 120% at 20% 15%, #0072BC 0%, #003865 50%, #040D1A 100%)',
      boxShadow: '0 0 24px rgba(0, 114, 188, 0.4), inset 0 1px 0 rgba(255,255,255,0.25)',
    }}
  >
    <img
      src={BRAND_MARK_URL}
      alt="مُريح"
      style={{ width: size * 0.86, height: size * 0.86 }}
      className="drop-shadow-[0_0_12px_rgba(56,189,248,0.6)]"
    />
  </span>
);

export const BrandWordmark: React.FC<{ size?: number; subtitle?: string; showTagline?: boolean }> = ({
  size = 26,
  subtitle = 'MUREEH',
  showTagline = false,
}) => (
  <span className="inline-flex flex-col leading-none">
    <span
      className="font-extrabold font-serif"
      style={{
        fontSize: size,
        backgroundImage: BRAND_TEXT_GRADIENT,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      }}
    >
      مُريح
    </span>
    <span
      className="font-bold uppercase text-[#38BDF8]/90 tracking-[0.32em] mt-1"
      style={{ fontSize: Math.max(7, Math.round(size * 0.3)) }}
    >
      {subtitle}
    </span>
    {showTagline && (
      <span className="text-[9px] text-sky-200/80 font-medium tracking-tight mt-1 opacity-90">
        منصة مريح للخدمات الإلكترونية
      </span>
    )}
  </span>
);

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 36,
  showWordmark = true,
  subtitle,
  className = '',
}) => (
  <span className={`inline-flex items-center gap-3 select-none ${className}`}>
    <BrandMark size={size} />
    {showWordmark && <BrandWordmark size={Math.max(18, Math.round(size * 0.72))} subtitle={subtitle} />}
  </span>
);
