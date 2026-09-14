import { config } from '../../config';
import { LocalStorageDriver } from './local';
import { SupabaseStorageDriver } from './supabase';
import { absolutizePublicUrl } from './resolve';
import type { StorageKind } from './helpers';

// ============================================================
// StorageService — the single abstraction every upload/delete
// path talks to. Routes and business logic NEVER touch `fs` or
// the object-storage SDK directly; swapping providers is a
// one-line change in getStorage().
// ============================================================

export interface StorageUploadParams {
  restaurantId: string;
  kind: StorageKind;
  buffer: Buffer;
  mimeType: string;
  /** Server-derived extension (".png" etc.) — never the client filename. */
  ext: string;
  size: number;
}

export interface StoredObject {
  key: string;
  url: string;
  mimeType: string;
  size: number;
}

export interface StorageService {
  /** Identifies the concrete provider. */
  readonly driver: 'local' | 'supabase';
  /** True when files survive a process restart / redeploy. */
  readonly persistent: boolean;
  upload(params: StorageUploadParams): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Public URL for a stored key. */
  getUrl(key: string): string;
  /** Map a stored public URL back to its object key (null if foreign). */
  keyFromUrl(url: string): string | null;
}

// ============================================================
// Private storage capability (transfer payment receipts).
//
// Same storage subsystem, same tenant-scoped key contract, but a
// namespace that is NEVER publicly readable: a private object has no
// public URL at all. Reads go through an authenticated, tenant-checked
// API route, so knowing an order id or an object key grants nothing.
//
// Both concrete drivers implement it, so no second storage system,
// SDK or dependency is introduced.
// ============================================================

export interface PrivateUploadParams {
  restaurantId: string;
  orderId: string;
  buffer: Buffer;
  /** Server-derived MIME type (magic-byte sniffed), never a client value. */
  mimeType: string;
  /** Server-derived extension (".jpg" …), never the client filename. */
  ext: string;
  size: number;
}

export interface StoredPrivateObject {
  /** Object key inside the private namespace. */
  key: string;
  mimeType: string;
  size: number;
}

export interface PrivateObjectBody {
  body: Buffer;
  /** Content type as stored; callers re-sniff the bytes before serving. */
  mimeType: string;
}

export interface PrivateStorageService {
  readonly driver: 'local' | 'supabase';
  /** Human-readable destination (bucket name / directory) for logs. */
  readonly destination: string;
  uploadPrivate(params: PrivateUploadParams): Promise<StoredPrivateObject>;
  /** Returns null when the object no longer exists (idempotent reads). */
  readPrivate(key: string): Promise<PrivateObjectBody | null>;
  /** Idempotent: deleting a missing object is not an error. */
  deletePrivate(key: string): Promise<void>;
  /** Best-effort readiness check (never throws). */
  ensureReady(): Promise<{ ok: boolean; error?: string }>;
}

export type { StorageKind } from './helpers';
export {
  STORAGE_KINDS,
  PAYMENT_PROOF_KEY_PREFIX,
  buildPaymentProofKey,
  buildStorageKey,
  keyBelongsToRestaurant,
  localKeyFromUrl,
  normalizeKind,
  paymentProofKeyBelongsToRestaurant,
  sanitizePathSegment,
  supabaseKeyFromUrl,
} from './helpers';
export { LocalStorageDriver } from './local';
export { SupabaseStorageDriver } from './supabase';
export type { CleanupResult } from './cleanup';
export { deleteManagedAssets } from './cleanup';
// The single asset-reference contract (stored stable reference <-> URL).
export type {
  AssetNormalizer,
  NormalizedAsset,
  ResolvedAsset,
  RestaurantAssetRow,
} from './resolve';
export {
  STORAGE_KEY_PREFIX,
  absolutizePublicUrl,
  isStorageKey,
  normalizeAssetReference,
  resolveAssetReference,
  resolveRestaurantAssets,
} from './resolve';

/**
 * Driver wiring for the asset-reference contract. Every route that
 * persists or returns image fields goes through these two adapters so
 * there is exactly one place that knows how the active storage driver
 * maps keys <-> URLs.
 */
export function assetNormalizerFor(
  storage: Pick<StorageService, 'keyFromUrl'>
): import('./resolve').AssetNormalizer {
  return {
    keyFromUrl: (value: string) => {
      try {
        return storage.keyFromUrl(value);
      } catch {
        return null;
      }
    },
  };
}

/**
 * Build the key -> renderable URL resolver for API responses.
 * Relative URLs from the local driver are absolutized with the
 * deployment's public origin (APP_URL); the Supabase public URL is
 * already absolute and passes through.
 */
export function assetUrlResolverFor(
  storage: Pick<StorageService, 'getUrl'>,
  publicOrigin: string
): (key: string) => string {
  return (key: string) => absolutizePublicUrl(storage.getUrl(key), publicOrigin);
}

let storageSingleton: StorageService | null = null;

/**
 * Lazy singleton. Constructing a provider is cheap and side-effect-free, but
 * we keep one instance so the Supabase HTTP client (and any future pooling)
 * is shared across requests.
 */
export function getStorage(): StorageService {
  if (storageSingleton) return storageSingleton;

  if (config.storageDriver === 'supabase') {
    storageSingleton = new SupabaseStorageDriver({
      url: config.supabaseUrl!,
      serviceRoleKey: config.supabaseServiceRoleKey!,
      bucket: config.supabaseBucket,
    });
  } else {
    storageSingleton = new LocalStorageDriver({
      baseDir: config.uploadDir,
    });
  }
  return storageSingleton;
}

/** Test hook: drop the cached instance so tests can inject a fake driver. */
export function resetStorageForTests(): void {
  storageSingleton = null;
}

/**
 * Boot-time readiness probe.
 *
 * - Local driver: the base directory must exist / be creatable (the driver
 *   constructor already creates it; this re-checks writability).
 * - Object storage: list a probe key. Either "found" or "not found" is a
 *   success — both prove credentials/bucket/network work; a thrown error
 *   means the bucket is missing, the key is invalid, or credentials are
 *   wrong and image uploads would fail at runtime.
 *
 * Missing CREDENTIALS never reach here: config.ts fails closed first. This
 * probe distinguishes "configured" from "reachable".
 */
export async function verifyStorageReady(): Promise<{ ok: boolean; error?: string }> {
  try {
    const storage = getStorage();
    await storage.exists('__healthcheck__/readiness-probe');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

let privateStorageSingleton: PrivateStorageService | null = null;

/**
 * Lazy singleton for the private namespace. The concrete driver is the SAME
 * provider selected for public assets — only the destination (private bucket /
 * non-served directory) differs — so there is still exactly one storage
 * subsystem to configure, observe and operate.
 */
export function getPrivateStorage(): PrivateStorageService {
  if (privateStorageSingleton) return privateStorageSingleton;

  if (config.storageDriver === 'supabase') {
    privateStorageSingleton = new SupabaseStorageDriver(
      {
        url: config.supabaseUrl!,
        serviceRoleKey: config.supabaseServiceRoleKey!,
        bucket: config.supabaseBucket,
      },
      undefined,
      config.supabasePrivateBucket
    );
  } else {
    privateStorageSingleton = new LocalStorageDriver({
      baseDir: config.uploadDir,
      privateBaseDir: config.privateUploadDir,
    });
  }
  return privateStorageSingleton;
}

/** Test hook: drop the cached private instance alongside the public one. */
export function resetPrivateStorageForTests(): void {
  privateStorageSingleton = null;
}

/**
 * Readiness probe for the private namespace. Mirrors the public probe: it
 * never throws and reports an actionable error, so a missing private bucket is
 * visible in the deploy logs instead of surfacing as the first failed guest
 * receipt upload. `ensureReady()` is allowed to create a missing bucket with
 * the service-role key (idempotent), which removes a manual setup step.
 */
export async function verifyPrivateStorageReady(): Promise<{ ok: boolean; error?: string }> {
  try {
    return await getPrivateStorage().ensureReady();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
