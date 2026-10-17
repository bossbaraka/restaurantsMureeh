import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildMureehWhatsAppUrl,
  MUREEH_WHATSAPP_DISPLAY,
  MUREEH_WHATSAPP_NUMBER,
} from '../../shared/mureeh-contact';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('Mureeh public contact channel', () => {
  it('uses the configured number in a direct WhatsApp deep link', () => {
    const message = 'مرحباً، أحتاج مساعدة من مريح';
    expect(MUREEH_WHATSAPP_NUMBER).toBe('970593498909');
    expect(MUREEH_WHATSAPP_DISPLAY).toBe('+970593498909');
    expect(buildMureehWhatsAppUrl(message)).toBe(
      `https://wa.me/970593498909?text=${encodeURIComponent(message)}`,
    );
    expect(buildMureehWhatsAppUrl()).toBe('https://wa.me/970593498909');
  });

  it('routes sales, pricing and platform support to WhatsApp, not Telegram', () => {
    const files = [
      '../components/common/SaaSLandingPage.tsx',
      '../components/customer/CustomerHeader.tsx',
      '../components/customer/OrderTrackingDrawer.tsx',
      '../../server/seo/landingPrerender.ts',
    ].map(read);

    for (const source of files) {
      expect(source).toContain('buildMureehWhatsAppUrl');
      expect(source).toContain('MUREEH_WHATSAPP_DISPLAY');
      expect(source).not.toMatch(/t\.me\/|Mureeh_tech_bot/);
    }
  });
});
