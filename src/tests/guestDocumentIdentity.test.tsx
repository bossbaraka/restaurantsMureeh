/** @vitest-environment jsdom */
/**
 * Guest browser chrome — the tab belongs to the restaurant.
 *
 * Scanning a QR code opens a tab. Its title, its favicon, the description used
 * when the guest shares the page and the mobile status-bar colour are all part
 * of what they see, so all four are rewritten from the tenant record and put
 * back when the guest surface unmounts (staff previews must not inherit them).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Restaurant } from '../types/restaurant';
import {
  NEUTRAL_MENU_ICON,
  applyDocumentIdentity,
  prepareGuestRouteIdentity,
  useTenantDocumentIdentity,
} from '../hooks/useTenantDocumentIdentity';

const restaurant: Restaurant = {
  id: 'rest-cedar',
  name: 'مطعم الأرز',
  nameEn: 'CEDAR HOUSE',
  slug: 'cedar',
  logo: 'https://cdn.example.test/logos/cedar.png',
  description: 'مطبخ شامي معاصر على الشرفة.',
  phone: '0599000000',
  address: 'شارع الإرسال، البيرة',
  currency: '₪',
  language: 'ar',
  timezone: 'Asia/Hebron',
  status: 'ACTIVE',
  primaryColor: '#7C3AED',
  accentColor: '#22D3EE',
  planId: 'plan-pro',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const metaContent = (name: string): string | null =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
const iconHref = (): string | null =>
  document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute('href') ?? null;

/** Start every test from a known, platform-flavoured document. */
function seedDocument() {
  document.title = 'مُريح | منصة الخدمات الإلكترونية للمطاعم';
  document.head.innerHTML = `
    <meta name="description" content="منصة إدارة المطاعم" />
    <meta name="theme-color" content="#020A14" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  `;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  seedDocument();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.head.innerHTML = '';
  document.title = '';
});

describe('applyDocumentIdentity', () => {
  it('rewrites all four pieces of chrome from the tenant', () => {
    applyDocumentIdentity({
      title: 'مطعم الأرز | CEDAR HOUSE',
      description: 'مطبخ شامي معاصر على الشرفة.',
      icon: 'https://cdn.example.test/logos/cedar.png',
      themeColor: '#7C3AED',
    });

    expect(document.title).toBe('مطعم الأرز | CEDAR HOUSE');
    expect(metaContent('description')).toBe('مطبخ شامي معاصر على الشرفة.');
    expect(iconHref()).toBe('https://cdn.example.test/logos/cedar.png');
    expect(metaContent('theme-color')).toBe('#7C3AED');
    // The platform mark is gone from the tab.
    expect(document.title).not.toMatch(/مريح|mureeh/i);
    expect(iconHref()).not.toContain('favicon.svg');
  });

  it('puts the previous identity back, tag for tag', () => {
    const before = {
      title: document.title,
      description: metaContent('description'),
      theme: metaContent('theme-color'),
      icon: iconHref(),
    };

    const restore = applyDocumentIdentity({
      title: 'مطعم الأرز',
      description: 'وصفة المطعم',
      icon: 'https://cdn.example.test/logos/cedar.png',
      themeColor: '#7C3AED',
    });
    expect(document.title).not.toBe(before.title);

    restore();

    expect(document.title).toBe(before.title);
    expect(metaContent('description')).toBe(before.description);
    expect(metaContent('theme-color')).toBe(before.theme);
    expect(iconHref()).toBe(before.icon);
  });

  it('removes anything it had to create, so nothing is left behind', () => {
    document.head.innerHTML = '';
    expect(iconHref()).toBeNull();

    const restore = applyDocumentIdentity({
      title: 'مطعم الأرز',
      description: 'وصفة المطعم',
      icon: 'data:image/svg+xml,%3Csvg/%3E',
      themeColor: '#7C3AED',
    });
    expect(iconHref()).toContain('data:image/svg+xml');
    expect(metaContent('description')).toBe('وصفة المطعم');

    restore();
    expect(iconHref()).toBeNull();
    expect(metaContent('description')).toBeNull();
    expect(metaContent('theme-color')).toBeNull();
  });

  it('refuses a theme colour that is not a plain hex value', () => {
    applyDocumentIdentity({
      title: 'مطعم الأرز',
      description: 'x',
      icon: 'data:image/svg+xml,%3Csvg/%3E',
      themeColor: 'red" onload="alert(1)',
    });
    expect(metaContent('theme-color')).not.toContain('onload');
  });
});

describe('prepareGuestRouteIdentity', () => {
  it('neutralises the tab on a QR route before React mounts', () => {
    const restore = prepareGuestRouteIdentity({ pathname: '/r/cedar' });

    expect(document.title).not.toMatch(/مريح|mureeh/i);
    expect(iconHref()).toBe(NEUTRAL_MENU_ICON);
    expect(metaContent('description')).not.toContain('منصة');

    restore();
    expect(iconHref()).toBe('/favicon.svg');
  });

  it('leaves every other route exactly as the server rendered it', () => {
    for (const pathname of ['/', '/manager', '/admin', '/landing']) {
      seedDocument();
      const title = document.title;
      prepareGuestRouteIdentity({ pathname });
      expect(document.title).toBe(title);
      expect(iconHref()).toBe('/favicon.svg');
    }
  });
});

describe('useTenantDocumentIdentity', () => {
  const Harness: React.FC<{ tenant: Restaurant | null }> = ({ tenant }) => {
    useTenantDocumentIdentity(tenant);
    return <div data-shell />;
  };

  it('hands the tab to the restaurant while the guest surface is mounted', () => {
    act(() => root.render(<Harness tenant={restaurant} />));

    expect(document.title).toBe('مطعم الأرز | CEDAR HOUSE');
    expect(iconHref()).toBe(restaurant.logo);
    expect(metaContent('theme-color')).toBe('#7C3AED');
  });

  it('gives the chrome back when the guest surface unmounts', () => {
    act(() => root.render(<Harness tenant={restaurant} />));
    expect(document.title).toContain('CEDAR HOUSE');

    act(() => root.render(<Harness tenant={null} />));
    act(() => root.unmount());

    expect(document.title).not.toContain('CEDAR HOUSE');
    expect(iconHref()).toBe('/favicon.svg');

    // Re-create a root for the shared afterEach teardown.
    root = createRoot(host);
  });

  it('follows the tenant when the venue changes under a staff preview', () => {
    act(() => root.render(<Harness tenant={restaurant} />));
    expect(document.title).toContain('مطعم الأرز');

    act(() =>
      root.render(
        <Harness tenant={{ ...restaurant, id: 'r2', name: 'الديوان', nameEn: 'DIWAN', logo: '' }} />
      )
    );

    expect(document.title).toContain('الديوان');
    // No logo on file: the tile is generated from the venue's own identity.
    expect(iconHref()).toContain('data:image/svg+xml');
    expect(iconHref()).not.toContain('favicon.svg');
  });
});
