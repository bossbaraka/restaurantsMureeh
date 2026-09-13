import { describe, it, expect } from 'vitest';
import {
  STORAGE_KEY_PREFIX,
  isStorageKey,
  normalizeAssetReference,
  resolveAssetReference,
  absolutizePublicUrl,
  resolveRestaurantAssets,
  type AssetNormalizer,
} from '../../server/services/storage/resolve';
import {
  keyBelongsToRestaurant,
  buildStorageKey,
} from '../../server/services/storage/helpers';

/**
 * Pure unit tests for the theme-image persistence contract — the SINGLE
 * resolver that converts the stable references persisted in PostgreSQL
 * into renderable URLs, and that normalizes incoming untrusted values
 * back into stable references before persistence.
 *
 * No database, no env, no drivers: the module under test is pure and the
 * driver behaviour is faked through the AssetNormalizer seam.
 */

// A fake driver mirroring the real drivers' marker-based folding:
// local: the `/uploads/` marker anywhere (any host), supabase-style: the
// `https://cdn.test/storage/` prefix.
const FAKE = (key: string): string => `/uploads/${key}`;
const fakeNormalizer: AssetNormalizer = {
  keyFromUrl: (value: string): string | null => {
    const v = String(value).trim();
    const localIdx = v.indexOf('/uploads/');
    if (localIdx !== -1) {
      const key = v.slice(localIdx + '/uploads/'.length);
      return key && !key.includes('..') ? key : null;
    }
    if (v.startsWith('https://cdn.test/storage/')) {
      return v.slice('https://cdn.test/storage/'.length) || null;
    }
    return null;
  },
};
const toLocalUrl = (key: string): string => FAKE(key);
const toAbsUrl = (key: string): string => `http://api.test:3001${FAKE(key)}`;

describe('isStorageKey — stable reference shape', () => {
  it('accepts a tenant-scoped object key', () => {
    const key = buildStorageKey({ restaurantId: 'r-1', kind: 'logo', ext: '.png' });
    expect(key).toMatch(/^restaurants\/r-1\/logo\//);
    expect(isStorageKey(key)).toBe(true);
  });

  it('rejects traversal, backslashes, double slashes and URLs', () => {
    expect(isStorageKey('restaurants/../secrets.png')).toBe(false);
    expect(isStorageKey('restaurants\\r-1\\logo.png')).toBe(false);
    expect(isStorageKey('restaurants//r-1/logo.png')).toBe(false);
    expect(isStorageKey('/uploads/restaurants/r-1/logo.png')).toBe(false);
    expect(isStorageKey('https://cdn.test/storage/restaurants/r-1/logo.png')).toBe(false);
    expect(isStorageKey('')).toBe(false);
    expect(isStorageKey(null)).toBe(false);
    expect(isStorageKey(42)).toBe(false);
  });

  it('exposes the canonical prefix used everywhere', () => {
    expect(STORAGE_KEY_PREFIX).toBe('restaurants/');
  });
});

describe('normalizeAssetReference — the write contract', () => {
  it('maps null / empty / whitespace to an EXPLICIT clear', () => {
    expect(normalizeAssetReference(null, fakeNormalizer)).toEqual({ kind: 'clear' });
    expect(normalizeAssetReference('', fakeNormalizer)).toEqual({ kind: 'clear' });
    expect(normalizeAssetReference('   ', fakeNormalizer)).toEqual({ kind: 'clear' });
  });

  it('keeps a tenant-scoped key verbatim (canonical form)', () => {
    const key = 'restaurants/r-1/logo/uuid.png';
    expect(normalizeAssetReference(key, fakeNormalizer)).toEqual({ kind: 'key', reference: key });
  });

  it('folds a managed URL (any host) back into its object key', () => {
    const key = 'restaurants/r-1/logo/uuid.png';
    expect(normalizeAssetReference(FAKE(key), fakeNormalizer)).toEqual({ kind: 'key', reference: key });
    // Supabase-style public URL on a different origin folds the same way:
    expect(normalizeAssetReference(`https://cdn.test/storage/${key}`, fakeNormalizer)).toEqual({
      kind: 'key',
      reference: key,
    });
  });

  it('keeps an external absolute URL verbatim', () => {
    const url = 'https://images.unsplash.com/photo-123.jpg';
    expect(normalizeAssetReference(url, fakeNormalizer)).toEqual({ kind: 'external', reference: url });
  });

  it('rejects data:, blob:, file:, script and protocol-relative payloads', () => {
    expect(normalizeAssetReference('data:image/png;base64,AAAA', fakeNormalizer).kind).toBe('reject');
    expect(normalizeAssetReference('blob:https://app.test/123', fakeNormalizer).kind).toBe('reject');
    expect(normalizeAssetReference('file:///etc/passwd', fakeNormalizer).kind).toBe('reject');
    expect(normalizeAssetReference('javascript:alert(1)', fakeNormalizer).kind).toBe('reject');
    expect(normalizeAssetReference('vbscript:msgbox', fakeNormalizer).kind).toBe('reject');
    expect(normalizeAssetReference('//evil.test/logo.png', fakeNormalizer).kind).toBe('reject');
  });

  it('rejects unrenderable bare paths and unknown schemes', () => {
    expect(normalizeAssetReference('C:\\\\images\\logo.png', fakeNormalizer).kind).toBe('reject');
    expect(normalizeAssetReference('ftp://cdn.test/logo.png', fakeNormalizer).kind).toBe('reject');
    expect(normalizeAssetReference('not a url at all', fakeNormalizer).kind).toBe('reject');
  });

  it('rejects non-string payloads', () => {
    expect(normalizeAssetReference(123, fakeNormalizer).kind).toBe('reject');
    expect(normalizeAssetReference({ url: 'x' }, fakeNormalizer).kind).toBe('reject');
  });
});

describe('resolveAssetReference — the read contract (total)', () => {
  it('resolves a stored key to { reference=key, url=renderable }', () => {
    const key = 'restaurants/r-1/logo/uuid.png';
    expect(resolveAssetReference(key, fakeNormalizer, toLocalUrl)).toEqual({
      reference: key,
      url: FAKE(key),
    });
    // Same key, split deployment: the URL is absolutized with the origin.
    expect(resolveAssetReference(key, fakeNormalizer, toAbsUrl).url).toBe(`http://api.test:3001${FAKE(key)}`);
  });

  it('resolves a legacy stored /uploads URL to the same stable key + URL', () => {
    const key = 'restaurants/r-1/logo/uuid.png';
    const r = resolveAssetReference(FAKE(key), fakeNormalizer, toLocalUrl);
    expect(r.reference).toBe(key);
    expect(r.url).toBe(FAKE(key));
  });

  it('resolves a legacy absolute local URL (old host) to key + current URL', () => {
    const key = 'restaurants/r-1/logo/uuid.png';
    const r = resolveAssetReference(`http://old-host:3001${FAKE(key)}`, fakeNormalizer, toLocalUrl);
    // The old host is not part of the reference; the URL is re-rendered
    // by the CURRENT driver.
    expect(r.reference).toBe(key);
    expect(r.url).toBe(FAKE(key));
  });

  it('passes external URLs through (renderable as-is)', () => {
    const url = 'https://images.unsplash.com/photo-123.jpg';
    expect(resolveAssetReference(url, fakeNormalizer, toLocalUrl)).toEqual({ reference: url, url });
  });

  it('keeps a legacy data:image URI renderable (historical rows)', () => {
    const legacy = 'data:image/png;base64,AAAA';
    expect(resolveAssetReference(legacy, fakeNormalizer, toLocalUrl).url).toBe(legacy);
  });

  it('returns { null, null } for absent values and never throws', () => {
    expect(resolveAssetReference(null, fakeNormalizer, toLocalUrl)).toEqual({ reference: null, url: null });
    expect(resolveAssetReference('', fakeNormalizer, toLocalUrl)).toEqual({ reference: null, url: null });
    expect(resolveAssetReference('   ', fakeNormalizer, toLocalUrl)).toEqual({ reference: null, url: null });
    // Unknown legacy shape: reference preserved, no URL advertised.
    const r = resolveAssetReference('weird:legacy', fakeNormalizer, toLocalUrl);
    expect(r.reference).toBe('weird:legacy');
    expect(r.url).toBeNull();
  });
});

describe('absolutizePublicUrl — split-deployment resolution', () => {
  it('absolutizes relative URLs with the public origin', () => {
    expect(absolutizePublicUrl('/uploads/k.png', 'http://api.test:3001/')).toBe('http://api.test:3001/uploads/k.png');
    expect(absolutizePublicUrl('/uploads/k.png', 'http://api.test:3001')).toBe('http://api.test:3001/uploads/k.png');
    expect(absolutizePublicUrl('uploads/k.png', 'http://api.test:3001')).toBe('http://api.test:3001/uploads/k.png');
  });

  it('leaves absolute URLs untouched', () => {
    const abs = 'https://cdn.test/storage/k.png';
    expect(absolutizePublicUrl(abs, 'http://api.test:3001')).toBe(abs);
  });

  it('keeps relative URLs relative without an origin (same-origin deployment)', () => {
    expect(absolutizePublicUrl('/uploads/k.png', '')).toBe('/uploads/k.png');
  });
});

describe('resolveRestaurantAssets — the one response mapper', () => {
  const row = {
    logoUrl: 'restaurants/r-1/logo/l.png',
    coverImageUrl: FAKE('restaurants/r-1/cover/c.png'), // legacy stored form
    mapImageUrl: 'https://maps.test/m.png',
    galleryImages: [
      FAKE('restaurants/r-1/gallery/g1.png'),
      'https://cdn.test/gallery/g2.jpg',
    ],
    // A non-asset field that must pass through untouched:
    primaryColor: '#D4AF37',
  } as const;

  it('returns renderable URLs in the existing fields', () => {
    const out = resolveRestaurantAssets({ ...row }, fakeNormalizer, toLocalUrl);
    expect(out.logoUrl).toBe(FAKE('restaurants/r-1/logo/l.png'));
    expect(out.coverImageUrl).toBe(FAKE('restaurants/r-1/cover/c.png'));
    expect(out.mapImageUrl).toBe('https://maps.test/m.png');
    expect(out.galleryImages).toEqual([
      FAKE('restaurants/r-1/gallery/g1.png'),
      'https://cdn.test/gallery/g2.jpg',
    ]);
  });

  it('adds the stable references as the *StoragePath pair', () => {
    const out = resolveRestaurantAssets({ ...row }, fakeNormalizer, toLocalUrl);
    expect(out.logoStoragePath).toBe('restaurants/r-1/logo/l.png');
    expect(out.coverStoragePath).toBe('restaurants/r-1/cover/c.png');
    expect(out.mapStoragePath).toBe('https://maps.test/m.png'); // external: the URL IS the reference
    expect(out.galleryStoragePaths).toEqual([
      'restaurants/r-1/gallery/g1.png',
      'https://cdn.test/gallery/g2.jpg',
    ]);
  });

  it('maps cleared/absent assets to empty values (never undefined URLs)', () => {
    const out = resolveRestaurantAssets(
      { logoUrl: '', coverImageUrl: null, mapImageUrl: null, galleryImages: [] },
      fakeNormalizer,
      toLocalUrl
    );
    expect(out.logoUrl).toBe('');
    expect(out.coverImageUrl).toBeNull();
    expect(out.mapImageUrl).toBeNull();
    expect(out.galleryImages).toEqual([]);
    expect(out.logoStoragePath).toBe('');
    expect(out.coverStoragePath).toBeNull();
    expect(out.galleryStoragePaths).toEqual([]);
  });

  it('absolutizes in split deployments but keeps references host-free', () => {
    const out = resolveRestaurantAssets({ ...row }, fakeNormalizer, toAbsUrl);
    expect(out.logoUrl).toBe('http://api.test:3001' + FAKE('restaurants/r-1/logo/l.png'));
    // The stored reference never embeds the origin:
    expect(out.logoStoragePath).not.toContain('http');
    expect(out.coverStoragePath).not.toContain('http');
  });

  it('preserves the rest of the row', () => {
    const out = resolveRestaurantAssets({ ...row }, fakeNormalizer, toLocalUrl);
    expect(out.primaryColor).toBe('#D4AF37');
  });
});

describe('tenant isolation of keys', () => {
  it('a key belongs only to its own tenant folder', () => {
    const key = buildStorageKey({ restaurantId: 'tenant-a', kind: 'logo', ext: '.png' });
    expect(keyBelongsToRestaurant(key, 'tenant-a')).toBe(true);
    expect(keyBelongsToRestaurant(key, 'tenant-b')).toBe(false);
    expect(keyBelongsToRestaurant(key, '')).toBe(false);
  });

  it('a tenant can never resolve another tenant key through the write contract', () => {
    const foreign = buildStorageKey({ restaurantId: 'tenant-b', kind: 'logo', ext: '.png' });
    const n = normalizeAssetReference(foreign, fakeNormalizer);
    // The value IS normalized to a key — enforcement (keyBelongsToRestaurant)
    // is the route's job and rejects it for the caller tenant.
    expect(n.kind).toBe('key');
    if (n.kind === 'key') {
      expect(keyBelongsToRestaurant(n.reference, 'tenant-a')).toBe(false);
    }
  });
});
