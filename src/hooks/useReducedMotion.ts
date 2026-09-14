import { useEffect, useState } from 'react';

/**
 * Reduced motion — one place that answers "may we animate?".
 *
 * Every decorative choreography in the guest experience (the QR entry layer,
 * the menu page turn, the TV board) asks this hook first, so a guest who set
 * `prefers-reduced-motion` gets the same journey with the movement taken out.
 * The CSS repeats the same intent inside a `@media (prefers-reduced-motion:
 * reduce)` block — this hook is what stops the JS from *starting* motion the
 * CSS would then have to fight.
 */

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Synchronous read, safe during SSR and in environments without matchMedia. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Live read: flips while the guest is on the page if the OS setting changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => setReduced(query.matches);
    sync();
    // Safari < 14 only ships the deprecated listener API.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', sync);
      return () => query.removeEventListener('change', sync);
    }
    query.addListener(sync);
    return () => query.removeListener(sync);
  }, []);

  return reduced;
}
