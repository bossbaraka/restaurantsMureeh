import { useEffect, useRef } from 'react';
import type { Restaurant } from '../types/restaurant';

/**
 * Guest browser chrome — the tab belongs to the restaurant, not to us.
 * ====================================================================
 * A guest arrives by scanning a QR code on a table. Everything they see must
 * read as the restaurant's own product, and the browser chrome is part of
 * that: the tab title, the favicon, the description used when the page is
 * shared, and the mobile status-bar colour.
 *
 * This module rewrites those four things from the tenant record (name, nameEn,
 * description, logo, brand colours) and restores the previous values when the
 * guest surface unmounts, so the staff/admin views keep their own identity.
 *
 * It is deliberately framework-thin: one pure `applyTenantDocumentIdentity`
 * (unit-testable, no React) plus a hook wrapper. Nothing here talks to the
 * network or to storage.
 */

export interface DocumentIdentity {
  title: string;
  description: string;
  /** Favicon href — the tenant logo, or a generated monogram tile. */
  icon: string;
  /** Optional `<meta name="theme-color">` (mobile status bar). */
  themeColor?: string;
}

/** Restore function returned by every apply* call. */
export type RestoreIdentity = () => void;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Only http(s), protocol-relative, root-relative or image data URLs are safe. */
export function isRenderableIconUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith('data:image/')) return true;
  if (v.startsWith('/')) return !v.startsWith('//');
  return /^(https?:)?\/\//i.test(v);
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * A favicon built from the restaurant's own initial + brand colours, used when
 * the tenant has no logo image. It keeps the tab on-brand for the venue
 * instead of falling back to a platform mark.
 */
export function tenantMonogramIcon(
  name: string,
  primaryColor?: string,
  accentColor?: string
): string {
  const letter = (name || '').trim().charAt(0).toUpperCase() || '·';
  const from = HEX_COLOR.test(primaryColor || '') ? (primaryColor as string) : '#D4AF37';
  const to = HEX_COLOR.test(accentColor || '') ? (accentColor as string) : '#0A0B0D';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${escapeXml(from)}"/>` +
    `<stop offset="1" stop-color="${escapeXml(to)}"/>` +
    `</linearGradient></defs>` +
    `<rect width="64" height="64" rx="16" fill="url(#g)"/>` +
    `<text x="32" y="44" font-family="Tajawal, sans-serif" font-size="34" font-weight="700" ` +
    `text-anchor="middle" fill="#0A0B0D">${escapeXml(letter)}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Neutral, brand-free glyph shown for the split second between the QR
 * navigation and the tenant record arriving: a menu card, no wordmark.
 */
export const NEUTRAL_MENU_ICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="16" fill="#0A0B0D"/>` +
    `<g fill="none" stroke="#D4AF37" stroke-width="4" stroke-linecap="round">` +
    `<path d="M20 18v28"/><path d="M14 18v9a6 6 0 0 0 12 0v-9"/>` +
    `<path d="M44 18c-4 3-6 8-6 13 0 4 2 6 6 6v9"/>` +
    `</g></svg>`
)}`;

function readMeta(name: string): string | null {
  const tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  return tag ? tag.getAttribute('content') : null;
}

/** Writes a meta tag, reporting whether it had to be created. */
function writeMeta(name: string, content: string): { tag: HTMLMetaElement; created: boolean } {
  const existing = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (existing) {
    existing.setAttribute('content', content);
    return { tag: existing, created: false };
  }
  const tag = document.createElement('meta');
  tag.setAttribute('name', name);
  tag.setAttribute('content', content);
  document.head.appendChild(tag);
  return { tag, created: true };
}

function readIconHref(): string | null {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  return link ? link.getAttribute('href') : null;
}

function writeIcon(href: string): { link: HTMLLinkElement; created: boolean } {
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  const created = !link;
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'icon');
    document.head.appendChild(link);
  }
  // The tenant logo is usually a raster upload; SVG data URIs need their type.
  link.setAttribute('type', href.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/png');
  link.setAttribute('href', href);
  return { link, created };
}

/**
 * Writes the identity and returns a function that puts the previous one back.
 * Safe to call during SSR / tests (no-ops without a document).
 */
export function applyDocumentIdentity(next: DocumentIdentity): RestoreIdentity {
  if (typeof document === 'undefined') return () => {};

  const previousTitle = document.title;
  const previousDescription = readMeta('description');
  const previousTheme = readMeta('theme-color');
  const previousIconHref = readIconHref();
  const created: HTMLElement[] = [];

  if (next.title.trim()) document.title = next.title;
  if (next.description.trim()) {
    const meta = writeMeta('description', next.description);
    if (meta.created) created.push(meta.tag);
  }
  if (next.themeColor && HEX_COLOR.test(next.themeColor)) {
    const meta = writeMeta('theme-color', next.themeColor);
    if (meta.created) created.push(meta.tag);
  }
  if (next.icon) {
    const icon = writeIcon(next.icon);
    if (icon.created) created.push(icon.link);
  }

  // Restore = put back what was there, and take away what this layer added.
  // The staff/admin views unmount the guest surface and must find the document
  // exactly as they left it.
  return () => {
    if (typeof document === 'undefined') return;
    document.title = previousTitle;
    if (previousDescription !== null) writeMeta('description', previousDescription);
    if (previousTheme !== null) writeMeta('theme-color', previousTheme);
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (link && previousIconHref) link.setAttribute('href', previousIconHref);
    for (const node of created) node.remove();
  };
}

/** Builds the identity for a tenant record — pure, so it is directly testable. */
export function tenantDocumentIdentity(restaurant: Restaurant): DocumentIdentity {
  const isEnglish = restaurant.language === 'en';
  const name = ((isEnglish ? restaurant.nameEn || restaurant.name : restaurant.name) || '').trim();
  const secondary = (isEnglish ? restaurant.name : restaurant.nameEn || '').trim();
  const description = (restaurant.description || '').trim();

  const logo = (restaurant.logo || '').trim();
  const icon = isRenderableIconUrl(logo)
    ? logo
    : tenantMonogramIcon(name || secondary, restaurant.primaryColor, restaurant.accentColor);

  return {
    title: secondary && secondary !== name ? `${name} | ${secondary}` : name,
    description:
      description ||
      (isEnglish
        ? `${name} — digital menu, order from your table.`
        : `${name} — القائمة الرقمية، اطلب من طاولتك مباشرة.`),
    icon,
    themeColor: HEX_COLOR.test(restaurant.primaryColor || '') ? restaurant.primaryColor : undefined,
  };
}

/**
 * Called once before React mounts: a guest landing on `/r/{slug}` must never
 * see the platform's name or mark in the tab while the tenant record is still
 * in flight. Non-guest routes are left exactly as the server rendered them.
 */
export function prepareGuestRouteIdentity(
  location: Pick<Location, 'pathname'> | undefined = typeof window !== 'undefined'
    ? window.location
    : undefined
): RestoreIdentity {
  if (typeof document === 'undefined' || !location) return () => {};
  if (!location.pathname.startsWith('/r/')) return () => {};
  return applyDocumentIdentity({
    title: 'القائمة الرقمية',
    description: 'القائمة الرقمية للمطعم — اطلب من طاولتك مباشرة.',
    icon: NEUTRAL_MENU_ICON,
  });
}

/** React binding: applies the tenant identity while the guest surface is mounted. */
export function useTenantDocumentIdentity(restaurant: Restaurant | null | undefined): void {
  // The tenant object is rebuilt on every poll/refetch, so the DOM is only
  // touched when the identity it describes actually changed.
  const lastApplied = useRef<string>('');

  useEffect(() => {
    if (!restaurant) return;
    const identity = tenantDocumentIdentity(restaurant);
    if (!identity.title) return;

    const signature = JSON.stringify(identity);
    if (signature === lastApplied.current) return;
    lastApplied.current = signature;

    const restore = applyDocumentIdentity(identity);
    return () => {
      restore();
      lastApplied.current = '';
    };
  }, [restaurant]);
}
