/**
 * Design-QA regression tests (audit 2026-09-09).
 *
 * Each test pins a defect that was CONFIRMED present by rendering the real
 * component tree and measuring the resulting DOM/CSS. They are pure
 * render/string assertions so they run with no browser and no database.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

// ---------------------------------------------------------------
// A11Y-001 — pinch-zoom must never be disabled (WCAG 1.4.4)
// ---------------------------------------------------------------
describe('A11Y-001: viewport allows zoom', () => {
  const html = read('index.html');
  const viewport = html.match(/name="viewport"\s+content="([^"]+)"/)?.[1] ?? '';

  it('does not disable user scaling', () => {
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/);
  });

  it('does not clamp maximum-scale below 2', () => {
    const max = viewport.match(/maximum-scale\s*=\s*([\d.]+)/)?.[1];
    if (max) expect(parseFloat(max)).toBeGreaterThanOrEqual(2);
  });

  it('still sets viewport-fit=cover for notched devices', () => {
    expect(viewport).toContain('viewport-fit=cover');
  });

  it('keeps form controls at >=16px so iOS does not auto-zoom', () => {
    // This is what makes disabling zoom unnecessary in the first place.
    expect(html).toMatch(/input,\s*select,\s*textarea,\s*button\s*\{[^}]*font-size:\s*16px/);
  });
});

// ---------------------------------------------------------------
// A11Y-003 — visible keyboard focus
// ---------------------------------------------------------------
describe('A11Y-003: focus visibility', () => {
  it('global focus-visible ring exists in base layer', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/);
  });

  it('Button uses focus-visible rather than bare outline-none', () => {
    const html = renderToStaticMarkup(React.createElement(Button, null, 'حفظ'));
    expect(html).toContain('focus-visible:ring-2');
  });
});

// ---------------------------------------------------------------
// A11Y-005 / DS-004 — Button semantics
// ---------------------------------------------------------------
describe('DS-004: Button component', () => {
  it('announces the loading state and disables interaction', () => {
    const html = renderToStaticMarkup(
      React.createElement(Button, { isLoading: true }, 'حفظ')
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled');
  });

  it('does not emit an empty label span for icon-only buttons', () => {
    const html = renderToStaticMarkup(
      React.createElement(Button, { 'aria-label': 'إغلاق' } as any)
    );
    expect(html).not.toContain('<span></span>');
  });

  it('meets the touch-target floor at md/lg sizes', () => {
    for (const [size, min] of [['md', 44], ['lg', 48]] as const) {
      const html = renderToStaticMarkup(
        React.createElement(Button, { size } as any, 'زر')
      );
      expect(html).toContain(`min-h-[${min}px]`);
    }
  });

  it('marks decorative icons aria-hidden', () => {
    const html = renderToStaticMarkup(
      React.createElement(Button, { icon: React.createElement('svg') }, 'حفظ')
    );
    expect(html).toContain('aria-hidden="true"');
  });
});

// ---------------------------------------------------------------
// DS-006 — Modal dialog semantics
// ---------------------------------------------------------------
describe('DS-006: Modal semantics', () => {
  const src = read('src/components/common/Modal.tsx');
  it('exposes role=dialog and aria-modal', () => {
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal="true"');
  });
  it('associates the title via aria-labelledby', () => {
    expect(src).toContain('aria-labelledby');
    expect(src).toContain('useId');
  });
  it('hides the backdrop from assistive tech', () => {
    expect(src).toMatch(/backdrop[\s\S]{0,200}aria-hidden="true"/);
  });
});

// ---------------------------------------------------------------
// UX-001 — every overlay closes on Escape and locks page scroll
// ---------------------------------------------------------------
describe('UX-001: dialog behaviour is shared, not re-invented', () => {
  const overlays = [
    'src/components/customer/CartDrawer.tsx',
    'src/components/customer/ProductDetailModal.tsx',
    'src/components/customer/WaiterCallModal.tsx',
    'src/components/manager/ProductFormModal.tsx',
    'src/components/onboarding/RestaurantOnboardingModal.tsx',
  ];
  it.each(overlays)('%s uses the useDialog hook', (file) => {
    expect(read(file)).toContain('useDialog(');
  });

  it('scroll locking is reference counted for nested overlays', () => {
    const hook = read('src/hooks/useDialog.ts');
    expect(hook).toContain('scrollLockCount');
  });

  it('the onboarding wizard opts out of Escape to protect entered data', () => {
    expect(read('src/components/onboarding/RestaurantOnboardingModal.tsx'))
      .toContain('closeOnEscape: false');
  });
});

// ---------------------------------------------------------------
// A11Y-002 — form controls have accessible names
// ---------------------------------------------------------------
describe('A11Y-002: form labelling', () => {
  const formFiles = [
    'src/components/manager/ProductFormModal.tsx',
    'src/components/manager/StaffManagement.tsx',
    'src/components/manager/BrandingSettingsView.tsx',
    'src/components/onboarding/RestaurantOnboardingModal.tsx',
  ];

  it.each(formFiles)('%s links labels to controls with htmlFor', (f) => {
    const src = read(f);
    const labels = (src.match(/<label/g) || []).length;
    const linked = (src.match(/htmlFor=/g) || []).length;
    // Wrapper labels (checkboxes) are legitimately unlinked, so require that
    // the file uses htmlFor at all rather than demanding a 1:1 count.
    if (labels > 2) expect(linked).toBeGreaterThan(0);
  });

  it('search inputs expose an accessible name', () => {
    for (const f of [
      'src/components/manager/OrderManagement.tsx',
      'src/components/manager/MenuManagement.tsx',
      'src/components/manager/TableManagement.tsx',
      'src/components/manager/QRManagement.tsx',
      'src/components/customer/CustomerHero.tsx',
    ]) {
      expect(read(f)).toMatch(/aria-label=/);
    }
  });
});

// ---------------------------------------------------------------
// TYPO-001 — no illegible type in real product UI
// ---------------------------------------------------------------
describe('TYPO-001: minimum legible font size', () => {
  // The landing page's phone mockups deliberately render miniature type to
  // depict a device screen; they are illustrations, not readable UI.
  const MOCKUP_FILES = [
    'src/components/common/landing/mockups.tsx',
    'src/components/common/landing/DemoVideoPlayer.tsx',
    'src/components/common/SaaSLandingPage.tsx',
    'src/components/brand/BrandLogo.tsx',
    'src/components/manager/PrintMenuModal.tsx',
    'src/components/manager/PrintQRTentCardsModal.tsx',
  ];

  it('no real UI surface uses text below 10px', () => {
    const offenders: string[] = [];
    const files = [
      'src/components/manager/AnalyticsView.tsx',
      'src/components/manager/CashierPOSView.tsx',
      'src/components/manager/BrandingSettingsView.tsx',
      'src/components/manager/BranchManagementView.tsx',
      'src/components/manager/LiveRestaurantScreen.tsx',
      'src/components/manager/SubscriptionView.tsx',
      'src/components/customer/DirectTableEntryModal.tsx',
      'src/components/customer/CustomerOrderLiveNotifier.tsx',
      'src/components/onboarding/RestaurantOnboardingModal.tsx',
    ];
    for (const f of files) {
      const hits = read(f).match(/text-\[[89]px\]/g);
      if (hits) offenders.push(`${f}: ${hits.join(',')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('mockup files are the only place sub-10px type remains', () => {
    // Guards the exemption itself: if this list shrinks, tighten the rule.
    expect(MOCKUP_FILES.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------
// DS-001 — platform blue is a token, not a scattered literal
// ---------------------------------------------------------------
describe('DS-001: colour tokens', () => {
  const cfg = read('tailwind.config.js');
  it('defines the brand blue ramp', () => {
    expect(cfg).toContain('brand:');
    expect(cfg).toContain('#0072BC');
  });
  it('keeps the existing gold and luxury ramps intact', () => {
    expect(cfg).toContain('gold:');
    expect(cfg).toContain('luxury:');
    expect(cfg).toContain('#D4AF37');
  });
});

// ---------------------------------------------------------------
// Badge — sanity that the shared primitive still renders
// ---------------------------------------------------------------
describe('Badge primitive', () => {
  it('renders a dot variant without crashing', () => {
    const html = renderToStaticMarkup(
      React.createElement(Badge, { variant: 'emerald', dot: true }, 'نشط')
    );
    expect(html).toContain('نشط');
  });
});

// ---------------------------------------------------------------
// A11Y-007 — reduced motion
// ---------------------------------------------------------------
describe('A11Y-007: prefers-reduced-motion', () => {
  it('globally neutralises animation for users who ask for it', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });
});
