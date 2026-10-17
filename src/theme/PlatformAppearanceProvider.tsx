/**
 * PlatformAppearanceProvider — THE single owner of PLATFORM appearance.
 * ===========================================================================
 *
 * Two appearance worlds exist in this application, and they are deliberately
 * independent:
 *
 *   PLATFORM  — the Mureeh product itself: shell, toolbar, manager console,
 *               KDS, admin. Modes: light | dark (explicit only).
 *               Owned by THIS provider.
 *
 *   CUSTOMER  — a restaurant's public menu. Modes: light | dark (restaurant-owned).
 *               Owned by CustomerThemeProvider, scoped to a DOM subtree.
 *
 * WHY THEY MUST BE SEPARATE
 * -------------------------
 * They were previously coupled through <html>: `index.html` hard-coded
 * `class="dark"`, and the restaurant theme engine wrote `data-theme` onto the
 * same element. A restaurant's configured mode therefore influenced the
 * document that the manager dashboard also lived in, and the platform could
 * never have an appearance of its own. A café choosing a light menu is saying
 * nothing whatsoever about how its manager wants the dashboard to look.
 *
 * OWNERSHIP BOUNDARY (enforced by tests)
 * --------------------------------------
 * This provider is the ONLY code allowed to touch:
 *   • document.documentElement.classList  ('dark')
 *   • document.documentElement.style.colorScheme
 *   • the `mureeh_appearance` storage key
 *   • the --mureeh-* token family
 *
 * It must NEVER read restaurant theme data or write any --m-* customer token.
 * Conversely CustomerThemeProvider must never touch anything in the list above.
 *
 * DEFAULT = 'dark'
 * ----------------
 * The product ships dark today. An old persisted `system` value is treated as
 * the same dark default; the operating-system preference is never consulted.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/** Explicit platform faces. There is no device-following state. */
export type PlatformAppearance = 'light' | 'dark';
export type ResolvedPlatformAppearance = PlatformAppearance;

/**
 * Platform-only storage key.
 *
 * Deliberately distinct from the customer theme cache (`merar_brand_theme`):
 * the two worlds must not be able to read or clobber each other's preference.
 */
export const PLATFORM_APPEARANCE_STORAGE_KEY = 'mureeh_appearance';

/** Ships dark — preserves the current product appearance exactly. */
export const DEFAULT_PLATFORM_APPEARANCE: PlatformAppearance = 'dark';

export interface PlatformAppearanceContextValue {
  /** The explicit saved choice. */
  appearance: PlatformAppearance;
  /** The painted mode (always identical to `appearance`). */
  resolved: ResolvedPlatformAppearance;
  setAppearance: (next: PlatformAppearance) => void;
}

const PlatformAppearanceContext = createContext<PlatformAppearanceContextValue | null>(null);

/** Read/modify platform appearance. Null outside the provider. */
export function usePlatformAppearance(): PlatformAppearanceContextValue | null {
  return useContext(PlatformAppearanceContext);
}

function isAppearance(value: unknown): value is PlatformAppearance {
  return value === 'light' || value === 'dark';
}

/** The stored preference, or the default. Never throws (private-mode Safari). */
export function readStoredAppearance(): PlatformAppearance {
  if (typeof window === 'undefined') return DEFAULT_PLATFORM_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(PLATFORM_APPEARANCE_STORAGE_KEY);
    return isAppearance(raw) ? raw : DEFAULT_PLATFORM_APPEARANCE;
  } catch {
    return DEFAULT_PLATFORM_APPEARANCE;
  }
}

/** Legacy-safe pure resolution: invalid/old `system` values become dark. */
export function resolvePlatformAppearance(appearance: unknown): ResolvedPlatformAppearance {
  return appearance === 'light' ? 'light' : 'dark';
}

export const PlatformAppearanceProvider: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const [appearance, setAppearanceState] = useState<PlatformAppearance>(() =>
    readStoredAppearance()
  );
  const resolved = resolvePlatformAppearance(appearance);

  // THE ONLY WRITE to <html> appearance in the application.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      resolved === 'dark' ? '#020A14' : '#FFFFFF'
    );
    // Introspection/debugging. Deliberately NOT `data-theme`: that attribute
    // belonged to the restaurant engine, and reusing the name here would
    // recreate the coupling this provider exists to remove.
    root.setAttribute('data-platform-appearance', resolved);
  }, [resolved]);

  const setAppearance = useCallback((next: PlatformAppearance) => {
    setAppearanceState(next);
    try {
      window.localStorage.setItem(PLATFORM_APPEARANCE_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode / quota). The in-memory choice still
      // applies for this session; only persistence is lost.
    }
  }, []);

  const value = useMemo<PlatformAppearanceContextValue>(
    () => ({ appearance, resolved, setAppearance }),
    [appearance, resolved, setAppearance]
  );

  return (
    <PlatformAppearanceContext.Provider value={value}>
      {children}
    </PlatformAppearanceContext.Provider>
  );
};
