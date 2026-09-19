import React from 'react';

/**
 * Brand marks for the venue's contact channels.
 * =============================================
 * The bundled icon set ships no product logos, so the handful of glyphs the
 * «تواصل معنا» section needs are drawn here as plain SVG primitives — every
 * one is paired with a visible text label and an accessible name, so the mark
 * only has to be recognisable, never pixel-exact.
 *
 * All paths are static geometry: no injected HTML, no external sprite, nothing
 * the venue controls.
 */

interface MarkProps {
  className?: string;
}

const base = (className?: string) => ({
  className,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
});

export const InstagramMark: React.FC<MarkProps> = ({ className }) => (
  <svg {...base(className)}>
    <rect x="3" y="3" width="18" height="18" rx="5.2" />
    <circle cx="12" cy="12" r="4.1" />
    <circle cx="17.1" cy="6.9" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const FacebookMark: React.FC<MarkProps> = ({ className }) => (
  <svg {...base(className)}>
    <path d="M14.6 21v-7.2h2.5l.4-2.9h-2.9V9.1c0-.84.24-1.42 1.46-1.42h1.54V5.1c-.27-.04-1.2-.12-2.28-.12-2.26 0-3.8 1.38-3.8 3.9v1.98H9V13.8h2.52V21z" fill="currentColor" stroke="none" />
  </svg>
);

export const TiktokMark: React.FC<MarkProps> = ({ className }) => (
  <svg {...base(className)}>
    <path d="M14.2 3.2v10.9a3.1 3.1 0 1 1-2.6-3.06" />
    <path d="M14.2 3.2c.35 2.05 1.7 3.3 3.8 3.5" />
  </svg>
);

export const YoutubeMark: React.FC<MarkProps> = ({ className }) => (
  <svg {...base(className)}>
    <rect x="2.4" y="5.2" width="19.2" height="13.6" rx="4.2" />
    <path d="M10.4 9.5 15 12l-4.6 2.5z" fill="currentColor" stroke="none" />
  </svg>
);

export const WebsiteMark: React.FC<MarkProps> = ({ className }) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.2 12h17.6" />
    <path d="M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z" />
  </svg>
);

export const WhatsappMark: React.FC<MarkProps> = ({ className }) => (
  <svg {...base(className)}>
    <path d="M20.4 11.6a8.4 8.4 0 0 1-12.5 7.3L3.6 20.4l1.55-4.2A8.4 8.4 0 1 1 20.4 11.6z" />
    <path d="M9.2 8.6c.3-.06.6.02.76.34l.7 1.36c.13.25.07.55-.14.73l-.44.38c-.14.12-.18.32-.1.48a5.6 5.6 0 0 0 2.6 2.4c.17.07.37.03.5-.11l.4-.42c.18-.2.48-.25.72-.12l1.32.72c.32.17.4.47.34.78-.2 1.03-1.28 1.6-2.3 1.36a8.6 8.6 0 0 1-6.2-6.06c-.26-1 .28-2.08 1.3-2.3z" fill="currentColor" stroke="none" />
  </svg>
);
