import { describe, expect, it } from 'vitest';
import {
  buildReservationMessage,
  buildWhatsappUrl,
  normalizeWhatsappNumber,
} from '../utils/whatsapp';

/**
 * The WhatsApp deep link is the ONLY exit the read-only Live Menu offers, so
 * the number cleanup and the message encoding are the security-relevant part
 * of the reservation flow. Nothing here may produce a malformed URL or let
 * guest-typed text break out of the query string.
 */

describe('normalizeWhatsappNumber', () => {
  it('accepts the shapes a manager actually types and returns wa.me digits', () => {
    expect(normalizeWhatsappNumber('+970 599 123 456')).toBe('970599123456');
    expect(normalizeWhatsappNumber('0599123456')).toBe('0599123456');
    expect(normalizeWhatsappNumber('+972 (59) 912-3456')).toBe('972599123456');
    expect(normalizeWhatsappNumber('  +970599123456  ')).toBe('970599123456');
  });

  it('refuses anything that is not a reachable number', () => {
    for (const bad of [
      '',
      '   ',
      '123',
      'abcdefg',
      '+970abc599123456',
      '0000000',
      '9'.repeat(20),
      '970599\n123456',
      '+970599123456 ext',
      null,
      undefined,
      5551234,
      {},
    ]) {
      expect(normalizeWhatsappNumber(bad)).toBeNull();
    }
  });
});

describe('buildWhatsappUrl', () => {
  it('builds a wa.me link and URL-encodes the Arabic message', () => {
    const url = buildWhatsappUrl('+970599123456', 'مرحبًا\nأرغب في حجز طاولة');

    expect(url).not.toBeNull();
    expect(url!.startsWith('https://wa.me/970599123456?text=')).toBe(true);
    // The raw text must not appear unencoded: no spaces, no newlines, no bare
    // `&`/`#` that could truncate or extend the query string.
    const text = new URL(url!).searchParams.get('text');
    expect(text).toBe('مرحبًا\nأرغب في حجز طاولة');
    expect(url!).not.toContain('%0A%0Aمرحبا');
    expect(decodeURIComponent(url!.split('text=')[1])).toContain('حجز طاولة');
  });

  it('returns a bare link when there is no message', () => {
    expect(buildWhatsappUrl('970599123456')).toBe('https://wa.me/970599123456');
    expect(buildWhatsappUrl('970599123456', '   ')).toBe('https://wa.me/970599123456');
  });

  it('refuses to build a link for an unusable number, so the CTA can hide', () => {
    expect(buildWhatsappUrl('', 'hi')).toBeNull();
    expect(buildWhatsappUrl('javascript:alert(1)', 'hi')).toBeNull();
    expect(buildWhatsappUrl('123', 'hi')).toBeNull();
    expect(buildWhatsappUrl(undefined, 'hi')).toBeNull();
  });

  it('cannot be turned into another scheme by the number or the message', () => {
    const url = buildWhatsappUrl('+970599123456', 'x" onmouseover="alert(1)');
    expect(url!.startsWith('https://wa.me/')).toBe(true);
    expect(new URL(url!).protocol).toBe('https:');
    expect(new URL(url!).hostname).toBe('wa.me');
  });

  it('clips an absurdly long message instead of building a broken URL', () => {
    const url = buildWhatsappUrl('970599123456', 'ا'.repeat(5000));
    expect(url).not.toBeNull();
    // 600 Arabic characters cap the encoded URL at ~3.7 KB.
    expect(url!.length).toBeLessThan(4000);
  });
});

describe('buildReservationMessage', () => {
  const base = {
    restaurantName: 'مطعم الديوان',
    name: 'أحمد علي',
    partySize: 4,
    date: '2026-09-25',
    time: '20:30',
  };

  it('reads as a REQUEST the venue confirms, never as a confirmation', () => {
    const message = buildReservationMessage(base);

    expect(message).toContain('مرحبًا، أرغب في حجز طاولة في مطعم الديوان.');
    expect(message).toContain('الاسم: أحمد علي');
    expect(message).toContain('عدد الأشخاص: 4');
    expect(message).toContain('التاريخ: 2026-09-25');
    expect(message).toContain('الوقت: 20:30');
    expect(message).toContain('بانتظار تأكيدكم');
    // The platform must never claim the table is booked.
    expect(message).not.toContain('تم تأكيد');
    expect(message).not.toContain('تم الحجز');
  });

  it('includes the note only when the guest wrote one', () => {
    expect(buildReservationMessage(base)).not.toContain('ملاحظات:');
    expect(buildReservationMessage({ ...base, notes: 'طاولة near the window' })).toContain(
      'ملاحظات: طاولة near the window'
    );
  });

  it('strips markup and control characters from guest-typed text', () => {
    const message = buildReservationMessage({
      ...base,
      name: '<script>alert(1)</script>Ahmed\u0000',
      notes: 'a\r\nb\tc',
    });

    expect(message).not.toContain('<');
    expect(message).not.toContain('>');
    expect(message).not.toContain('\u0000');
    expect(message).toContain('الاسم: scriptalert(1)/scriptAhmed');
    expect(message).toContain('ملاحظات: a b c');
  });

  it('bounds every field so the composed message stays sane', () => {
    const message = buildReservationMessage({
      ...base,
      restaurantName: 'ط'.repeat(500),
      name: 'n'.repeat(500),
      notes: 'x'.repeat(2000),
    });

    expect(message.length).toBeLessThan(700);
  });
});
