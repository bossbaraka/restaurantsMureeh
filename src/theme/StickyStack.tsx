/**
 * Sticky Stack — one owner of the customer menu's sticky-band geometry.
 * ===========================================================================
 *
 * THE PROBLEM THIS REPLACES
 * -------------------------
 * The category rail's sticky offset was assembled from two independently
 * owned numbers, in two different files:
 *
 *   index.css       --shell-toolbar-h: calc(57px + env(safe-area-inset-top))
 *   CustomerHeader  --customer-header-h  (published from a useEffect)
 *   index.css       .menu-rail { top: calc(var(--shell-toolbar-h) +
 *                                          var(--customer-header-h)) }
 *
 * Three defects follow from that shape, all confirmed in source:
 *
 *   1. The 57px is a HARDCODED GUESS about ViewSwitcher's rendered height
 *      (h-14 + 1px border). Nothing enforces it; any padding, border or
 *      font-size change silently desynchronises the rail.
 *   2. ViewSwitcher is CONDITIONALLY RENDERED (App.tsx hides it on the SaaS
 *      landing view). When it is absent the rail still reserves its height —
 *      a phantom offset.
 *   3. The rail consumed the sum before CustomerHeader's effect had published
 *      a measurement, so the first painted frame used a fallback value.
 *
 * THE MODEL
 * ---------
 * Sticky bands REGISTER themselves. The stack measures what is actually in
 * the DOM and publishes a single composed height. Presence, not convention,
 * determines the offset:
 *
 *   StickyStackProvider
 *     ├─ ViewSwitcher    registers 'toolbar'  (when rendered)
 *     ├─ CustomerHeader  registers 'header'   (when rendered)
 *     └─ publishes       --m-stack-h = sum of registered band heights
 *
 * SAFE AREA — SINGLE COMPENSATION POINT
 * -------------------------------------
 * ViewSwitcher absorbs `env(safe-area-inset-top)` into its own padding, so a
 * MEASURED height already includes the notch inset. Because every band is
 * measured rather than described, no `env()` arithmetic appears anywhere in
 * the stack, and double-counting is structurally impossible.
 *
 * NO LAYOUT JUMP
 * --------------
 * Measurement runs in `useLayoutEffect`, which completes before the browser
 * paints. The first painted frame therefore already carries real heights.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** The sticky bands that can sit above the category rail, top to bottom. */
export type StickyBandId = 'toolbar' | 'header';

export interface StickyStackContextValue {
  /** Registers a band element. Returns an unregister function. */
  registerBand: (id: StickyBandId, element: HTMLElement | null) => void;
  /** Measured heights of the bands currently registered. */
  heights: Partial<Record<StickyBandId, number>>;
  /** Composed height of every registered band, in CSS pixels. */
  stackHeight: number;
}

const StickyStackContext = createContext<StickyStackContextValue | null>(null);

/**
 * React binding for a sticky band.
 *
 * A band calls this with its own element ref. It does NOT publish a CSS
 * variable of its own — that was the second sticky contract this design
 * removes. It only reports its height to the single aggregator.
 */
export function useStickyBand(id: StickyBandId): (element: HTMLElement | null) => void {
  const ctx = useContext(StickyStackContext);
  const registerBand = ctx?.registerBand;

  return useCallback(
    (element: HTMLElement | null) => {
      registerBand?.(id, element);
    },
    [registerBand, id]
  );
}

/** Reads the composed stack height. Returns 0 outside a provider. */
export function useStickyStackHeight(): number {
  return useContext(StickyStackContext)?.stackHeight ?? 0;
}

export const StickyStackProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [heights, setHeights] = useState<Partial<Record<StickyBandId, number>>>({});

  // Live element + observer registry. Kept in refs so registering a band never
  // triggers a render on its own; only an actual height CHANGE updates state.
  const elementsRef = useRef(new Map<StickyBandId, HTMLElement>());
  const observersRef = useRef(new Map<StickyBandId, ResizeObserver>());
  /** Removal tokens for bands whose ref detached but may re-attach. */
  const pendingRemovalRef = useRef(new Map<StickyBandId, object>());

  const publish = useCallback((id: StickyBandId, height: number | null) => {
    setHeights((prev) => {
      if (height === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      // Sub-pixel churn (zoom, fractional layout) must not cause render loops.
      const rounded = Math.round(height * 100) / 100;
      if (prev[id] === rounded) return prev;
      return { ...prev, [id]: rounded };
    });
  }, []);

  const registerBand = useCallback(
    (id: StickyBandId, element: HTMLElement | null) => {
      const observers = observersRef.current;
      const elements = elementsRef.current;

      // DETACH. React calls a ref with null before re-attaching whenever the
      // ref callback's identity changes, so a detach is NOT proof the band is
      // gone. Removing the height synchronously here would change state, cause
      // a re-render, and — if the consumer passed an inline ref — detach again,
      // looping forever.
      //
      // Removal is therefore deferred by a microtask and cancelled if the band
      // re-registers in the same tick. A genuine unmount still removes the
      // height (producing zero phantom offset); a transient detach does not.
      if (!element) {
        observers.get(id)?.disconnect();
        observers.delete(id);
        elements.delete(id);
        const token = {};
        pendingRemovalRef.current.set(id, token);
        queueMicrotask(() => {
          if (pendingRemovalRef.current.get(id) !== token) return;
          pendingRemovalRef.current.delete(id);
          publish(id, null);
        });
        return;
      }

      // Re-attached (or attached for the first time): cancel any pending
      // removal for this band.
      pendingRemovalRef.current.delete(id);

      if (elements.get(id) === element) return;

      observers.get(id)?.disconnect();
      elements.set(id, element);

      const measure = () => publish(id, element.getBoundingClientRect().height);
      measure();

      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        observers.set(id, observer);
      }
    },
    [publish]
  );

  // Re-measure on viewport changes that do not resize the element's own box
  // but DO change the inset it absorbs (orientation change alters
  // env(safe-area-inset-top); zoom alters fractional heights).
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const remeasureAll = () => {
      for (const [id, element] of elementsRef.current) {
        publish(id, element.getBoundingClientRect().height);
      }
    };
    window.addEventListener('orientationchange', remeasureAll);
    window.addEventListener('resize', remeasureAll);
    return () => {
      window.removeEventListener('orientationchange', remeasureAll);
      window.removeEventListener('resize', remeasureAll);
    };
  }, [publish]);

  // Disconnect every observer on teardown.
  useLayoutEffect(() => {
    const observers = observersRef.current;
    return () => {
      for (const observer of observers.values()) observer.disconnect();
      observers.clear();
    };
  }, []);

  const stackHeight = useMemo(
    () => Object.values(heights).reduce<number>((total, h) => total + (h ?? 0), 0),
    [heights]
  );

  const value = useMemo<StickyStackContextValue>(
    () => ({ registerBand, heights, stackHeight }),
    [registerBand, heights, stackHeight]
  );

  return <StickyStackContext.Provider value={value}>{children}</StickyStackContext.Provider>;
};

/**
 * The sticky-stack CSS contract, as a variable map.
 *
 * ONE source of truth for every sticky offset in the customer menu:
 *
 *   --m-stack-above-header  bands above the venue header (the toolbar).
 *                           Consumed by CustomerHeader's `top`.
 *   --m-stack-h             every band above the category rail.
 *                           Consumed by `.menu-rail`'s `top`.
 *
 * Both are composed from MEASURED heights here, so no component reconstructs
 * the stack with arithmetic of its own, and an absent band contributes 0.
 */
export function useStickyStackVars(): Record<string, string> {
  const ctx = useContext(StickyStackContext);
  const toolbar = ctx?.heights.toolbar ?? 0;
  const header = ctx?.heights.header ?? 0;
  return useMemo(
    () => ({
      '--m-stack-above-header': `${toolbar}px`,
      '--m-stack-h': `${toolbar + header}px`,
    }),
    [toolbar, header]
  );
}
