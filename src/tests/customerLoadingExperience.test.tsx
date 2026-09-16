/**
 * Behavioral render tests for CustomerLoadingExperience — the premium
 * guest-facing layer for every non-READY entry state.
 *
 * The hard rule under test: NO technical information may reach the
 * customer from this component — no HTTP statuses, no fetch/network
 * wording, no API/database/Supabase vocabulary. Only calm, human copy.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerLoadingExperience } from '../components/customer/CustomerLoadingExperience';

const TECHNICAL_TERMS = [
  '500', '502', '503', '404', 'HTTP', 'API', 'fetch', 'Fetch', 'Network', 'network',
  'Supabase', 'Prisma', 'PostgreSQL', 'Render', 'JWT', 'SQL', 'Error', 'error',
  'stack', 'timeout', 'Timeout', 'retry count', 'Attempt',
];

const restaurant = {
  name: 'مطعم الاختبار',
  nameEn: 'Test Restaurant',
  logo: 'https://cdn.example.test/logo.webp',
};

const render = (ui: React.ReactElement) => renderToStaticMarkup(ui);

describe('loading states (INITIALIZING → RETRYING)', () => {
  it('shows the human status line and menu skeleton, never technical text', () => {
    const html = render(
      <CustomerLoadingExperience phase="LOADING_CATALOG" restaurant={restaurant} />
    );
    expect(html).toContain('نجهّز لك التجربة...');
    expect(html).toContain('mload__skeleton');
    expect(html).toContain('مطعم الاختبار');
    for (const term of TECHNICAL_TERMS) expect(html).not.toContain(term);
  });

  it('renders the tenant logo when identity is known', () => {
    const html = render(<CustomerLoadingExperience phase="VALIDATING_QR" restaurant={restaurant} />);
    expect(html).toContain('https://cdn.example.test/logo.webp');
    expect(html).toContain('mload__logo');
  });

  it('falls back to the monogram without a broken-image icon when no logo exists', () => {
    const html = render(
      <CustomerLoadingExperience phase="LOADING_CATALOG" restaurant={{ name: 'بلا شعار' }} />
    );
    expect(html).toContain('mload__monogram');
    expect(html).not.toContain('<img');
  });

  it('the RETRYING phase keeps the same calm loader (no attempt counters)', () => {
    const html = render(<CustomerLoadingExperience phase="RETRYING" restaurant={restaurant} />);
    expect(html).toContain('نجهّز لك التجربة...');
    expect(html).not.toContain('Attempt');
    expect(html).not.toContain('محاولة 2');
  });
});

describe('RECOVERY state', () => {
  it('shows the safe recovery card with a retry action', () => {
    const html = render(
      <CustomerLoadingExperience phase="RECOVERY" restaurant={restaurant} onRetry={() => {}} />
    );
    expect(html).toContain('يبدو أن التجربة تحتاج إلى لحظة إضافية.');
    expect(html).toContain('إعادة المحاولة');
    expect(html).toContain('mload__retry');
    for (const term of TECHNICAL_TERMS) expect(html).not.toContain(term);
  });

  it('omits the button gracefully when no retry handler exists', () => {
    const html = render(<CustomerLoadingExperience phase="RECOVERY" restaurant={restaurant} />);
    expect(html).toContain('يبدو أن التجربة تحتاج إلى لحظة إضافية.');
    expect(html).not.toContain('mload__retry');
  });
});

describe('INVALID state', () => {
  it('bad QR shows the minimal friendly invalid state — no technical detail', () => {
    const html = render(
      <CustomerLoadingExperience phase="INVALID" invalidReason="qr" restaurant={null} />
    );
    expect(html).toContain('يبدو أن رمز الطاولة غير صالح.');
    expect(html).toContain('امسح الرمز الموجود على طاولتك لفتح القائمة.');
    for (const term of TECHNICAL_TERMS) expect(html).not.toContain(term);
  });

  it('unavailable venue shows a distinct calm state', () => {
    const html = render(
      <CustomerLoadingExperience phase="INVALID" invalidReason="restaurant" restaurant={null} />
    );
    expect(html).toContain('هذا المطعم غير متاح حالياً.');
    expect(html).not.toContain('رمز الطاولة غير صالح');
  });
});

describe('structure & accessibility', () => {
  it('is RTL, announces itself politely and marks busy state while loading', () => {
    const html = render(<CustomerLoadingExperience phase="LOADING_CATALOG" restaurant={restaurant} />);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    const settled = render(<CustomerLoadingExperience phase="RECOVERY" restaurant={restaurant} />);
    expect(settled).toContain('aria-busy="false"');
  });
});

describe('cinematic 3-stage customer loading & atmosphere UX', () => {
  it('renders all 3 visual stages (01-المطعم, 02-الأجواء, 03-التجربة) and progress bar', () => {
    const restaurantWithAtmosphere = {
      ...restaurant,
      coverImage: 'https://cdn.example.test/cover.webp',
      galleryImages: ['https://cdn.example.test/gallery1.webp', 'https://cdn.example.test/gallery2.webp'],
    };
    const html = render(<CustomerLoadingExperience phase="LOADING_CATALOG" restaurant={restaurantWithAtmosphere} />);

    // Check step numbers and labels
    expect(html).toContain('01');
    expect(html).toContain('المطعم');
    expect(html).toContain('02');
    expect(html).toContain('الأجواء');
    expect(html).toContain('03');
    expect(html).toContain('التجربة');

    // Check progress bar structure
    expect(html).toContain('mload-progress-track');
    expect(html).toContain('mload-progress-fill');
    expect(html).toContain('mload-progress-shine');

    // Check showcase slide image
    expect(html).toContain('mload-showcase');
    expect(html).toContain('https://cdn.example.test/cover.webp');
  });

  it('renders rich 3D CSS fallback scene when restaurant has zero images', () => {
    const restaurantNoImages = {
      name: 'مطعم بلا صور',
      nameEn: 'No Image Restaurant',
      logo: '',
      coverImage: '',
      galleryImages: [],
    };
    const html = render(<CustomerLoadingExperience phase="LOADING_CATALOG" restaurant={restaurantNoImages} />);

    // Verifies 3D CSS architectural fallback is rendered
    expect(html).toContain('mload__scene');
    expect(html).toContain('mload__halo-glow');
    expect(html).toContain('mload__floor');
    expect(html).toContain('mload__ring');
    expect(html).toContain('mload__cube');
  });

  it('renders initials in monogram when logo is missing', () => {
    const html = render(
      <CustomerLoadingExperience phase="LOADING_CATALOG" restaurant={{ name: 'شوارما البركة' }} />
    );
    expect(html).toContain('mload__monogram');
    // Arabic letter "ش"
    expect(html).toContain('ش');
  });
});
