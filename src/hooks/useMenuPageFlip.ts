import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * Menu page turn — the motion primitive behind "flipping" through the menu.
 * =========================================================================
 * The guest menu is read like a booklet: sections sit in a fixed order, and
 * moving between them should feel like turning a page rather than like a hard
 * content swap. This hook owns that transition.
 *
 * WHAT IT DOES
 * ------------
 *  1. watches which page (menu section) is on screen and works out whether the
 *     guest moved FORWARD or BACKWARD in the booklet;
 *  2. marks the wrapper element so CSS can play the page-turn choreography —
 *     `data-flip="next|prev"` is rendered by React, `data-turning="true"` is
 *     written here so the animation can be *restarted* when the guest turns
 *     the same way twice in a row (a class/attribute that never changes value
 *     would simply keep playing the first run);
 *  3. offers an optional touch swipe with a live tilt, so the page follows the
 *     finger before it commits;
 *  4. exposes `turnBy(±1)` for the on-screen pager buttons.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * No business logic: it never touches the cart, the session or the catalog. It
 * does not decide which dishes are shown — the caller keeps doing that and
 * merely reports which page is active. Motion is CSS + one custom property;
 * there is no animation library and no rAF loop.
 *
 * DIRECTION
 * ---------
 * The guest shell is RTL, so the spine of the booklet is on the RIGHT and a
 * finger travelling RIGHT turns to the NEXT section — the same convention the
 * QR entry layer already uses (`dirSign`). `PAGE_DIR_SIGN` keeps the swipe, the
 * tilt and the CSS reading from one constant.
 *
 * ACCESSIBILITY
 * -------------
 * `prefers-reduced-motion` skips the choreography entirely (no state, no
 * timers, no tilt) while every control — chips, pager buttons — keeps working.
 */

export type MenuFlipDirection = 'next' | 'prev';

/** Must match the CSS animation duration in `index.css` (`.menu-page`). */
export const MENU_TURN_MS = 560;
/** Finger travel that commits a page turn. */
export const SWIPE_MIN_PX = 54;
/** A fast flick commits even below the distance threshold (px/ms). */
export const SWIPE_VELOCITY = 0.32;
/** Live tilt while dragging, in degrees — enough to feel, never to distort. */
export const DRAG_TILT_DEG = 12;
/** RTL guest shell: +1 means "the gesture travels right". */
export const PAGE_DIR_SIGN = 1;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Layout effects are a no-op (and a warning) during static/SSR rendering. */
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface MenuPageFlipOptions {
  /** Ordered page ids, e.g. `['all', ...categoryIds]`. */
  pages: string[];
  /** The page currently on screen. */
  activePageId: string;
  /** Called when the guest asks for another page (swipe or pager button). */
  onTurn?: (pageId: string) => void;
  /** Attach the touch swipe (guest menu). The TV board turns itself off a timer. */
  swipe?: boolean;
  /**
   * False suspends the turn entirely (e.g. while a search is active: results
   * are not pages, and a flip per keystroke would be noise, not feedback).
   */
  enabled?: boolean;
  /** Turn duration; keep in sync with the CSS. */
  turnMs?: number;
  /** Scroll the new page back under the header when the guest was deep in the old one. */
  scrollPageIntoView?: boolean;
}

export interface MenuPageFlip {
  /**
   * Callback ref for the element carrying `perspective` (`.menu-page` /
   * `.display-menu__page`). It also seeds `data-turning="false"` on attach, so
   * the CSS never sees a half-initialised wrapper.
   */
  attachPageNode: (node: HTMLDivElement | null) => void;
  direction: MenuFlipDirection | null;
  isTurning: boolean;
  pageIndex: number;
  pageCount: number;
  canTurnPrev: boolean;
  canTurnNext: boolean;
  turnBy: (delta: number) => void;
  dragHandlers: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  };
  reducedMotion: boolean;
  swipeEnabled: boolean;
}

export function useMenuPageFlip({
  pages,
  activePageId,
  onTurn,
  swipe = false,
  enabled = true,
  turnMs = MENU_TURN_MS,
  scrollPageIntoView = true,
}: MenuPageFlipOptions): MenuPageFlip {
  const reducedMotion = useReducedMotion();
  const nodeRef = useRef<HTMLDivElement | null>(null);

  const attachPageNode = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
    if (node && node.dataset.turning === undefined) node.dataset.turning = 'false';
  }, []);

  const pageCount = pages.length;
  const foundIndex = pages.indexOf(activePageId);
  const pageIndex = foundIndex < 0 ? 0 : foundIndex;

  const [direction, setDirection] = useState<MenuFlipDirection | null>(null);
  const [turnToken, setTurnToken] = useState(0);

  // Always call the latest callback without re-arming the effects below.
  const onTurnRef = useRef(onTurn);
  useEffect(() => {
    onTurnRef.current = onTurn;
  }, [onTurn]);

  const turnBy = useCallback(
    (delta: number) => {
      if (pageCount < 2 || delta === 0) return;
      const target = clamp(pageIndex + delta, 0, pageCount - 1);
      if (target === pageIndex) return;
      const pageId = pages[target];
      if (pageId) onTurnRef.current?.(pageId);
    },
    [pageIndex, pageCount, pages]
  );

  // -------------------------------------------------------------------------
  // 1. Detect the page change and decide the direction.
  // -------------------------------------------------------------------------
  const previousIndex = useRef(pageIndex);
  const mounted = useRef(false);

  useIsoLayoutEffect(() => {
    // The first page the guest lands on is not a "turn" — it is an arrival,
    // and the entry experience already animates that hand-off.
    if (!mounted.current) {
      mounted.current = true;
      previousIndex.current = pageIndex;
      return;
    }
    if (pageIndex === previousIndex.current) return;
    // Suspended (search results, single-page menu): stay in sync silently so
    // re-enabling never replays a turn that happened while it was off.
    if (!enabled) {
      previousIndex.current = pageIndex;
      return;
    }

    const dir: MenuFlipDirection = pageIndex > previousIndex.current ? 'next' : 'prev';
    previousIndex.current = pageIndex;

    // A new page is shorter/longer than the old one: if the guest had scrolled
    // deep, bring the top of the page back under the sticky rail so they are
    // never left staring at the middle (or the footer) of a new section.
    if (scrollPageIntoView && typeof window !== 'undefined') {
      const node = nodeRef.current;
      if (node) {
        const top = node.getBoundingClientRect().top;
        if (top < 0) {
          window.scrollTo({
            top: window.scrollY + top - 96,
            behavior: reducedMotion ? 'auto' : 'smooth',
          });
        }
      }
    }

    if (reducedMotion) return;
    setDirection(dir);
    setTurnToken((token) => token + 1);
  }, [pageIndex, enabled, reducedMotion, scrollPageIntoView]);

  // -------------------------------------------------------------------------
  // 2. Play it. The attribute is written imperatively so a second turn in the
  //    same direction restarts the animation instead of being ignored.
  // -------------------------------------------------------------------------
  useIsoLayoutEffect(() => {
    if (!direction || reducedMotion) return;
    const node = nodeRef.current;
    if (!node) return;

    node.dataset.turning = 'false';
    // Forced reflow: this is what makes the browser drop the finished
    // animation and start the new one from its first keyframe.
    void node.offsetWidth;
    node.dataset.turning = 'true';

    const timer = window.setTimeout(() => {
      node.dataset.turning = 'false';
    }, turnMs + 80);

    return () => {
      window.clearTimeout(timer);
      node.dataset.turning = 'false';
    };
  }, [turnToken, direction, reducedMotion, turnMs]);

  // Stop the turn state from outliving the animation.
  useEffect(() => {
    if (!direction || reducedMotion) return;
    const timer = window.setTimeout(() => setDirection(null), turnMs + 120);
    return () => window.clearTimeout(timer);
  }, [turnToken, direction, reducedMotion, turnMs]);

  // -------------------------------------------------------------------------
  // 3. Swipe: the page follows the finger, then commits or springs back.
  // -------------------------------------------------------------------------
  const swipeEnabled = Boolean(swipe) && enabled && !reducedMotion && pageCount > 1;
  const gesture = useRef<{
    pointerId: number | null;
    x0: number;
    y0: number;
    t0: number;
    axis: 'unknown' | 'horizontal' | 'vertical';
    travel: number;
  }>({ pointerId: null, x0: 0, y0: 0, t0: 0, axis: 'unknown', travel: 0 });

  const setDragTilt = useCallback((progress: number) => {
    const node = nodeRef.current;
    if (!node) return;
    node.style.setProperty('--menu-flip-drag', progress.toFixed(3));
  }, []);

  const resetDrag = useCallback(() => {
    const node = nodeRef.current;
    gesture.current = { pointerId: null, x0: 0, y0: 0, t0: 0, axis: 'unknown', travel: 0 };
    if (node) {
      delete node.dataset.dragging;
      node.style.setProperty('--menu-flip-drag', '0');
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Touch only: a mouse drag over a scrolling menu reads as text selection,
      // and pointer/mouse guests have the chips and the pager.
      if (!swipeEnabled || event.pointerType !== 'touch' || event.button !== 0) return;
      gesture.current = {
        pointerId: event.pointerId,
        x0: event.clientX,
        y0: event.clientY,
        t0: event.timeStamp,
        axis: 'unknown',
        travel: 0,
      };
      const node = event.currentTarget;
      if (typeof node.setPointerCapture === 'function') {
        try {
          node.setPointerCapture(event.pointerId);
        } catch {
          /* capture is best-effort: synthetic events in tests carry no pointer */
        }
      }
    },
    [swipeEnabled]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      if (!swipeEnabled || g.pointerId !== event.pointerId) return;

      const dx = event.clientX - g.x0;
      const dy = event.clientY - g.y0;

      // Decide the axis once and honour it: a vertical intent belongs to the
      // browser so the swipe never steals the menu scroll.
      if (g.axis === 'unknown') {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        g.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
        if (g.axis === 'horizontal') {
          const node = nodeRef.current;
          if (node) node.dataset.dragging = 'true';
        }
      }
      if (g.axis === 'vertical') return;

      const travel = dx * PAGE_DIR_SIGN;
      g.travel = travel;

      // Resistance at both ends of the booklet: the first page cannot be
      // turned backwards, the last cannot be turned forwards.
      const atStart = pageIndex === 0 && travel < 0;
      const atEnd = pageIndex === pageCount - 1 && travel > 0;
      const damped = atStart || atEnd ? travel * 0.3 : travel;
      setDragTilt(clamp(damped / Math.max(1, SWIPE_MIN_PX * 2.2), -0.6, 1));
    },
    [pageIndex, pageCount, setDragTilt, swipeEnabled]
  );

  const endGesture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      if (!swipeEnabled || g.pointerId !== event.pointerId) return;

      const elapsed = Math.max(1, event.timeStamp - g.t0);
      const velocity = ((event.clientX - g.x0) * PAGE_DIR_SIGN) / elapsed;
      const travel = g.travel;
      resetDrag();

      if (g.axis !== 'horizontal') return;
      if (Math.abs(travel) < SWIPE_MIN_PX && Math.abs(velocity) < SWIPE_VELOCITY) return;
      turnBy(travel > 0 ? 1 : -1);
    },
    [resetDrag, swipeEnabled, turnBy]
  );

  const dragHandlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp: endGesture,
      onPointerCancel: endGesture,
    }),
    [endGesture, onPointerDown, onPointerMove]
  );

  return {
    attachPageNode,
    direction,
    isTurning: direction !== null,
    pageIndex,
    pageCount,
    canTurnPrev: pageIndex > 0,
    canTurnNext: pageIndex < pageCount - 1,
    turnBy,
    dragHandlers,
    reducedMotion,
    swipeEnabled,
  };
}
