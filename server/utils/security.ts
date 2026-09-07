import { randomBytes, randomUUID } from 'crypto';

// ============================================================
// Small security utilities shared by the API routes.
// ============================================================

/** High-entropy opaque token (256-bit, CSPRNG). Never predictable. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** QR capability token: opaque, unguessable, no embedded IDs. */
export function generateQrToken(): string {
  return `qr-${randomUUID()}`;
}

/** Public table-session token: opaque bearer capability. */
export function generateSessionToken(): string {
  return `sess-${randomUUID()}`;
}

/**
 * Neutralize CSV formula injection (CWE-1236): spreadsheet apps may
 * interpret cells starting with = + - @ as formulas even when quoted.
 */
export function safeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
}

/** Minimal CSV field escaping (quotes + CR/LF safe). */
export function csvField(value: unknown): string {
  const text = safeCsvCell(value).replace(/"/g, '""');
  return `"${text}"`;
}

/** Round money to 2 decimals to avoid float dust in totals. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Escape a string for safe interpolation into HTML documents. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
