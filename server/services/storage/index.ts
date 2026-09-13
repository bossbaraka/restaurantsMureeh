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

export type { StorageKind } from './helpers';
export {
  STORAGE_KINDS,
  buildStorageKey,
  keyBelongsToRestaurant,
  localKeyFromUrl,
  normalizeKind,
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
