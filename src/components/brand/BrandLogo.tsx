import React from 'react';

/**
 * MUREEH (مُريح) visual identity — single source of truth.
 * The mark is the official brand asset shipped with the platform
 * (public/favicon.svg: violet #863BFF/#7E14FF with electric-blue #47BFFF glints).
 * Swap the mark/colors HERE to rebrand the whole platform in one place.
 */

export const BRAND_MARK_URL = '/favicon.svg';

export const BRAND_GRADIENT =
  'linear-gradient(135deg, #12052B 0%, #3B0A86 45%, #0E2A5C 100%)';

export const BRAND_TEXT_GRADIENT =
  'linear-gradient(90deg, #D6C7FF 0%, #A78BFA 30%, #7E14FF 62%, #47BFFF 100%)';

export const BRAND_COLORS = {
  violet: '#7E14FF',
  violetSoft: '#A78BFA',
  indigo: '#863BFF',
  blue: '#47BFFF',
  violetDeep: '#2A0B57',
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
    className={`relative inline-flex items-center justify-center rounded-2xl ring-1 ring-white/15 shadow-lg shrink-0 overflow-hidden ${className}`}
    style={{
      width: size,
      height: size,
      background:
        'radial-gradient(120% 120% at 20% 15%, #4E0FA8 0%, #2A0B57 45%, #0E2A5C 100%)',
      boxShadow: '0 0 24px rgba(126,20,255,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
    }}
  >
    <img
      src={BRAND_MARK_URL}
      alt="مُريح"
      style={{ width: size * 0.86, height: size * 0.86 }}
      className="drop-shadow-[0_0_12px_rgba(71,191,255,0.45)]"
    />
  </span>
);

export const BrandWordmark: React.FC<{ size?: number; subtitle?: string }> = ({
  size = 26,
  subtitle = 'MUREEH',
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
      className="font-bold uppercase text-[#47BFFF]/90 tracking-[0.32em] mt-1"
      style={{ fontSize: Math.max(7, Math.round(size * 0.3)) }}
    >
      {subtitle}
    </span>
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
