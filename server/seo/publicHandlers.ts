/**
 * Mureeh Menu — Express handlers for the public, indexable surface.
 *
 *   GET /r/:slug        venue page: SPA shell + venue head + menu snapshot
 *   GET /restaurants    public directory of published venues
 *   GET /sitemap.xml    database-backed sitemap (degrades to platform-only)
 *   SPA fallback        unknown extension-less route → 404 + noindex shell
 *   host canonicaliser  *.onrender.com (and www) → 301 to the public origin
 *
 * Every response is identical for browsers and crawlers — there is no
 * user-agent detection anywhere in this file (Google calls serving bots a
 * different page "dynamic rendering" and no longer recommends it).
 *
 * The SPA keeps full ownership of behaviour after hydration: `/r/{slug}`
 * still boots the React customer shell with the exact same assets, the
 * `?qr=…` table token is untouched (the server never reads it — it only
 * matters to the client/session API), and nothing here can create, read or
 * change an order.
 *
 * Status codes are deliberate so that Search Console never sees soft-404s:
 *   200  venue found (index when publishable, otherwise noindex)
 *   301  non-canonical form of a canonical URL (case, trailing slash, host)
 *   404  unknown slug / unknown app route / venue not public (noindex shell)
 *   503  venue in MAINTENANCE, or the catalog read failed (Retry-After)
 */

import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import { isProd } from '../config';
import { PUBLIC_ORIGIN, STATIC_ENTRIES, buildSitemapXml, canonicalUrl } from './platformSeo';
import { getPublicVenue, listPublishableVenues, normalizePublicSlug } from './publicCatalog';
import {
  HEAD_START_MARKER,
  renderDirectoryPage,
  renderNotFoundPage,
  renderTemporaryErrorPage,
  renderUnavailableVenuePage,
  renderVenuePage,
} from './publicPages';

// =====================================================================
// SHELL (dist/index.html) LOADING
// =====================================================================

let shellPath: string | null = null;
let shellCache: string | null = null;
let shellOverride: string | null = null;

/** Point the handlers at the built SPA shell (called once from server/index.ts). */
export function configurePublicPages(options: { shellPath: string }): void {
  shellPath = options.shellPath;
  shellCache = null;
}

/** Tests inject a shell string instead of reading dist/index.html. */
export function __setPublicShellForTests(html: string | null): void {
  shellOverride = html;
  shellCache = null;
}

function loadShell(): string | null {
  if (shellOverride !== null) return shellOverride;
  if (shellCache !== null) return shellCache;
  if (!shellPath) return null;
  try {
    const html = fs.readFileSync(shellPath, 'utf8');
    if (!html.includes(HEAD_START_MARKER)) {
      console.warn('[seo] index.html has no <!-- seo:head:start --> marker; falling back to tag stripping.');
    }
    // dist/index.html is immutable per deploy in production; in development
    // every request re-reads it so a rebuild is picked up without a restart.
    if (isProd) shellCache = html;
    return html;
  } catch (error) {
    console.error('[seo] Could not read the SPA shell:', (error as Error)?.message ?? error);
    return null;
  }
}

const sendHtml = (res: Response, status: number, html: string, cacheControl: string): void => {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Vary', 'Accept-Encoding');
  res.send(html);
};

const PAGE_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const ERROR_CACHE = 'no-store';

const querySuffix = (req: Request): string => {
  const index = req.originalUrl.indexOf('?');
  return index === -1 ? '' : req.originalUrl.slice(index);
};

/**
 * Query keys that mark a URL as a table session or a kiosk board rather
 * than the public page. Metadata is identical (canonical → `/r/{slug}`);
 * only the pre-hydration snapshot is skipped so the QR flow and the TV
 * board keep their exact current boot sequence.
 */
const SESSION_QUERY_KEYS = ['qr', 'sessionToken', 'table', 'tableId', 't', 'view'];

const isSessionUrl = (req: Request): boolean => {
  const query = req.query as Record<string, unknown>;
  return SESSION_QUERY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(query, key));
};

// =====================================================================
// HOST CANONICALISATION
// =====================================================================

const canonicalHost = (() => {
  try {
    return new URL(PUBLIC_ORIGIN).host.toLowerCase();
  } catch {
    return 'mureehmenu.com';
  }
})();

/**
 * The Render service answers on its `*.onrender.com` hostname as well as on
 * the custom domain, which makes every page reachable at two URLs. Page
 * requests on the alias are redirected permanently to the public origin;
 * API, uploads and health checks are left alone so platform probes and
 * keep-alive pings keep working on the alias.
 */
export function handleCanonicalHostRedirect(req: Request, res: Response, next: NextFunction): void {
  if (!isProd) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const host = String(req.hostname ?? '').toLowerCase();
  if (!host || host === canonicalHost) return next();
  const isAlias = /\.onrender\.com$/.test(host) || host === `www.${canonicalHost}`;
  if (!isAlias) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.redirect(301, `${PUBLIC_ORIGIN}${req.originalUrl}`);
}

// =====================================================================
// /r/:slug — VENUE PAGE
// =====================================================================

export async function handleVenuePage(req: Request, res: Response, next: NextFunction): Promise<void> {
  const shell = loadShell();
  if (!shell) return next(); // no build on disk — let the existing fallback answer

  const rawSlug = String(req.params.slug ?? '');
  const pathname = req.path;

  // Canonical form: lowercase slug, no trailing slash. Query string (QR
  // token, display view) is preserved verbatim — it belongs to the client.
  if (rawSlug !== rawSlug.toLowerCase() || /\/$/.test(pathname)) {
    const target = `/r/${rawSlug.toLowerCase()}${querySuffix(req)}`;
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.redirect(301, target);
    return;
  }

  const slug = normalizePublicSlug(rawSlug);
  if (!slug) {
    sendHtml(res, 404, renderNotFoundPage(shell, pathname), ERROR_CACHE);
    return;
  }

  try {
    const lookup = await getPublicVenue(slug);
    if (lookup.kind === 'not_found') {
      sendHtml(res, 404, renderNotFoundPage(shell, `/r/${slug}`), ERROR_CACHE);
      return;
    }
    if (lookup.kind === 'unavailable') {
      const status = lookup.venue.status === 'MAINTENANCE' ? 503 : 404;
      if (status === 503) res.setHeader('Retry-After', '600');
      sendHtml(res, status, renderUnavailableVenuePage(shell, lookup.venue), ERROR_CACHE);
      return;
    }
    sendHtml(res, 200, renderVenuePage(shell, lookup.venue, { snapshot: !isSessionUrl(req) }), PAGE_CACHE);
  } catch (error) {
    console.error('[seo] venue page render failed:', (error as Error)?.message ?? error);
    res.setHeader('Retry-After', '60');
    sendHtml(res, 503, renderTemporaryErrorPage(shell, `/r/${slug}`), ERROR_CACHE);
  }
}

// =====================================================================
// /restaurants — PUBLIC DIRECTORY
// =====================================================================

export async function handleDirectoryPage(req: Request, res: Response): Promise<void> {
  if (/\/$/.test(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.redirect(301, `/restaurants${querySuffix(req)}`);
    return;
  }
  try {
    const venues = await listPublishableVenues();
    sendHtml(res, 200, renderDirectoryPage(venues), PAGE_CACHE);
  } catch (error) {
    console.error('[seo] directory render failed:', (error as Error)?.message ?? error);
    res.setHeader('Retry-After', '60');
    sendHtml(res, 503, renderDirectoryPage([]), ERROR_CACHE);
  }
}

// =====================================================================
// /sitemap.xml — DATABASE-BACKED
// =====================================================================

const toLastmod = (date: Date | null | undefined): string | null => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || date.getTime() === 0) return null;
  return date.toISOString();
};

export async function buildSitemapEntries() {
  const entries = [...STATIC_ENTRIES];
  const venues = await listPublishableVenues();
  if (venues.length > 0) {
    const newest = venues.reduce<Date | null>(
      (max, v) => (!max || v.lastModified > max ? v.lastModified : max),
      null
    );
    entries.push({ loc: canonicalUrl('/restaurants'), lastmod: toLastmod(newest) });
  }
  const seen = new Set(entries.map((e) => e.loc));
  for (const venue of venues) {
    const loc = canonicalUrl(`/r/${venue.slug}`);
    if (seen.has(loc)) continue;
    seen.add(loc);
    entries.push({ loc, lastmod: toLastmod(venue.lastModified) });
  }
  return entries;
}

export async function handleSitemap(_req: Request, res: Response): Promise<void> {
  let xml: string;
  let cache = 'public, max-age=300';
  try {
    xml = buildSitemapXml(await buildSitemapEntries());
  } catch (error) {
    // Never 500 a sitemap: degrade to the platform entries so the crawler
    // keeps a valid file, and let the operator see why in the logs.
    console.error('[seo] sitemap: catalog read failed, serving platform entries only:', (error as Error)?.message ?? error);
    xml = buildSitemapXml(STATIC_ENTRIES);
    cache = 'no-store';
  }
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.status(200).send(xml);
}

// =====================================================================
// SPA FALLBACK FOR UNKNOWN APP ROUTES
// =====================================================================

/**
 * The application has exactly two extension-less routes: "/" and
 * "/r/{slug}". Anything else that reaches the fallback is an unknown URL,
 * so it is answered with the SPA shell (the client still renders) but with
 * HTTP 404 and a noindex head — an honest 404 instead of a soft one.
 */
export function handleUnknownAppRoute(req: Request, res: Response, next: NextFunction): void {
  const shell = loadShell();
  if (!shell) return next();
  sendHtml(res, 404, renderNotFoundPage(shell, req.path), ERROR_CACHE);
}

/** Exposed for the server bootstrap log. */
export const PUBLIC_PAGE_ROUTES = ['/', '/restaurants', '/r/{slug}'] as const;
