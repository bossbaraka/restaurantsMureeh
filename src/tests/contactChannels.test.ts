import { describe, expect, it } from 'vitest';
import {
  isAllowedSocialUrl,
  isCanonicalWhatsappNumber,
  normalizeWhatsappNumber,
  sanitizeStoredSocialUrl,
} from '../../server/utils/contactChannels';
import { brandingSchema } from '../../server/validation/schemas';
import { collectRestaurantSocials, isSafeSocialUrl, socialHandle } from '../utils/socialLinks';
import { mapRestaurantRow } from '../services/api';
import type { Restaurant } from '../types/restaurant';

/**
 * Social links are MANAGER-supplied strings that become an `href` in a guest
 * browser. The server is the authority (frontend validation is a nicety), so
 * both layers are asserted here — including that the branding schema, which is
 * `.strict()`, still accepts a save that carries the new fields.
 */

describe('server: isAllowedSocialUrl', () => {
  it('accepts the platform’s own HTTPS domains', () => {
    expect(isAllowedSocialUrl('https://www.instagram.com/venue', 'instagram')).toBe(true);
    expect(isAllowedSocialUrl('https://instagram.com/venue', 'instagram')).toBe(true);
    expect(isAllowedSocialUrl('https://www.facebook.com/venue', 'facebook')).toBe(true);
    expect(isAllowedSocialUrl('https://fb.me/venue', 'facebook')).toBe(true);
    expect(isAllowedSocialUrl('https://vm.tiktok.com/abc', 'tiktok')).toBe(true);
    expect(isAllowedSocialUrl('https://www.youtube.com/@venue', 'youtube')).toBe(true);
    expect(isAllowedSocialUrl('https://youtu.be/abc123', 'youtube')).toBe(true);
  });

  it('refuses dangerous schemes outright', () => {
    for (const url of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://evil.test/abc',
      'ftp://instagram.com/venue',
      '//instagram.com/venue',
      'instagram.com/venue',
    ]) {
      expect(isAllowedSocialUrl(url, 'instagram')).toBe(false);
    }
  });

  it('refuses plaintext HTTP, credentials and IP-literal hosts', () => {
    expect(isAllowedSocialUrl('http://www.instagram.com/venue', 'instagram')).toBe(false);
    expect(isAllowedSocialUrl('https://user:pass@www.instagram.com/venue', 'instagram')).toBe(false);
    expect(isAllowedSocialUrl('https://93.184.216.34/venue', 'website')).toBe(false);
    expect(isAllowedSocialUrl('https://[::1]/venue', 'website')).toBe(false);
    expect(isAllowedSocialUrl('https://localhost/venue', 'website')).toBe(false);
  });

  it('refuses lookalike domains for the allowlisted platforms', () => {
    expect(isAllowedSocialUrl('https://instagram.com.evil.tld/venue', 'instagram')).toBe(false);
    expect(isAllowedSocialUrl('https://notinstagram.com/venue', 'instagram')).toBe(false);
    expect(isAllowedSocialUrl('https://facebook-secure.com/venue', 'facebook')).toBe(false);
    expect(isAllowedSocialUrl('https://evil.tld/?to=instagram.com', 'instagram')).toBe(false);
  });

  it('lets the venue’s own website be any HTTPS host, and nothing else', () => {
    expect(isAllowedSocialUrl('https://myvenue.ps', 'website')).toBe(true);
    expect(isAllowedSocialUrl('https://www.myvenue.ps/menu', 'website')).toBe(true);
    expect(isAllowedSocialUrl('http://myvenue.ps', 'website')).toBe(false);
    expect(isAllowedSocialUrl('javascript:alert(1)', 'website')).toBe(false);
  });

  it('refuses control characters, oversized values and non-strings', () => {
    expect(isAllowedSocialUrl('https://instagram.com/a\nb', 'instagram')).toBe(false);
    expect(isAllowedSocialUrl('https://instagram.com/a b', 'instagram')).toBe(false);
    expect(isAllowedSocialUrl(`https://instagram.com/${'a'.repeat(1200)}`, 'instagram')).toBe(false);
    expect(isAllowedSocialUrl(null, 'instagram')).toBe(false);
    expect(isAllowedSocialUrl(42, 'instagram')).toBe(false);
  });

  it('drops an unusable legacy row instead of rendering it as a link', () => {
    expect(sanitizeStoredSocialUrl('javascript:alert(1)', 'instagram')).toBeUndefined();
    expect(sanitizeStoredSocialUrl('', 'instagram')).toBeUndefined();
    expect(sanitizeStoredSocialUrl(null, 'instagram')).toBeUndefined();
    expect(sanitizeStoredSocialUrl('https://www.instagram.com/v', 'instagram')).toBe(
      'https://www.instagram.com/v'
    );
  });
});

describe('server: whatsapp number normalization', () => {
  it('stores canonical E.164 and exposes the dial form', () => {
    expect(normalizeWhatsappNumber('+970 599 123 456')).toEqual({
      e164: '+970599123456',
      dial: '970599123456',
    });
    expect(normalizeWhatsappNumber('0599123456')?.e164).toBe('+0599123456');
  });

  it('rejects garbage so the reservation channel stays hidden', () => {
    expect(normalizeWhatsappNumber('')).toBeNull();
    expect(normalizeWhatsappNumber('abc')).toBeNull();
    expect(normalizeWhatsappNumber('12345')).toBeNull();
    expect(normalizeWhatsappNumber('https://wa.me/970599123456')).toBeNull();
  });

  it('recognizes the canonical stored form on read', () => {
    expect(isCanonicalWhatsappNumber('+970599123456')).toBe(true);
    expect(isCanonicalWhatsappNumber('970599123456')).toBe(false);
    expect(isCanonicalWhatsappNumber('+123')).toBe(false);
    expect(isCanonicalWhatsappNumber(null)).toBe(false);
  });
});

describe('server: brandingSchema accepts the contact channels', () => {
  it('saves a valid set', () => {
    const parsed = brandingSchema.safeParse({
      restaurantId: 'r1',
      whatsappNumber: '+970599123456',
      instagramUrl: 'https://www.instagram.com/venue',
      facebookUrl: 'https://www.facebook.com/venue',
      tiktokUrl: 'https://www.tiktok.com/@venue',
      youtubeUrl: 'https://www.youtube.com/@venue',
      websiteUrl: 'https://venue.ps',
    });
    expect(parsed.success).toBe(true);
  });

  it('treats an empty string as an explicit clear', () => {
    const parsed = brandingSchema.safeParse({
      restaurantId: 'r1',
      whatsappNumber: '',
      instagramUrl: '',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a dangerous or off-platform link with an Arabic message', () => {
    const dangerous = brandingSchema.safeParse({
      restaurantId: 'r1',
      instagramUrl: 'javascript:alert(1)',
    });
    expect(dangerous.success).toBe(false);

    const offPlatform = brandingSchema.safeParse({
      restaurantId: 'r1',
      facebookUrl: 'https://evil.tld/phish',
    });
    expect(offPlatform.success).toBe(false);
    if (!offPlatform.success) {
      const message = JSON.stringify(offPlatform.error.issues);
      expect(message).toContain('فيسبوك');
    }
  });

  it('rejects a malformed WhatsApp number', () => {
    expect(
      brandingSchema.safeParse({ restaurantId: 'r1', whatsappNumber: 'call-me' }).success
    ).toBe(false);
  });

  it('still rejects unknown keys (mass-assignment guard intact)', () => {
    expect(
      brandingSchema.safeParse({ restaurantId: 'r1', planId: 'plan-enterprise' }).success
    ).toBe(false);
  });
});

describe('client: collectRestaurantSocials', () => {
  const withSocials = (socials?: Restaurant['socials']): Restaurant =>
    ({
      id: 'r1',
      name: 'مطعم',
      nameEn: 'Venue',
      slug: 'venue',
      logo: '',
      description: '',
      phone: '',
      address: '',
      currency: '₪',
      language: 'ar',
      timezone: 'Asia/Jerusalem',
      status: 'ACTIVE',
      primaryColor: '#D4AF37',
      accentColor: '#C5A880',
      planId: 'plan-pro',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      socials,
    }) as Restaurant;

  it('returns nothing when the venue published no channel (no empty section)', () => {
    expect(collectRestaurantSocials(withSocials())).toEqual([]);
    expect(collectRestaurantSocials(withSocials({ instagram: '   ' }))).toEqual([]);
    expect(collectRestaurantSocials(null)).toEqual([]);
    expect(collectRestaurantSocials(undefined)).toEqual([]);
  });

  it('keeps only the channels that exist, in display order', () => {
    const links = collectRestaurantSocials(
      withSocials({
        youtube: 'https://www.youtube.com/@venue',
        instagram: 'https://www.instagram.com/venue',
      })
    );
    expect(links.map((link) => link.id)).toEqual(['instagram', 'youtube']);
    expect(links[0].label).toBe('إنستغرام');
    expect(links[0].handle).toBe('@venue');
  });

  it('drops a link a legacy row smuggled in, even client-side', () => {
    const links = collectRestaurantSocials(
      withSocials({
        instagram: 'javascript:alert(1)',
        facebook: 'https://www.facebook.com/venue',
      })
    );
    expect(links.map((link) => link.id)).toEqual(['facebook']);
  });

  it('reads handles without mistaking a post for a profile', () => {
    expect(socialHandle('https://www.instagram.com/reel/abc123', 'instagram')).toBe('instagram.com');
    expect(socialHandle('https://www.tiktok.com/@venue/video/1', 'tiktok')).toBe('@venue');
    expect(socialHandle('https://www.venue.ps/menu', 'website')).toBe('venue.ps');
  });

  it('agrees with the server on what is safe', () => {
    for (const url of [
      'https://www.instagram.com/venue',
      'https://evil.tld/x',
      'javascript:alert(1)',
      'http://www.instagram.com/venue',
    ]) {
      expect(isSafeSocialUrl(url, 'instagram')).toBe(isAllowedSocialUrl(url, 'instagram'));
    }
  });
});

/**
 * The mapper between the public API payload and the client model.
 * `RestaurantContext` hands `currentRestaurant` straight to the guest menu and
 * the Live Menu, so if this mapper dropped the contact channels, the «تواصل
 * معنا» section and the reservation CTA would silently vanish for every venue
 * — with no server-side symptom to debug.
 */
describe('client: mapRestaurantRow carries the contact channels', () => {
  it('keeps the published channels and the reservation number', () => {
    const mapped = mapRestaurantRow({
      id: 7,
      name: 'الديوان',
      slug: 'al-diwan',
      whatsappNumber: '  970599123456  ',
      socials: {
        instagram: 'https://instagram.com/al.diwan',
        facebook: '  ',
        tiktok: 'https://tiktok.com/@aldiwan',
      },
    });
    expect(mapped.whatsappNumber).toBe('970599123456');
    expect(mapped.socials).toMatchObject({
      instagram: 'https://instagram.com/al.diwan',
      tiktok: 'https://tiktok.com/@aldiwan',
    });
    // A blank channel must not survive as an empty string: an empty tile is
    // worse than no tile.
    expect(mapped.socials?.facebook).toBeUndefined();
  });

  it('returns nothing to render when the venue published no channel', () => {
    const mapped = mapRestaurantRow({ id: 8, name: 'مخبز', slug: 'bakery', socials: {} });
    expect(mapped.socials).toBeUndefined();
    expect(mapped.whatsappNumber).toBeUndefined();
    expect(collectRestaurantSocials(mapped)).toEqual([]);
  });

  it('tolerates the legacy flat column names', () => {
    const mapped = mapRestaurantRow({
      id: 9,
      name: 'ركن',
      slug: 'corner',
      instagramUrl: 'https://instagram.com/corner',
      whatsappNumber: '0599123456',
    });
    expect(mapped.socials?.instagram).toBe('https://instagram.com/corner');
    expect(mapped.whatsappNumber).toBe('0599123456');
  });
});
