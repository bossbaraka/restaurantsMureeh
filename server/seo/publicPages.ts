/**
 * Mureeh Menu — public page HTML (pure).
 *
 * Renders the HTML that is sent to EVERY client — browsers and crawlers
 * alike — for the public venue pages (`/r/{slug}`), the public directory
 * (`/restaurants`) and the error shells. There is no user-agent switch
 * anywhere: the same bytes go to a guest and to Googlebot, which is what
 * keeps this on the right side of Google's dynamic-rendering guidance.
 *
 * How a venue page is built
 * =========================
 * The production shell (`dist/index.html`, built by Vite) is used as the
 * template so the SPA keeps its exact assets and bootstrap script. Two
 * regions are replaced per request:
 *
 *   1. `<head>` — everything between the `<!-- seo:head:start -->` and
 *      `<!-- seo:head:end -->` markers (title, description, canonical,
 *      robots, Open Graph, Twitter, JSON-LD) is swapped for venue-specific
 *      metadata, and `<html lang dir>` follows the venue language.
 *   2. `#root` — a server-rendered, semantic snapshot of the menu (name,
 *      description, contact line, categories, dishes, prices) is placed
 *      inside the React root. It is real content for the first paint and
 *      for crawlers that do not execute JavaScript; React replaces it when
 *      the application mounts and renders the same menu interactively.
 *
 * Nothing in this module reads the database, the environment or the file
 * system; every function is deterministic given its inputs.
 */

import { PUBLIC_ORIGIN, canonicalUrl } from './platformSeo';
import { PLATFORM_OG_IMAGE_PATH } from './ogImage';
import type { PublicVenue, PublicVenueListing } from './publicCatalog';

// =====================================================================
// ESCAPING
// =====================================================================

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * JSON-LD lives inside a `<script>` element, where `</script>` (or an HTML
 * comment opener) in a venue-authored string would terminate the block.
 * Escaping the three characters below as unicode escapes keeps the payload
 * valid JSON and inert HTML.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// =====================================================================
// TEXT HELPERS
// =====================================================================

export function collapseWhitespace(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cut `text` to at most `max` characters on a word boundary, with an ellipsis. */
export function clampText(value: unknown, max: number): string {
  const text = collapseWhitespace(value);
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s,،;:\-–—]+$/u, '')}…`;
}

/**
 * Map the stored currency marker (a symbol or a code chosen in onboarding)
 * to an ISO-4217 code for structured data. Unknown markers return null and
 * the price is then emitted WITHOUT a currency claim.
 */
export function currencyCodeFor(marker: string | null | undefined): string | null {
  const raw = collapseWhitespace(marker);
  if (!raw) return null;
  const table: Record<string, string> = {
    '₪': 'ILS',
    'ILS': 'ILS',
    'NIS': 'ILS',
    'ش.ج': 'ILS',
    '$': 'USD',
    'USD': 'USD',
    '€': 'EUR',
    'EUR': 'EUR',
    'SAR': 'SAR',
    'ر.س': 'SAR',
    'AED': 'AED',
    'د.إ': 'AED',
    'JOD': 'JOD',
    'د.ا': 'JOD',
    'EGP': 'EGP',
    'ج.م': 'EGP',
    'QAR': 'QAR',
    'KWD': 'KWD',
    'BHD': 'BHD',
    'OMR': 'OMR',
    'TRY': 'TRY',
    '₺': 'TRY',
    'GBP': 'GBP',
    '£': 'GBP',
  };
  return table[raw] ?? table[raw.toUpperCase()] ?? null;
}

export function formatAmount(price: number): string {
  const value = Number(price) || 0;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Absolute URL for og:image / JSON-LD; relative asset URLs are rooted at the public origin. */
export function absoluteUrl(url: string | null | undefined): string | null {
  const value = collapseWhitespace(url);
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `${PUBLIC_ORIGIN}${value}`;
  return null; // data:/blob:/unknown — never advertise
}

/**
 * Arabic count phrase with correct number agreement:
 * 1 → "صنف واحد", 2 → "صنفان", 3–10 → "3 أصناف", 11+ → "11 صنفاً".
 */
export function arCount(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  if (n === 1) return `${forms.one} واحد`;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}
const AR_ITEMS = { one: 'صنف', two: 'صنفان', few: 'أصناف', many: 'صنفاً' };
const AR_SECTIONS = { one: 'قسم', two: 'قسمان', few: 'أقسام', many: 'قسماً' };

/** English count phrase ("1 item", "3 items"). */
const enCount = (n: number, singular: string, plural: string): string => `${n} ${n === 1 ? singular : plural}`;

// =====================================================================
// LOCALE
// =====================================================================

export type PublicLang = 'ar' | 'en';

export function resolveLang(language: string | null | undefined): PublicLang {
  return String(language ?? '').toLowerCase().startsWith('en') ? 'en' : 'ar';
}

const dirFor = (lang: PublicLang): 'rtl' | 'ltr' => (lang === 'ar' ? 'rtl' : 'ltr');
const ogLocaleFor = (lang: PublicLang): string => (lang === 'ar' ? 'ar_AR' : 'en_US');

const COPY = {
  ar: {
    siteName: 'مُريح | Mureeh Menu',
    menuWord: 'المنيو الإلكتروني',
    titleSuffix: 'المنيو الإلكتروني والأسعار',
    descFallback: (name: string, items: number, sections: number, top: string[]) =>
      `قائمة طعام ${name}: ${arCount(items, AR_ITEMS)} في ${arCount(sections, AR_SECTIONS)}${top.length ? ` — ${top.join('، ')}` : ''}. تصفح المنيو الإلكتروني بالأسعار المحدّثة.`,
    descAppend: (items: number, sections: number) =>
      ` تصفح ${arCount(items, AR_ITEMS)} في ${arCount(sections, AR_SECTIONS)} مع الأسعار.`,
    sectionsNav: 'أقسام القائمة',
    logoAlt: (name: string) => `شعار ${name}`,
    coverAlt: (name: string) => `صورة ${name}`,
    menuHeading: 'قائمة الطعام',
    itemsCount: (n: number) => arCount(n, AR_ITEMS),
    footerNote: 'جميع الأسعار تشمل ضريبة القيمة المضافة · المحاسبة عند الكاشير',
    unavailableTitle: (name: string) => `${name} — غير متاح حالياً | مُريح`,
    unavailableDesc: 'هذا المطعم غير متاح للعرض حالياً.',
    notFoundTitle: 'الصفحة غير موجودة | مُريح',
    notFoundDesc: 'الرابط الذي فتحته غير موجود أو تم تغييره.',
    tempErrorTitle: 'الخدمة غير متاحة مؤقتاً | مُريح',
    tempErrorDesc: 'تعذّر تحميل الصفحة مؤقتاً، حاول مرة أخرى بعد قليل.',
    directoryTitle: 'دليل المطاعم والكافيهات على مُريح — تصفح المنيو الإلكتروني',
    directoryDesc: (n: number) =>
      `تصفح ${n} ${n === 1 ? 'منيو إلكتروني' : 'منيوهات إلكترونية'} لمطاعم وكافيهات تستخدم منصة مُريح: قوائم طعام محدّثة بالأسعار والصور، تُفتح من أي هاتف عبر الويب أو رمز QR.`,
    directoryH1: 'مطاعم وكافيهات على مُريح',
    directoryIntro:
      'كل صفحة أدناه هي منيو إلكتروني حقيقي يديره المطعم بنفسه عبر منصة مُريح: الأقسام والأصناف والأسعار تُحدَّث من لوحة تحكم المطعم وتظهر هنا فوراً.',
    directoryEmpty: 'لا توجد قوائم منشورة للعرض العام حالياً.',
    viewMenu: 'عرض المنيو',
    home: 'الرئيسية',
    directoryCrumb: 'المطاعم',
    businessType: { RESTAURANT: 'مطعم', CAFE: 'كافيه', BAKERY: 'مخبز' } as Record<string, string>,
    sectionsAndItems: (sections: number, items: number) => `${arCount(sections, AR_SECTIONS)} · ${arCount(items, AR_ITEMS)}`,
    platformCta: 'أنشئ منيو إلكترونياً لمطعمك مع مُريح',
    platformHome: 'منصة مُريح للمنيو الإلكتروني',
  },
  en: {
    siteName: 'Mureeh Menu | مُريح',
    menuWord: 'Digital Menu',
    titleSuffix: 'Digital Menu & Prices',
    descFallback: (name: string, items: number, sections: number, top: string[]) =>
      `${name} menu: ${enCount(items, 'item', 'items')} across ${enCount(sections, 'section', 'sections')}${top.length ? ` — ${top.join(', ')}` : ''}. Browse the digital menu with up-to-date prices.`,
    descAppend: (items: number, sections: number) =>
      ` Browse ${enCount(items, 'item', 'items')} across ${enCount(sections, 'section', 'sections')} with prices.`,
    sectionsNav: 'Menu sections',
    logoAlt: (name: string) => `${name} logo`,
    coverAlt: (name: string) => `${name} photo`,
    menuHeading: 'Menu',
    itemsCount: (n: number) => enCount(n, 'item', 'items'),
    footerNote: 'All prices include VAT · Pay at the cashier',
    unavailableTitle: (name: string) => `${name} — currently unavailable | Mureeh`,
    unavailableDesc: 'This venue is not available for viewing right now.',
    notFoundTitle: 'Page not found | Mureeh',
    notFoundDesc: 'The link you opened does not exist or has changed.',
    tempErrorTitle: 'Temporarily unavailable | Mureeh',
    tempErrorDesc: 'The page could not be loaded right now, please try again shortly.',
    directoryTitle: 'Restaurants & cafés on Mureeh — browse digital menus',
    directoryDesc: (n: number) =>
      `Browse ${n} digital menu${n === 1 ? '' : 's'} of restaurants and cafés using Mureeh Menu: up-to-date dishes, prices and photos, open from any phone via the web or a QR code.`,
    directoryH1: 'Restaurants & cafés on Mureeh',
    directoryIntro:
      'Every page below is a real digital menu managed by the venue itself on Mureeh Menu: sections, dishes and prices are updated from the venue dashboard and appear here instantly.',
    directoryEmpty: 'No menus are published for public viewing yet.',
    viewMenu: 'View menu',
    home: 'Home',
    directoryCrumb: 'Restaurants',
    businessType: { RESTAURANT: 'Restaurant', CAFE: 'Café', BAKERY: 'Bakery' } as Record<string, string>,
    sectionsAndItems: (sections: number, items: number) => `${enCount(sections, 'section', 'sections')} · ${enCount(items, 'item', 'items')}`,
    platformCta: 'Create a digital menu for your venue with Mureeh',
    platformHome: 'Mureeh digital menu platform',
  },
} as const;

// =====================================================================
// SHELL INJECTION
// =====================================================================

export const HEAD_START_MARKER = '<!-- seo:head:start -->';
export const HEAD_END_MARKER = '<!-- seo:head:end -->';

export interface ShellInjection {
  lang: PublicLang;
  /** Complete replacement for the marked head region. */
  headHtml: string;
  /** Optional server-rendered content for `#root` (pre-hydration). */
  rootHtml?: string;
}

/** Tags the marked head region owns; stripped individually when markers are absent. */
const HEAD_TAG_PATTERNS: RegExp[] = [
  /<title>[\s\S]*?<\/title>\s*/gi,
  /<meta\s+name="description"[^>]*>\s*/gi,
  /<meta\s+name="robots"[^>]*>\s*/gi,
  /<link\s+rel="canonical"[^>]*>\s*/gi,
  /<meta\s+property="og:[^"]*"[^>]*>\s*/gi,
  /<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi,
  /<script\s+type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi,
];

export function injectIntoShell(template: string, injection: ShellInjection): string {
  let html = template;

  // <html lang dir> — follow the page language.
  html = html.replace(/<html\b([^>]*)>/i, (_m, attrs: string) => {
    let rest = attrs.replace(/\s+lang="[^"]*"/i, '').replace(/\s+dir="[^"]*"/i, '');
    rest = rest.trim();
    return `<html lang="${injection.lang}" dir="${dirFor(injection.lang)}"${rest ? ` ${rest}` : ''}>`;
  });

  const start = html.indexOf(HEAD_START_MARKER);
  const end = html.indexOf(HEAD_END_MARKER);
  if (start !== -1 && end !== -1 && end > start) {
    html =
      html.slice(0, start + HEAD_START_MARKER.length) +
      '\n' +
      injection.headHtml +
      '\n    ' +
      html.slice(end);
  } else {
    // Defence in depth: a shell without markers still gets exactly one of
    // each SEO tag — the platform ones are stripped, the page ones inserted.
    for (const pattern of HEAD_TAG_PATTERNS) html = html.replace(pattern, '');
    html = html.replace(/<\/head>/i, `${injection.headHtml}\n  </head>`);
  }

  if (injection.rootHtml) {
    html = html.replace(/<div id="root"><\/div>/, `<div id="root">${injection.rootHtml}</div>`);
  }

  return html;
}

// =====================================================================
// HEAD BUILDERS
// =====================================================================

export interface PageHead {
  title: string;
  description: string;
  canonical: string;
  robots: 'index, follow, max-image-preview:large' | 'noindex, follow' | 'noindex, nofollow';
  ogType: 'website' | 'article';
  ogImage: string | null;
  ogImageAlt?: string;
  lang: PublicLang;
  jsonLd?: unknown;
}

/**
 * The platform's own social card (the same 1200×630 PNG the homepage
 * declares, shipped from public/og-image.png). Used whenever a page has no
 * image of its own — a venue without cover/logo, the directory with no
 * venue imagery, and the 404 / 503 shells.
 */
export const PLATFORM_OG_IMAGE = `${PUBLIC_ORIGIN}${PLATFORM_OG_IMAGE_PATH}`;

export function renderHeadTags(head: PageHead): string {
  const copy = COPY[head.lang];
  const image = head.ogImage ?? PLATFORM_OG_IMAGE;
  // Both the venue cover and the platform card are landscape, so the large
  // card is right in either case.
  const twitterCard = 'summary_large_image';
  const lines = [
    `<title>${escapeHtml(head.title)}</title>`,
    `<meta name="description" content="${escapeHtml(head.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(head.canonical)}" />`,
    `<meta name="robots" content="${head.robots}" />`,
    `<meta property="og:type" content="${head.ogType}" />`,
    `<meta property="og:site_name" content="${escapeHtml(copy.siteName)}" />`,
    `<meta property="og:locale" content="${ogLocaleFor(head.lang)}" />`,
    `<meta property="og:url" content="${escapeHtml(head.canonical)}" />`,
    `<meta property="og:title" content="${escapeHtml(head.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(head.description)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
  ];
  if (head.ogImageAlt) {
    lines.push(`<meta property="og:image:alt" content="${escapeHtml(head.ogImageAlt)}" />`);
  }
  lines.push(
    `<meta name="twitter:card" content="${twitterCard}" />`,
    `<meta name="twitter:title" content="${escapeHtml(head.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(head.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`
  );
  if (head.jsonLd !== undefined) {
    lines.push(`<script type="application/ld+json">${serializeJsonLd(head.jsonLd)}</script>`);
  }
  return lines.map((l) => `    ${l}`).join('\n');
}

// =====================================================================
// VENUE PAGE
// =====================================================================

export const MAX_TITLE_LENGTH = 70;
export const MAX_DESCRIPTION_LENGTH = 160;
/** Hard bound on menu items emitted in HTML/JSON-LD (pathological catalogs). */
export const MAX_SNAPSHOT_ITEMS = 400;

const sameName = (a: string, b: string): boolean =>
  collapseWhitespace(a).toLowerCase() === collapseWhitespace(b).toLowerCase();

/** The two names a venue carries, de-duplicated ("A | A" and "A | B" cases). */
export function venueDisplayNames(venue: Pick<PublicVenue, 'name' | 'nameEn'>): {
  primary: string;
  secondary: string | null;
} {
  const name = collapseWhitespace(venue.name);
  const nameEn = collapseWhitespace(venue.nameEn);
  if (!nameEn || sameName(name, nameEn) || name.toLowerCase().includes(nameEn.toLowerCase())) {
    return { primary: name, secondary: null };
  }
  return { primary: name, secondary: nameEn };
}

export function buildVenueTitle(venue: PublicVenue): string {
  const lang = resolveLang(venue.language);
  const copy = COPY[lang];
  const { primary, secondary } = venueDisplayNames(venue);
  const base = lang === 'en' && secondary ? secondary : primary;
  const withBoth = secondary ? `${primary} (${secondary})` : primary;
  const full = `${withBoth} — ${copy.titleSuffix}`;
  if (full.length <= MAX_TITLE_LENGTH) return full;
  const short = `${base} — ${copy.titleSuffix}`;
  if (short.length <= MAX_TITLE_LENGTH) return short;
  return `${clampText(base, MAX_TITLE_LENGTH - copy.menuWord.length - 3)} — ${copy.menuWord}`;
}

export function buildVenueDescription(venue: PublicVenue): string {
  const lang = resolveLang(venue.language);
  const copy = COPY[lang];
  const { primary } = venueDisplayNames(venue);
  const sections = venue.sections.filter((s) => s.items.length > 0);
  const topSections = sections.slice(0, 3).map((s) => collapseWhitespace(s.name)).filter(Boolean);
  const own = collapseWhitespace(venue.description);
  if (!own) {
    return clampText(copy.descFallback(primary, venue.productCount, sections.length, topSections), MAX_DESCRIPTION_LENGTH);
  }
  if (own.length < 70 && venue.productCount > 0) {
    return clampText(`${own}${copy.descAppend(venue.productCount, sections.length)}`, MAX_DESCRIPTION_LENGTH);
  }
  return clampText(own, MAX_DESCRIPTION_LENGTH);
}

const SCHEMA_TYPE_BY_BUSINESS: Record<string, string> = {
  RESTAURANT: 'Restaurant',
  CAFE: 'CafeOrCoffeeShop',
  BAKERY: 'Bakery',
};

/**
 * JSON-LD for a venue page. Every value is either visible on the page or a
 * URL of the page/its images. Nothing is invented: no rating, no opening
 * hours, no price range, no address/phone unless the venue entered one.
 */
export function buildVenueJsonLd(venue: PublicVenue, canonical: string): unknown {
  const lang = resolveLang(venue.language);
  const { primary, secondary } = venueDisplayNames(venue);
  const images = [absoluteUrl(venue.coverImageUrl), absoluteUrl(venue.logoUrl)].filter(
    (u): u is string => !!u
  );
  const currency = currencyCodeFor(venue.currency);
  const sameAs = [venue.instagramUrl, venue.facebookUrl, venue.tiktokUrl, venue.youtubeUrl, venue.websiteUrl]
    .map((u) => absoluteUrl(u))
    .filter((u): u is string => !!u && /^https:\/\//i.test(u));

  let remaining = MAX_SNAPSHOT_ITEMS;
  const menuSections = venue.sections
    .filter((s) => s.items.length > 0)
    .map((section) => {
      const items = section.items.slice(0, Math.max(0, remaining));
      remaining -= items.length;
      const sectionNode: Record<string, unknown> = {
        '@type': 'MenuSection',
        name: collapseWhitespace(section.name),
      };
      if (section.nameEn && !sameName(section.nameEn, section.name)) {
        sectionNode.alternateName = collapseWhitespace(section.nameEn);
      }
      if (collapseWhitespace(section.description)) sectionNode.description = collapseWhitespace(section.description);
      sectionNode.hasMenuItem = items.map((item) => {
        const node: Record<string, unknown> = { '@type': 'MenuItem', name: collapseWhitespace(item.name) };
        if (item.nameEn && !sameName(item.nameEn, item.name)) node.alternateName = collapseWhitespace(item.nameEn);
        if (collapseWhitespace(item.description)) node.description = clampText(item.description, 300);
        const img = absoluteUrl(item.imageUrl);
        if (img) node.image = img;
        if (currency && Number.isFinite(item.price) && item.price >= 0) {
          node.offers = {
            '@type': 'Offer',
            price: (Math.round(item.price * 100) / 100).toFixed(2),
            priceCurrency: currency,
          };
        }
        return node;
      });
      return sectionNode;
    })
    .filter((s) => Array.isArray(s.hasMenuItem) && (s.hasMenuItem as unknown[]).length > 0);

  const venueId = `${canonical}#venue`;
  const venueNode: Record<string, unknown> = {
    '@type': SCHEMA_TYPE_BY_BUSINESS[venue.businessType] ?? 'FoodEstablishment',
    '@id': venueId,
    name: primary,
    url: canonical,
    inLanguage: lang,
  };
  if (secondary) venueNode.alternateName = secondary;
  if (images.length) venueNode.image = images;
  const logo = absoluteUrl(venue.logoUrl);
  if (logo) venueNode.logo = logo;
  const description = collapseWhitespace(venue.description);
  if (description) venueNode.description = clampText(description, 500);
  const phone = collapseWhitespace(venue.phone);
  if (phone) venueNode.telephone = phone;
  const address = collapseWhitespace(venue.address);
  if (address) venueNode.address = { '@type': 'PostalAddress', streetAddress: address };
  if (
    typeof venue.latitude === 'number' &&
    typeof venue.longitude === 'number' &&
    Number.isFinite(venue.latitude) &&
    Number.isFinite(venue.longitude)
  ) {
    venueNode.geo = { '@type': 'GeoCoordinates', latitude: venue.latitude, longitude: venue.longitude };
  }
  if (sameAs.length) venueNode.sameAs = sameAs;
  if (menuSections.length) {
    venueNode.hasMenu = {
      '@type': 'Menu',
      '@id': `${canonical}#menu`,
      name: `${primary} — ${COPY[lang].menuWord}`,
      url: canonical,
      inLanguage: lang,
      hasMenuSection: menuSections,
    };
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [
      venueNode,
      {
        '@type': 'WebPage',
        '@id': canonical,
        url: canonical,
        name: buildVenueTitle(venue),
        inLanguage: lang,
        isPartOf: { '@id': `${PUBLIC_ORIGIN}/#website` },
        about: { '@id': venueId },
        ...(images.length ? { primaryImageOfPage: images[0] } : {}),
      },
    ],
  };
}

export function buildVenueHead(venue: PublicVenue): PageHead {
  const lang = resolveLang(venue.language);
  const canonical = canonicalUrl(`/r/${venue.slug}`);
  const ogImage = absoluteUrl(venue.coverImageUrl) ?? absoluteUrl(venue.logoUrl);
  const { primary } = venueDisplayNames(venue);
  return {
    title: buildVenueTitle(venue),
    description: buildVenueDescription(venue),
    canonical,
    robots: venue.indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow',
    ogType: 'website',
    ogImage,
    ogImageAlt: ogImage ? COPY[lang].coverAlt(primary) : undefined,
    lang,
    jsonLd: buildVenueJsonLd(venue, canonical),
  };
}

/** Inline styles for the pre-hydration snapshot (platform tokens, no external CSS). */
const SNAPSHOT_STYLE = `
<style id="seo-snapshot-style">
  .seo-menu{max-width:64rem;margin:0 auto;padding:1.25rem 1rem 4rem;font-family:'Tajawal',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6}
  .seo-menu a{color:inherit}
  .seo-menu__head{display:flex;flex-direction:column;align-items:center;text-align:center;gap:.5rem;padding:1rem 0 1.5rem}
  .seo-menu__logo{width:72px;height:72px;border-radius:9999px;object-fit:cover;border:1px solid rgba(128,128,128,.35)}
  .seo-menu__cover{width:100%;aspect-ratio:3/1;max-height:260px;object-fit:cover;border-radius:1rem;margin-bottom:.75rem}
  .seo-menu h1{font-size:1.6rem;margin:0;font-weight:800}
  .seo-menu__name-en{margin:0;opacity:.75;font-size:.95rem}
  .seo-menu__desc{margin:.25rem 0 0;max-width:40rem;opacity:.9}
  .seo-menu__meta{margin:0;font-size:.85rem;opacity:.8}
  .seo-menu__nav{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin:0 0 1.5rem}
  .seo-menu__nav a{font-size:.85rem;padding:.35rem .8rem;border:1px solid rgba(128,128,128,.4);border-radius:9999px;text-decoration:none}
  .seo-menu section{margin:0 0 2rem}
  .seo-menu h2{font-size:1.2rem;margin:0 0 .25rem;font-weight:800}
  .seo-menu h2 small{font-weight:400;opacity:.7;font-size:.85rem;margin-inline-start:.5rem}
  .seo-menu__sec-desc{margin:0 0 .75rem;font-size:.9rem;opacity:.8}
  .seo-menu__items{list-style:none;margin:0;padding:0;display:grid;gap:.75rem}
  .seo-menu__item{display:grid;grid-template-columns:auto 1fr auto;gap:.75rem;align-items:center;padding:.75rem;border:1px solid rgba(128,128,128,.25);border-radius:1rem}
  .seo-menu__item img{width:64px;height:64px;border-radius:.75rem;object-fit:cover;background:rgba(128,128,128,.15)}
  .seo-menu__item h3{font-size:1rem;margin:0;font-weight:700}
  .seo-menu__item-en{margin:0;font-size:.8rem;opacity:.7}
  .seo-menu__item-desc{margin:.15rem 0 0;font-size:.85rem;opacity:.85}
  .seo-menu__price{font-weight:800;white-space:nowrap;direction:ltr}
  .seo-menu footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid rgba(128,128,128,.3);text-align:center;font-size:.8rem;opacity:.8}
  .seo-menu__brand{font-weight:800;letter-spacing:.05em}
</style>`;

/** Server-rendered, semantic snapshot of the menu for `#root`. */
export function renderVenueSnapshot(venue: PublicVenue): string {
  const lang = resolveLang(venue.language);
  const copy = COPY[lang];
  const { primary, secondary } = venueDisplayNames(venue);
  const sections = venue.sections.filter((s) => s.items.length > 0);
  const phone = collapseWhitespace(venue.phone);
  const address = collapseWhitespace(venue.address);
  const description = collapseWhitespace(venue.description);
  const cover = absoluteUrl(venue.coverImageUrl);
  const logo = absoluteUrl(venue.logoUrl);
  const currency = collapseWhitespace(venue.currency) || '₪';

  const metaParts: string[] = [];
  if (address) metaParts.push(`<span>${escapeHtml(address)}</span>`);
  if (phone) {
    const tel = phone.replace(/[^\d+]/g, '');
    metaParts.push(`<a href="tel:${escapeHtml(tel)}" dir="ltr">${escapeHtml(phone)}</a>`);
  }

  let remaining = MAX_SNAPSHOT_ITEMS;
  const sectionHtml = sections
    .map((section, index) => {
      const items = section.items.slice(0, Math.max(0, remaining));
      remaining -= items.length;
      if (items.length === 0) return '';
      const id = `menu-section-${index + 1}`;
      const secName = collapseWhitespace(section.name);
      const secEn = section.nameEn && !sameName(section.nameEn, section.name) ? collapseWhitespace(section.nameEn) : '';
      const secDesc = collapseWhitespace(section.description);
      const itemsHtml = items
        .map((item) => {
          const name = collapseWhitespace(item.name);
          const nameEn = item.nameEn && !sameName(item.nameEn, item.name) ? collapseWhitespace(item.nameEn) : '';
          const desc = collapseWhitespace(item.description);
          const img = absoluteUrl(item.imageUrl);
          return `<li class="seo-menu__item">${
            img
              ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(name)}" width="64" height="64" loading="lazy" decoding="async" />`
              : '<span aria-hidden="true"></span>'
          }<div><h3>${escapeHtml(name)}</h3>${
            nameEn ? `<p class="seo-menu__item-en" lang="en">${escapeHtml(nameEn)}</p>` : ''
          }${desc ? `<p class="seo-menu__item-desc">${escapeHtml(desc)}</p>` : ''}</div><span class="seo-menu__price">${escapeHtml(
            formatAmount(item.price)
          )} ${escapeHtml(currency)}</span></li>`;
        })
        .join('');
      return `<section id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${escapeHtml(secName)}${
        secEn ? ` <small lang="en">${escapeHtml(secEn)}</small>` : ''
      }</h2>${secDesc ? `<p class="seo-menu__sec-desc">${escapeHtml(secDesc)}</p>` : ''}<ul class="seo-menu__items">${itemsHtml}</ul></section>`;
    })
    .join('');

  const navHtml = sections.length
    ? `<nav class="seo-menu__nav" aria-label="${escapeHtml(copy.sectionsNav)}">${sections
        .map((s, i) => `<a href="#menu-section-${i + 1}">${escapeHtml(collapseWhitespace(s.name))}</a>`)
        .join('')}</nav>`
    : '';

  return `${SNAPSHOT_STYLE}<div class="seo-menu" data-seo-snapshot="venue" dir="${dirFor(lang)}"><header class="seo-menu__head">${
    cover ? `<img class="seo-menu__cover" src="${escapeHtml(cover)}" alt="${escapeHtml(copy.coverAlt(primary))}" fetchpriority="high" decoding="async" />` : ''
  }${
    logo ? `<img class="seo-menu__logo" src="${escapeHtml(logo)}" alt="${escapeHtml(copy.logoAlt(primary))}" width="72" height="72" decoding="async" />` : ''
  }<h1>${escapeHtml(primary)}</h1>${secondary ? `<p class="seo-menu__name-en" lang="en">${escapeHtml(secondary)}</p>` : ''}${
    description ? `<p class="seo-menu__desc">${escapeHtml(description)}</p>` : ''
  }${metaParts.length ? `<p class="seo-menu__meta">${metaParts.join(' · ')}</p>` : ''}<p class="seo-menu__meta">${escapeHtml(
    copy.sectionsAndItems(sections.length, venue.productCount)
  )}</p></header>${navHtml}<main aria-label="${escapeHtml(copy.menuHeading)}">${sectionHtml}</main><footer><div class="seo-menu__brand">${escapeHtml(
    primary
  )}${secondary ? ` · ${escapeHtml(secondary)}` : ''}</div><p>${escapeHtml(copy.footerNote)}</p></footer></div>`;
}

export interface VenuePageOptions {
  /**
   * Whether to place the pre-hydration menu snapshot inside `#root`.
   * Defaults to true. The handler turns it off for table-session URLs
   * (`?qr=…`, `?table=…`) and the TV board (`?view=display`): those URLs are
   * excluded from crawling anyway, and the scanned-QR flow keeps its exact
   * current loading experience (blank → loader → entry) with no interim
   * content flash. The decision is made per URL, never per client.
   */
  snapshot?: boolean;
}

export function renderVenuePage(template: string, venue: PublicVenue, options: VenuePageOptions = {}): string {
  const head = buildVenueHead(venue);
  return injectIntoShell(template, {
    lang: head.lang,
    headHtml: renderHeadTags(head),
    rootHtml: options.snapshot === false ? undefined : renderVenueSnapshot(venue),
  });
}

/** Venue exists but is SUSPENDED / MAINTENANCE / ONBOARDING: served, never indexed. */
export function renderUnavailableVenuePage(
  template: string,
  venue: { slug: string; name: string; nameEn: string; language: string }
): string {
  const lang = resolveLang(venue.language);
  const copy = COPY[lang];
  const { primary } = venueDisplayNames(venue);
  const head: PageHead = {
    title: copy.unavailableTitle(primary),
    description: copy.unavailableDesc,
    canonical: canonicalUrl(`/r/${venue.slug}`),
    robots: 'noindex, follow',
    ogType: 'website',
    ogImage: null,
    lang,
  };
  return injectIntoShell(template, { lang, headHtml: renderHeadTags(head) });
}

/** Unknown venue slug or unknown app route: the SPA shell with a 404 head. */
export function renderNotFoundPage(template: string, pathname: string): string {
  const copy = COPY.ar;
  const head: PageHead = {
    title: copy.notFoundTitle,
    description: copy.notFoundDesc,
    canonical: canonicalUrl(pathname),
    robots: 'noindex, nofollow',
    ogType: 'website',
    ogImage: null,
    lang: 'ar',
  };
  return injectIntoShell(template, { lang: 'ar', headHtml: renderHeadTags(head) });
}

/** Catalog read failed: the SPA shell with a 503-style head (never indexed, never cached). */
export function renderTemporaryErrorPage(template: string, pathname: string): string {
  const copy = COPY.ar;
  const head: PageHead = {
    title: copy.tempErrorTitle,
    description: copy.tempErrorDesc,
    canonical: canonicalUrl(pathname),
    robots: 'noindex, nofollow',
    ogType: 'website',
    ogImage: null,
    lang: 'ar',
  };
  return injectIntoShell(template, { lang: 'ar', headHtml: renderHeadTags(head) });
}

// =====================================================================
// DIRECTORY PAGE (/restaurants) — standalone HTML, no SPA
// =====================================================================

const DIRECTORY_STYLE = `
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#020A14;color:#E2E8F0;font-family:'Tajawal',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6}
  a{color:inherit}
  .wrap{max-width:64rem;margin:0 auto;padding:1.5rem 1rem 4rem}
  header.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.5rem 0 1.5rem}
  .brand{font-weight:900;font-size:1.1rem;text-decoration:none;color:#fff}
  .crumbs{list-style:none;display:flex;gap:.5rem;margin:0 0 1rem;padding:0;font-size:.85rem;color:#94A3B8}
  .crumbs li+li::before{content:"›";margin-inline-end:.5rem;opacity:.6}
  h1{font-size:1.9rem;margin:0 0 .5rem;color:#fff;font-weight:900}
  .intro{margin:0 0 2rem;max-width:44rem;color:#CBD5E1}
  .grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));list-style:none;margin:0;padding:0}
  .card{display:flex;flex-direction:column;background:#06162B;border:1px solid rgba(0,114,188,.35);border-radius:1.25rem;overflow:hidden}
  .card__cover{width:100%;aspect-ratio:16/9;object-fit:cover;background:#0B2240}
  .card__body{display:flex;flex-direction:column;gap:.4rem;padding:1rem}
  .card__row{display:flex;align-items:center;gap:.75rem}
  .card__logo{width:48px;height:48px;border-radius:9999px;object-fit:cover;border:1px solid rgba(255,255,255,.15);background:#0B2240}
  .card h2{font-size:1.05rem;margin:0;color:#fff}
  .card__en{margin:0;font-size:.85rem;color:#94A3B8}
  .card__type{font-size:.75rem;color:#7DD3FC}
  .card__desc{margin:.25rem 0 0;font-size:.9rem;color:#CBD5E1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .card__stats{font-size:.8rem;color:#94A3B8}
  .card__cta{margin-top:auto;display:inline-block;text-align:center;padding:.6rem 1rem;border-radius:.9rem;background:linear-gradient(270deg,#003865,#0072BC,#009FE3);color:#fff;font-weight:700;text-decoration:none}
  .empty{padding:2rem;border:1px dashed rgba(148,163,184,.4);border-radius:1rem;color:#94A3B8;text-align:center}
  footer.bottom{margin-top:3rem;padding-top:1.5rem;border-top:1px solid rgba(0,75,135,.4);font-size:.9rem;color:#94A3B8}
  footer.bottom a{color:#7DD3FC}
</style>`;

export function renderDirectoryPage(venues: PublicVenueListing[], lang: PublicLang = 'ar'): string {
  const copy = COPY[lang];
  const canonical = canonicalUrl('/restaurants');
  const indexable = venues.length > 0;
  const title = copy.directoryTitle;
  const description = indexable ? copy.directoryDesc(venues.length) : copy.directoryEmpty;
  const firstImage = venues.map((v) => absoluteUrl(v.coverImageUrl) ?? absoluteUrl(v.logoUrl)).find((u) => !!u) ?? null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': canonical,
        url: canonical,
        name: title,
        description,
        inLanguage: lang,
        isPartOf: { '@id': `${PUBLIC_ORIGIN}/#website` },
        ...(indexable
          ? {
              mainEntity: {
                '@type': 'ItemList',
                itemListElement: venues.map((v, i) => ({
                  '@type': 'ListItem',
                  position: i + 1,
                  url: canonicalUrl(`/r/${v.slug}`),
                  name: venueDisplayNames(v).primary,
                })),
              },
            }
          : {}),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: copy.home, item: `${PUBLIC_ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: copy.directoryCrumb, item: canonical },
        ],
      },
    ],
  };

  const head = renderHeadTags({
    title,
    description,
    canonical,
    robots: indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow',
    ogType: 'website',
    ogImage: firstImage,
    lang,
    jsonLd,
  });

  const cards = venues
    .map((v) => {
      const { primary, secondary } = venueDisplayNames(v);
      const href = `/r/${encodeURIComponent(v.slug)}`;
      const cover = absoluteUrl(v.coverImageUrl);
      const logo = absoluteUrl(v.logoUrl);
      const type = copy.businessType[v.businessType] ?? '';
      const desc = clampText(v.description, 180);
      return `<li class="card">${
        cover ? `<img class="card__cover" src="${escapeHtml(cover)}" alt="${escapeHtml(copy.coverAlt(primary))}" loading="lazy" decoding="async" width="640" height="360" />` : ''
      }<div class="card__body"><div class="card__row">${
        logo ? `<img class="card__logo" src="${escapeHtml(logo)}" alt="${escapeHtml(copy.logoAlt(primary))}" loading="lazy" decoding="async" width="48" height="48" />` : ''
      }<div><h2><a href="${href}" style="text-decoration:none">${escapeHtml(primary)}</a></h2>${
        secondary ? `<p class="card__en" lang="en">${escapeHtml(secondary)}</p>` : ''
      }</div></div>${type ? `<span class="card__type">${escapeHtml(type)}</span>` : ''}${
        desc ? `<p class="card__desc">${escapeHtml(desc)}</p>` : ''
      }<span class="card__stats">${escapeHtml(copy.sectionsAndItems(v.categoryCount, v.productCount))}</span><a class="card__cta" href="${href}">${escapeHtml(
        copy.viewMenu
      )} — ${escapeHtml(primary)}</a></div></li>`;
    })
    .join('');

  return `<!doctype html>
<html lang="${lang}" dir="${dirFor(lang)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#020A14" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
${head}
${DIRECTORY_STYLE}
  </head>
  <body>
    <div class="wrap">
      <header class="top">
        <a class="brand" href="/">${escapeHtml(copy.platformHome)}</a>
      </header>
      <nav aria-label="breadcrumb"><ol class="crumbs"><li><a href="/">${escapeHtml(copy.home)}</a></li><li aria-current="page">${escapeHtml(
        copy.directoryCrumb
      )}</li></ol></nav>
      <main>
        <h1>${escapeHtml(copy.directoryH1)}</h1>
        <p class="intro">${escapeHtml(copy.directoryIntro)}</p>
        ${indexable ? `<ul class="grid">${cards}</ul>` : `<p class="empty">${escapeHtml(copy.directoryEmpty)}</p>`}
      </main>
      <footer class="bottom">
        <p><a href="/">${escapeHtml(copy.platformCta)}</a></p>
      </footer>
    </div>
  </body>
</html>
`;
}
