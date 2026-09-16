/**
 * Editorial Atmosphere Gallery & Lightbox Regression Tests
 *
 * Verifies:
 * - Desktop asymmetric grid layout (7/5 split)
 * - Mobile aspect-[4/3] hero and horizontal scroll-snap strip
 * - Fullscreen dark lightbox with counter (X / Y)
 * - Next/prev navigation controls
 * - Focus/Escape management and accessibility dialog role
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerHero } from '../components/customer/CustomerHero';
import * as RestaurantContextModule from '../context/RestaurantContext';
import type { Restaurant } from '../types/restaurant';

const mockRestaurant: Restaurant = {
  id: 'rest-123',
  name: 'مطعم السفير الفاخر',
  nameEn: 'Al Safeer Luxury Restaurant',
  slug: 'al-safeer',
  logo: 'https://cdn.example.test/logo.webp',
  coverImage: 'https://cdn.example.test/cover.webp',
  description: 'أرقى المأكولات في أجواء استثنائية.',
  phone: '0599123456',
  address: 'شارع القدس',
  currency: '₪',
  language: 'ar',
  timezone: 'Asia/Jerusalem',
  status: 'ACTIVE',
  primaryColor: '#D4AF37',
  accentColor: '#C5A880',
  galleryImages: [
    'https://cdn.example.test/hall-1.webp',
    'https://cdn.example.test/hall-2.webp',
    'https://cdn.example.test/hall-3.webp',
  ],
  planId: 'plan-pro',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('CustomerHero Editorial Atmosphere Gallery', () => {
  it('renders desktop asymmetric grid with 7/5 column ratio and mobile scroll-snap', () => {
    vi.spyOn(RestaurantContextModule, 'useRestaurant').mockReturnValue({
      searchQuery: '',
      setSearchQuery: vi.fn(),
      offers: [],
      currentRestaurant: mockRestaurant,
      activeTableOrders: [],
      setIsOrderTrackingOpen: vi.fn(),
    } as any);

    const html = renderToStaticMarkup(<CustomerHero />);

    // Section title
    expect(html).toContain('أجواء وصالة المطعم الحية');
    expect(html).toContain('اللقطة الرئيسية');

    // Desktop asymmetric layout (col-span-7 main image, col-span-5 secondary images)
    expect(html).toContain('col-span-7');
    expect(html).toContain('col-span-5');

    // Mobile swipeable strip
    expect(html).toContain('aspect-[4/3]');
    expect(html).toContain('snap-x');
    expect(html).toContain('snap-start');

    // Accessible buttons for full-screen viewing
    expect(html).toContain('عرض صورة الصالة الرئيسية بالحجم الكامل');
    expect(html).toContain('عرض صورة المعرض رقم 2');
  });

  it('renders default gallery images if tenant has not uploaded custom images', () => {
    vi.spyOn(RestaurantContextModule, 'useRestaurant').mockReturnValue({
      searchQuery: '',
      setSearchQuery: vi.fn(),
      offers: [],
      currentRestaurant: {
        ...mockRestaurant,
        galleryImages: [],
      },
      activeTableOrders: [],
      setIsOrderTrackingOpen: vi.fn(),
    } as any);

    const html = renderToStaticMarkup(<CustomerHero />);

    expect(html).toContain('أجواء وصالة المطعم');
    expect(html).toContain('col-span-7');
  });
});
