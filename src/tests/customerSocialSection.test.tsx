import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Restaurant, RestaurantSocials } from '../types/restaurant';

/**
 * «تواصل معنا» — the guest menu's contact section.
 *
 * The rule that matters most is the empty state: a venue that published
 * nothing must not get an empty heading, a dead icon row or a placeholder
 * tile. Everything else (1 link, 5 links, RTL, accessible names) follows.
 */

const restaurant = (socials?: RestaurantSocials, whatsappNumber?: string): Restaurant =>
  ({
    id: 'r1',
    name: 'مطعم الديوان',
    nameEn: 'Diwan',
    slug: 'diwan',
    logo: '',
    description: '',
    phone: '',
    address: '',
    currency: '₪',
    language: 'ar',
    timezone: 'Asia/Jerusalem',
    status: 'ACTIVE',
    primaryColor: '#D4AF37',
    accentColor: '#C5A880',
    planId: 'plan-pro',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    socials,
    whatsappNumber,
  }) as Restaurant;

let current: Restaurant | null = null;

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({ currentRestaurant: current }),
  };
});

const { CustomerSocialSection } = await import('../components/customer/CustomerSocialSection');

const renderWith = (value: Restaurant | null) => {
  current = value;
  return renderToStaticMarkup(<CustomerSocialSection />);
};

describe('CustomerSocialSection', () => {
  it('renders nothing at all when the venue published no channel', () => {
    expect(renderWith(restaurant())).toBe('');
    expect(renderWith(restaurant({ instagram: '  ' }))).toBe('');
    expect(renderWith(restaurant({ instagram: 'javascript:alert(1)' }))).toBe('');
    expect(renderWith(null)).toBe('');
    // No heading, no list, no empty tile.
    expect(renderWith(restaurant())).not.toContain('تابعنا');
  });

  it('shows one wide tile when there is exactly one channel', () => {
    const html = renderWith(restaurant({ instagram: 'https://www.instagram.com/diwan' }));

    expect(html).toContain('تابعنا');
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('href="https://www.instagram.com/diwan"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('aria-label="إنستغرام — مطعم الديوان"');
  });

  it('adapts to five channels without dropping any', () => {
    const html = renderWith(
      restaurant({
        instagram: 'https://www.instagram.com/diwan',
        facebook: 'https://www.facebook.com/diwan',
        tiktok: 'https://www.tiktok.com/@diwan',
        youtube: 'https://www.youtube.com/@diwan',
        website: 'https://diwan.ps',
      })
    );

    expect(html).not.toContain('grid-cols-1');
    for (const label of ['إنستغرام', 'فيسبوك', 'تيك توك', 'يوتيوب', 'الموقع الإلكتروني']) {
      expect(html).toContain(label);
    }
    expect((html.match(/rel="noopener noreferrer"/g) || []).length).toBe(5);
  });

  it('offers WhatsApp as a contact channel when the venue published a number', () => {
    const html = renderWith(restaurant(undefined, '+970599123456'));

    expect(html).toContain('واتساب');
    expect(html).toContain('https://wa.me/970599123456?text=');
    expect(html).toContain('aria-label="مراسلة مطعم الديوان على واتساب"');
  });

  it('never renders a WhatsApp tile for an unusable number', () => {
    expect(renderWith(restaurant(undefined, 'not-a-number'))).toBe('');
    expect(renderWith(restaurant({ instagram: 'https://www.instagram.com/diwan' }, '12'))).not.toContain(
      'wa.me'
    );
  });

  it('is written for RTL and keeps the link direction readable', () => {
    const html = renderWith(restaurant({ instagram: 'https://www.instagram.com/diwan' }));

    // The handle is a latin string inside an RTL paragraph.
    expect(html).toContain('@diwan');
    expect(html).toContain('dir="ltr"');
    // The whole customer experience is RTL; the section must not opt out.
    expect(html).not.toContain('dir="ltr" class="customer-social');
  });

  it('gives every tile an accessible name that is not the icon alone', () => {
    const html = renderWith(restaurant({ youtube: 'https://www.youtube.com/@diwan' }));

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-label="يوتيوب — مطعم الديوان"');
    expect(html).toContain('title="YouTube"');
  });
});
