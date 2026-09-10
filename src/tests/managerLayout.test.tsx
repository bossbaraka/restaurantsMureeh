import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Mobile manager-header coverage: on phones the dashboard sections must be
 * reachable through a creative button-list sheet (the desktop sidebar keeps
 * its vertical nav, and the footer shortcuts must not stay desktop-only).
 */

const contextMock = {
  orders: [
    { id: 'o1', status: 'PENDING' },
    { id: 'o2', status: 'SERVED' },
  ],
  waiterRequests: [{ id: 'w1', status: 'PENDING' }],
  setViewMode: () => {},
  currentRestaurant: {
    id: 'rest-1',
    name: 'مطعم الاختبار',
    nameEn: 'Test',
    slug: 'test',
    primaryColor: '#D4AF37',
    accentColor: '#C5A880',
  },
  tenantsList: [],
  setCurrentTenantBySlug: () => {},
  setIsOnboardingOpen: () => {},
};

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useRestaurant: () => contextMock };
});

vi.mock(import('../context/AuthContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({
      isSuperAdmin: true,
      canAccessManagerTab: () => true,
      switchManagerRestaurant: () => {},
    }),
  };
});

// The heavy section views are irrelevant to the header — stub them out.
const stub = (name: string) => ({ default: () => null, [name]: () => null });
vi.mock(import('../components/manager/DashboardOverview'), () => stub('DashboardOverview'));
vi.mock(import('../components/manager/OrderManagement'), () => stub('OrderManagement'));
vi.mock(import('../components/manager/TableManagement'), () => stub('TableManagement'));
vi.mock(import('../components/manager/QRManagement'), () => stub('QRManagement'));
vi.mock(import('../components/manager/MenuManagement'), () => stub('MenuManagement'));
vi.mock(import('../components/manager/OffersManagement'), () => stub('OffersManagement'));
vi.mock(import('../components/manager/WaiterRequestsList'), () => stub('WaiterRequestsList'));
vi.mock(import('../components/manager/AnalyticsView'), () => stub('AnalyticsView'));
vi.mock(import('../components/manager/BrandingSettingsView'), () => stub('BrandingSettingsView'));
vi.mock(import('../components/manager/SubscriptionView'), () => stub('SubscriptionView'));
vi.mock(import('../components/manager/StaffManagement'), () => stub('StaffManagement'));
vi.mock(import('../components/manager/CashierPOSView'), () => stub('CashierPOSView'));
vi.mock(import('../components/manager/BranchManagementView'), () => stub('BranchManagementView'));

const { ManagerLayout } = await import('../components/manager/ManagerLayout');

const componentPath = fileURLToPath(new URL('../components/manager/ManagerLayout.tsx', import.meta.url));
const componentSource = readFileSync(componentPath, 'utf8');

describe('ManagerLayout header', () => {
  it('renders the mobile button-list trigger with the active section and total alerts', () => {
    const html = renderToStaticMarkup(<ManagerLayout />);

    // Trigger shows the active tab and the combined alerts badge
    // (1 pending order + 1 pending waiter request = 2).
    expect(html).toContain('فتح قائمة أقسام لوحة التحكم');
    expect(html).toContain('لوحة العمليات');
    expect(html).toContain('>2</span>');
  });

  it('opens as a button-list sheet on phones only and keeps the desktop sidebar intact', () => {
    // Sheet is phone-only and overlays content like other app sheets.
    expect(componentSource).toContain('z-50 md:hidden flex flex-col justify-end');
    // Desktop nav stays vertical; the phone horizontal scroll-strip is gone.
    expect(componentSource).toContain('hidden md:flex md:flex-col');
    // Escape-to-close + body scroll lock via the shared dialog hook.
    expect(componentSource).toContain('useDialog({ isOpen: isMobileNavOpen');
  });

  it('keeps the sidebar footer shortcuts reachable from the mobile sheet', () => {
    // These were `hidden md:block` only — unreachable on phones before.
    expect(componentSource).toContain('معاينة منيو العميل');
    expect(componentSource).toContain('بوابة مدير المنصة العام');
    // The mobile sheet renders its own copies (guarded independently of the CSS-hidden footer).
    expect(componentSource.match(/معاينة منيو العميل/g)?.length).toBeGreaterThanOrEqual(2);
    expect(componentSource.match(/PLATFORM_ADMIN/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
