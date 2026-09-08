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

/**
 * Parse pagination query params safely (M-01 DoS hardening).
 * - limit: 1..100, default 50
 * - offset/page: bounded to 0..100000
 * Returns Prisma-compatible take/skip with hard caps to prevent
 * unbounded list amplification.
 */
export function parsePagination(query: Record<string, unknown>): {
  take: number;
  skip: number;
} {
  const rawLimit = query.limit ?? query.take ?? query.pageSize;
  const rawPage = query.page ?? query.offset;
  let take = 50;
  if (rawLimit !== undefined) {
    const parsed = Number.parseInt(String(rawLimit), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      take = Math.min(Math.max(parsed, 1), 100);
    }
  }
  let skip = 0;
  if (rawPage !== undefined) {
    const asPage = Number.parseInt(String(rawPage), 10);
    if (Number.isFinite(asPage) && asPage >= 0) {
      if (String(query.page) !== '' && Number.isFinite(Number(query.page)) && Number(query.page) > 0) {
        skip = (Math.max(asPage, 1) - 1) * take;
      } else {
        skip = Math.min(asPage, 100000);
      }
    }
  }
  if (query.offset !== undefined) {
    const off = Number.parseInt(String(query.offset), 10);
    if (Number.isFinite(off) && off >= 0) skip = Math.min(off, 100000);
  }
  return { take, skip };
}
