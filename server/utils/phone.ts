// ============================================================
// Customer phone — normalization + validation.
//
// Purpose: let a cashier reach the guest about a transfer receipt. That is
// the ONLY reason this value exists, and it is treated accordingly:
//   - optional (an empty value is valid — the receipt alone is enough),
//   - never an account, never a login credential, never a lookup key,
//   - stored once on the order and purged by the retention sweep.
//
// Pure and dependency-free so it is unit-testable without a database, and
// shared by the API validation layer and the retention service (a value must
// never be *stored* in a shape a validator would reject).
// ============================================================

/** Longest accepted input (E.164 allows 15 digits + separators + a leading +). */
export const MAX_PHONE_INPUT_LENGTH = 24;

/** Digits kept in the normalized form (E.164 max is 15). */
export const MAX_PHONE_DIGITS = 15;

/** Fewer digits than this is not a reachable phone number. */
export const MIN_PHONE_DIGITS = 7;

/**
 * Allowed input characters: digits, a single leading `+`, and the separators
 * people actually type (space, dash, dot, parentheses). Anything else — letters,
 * emoji, newlines, control characters, SQL/HTML metacharacters — is rejected
 * outright rather than silently stripped, so garbage never reaches the DB.
 */
// NOTE: `\s` is deliberately NOT used here — it accepts newlines/tabs, which
// let a value with embedded control characters reach the database. Only the
// separators people actually type are allowed.
const ALLOWED_INPUT_RE = /^\+?[0-9() .-]+$/;

/**
 * Normalize a user-entered phone number.
 *
 * Returns the canonical stored form (`+` + digits when the input was
 * international, digits otherwise, e.g. `0599123456` or `+972599123456`) or
 * `null` when the value is missing/garbage. `null` therefore means "no phone".
 */
export function normalizeCustomerPhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_PHONE_INPUT_LENGTH) return null;
  if (!ALLOWED_INPUT_RE.test(trimmed)) return null;

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return null;

  return hadPlus ? `+${digits}` : digits;
}

/**
 * True when a value is already in canonical stored form. Used by the API
 * layer so an invalid value can never be persisted via a non-HTTP path.
 */
export function isValidNormalizedPhone(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (!/^\+?\d+$/.test(value)) return false;
  const digits = value.startsWith('+') ? value.slice(1) : value;
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
}
