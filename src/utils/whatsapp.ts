/**
 * WhatsApp deep links — the single place a `wa.me` URL is built.
 * ==============================================================
 * Two callers need it (the Live Menu reservation request and the guest menu's
 * contact section), so the number cleanup, the message encoding and the
 * malformed-URL guards live here and nowhere else. Nothing in this module
 * touches the DOM: it returns a URL string (or `null`) and the caller decides
 * how to open it.
 *
 * IMPORTANT — no confirmation semantics.
 * The platform has no reservation engine: it does not hold tables, calendars
 * or availability. A reservation is a REQUEST the guest hands to the venue
 * over WhatsApp, and the VENUE confirms it. Copy in the UI must say exactly
 * that — never «تم تأكيد الحجز».
 */

/** Digits kept in the dialed form (E.164 allows 15). */
export const MAX_WHATSAPP_DIGITS = 15;
/** Fewer digits than this is not a reachable number. */
export const MIN_WHATSAPP_DIGITS = 7;

/**
 * Hard ceiling on a composed message. A reservation request is ~200 Arabic
 * characters, and each one percent-encodes to 6 bytes — so 600 characters is
 * already a ~3.6 KB URL. Capping here keeps the deep link well inside what
 * every browser and the WhatsApp share sheet accept.
 */
export const MAX_WHATSAPP_MESSAGE_LENGTH = 600;

/**
 * Normalize any user- or server-provided WhatsApp number to the digits-only
 * form `wa.me/<digits>` expects (no `+`, no separators, no parentheses).
 *
 * Returns `null` for anything that is not a reachable number, so callers can
 * hide the affordance instead of producing a broken link.
 */
export function normalizeWhatsappNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 24) return null;
  // Digits plus a leading `+` and the separators people actually type.
  if (!/^\+?[0-9() .-]+$/.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < MIN_WHATSAPP_DIGITS || digits.length > MAX_WHATSAPP_DIGITS) return null;
  if (/^0+$/.test(digits)) return null;
  return digits;
}

/**
 * Build a `https://wa.me/<number>?text=<encoded message>` deep link.
 *
 * Returns `null` when the number is unusable — callers must then hide the CTA
 * rather than render a link that opens WhatsApp with no recipient. The message
 * is always `encodeURIComponent`-encoded (Arabic text, newlines and any
 * character the venue's name contains), and `#`/`&`/`?` inside it can never
 * break out of the query string.
 */
export function buildWhatsappUrl(rawNumber: unknown, message?: string): string | null {
  const dial = normalizeWhatsappNumber(rawNumber);
  if (!dial) return null;

  const base = `https://wa.me/${dial}`;
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return base;

  const clipped = text.slice(0, MAX_WHATSAPP_MESSAGE_LENGTH);
  return `${base}?text=${encodeURIComponent(clipped)}`;
}

export interface ReservationRequest {
  /** Venue name, exactly as the venue published it. */
  restaurantName: string;
  /** Guest name (required by the form). */
  name: string;
  /** Party size, 1..20. */
  partySize: number;
  /** `YYYY-MM-DD` from the date input. */
  date: string;
  /** `HH:MM` (24h) from the time input. */
  time: string;
  /** Optional free-text note. */
  notes?: string;
}

/** Strip control characters from guest-typed free text (defence in depth —
 * React escapes on render, and WhatsApp renders it as plain text). */
const cleanText = (value: string, max: number): string =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * The reservation request message sent to the venue's WhatsApp.
 *
 * Deliberately phrased as a REQUEST («أرغب في حجز طاولة»): the venue confirms
 * it, the platform never claims to.
 */
export function buildReservationMessage(request: ReservationRequest): string {
  const lines: string[] = [
    `مرحبًا، أرغب في حجز طاولة في ${cleanText(request.restaurantName, 80) || 'المطعم'}.`,
    '',
    `الاسم: ${cleanText(request.name, 60)}`,
    `عدد الأشخاص: ${Math.trunc(request.partySize)}`,
    `التاريخ: ${cleanText(request.date, 20)}`,
    `الوقت: ${cleanText(request.time, 12)}`,
  ];

  const notes = cleanText(request.notes || '', 300);
  if (notes) lines.push(`ملاحظات: ${notes}`);

  lines.push('', '— أُرسل هذا الطلب من شاشة قائمة المطعم. بانتظار تأكيدكم.');
  return lines.join('\n');
}
