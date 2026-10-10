# Mureeh Menu — SEO Architecture

> Living document. Authoritative for how `https://mureehmenu.com` — the
> SaaS landing page **and** every venue's public digital menu — is surfaced
> to Google and other crawlers. For the audit that led to this design and the
> validation evidence, see `../SEO_IMPLEMENTATION_REPORT.md`.

## Scope

The site is a Vite + React single-page application served by the Express
API process (one origin, one Node service). It has exactly two
extension-less application routes — `/` and `/r/{slug}` — plus one
server-rendered page, `/restaurants`.

| Surface               | Indexable? | Owner                                                                |
| --------------------- | ---------- | -------------------------------------------------------------------- |
| `/`                   | yes        | `index.html` (static head + JSON-LD) → SPA landing page              |
| `/restaurants`        | yes¹       | `server/seo/publicHandlers.ts` → standalone HTML directory           |
| `/r/{slug}`           | yes²       | `publicHandlers.ts` → SPA shell + venue head + menu snapshot in `#root` |
| `/r/{slug}?qr=…`      | no (canonical → `/r/{slug}`, `robots.txt` Disallow) | same handler; the token is only read by the client |
| `/r/{slug}?view=display` | no (canonical → `/r/{slug}`) | same handler; the SPA renders the TV board           |
| `/sitemap.xml`        | —          | `publicHandlers.handleSitemap` (database-backed)                     |
| `/robots.txt`         | —          | `platformSeo.handlePlatformRobots`                                   |
| `/og-image.png`       | —          | static 1200×630 PNG in `public/` — the platform social card          |
| `/api/og`             | —          | `ogImage.ts` (legacy: 302 to `/og-image.png`, `X-Robots-Tag: noindex`) |
| `/api/*`              | no         | JSON, `X-Robots-Tag: noindex`, never blocked in robots.txt           |
| any other path        | no         | 404 + SPA shell with `noindex` (was: soft 200)                       |

¹ `noindex` while no venue is publishable (honest empty state).
² Index policy below.

Console screens (manager, kitchen, admin, login) are **not URLs** — they are
client state under `/` behind authentication — so there is nothing to
`Disallow` and nothing that can leak into the sitemap.

## One HTML for everyone

There is **no user-agent detection** anywhere. A guest's browser and
Googlebot receive byte-identical HTML for `/r/{slug}`: the production shell
(`dist/index.html`) with two regions replaced per request:

1. **`<head>`** — the block between `<!-- seo:head:start -->` and
   `<!-- seo:head:end -->` (title, description, canonical, robots, Open
   Graph, Twitter, JSON-LD) is swapped for the venue's own metadata, and
   `<html lang dir>` follows the venue language.
2. **`#root`** — a semantic snapshot of the menu (logo, `h1` name, English
   name, description, address · phone, section nav, `h2` sections, `h3`
   items with descriptions and prices) is placed inside the React root.
   `createRoot().render()` replaces it when the application mounts and
   renders the same menu interactively, so there is no hydration contract
   to maintain.

The SPA's own behaviour is untouched: the module script, assets and the QR
session flow are exactly what Vite built. The server never reads the value
of `?qr=`; it only checks for the *presence* of session/kiosk keys (`qr`,
`sessionToken`, `table`, `tableId`, `t`, `view`) to skip the `#root`
snapshot on those URLs — the head is identical, the canonical still points
at `/r/{slug}`, and the scanned-QR flow keeps today's exact boot sequence
(no interim content flash). That rule is per URL, never per client.

## Index policy for venue pages

Defined once in `server/seo/publicCatalog.ts` (`isVenueIndexable`) and used
by the page, the directory and the sitemap, so they can never disagree:

```
indexable = status === 'ACTIVE'
         && at least one ACTIVE category containing an available product
         && at least MIN_INDEXABLE_PRODUCTS (3) available products in ACTIVE categories
```

| Venue state                         | HTTP | `<meta name="robots">` | Snapshot | Sitemap / directory |
| ----------------------------------- | ---- | ---------------------- | -------- | ------------------- |
| ACTIVE, publishable                 | 200  | `index, follow, max-image-preview:large` | yes | yes |
| ACTIVE, thin / empty menu           | 200  | `noindex, follow`      | yes      | no                  |
| SUSPENDED / ONBOARDING              | 404  | `noindex, follow`      | no       | no                  |
| MAINTENANCE                         | 503 + `Retry-After` | `noindex, follow` | no    | no                  |
| unknown slug / bad charset          | 404  | `noindex, nofollow`    | no       | no                  |
| catalog read failed                 | 503 + `Retry-After`, `no-store` | `noindex, nofollow` | no | — |

Flipping a venue out of `ACTIVE`, or emptying its menu, removes it from the
sitemap, the directory and the index policy on the next request (60 s page
cache, 120 s listing cache).

## Canonicalisation

- Public origin: `PRODUCTION_ORIGIN = 'https://mureehmenu.com'` in
  `server/seo/platformSeo.ts`; `APP_URL` is a non-production override.
- `www.` → apex is handled upstream (verified: `www.mureehmenu.com` already
  301s). The Render alias `*.onrender.com` serves the same app, so
  `handleCanonicalHostRedirect` 301s **page** requests on it to the public
  origin (API, uploads and health checks are left alone).
- `/r/{SLUG}` → 301 `/r/{slug}`; `/r/{slug}/` → 301 `/r/{slug}`;
  `/restaurants/` → 301 `/restaurants`. Query strings are preserved.
- `rel=canonical` on a venue page is always `https://mureehmenu.com/r/{slug}`
  regardless of `?qr=`, `?view=display` or tracking parameters.
- No `hreflang`: there are no per-language URLs. A venue page declares the
  single language of its content (`lang="ar" dir="rtl"` or `lang="en"
  dir="ltr"`) from the venue's `language` field.

## Per-venue metadata (`server/seo/publicPages.ts`)

Every value is derived from the venue row; missing fields are omitted, never
rendered as `undefined`:

- **Title** — `{name} ({nameEn}) — المنيو الإلكتروني والأسعار` (English
  variant for `language = en`), de-duplicated when `nameEn` already appears
  in `name`, kept ≤ 70 characters.
- **Description** — the venue's own description trimmed to ~160 characters
  on a word boundary; short descriptions get a factual suffix (item/section
  counts with correct Arabic number agreement); venues without one get a
  description generated from counts and the first section names.
- **Open Graph / Twitter** — `og:type=website`, `og:locale` (`ar_AR` /
  `en_US`), `og:image` = cover → logo → platform card
  (`https://mureehmenu.com/og-image.png`, a real 1200×630 PNG), so every
  page always has a large-image card (`twitter:card=summary_large_image`).
- **JSON-LD** — `@graph` of a `Restaurant` / `CafeOrCoffeeShop` / `Bakery`
  node (by `businessType`) plus a `WebPage` node linked to the site's
  `#website`. The venue node carries `telephone`, `address`
  (`PostalAddress.streetAddress`), `geo` and `sameAs` **only when the venue
  entered them**, `image`/`logo` from its real assets, and `hasMenu` →
  `MenuSection` → `MenuItem` with `offers` only when the stored currency
  marker maps to ISO-4217 (`₪`→ILS, `$`→USD, `€`→EUR, `SAR`, …). Never:
  `aggregateRating`, `Review`, `openingHours`, `priceRange`, `servesCuisine`.
- JSON-LD is serialised with `<`, `>` and `&` as unicode escapes so venue
  text can never terminate the `<script>` element; all HTML is escaped.

## Sitemap

`/sitemap.xml` is built per request (5-minute cache header) from
`listPublishableVenues()`:

```
/                      (no lastmod — nothing real to derive it from)
/restaurants           lastmod = newest venue change   (only when ≥ 1 venue)
/r/{slug} × N          lastmod = max(restaurant.updatedAt, category.updatedAt, product.updatedAt)
```

No `changefreq`/`priority`, no query strings, no duplicates, HTTPS canonical
URLs only. If the database read fails the handler logs the error and serves
the platform entries with `Cache-Control: no-store` — a valid sitemap,
never a 500 and never a stale venue list.

`public/sitemap.xml` (copied into `dist/` by Vite) stays platform-only: it
is the fallback for static-only hosts that cannot know which venues are
published today.

## Internal linking

Venue pages are reachable through plain `<a href>` links, not only through
the sitemap:

- `SaaSLandingPage.tsx` — "ما هو مُريح؟" (`#about`) definition block right
  under the hero: plain-text answers to *for whom / which problem / how it
  works*, with anchors to `/restaurants` and `#pricing`; the "منيوهات حيّة"
  section listing the ACTIVE venues the public API returns (hidden when
  empty); and a footer link to `/restaurants`.
  `landing-crawlable-content.test.tsx` server-renders the real component and
  checks the heading outline, the wording and these anchors.
- `/restaurants` — server-rendered directory (visible breadcrumb +
  `BreadcrumbList`, `CollectionPage`/`ItemList`) linking every publishable
  venue and back to `/`.

Venue pages themselves are white-label (the customer UI shows only the
venue's identity), so they intentionally carry no platform link.

## robots.txt

```
User-agent: *
Allow: /
Disallow: /*?qr=            # per-table capability tokens — never crawl/cache
Disallow: /*?sessionToken=
Disallow: /*?table=
Disallow: /*?tableId=
Disallow: /*?t=
Disallow: /*&qr=            # same keys when they are not the first parameter
Disallow: /*&sessionToken=
Disallow: /*&table=
Disallow: /*&tableId=
Disallow: /*&t=
Sitemap: https://mureehmenu.com/sitemap.xml
```

robots patterns are literal: `/*?qr=` does not match `/r/x?lang=en&qr=…`,
hence the `&` twins. `public/robots.txt` must stay byte-identical to
`buildRobotsTxt()` (`seo-platform.test.ts` enforces it).

`/api/*` is deliberately **not** disallowed (Googlebot must be able to fetch
it while rendering the SPA); API responses carry `X-Robots-Tag: noindex`.
No page relies on both a robots block and a `noindex` — private states use
`noindex` on a crawlable URL.

## Social card (`public/og-image.png`)

A real 1200×630 PNG (≈200 kB) composed only from the repository's own brand
assets: the falcon mark from `favicon.svg`, the wordmark "مُريح" and
"Mureeh Menu" in Tajawal, and the homepage title as the tagline. It was
rendered once at development time with `@resvg/resvg-js` (SVG → PNG) and
committed; neither the renderer nor the font package is a project
dependency. `index.html`, `publicPages.ts` (fallback for venues without
cover/logo, the directory and the error shells) and the legacy `/api/og`
redirector all point at the same `PLATFORM_OG_IMAGE_PATH`.

## Files

| File                                   | Role                                                        |
| -------------------------------------- | ----------------------------------------------------------- |
| `index.html`                           | Homepage head + JSON-LD, `seo:head` markers, SPA shell      |
| `server/seo/platformSeo.ts`            | Origin, `canonicalUrl`, XML escaping, sitemap serialiser, robots.txt (Prisma-free) |
| `server/seo/publicCatalog.ts`          | The only database read path: venue page / publishable list, index policy, TTL cache |
| `server/seo/publicPages.ts`            | Pure HTML renderers: head tags, JSON-LD, menu snapshot, directory, 404/503 shells |
| `server/seo/publicHandlers.ts`         | Express handlers: `/r/:slug`, `/restaurants`, `/sitemap.xml`, unknown-route 404, host redirect |
| `server/seo/ogImage.ts`                | `PLATFORM_OG_IMAGE_PATH` (`/og-image.png`) + legacy `/api/og` redirector |
| `public/og-image.png`                  | Platform social card (1200×630 PNG; see "Social card" below) |
| `server/index.ts`                      | Mount order: host redirect → sitemap/robots/og → `/restaurants`, `/r/:slug` → static → fallback |
| `public/robots.txt`, `public/sitemap.xml` | Static fallbacks for static-only hosts                   |
| `src/components/customer/CustomerLayout.tsx` | Browse-only menu for bare `/r/{slug}` (ordering still table-bound) |
| `src/components/common/SaaSLandingPage.tsx`  | Live venues section + directory link                  |
| `src/tests/seo-public-pages.test.ts`   | HTTP-level coverage of the public surface (Prisma mocked)   |
| `src/tests/seo-host-redirect.test.ts`  | Host canonicalisation                                       |
| `src/tests/seo-platform.test.ts`, `seo-production.test.ts` | Static release gates                    |

## Local development

The Vite dev server (`npm run dev`) serves `index.html` itself, so the
venue head/snapshot are only observable against a build:
`npm run build && npm run server`, then `curl -s localhost:3001/r/{slug} | head -60`.

## How to extend

- **New public platform page** (e.g. `/pricing` as its own URL): add the
  handler next to `handleDirectoryPage`, mount it before `express.static`,
  add it to `buildSitemapEntries()`, and add a `seo-public-pages.test.ts`
  case. Do not add it to the SPA fallback — unknown paths must stay 404.
- **New venue field in metadata**: add it to the `select` in
  `publicCatalog.getPublicVenue`, to `PublicVenue`, and render it in
  `publicPages.ts` with an explicit empty-value guard.
- **Replacing the social card**: overwrite `public/og-image.png` (keep
  1200×630 — `seo-platform.test.ts` reads the PNG header and compares it with
  `og:image:width/height` in `index.html`; keep it under 300 kB so WhatsApp
  still previews it). The path is a single constant, `PLATFORM_OG_IMAGE_PATH`
  in `ogImage.ts`, used by `index.html` (literal), `publicPages.ts` and the
  `/api/og` redirector. After deploying a new card, re-scrape the URL in the
  Facebook Sharing Debugger / LinkedIn Post Inspector — social networks cache
  the old image by URL.
