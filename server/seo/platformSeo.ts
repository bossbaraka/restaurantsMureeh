/**
 * Mureeh Menu — platform-level SEO surface.
 *
 * Scope
 * =====
 * This module owns SEO for the PLATFORM (the SaaS marketing surface
 * at https://mureehmenu.com/). It does NOT enumerate per-venue
 * content — that lives in the SPA at /r/{slug} via the public API
 * (/api/public/restaurants/:slug), which is the same data source the
 * SPA hydrates from. Adding venue indexing here would either:
 *
 *   (a) duplicate the public API's data model in two places, or
 *   (b) require the SEO engine to read the database directly, which
 *       the SPA does not.
 *
 * Neither is desirable. The platform's SEO surface is therefore a
 * small, explicit, enumerated set:
 *
 *   /                        — the SaaS landing page
 *   /restaurants             — platform marketing surface for "list
 *                              every restaurant on Mureeh" (future
 *                              public marketing content, NOT a venue
 *                              directory)
 *
 * Anything beyond this is owned by the SPA. Per-venue discovery goes
 * through:
 *   - the SaaS landing's CTA sections,
 *   - social-media and direct marketing,
 *   - the table QR code, which routes to /r/{slug}?qr=… (a session
 *     URL that robots.txt disallows).
 *
 * Pure functions
 * ==============
 * This module is Prisma-free: it imports nothing from the database,
 * the storage layer, or the auth layer. The sitemap, robots.txt and
 * OG image endpoint are all deterministic given the public origin.
 * That makes the module safe to call from tests, the prerender
 * script, and the production handler alike.
 */

import type { Request, Response } from 'express';

// =====================================================================
// ORIGIN + PUBLIC URL HELPERS
// =====================================================================

/**
 * Production origin is hardcoded because a canonical that resolved
 * to a preview/localhost host would deindex the real domain. The
 * operator override (`APP_URL`) exists for non-production hosts only.
 */
const PRODUCTION_ORIGIN = 'https://mureehmenu.com';

export function readPublicOrigin(): string {
  const raw = process.env.APP_URL?.replace(/\/+$/, '');
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  return PRODUCTION_ORIGIN;
}

export const PUBLIC_ORIGIN: string = readPublicOrigin();

export function canonicalUrl(pathname: string): string {
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${PUBLIC_ORIGIN}${cleanPath}`;
}

// =====================================================================
// XML ESCAPE (sitemap + structured-data strings)
// =====================================================================

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// =====================================================================
// SITEMAP — platform-only
// =====================================================================

/**
 * Static entries that exist independently of any database read.
 *
 * Order matters for crawl priority. The platform landing is the
 * canonical entry; any future public documentation surface lives here.
 * Per-venue URLs are deliberately excluded — they live in the SPA.
 */
const STATIC_ENTRIES: ReadonlyArray<{
  loc: string;
  changefreq: string;
  priority: number;
}> = [
  { loc: `${PUBLIC_ORIGIN}/`, changefreq: 'weekly', priority: 1.0 },
];

export interface SitemapEntry {
  loc: string;
  lastmod?: string | null;
  changefreq?: string;
  priority?: number;
}

export function buildSitemapXml(entries: ReadonlyArray<SitemapEntry>): string {
  const urls = entries
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`    <lastmod>${entry.lastmod}</lastmod>`);
      if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
      if (typeof entry.priority === 'number') parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/**
 * Express handler for `/sitemap.xml`. Always emits a well-formed
 * sitemap with HTTP 200 + `application/xml` content type.
 *
 * The handler is pure: no DB read, no session lookup, no auth. The
 * site-level sitemap is identical on every node behind a single origin
 * — and identical to what the prerender ships to the static CDN.
 */
export function handlePlatformSitemap(_req: Request, res: Response): void {
  const xml = buildSitemapXml(STATIC_ENTRIES);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(xml);
}

// =====================================================================
// ROBOTS.TXT — platform-only policy
// =====================================================================

export function buildRobotsTxt(): string {
  return `# robots.txt — ${PUBLIC_ORIGIN}/robots.txt
#
# Public, indexable surface:
#   /                       platform landing page
# Everything else on this origin is either an authenticated console route or a
# single-table session, and no Googlebot-specific rule is needed for those: the
# app gates them behind authentication, not behind a URL.

User-agent: *
Allow: /

# Table-session capability URLs. Every parameter below carries (or accompanies)
# a per-table secret that authorises ordering on that table for a limited time,
# so these URLs must never be crawled, cached or indexed.
Disallow: /*?qr=
Disallow: /*?sessionToken=
Disallow: /*?table=
Disallow: /*?tableId=
Disallow: /*?t=

# /api/* is intentionally NOT disallowed: Googlebot must stay able to fetch it
# while rendering the SPA (blocking it would break rendering of JS-driven
# pages). API responses are JSON, never pages, and the server marks them with
# "X-Robots-Tag: noindex" instead.

Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml
`;
}

/**
 * Express handler for `/robots.txt`. The content is identical to
 * `public/robots.txt` (the prerender also ships this same string)
 * so the dynamic handler is functionally a re-emit — but mounting
 * it on the API host means a fresh Express deploy always serves the
 * correct policy, regardless of what was committed to `public/`.
 */
export function handlePlatformRobots(_req: Request, res: Response): void {
  const body = buildRobotsTxt();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(body);
}