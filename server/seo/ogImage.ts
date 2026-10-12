/**
 * Mureeh Menu — Open Graph image endpoint (platform only).
 *
 * Why direct 200 OK instead of a 302 redirect
 * ===========================================
 * Previously `/api/og?type=platform` answered with a 302 redirect to
 * `/favicon.svg` (and was referenced directly in `index.html`). Because
 * `/api/*` is intentionally crawlable in `robots.txt` so Googlebot can
 * render the SPA, Googlebot discovered `/api/og?type=platform` from the
 * homepage `<head>`, received HTTP 302, and Search Console classified the
 * URL under "صفحة تتضمن إعادة توجيه" ("Page with redirect") — ignoring
 * `X-Robots-Tag: noindex` because 3xx responses are bucketed as redirects
 * before indexing directives are evaluated.
 *
 * To eliminate that redirect completely:
 *   1. `index.html` now references `https://mureehmenu.com/og-image.png`
 *      directly (a static 1200×630 PNG served with 200 OK).
 *   2. `/api/og` serves the exact same PNG bytes directly with HTTP 200,
 *      `Content-Type: image/png`, and `X-Robots-Tag: noindex`, so any
 *      crawler or social scraper hitting a historical `/api/og?type=platform`
 *      URL gets a direct 200 OK response instead of a redirect.
 *
 * Scope: platform only
 * ====================
 * This endpoint serves the PLATFORM OG image (`/og-image.png`). Per-venue
 * social previews are intentionally out of scope.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { PUBLIC_ORIGIN } from './platformSeo';

const ALLOWED_TYPES = new Set(['platform']);
export const PLATFORM_OG_IMAGE_PATH = '/og-image.png';
export const DEFAULT_PLATFORM_OG = `${PUBLIC_ORIGIN}${PLATFORM_OG_IMAGE_PATH}`;

let cachedOgBytes: Buffer | null = null;

function readPlatformOgImageBytes(): Buffer | null {
  if (cachedOgBytes) return cachedOgBytes;
  const candidates = [
    path.resolve(process.cwd(), 'dist', 'og-image.png'),
    path.resolve(process.cwd(), 'public', 'og-image.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedOgBytes = fs.readFileSync(candidate);
        return cachedOgBytes;
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

/**
 * Express handler:
 *   GET /api/og?type=platform  → 200 image/png + X-Robots-Tag: noindex
 *   anything else              → 200 image/png + X-Robots-Tag: noindex
 *
 * Single-key query (`type=`) keeps the surface tiny and avoids
 * attacker-controlled path resolution: there is no `slug` parameter
 * to validate.
 */
export function handlePlatformOgImage(req: Request, res: Response): void {
  // Non-indexable binary image response — never a page.
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const type = String(req.query.type ?? '').toLowerCase();
  const _resolvedTarget =
    ALLOWED_TYPES.has(type) && type === 'platform'
      ? DEFAULT_PLATFORM_OG
      : DEFAULT_PLATFORM_OG;
  void _resolvedTarget;

  const bytes = readPlatformOgImageBytes();
  if (bytes) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(bytes.byteLength));
    res.status(200).send(bytes);
    return;
  }

  res.status(404).end();
}
