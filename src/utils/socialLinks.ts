import type { Restaurant, RestaurantSocials } from '../types/restaurant';

/**
 * Social profile links — the venue's own published channels.
 * ==========================================================
 * One source of truth for "which channels does this restaurant publish":
 * the Restaurant row (`socials`), projected by the public catalog API. The
 * guest menu's «تواصل معنا» section and any future surface read through
 * `collectRestaurantSocials()` so the empty-state rule ("published nothing →
 * render nothing") lives in exactly one place.
 *
 * SECURITY — client re-check, not the authority.
 * The server validates and stores these values (HTTPS only, credential-free,
 * per-platform host allowlist — see server/utils/contactChannels.ts). The
 * check here is defence in depth for legacy rows and cached payloads: these
 * strings become an `href`, so a `javascript:` / `data:` value must never be
 * rendered even if one somehow reaches the client.
 */

export type SocialPlatformId = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'website';

export interface SocialLink {
  id: SocialPlatformId;
  /** Arabic label used for the visible text and the accessible name. */
  label: string;
  /** Latin handle, used as a secondary line and for `title`. */
  labelEn: string;
  url: string;
  /** The handle / path portion, shown instead of the full URL when it fits. */
  handle: string;
}

/** Hosts each platform link may point at — mirrors the server allowlist. */
const PLATFORM_HOSTS: Record<Exclude<SocialPlatformId, 'website'>, readonly string[]> = {
  instagram: ['instagram.com', 'www.instagram.com'],
  facebook: [
    'facebook.com',
    'www.facebook.com',
    'm.facebook.com',
    'web.facebook.com',
    'fb.com',
    'www.fb.com',
    'fb.me',
    'www.fb.me',
  ],
  tiktok: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'm.tiktok.com'],
  youtube: [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.youtu.be',
  ],
};

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatformId, { ar: string; en: string }> = {
  instagram: { ar: 'إنستغرام', en: 'Instagram' },
  facebook: { ar: 'فيسبوك', en: 'Facebook' },
  tiktok: { ar: 'تيك توك', en: 'TikTok' },
  youtube: { ar: 'يوتيوب', en: 'YouTube' },
  website: { ar: 'الموقع الإلكتروني', en: 'Website' },
};

/** Render order — the venue's own site closes the row. */
export const SOCIAL_PLATFORM_ORDER: SocialPlatformId[] = [
  'instagram',
  'facebook',
  'tiktok',
  'youtube',
  'website',
];

const isIpLiteralHost = (hostname: string): boolean => {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
};

/**
 * Is this URL safe to render as a link for the given platform?
 * HTTPS, credential-free, non-IP, and (except `website`) on the platform's own
 * domain. Control characters and embedded whitespace are refused.
 */
export function isSafeSocialUrl(value: unknown, platform: SocialPlatformId): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1000) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f]/.test(trimmed)) return false;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  if (!hostname || isIpLiteralHost(hostname) || !hostname.includes('.')) return false;
  if (platform === 'website') return true;
  return (PLATFORM_HOSTS[platform] as readonly string[]).includes(hostname);
}

/** The human-readable handle of a profile URL (`@name`, or the site host). */
export function socialHandle(url: string, platform: SocialPlatformId): string {
  const hostOnly = (value: string): string => {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  if (platform === 'website') return hostOnly(url);

  try {
    const first = new URL(url).pathname.split('/').filter(Boolean)[0];
    // A post/reel/channel path is not a profile handle — show the domain
    // rather than inventing `@abc123` from a post id.
    const notHandles = new Set(['reel', 'reels', 'p', 'stories', 'watch', 'shorts', 'channel', 'c', 'user', 'share', 'v']);
    if (!first || notHandles.has(first.toLowerCase())) return hostOnly(url);
    return first.startsWith('@') ? first : `@${first}`;
  } catch {
    return '';
  }
}

/**
 * The channels this venue actually published, in display order.
 * Returns `[]` when the venue published nothing — callers must then render no
 * section at all (never a heading with empty icons).
 */
export function collectRestaurantSocials(
  restaurant?: Pick<Restaurant, 'socials'> | null
): SocialLink[] {
  const socials: RestaurantSocials | undefined = restaurant?.socials;
  if (!socials || typeof socials !== 'object') return [];

  const links: SocialLink[] = [];
  for (const id of SOCIAL_PLATFORM_ORDER) {
    const raw = socials[id];
    if (typeof raw !== 'string') continue;
    const url = raw.trim();
    if (!url || !isSafeSocialUrl(url, id)) continue;
    links.push({
      id,
      label: SOCIAL_PLATFORM_LABELS[id].ar,
      labelEn: SOCIAL_PLATFORM_LABELS[id].en,
      url,
      handle: socialHandle(url, id),
    });
  }
  return links;
}
