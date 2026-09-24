/**
 * SHELL ISOLATION GUARD — the public customer menu is not a platform surface.
 *
 * Contract pinned here (App.tsx):
 *
 *   PUBLIC_CUSTOMER            a guest on the menu (QR scan, /r/{slug}).
 *                              Customer shell ONLY: no ViewSwitcher is mounted,
 *                              no platform surface wraps the menu.
 *   PLATFORM_CUSTOMER_PREVIEW  a signed-in console user in CUSTOMER view.
 *                              Platform shell + ViewSwitcher, unchanged.
 *   MANAGER / KDS / LIVE       Platform shell + ViewSwitcher, unchanged.
 *
 * and, because the toolbar is UNMOUNTED rather than hidden, the sticky stack
 * measures only the bands that exist:
 *
 *   public   toolbar = 0 (absent), --m-stack-h = measured header height
 *   preview  --m-stack-h = measured toolbar + measured header
 *
 * WHAT IS REAL HERE: App, AuthProvider (the production permission matrix that
 * tells a guest from a console user), ViewSwitcher, StickyStackProvider,
 * CustomerThemeProvider (the element that carries the stack variables) and
 * CustomerHeader (the 'header' band).
 *
 * WHAT IS REPLACED: RestaurantContext (its provider opens network/SSE work;
 * the URL → 'CUSTOMER' mapping it owns is unchanged and is represented by
 * `viewMode`), and the heavy views, which become inert placeholders.
 *
 * jsdom performs no layout, so band heights are INJECTED through
 * getBoundingClientRect — the same technique as stickyStack.test.tsx. No
 * pixel value is asserted that the stack did not compose itself.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// ---------------------------------------------------------------------------
// Module replacements
// ---------------------------------------------------------------------------

/** The only RestaurantContext state the shell decision reads. */
const shellState = vi.hoisted(() => ({ viewMode: 'CUSTOMER' as string }));

vi.mock('../context/RestaurantContext', () => {
  const noop = () => {};
  const restaurant = { id: 'rest-1', slug: 'demo', name: 'مطعم التجربة', nameEn: 'Demo' };
  return {
    RestaurantProvider: ({ children }: { children?: React.ReactNode }) => children,
    useRestaurant: () => ({
      // App
      viewMode: shellState.viewMode,
      setViewMode: noop,
      isOnboardingOpen: false,
      setIsOnboardingOpen: noop,
      currentRestaurant: restaurant,
      // ViewSwitcher
      activeTableId: null,
      activeTableNumber: null,
      activeTable: null,
      tenantsList: [],
      setCurrentTenantBySlug: noop,
      soundEnabled: true,
      toggleSound: noop,
      refreshTenantData: noop,
      waiterRequests: [],
      orders: [],
      setIsTableSelectorOpen: noop,
      // CustomerHeader
      cartTotalCount: 0,
      cartSubtotal: 0,
      setIsCartOpen: noop,
      setIsWaiterModalOpen: noop,
      activeTableOrders: [],
      setIsOrderTrackingOpen: noop,
    }),
  };
});

// The real CustomerLayout's sticky skeleton, built from the REAL pieces:
// CustomerThemeProvider publishes the stack variables on
// `.customer-theme-scope`, CustomerHeader registers the 'header' band, and
// `.menu-rail` consumes var(--m-stack-h) (pinned by stickyStack.test.tsx).
// Only CustomerLayoutContent's menu body is left out.
vi.mock('../components/customer/CustomerLayout', async () => {
  const { CustomerThemeProvider } = await import('../theme/CustomerThemeProvider');
  const { CustomerHeader } = await import('../components/customer/CustomerHeader');
  const { useRestaurant } = await import('../context/RestaurantContext');
  return {
    CustomerLayout: () => {
      const { currentRestaurant } = useRestaurant();
      return (
        <CustomerThemeProvider restaurant={currentRestaurant}>
          <div className="customer-shell">
            <CustomerHeader />
            <main>
              <div className="menu-rail" />
            </main>
          </div>
        </CustomerThemeProvider>
      );
    },
  };
});

vi.mock('../components/manager/ManagerLayout', () => ({
  ManagerLayout: () => <section data-view="MANAGER" />,
}));
vi.mock('../components/manager/KitchenDisplaySystem', () => ({
  KitchenDisplaySystem: () => <section data-view="KITCHEN_KDS" />,
}));
vi.mock('../components/manager/LiveRestaurantScreen', () => ({
  LiveRestaurantScreen: () => <section data-view="LIVE_SCREEN" />,
}));
vi.mock('../components/common/SaaSLandingPage', () => ({
  SaaSLandingPage: () => <section data-view="SAAS_LANDING" />,
}));
vi.mock('../components/admin/PlatformAdminPortal', () => ({
  PlatformAdminPortal: () => <section data-view="PLATFORM_ADMIN" />,
}));
vi.mock('../components/common/SplitPreviewLayout', () => ({
  SplitPreviewLayout: () => <section data-view="SPLIT_PREVIEW" />,
}));
vi.mock('../components/onboarding/RestaurantOnboardingModal', () => ({
  RestaurantOnboardingModal: () => <div data-slot="onboarding" />,
}));
vi.mock('../components/auth/LoginModal', () => ({
  LoginModal: () => <div data-slot="login" />,
}));
vi.mock('../components/common/Toast', () => ({
  ToastContainer: () => <div data-slot="toasts" />,
}));

const { default: App } = await import('../App');
const { AUTH_TOKEN_KEY } = await import('../services/api');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Injected measurements (jsdom cannot lay out). Values are arbitrary. */
const TOOLBAR_H = 57;
const HEADER_H = 69;

type Role =
  | 'PLATFORM_ADMIN'
  | 'SUPER_ADMIN'
  | 'RESTAURANT_MANAGER'
  | 'CASHIER'
  | 'WAITER'
  | 'KITCHEN'
  | 'STAFF';

let container: HTMLDivElement;
let root: Root | null = null;
let signedInUser: { id: string; name: string; role: Role; restaurantId: string | null } | null = null;

/** Seeds a console session exactly where the real AuthProvider restores it. */
function signIn(role: Role) {
  signedInUser = { id: 'user-1', name: 'مستخدم المنصة', role, restaurantId: 'rest-1' };
  localStorage.setItem(AUTH_TOKEN_KEY, 'test-token');
  localStorage.setItem('merar_user_session', JSON.stringify(signedInUser));
}

async function renderApp(viewMode: string) {
  shellState.viewMode = viewMode;
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
  });
  // Let the boot-time session verification (/auth/me) and the stack's
  // deferred band bookkeeping settle before asserting.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const customerScope = () => container.querySelector<HTMLElement>('.customer-theme-scope');
const customerHeader = () => container.querySelector<HTMLElement>('.customer-theme-scope header');
/** The platform toolbar = the sticky band rendered OUTSIDE the customer scope. */
const platformToolbar = () =>
  Array.from(container.querySelectorAll<HTMLElement>('header')).find(
    (el) => !el.closest('.customer-theme-scope')
  ) ?? null;
const stackVar = (name: string) => customerScope()?.style.getPropertyValue(name);
const slot = (name: string) => container.querySelector(`[data-slot="${name}"]`);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  localStorage.clear();
  signedInUser = null;

  // Lets the stack run its real observer code path.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );

  // The boot-time session check. Only /auth/me is answered.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const body =
        String(input).endsWith('/auth/me') && signedInUser
          ? { success: true, data: { user: signedInUser, restaurant: null } }
          : { success: false, error: 'not stubbed in this test' };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );

  // Band measurements: a band inside the customer scope is CustomerHeader;
  // the only band outside it is the platform toolbar.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const height = this.closest('.customer-theme-scope') ? HEADER_H : TOOLBAR_H;
    return { x: 0, y: 0, top: 0, left: 0, width: 0, right: 0, height, bottom: height, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

// ---------------------------------------------------------------------------
// PUBLIC_CUSTOMER
// ---------------------------------------------------------------------------

describe('PUBLIC_CUSTOMER — the guest menu mounts the customer shell only', () => {
  it('mounts no ViewSwitcher and no platform chrome', async () => {
    await renderApp('CUSTOMER');

    expect(platformToolbar()).toBeNull();
    // None of the controls the platform toolbar would have shown a guest.
    expect(container.querySelector('[title="الانتقال إلى صفحة منصة مريح الرئيسية (SaaS)"]')).toBeNull();
    expect(container.querySelector('[title="تسجيل دخول المدير أو العمال"]')).toBeNull();
    expect(container.querySelector('[aria-label^="مظهر المنصة"]')).toBeNull();
    expect(container.textContent).not.toContain('تجربة العميل الآمنة');
  });

  it('starts directly with CustomerHeader, outside any platform surface', async () => {
    await renderApp('CUSTOMER');

    expect(customerHeader()).not.toBeNull();
    // The customer scope is mounted at the app root — not nested inside the
    // platform shell wrapper (which paints --mureeh-* platform tokens).
    expect(customerScope()!.parentElement).toBe(container);
    expect(container.querySelector('[style*="--mureeh-bg"]')).toBeNull();
  });

  it('keeps the global overlays the menu relies on, without the platform onboarding wizard', async () => {
    await renderApp('CUSTOMER');

    expect(slot('login')).not.toBeNull();
    expect(slot('toasts')).not.toBeNull();
    expect(slot('onboarding')).toBeNull();
  });

  it('sticky stack: the absent toolbar contributes 0 and the rail parks on the MEASURED header', async () => {
    await renderApp('CUSTOMER');

    // CustomerHeader's `top` reads this → it parks at the viewport top.
    expect(stackVar('--m-stack-above-header')).toBe('0px');
    // `.menu-rail { top: var(--m-stack-h) }` → exactly the header's height.
    expect(stackVar('--m-stack-h')).toBe(`${HEADER_H}px`);
  });

  it.each(['MANAGER', 'KITCHEN_KDS', 'LIVE_SCREEN', 'PLATFORM_ADMIN', 'SPLIT_PREVIEW'])(
    'a guest requesting %s (e.g. a stale saved view) still gets the public shell',
    async (requested) => {
      await renderApp(requested);

      expect(platformToolbar()).toBeNull();
      expect(customerHeader()).not.toBeNull();
      expect(container.querySelector(`[data-view="${requested}"]`)).toBeNull();
      expect(stackVar('--m-stack-above-header')).toBe('0px');
    }
  );
});

// ---------------------------------------------------------------------------
// PLATFORM_CUSTOMER_PREVIEW
// ---------------------------------------------------------------------------

describe('PLATFORM_CUSTOMER_PREVIEW — a signed-in console user keeps the platform shell', () => {
  it('keeps the ViewSwitcher above the previewed menu', async () => {
    signIn('RESTAURANT_MANAGER');
    await renderApp('CUSTOMER');

    expect(platformToolbar()).not.toBeNull();
    // The preview workflow: view tabs to return to the console.
    expect(platformToolbar()!.querySelector('[title="المنيو (الزبون)"]')).not.toBeNull();
    expect(platformToolbar()!.querySelector('[title="لوحة المطعم"]')).not.toBeNull();
    expect(customerHeader()).not.toBeNull();
    // Still inside the platform surface.
    expect(customerScope()!.parentElement).not.toBe(container);
    expect(slot('onboarding')).not.toBeNull();
  });

  it('sticky stack: composes the MEASURED toolbar + header', async () => {
    signIn('RESTAURANT_MANAGER');
    await renderApp('CUSTOMER');

    expect(stackVar('--m-stack-above-header')).toBe(`${TOOLBAR_H}px`);
    expect(stackVar('--m-stack-h')).toBe(`${TOOLBAR_H + HEADER_H}px`);
  });

  it.each<Role>(['PLATFORM_ADMIN', 'SUPER_ADMIN', 'CASHIER', 'WAITER', 'KITCHEN', 'STAFF'])(
    '%s previewing the menu is never mistaken for a public guest',
    async (role) => {
      signIn(role);
      await renderApp('CUSTOMER');

      expect(platformToolbar()).not.toBeNull();
      expect(customerHeader()).not.toBeNull();
    }
  );
});

// ---------------------------------------------------------------------------
// Platform views — unchanged
// ---------------------------------------------------------------------------

describe('platform views keep the platform shell unchanged', () => {
  it.each(['MANAGER', 'KITCHEN_KDS', 'LIVE_SCREEN'])('%s renders under the ViewSwitcher', async (view) => {
    signIn('RESTAURANT_MANAGER');
    await renderApp(view);

    expect(platformToolbar()).not.toBeNull();
    expect(container.querySelector(`[data-view="${view}"]`)).not.toBeNull();
    expect(customerScope()).toBeNull();
    expect(slot('onboarding')).not.toBeNull();
  });

  it('SAAS_LANDING still renders its own page without the ViewSwitcher', async () => {
    await renderApp('SAAS_LANDING');

    expect(platformToolbar()).toBeNull();
    expect(container.querySelector('[data-view="SAAS_LANDING"]')).not.toBeNull();
    expect(customerScope()).toBeNull();
  });
});
