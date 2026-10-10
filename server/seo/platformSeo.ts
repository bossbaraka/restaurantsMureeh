/**
 * Mureeh Menu — platform-level SEO primitives.
 *
 * Scope
 * =====
 * This module owns the parts of the SEO surface that do not depend on the
 * database: the public origin, URL canonicalisation, XML escaping, the
 * sitemap serialiser, the platform (homepage) sitemap entries and
 * robots.txt. It is Prisma-free on purpose so it can be imported by tests,
 * scripts and the production server alike.
 *
 * Per-venue pages (`/r/{slug}`), the public directory (`/restaurants`) and
 * the database-backed sitemap live next door:
 *
 *   publicCatalog.ts   — the single read path into Prisma (ACTIVE venues,
 *                        ACTIVE categories, available products) + policy
 *   publicPages.ts     — pure HTML renderers (head, JSON-LD, snapshot)
 *   publicHandlers.ts  — the Express handlers mounted in server/index.ts
 *
 * The public surface of the origin is therefore:
 *
 *   /                        — the SaaS landing page (index)
 *   /restaurants             — public directory of published venues (index)
 *   /r/{slug}                — a venue's public digital menu (index when
 *                              ACTIVE and non-empty, otherwise noindex)
 *
 * Table-session URLs (`/r/{slug}?qr=…`) are the same venue page with a
 * per-table capability token; they canonicalise to `/r/{slug}` and are
 * additionally disallowed in robots.txt so the token is never crawled.
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
// SITEMAP
// =====================================================================

/**
 * Entries that exist independently of any database read.
 *
 * The platform landing is the only one: `/restaurants` and `/r/{slug}` are
 * appended by `publicHandlers.ts` from live rows, so a venue that is
 * suspended or emptied disappears from the sitemap on the next request
 * instead of lingering in a static list. These entries are also what the
 * sitemap degrades to when the database is unreachable.
 */
export interface SitemapEntry {
  loc: string;
  /** W3C datetime (ISO-8601); only ever derived from a real `updatedAt`. */
  lastmod?: string | null;
  changefreq?: string;
  priority?: number;
}

export const STATIC_ENTRIES: ReadonlyArray<SitemapEntry> = [
  { loc: `${PUBLIC_ORIGIN}/` },
];

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
 * Platform-only `/sitemap.xml` (no database read). Kept as the degraded
 * fallback used by `publicHandlers.handleSitemap` and for static hosts;
 * the production server mounts the database-backed handler instead.
 */
export function handlePlatformSitemap(_req: Request, res: Response): void {
  const xml = buildSitemapXml(STATIC_ENTRIES);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(xml);
}

// =====================================================================
// ROBOTS.TXT
// =====================================================================

export function buildRobotsTxt(): string {
  return `# robots.txt — ${PUBLIC_ORIGIN}/robots.txt
#
# Public, indexable surface:
#   /                       platform landing page
#   /restaurants            public directory of published venues
#   /r/{slug}               a venue's public digital menu
# Console/admin screens are not URLs on this origin (the app gates them behind
# authentication, not behind a path), so no Disallow rule is needed for them.

User-agent: *
Allow: /

# Table-session capability URLs. Every parameter below carries (or accompanies)
# a per-table secret that authorises ordering on that table for a limited time,
# so these URLs must never be crawled, cached or indexed. Each parameter is
# listed twice because a robots.txt pattern is literal: "/*?qr=" only matches
# the token in FIRST position, "/*&qr=" covers it after another parameter
# (e.g. a tracking tag added to a shared QR link).
Disallow: /*?qr=
Disallow: /*&qr=
Disallow: /*?sessionToken=
Disallow: /*&sessionToken=
Disallow: /*?table=
Disallow: /*&table=
Disallow: /*?tableId=
Disallow: /*&tableId=
Disallow: /*?t=
Disallow: /*&t=

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