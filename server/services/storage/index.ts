import { config } from '../config';
import { LocalStorageDriver } from './local';
import { SupabaseStorageDriver } from './supabase';
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
