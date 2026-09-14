import { createClient } from '@supabase/supabase-js';
import type {
  PrivateObjectBody,
  PrivateStorageService,
  PrivateUploadParams,
  StoredObject,
  StoredPrivateObject,
  StorageService,
  StorageUploadParams,
} from './index';
import { buildPaymentProofKey, buildStorageKey, supabaseKeyFromUrl } from './helpers';

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
  /** Authenticated (service-role) download — used for the PRIVATE namespace. */
  download(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  /** Idempotent bucket creation (private buckets are never public-read). */
  ensureBucket(bucket: string): Promise<void>;
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
    async download(key) {
      const { data, error } = await bucket.download(key);
      if (error || !data) return null;
      return {
        body: Buffer.from(await data.arrayBuffer()),
        contentType: data.type || 'application/octet-stream',
      };
    },
    async ensureBucket(name) {
      // createBucket is idempotent in practice: an existing bucket answers with
      // an error we deliberately ignore. Private receipts must never live in a
      // public-read bucket, so `public: false` is explicit and non-negotiable.
      const { error } = await client.storage.createBucket(name, { public: false });
      if (error && !/exist/i.test(error.message || '')) {
        throw new Error(error.message || 'bucket creation failed');
      }
    },
  };
}

export class SupabaseStorageDriver implements StorageService, PrivateStorageService {
  readonly driver = 'supabase' as const;
  readonly persistent = true;

  private readonly bucket: string;
  private readonly adapter: SupabaseStorageAdapter;
  /**
   * PRIVATE bucket for transfer receipts. It is a distinct bucket from the
   * public asset bucket, so a receipt object can never be reached through the
   * public `/object/public/...` URL shape — not even by guessing its key.
   */
  private readonly privateBucket: string;
  private readonly privateAdapter: SupabaseStorageAdapter;

  constructor(
    options: SupabaseStorageOptions,
    adapter?: SupabaseStorageAdapter,
    privateBucket?: string,
    privateAdapter?: SupabaseStorageAdapter
  ) {
    this.bucket = options.bucket;
    this.adapter = adapter ?? createSupabaseAdapter(options);
    this.privateBucket = privateBucket || `${options.bucket}-private`;
    this.privateAdapter =
      privateAdapter ??
      createSupabaseAdapter({ ...options, bucket: this.privateBucket });
  }

  get destination(): string {
    return this.privateBucket;
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

  // ==========================================================
  // PRIVATE namespace (transfer receipts)
  // ==========================================================

  async uploadPrivate(params: PrivateUploadParams): Promise<StoredPrivateObject> {
    const key = buildPaymentProofKey({
      restaurantId: params.restaurantId,
      orderId: params.orderId,
      ext: params.ext,
    });
    await this.privateAdapter.upload(key, params.buffer, params.mimeType);
    return { key, mimeType: params.mimeType, size: params.size };
  }

  async readPrivate(key: string): Promise<PrivateObjectBody | null> {
    this.assertSafeKey(key);
    const stored = await this.privateAdapter.download(key);
    if (!stored) return null;
    // Normalized to a plain Buffer so callers (and the response writer) never
    // depend on the SDK's Blob/ArrayBuffer view type.
    return { body: Buffer.from(stored.body), mimeType: stored.contentType };
  }

  async deletePrivate(key: string): Promise<void> {
    this.assertSafeKey(key);
    // Removing a missing object is a no-op for Supabase Storage, which keeps
    // the retention sweep idempotent.
    await this.privateAdapter.remove([key]);
  }

  async ensureReady(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.privateAdapter.ensureBucket(this.privateBucket);
      await this.privateAdapter.listNames('__healthcheck__', 'readiness-probe');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
