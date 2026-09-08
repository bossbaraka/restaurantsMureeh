import { useCallback, useEffect, useRef, useState } from 'react';
import type { MenuLayout, MenuSortKey } from '../components/customer/MenuToolbar';

export interface MenuPreferences {
  sort: MenuSortKey;
  layout: MenuLayout;
  availableOnly: boolean;
}

export const DEFAULT_MENU_PREFERENCES: MenuPreferences = {
  sort: 'menu',
  layout: 'list',
  availableOnly: false,
};

const SORT_KEYS: MenuSortKey[] = ['menu', 'featured', 'price-asc', 'price-desc', 'fastest'];

function readPreferences(storageKey: string): MenuPreferences {
  if (typeof window === 'undefined') return DEFAULT_MENU_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_MENU_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<MenuPreferences>;
    return {
      sort: parsed.sort && SORT_KEYS.includes(parsed.sort) ? parsed.sort : DEFAULT_MENU_PREFERENCES.sort,
      layout: parsed.layout === 'grid' || parsed.layout === 'list' ? parsed.layout : DEFAULT_MENU_PREFERENCES.layout,
      availableOnly: typeof parsed.availableOnly === 'boolean' ? parsed.availableOnly : DEFAULT_MENU_PREFERENCES.availableOnly,
    };
  } catch {
    return DEFAULT_MENU_PREFERENCES;
  }
}

/**
 * Per-restaurant menu view preferences (ordering, density, availability filter),
 * remembered on the device so a returning guest keeps the layout they chose.
 */
export function useMenuPreferences(
  scope: string
): [MenuPreferences, (patch: Partial<MenuPreferences>) => void] {
  const storageKey = `mureeh_menu_prefs_${scope || 'default'}`;
  const [preferences, setPreferences] = useState<MenuPreferences>(() => readPreferences(storageKey));
  const lastKeyRef = useRef(storageKey);

  // A tenant switch (platform preview) swaps the scope without remounting.
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return;
    lastKeyRef.current = storageKey;
    setPreferences(readPreferences(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      // Private mode / quota — preferences simply won't persist.
    }
  }, [storageKey, preferences]);

  const update = useCallback((patch: Partial<MenuPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
  }, []);

  return [preferences, update];
}
