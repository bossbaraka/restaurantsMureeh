/**
 * Behavioral tests for the shared client image optimizer policy
 * (src/utils/imageOptimize.ts). Pure logic only — the canvas pipeline
 * itself needs a browser and is exercised end-to-end by the real upload
 * flow (magic bytes / size / tenant ownership are re-validated by the
 * server regardless).
 */
import { describe, expect, it } from 'vitest';
import {
  IMAGE_KIND_POLICIES,
  computeTargetSize,
  extForFormat,
  pickOutputFormat,
  policyForKind,
} from '../utils/imageOptimize';

describe('per-kind policies', () => {
  it('matches the production hardening defaults', () => {
    expect(IMAGE_KIND_POLICIES.product).toEqual({ maxW: 1200, maxH: 1200, quality: 0.82 });
    expect(IMAGE_KIND_POLICIES.logo).toEqual({ maxW: 1000, maxH: 1000, quality: 0.85 });
    expect(IMAGE_KIND_POLICIES.cover).toEqual({ maxW: 1600, maxH: 1000, quality: 0.82 });
    expect(IMAGE_KIND_POLICIES.gallery).toEqual({ maxW: 1600, maxH: 1200, quality: 0.8 });
  });

  it('unknown kinds fall back to the general policy, never undefined', () => {
    expect(policyForKind(undefined)).toBe(IMAGE_KIND_POLICIES.general);
    expect(policyForKind('nonsense')).toBe(IMAGE_KIND_POLICIES.general);
    expect(policyForKind('product')).toBe(IMAGE_KIND_POLICIES.product);
  });
});

describe('computeTargetSize', () => {
  const policy = IMAGE_KIND_POLICIES.product;

  it('downscales a large image preserving aspect ratio', () => {
    expect(computeTargetSize(2400, 1200, policy)).toEqual({ width: 1200, height: 600 });
    expect(computeTargetSize(1200, 2400, policy)).toEqual({ width: 600, height: 1200 });
  });

  it('fits inside the box by the constraining dimension (cover banner)', () => {
    const cover = IMAGE_KIND_POLICIES.cover; // 1600 x 1000
    expect(computeTargetSize(3200, 2400, cover)).toEqual({ width: 1333, height: 1000 });
  });

  it('NEVER upscales small images', () => {
    expect(computeTargetSize(320, 240, policy)).toEqual({ width: 320, height: 240 });
    expect(computeTargetSize(1, 1, policy)).toEqual({ width: 1, height: 1 });
  });

  it('guards against degenerate inputs', () => {
    const result = computeTargetSize(0, 0, policy);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});

describe('pickOutputFormat', () => {
  it('prefers WebP for opaque photos when the encoder supports it', () => {
    expect(pickOutputFormat('image/jpeg', true, false)).toBe('image/webp');
    expect(pickOutputFormat('image/png', true, false)).toBe('image/webp');
  });

  it('falls back to JPEG when WebP is unsupported', () => {
    expect(pickOutputFormat('image/jpeg', false, false)).toBe('image/jpeg');
  });

  it('keeps PNG when real transparency exists (logos must not flatten)', () => {
    expect(pickOutputFormat('image/png', true, true)).toBe('image/png');
    expect(pickOutputFormat('image/png', false, true)).toBe('image/png');
  });

  it('passes GIF through untouched (animation survives)', () => {
    expect(pickOutputFormat('image/gif', true, false)).toBe('image/gif');
    expect(pickOutputFormat('image/gif', false, false)).toBe('image/gif');
  });
});

describe('extForFormat', () => {
  it('maps encode targets to safe upload extensions', () => {
    expect(extForFormat('image/webp')).toBe('webp');
    expect(extForFormat('image/jpeg')).toBe('jpg');
    expect(extForFormat('image/png')).toBe('png');
    expect(extForFormat('image/gif')).toBe('gif');
  });
});
