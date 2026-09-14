import fs from 'fs';
import path from 'path';
import type {
  PrivateObjectBody,
  PrivateStorageService,
  PrivateUploadParams,
  StoredObject,
  StoredPrivateObject,
  StorageService,
  StorageUploadParams,
} from './index';
import {
  buildPaymentProofKey,
  buildStorageKey,
  LOCAL_PUBLIC_PREFIX,
  localKeyFromUrl,
} from './helpers';

// ============================================================
// LocalStorageDriver — development, test, and explicitly opted-in
// self-hosted storage.
//
// Writes files under `baseDir` (default ./uploads) in the SAME
// tenant-scoped key layout as the object-storage driver, and
// serves them at `/uploads/{key}`. In production config.ts FAILS
// CLOSED and refuses to boot with this driver unless
// STORAGE_ALLOW_LOCAL_IN_PROD=true is set for a deployment that
// mounts a real persistent volume at UPLOAD_DIR — there is never
// an automatic supabase -> local fallback in production.
// ============================================================

export interface LocalStorageOptions {
  baseDir: string;
  publicPrefix?: string;
  /**
   * Directory for the PRIVATE namespace (transfer receipts). It is never
   * mounted on `express.static`, so files under it are only reachable through
   * the authenticated API route. Defaults to `<baseDir>-private`.
   */
  privateBaseDir?: string;
}

export class LocalStorageDriver implements StorageService, PrivateStorageService {
  readonly driver = 'local' as const;
  readonly persistent = false;

  private readonly baseDir: string;
  private readonly privateBaseDir: string;
  private readonly publicPrefix: string;

  constructor(options: LocalStorageOptions) {
    this.baseDir = path.resolve(process.cwd(), options.baseDir);
    this.privateBaseDir = path.resolve(
      process.cwd(),
      options.privateBaseDir ?? `${options.baseDir}-private`
    );
    this.publicPrefix = options.publicPrefix ?? LOCAL_PUBLIC_PREFIX;
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.privateBaseDir)) {
      fs.mkdirSync(this.privateBaseDir, { recursive: true, mode: 0o700 });
    }
  }

  /** Absolute path of the on-disk base directory (used by static serving). */
  get resolvedBaseDir(): string {
    return this.baseDir;
  }

  get destination(): string {
    return this.privateBaseDir;
  }

  getUrl(key: string): string {
    return `${this.publicPrefix}${key}`;
  }

  keyFromUrl(url: string): string | null {
    return localKeyFromUrl(url);
  }

  async upload(params: StorageUploadParams): Promise<StoredObject> {
    const key = buildStorageKey({
      restaurantId: params.restaurantId,
      kind: params.kind,
      ext: params.ext,
    });
    const abs = this.resolve(key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, params.buffer);

    // Durability on crash/power-loss: fsync the file AND its parent directory
    // so the directory entry itself is persisted. Best-effort — never fail an
    // upload over an unsupported fsync.
    try {
      const fd = fs.openSync(abs, 'r+');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      const dirFd = fs.openSync(path.dirname(abs), 'r');
      try {
        fs.fsyncSync(dirFd);
      } catch {
        /* directory fsync unsupported on some platforms */
      } finally {
        fs.closeSync(dirFd);
      }
    } catch (err) {
      console.error('Upload fsync failed (durability degraded):', err);
    }

    return {
      key,
      url: this.getUrl(key),
      mimeType: params.mimeType,
      size: params.size,
    };
  }

  async delete(key: string): Promise<void> {
    const abs = this.resolve(key);
    if (!fs.existsSync(abs)) return; // idempotent
    await fs.promises.unlink(abs);
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.resolve(key));
  }

  private resolve(key: string): string {
    if (
      typeof key !== 'string' ||
      !key ||
      key.includes('..') ||
      key.includes('\\') ||
      key.startsWith('/')
    ) {
      throw new Error('invalid storage key');
    }
    const abs = path.resolve(this.baseDir, key);
    const within = abs === this.baseDir || abs.startsWith(this.baseDir + path.sep);
    if (!within) throw new Error('invalid storage key');
    return abs;
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
    const abs = this.resolvePrivate(key);
    fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    fs.writeFileSync(abs, params.buffer, { mode: 0o600 });
    return { key, mimeType: params.mimeType, size: params.size };
  }

  async readPrivate(key: string): Promise<PrivateObjectBody | null> {
    const abs = this.resolvePrivate(key);
    if (!fs.existsSync(abs)) return null;
    return { body: await fs.promises.readFile(abs), mimeType: 'application/octet-stream' };
  }

  async deletePrivate(key: string): Promise<void> {
    const abs = this.resolvePrivate(key);
    if (!fs.existsSync(abs)) return; // idempotent
    await fs.promises.unlink(abs);
  }

  async ensureReady(): Promise<{ ok: boolean; error?: string }> {
    try {
      fs.mkdirSync(this.privateBaseDir, { recursive: true, mode: 0o700 });
      fs.accessSync(this.privateBaseDir, fs.constants.W_OK);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Same containment guarantee as the public namespace, own base directory. */
  private resolvePrivate(key: string): string {
    if (
      typeof key !== 'string' ||
      !key ||
      key.includes('..') ||
      key.includes('\\') ||
      key.startsWith('/')
    ) {
      throw new Error('invalid storage key');
    }
    const abs = path.resolve(this.privateBaseDir, key);
    const within =
      abs === this.privateBaseDir || abs.startsWith(this.privateBaseDir + path.sep);
    if (!within) throw new Error('invalid storage key');
    return abs;
  }
}
