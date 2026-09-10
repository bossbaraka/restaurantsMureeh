import fs from 'fs';
import path from 'path';
import type { StoredObject, StorageService, StorageUploadParams } from './index';
import { buildStorageKey, LOCAL_PUBLIC_PREFIX, localKeyFromUrl } from './helpers';

// ============================================================
// LocalStorageDriver — development/test only.
//
// Writes files under `baseDir` (default ./uploads) in the SAME
// tenant-scoped key layout as the object-storage driver, and
// serves them at `/uploads/{key}`. Production is refused by
// config.ts unless explicitly opted-in for a self-hosted
// persistent volume (STORAGE_ALLOW_LOCAL_IN_PROD=true).
// ============================================================

export interface LocalStorageOptions {
  baseDir: string;
  publicPrefix?: string;
}

export class LocalStorageDriver implements StorageService {
  readonly driver = 'local' as const;
  readonly persistent = false;

  private readonly baseDir: string;
  private readonly publicPrefix: string;

  constructor(options: LocalStorageOptions) {
    this.baseDir = path.resolve(process.cwd(), options.baseDir);
    this.publicPrefix = options.publicPrefix ?? LOCAL_PUBLIC_PREFIX;
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /** Absolute path of the on-disk base directory (used by static serving). */
  get resolvedBaseDir(): string {
    return this.baseDir;
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
}
