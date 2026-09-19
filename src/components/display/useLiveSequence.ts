import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveScene } from './liveMenuModel';

/**
 * The Live Menu's clock.
 * ======================
 * One `requestAnimationFrame` loop drives the whole screen: it paints the
 * progress bar straight onto a DOM node (so a frame never re-renders React)
 * and advances the scene index exactly once when the dwell elapses.
 *
 * Built for a TV that stays on for hours:
 *   - no `setInterval` drift, no per-frame React state, one listener per
 *     concern, and every handle released on unmount or scene change;
 *   - the clock PAUSES while the tab is hidden (a sleeping panel, a browser
 *     that throttles timers) and resumes where it left off instead of
 *     fast-forwarding through five categories at once;
 *   - `hold` freezes it while the reservation sheet is open, so a guest is
 *     never interrupted mid-form;
 *   - the next scene's image is prefetched with a detached <img> that is
 *     released on cleanup, so transitions never wait on the network and
 *     memory does not grow with the loop count.
 */
export interface LiveSequenceApi {
  scenes: LiveScene[];
  index: number;
  scene: LiveScene | null;
  /** Elapsed ratio (0..1) of the current scene — ref-driven, not state. */
  progressRef: React.RefObject<HTMLDivElement | null>;
  goTo: (index: number) => void;
  next: () => void;
  prev: () => void;
}

export function useLiveSequence(
  scenes: LiveScene[],
  options: { playing: boolean; hold?: boolean }
): LiveSequenceApi {
  const { playing, hold = false } = options;
  const [index, setIndex] = useState(0);
  const progressRef = useRef<HTMLDivElement | null>(null);

  const count = scenes.length;
  const safeIndex = count === 0 ? 0 : ((index % count) + count) % count;
  const scene = scenes[safeIndex] ?? null;

  const goTo = useCallback(
    (nextIndex: number) => {
      if (count === 0) return;
      setIndex(((nextIndex % count) + count) % count);
    },
    [count]
  );

  const next = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex]);
  const prev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex]);

  // The clock. Re-armed only when something that affects timing changes.
  const durationMs = scene?.durationMs ?? 0;
  const running = playing && !hold && count > 1 && durationMs > 0;

  useEffect(() => {
    const bar = progressRef.current;
    if (!running) {
      if (bar) bar.style.transform = 'scaleX(0)';
      return;
    }

    let frame = 0;
    let hiddenAt = 0;
    let startedAt = performance.now();

    function tick(now: number) {
      const ratio = Math.min(1, (now - startedAt) / durationMs);
      if (bar) bar.style.transform = `scaleX(${ratio.toFixed(4)})`;
      if (ratio >= 1) {
        setIndex((current) => (current + 1) % Math.max(1, count));
        return;
      }
      frame = requestAnimationFrame(tick);
    }

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = performance.now();
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      } else if (hiddenAt) {
        // Resume where we left off — a hidden screen must never fast-forward.
        startedAt += performance.now() - hiddenAt;
        hiddenAt = 0;
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
      if (bar) bar.style.transform = 'scaleX(0)';
    };
  }, [running, durationMs, safeIndex, count]);

  // Prefetch the next scene's photography so a transition never stalls.
  useEffect(() => {
    if (count < 2) return;
    const url = scenes[(safeIndex + 1) % count]?.image;
    if (!url) return;
    const preloader = new Image();
    preloader.decoding = 'async';
    preloader.src = url;
    return () => {
      // Release the decoded bitmap: a loop that runs for hours must not
      // accumulate one full-size image per scene.
      preloader.src = '';
    };
  }, [scenes, safeIndex, count]);

  return useMemo(
    () => ({ scenes, index: safeIndex, scene, progressRef, goTo, next, prev }),
    [scenes, safeIndex, scene, goTo, next, prev]
  );
}
