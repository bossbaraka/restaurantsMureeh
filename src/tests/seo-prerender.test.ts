/**
 * Release gate for the landing-page prerender.
 *
 * The platform is a client-side SPA: without this mirror, a
 * crawler that never executes JavaScript receives an empty
 * <div id="root"></div> and the site cannot rank for any
 * restaurant keyword. These tests lock down:
 *
 *   - the injection is surgical (only #root is touched) and
 *     idempotent (never nests when run twice),
 *   - the mirror carries the page's real marketing copy
 *     (hero H1, section anchors, FAQ texts) so crawlers see
 *     the same words users do,
 *   - the build pipeline actually runs the prerender step,
 *   - the Express runtime mounts the GET / handler before
 *     the static/SPA fallback,
 *   - Tailwind compiles the mirror's classes (the module is
 *     registered in tailwind.config.js content globs).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  LANDING_ROOT_HTML,
  PRERENDER_MARKER,
  isPrerendered,
  prerenderSpaShell,
} from '../../server/seo/landingPrerender';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const filePath = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

const SHELL = `<!doctype html>
<html lang="ar" dir="rtl">
  <head><title>shell</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

describe('prerenderSpaShell — injection mechanics', () => {
  it('places the mirror inside #root and keeps the rest of the shell intact', () => {
    const out = prerenderSpaShell(SHELL);
    expect(out).toContain('<div id="root">' + PRERENDER_MARKER);
    expect(out).toContain('</div>\n    <script type="module"');
    expect(out).toContain('<title>shell</title>');
    expect(out.startsWith('<!doctype html>')).toBe(true);
  });

  it('is idempotent — a second pass never nests content', () => {
    const once = prerenderSpaShell(SHELL);
    const twice = prerenderSpaShell(once);
    expect(twice).toBe(once);
    expect(isPrerendered(once)).toBe(true);
  });

  it('returns the shell untouched when the mount point is missing', () => {
    const weird = SHELL.replace('<div id="root"></div>', '<div id="app"></div>');
    expect(prerenderSpaShell(weird)).toBe(weird);
  });

  it('carries the full landing mirror, not a stub', () => {
    // The mirror must be substantial — a thin stub would not
    // move search rankings for restaurant keywords.
    expect(LANDING_ROOT_HTML.length).toBeGreaterThan(8000);
  });
});

describe('prerendered content — mirrors the live landing page', () => {
  it('keeps the hero H1 and its core promise', () => {
    expect(LANDING_ROOT_HTML).toContain('<h1 id="hero-title"');
    expect(LANDING_ROOT_HTML).toContain('رمز QR واحد');
    expect(LANDING_ROOT_HTML).toContain('منيو رقمي');
  });

  it('exposes the same section anchors the SPA navigation links to', () => {
    for (const anchor of ['how', 'features', 'video', 'showcase', 'roi', 'pricing', 'faq', 'contact']) {
      expect(LANDING_ROOT_HTML).toContain(`id="${anchor}"`);
    }
  });

  it('declares FAQ items verbatim with the JSON-LD FAQPage in index.html', () => {
    const indexHtml = read('../../index.html');
    const faqBlock = indexHtml.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    expect(faqBlock).not.toBeNull();
    const jsonLd = JSON.parse(faqBlock![1]!);
    const faqPage = jsonLd['@graph'].find(
      (node: { '@type': string }) => node['@type'] === 'FAQPage',
    );
    for (const entry of faqPage.mainEntity) {
      // Structured data must match visible copy — the mirror
      // carries the same question and answer text.
      expect(LANDING_ROOT_HTML).toContain(entry.name);
      expect(LANDING_ROOT_HTML).toContain(entry.acceptedAnswer.text);
    }
  });

  it('covers the platform keyword surface a restaurant owner searches for', () => {
    const keywords = [
      'إدارة المطاعم',
      'شاشة مطبخ',
      'نقطة بيع',
      'كاشير',
      'استدعاء النادل',
      'تحليلات',
      'مبيعات',
      'فواتير',
      'مقهى',
    ];
    for (const keyword of keywords) {
      expect(LANDING_ROOT_HTML).toContain(keyword);
    }
  });

  it('uses semantic structure crawlers can parse (headings, lists, details)', () => {
    expect(LANDING_ROOT_HTML).toMatch(/<h2 id="features-title"/);
    expect(LANDING_ROOT_HTML).toMatch(/<h3[^>]*>شاشة مطبخ حيّة/);
    expect(LANDING_ROOT_HTML).toMatch(/<details/);
    expect(LANDING_ROOT_HTML).toMatch(/<summary/);
    expect(LANDING_ROOT_HTML).toMatch(/<footer id="contact"/);
  });

  it('links the Telegram sales contact the live page uses', () => {
    expect(LANDING_ROOT_HTML).toContain('https://t.me/Mureeh_tech_bot');
    expect(LANDING_ROOT_HTML).toContain('@Mureeh_tech_bot');
  });

  it('declares no fabricated business facts (reviews, ratings, address, phone)', () => {
    expect(LANDING_ROOT_HTML).not.toMatch(/aggregateRating|تقييم 4\.5|رقم الهاتف|هاتف:\s*\d/);
  });
});

describe('build + serve pipeline', () => {
  it('runs the prerender script as part of npm run build', () => {
    const pkg = JSON.parse(read('../../package.json'));
    expect(pkg.scripts.build).toContain('server/scripts/prerender.ts');
    expect(pkg.scripts.build).toContain('vite build');
    // The prerender must run AFTER the vite build, not before.
    expect(pkg.scripts.build.indexOf('vite build')).toBeLessThan(
      pkg.scripts.build.indexOf('server/scripts/prerender.ts'),
    );
  });

  it('ships the prerender script in the repo', () => {
    expect(existsSync(filePath('../../server/scripts/prerender.ts'))).toBe(true);
  });

  it('mounts the runtime GET / handler in server/index.ts with the SEO surface', () => {
    const serverSource = read('../../server/index.ts');
    expect(serverSource).toContain("from './seo/landingPrerender'");
    expect(serverSource).toContain("app.get('/', handlePrerenderedLanding)");
    // Mounted before the static assets and the SPA fallback so
    // the crawler-facing HTML wins over the empty shell.
    const landingIndex = serverSource.indexOf("app.get('/', handlePrerenderedLanding)");
    const staticIndex = serverSource.indexOf('express.static(frontendDistPath');
    expect(landingIndex).toBeGreaterThan(-1);
    expect(staticIndex).toBeGreaterThan(-1);
    expect(landingIndex).toBeLessThan(staticIndex);
  });

  it('registers the prerender module with Tailwind so its classes compile', () => {
    const tailwind = read('../../tailwind.config.js');
    expect(tailwind).toContain('./server/seo/**/*.ts');
  });
});
