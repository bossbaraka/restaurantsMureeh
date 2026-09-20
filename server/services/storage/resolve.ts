// ============================================================
// Asset reference resolution — the SINGLE contract that converts
// the stable references persisted in PostgreSQL into renderable
// URLs, and that normalizes untrusted incoming values back into
// stable references BEFORE anything is persisted.
//
// The database is the source of truth for theme images. The value
// stored in the image columns is a STABLE REFERENCE, never a
// transient one:
//
//   - driver-managed asset  -> the object key,
//     `restaurants/{restaurantId}/{folder}/{uuid}{ext}`
//     (built by buildStorageKey(); tenant-scoped, collision-free)
//   - external asset        -> an absolute https:// URL
//     (CDN/Unsplash/… — stable by definition)
//
// Values that are NEVER valid to persist:
//   - blob: / data: / file: / javascript: / vbscript: payloads
//   - local `/uploads/…` URLs or Supabase public URLs — those are
//     VIEWs over a key; on write they are folded back into the key
//     so the database never depends on the API's host name.
//
// Reading is total: whatever shape a legacy row has (relative
// `/uploads/…` URL, absolute local URL on any host, Supabase
// public URL, raw key, external URL, historical data: URI) the
// resolver produces the same stable reference + a renderable URL.
//
// This module is pure (no env, no config, no drivers) so it is
// unit-testable and reusable by every route that ships an image
// field. The driver wiring (which keyFromUrl / getUrl to use) is
// provided by the caller — see assetNormalizerFor /
// assetUrlResolverFor in ./index.
// ============================================================

/** Prefix that unambiguously identifies a managed object key. */
export const STORAGE_KEY_PREFIX = 'restaurants/';

/**
 * True when `value` is already a managed object key
 * (`restaurants/{tenant}/{folder}/{name}`) — no `://`, no traversal.
 */
export function isStorageKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v.startsWith(STORAGE_KEY_PREFIX)) return false;
  if (v.includes('..') || v.includes('\\') || v.includes('://')) return false;
  if (v.includes('//')) return false;
  return true;
}

/** A shape-validated key is the stable form for driver-managed assets. */
export interface AssetNormalizer {
  /**
   * Map a URL this storage driver manages back to its object key
   * (local `/uploads/{key}`, Supabase public URL, …). Returns null
   * for anything the driver does not manage (external/legacy/other).
   */
  keyFromUrl(value: string): string | null;
}

/** Result of resolving one stored reference for an API response. */
export interface ResolvedAsset {
  /** The stable reference as persisted (null when the asset is absent). */
  reference: string | null;
  /** A renderable URL for the reference (null when it cannot be rendered). */
  url: string | null;
}

export type NormalizedAsset =
  /** `null` / empty string — an explicit, intentional deletion. */
  | { kind: 'clear' }
  /** Driver-managed asset; `reference` is the object key. */
  | { kind: 'key'; reference: string }
  /** External https URL, persisted verbatim. */
  | { kind: 'external'; reference: string }
  /** Unsafe or unrenderable value — must be rejected, never persisted. */
  | { kind: 'reject'; reason: string };

// Matches the existing httpsUrl/assetReference validation contract:
// absolute http(s) URLs are external asset references (kept verbatim).
const EXTERNAL_URL_RE = /^https?:\/\/[^\s"'><]+$/i;
// Historical rows predate server-side uploads and may still carry an
// inline data: URI. We keep them RENDERABLE (legacy compat) but new
// writes are rejected, so storage:migrate can retire them.
const LEGACY_DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;
const UNSAFE_SCHEME_RE =
  /^(?:blob|data|file|javascript|vbscript|ws|wss):/i;

/**
 * Normalize an untrusted incoming value (manager/admin form field) into
 * the stable reference that may be persisted.
 *
 * Semantics (the update contract for image fields):
 *   - `undefined` is NOT handled here — an omitted field means
 *     "unchanged" and is left to the caller (Prisma `undefined`).
 *   - `null` / `''`           -> explicit delete (`clear`)
 *   - managed URL or key      -> object key (host-independent)
 *   - absolute https URL      -> external, kept verbatim
 *   - anything else           -> reject (data:, blob:, file:, script
 *     schemes, protocol-relative URLs, ftp:, bare paths, …)
 */
export function normalizeAssetReference(
  value: unknown,
  n: AssetNormalizer
): NormalizedAsset {
  if (value === null) return { kind: 'clear' };
  if (typeof value !== 'string') {
    return { kind: 'reject', reason: 'not-a-string' };
  }
  const v = value.trim();
  if (!v) return { kind: 'clear' };
  if (UNSAFE_SCHEME_RE.test(v) || v.startsWith('//')) {
    return { kind: 'reject', reason: 'unsafe-scheme' };
  }
  // Managed object key — canonical form, keep as-is.
  if (isStorageKey(v)) return { kind: 'key', reference: v };
  // A URL this driver manages (possibly on a legacy/different host)
  // folds back into its key — the host is not part of the reference.
  try {
    const key = n.keyFromUrl(v);
    if (key) return { kind: 'key', reference: key };
  } catch {
    /* keyFromUrl must never throw; treat as unmanaged */
  }
  if (EXTERNAL_URL_RE.test(v)) return { kind: 'external', reference: v };
  return { kind: 'reject', reason: 'unknown-form' };
}

/**
 * Resolve a stored reference into `{ reference, url }` for API responses.
 *
 * Total by design: legacy rows resolve to their current renderable form
 * instead of silently dropping the image. The only non-renderable
 * outcome is a value that is neither a managed key/URL, an https URL
 * nor a legacy data:image payload.
 */
export function resolveAssetReference(
  value: string | null | undefined,
  n: AssetNormalizer,
  toUrl: (key: string) => string
): ResolvedAsset {
  if (typeof value !== 'string') return { reference: null, url: null };
  const v = value.trim();
  if (!v) return { reference: null, url: null };

  let key: string | null = null;
  if (isStorageKey(v)) {
    key = v;
  } else {
    try {
      key = n.keyFromUrl(v);
    } catch {
      key = null;
    }
  }
  if (key) {
    let url: string;
    try {
      url = toUrl(key);
    } catch {
      url = null as unknown as string;
    }
    return { reference: key, url };
  }
  if (EXTERNAL_URL_RE.test(v) || LEGACY_DATA_IMAGE_RE.test(v)) {
    return { reference: v, url: v };
  }
  // Unknown legacy shape: keep the stored value as the reference (so no
  // data is lost on a future re-save) but do not advertise a URL.
  return { reference: v, url: null };
}

/**
 * Prefix a relative public URL (local driver: `/uploads/{key}`) with the
 * deployment's public API origin so guests on a different frontend
 * origin (Netlify/Vercel SPA + Render API) can load the asset.
 * Absolute URLs (Supabase public, external CDN) pass through untouched.
 */
export function absolutizePublicUrl(url: string, publicOrigin: string): string {
  if (!url) return url;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  const origin = (publicOrigin || '').replace(/\/+$/, '');
  if (!origin) return url; // same-origin deployment: relative is correct
  return `${origin}${url.startsWith('/') ? url : `/${url}`}`;
}

/**
 * Shape of the Prisma `Restaurant` row's image fields (the only fields
 * this helper touches — everything else passes through untouched).
 */
export interface RestaurantAssetRow {
  logoUrl: string;
  coverImageUrl: string | null;
  mapImageUrl: string | null;
  galleryImages: string[];
  /**
   * The display screen's backdrop (شاشة العرض). Optional: routes whose row
   * does not carry the column simply omit both the URL and the storage path
   * from their payload instead of advertising an empty image.
   */
  displayBackgroundImageUrl?: string | null;
}

/**
 * Map a persisted restaurant row's image fields into the API response
 * form:
 *   - the existing URL fields (`logoUrl`, `coverImageUrl`, …) carry a
 *     RENDERABLE URL resolved through the single contract above;
 *   - additive `*StoragePath` fields carry the stable reference itself,
 *     so clients can round-trip the exact value the database holds
 *     (the `{ storagePath, url }` pair of the persistence contract).
 *
 * Every route that returns a restaurant row goes through this one
 * function — no response shape resolves assets on its own.
 */
export function resolveRestaurantAssets<T extends RestaurantAssetRow>(
  row: T,
  n: AssetNormalizer,
  toUrl: (key: string) => string
): T & {
  logoUrl: string;
  coverImageUrl: string | null;
  mapImageUrl: string | null;
  galleryImages: string[];
  logoStoragePath: string;
  coverStoragePath: string | null;
  mapStoragePath: string | null;
  galleryStoragePaths: string[];
  displayBackgroundImageUrl?: string | null;
  displayBackgroundStoragePath?: string | null;
} {
  const logo = resolveAssetReference(row.logoUrl, n, toUrl);
  const cover = resolveAssetReference(row.coverImageUrl, n, toUrl);
  const map = resolveAssetReference(row.mapImageUrl, n, toUrl);
  const gallery = (row.galleryImages || []).map((u) =>
    resolveAssetReference(u, n, toUrl)
  );
  // The display-screen backdrop follows the same { url, storagePath } pair,
  // but only for rows that actually carry the column (a row that omits it —
  // e.g. a narrow select in an unrelated route — must not gain an empty field).
  const displayBackground =
    row.displayBackgroundImageUrl !== undefined
      ? resolveAssetReference(row.displayBackgroundImageUrl, n, toUrl)
      : null;
  return {
    ...row,
    logoUrl: logo.url ?? '',
    coverImageUrl: cover.url ?? null,
    mapImageUrl: map.url ?? null,
    galleryImages: gallery.map((g) => g.url ?? g.reference ?? ''),
    logoStoragePath: logo.reference ?? '',
    coverStoragePath: cover.reference ?? null,
    mapStoragePath: map.reference ?? null,
    galleryStoragePaths: gallery.map((g) => g.reference ?? ''),
    ...(displayBackground
      ? {
          displayBackgroundImageUrl: displayBackground.url,
          displayBackgroundStoragePath: displayBackground.reference,
        }
      : {}),
  };
}
