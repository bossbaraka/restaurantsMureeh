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
    expect(html).toContain('Just a moment');
    expect(html).toContain('لحظات ونكون جاهزين');
    expect(html).toContain('mload__orbit');
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
    expect(html).toContain('Just a moment');
    expect(html).not.toContain('Attempt');
    expect(html).not.toContain('محاولة 2');
  });
});

describe('continuous restaurant → coffee → time sequence', () => {
  it.each([
    ['INITIALIZING', 'Preparing your experience', 'بنحضّرلك تجربتك'],
    ['LOADING_RESTAURANT', 'Brewing the experience', 'بنحضّرلك كل التفاصيل'],
    ['LOADING_CATALOG', 'Just a moment', 'لحظات ونكون جاهزين'],
  ] as const)('maps the real entry phase %s to %s without a timer', (phase, english, arabic) => {
    const html = render(<CustomerLoadingExperience phase={phase} restaurant={restaurant} />);
    expect(html).toContain(english);
    expect(html).toContain(arabic);
    expect(html).toContain('mload__orbit');
    expect(html).not.toContain('setTimeout');
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
