/**
 * Mureeh Menu — SEO release gate (static sources).
 *
 * Locks down the shape of the SEO surface at the source level:
 *   - index.html declares canonical / robots / OG / Twitter / JSON-LD
 *     and the right @graph types (WebSite, Organization,
 *     SoftwareApplication, Service, FAQPage), wrapped in the
 *     `seo:head` markers the server swaps per public page.
 *   - The JSON-LD never fabricates reviews, ratings, addresses, or
 *     phone numbers; the FAQPage mirrors the landing page's FAQ list.
 *   - server/index.ts mounts /sitemap.xml, /robots.txt, /api/og, the
 *     venue page and the directory BEFORE the static fallback, and turns
 *     unknown app routes into honest 404s.
 *   - server/seo/platformSeo.ts stays Prisma-free; database reads for the
 *     public pages live only in server/seo/publicCatalog.ts.
 *   - server/seo/ogImage.ts whitelists only the `platform` type.
 *
 * Behavioural coverage (HTTP status codes, rendered head, sitemap content)
 * lives in seo-public-pages.test.ts.
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
const catalogSource = read('../../server/seo/publicCatalog.ts');
const pagesSource = read('../../server/seo/publicPages.ts');
const handlersSource = read('../../server/seo/publicHandlers.ts');
const landingSource = read('../../src/components/common/SaaSLandingPage.tsx');
const customerLayoutSource = read('../../src/components/customer/CustomerLayout.tsx');

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

  it('wraps every SEO tag in the seo:head markers the server swaps per public page', () => {
    const start = indexHtml.indexOf('<!-- seo:head:start -->');
    const end = indexHtml.indexOf('<!-- seo:head:end -->');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const inside = indexHtml.slice(start, end);
    const outside = indexHtml.slice(0, start) + indexHtml.slice(end);
    for (const tag of ['<title>', 'name="description"', 'rel="canonical"', 'name="robots"', 'property="og:', 'name="twitter:', 'application/ld+json']) {
      expect(inside, tag).toContain(tag);
      expect(outside, tag).not.toContain(tag);
    }
  });

  it('targets the product intent (digital / QR menu) in title and description, in Arabic only', () => {
    const title = indexHtml.match(/<title>([^<]+)<\/title>/)![1]!;
    const description = indexHtml.match(/<meta name="description" content="([^"]+)" \/>/)![1]!;
    expect(title).toMatch(/منيو/);
    expect(title).toMatch(/QR/);
    expect(title.length).toBeLessThanOrEqual(70);
    expect(description).toMatch(/منيو إلكتروني/);
    expect(description.length).toBeLessThanOrEqual(170);
    // Same title/description on OG and Twitter — no mixed messages.
    expect(indexHtml).toContain(`<meta property="og:title" content="${title}" />`);
    expect(indexHtml).toContain(`<meta name="twitter:title" content="${title}" />`);
    expect(indexHtml).toContain(`<meta property="og:description" content="${description}" />`);
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

  it('FAQPage mirrors the landing page FAQ list verbatim (structured data must match visible content)', () => {
    // Google's structured-data policy: markup must describe content the user
    // can see. The landing page renders `FAQS` (q/a pairs); the JSON-LD must
    // carry exactly those pairs — same count, same order, same text.
    const faqBlock = landingSource.match(/const FAQS = \[([\s\S]*?)\n\];/);
    expect(faqBlock).not.toBeNull();
    const visible = Array.from(
      faqBlock![1]!.matchAll(/q:\s*'((?:[^'\\]|\\.)*)',\s*\n\s*a:\s*'((?:[^'\\]|\\.)*)'/g),
      (m) => ({ q: m[1]!.replace(/\\'/g, "'"), a: m[2]!.replace(/\\'/g, "'") })
    );
    expect(visible.length).toBeGreaterThanOrEqual(3);

    const faqPage = nodes.find((n) => n['@type'] === 'FAQPage') as any;
    const declared = (faqPage.mainEntity as any[]).map((e) => ({ q: e.name, a: e.acceptedAnswer.text }));
    expect(declared).toEqual(visible);
  });
});

describe('index.html — social card asset', () => {
  const ogPng = filePath('../../public/og-image.png');

  it('og:image is a real PNG shipped from public/, declared directly (no redirect hop)', () => {
    expect(indexHtml).toContain(`<meta property="og:image" content="${ORIGIN}/og-image.png" />`);
    expect(indexHtml).toContain(`<meta name="twitter:image" content="${ORIGIN}/og-image.png" />`);
    expect(indexHtml).toContain('<meta property="og:image:type" content="image/png" />');
    expect(indexHtml).toMatch(/<meta property="og:image:alt" content="[^"]+" \/>/);
    expect(existsSync(ogPng)).toBe(true);
  });

  it('the declared og:image:width/height are the actual pixel dimensions of the file', () => {
    const bytes = readFileSync(ogPng);
    // PNG signature + IHDR (width/height are big-endian u32 at offsets 16/20).
    expect(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(indexHtml).toContain(`<meta property="og:image:width" content="${width}" />`);
    expect(indexHtml).toContain(`<meta property="og:image:height" content="${height}" />`);
    expect([width, height]).toEqual([1200, 630]);
  });

  it('stays under the preview-size limit of messaging apps (WhatsApp rejects large og:images)', () => {
    expect(readFileSync(ogPng).byteLength).toBeLessThan(300 * 1024);
  });

  it('the server-side fallbacks (venue without imagery, directory, error shells) point at the same file', () => {
    expect(ogImageSource).toMatch(/PLATFORM_OG_IMAGE_PATH\s*=\s*'\/og-image\.png'/);
    expect(pagesSource).toContain("import { PLATFORM_OG_IMAGE_PATH } from './ogImage'");
    expect(pagesSource).toMatch(/PLATFORM_OG_IMAGE\s*=\s*`\$\{PUBLIC_ORIGIN\}\$\{PLATFORM_OG_IMAGE_PATH\}`/);
  });
});

describe('server/index.ts — routes and ordering', () => {
  it('imports the SEO handlers from server/seo/', () => {
    expect(serverSource).toMatch(/from ['"]\.\/seo\/(platformSeo|ogImage)['"]/);
    expect(serverSource).toMatch(/from ['"]\.\/seo\/publicHandlers['"]/);
  });

  it('registers /sitemap.xml, /robots.txt, /api/og, /restaurants and /r/:slug BEFORE the static fallback', () => {
    const staticIndex = serverSource.indexOf('express.static(frontendDistPath');
    expect(staticIndex).toBeGreaterThan(-1);
    for (const mount of ["app.get('/sitemap.xml'", "app.get('/robots.txt'", "app.get('/api/og'", "app.get('/restaurants'", "app.get('/r/:slug'"]) {
      const index = serverSource.indexOf(mount);
      expect(index, mount).toBeGreaterThan(-1);
      expect(index, mount).toBeLessThan(staticIndex);
    }
    // The database-backed sitemap replaced the platform-only one.
    expect(serverSource).toContain("app.get('/sitemap.xml', handleSitemap)");
    expect(serverSource).not.toContain('handlePlatformSitemap');
  });

  it('canonicalises the host (onrender.com alias → public origin) before any page handler', () => {
    const redirectIndex = serverSource.indexOf('app.use(handleCanonicalHostRedirect)');
    expect(redirectIndex).toBeGreaterThan(-1);
    expect(redirectIndex).toBeLessThan(serverSource.indexOf("app.get('/sitemap.xml'"));
  });

  it('keeps the /r/{slug} APPLICATION route on the SPA shell (the venue handler injects into it)', () => {
    expect(serverSource).toContain("app.get('/{*splat}'");
    expect(serverSource).toMatch(/\/r\/\{slug\}/);
    expect(serverSource).toContain("configurePublicPages({ shellPath: path.join(frontendDistPath, 'index.html') })");
  });

  it('preserves the SPA fallback for "/" and turns other unknown app routes into honest 404s', () => {
    expect(serverSource).toContain("app.get('/{*splat}'");
    expect(serverSource).toContain("'index.html'");
    expect(serverSource).toMatch(/if \(req\.path !== '\/'\) \{\s*handleUnknownAppRoute\(req, res, next\);/);
    // Missing FILES stay machine-readable JSON 404s.
    expect(serverSource).toContain('const SPA_ASSET_FILE = /\\.[a-zA-Z0-9]+$/;');
    expect(serverSource).toContain('if (SPA_ASSET_FILE.test(req.path))');
  });
});

describe('server/seo/ — module boundaries', () => {
  it('platformSeo.ts stays Prisma-free; database reads live only in publicCatalog.ts', () => {
    expect(seoSource).not.toMatch(/from ['"]\.\.\/db\/prisma['"]/);
    expect(pagesSource).not.toMatch(/from ['"]\.\.\/db\/prisma['"]/);
    expect(handlersSource).not.toMatch(/from ['"]\.\.\/db\/prisma['"]/);
    expect(catalogSource).toMatch(/from ['"]\.\.\/db\/prisma['"]/);
  });

  it('publicCatalog only reads, and only public columns', () => {
    expect(catalogSource).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|executeRaw|queryRaw)/);
    for (const forbidden of ['qrToken', 'sessionToken', 'passwordHash', 'ownerEmail', 'transferAccount', 'order:', 'tables:']) {
      expect(catalogSource, forbidden).not.toContain(forbidden);
    }
  });

  it('serves the same HTML to every client — no user-agent detection anywhere in the SEO layer', () => {
    for (const source of [seoSource, catalogSource, pagesSource, handlersSource, serverSource]) {
      expect(source).not.toMatch(/req\.(get|header)\(\s*['"]user-agent['"]\s*\)|headers\[\s*['"]user-agent['"]\s*\]|\/googlebot\/i|isbot\(/i);
    }
  });

  it('never fabricates venue facts in structured data', () => {
    expect(pagesSource).not.toMatch(/aggregateRating|ratingValue|reviewCount|openingHours|priceRange/);
  });
});

describe('server/seo/platformSeo.ts — origin + sitemap primitives', () => {
  it('declares the production origin with an APP_URL escape hatch', () => {
    expect(seoSource).toMatch(/PRODUCTION_ORIGIN\s*=\s*['"]https:\/\/mureehmenu\.com['"]/);
  });

  it('static sitemap entries hold the platform landing only; venue entries come from the database at request time', () => {
    expect(seoSource).toContain('STATIC_ENTRIES');
    const arrMatch = seoSource.match(/STATIC_ENTRIES[\s\S]*?=\s*\[([\s\S]*?)\];/);
    expect(arrMatch).not.toBeNull();
    expect(arrMatch![1]).not.toMatch(/\/r\//);
    expect(arrMatch![1]).toMatch(/PUBLIC_ORIGIN\}/);
    expect(handlersSource).toContain('listPublishableVenues()');
    expect(handlersSource).toMatch(/canonicalUrl\(`\/r\/\$\{venue\.slug\}`\)/);
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

describe('crawlable paths into the venue pages', () => {
  it('the landing page links to /r/{slug} and /restaurants with plain anchors', () => {
    expect(landingSource).toMatch(/href=\{`\/r\/\$\{encodeURIComponent\(r\.slug\)\}`\}/);
    expect(landingSource).toContain('href="/restaurants"');
  });

  it('the landing page states what the product is, for whom, the problem and how it works, in plain text', () => {
    // A definition block (not a tagline) that a first-time visitor or a
    // crawler can read: section with its own heading, three Q-style points,
    // and crawlable links onward (directory, pricing).
    expect(landingSource).toMatch(/<section id="about" aria-labelledby="about-title"/);
    expect(landingSource).toMatch(/<h2 id="about-title"[^>]*>\s*منصة منيو إلكتروني QR للمطاعم والكافيهات/);
    expect(landingSource).toContain('(Mureeh Menu)');
    const points = landingSource.match(/const ABOUT_POINTS = \[([\s\S]*?)\n\];/);
    expect(points).not.toBeNull();
    const titles = Array.from(points![1]!.matchAll(/title:\s*'([^']+)'/g), (m) => m[1]);
    expect(titles).toEqual(['لمن صُمّم مُريح؟', 'ما المشكلة التي يحلّها؟', 'كيف يعمل المنيو الرقمي؟']);
    // The about block links to the directory and to pricing with real anchors.
    const about = landingSource.slice(landingSource.indexOf('<section id="about"'), landingSource.indexOf('<section id="how"'));
    expect(about).toContain('href="/restaurants"');
    expect(about).toContain('href="#pricing"');
    // And it is reachable from the site navigation.
    expect(landingSource).toMatch(/\{ href: '#about', label: '[^']+' \}/);
  });

  it('the customer shell no longer dead-ends a bare /r/{slug} visit behind a QR gate', () => {
    expect(customerLayoutSource).not.toContain('هذا الرابط غير صالح للدخول المباشر');
    expect(customerLayoutSource).not.toMatch(/isPublicRoute && !activeTableId/);
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

  it('lists only the platform landing page (venues are enumerated by the server at request time)', () => {
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

  it('excludes every session parameter in any position (robots patterns are literal: "?qr=" ≠ "&qr=")', () => {
    for (const key of ['qr', 'sessionToken', 'table', 'tableId', 't']) {
      expect(robots).toContain(`Disallow: /*?${key}=`);
      expect(robots).toContain(`Disallow: /*&${key}=`);
    }
    // The public-image path and the social card are never blocked.
    expect(robots).not.toMatch(/^Disallow:\s*\/og-image/m);
  });

  it('is byte-identical to what the production server emits for /robots.txt', async () => {
    // platformSeo.ts is Prisma-free, so it can be imported here. Both files
    // must carry the same policy: the static one is the fallback for static
    // hosts, the generated one is what mureehmenu.com actually serves.
    const { buildRobotsTxt, PUBLIC_ORIGIN } = await import('../../server/seo/platformSeo');
    expect(PUBLIC_ORIGIN).toBe(ORIGIN);
    expect(buildRobotsTxt()).toBe(robots);
  });
});

describe('deployment architecture', () => {
  it('render.yaml still describes both services (node API + optional static frontend)', () => {
    expect(renderYaml).toContain('restaurant-api');
    expect(renderYaml).toContain('restaurant-frontend');
  });

  it('static frontend rewrites every path to /index.html by default', () => {
    // On a static-only host there is no server to render the venue head;
    // the production site (mureehmenu.com) is served by the node service,
    // which is where the SEO handlers run. The static files remain a
    // degraded fallback, never the primary surface.
    expect(renderYaml).toMatch(/destination:\s*\/index\.html/);
  });
});