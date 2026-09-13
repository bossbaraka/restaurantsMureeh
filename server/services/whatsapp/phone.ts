import { parsePhoneNumberWithError, isValidPhoneNumber as libIsValid, CountryCode } from 'libphonenumber-js';

/**
 * Robust international phone validation & normalization.
 * Uses libphonenumber-js for proper parsing; falls back to strict E.164 regex.
 */

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

/**
 * Normalize any input into E.164 format.
 * Returns null if invalid.
 * Handles inputs like:
 *  - +970599123456
 *  - 0599123456 (assumes default country if provided)
 *  - 00970599123456
 */
export function normalizePhoneNumber(
  input: unknown,
  defaultCountry: CountryCode = 'PS'
): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  // Fast path: already E.164 and valid
  if (E164_REGEX.test(raw)) {
    try {
      if (libIsValid(raw)) return raw;
    } catch {
      // fall through to parsing
    }
    // If lib says invalid but regex passes, still accept as E.164 (strict)
    return raw;
  }

  // Try libphonenumber parsing
  try {
    // libphonenumber-js can parse national numbers with default country
    const parsed = parsePhoneNumberWithError(raw, defaultCountry);
    if (parsed && parsed.isValid()) {
      return parsed.number as string; // E.164
    }
    // Even if not strictly valid, try formatting if possible and plausible
    if (parsed && parsed.isPossible()) {
      return parsed.number as string;
    }
  } catch {
    // ignore, try manual normalization below
  }

  // Manual normalization for common Middle East patterns
  // Strip spaces, dashes, parentheses
  let cleaned = raw.replace(/[\s\-\(\)]/g, '');
  // Convert 00 prefix to +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
    if (E164_REGEX.test(cleaned)) return cleaned;
  }
  // Handle leading 0 for Palestinian numbers (e.g., 0599...)
  if (cleaned.startsWith('0') && !cleaned.startsWith('+')) {
    // Assume Palestinian +970 if starts with 05...
    // This is heuristic for Mureeh's primary market
    if (/^0(5\d{8}|[2-9]\d{7,8})$/.test(cleaned)) {
      const withoutZero = cleaned.slice(1);
      const candidate = `+970${withoutZero}`;
      if (E164_REGEX.test(candidate)) {
        try {
          if (libIsValid(candidate)) return candidate;
        } catch {
          return candidate;
        }
      }
    }
  }

  return null;
}

export function isValidPhoneNumber(input: unknown, defaultCountry: CountryCode = 'PS'): boolean {
  return normalizePhoneNumber(input, defaultCountry) !== null;
}

/**
 * Redact phone for logging: +970****1234
 * Never expose full number in logs.
 */
export function redactPhone(phone: string | null | undefined): string {
  if (!phone) return '[no-phone]';
  const str = String(phone);
  if (str.length <= 4) return '****';
  const visibleStart = str.slice(0, 4);
  const visibleEnd = str.slice(-4);
  const masked = '*'.repeat(Math.max(4, str.length - 8));
  return `${visibleStart}${masked}${visibleEnd}`;
}

/**
 * For notification logs we store full E.164 but when returning via API
 * we should redact unless explicitly needed. This helper is for API responses.
 */
export function maskPhoneForResponse(phone: string | null | undefined): string {
  if (!phone) return '';
  const e164 = normalizePhoneNumber(phone);
  if (!e164) return redactPhone(phone);
  return redactPhone(e164);
}
