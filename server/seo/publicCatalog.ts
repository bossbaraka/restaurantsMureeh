/**
 * Mureeh Menu — public catalog reads for the SEO surface.
 *
 * This is the ONLY place the SEO layer touches the database. It reads the
 * same rows, with the same visibility rules, as the public catalog API
 * (`GET /api/public/restaurants/:slug`): an ACTIVE restaurant, its ACTIVE
 * categories and its `available` products. Nothing here is ever written,
 * and nothing private (tables, QR tokens, sessions, orders, transfer
 * accounts, users) is selected — the projection below is the complete list
 * of columns the public HTML may contain.
 *
 * Publishability (index policy)
 * =============================
 * A venue page is served to humans whenever the venue exists, but it is only
 * declared indexable — and only listed in the sitemap / directory — when it
 * carries real public content:
 *
 *   status === 'ACTIVE'
 *   AND at least one ACTIVE category that contains an available product
 *   AND at least MIN_INDEXABLE_PRODUCTS available products overall
 *
 * A venue that is still being set up, or whose menu is empty, is served
 * with `noindex` instead of being advertised as an empty page (see
 * publicPages.ts). Flipping the venue to SUSPENDED/MAINTENANCE drops it from
 * the index the same way.
 *
 * Caching
 * =======
 * Crawlers re-fetch aggressively, so reads are memoised for a short TTL per
 * slug. The SPA still fetches the live catalog from the API after hydration,
 * so a 60-second-old HTML snapshot never shows a guest a stale price for
 * longer than the time it takes the JavaScript to load.
 */

import { prisma } from '../db/prisma';
import { config } from '../config';
import {
  getStorage,
  assetNormalizerFor,
  assetUrlResolverFor,
  resolveRestaurantAssets,
  resolveAssetReference,
  isStorageKey,
} from '../services/storage';

// =====================================================================
// POLICY
// =====================================================================

/** Minimum number of available products for a venue page to be indexable. */
export const MIN_INDEXABLE_PRODUCTS = 3;

/** How long a rendered venue read is reused before hitting the DB again. */
export const VENUE_CACHE_TTL_MS = 60_000;
/** How long the sitemap / directory listing is reused. */
export const LISTING_CACHE_TTL_MS = 120_000;
/** Upper bound on cached venue entries (crawlers probing random slugs). */
const VENUE_CACHE_MAX_ENTRIES = 500;

// =====================================================================
// PUBLIC SHAPES
// =====================================================================

export interface PublicMenuItem {
  name: string;
  nameEn: string;
  description: string;
  price: number;
  imageUrl: string | null;
}

export interface PublicMenuSection {
  name: string;
  nameEn: string;
  description: string;
  items: PublicMenuItem[];
}

export interface PublicVenue {
  slug: string;
  name: string;
  nameEn: string;
  description: string;
  phone: string;
  address: string;
  currency: string;
  language: string;
  status: string;
  businessType: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  galleryImages: string[];
  latitude: number | null;
  longitude: number | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  sections: PublicMenuSection[];
  /** Available products inside ACTIVE categories (what the page lists). */
  productCount: number;
  /** Most recent change across the venue row, its categories and products. */
  lastModified: Date;
  /** Index policy verdict (see module doc). */
  indexable: boolean;
}

export interface PublicVenueListing {
  slug: string;
  name: string;
  nameEn: string;
  description: string;
  businessType: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  productCount: number;
  categoryCount: number;
  lastModified: Date;
}

export type VenueLookup =
  | { kind: 'found'; venue: PublicVenue }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; venue: Pick<PublicVenue, 'slug' | 'name' | 'nameEn' | 'status' | 'language'> };

// =====================================================================
// ASSET RESOLUTION (same contract as the public API)
// =====================================================================

let assetContract: {
  normalizer: ReturnType<typeof assetNormalizerFor>;
  toUrl: (key: string) => string;
} | null = null;

function assetContractFor() {
  if (!assetContract) {
    const storage = getStorage();
    assetContract = {
      normalizer: assetNormalizerFor(storage),
      toUrl: assetUrlResolverFor(storage, config.appUrl),
    };
  }
  return assetContract;
}

/** Catalog images: only canonical storage keys are resolved, like the API. */
function resolveCatalogImage(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!isStorageKey(value)) return value;
  const { normalizer, toUrl } = assetContractFor();
  return resolveAssetReference(value, normalizer, toUrl).url ?? value;
}

const emptyToNull = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

// =====================================================================
// TTL CACHE
// =====================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const venueCache = new Map<string, CacheEntry<VenueLookup>>();
let listingCache: CacheEntry<PublicVenueListing[]> | null = null;

function readCache<T>(entry: CacheEntry<T> | null | undefined, now: number): T | null {
  if (!entry) return null;
  if (entry.expiresAt <= now) return null;
  return entry.value;
}

/** Test/ops hook: forget every memoised read. */
export function resetPublicCatalogCache(): void {
  venueCache.clear();
  listingCache = null;
}

// =====================================================================
// SLUG VALIDATION
// =====================================================================

/**
 * The slug charset is the same one the SPA accepts (`parseCustomerEntryUrl`)
 * and the API lower-cases on lookup. Anything else is a 404 without a DB
 * round-trip.
 */
export const PUBLIC_SLUG_PATTERN = /^[a-z0-9_-]{1,80}$/;

export function normalizePublicSlug(raw: string | undefined | null): string | null {
  const slug = String(raw ?? '').trim().toLowerCase();
  return PUBLIC_SLUG_PATTERN.test(slug) ? slug : null;
}

// =====================================================================
// READS
// =====================================================================

const maxDate = (...dates: Array<Date | null | undefined>): Date => {
  let max: Date | null = null;
  for (const d of dates) {
    if (d instanceof Date && !Number.isNaN(d.getTime()) && (!max || d > max)) max = d;
  }
  return max ?? new Date(0);
};

export function isVenueIndexable(input: {
  status: string;
  productCount: number;
  sectionsWithItems: number;
}): boolean {
  return (
    input.status === 'ACTIVE' &&
    input.sectionsWithItems > 0 &&
    input.productCount >= MIN_INDEXABLE_PRODUCTS
  );
}

/**
 * Load one venue for its public page. Returns `not_found` for an unknown
 * slug, `unavailable` for a venue that exists but is not ACTIVE (the page is
 * served with noindex), and `found` otherwise.
 */
export async function getPublicVenue(slugRaw: string): Promise<VenueLookup> {
  const slug = normalizePublicSlug(slugRaw);
  if (!slug) return { kind: 'not_found' };

  const now = Date.now();
  const cached = readCache(venueCache.get(slug), now);
  if (cached) return cached;

  const row = await prisma.restaurant.findUnique({
    where: { slug },
    select: {
      slug: true,
      name: true,
      nameEn: true,
      description: true,
      phone: true,
      address: true,
      currency: true,
      language: true,
      status: true,
      businessType: true,
      logoUrl: true,
      coverImageUrl: true,
      mapImageUrl: true,
      galleryImages: true,
      latitude: true,
      longitude: true,
      websiteUrl: true,
      instagramUrl: true,
      facebookUrl: true,
      tiktokUrl: true,
      youtubeUrl: true,
      updatedAt: true,
      categories: {
        where: { status: 'ACTIVE' },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, nameEn: true, description: true, updatedAt: true },
      },
      products: {
        where: { available: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          categoryId: true,
          name: true,
          nameEn: true,
          description: true,
          price: true,
          imageUrl: true,
          updatedAt: true,
        },
      },
    },
  });

  let result: VenueLookup;
  if (!row) {
    result = { kind: 'not_found' };
  } else if (row.status !== 'ACTIVE') {
    result = {
      kind: 'unavailable',
      venue: {
        slug: row.slug,
        name: row.name,
        nameEn: row.nameEn,
        status: row.status,
        language: row.language,
      },
    };
  } else {
    const { normalizer, toUrl } = assetContractFor();
    const assets = resolveRestaurantAssets(
      {
        logoUrl: row.logoUrl,
        coverImageUrl: row.coverImageUrl,
        mapImageUrl: row.mapImageUrl,
        galleryImages: row.galleryImages,
      },
      normalizer,
      toUrl
    );

    const sections: PublicMenuSection[] = row.categories.map((category) => ({
      name: category.name,
      nameEn: category.nameEn ?? '',
      description: category.description ?? '',
      items: row.products
        .filter((product) => product.categoryId === category.id)
        .map((product) => ({
          name: product.name,
          nameEn: product.nameEn,
          description: product.description,
          price: product.price,
          imageUrl: resolveCatalogImage(product.imageUrl),
        })),
    }));

    // Only products that sit inside an ACTIVE category count as public
    // content — the same set listPublishableVenues() aggregates, so the page
    // verdict and the sitemap verdict can never disagree.
    const sectionsWithItems = sections.filter((s) => s.items.length > 0).length;
    const productCount = sections.reduce((sum, s) => sum + s.items.length, 0);

    const venue: PublicVenue = {
      slug: row.slug,
      name: row.name,
      nameEn: row.nameEn,
      description: row.description,
      phone: row.phone,
      address: row.address,
      currency: row.currency,
      language: row.language,
      status: row.status,
      businessType: row.businessType,
      logoUrl: emptyToNull(assets.logoUrl),
      coverImageUrl: emptyToNull(assets.coverImageUrl),
      galleryImages: assets.galleryImages.filter((u) => !!u),
      latitude: row.latitude,
      longitude: row.longitude,
      websiteUrl: emptyToNull(row.websiteUrl),
      instagramUrl: emptyToNull(row.instagramUrl),
      facebookUrl: emptyToNull(row.facebookUrl),
      tiktokUrl: emptyToNull(row.tiktokUrl),
      youtubeUrl: emptyToNull(row.youtubeUrl),
      sections,
      productCount,
      lastModified: maxDate(
        row.updatedAt,
        ...row.categories.map((c) => c.updatedAt),
        ...row.products.map((p) => p.updatedAt)
      ),
      indexable: isVenueIndexable({ status: row.status, productCount, sectionsWithItems }),
    };
    result = { kind: 'found', venue };
  }

  if (venueCache.size >= VENUE_CACHE_MAX_ENTRIES) {
    // Drop the oldest insertion — a bounded map is all that is needed here.
    const oldest = venueCache.keys().next().value;
    if (oldest !== undefined) venueCache.delete(oldest);
  }
  venueCache.set(slug, { value: result, expiresAt: now + VENUE_CACHE_TTL_MS });
  return result;
}

/**
 * Every venue that passes the index policy, for the sitemap and the public
 * directory. One query for the rows, two grouped aggregates for the counts
 * and the last-modified dates — no per-venue round-trips.
 */
export async function listPublishableVenues(): Promise<PublicVenueListing[]> {
  const now = Date.now();
  const cached = readCache(listingCache, now);
  if (cached) return cached;

  const [rows, productStats, categoryStats] = await Promise.all([
    prisma.restaurant.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        nameEn: true,
        description: true,
        businessType: true,
        logoUrl: true,
        coverImageUrl: true,
        mapImageUrl: true,
        galleryImages: true,
        updatedAt: true,
      },
    }),
    prisma.product.groupBy({
      by: ['restaurantId'],
      where: { available: true, category: { status: 'ACTIVE' } },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.category.groupBy({
      by: ['restaurantId'],
      where: { status: 'ACTIVE', products: { some: { available: true } } },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
  ]);

  const productsByRestaurant = new Map(
    productStats.map((s) => [s.restaurantId, { count: s._count._all, max: s._max.updatedAt }])
  );
  const categoriesByRestaurant = new Map(
    categoryStats.map((s) => [s.restaurantId, { count: s._count._all, max: s._max.updatedAt }])
  );

  const { normalizer, toUrl } = assetContractFor();

  const listing: PublicVenueListing[] = [];
  for (const row of rows) {
    const slug = normalizePublicSlug(row.slug);
    if (!slug) continue; // never emit a URL the route would reject
    const products = productsByRestaurant.get(row.id) ?? { count: 0, max: null };
    const categories = categoriesByRestaurant.get(row.id) ?? { count: 0, max: null };
    if (
      !isVenueIndexable({
        status: 'ACTIVE',
        productCount: products.count,
        sectionsWithItems: categories.count,
      })
    ) {
      continue;
    }
    const assets = resolveRestaurantAssets(
      {
        logoUrl: row.logoUrl,
        coverImageUrl: row.coverImageUrl,
        mapImageUrl: row.mapImageUrl,
        galleryImages: row.galleryImages,
      },
      normalizer,
      toUrl
    );
    listing.push({
      slug,
      name: row.name,
      nameEn: row.nameEn,
      description: row.description,
      businessType: row.businessType,
      logoUrl: emptyToNull(assets.logoUrl),
      coverImageUrl: emptyToNull(assets.coverImageUrl),
      productCount: products.count,
      categoryCount: categories.count,
      lastModified: maxDate(row.updatedAt, products.max, categories.max),
    });
  }

  listingCache = { value: listing, expiresAt: now + LISTING_CACHE_TTL_MS };
  return listing;
}
