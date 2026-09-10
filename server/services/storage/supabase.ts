import { createClient } from '@supabase/supabase-js';
import type { StoredObject, StorageService, StorageUploadParams } from './index';
import { buildStorageKey, supabaseKeyFromUrl } from './helpers';

// ============================================================
// SupabaseStorageDriver — production object storage.
//
// Supabase Storage exposes an S3-compatible API, has a generous
// free tier, and its JS SDK (`@supabase/supabase-js`) is already
// a project dependency — so no new provider SDK is required.
// Credentials are the SERVICE_ROLE key (server-side only, never
// shipped to the frontend). The bucket must be PUBLIC for guest
// menu images to load without a signed URL; writes are protected
// by the service-role key which the browser never sees.
// ============================================================

export interface SupabaseStorageOptions {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

/**
 * Thin adapter seam over the Supabase client. Kept as an interface so tests
 * can inject a fake and exercise failure paths without network/credentials.
 */
export interface SupabaseStorageAdapter {
  upload(key: string, data: Buffer, contentType: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  getPublicUrl(key: string): string;
  listNames(folder: string, search: string): Promise<string[]>;
}

export function createSupabaseAdapter(
  options: SupabaseStorageOptions
): SupabaseStorageAdapter {
  const client = createClient(options.url, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = client.storage.from(options.bucket);

  return {
    async upload(key, data, contentType) {
      const { error } = await bucket.upload(key, data, {
        contentType,
        cacheControl: '31536000',
        upsert: true,
      });
      if (error) throw new Error(error.message || 'storage upload failed');
    },
    async remove(keys) {
      const { error } = await bucket.remove(keys);
      if (error) throw new Error(error.message || 'storage delete failed');
    },
    getPublicUrl(key) {
      const { data } = bucket.getPublicUrl(key);
      return data.publicUrl;
    },
    async listNames(folder, search) {
      const { data, error } = await bucket.list(folder, { search, limit: 1 });
      if (error) throw new Error(error.message || 'storage list failed');
      return (data ?? []).map((f) => f.name);
    },
  };
}

export class SupabaseStorageDriver implements StorageService {
  readonly driver = 'supabase' as const;
  readonly persistent = true;

  private readonly bucket: string;
  private readonly adapter: SupabaseStorageAdapter;

  constructor(options: SupabaseStorageOptions, adapter?: SupabaseStorageAdapter) {
    this.bucket = options.bucket;
    this.adapter = adapter ?? createSupabaseAdapter(options);
  }

  getUrl(key: string): string {
    return this.adapter.getPublicUrl(key);
  }

  keyFromUrl(url: string): string | null {
    return supabaseKeyFromUrl(url, this.bucket);
  }

  async upload(params: StorageUploadParams): Promise<StoredObject> {
    const key = buildStorageKey({
      restaurantId: params.restaurantId,
      kind: params.kind,
      ext: params.ext,
    });
    await this.adapter.upload(key, params.buffer, params.mimeType);
    return {
      key,
      url: this.getUrl(key),
      mimeType: params.mimeType,
      size: params.size,
    };
  }

  async delete(key: string): Promise<void> {
    this.assertSafeKey(key);
    await this.adapter.remove([key]);
  }

  async exists(key: string): Promise<boolean> {
    this.assertSafeKey(key);
    const slash = key.lastIndexOf('/');
    const folder = slash === -1 ? '' : key.slice(0, slash);
    const name = slash === -1 ? key : key.slice(slash + 1);
    const names = await this.adapter.listNames(folder, name);
    return names.includes(name);
  }

  private assertSafeKey(key: string): void {
    if (
      typeof key !== 'string' ||
      !key ||
      key.includes('..') ||
      key.includes('\\') ||
      key.startsWith('/')
    ) {
      throw new Error('invalid storage key');
    }
  }
}
