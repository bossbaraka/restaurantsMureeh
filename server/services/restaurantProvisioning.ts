import { randomBytes } from 'crypto';
import { generateQrToken } from '../utils/security';

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

// Re-export the closed table-count set from the validation hub so route and
// builder validate against ONE list (9/11/0/500/1.5/"10" all rejected).
import { SELF_ONBOARD_TABLE_COUNTS } from '../validation/schemas';
export { SELF_ONBOARD_TABLE_COUNTS };

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
