/**
 * Mureeh Menu — platform-level SEO release gate.
 *
 * Locks down the platform SEO surface:
 *   - index.html declares canonical / robots / OG / Twitter / JSON-LD
 *     and the right @graph types (WebSite, Organization,
 *     SoftwareApplication, Service, FAQPage).
 *   - The JSON-LD never fabricates reviews, ratings, addresses, or
 *     phone numbers.
 *   - server/index.ts mounts the dynamic /sitemap.xml, /robots.txt
 *     and /api/og handlers BEFORE the SPA fallback.
 *   - server/seo/platformSeo.ts is the platform-only SEO engine — no
 *     per-venue code.
 *   - server/seo/ogImage.ts whitelists only the `platform` type and
 *     never serves a non-200 page.
 *
 * This test is intentionally tight on the "platform only" boundary:
 * any future PR that re-introduces per-venue indexing inside the
 * SEO engine will trip at least one of these assertions.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const filePath = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

const ORIGIN = 'https://mureehmenu.com';

const indexHtml = read('../../index.html');
const serverSource = read('../../server/index.ts');
const seoSource = read('../../server/seo/platformSeo.ts');
const ogImageSource = read('../../server/seo/ogImage.ts');
const sitemapXml = read('../../public/sitemap.xml');
const robots = read('../../public/robots.txt');
const renderYaml = read('../../render.yaml');

describe('index.html — platform metadata', () => {
  it('declares language, direction, viewport, charset and title/description', () => {
    expect(indexHtml).toMatch(/<html lang="ar" dir="rtl">/);
    expect(indexHtml).toContain('<meta charset="UTF-8" />');
    expect(indexHtml).toContain('<meta name="viewport"');
    expect(indexHtml).toMatch(/<title>[^<]+<\/title>/);
    expect(indexHtml).toMatch(/<meta name="description" content="[^"]+" \/>/);
  });

  it('canonicalises to the production origin, never a preview or localhost URL', () => {
    expect(indexHtml).toContain(`<link rel="canonical" href="${ORIGIN}/" />`);
    expect(indexHtml).not.toMatch(/rel="canonical" href="[^"]*(localhost|127\.0\.0\.1|onrender\.com)/);
  });

  it('exposes crawl directives plus Open Graph / Twitter cards with a real social image', () => {
    expect(indexHtml).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    expect(indexHtml).toContain('<meta property="og:type" content="website" />');
    expect(indexHtml).toContain(`<meta property="og:url" content="${ORIGIN}/" />`);
    expect(indexHtml).toMatch(/<meta property="og:title" content="[^"]+" \/>/);
    expect(indexHtml).toMatch(/<meta property="og:description" content="[^"]+" \/>/);
    // OG image must point at a stable URL on the platform origin
    // (the dynamic /api/og redirector is fine).
    expect(indexHtml).toMatch(/<meta property="og:image" content="https:\/\/mureehmenu\.com\/[^"]+" \/>/);
    expect(indexHtml).toContain('<meta property="og:image:width" content="1200" />');
    expect(indexHtml).toContain('<meta property="og:image:height" content="630" />');
    expect(indexHtml).toMatch(/<meta name="twitter:card" content="(summary|summary_large_image)" \/>/);
  });
});

describe('index.html — structured data (platform @graph)', () => {
  const block = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(block).not.toBeNull();
  const jsonLd = JSON.parse(block![1]!);
  const nodes: Array<Record<string, unknown>> = jsonLd['@graph'];
  const types = nodes.map((node) => node['@type']);

  it('declares WebSite + Organization + SoftwareApplication + Service + FAQPage', () => {
    expect(types).toContain('WebSite');
    expect(types).toContain('Organization');
    expect(types).toContain('SoftwareApplication');
    expect(types).toContain('Service');
    expect(types).toContain('FAQPage');
  });

  it('never invents reviews, ratings, addresses or business phone numbers', () => {
    const raw = block![1]!;
    expect(raw).not.toMatch(/aggregateRating|\"Review\"|LocalBusiness|\"telephone\"|\"address\"|\"priceRange\"/);
  });

  it('SoftwareApplication declares applicationCategory and a real description', () => {
    const sa = nodes.find((n) => n['@type'] === 'SoftwareApplication') as any;
    expect(sa).toBeDefined();
    expect(sa.applicationCategory).toBe('BusinessApplication');
    expect(typeof sa.description).toBe('string');
    expect(sa.description.length).toBeGreaterThan(20);
  });

  it('Service node references the Organization via @id', () => {
    const svc = nodes.find((n) => n['@type'] === 'Service') as any;
    expect(svc).toBeDefined();
    expect(svc.provider?.['@id']).toBe(`${ORIGIN}/#organization`);
    expect(typeof svc.name).toBe('string');
    expect(svc.name.length).toBeGreaterThan(0);
    // serviceType is the canonical machine-readable declaration that
    // Google's knowledge graph uses to attach a Service to its topics.
    expect(typeof svc.serviceType).toBe('string');
  });

  it('FAQPage content must actually be declared when the type is in the graph', () => {
    const faqPage = nodes.find((n) => n['@type'] === 'FAQPage') as any;
    expect(faqPage).toBeDefined();
    const entries = Array.isArray(faqPage?.mainEntity) ? faqPage.mainEntity : [];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry['@type']).toBe('Question');
      expect(typeof entry.name).toBe('string');
      expect(entry.acceptedAnswer?.['@type']).toBe('Answer');
      expect(typeof entry.acceptedAnswer?.text).toBe('string');
    }
  });
});

describe('server/index.ts — routes and ordering', () => {
  it('imports the platform SEO handlers from server/seo/', () => {
    expect(serverSource).toMatch(/from ['"]\.\/seo\/(platformSeo|ogImage)['"]/);
  });

  it('registers /sitemap.xml, /robots.txt and /api/og BEFORE the static fallback', () => {
    const sitemapIndex = serverSource.indexOf("app.get('/sitemap.xml'");
    const staticIndex = serverSource.indexOf('express.static(frontendDistPath');
    expect(sitemapIndex).toBeGreaterThan(-1);
    expect(staticIndex).toBeGreaterThan(-1);
    expect(sitemapIndex).toBeLessThan(staticIndex);
  });

  it('never imports or mounts per-venue SEO handlers', () => {
    // PLATFORM ONLY: there must be no /r/{slug} SEO handler, no
    // /restaurants SEO handler, and no per-venue renderer in scope.
    expect(serverSource).not.toMatch(/handleRestaurantSEO|handleRestaurantsIndex/);
    expect(serverSource).not.toMatch(/seoPure|seoRender\.ts/);
  });

  it('preserves the /r/{slug} APPLICATION route (SPA fallback for human guests)', () => {
    // The /r/{slug} route is the customer-facing menu surface — it must
    // still fall through to the SPA shell. SEO infrastructure for it was
    // removed, but the route itself stays.
    expect(serverSource).toContain("app.get('/{*splat}'");
    expect(serverSource).toMatch(/\/r\/\{slug\}/);
  });

  it('preserves the SPA fallback for extension-less routes', () => {
    expect(serverSource).toContain("app.get('/{*splat}'");
    expect(serverSource).toContain("'index.html'");
  });
});

describe('server/seo/platformSeo.ts — platform-only engine', () => {
  it('declares the production origin with an APP_URL escape hatch', () => {
    expect(seoSource).toMatch(/PRODUCTION_ORIGIN\s*=\s*['"]https:\/\/mureehmenu\.com['"]/);
  });

  it('sitemap enumerator lists the platform landing page only (no per-venue entries)', () => {
    expect(seoSource).toContain('STATIC_ENTRIES');
    // Extract the array and confirm there are no /r/ paths inside it.
    const arrMatch = seoSource.match(/STATIC_ENTRIES[\s\S]*?=\s*\[([\s\S]*?)\];/);
    expect(arrMatch).not.toBeNull();
    expect(arrMatch![1]).not.toMatch(/\/r\//);
    // The platform landing is the only entry — built from PUBLIC_ORIGIN
    // (which falls back to mureehmenu.com when APP_URL is unset).
    expect(arrMatch![1]).toMatch(/PUBLIC_ORIGIN\}/);
    // And the production origin constant is what PUBLIC_ORIGIN resolves
    // to in production (defence in depth — the literal must exist).
    expect(seoSource).toMatch(/PRODUCTION_ORIGIN\s*=\s*['"]https:\/\/mureehmenu\.com['"]/);
  });

  it('robots.txt disallows session query strings and points at the production sitemap', () => {
    expect(seoSource).toMatch(/Disallow:\s*\/\*\?qr=/);
    expect(seoSource).toMatch(/Disallow:\s*\/\*\?sessionToken=/);
    expect(seoSource).toMatch(/Disallow:\s*\/\*\?table=/);
    expect(seoSource).toMatch(/Disallow:\s*\/\*\?tableId=/);
    expect(seoSource).toMatch(/Disallow:\s*\/\*\?t=/);
    // Sitemap URL is interpolated from PUBLIC_ORIGIN; the production
    // origin constant must still be the literal mureehmenu.com.
    expect(seoSource).toMatch(/Sitemap:\s*\$\{PUBLIC_ORIGIN\}\/sitemap\.xml/);
    expect(seoSource).toMatch(/PRODUCTION_ORIGIN\s*=\s*['"]https:\/\/mureehmenu\.com['"]/);
  });

  it('sitemap XML escapes values (defence in depth against malformed entries)', () => {
    expect(seoSource).toContain('escapeXml(');
  });
});

describe('server/seo/ogImage.ts — platform-only redirector', () => {
  it('whitelists only the `platform` type', () => {
    expect(ogImageSource).toContain('ALLOWED_TYPES');
    expect(ogImageSource).toContain("'platform'");
    // Explicitly no per-venue type.
    expect(ogImageSource).not.toMatch(/'restaurant'/);
  });

  it('always returns a 302 redirect and sets X-Robots-Tag: noindex', () => {
    expect(ogImageSource).toContain("res.redirect(302");
    expect(ogImageSource).toContain("res.setHeader('X-Robots-Tag', 'noindex')");
  });
});

describe('public/sitemap.xml (build artefact fallback)', () => {
  it('ships in the public directory (Vite copies it to dist/)', () => {
    expect(existsSync(filePath('../../public/sitemap.xml'))).toBe(true);
  });

  it('is a well-formed sitemap XML', () => {
    expect(sitemapXml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(sitemapXml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(sitemapXml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('lists only the platform landing page', () => {
    const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${ORIGIN}/`]);
  });

  it('never leaks a private or query-tokenised URL', () => {
    const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const loc of locs) {
      expect(loc.startsWith(ORIGIN)).toBe(true);
      expect(loc).not.toMatch(/localhost|127\.0\.0\.1|onrender\.com|vercel\.app|netlify\.app/i);
      expect(loc).not.toMatch(/\?(qr|table|tableId|t|sessionToken|token)=/i);
      expect(loc).not.toMatch(/\/(api|admin|dashboard|login|register|onboarding|r\/)\b/i);
    }
  });
});

describe('public/robots.txt', () => {
  it('allows the public surface and points at the production sitemap', () => {
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('keeps table-session capability URLs out of the index', () => {
    expect(robots).toContain('Disallow: /*?qr=');
    expect(robots).toContain('Disallow: /*?sessionToken=');
    expect(robots).toContain('Disallow: /*?table=');
    expect(robots).toContain('Disallow: /*?tableId=');
    expect(robots).toContain('Disallow: /*?t=');
  });

  it('never disallows the whole site or the assets Googlebot needs to render', () => {
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m);
    expect(robots).not.toMatch(/^Disallow:\s*\/(assets|uploads|src)/m);
    expect(robots).not.toMatch(/^Disallow:\s*\/api/m);
  });
});

describe('deployment architecture', () => {
  it('ships two services — node API + static frontend', () => {
    expect(renderYaml).toContain('restaurant-api');
    expect(renderYaml).toContain('restaurant-frontend');
  });

  it('static frontend rewrites every path to /index.html by default', () => {
    // The reason the platform SEO engine owns /sitemap.xml and
    // /robots.txt at runtime: Render's static service applies this
    // rewrite to non-existent paths.
    expect(renderYaml).toMatch(/destination:\s*\/index\.html/);
  });
});