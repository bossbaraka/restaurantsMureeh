/**
 * Guest Appearance Override — the state model behind the in-menu night/light
 * button.
 * ===========================================================================
 *
 * Before this existed, the customer menu's appearance had exactly two
 * inputs: the tenant's stored mode, and — whenever that mode is 'auto' —
 * the GUEST DEVICE's colour scheme. A guest whose phone is set to dark had
 * no way to read the menu in light (and vice versa): the system relied
 * solely on the client's theme.
 *
 * The override is a THIRD, guest-owned input with a strict precedence:
 *
 *     forceMode (signage)  >  guest override  >  tenant mode  >  device
 *
 * This module is the pure state model (storage + resolution). The runtime
 * application of the result still happens in exactly ONE place —
 * CustomerThemeProvider — so the single-writer rule is untouched.
 *
 * PURITY CONTRACT
 * ---------------
 * No React, no DOM mutation beyond the guest's own localStorage key, no
 * module-load side effects. Safe to import in tests and on the server.
 */

import { resolveThemeMode } from './brandTheme';
import type { SurfaceMode } from './semanticTokens';
import type { ThemeMode } from '../types/restaurant';

export type GuestAppearanceOverride = 'auto' | 'light' | 'dark';

/**
 * Guest-scoped storage key, deliberately distinct from the platform
 * preference (`mureeh_appearance`) and the brand cache (`merar_brand_theme`)
 * — the three appearance worlds must not read or clobber each other.
 */
export const GUEST_APPEARANCE_STORAGE_KEY = 'mureeh_guest_appearance';

function isGuestAppearanceOverride(value: unknown): value is GuestAppearanceOverride {
  return value === 'auto' || value === 'light' || value === 'dark';
}

/** The persisted guest choice, or 'auto'. Never throws (private-mode Safari). */
export function readGuestAppearanceOverride(): GuestAppearanceOverride {
  if (typeof window === 'undefined') return 'auto';
  try {
    const raw = window.localStorage.getItem(GUEST_APPEARANCE_STORAGE_KEY);
    return isGuestAppearanceOverride(raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

/** Persists the guest choice; 'auto' removes the entry entirely. */
export function writeGuestAppearanceOverride(value: GuestAppearanceOverride): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === 'auto') window.localStorage.removeItem(GUEST_APPEARANCE_STORAGE_KEY);
    else window.localStorage.setItem(GUEST_APPEARANCE_STORAGE_KEY, value);
  } catch {
    // Storage unavailable — the in-memory choice still applies this session.
  }
}

/**
 * PURE precedence resolution — the ONE place that decides who wins.
 *
 * `forceMode` (signage/preview) beats everything; an explicit guest choice
 * beats the tenant mode; otherwise the tenant mode resolves against the
 * device ('auto' collapses to the device preference). The result is always
 * a paintable 'light' | 'dark', never the literal 'auto' — no CSS selector
 * could ever match an "auto" appearance.
 */
export function resolveCustomerSurfaceMode(params: {
  forceMode?: SurfaceMode;
  override: GuestAppearanceOverride;
  themeMode: ThemeMode;
  prefersDark: boolean;
}): SurfaceMode {
  if (params.forceMode) return params.forceMode;
  if (params.override === 'light' || params.override === 'dark') return params.override;
  return resolveThemeMode(params.themeMode, params.prefersDark);
}
