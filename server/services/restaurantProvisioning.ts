import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { generateQrToken } from '../utils/security';
import { normalizeWhatsappNumber } from '../utils/contactChannels';

/**
 * Self-service restaurant provisioning rules (2026-10) — a deliberately
 * SMALL, dependency-light home for the rules the self-service onboarding
 * route shares with the platform conventions:
 *
 *   * slug generation (uniqueness, charset and length per the platform's
 *     `restaurantCodeSchema` contract — the slug doubles as the employee
 *     login code, so no new character set is introduced);
 *   * initial table numbering (the exact `{tenant}-T{NN}` id scheme,
 *     zero-padded display name, capacity/zone/status defaults and opaque
 *     QR tokens that `POST /api/admin/onboard-restaurant` and
 *     `POST /api/manager/tables` already produce — one convention, no
 *     parallel QR system).
 *
 * The admin onboarding route is NOT rewired to consume this module
 * (minimal-change rule: its flow carries extra policy the self-service
 * flow must not inherit — logos, plan selection, sample categories).
 * A pinning test (src/tests/freePlan.test.ts / selfOnboarding.test.ts)
 * locks the shared conventions so the two cannot silently drift.
 *
 * Pure functions only — the ONLY impure input is an injected `isTaken`
 * lookup, which keeps this module unit-testable without a database.
 */

// Closed table-count set shared by the route, builder, and validation hub
// (9/11/0/500/1.5/"10" all rejected).
export const SELF_ONBOARD_TABLE_COUNTS = [10, 15, 20] as const;

export const SELF_ONBOARD_SLUG_MIN_LENGTH = 3;
export const SELF_ONBOARD_SLUG_MAX_LENGTH = 60;

/** Typed error so the route can map failures to stable HTTP codes. */
export class ProvisioningError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ProvisioningError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Normalise a free-text venue name into the platform slug charset.
 *
 * Rules (identical in spirit to the admin wizard's `handleSlugAutoFill`):
 * lowercase, NFKD + Arabic tashkeel stripped, every run of disallowed
 * characters collapses to a single '-'. A purely Arabic name therefore
 * yields '' — the CALLER must fall back to the deterministic
 * `restaurant-xxxxxx` seed (generateUniqueSlug does this).
 */
export function slugifyRestaurantName(name: string): string {
  return String(name ?? '')
    .normalize('NFKD')
    // Arabic harakat (tashkeel) and combining marks must never survive.
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SELF_ONBOARD_SLUG_MAX_LENGTH)
    .replace(/-+$/g, ''); // a truncated tail must not end on '-'
}

/** Random fallback seed (used when the name yields no usable Latin slug). */
export function randomSlugSeed(): string {
  return `restaurant-${randomBytes(3).toString('hex')}`;
}

/**
 * Produce a slug guaranteed unique against `isTaken` (bounded work):
 *   1. exact base (name slug, or 'restaurant' when none),
 *   2. `-2` … `-20` numeric suffixes,
 *   3. up to 5 random `restaurant-{hex6}` seeds.
 * Never loops unboundedly; total lookups ≤ 26. The final uniqueness back-
 * stop remains the DB constraint (`Restaurant.slug @unique` → P2002 → 409).
 */
export async function generateUniqueSlug(
  name: string,
  isTaken: (slug: string) => Promise<boolean>
): Promise<string> {
  const slugified = slugifyRestaurantName(name);
  const base =
    slugified.length >= SELF_ONBOARD_SLUG_MIN_LENGTH ? slugified : 'restaurant';

  const candidates: string[] = [base];
  for (let n = 2; n <= 20; n += 1) candidates.push(`${base}-${n}`);

  for (const candidate of candidates) {
    if (!(await isTaken(candidate))) return candidate;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomSlugSeed();
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new ProvisioningError(
    409,
    'SLUG_EXHAUSTED',
    'تعذر توليد رابط فريد للمطعم — أعد المحاولة أو تواصل مع إدارة المنصة'
  );
}

export interface ProvisionedTableRow {
  id: string;
  restaurantId: string;
  number: number;
  name: string;
  capacity: number;
  zone: 'MAIN_HALL';
  status: 'AVAILABLE';
  qrToken: string;
}

/**
 * Build the initial table rows for a freshly created tenant.
 *
 * Count is validated against the CLOSED self-service set here as well as in
 * Zod (defense in depth: the route could later be reused by another caller).
 * Numbering/ids/names match the admin onboarding convention byte-for-byte:
 * numbers 1..N, zero-padded two digits below 10, ids `${restaurantId}-T0X`,
 * default capacity 4, MAIN_HALL, AVAILABLE, opaque `qr-` tokens from the
 * shared generator (never a parallel QR format).
 */
export function buildInitialTables(
  restaurantId: string,
  tableCount: number
): ProvisionedTableRow[] {
  if (!restaurantId || typeof restaurantId !== 'string') {
    throw new ProvisioningError(400, 'INVALID_TENANT', 'معرّف المطعم غير صالح');
  }
  if (!(SELF_ONBOARD_TABLE_COUNTS as readonly number[]).includes(tableCount)) {
    throw new ProvisioningError(
      400,
      'INVALID_TABLE_COUNT',
      'عدد الطاولات يجب أن يكون 10 أو 15 أو 20 بالضبط'
    );
  }
  return Array.from({ length: tableCount }, (_, i) => {
    const num = i + 1;
    const numStr = num < 10 ? `0${num}` : `${num}`;
    return {
      id: `${restaurantId}-T${numStr}`,
      restaurantId,
      number: num,
      name: `طاولة ${numStr}`,
      capacity: 4,
      zone: 'MAIN_HALL' as const,
      status: 'AVAILABLE' as const,
      qrToken: generateQrToken(),
    };
  });
}

// ============================================================
// Triple Free Shield — Official Verification Gate (2026-10)
// ============================================================

/**
 * Layer 1: Disposable / temporary / burner email domains blocked at self-
 * service registration to prevent automated fake-restaurant spam.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '10minutemail.net',
  'burnermail.io',
  'dispostable.com',
  'emailondeck.com',
  'fake.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamailblock.com',
  'inboxbear.com',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempmail.com',
  'tempmail.net',
  'tempmailo.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

/**
 * True when an email address uses a disposable/burner domain (or subdomain).
 */
export function isDisposableEmail(email: string): boolean {
  const normalized = String(email ?? '').trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex === -1) return false;
  const domain = normalized.slice(atIndex + 1).trim();
  if (!domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i += 1) {
    const parent = parts.slice(i).join('.');
    if (DISPOSABLE_EMAIL_DOMAINS.has(parent)) return true;
  }
  return false;
}

/**
 * Normalize an owner's verification phone/WhatsApp number to a canonical E.164
 * identifier (`+` + digits) so that `0599123456`, `00970599123456`, and
 * `+970599123456` resolve to the SAME canonical string (`+970599123456`).
 * Returns `null` if the input is not a valid reachable phone number.
 */
export function normalizeVerificationPhone(raw: unknown): string | null {
  const parsed = normalizeWhatsappNumber(raw);
  if (!parsed) return null;
  let digits = parsed.dial;
  if (digits.startsWith('00') && digits.length >= 9) {
    digits = digits.slice(2);
  } else if (/^05\d{8}$/.test(digits)) {
    digits = `970${digits.slice(1)}`;
  }
  if (digits.length < 8 || digits.length > 15 || /^0+$/.test(digits)) {
    return null;
  }
  return `+${digits}`;
}

/**
 * Public, non-secret verification request reference (`MRH-XXXXXX`) displayed
 * to the owner on the Official Verification Hold Screen and embedded in the
 * WhatsApp Reverse Verification message. Never reveals the activation code.
 */
export function buildVerificationReference(restaurantId: string): string {
  const hex = createHash('sha256')
    .update(`mureeh-ref-v1:${restaurantId}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  return `MRH-${hex}`;
}

/**
 * Deterministic 6-digit Official Activation Code derived via HMAC-SHA256 from
 * the server's `JWT_SECRET` and the tenant id. Zero schema changes required,
 * impossible to predict or forge without `JWT_SECRET`, and surfaced ONLY to
 * platform admins (`PLATFORM_ADMIN` / `SUPER_ADMIN`).
 */
export function computeRestaurantVerificationCode(
  restaurantId: string,
  secret: string
): string {
  if (!restaurantId || !secret) {
    throw new Error('restaurantId and secret are required for verification code');
  }
  const digest = createHmac('sha256', secret)
    .update(`mureeh-onboard-verify-v1:${restaurantId}`)
    .digest();
  const num = (digest.readUInt32BE(0) % 900_000) + 100_000;
  return String(num);
}

/**
 * Constant-time verification of a 6-digit Official Activation Code.
 */
export function verifyRestaurantActivationCode(
  restaurantId: string,
  suppliedCode: string,
  secret: string
): boolean {
  const clean = String(suppliedCode ?? '').trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const expected = computeRestaurantVerificationCode(restaurantId, secret);
  const a = Buffer.from(clean, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

