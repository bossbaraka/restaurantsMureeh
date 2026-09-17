// @vitest-environment jsdom
/**
 * Two customer-shell guards that must never regress:
 *
 *  F-04 — the entry layer shows ONCE per browser tab. The flag is deliberately
 *  slug-independent: on the first render after a reload the entry machine is
 *  still running and the tenant slug is not known yet, so a slug-scoped key was
 *  READ on the fallback key while the dismissal WROTE the real slug — the flag
 *  could never match and the splash replayed on every reload.
 *
 *  Guide — it never opens by itself and never over the entry layer: a Help
 *  request only surfaces a confirmation card, and the tour starts solely on the
 *  guest's explicit confirmation.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GUIDE_OPEN_EVENT } from '../components/customer/guideBus';
import { CustomerGuideOverlay } from '../components/customer/CustomerGuideOverlay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock(import('../context/RestaurantContext'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRestaurant: () => ({
      setIsCartOpen: vi.fn(),
      setIsOrderTrackingOpen: vi.fn(),
    }),
  };
});

const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const layoutSource = source('../components/customer/CustomerLayout.tsx');
const overlaySource = source('../components/customer/CustomerGuideOverlay.tsx');

describe('F-04 — the entry layer shows once per tab', () => {
  it('reads and writes the SAME slug-independent key, so a reload never replays it', async () => {
    const { WELCOME_SEEN_KEY, hasSeenWelcome, markWelcomeSeen } = await import(
      '../components/customer/CustomerLayout'
    );

    sessionStorage.clear();
    // First entry in the tab: the layer is shown.
    expect(hasSeenWelcome()).toBe(false);
    // The guest dismissed it.
    markWelcomeSeen();
    expect(sessionStorage.getItem(WELCOME_SEEN_KEY)).toBe('true');
    // Reload in the same tab (same sessionStorage): read and write keys match.
    expect(hasSeenWelcome()).toBe(true);
  });

  it('keeps the key free of the tenant slug and the storage behind one helper pair', () => {
    // No slug interpolation anywhere near the flag (the slug is unknown at
    // mount time — that was the defect).
    expect(layoutSource).not.toMatch(/merar_welcome_seen_\$\{/);
    expect(layoutSource).toContain('export const WELCOME_SEEN_KEY');
    // The gate reads the flag through the helper and marks it through the same
    // helper — the two keys cannot drift apart again.
    expect(layoutSource).toContain('useState<boolean>(() => {\n    // Show the entry layer initially once per browser tab');
    expect(layoutSource).toContain('!hasSeenWelcome()');
    expect(layoutSource).toContain('markWelcomeSeen();');
    // Exactly one storage read and one storage write live in the file, and
    // both belong to the shared key constant.
    expect(layoutSource.match(/sessionStorage\.getItem\(WELCOME_SEEN_KEY\)/g) ?? []).toHaveLength(1);
    expect(layoutSource.match(/sessionStorage\.setItem\(WELCOME_SEEN_KEY/g) ?? []).toHaveLength(1);
    expect(layoutSource.match(/sessionStorage\./g) ?? []).toHaveLength(2);
  });
});

describe('Guide — confirmation only, inside the menu', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const buttons = () => Array.from(container.querySelectorAll('button'));
  const clickByText = (text: string) => {
    const button = buttons().find((b) => (b.textContent || '').includes(text));
    expect(button, `button "${text}" must exist`).toBeTruthy();
    button!.click();
  };

  it('never opens by itself — no auto-open path is left', async () => {
    vi.useFakeTimers();
    await act(async () => {
      root.render(<CustomerGuideOverlay />);
    });
    // The former first-run auto-open fired after 1.6s; nothing may appear now.
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toBe('');
    expect(overlaySource).not.toContain('GUIDE_SEEN_KEY');
  });

  it('a Help request shows a confirmation card instead of the tour', async () => {
    await act(async () => {
      root.render(<CustomerGuideOverlay />);
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent(GUIDE_OPEN_EVENT));
    });

    expect(container.textContent).toContain('الدليل الإرشادي');
    expect(container.textContent).toContain('نعم، ابدأ الدليل');
    expect(container.textContent).toContain('ليس الآن');
    // The walkthrough itself must not have started.
    expect(container.innerHTML).not.toContain('جولة تعريفية');
  });

  it('starts the tour only after the guest confirms', async () => {
    await act(async () => {
      root.render(<CustomerGuideOverlay />);
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent(GUIDE_OPEN_EVENT));
    });
    await act(async () => {
      clickByText('نعم، ابدأ الدليل');
    });

    expect(container.innerHTML).toContain('جولة تعريفية');
    expect(container.textContent).not.toContain('نعم، ابدأ الدليل');
  });

  it('dismissing the confirmation keeps the guide closed', async () => {
    await act(async () => {
      root.render(<CustomerGuideOverlay />);
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent(GUIDE_OPEN_EVENT));
    });
    await act(async () => {
      clickByText('ليس الآن');
    });

    expect(container.textContent).toBe('');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('is mounted by the menu only — never while the entry layer is up', () => {
    expect(layoutSource).toContain('{!showWelcome && <CustomerGuideOverlay />}');
  });
});
