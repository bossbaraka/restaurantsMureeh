// ============================================================
// Restaurant contact channels — WhatsApp number + social profile links.
//
// These values are entered by a MANAGER and rendered to GUESTS as an `href`
// (guest menu «تواصل معنا») and as a `wa.me` deep link (Live Menu reservation
// request). That makes them a stored-XSS / open-redirect surface, so they are
// validated HERE — server-side, at write time — and never trusted to the
// frontend. The client re-checks them for a good error message, but the server
// is the authority: a `javascript:`, `data:`, `vbscript:` or credential-bearing
// URL must be impossible to persist.
//
// Pure and dependency-free so it is unit-testable without a database.
// ============================================================

/** Canonical stored form of a WhatsApp number: `+` followed by 7..15 digits. */
export interface NormalizedWhatsapp {
  /** `+970593000000` — what PostgreSQL stores. */
  e164: string;
  /** `970593000000` — what `wa.me/<number>` expects (no `+`). */
  dial: string;
}

/** Longest accepted input (E.164 = 15 digits + separators + a leading +). */
export const MAX_WHATSAPP_INPUT_LENGTH = 24;
export const MIN_WHATSAPP_DIGITS = 7;
export const MAX_WHATSAPP_DIGITS = 15;

/** Digits plus the separators people actually type. No `\s` (it accepts
 * newlines/tabs, which is how control characters reach a database). */
const ALLOWED_PHONE_INPUT_RE = /^\+?[0-9() .-]+$/;

/**
 * Normalize a manager-entered WhatsApp number to canonical E.164.
 *
 * Returns `null` for anything that is not a reachable international number —
 * the caller stores `null` (meaning "no reservation channel"), which is what
 * hides the reservation CTA on the Live Menu. A local number without a country
 * code is accepted only when it is unambiguous (8..15 digits); a 7-digit local
 * number is kept as-is and the deep link then relies on the guest's own
 * WhatsApp region, which is exactly what `wa.me` documents.
 */
export function normalizeWhatsappNumber(raw: unknown): NormalizedWhatsapp | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_WHATSAPP_INPUT_LENGTH) return null;
  if (!ALLOWED_PHONE_INPUT_RE.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < MIN_WHATSAPP_DIGITS || digits.length > MAX_WHATSAPP_DIGITS) return null;
  if (/^0+$/.test(digits)) return null;

  return { e164: `+${digits}`, dial: digits };
}

/** True when a value is already in canonical stored form (`+` + digits). */
export function isCanonicalWhatsappNumber(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!/^\+\d+$/.test(value)) return false;
  const digits = value.slice(1);
  return digits.length >= MIN_WHATSAPP_DIGITS && digits.length <= MAX_WHATSAPP_DIGITS;
}

// ---------------------------------------------------------------------------
// Social profile links
// ---------------------------------------------------------------------------

export const SOCIAL_PLATFORMS = [
  'instagram',
  'facebook',
  'tiktok',
  'youtube',
  'website',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/**
 * Hosts a venue may point each platform link at. Deliberately an ALLOWLIST:
 * "instagram.com.evil.tld", "notfacebook.com" and any attacker-controlled
 * domain are refused, so the guest menu can never be turned into a redirect to
 * a phishing page that merely *claims* to be the venue's profile.
 *
 * `website` is the venue's own site and therefore has no allowlist — it is
 * still restricted to HTTPS, credential-free, non-IP-literal hosts below.
 */
const PLATFORM_HOSTS: Record<Exclude<SocialPlatform, 'website'>, readonly string[]> = {
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

/** Labels used in the Arabic validation messages. */
export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: 'إنستغرام',
  facebook: 'فيسبوك',
  tiktok: 'تيك توك',
  youtube: 'يوتيوب',
  website: 'الموقع الإلكتروني',
};

/** An IPv4/IPv6 literal host — never a restaurant website we want to link. */
const isIpLiteralHost = (hostname: string): boolean => {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true; // IPv6
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
};

/**
 * Is this an acceptable public link for the given platform?
 *
 * Rules (all of them enforced at write time):
 *   1. must parse as an absolute URL;
 *   2. protocol must be `https:` — `javascript:`, `data:`, `vbscript:`,
 *      `file:` and plaintext `http:` are all refused;
 *   3. no embedded credentials (`https://user:pass@…`);
 *   4. a real hostname (no IP literals);
 *   5. the host must be the platform's own domain (except `website`).
 *
 * `''` is the explicit-clear signal and is handled by the Zod schema, not here.
 */
export function isAllowedSocialUrl(value: unknown, platform: SocialPlatform): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1000) return false;
  // Reject control characters and whitespace inside the URL outright: a URL
  // with an embedded newline/tab is a header- and log-injection vector and is
  // never something a browser would navigate to anyway.
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
  if (!hostname || isIpLiteralHost(hostname)) return false;
  // A bare domain (no dot) is a LAN host, not a public profile.
  if (!hostname.includes('.')) return false;

  if (platform === 'website') return true;
  return (PLATFORM_HOSTS[platform] as readonly string[]).includes(hostname);
}

/**
 * Strip a stored social link down to something safe to hand to the guest.
 * Returns `undefined` for anything unusable so the UI hides the channel
 * instead of rendering a dead or dangerous link. Defence in depth: the value
 * was already validated on write, but a legacy row predating this validator
 * must not become an `href`.
 */
export function sanitizeStoredSocialUrl(value: unknown, platform: SocialPlatform): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return isAllowedSocialUrl(trimmed, platform) ? trimmed : undefined;
}
