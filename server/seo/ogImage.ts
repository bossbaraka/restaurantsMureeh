/**
 * Mureeh Menu — Open Graph image redirector (platform only).
 *
 * Why a redirector
 * ================
 * A redirector is the cheapest way to ship an `og:image` per page:
 * the social platform follows the URL, downloads the venue/brand
 * image, and caches it. We do NOT generate a PNG on the server (no
 * Canvas/sharp dependency, no image-generation cost on every share).
 *
 * Scope: platform only
 * ====================
 * This endpoint serves the PLATFORM OG image: `/og-image.png`, a real
 * 1200×630 PNG shipped from `public/` (composed from the brand mark in
 * `favicon.svg` and the platform palette). The homepage declares that
 * PNG directly; this redirector only remains so links that were shared
 * with the older `/api/og?type=platform` URL keep resolving to an image.
 * Per-venue social previews are rendered by server/seo/publicPages.ts
 * from the venue's own cover/logo, never by this endpoint.
 *
 * Status code
 * ===========
 * Always 302 (temporary). A future redesign of the platform OG image
 * must not require invalidating a CDN cache of a pre-rendered PNG.
 *
 * Noindex
 * =======
 * The endpoint sits under `/api/*` so the upstream
 * `X-Robots-Tag: noindex` applies. Search engines must never surface
 * a redirect endpoint.
 */

import type { Request, Response } from 'express';
import { PUBLIC_ORIGIN } from './platformSeo';

const ALLOWED_TYPES = new Set(['platform']);
/** Stable public path of the platform social card (see public/og-image.png). */
export const PLATFORM_OG_IMAGE_PATH = '/og-image.png';
const DEFAULT_PLATFORM_OG = `${PUBLIC_ORIGIN}${PLATFORM_OG_IMAGE_PATH}`;

/**
 * Express handler:
 *   GET /api/og?type=platform  → 302 to the platform OG image
 *   anything else              → 302 to the platform OG image
 *
 * Single-key query (`type=`) keeps the surface tiny and avoids
 * attacker-controlled path resolution: there is no `slug` parameter
 * to validate.
 */
export function handlePlatformOgImage(req: Request, res: Response): void {
  // Soft noindex: this endpoint serves binary asset responses, never a
  // page; even if a crawler asks for /api/og it must never surface.
  res.setHeader('X-Robots-Tag', 'noindex');

  const type = String(req.query.type ?? '').toLowerCase();
  let target: string | null = null;

  if (ALLOWED_TYPES.has(type) && type === 'platform') {
    target = DEFAULT_PLATFORM_OG;
  } else {
    target = DEFAULT_PLATFORM_OG;
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.redirect(302, target);
}