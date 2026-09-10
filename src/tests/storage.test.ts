import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  STORAGE_KINDS,
  buildStorageKey,
  keyBelongsToRestaurant,
  localKeyFromUrl,
  normalizeKind,
  sanitizePathSegment,
  supabaseKeyFromUrl,
} from '../../server/services/storage/helpers';
import {
  sniffImage,
  MAX_IMAGE_BYTES,
  isWithinUploadSizeLimit,
} from '../../server/services/storage/imageSniff';
import { LocalStorageDriver } from '../../server/services/storage/local';
import { SupabaseStorageDriver } from '../../server/services/storage/supabase';
import { deleteManagedAssets } from '../../server/services/storage/cleanup';

// ---- tiny valid image fixtures -------------------------------------------
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const HTML = Buffer.from('<!doctype html><html></html>');
const TEXT = Buffer.from('hello world, not an image at all');

describe('storage helpers', () => {
  it('builds a tenant-scoped, collision-free key', () => {
    const a = buildStorageKey({ restaurantId: 'r-1', kind: 'product', ext: '.png' });
    const b = buildStorageKey({ restaurantId: 'r-1', kind: 'product', ext: '.png' });
    expect(a).toMatch(/^restaurants\/r-1\/products\/[0-9a-f-]{36}\.png$/);
    expect(a).not.toBe(b); // no collisions
  });

  it('sanitizes hostile path segments (traversal prevention)', () => {
    // A restaurantId of "../../etc/passwd" is stripped of every `/` and `.`,
    // so it can never escape its tenant folder via path traversal.
    expect(sanitizePathSegment('../../etc/passwd')).toBe('etcpasswd');
    const key = buildStorageKey({
      restaurantId: '../../etc/passwd',
      kind: 'logo',
      ext: '.jpg',
    });
    expect(key).not.toContain('..');
    expect(key).not.toContain('\\');
    expect(key.startsWith('restaurants/etcpasswd/logo/')).toBe(true);
  });

  it('normalizes kind to the allowlist, falling back to general', () => {
    expect(normalizeKind('product')).toBe('product');
    expect(normalizeKind('logo')).toBe('logo');
    expect(normalizeKind('../../evil')).toBe('general');
    expect(normalizeKind(undefined)).toBe('general');
    expect(STORAGE_KINDS).toContain('general');
  });

  it('enforces tenant ownership of keys (tenant isolation)', () => {
    const key = buildStorageKey({ restaurantId: 'rest-A', kind: 'cover', ext: '.png' });
    expect(keyBelongsToRestaurant(key, 'rest-A')).toBe(true);
    expect(keyBelongsToRestaurant(key, 'rest-B')).toBe(false);
    expect(keyBelongsToRestaurant(key, null)).toBe(false);
    expect(keyBelongsToRestaurant(`restaurants/rest-A/../../rest-B/x.png`, 'rest-A')).toBe(false);
  });

  it('maps local and supabase URLs back to keys (rejecting traversal)', () => {
    expect(localKeyFromUrl('/uploads/restaurants/r1/logo/a.png')).toBe('restaurants/r1/logo/a.png');
    expect(localKeyFromUrl('/uploads/../../etc/passwd')).toBeNull();
    expect(localKeyFromUrl('https://cdn.example.com/x.png')).toBeNull();

    const supUrl = 'https://abc.supabase.co/storage/v1/object/public/bucket/restaurants/r1/products/a.png';
    expect(supabaseKeyFromUrl(supUrl, 'bucket')).toBe('restaurants/r1/products/a.png');
    expect(supabaseKeyFromUrl(supUrl, 'other-bucket')).toBeNull();
    expect(supabaseKeyFromUrl('https://abc.supabase.co/storage/v1/object/public/bucket/../../x', 'bucket')).toBeNull();
  });

  it('sanitizes arbitrary segments', () => {
    expect(sanitizePathSegment('a/b\\c')).toBe('abc');
    expect(sanitizePathSegment('rest-1_x')).toBe('rest-1_x');
  });
});

describe('image validation', () => {
  it('accepts real PNG/JPEG magic bytes and rejects non-images', () => {
    expect(sniffImage(PNG)?.ext).toBe('.png');
    expect(sniffImage(JPEG)?.mimeType).toBe('image/jpeg');
    expect(sniffImage(HTML)).toBeNull(); // HTML / SVG / script → rejected
    expect(sniffImage(TEXT)).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it('enforces the 5MB size cap', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(isWithinUploadSizeLimit(1024)).toBe(true);
    expect(isWithinUploadSizeLimit(MAX_IMAGE_BYTES)).toBe(true);
    expect(isWithinUploadSizeLimit(MAX_IMAGE_BYTES + 1)).toBe(false); // oversized
    expect(isWithinUploadSizeLimit(Number.NaN)).toBe(false);
  });
});

describe('LocalStorageDriver (dev/test)', () => {
  function makeDriver() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mureeh-storage-'));
    return { dir, driver: new LocalStorageDriver({ baseDir: dir }) };
  }

  it('uploads, serves, lists and deletes with tenant-scoped keys', async () => {
    const { dir, driver } = makeDriver();
    try {
      const stored = await driver.upload({
        restaurantId: 'r1',
        kind: 'logo',
        buffer: PNG,
        mimeType: 'image/png',
        ext: '.png',
        size: PNG.length,
      });
      expect(stored.key.startsWith('restaurants/r1/logo/')).toBe(true);
      expect(stored.url).toBe(`/uploads/${stored.key}`);
      expect(await driver.exists(stored.key)).toBe(true);
      expect(driver.keyFromUrl(stored.url)).toBe(stored.key);
      expect(fs.existsSync(path.join(dir, stored.key))).toBe(true);

      await driver.delete(stored.key);
      expect(await driver.exists(stored.key)).toBe(false);
      await driver.delete(stored.key); // idempotent — no throw
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects traversal keys on delete', async () => {
    const { dir, driver } = makeDriver();
    try {
      await expect(driver.delete('../../etc/passwd')).rejects.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SupabaseStorageDriver', () => {
  function makeFakeAdapter() {
    const uploaded: Array<{ key: string }> = [];
    const removed: string[][] = [];
    const adapter = {
      async upload(key: string) {
        uploaded.push({ key });
      },
      async remove(keys: string[]) {
        removed.push(keys);
      },
      getPublicUrl(key: string) {
        return `https://proj.supabase.co/storage/v1/object/public/bucket/${key}`;
      },
      async listNames() {
        return [] as string[];
      },
    };
    const driver = new SupabaseStorageDriver(
      { url: 'https://proj.supabase.co', serviceRoleKey: 'key', bucket: 'bucket' },
      adapter
    );
    return { uploaded, removed, driver };
  }

  it('uploads to a tenant-scoped key and returns the permanent URL', async () => {
    const { uploaded, driver } = makeFakeAdapter();
    const stored = await driver.upload({
      restaurantId: 'r1',
      kind: 'product',
      buffer: JPEG,
      mimeType: 'image/jpeg',
      ext: '.jpg',
      size: JPEG.length,
    });
    expect(uploaded).toHaveLength(1);
    expect(stored.key.startsWith('restaurants/r1/products/')).toBe(true);
    expect(stored.url).toContain(stored.key);
    expect(driver.keyFromUrl(stored.url)).toBe(stored.key);
    expect(driver.persistent).toBe(true);
  });

  it('propagates upload failures (no partial success)', async () => {
    const adapter = {
      async upload() {
        throw new Error('network down');
      },
      async remove() {},
      getPublicUrl(key: string) {
        return `https://x/bucket/${key}`;
      },
      async listNames() {
        return [] as string[];
      },
    };
    const driver = new SupabaseStorageDriver(
      { url: 'https://proj.supabase.co', serviceRoleKey: 'key', bucket: 'bucket' },
      adapter
    );
    await expect(
      driver.upload({ restaurantId: 'r1', kind: 'logo', buffer: PNG, mimeType: 'image/png', ext: '.png', size: 4 })
    ).rejects.toThrow('network down');
  });

  it('propagates delete failures', async () => {
    const adapter = {
      async upload() {},
      async remove() {
        throw new Error('delete rejected');
      },
      getPublicUrl(key: string) {
        return `https://x/bucket/${key}`;
      },
      async listNames() {
        return [] as string[];
      },
    };
    const driver = new SupabaseStorageDriver(
      { url: 'https://proj.supabase.co', serviceRoleKey: 'key', bucket: 'bucket' },
      adapter
    );
    await expect(driver.delete('restaurants/r1/logo/a.png')).rejects.toThrow('delete rejected');
  });
});

describe('deleteManagedAssets (replacement cleanup)', () => {
  function fakeStorage(bucket: string) {
    const deleted: string[] = [];
    return {
      deleted,
      storage: {
        keyFromUrl(url: string) {
          return supabaseKeyFromUrl(url, bucket);
        },
        async delete(key: string) {
          deleted.push(key);
        },
      },
    };
  }

  it('deletes only the current tenant’s files, skipping foreign and external URLs', async () => {
    const { deleted, storage } = fakeStorage('bucket');
    const result = await deleteManagedAssets(storage, 'rest-A', [
      'https://x/storage/v1/object/public/bucket/restaurants/rest-A/logo/a.png', // owned → delete
      'https://x/storage/v1/object/public/bucket/restaurants/rest-B/logo/b.png', // foreign → skip
      'https://images.unsplash.com/seed.jpg', // external → skip
      null,
    ]);
    expect(result.deleted).toEqual([
      'https://x/storage/v1/object/public/bucket/restaurants/rest-A/logo/a.png',
    ]);
    expect(deleted).toEqual(['restaurants/rest-A/logo/a.png']);
    expect(result.skipped).toHaveLength(2); // foreign tenant + external (null ignored)
    expect(result.failed).toHaveLength(0);
  });

  it('logs and continues when a delete fails (never throws)', async () => {
    const storage = {
      keyFromUrl(url: string) {
        return supabaseKeyFromUrl(url, 'bucket');
      },
      async delete(key: string) {
        if (key.includes('rest-A')) throw new Error('boom');
      },
    };
    const result = await deleteManagedAssets(storage, 'rest-A', [
      'https://x/storage/v1/object/public/bucket/restaurants/rest-A/logo/a.png',
      'https://x/storage/v1/object/public/bucket/restaurants/rest-A/logo/b.png',
    ]);
    expect(result.failed).toHaveLength(2);
    expect(result.deleted).toHaveLength(0);
  });
});
