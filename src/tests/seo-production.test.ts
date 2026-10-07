import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Release gate for crawler-facing files.
 *
 * Production symptom this locks down: https://mureehmenu.com/sitemap.xml and
 * /robots.txt used to answer with the SPA's index.html (HTTP 200, HTML) because
 * no real file existed in the published directory and the catch-all fallback
 * served the app for every path. A sitemap that is secretly the homepage is
 * worse than a missing one: Search Console reports a valid XML fetch that
 * parses as HTML and the site silently stops being discoverable.
 */
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const filePath = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

const ORIGIN = 'https://mureehmenu.com';

const sitemap = read('../../public/sitemap.xml');
const robots = read('../../public/robots.txt');
const indexHtml = read('../../index.html');

describe('crawler files are real files, published from the static directory', () => {
  it('ships sitemap.xml and robots.txt inside public/ (copied verbatim into dist/ by Vite)', () => {
    // Vite copies `publicDir` (default: public/) into the build output, which
    // is exactly what Vercel, Netlify, Render static sites, Nginx
    // (try_files $uri) and express.static(dist) serve from. A file that is not
    // in public/ never reaches production.
    expect(existsSync(filePath('../../public/sitemap.xml'))).toBe(true);
    expect(existsSync(filePath('../../public/robots.txt'))).toBe(true);
  });

  it('never lets a platform rule force-shadow the static files with index.html', () => {
    // A forced Netlify redirect ("200!") or a rewrite that runs before the
    // filesystem check would resurrect the exact bug: /sitemap.xml -> HTML.
    const netlify = read('../../netlify.toml');
    const redirects = read('../../public/_redirects');
    expect(netlify).not.toContain('200!');
    expect(redirects).not.toContain('200!');
  });
});

describe('sitemap.xml', () => {
  it('is well-formed sitemap XML', () => {
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(sitemap.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('lists the landing page on the production origin and nothing else', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${ORIGIN}/`]);
    // No duplicates.
    expect(new Set(locs).size).toBe(locs.length);
  });

  it('contains no private, authenticated, session-scoped or invented URL', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const loc of locs) {
      expect(loc.startsWith(ORIGIN)).toBe(true);
      expect(loc).not.toMatch(/localhost|127\.0\.0\.1|onrender\.com|vercel\.app|netlify\.app/i);
      expect(loc).not.toMatch(/\?(qr|table|tableId|t|sessionToken|token)=/i);
      expect(loc).not.toMatch(/\/(api|admin|dashboard|login|register|onboarding)\b/i);
      expect(loc).not.toContain('index.html');
    }
    // Structured data / markup must never leak into the URL set.
    expect(sitemap).not.toContain('<loc>#');
  });
});

describe('robots.txt', () => {
  it('allows crawling of the public surface and points at the production sitemap', () => {
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('never disallows the whole site or the assets Googlebot needs to render', () => {
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m);
    expect(robots).not.toMatch(/^Disallow:\s*\/(assets|uploads|src)/m);
    // /api/* must stay fetchable while rendering (see server X-Robots-Tag).
    expect(robots).not.toMatch(/^Disallow:\s*\/api/m);
  });

  it('keeps table-session capability URLs out of the index', () => {
    expect(robots).toContain('Disallow: /*?qr=');
    expect(robots).toContain('Disallow: /*?sessionToken=');
  });
});

describe('index.html metadata', () => {
  const canonical = `${ORIGIN}/`;

  it('declares language, direction, viewport, charset and title/description', () => {
    expect(indexHtml).toMatch(/<html lang="ar" dir="rtl">/);
    expect(indexHtml).toContain('<meta charset="UTF-8" />');
    expect(indexHtml).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />');
    expect(indexHtml).toMatch(/<title>[^<]+<\/title>/);
    expect(indexHtml).toMatch(/<meta name="description" content="[^"]+" \/>/);
  });

  it('canonicalises to the production origin, never to a preview or localhost URL', () => {
    expect(indexHtml).toContain(`<link rel="canonical" href="${canonical}" />`);
    expect(indexHtml).not.toMatch(/rel="canonical" href="[^"]*(localhost|127\.0\.0\.1|onrender\.com)/);
  });

  it('exposes crawl directives plus Open Graph / Twitter cards', () => {
    expect(indexHtml).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    expect(indexHtml).toContain('<meta property="og:type" content="website" />');
    expect(indexHtml).toContain(`<meta property="og:url" content="${canonical}" />`);
    expect(indexHtml).toMatch(/<meta property="og:title" content="[^"]+" \/>/);
    expect(indexHtml).toMatch(/<meta property="og:description" content="[^"]+" \/>/);
    expect(indexHtml).toMatch(/<meta name="twitter:card" content="(summary|summary_large_image)" \/>/);
  });

  it('embeds parseable structured data that declares no fabricated business facts', () => {
    const block = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(block).not.toBeNull();

    const jsonLd = JSON.parse(block![1]!);
    expect(jsonLd['@context']).toBe('https://schema.org');
    const nodes: Array<Record<string, unknown>> = jsonLd['@graph'];
    const types = nodes.map((node) => node['@type']);
    expect(types).toContain('WebSite');
    expect(types).toContain('Organization');

    for (const node of nodes) {
      expect(node['url']).toBe(canonical);
    }

    // No review/rating/price/contact claims that the site cannot back up.
    const raw = block![1]!;
    expect(raw).not.toMatch(/aggregateRating|"Review"|LocalBusiness|"telephone"|"address"|"priceRange"/);
  });
});

describe('server-side fallback keeps static files honest', () => {
  const server = read('../../server/index.ts');

  it('answers a missing file-like path with 404 instead of the SPA shell', () => {
    expect(server).toContain('const SPA_ASSET_FILE = /\\.[a-zA-Z0-9]+$/;');
    expect(server).toContain('if (SPA_ASSET_FILE.test(req.path))');
    // The catch-all must not unconditionally sendFile index.html anymore.
    expect(server).not.toMatch(/app\.get\('\/\{\*splat\}',\s*\(_req, res\)\s*=>\s*\{\s*res\.sendFile/);
  });

  it('keeps SPA routing intact for extension-less app routes', () => {
    // The fallback still serves the shell for "/" and "/r/{slug}".
    expect(server).toContain("app.get('/{*splat}'");
    expect(server).toContain("'index.html'");
  });

  it('marks API responses noindex without blocking Googlebot from fetching them', () => {
    expect(server).toContain("res.setHeader('X-Robots-Tag', 'noindex');");
  });
});
