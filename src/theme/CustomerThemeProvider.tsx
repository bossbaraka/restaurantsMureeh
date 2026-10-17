/**
 * CustomerThemeProvider — THE single runtime owner of customer theme tokens.
 * ===========================================================================
 *
 * Pipeline position:
 *
 *   NormalizedTheme → resolved mode → semantic tokens → THIS COMPONENT → DOM
 *
 * THE SINGLE-WRITER RULE
 * ----------------------
 * Before this component, four places wrote the same custom properties onto
 * `<html>`:
 *
 *   1. App.tsx                       useBrandTheme(...)            (dark default)
 *   2. RestaurantContext.tsx         applyBrandTheme(...)          (dark default,
 *                                                                   re-fired by
 *                                                                   10s polling)
 *   3. CustomerLayout.tsx            useEffectiveTheme(...)        (mode-aware)
 *   4. brandTheme.ts module scope    applyBrandTheme(cached)       (on import)
 *
 * Because 1, 2 and 4 default to the DARK surface while 3 is mode-aware, and
 * because 2 re-ran on every poll, a light-mode menu was repainted with
 * dark-adapted brand tokens at unpredictable intervals. That is the mechanism
 * behind "light/dark is not consistently implemented".
 *
 * This component replaces all four. It is the ONLY thing that may apply
 * customer theme tokens at runtime.
 *
 * WHY A STYLE PROP AND NOT setProperty()
 * --------------------------------------
 * Tokens are applied through React's `style` prop on a real element, not by
 * imperative `documentElement.style.setProperty` loops. This gives three
 * properties the old design could not have:
 *
 *   • Idempotent — React reconciles; there is no accumulated leftover state.
 *   • Scoped     — the tokens live on a subtree, so the platform shell is
 *                  unaffected (Phase 2 depends on this).
 *   • Cleaned up — unmounting removes them; no stale tenant palette survives
 *                  a view switch.
 *
 * PORTALS
 * -------
 * Verified by inspection: this repository uses NO `createPortal` anywhere in
 * `src/`. Every customer modal/drawer (CartDrawer, ProductDetailModal,
 * OrderTrackingDrawer, WaiterCallModal, …) renders in-tree as a `fixed`
 * element, so all of them inherit the scope's custom properties naturally.
 * If a portal is introduced later it MUST be given the scope class explicitly
 * — CSS custom properties inherit through the DOM tree, not through React
 * context.
 */

import React, { createContext, useContext, useMemo } from 'react';
import {
  buildCustomerThemeStyle,
  type SurfaceMode,
  type TokenMap,
} from './semanticTokens';
import { normalizeTheme, type NormalizedTheme, type ThemeSourceRestaurant } from './normalizeTheme';
import { useStickyStackVars } from './StickyStack';
import { resolveThemeMode } from './brandTheme';

/**
 * The restaurant owns the public-menu mode. There is no guest override and no
 * operating-system fallback: legacy `auto` values resolve to dark. `forceMode`
 * remains available only for isolated editor previews that intentionally show
 * the opposite face without changing the saved restaurant setting.
 */

/** What descendants can read about the active customer theme. */
export interface CustomerThemeContextValue {
  theme: NormalizedTheme;
  /** Fixed restaurant mode, resolved to 'light' or 'dark'. */
  surfaceMode: SurfaceMode;
  tokens: TokenMap;
}

const CustomerThemeContext = createContext<CustomerThemeContextValue | null>(null);

/**
 * Read the active customer theme. Returns null outside the scope, which is a
 * meaningful answer: platform surfaces are legitimately outside it.
 */
export function useCustomerTheme(): CustomerThemeContextValue | null {
  return useContext(CustomerThemeContext);
}

/** Resolve the restaurant mode, allowing an explicit face only for previews. */
export function resolveCustomerSurfaceMode(
  themeMode: string | undefined | null,
  forceMode?: SurfaceMode
): SurfaceMode {
  return forceMode ?? resolveThemeMode(themeMode);
}

export interface CustomerThemeProviderProps {
  /** The restaurant whose theme applies (theme row + legacy columns). */
  restaurant: ThemeSourceRestaurant | null | undefined;
  /** Optional face override for editor previews only; production views follow the restaurant. */
  forceMode?: SurfaceMode;
  /** Extra classes on the scope element. */
  className?: string;
  /** Inline styles merged AFTER the tokens (callers cannot silently shadow them). */
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * The customer theme scope.
 *
 * Renders a single element carrying:
 *   • the canonical `--m-*` semantic tokens (the only palette
 *     channel — the legacy `--brand-*` / `--menu-*` families
 *     were deleted with the migration's completion)
 *   • `data-appearance` = the RESOLVED mode
 *
 * `data-appearance` never holds the literal "auto". A `data-theme="auto"`
 * attribute — which the old engine could produce — is unmatchable by any CSS
 * selector and silently disabled every mode-aware rule.
 */
export const CustomerThemeProvider: React.FC<CustomerThemeProviderProps> = ({
  restaurant,
  forceMode,
  className,
  style,
  children,
}) => {
  // Identity of the inputs, not of the object: `currentRestaurant` is replaced
  // by reference on every 10s poll, so memoizing on the object would recompute
  // continuously.
  const themeSignature = JSON.stringify({
    theme: restaurant?.theme ?? null,
    primaryColor: restaurant?.primaryColor ?? null,
    accentColor: restaurant?.accentColor ?? null,
  });

  const theme = useMemo(
    () => normalizeTheme(restaurant),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeSignature]
  );

  // Restaurant mode is the only production input. Old `auto` values and
  // missing modes resolve to dark; no storage or device preference is read.
  const surfaceMode = resolveCustomerSurfaceMode(theme.mode, forceMode);

  const tokens = useMemo(
    () => buildCustomerThemeStyle(theme, surfaceMode),
    [theme, surfaceMode]
  );

  // Sticky-stack geometry rides on the same scope element as the theme
  // tokens. It is COMPUTED BY StickyStack (the single owner of band heights);
  // this provider only carries the values down to the customer subtree, so
  // `.menu-rail` and `CustomerHeader` read one contract instead of each
  // reassembling the stack from separately owned numbers.
  const stackVars = useStickyStackVars();

  const contextValue = useMemo<CustomerThemeContextValue>(
    () => ({ theme, surfaceMode, tokens }),
    [theme, surfaceMode, tokens]
  );

  return (
    <CustomerThemeContext.Provider value={contextValue}>
      <div
        className={`customer-theme-scope${className ? ` ${className}` : ''}`}
        data-appearance={surfaceMode}
        data-theme-source={theme.source}
        style={{ ...(tokens as React.CSSProperties), ...stackVars, ...style, colorScheme: surfaceMode }}
      >
        {children}
      </div>
    </CustomerThemeContext.Provider>
  );
};
