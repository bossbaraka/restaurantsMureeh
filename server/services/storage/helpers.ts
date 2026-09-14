import { randomUUID } from 'crypto';

// ============================================================
// Storage key helpers — pure, framework-free, unit-testable.
//
// Keys are ALWAYS server-generated and tenant-scoped:
//
//   restaurants/{restaurantId}/{folder}/{uuid}{ext}
//
// The client never supplies path segments: restaurantId comes from the
// authenticated JWT (or an explicit platform-admin target), `folder` comes
// from a fixed allowlist, and the filename is a CSPRNG UUID. This makes
// path traversal and cross-tenant collision structurally impossible.
// ============================================================

export type StorageKind =
  | 'logo'
  | 'cover'
  | 'gallery'
  | 'product'
  | 'category'
  | 'offer'
  | 'map'
  | 'general';

export const STORAGE_KINDS: readonly StorageKind[] = [
  'logo',
  'cover',
  'gallery',
  'product',
  'category',
  'offer',
  'map',
  'general',
];

const KIND_FOLDER: Record<StorageKind, string> = {
  logo: 'logo',
  cover: 'cover',
  gallery: 'gallery',
  product: 'products',
  category: 'categories',
  offer: 'offers',
  map: 'map',
  general: 'misc',
};

/** Local dev/test driver serves files under this public prefix. */
export const LOCAL_PUBLIC_PREFIX = '/uploads/';

/** Coerce an untrusted form value into a known kind; unknown → 'general'. */
export function normalizeKind(value: unknown): StorageKind {
  if (typeof value === 'string' && (STORAGE_KINDS as string[]).includes(value)) {
    return value as StorageKind;
  }
  return 'general';
}

/**
 * Strip every character that is not safe in a path segment. restaurantId is
 * a DB uuid in practice, but this is defense-in-depth so a tampered value
 * can never escape its tenant folder (no `/`, `\`, `..` or NUL survives).
 */
export function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 128);
}

/** Build a collision-free, tenant-scoped object key. */
export function buildStorageKey(params: {
  restaurantId: string;
  kind: StorageKind;
  ext: string;
}): string {
  const safeRestaurantId = sanitizePathSegment(params.restaurantId);
  const safeExt = params.ext.startsWith('.') ? params.ext : `.${params.ext}`;
  const folder = KIND_FOLDER[params.kind] ?? KIND_FOLDER.general;
  return `restaurants/${safeRestaurantId}/${folder}/${randomUUID()}${safeExt}`;
}

/** True only when `key` lives under the given tenant's own namespace. */
export function keyBelongsToRestaurant(
  key: string,
  restaurantId: string | null | undefined
): boolean {
  if (!restaurantId || typeof key !== 'string' || !key) return false;
  if (key.includes('..') || key.includes('\\') || key.startsWith('/')) return false;
  return key.startsWith(`restaurants/${restaurantId}/`);
}

// ============================================================
// PRIVATE namespace (transfer payment receipts).
//
// Private objects live in a SEPARATE, non-public location — a private
// Supabase bucket or a directory that is never mounted on
// `express.static` — so knowing a key is never enough to read the file.
// The layout is therefore independent from the public assets and is
// prefixed with its own segment, which makes an accidental cross-use of
// the public delete/serve paths impossible:
//
//   payment-proofs/restaurant/{restaurantId}/order/{orderId}/{uuid}{ext}
//
// Every segment is server-generated and sanitized; the client never
// supplies a path segment (same guarantee as the public namespace).
// ============================================================

/** Prefix that unambiguously identifies a private payment-proof object. */
export const PAYMENT_PROOF_KEY_PREFIX = 'payment-proofs/';

/** Build the tenant- and order-scoped private key for a transfer receipt. */
export function buildPaymentProofKey(params: {
  restaurantId: string;
  orderId: string;
  ext: string;
}): string {
  const safeExt = params.ext.startsWith('.') ? params.ext : `.${params.ext}`;
  return (
    `${PAYMENT_PROOF_KEY_PREFIX}restaurant/${sanitizePathSegment(params.restaurantId)}` +
    `/order/${sanitizePathSegment(params.orderId)}/${randomUUID()}${safeExt}`
  );
}

/** True only when a private key lives under the given tenant's own namespace. */
export function paymentProofKeyBelongsToRestaurant(
  key: string | null | undefined,
  restaurantId: string | null | undefined
): boolean {
  if (!restaurantId || typeof key !== 'string' || !key) return false;
  if (key.includes('..') || key.includes('\\') || key.startsWith('/')) return false;
  return key.startsWith(
    `${PAYMENT_PROOF_KEY_PREFIX}restaurant/${sanitizePathSegment(restaurantId)}/`
  );
}

/** Extract the object key from a local `/uploads/{key}` public URL. */
export function localKeyFromUrl(url: string): string | null {
  if (typeof url !== 'string') return null;
  const idx = url.indexOf(LOCAL_PUBLIC_PREFIX);
  if (idx === -1) return null;
  const key = url.slice(idx + LOCAL_PUBLIC_PREFIX.length);
  if (!key || key.includes('..') || key.includes('\\')) return null;
  return key;
}

/**
 * Extract the object key from a Supabase public URL:
 *   https://{project}.supabase.co/storage/v1/object/public/{bucket}/{key}
 */
export function supabaseKeyFromUrl(url: string, bucket: string): string | null {
  if (typeof url !== 'string' || !bucket) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  let key = url.slice(idx + marker.length);
  const queryIdx = key.search(/[?#]/);
  if (queryIdx !== -1) key = key.slice(0, queryIdx);
  let decoded: string;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('..') || decoded.includes('\\')) return null;
  return decoded;
}
