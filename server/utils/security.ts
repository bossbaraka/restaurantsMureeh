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

/** Payment methods accepted by the POS ledger and table settlement. */
export const PAYMENT_METHODS_CASH = ['CASH'] as const;
export const SUPPORTED_PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE', 'SPLIT'] as const;
export type SupportedPaymentMethod = (typeof SUPPORTED_PAYMENT_METHODS)[number];

export interface CashReconciliationInput {
  method: string;
  total: number;
  /** Optional tip added on top of the bill (cash only). */
  tip?: number | null;
  /** Tendered cash supplied by the guest. */
  cashReceived?: number | null;
}

export type CashReconciliation =
  | {
      ok: true;
      cashReceived: number | null;
      changeDue: number;
      tip: number;
    }
  | { ok: false; error: string };

/**
 * Pure cash-till reconciliation shared by POST /payments and
 * POST /tables/:id/settle.
 *
 * Rules (financial integrity):
 *  - The method must be one of the ledger enum (callers validate via Zod).
 *  - CASH requires a finite tendered amount that covers total + tip; a short
 *    payment is rejected instead of being silently marked PAID.
 *  - changeDue is computed server-side as tendered - (total + tip); the client
 *    never supplies it and `cashReceived === total` is never ASSUMED — the
 *    caller decides whether exact cash is the UI default.
 *  - Non-cash methods record no cash/change.
 */
export function reconcileCashPayment(input: CashReconciliationInput): CashReconciliation {
  const total = roundMoney(input.total);
  const tip = roundMoney(Math.max(0, input.tip ?? 0));

  if (!(SUPPORTED_PAYMENT_METHODS as readonly string[]).includes(input.method)) {
    return { ok: false, error: 'طريقة الدفع غير صالحة' };
  }

  if (input.method !== 'CASH') {
    return { ok: true, cashReceived: null, changeDue: 0, tip };
  }

  const received = input.cashReceived;
  if (received === undefined || received === null || !Number.isFinite(received)) {
    return { ok: false, error: 'مبلغ المقبوض النقدي مطلوب للدفع النقدي' };
  }
  const tendered = roundMoney(Number(received));
  const due = roundMoney(total + tip);
  if (tendered < due) {
    return { ok: false, error: 'المبلغ المقبوض أقل من قيمة الفاتورة' };
  }
  return {
    ok: true,
    cashReceived: tendered,
    changeDue: roundMoney(tendered - due),
    tip,
  };
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
